import * as pty from "node-pty";
import os from "node:os";
import path from "node:path";
import type { Adapter, AdapterError, Unsubscribe, UsageReport } from "../Adapter";

export interface TerminalAdapterOptions {
  command: string;
  args?: string[];
  workingDirectory: string;
  env?: Record<string, string>;
  // Only Claude Code and Pi's factories provide one today — real usage
  // read from that agent's own on-disk session transcript (see
  // claudeCodeUsage.ts/piUsage.ts). Every other terminal agent has no
  // known way to expose real usage, so it's left unset and getUsage()
  // stays "unknown" — never estimated (CT1).
  usageReader?: () => UsageReport | "unknown";
  // Claude Code/Pi's own session id (see claudeCode.ts/pi.ts) — exposed so
  // NodeManager can persist it as session_ref for next launch. Every other
  // terminal agent has nothing resumable, so this stays unset.
  getSessionRef?: () => string | null;
  // Same shape as usageReader above, for the same reason — only Claude
  // Code, Pi, and Codex CLI have a real on-disk transcript to read a
  // structured final answer from (see each factory's own final-output
  // reader). Every other terminal agent leaves this unset, and
  // Adapter#getFinalOutput() simply returns null for them.
  finalOutputReader?: () => string | null;
  // Resume support: if the command's own startup output matches
  // `failurePattern` within a few seconds (Claude Code's --resume exits
  // immediately with "No conversation found..." for a missing/expired
  // session id), retype the fallback command into the same still-alive
  // shell instead of leaving it sitting idle at a dead session.
  resumeFallback?: {
    failurePattern: RegExp;
    onFallback: () => string[];
  };
}

const GRACEFUL_STOP_TIMEOUT_MS = 3000;
// A trivial degenerate-case guard only (node-pty can't resize to 0) — NOT
// a "TUIs need a real terminal" floor. An earlier version of this used 80x24
// for that, but clamping only the pty side while xterm.js's own grid kept
// following the (smaller) on-canvas box meant the two disagreed about the
// terminal's size, so a full-screen TUI's cursor-positioning escapes (sized
// for its 80x24 belief) landed on the wrong cells in xterm.js's smaller
// grid — the actual cause of the garbled/overlapping render bug. The pty
// and xterm.js must always agree on the exact same cols/rows (see
// AgentTerminal.tsx), so this floor has to be low enough to essentially
// never engage against a real on-canvas node size.
const MIN_COLS = 20;
const MIN_ROWS = 5;

// Spawning the agent binary directly skips the user's own shell entirely —
// no .zshrc/.zprofile, no nvm-managed PATH, no aliases or env vars a real
// terminal would have set up. A GUI app's inherited SHELL/PATH can also
// just be wrong (a generic default even when the user's real login shell
// differs) — confirmed by Superset (github.com/superset-sh/superset), a
// comparable real product, hitting the exact same issue and fixing it the
// same way: launch the user's actual login shell, then type the command
// into it exactly as a person would in a fresh terminal window. That
// guarantees the agent runs in the same environment it would for real,
// rather than whatever subset of it Electron happened to inherit.
function resolveLoginShell(): string {
  try {
    const accountShell = os.userInfo().shell;
    if (accountShell) return accountShell;
  } catch {
    // os.userInfo() can throw in unusual environments — fall through.
  }
  return process.env.SHELL || "/bin/zsh";
}

function loginShellArgs(shell: string): string[] {
  const name = path.basename(shell);
  return name === "bash" || name === "zsh" || name === "fish" ? ["-l"] : [];
}

const COMMAND_NOT_FOUND_PATTERN =
  /command not found|: not found\b|is not recognized as an internal or external command/i;

// Exported for direct unit testing — the shells available in a headless
// test/CI environment don't reliably reproduce a real interactive prompt
// (some exit immediately after running any one command, success or not),
// so this is verified against real shells' actual message text rather
// than by spawning a pty and hoping for an interactive session.
export function looksLikeCommandNotFound(output: string): boolean {
  return COMMAND_NOT_FOUND_PATTERN.test(output);
}

// docs/07-architecture.md §5 — spawns a real CLI process via node-pty and
// keeps it alive for the life of the Node Session. Drives it exactly the
// way a user typing into a terminal would: raw bytes in (send), raw bytes
// out (onOutput) — no parsing, no protocol, no reimplementing the tool.
export class TerminalAdapter implements Adapter {
  readonly kind = "terminal" as const;

  private ptyProcess: pty.IPty | null = null;
  private readonly outputListeners = new Set<(chunk: string) => void>();
  private readonly errorListeners = new Set<(err: AdapterError) => void>();
  private readonly exitListeners = new Set<() => void>();
  private intentionalStop = false;

  constructor(private readonly options: TerminalAdapterOptions) {}

  async start(): Promise<void> {
    if (this.ptyProcess) return;

    const shell = resolveLoginShell();
    let proc: pty.IPty;
    try {
      proc = pty.spawn(shell, loginShellArgs(shell), {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: this.options.workingDirectory,
        env: { ...process.env, ...this.options.env } as Record<string, string>,
      });
    } catch (err) {
      this.emitError({
        kind: "unknown",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
      throw err;
    }

    this.ptyProcess = proc;
    this.intentionalStop = false;

    proc.onData((chunk) => {
      for (const listener of this.outputListeners) listener(chunk);
    });

    // The shell is the pty's root process now, not the agent — quitting the
    // agent normally (e.g. `/exit` in Claude Code) just returns to a shell
    // prompt, exactly like a real terminal, and isn't a crash. Only the
    // shell itself dying counts as one.
    proc.onExit(({ exitCode, signal }) => {
      if (!this.intentionalStop) {
        this.emitError({
          kind: "crash",
          message: `shell session exited unexpectedly (code ${exitCode}, signal ${signal ?? "none"})`,
          recoverable: false,
        });
        for (const listener of this.exitListeners) listener();
      }
      this.ptyProcess = null;
    });

    // Type the agent command into the freshly opened shell — same as a
    // user pasting it into a new terminal window, not a special invocation.
    // That's real, not simulated: if the binary genuinely isn't installed
    // or isn't on PATH, the shell reports exactly that, the same as it
    // would for a person typing it — so watch for that specific reply and
    // surface it as a real error instead of leaving the node looking idle.
    // An empty command (the plain Terminal node) types nothing at all —
    // just a real login shell sitting at its own prompt.
    if (this.options.command) {
      const commandLine = [this.options.command, ...(this.options.args ?? [])].join(" ");
      proc.write(`${commandLine}\r`);
      this.watchForMissingCommand(proc, this.options.command);
      if (this.options.resumeFallback) this.watchForResumeFailure(proc, this.options.resumeFallback);
    }
  }

  // Bounded to the first couple of seconds right after typing the command
  // — the only window where "command not found" reliably means *our*
  // command failed to start, not something the agent's own session says
  // later for an unrelated reason.
  private watchForMissingCommand(proc: pty.IPty, command: string): void {
    let buffer = "";
    let reported = false;
    const disposable = proc.onData((chunk) => {
      if (reported) return;
      buffer += chunk;
      if (!looksLikeCommandNotFound(buffer)) return;
      reported = true;
      disposable.dispose();
      this.emitError({
        kind: "unknown",
        message: `"${command}" isn't installed (or not on PATH) in your shell — Tako types the real command in, so it needs to already work there.`,
        recoverable: false,
      });
    });
    setTimeout(() => disposable.dispose(), 3000);
  }

  // Same shape as watchForMissingCommand above — the only difference is
  // what happens on a match: retype a fallback command instead of
  // reporting a dead end, since the shell is still alive either way.
  private watchForResumeFailure(
    proc: pty.IPty,
    resumeFallback: NonNullable<TerminalAdapterOptions["resumeFallback"]>,
  ): void {
    let buffer = "";
    let reported = false;
    const disposable = proc.onData((chunk) => {
      if (reported) return;
      buffer += chunk;
      if (!resumeFallback.failurePattern.test(buffer)) return;
      reported = true;
      disposable.dispose();
      // onFallback() first — it's what actually moves getSessionRef() to the
      // new id. NodeManager persists whatever getSessionRef() returns at the
      // moment its onError listener fires, so emitting the error before this
      // would let it persist the stale, now-permanently-invalid id instead
      // of the fresh one that's about to start.
      const fallbackArgs = resumeFallback.onFallback();
      // "session_recovered" — this already fully recovered by the time it's
      // reported (fresh session id captured above, about to be typed in),
      // so NodeManager must not pin the node at "error" for it.
      this.emitError({
        kind: "session_recovered",
        message: "Previous session couldn't be resumed (missing or expired) — started a fresh session automatically.",
        recoverable: true,
      });
      // The dying `claude` process hasn't released the tty back to the
      // shell yet when its own error text lands — writing immediately gets
      // silently swallowed by the exiting process instead of reaching the
      // shell's readline. Confirmed empirically (node-pty, real `claude`):
      // 400ms still drops it, 1000ms is reliably enough for the shell to
      // reclaim input, matching this file's other real-shell-interaction
      // waits (watchForMissingCommand's 3000ms, this method's own 5000ms).
      setTimeout(() => {
        proc.write(`${[this.options.command, ...fallbackArgs].join(" ")}\r`);
      }, 1000);
    });
    setTimeout(() => disposable.dispose(), 5000);
  }

  async send(text: string): Promise<void> {
    if (!this.ptyProcess) {
      throw new Error("Cannot send input — adapter is not started");
    }
    this.ptyProcess.write(text);
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess?.resize(Math.max(cols, MIN_COLS), Math.max(rows, MIN_ROWS));
  }

  onOutput(cb: (chunk: string) => void): Unsubscribe {
    this.outputListeners.add(cb);
    return () => this.outputListeners.delete(cb);
  }

  onError(cb: (err: AdapterError) => void): Unsubscribe {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onExit(cb: () => void): Unsubscribe {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  getUsage(): UsageReport | "unknown" {
    // CT1 (docs/06-decisions-log.md): never estimate. Most terminal CLIs
    // don't expose clean usage data at all; the ones that do (Claude Code,
    // Pi) report it through a real usageReader, not by parsing terminal text.
    return this.options.usageReader ? this.options.usageReader() : "unknown";
  }

  getSessionRef(): string | null {
    return this.options.getSessionRef?.() ?? null;
  }

  getFinalOutput(): string | null {
    return this.options.finalOutputReader?.() ?? null;
  }

  async stop(): Promise<void> {
    const proc = this.ptyProcess;
    if (!proc) return;

    this.intentionalStop = true;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      proc.onExit(() => finish());
      proc.kill();
      setTimeout(() => {
        if (!settled) {
          try {
            proc.kill("SIGKILL");
          } catch {
            // already dead
          }
          finish();
        }
      }, GRACEFUL_STOP_TIMEOUT_MS);
    });
    this.ptyProcess = null;
  }

  private emitError(err: AdapterError): void {
    for (const listener of this.errorListeners) listener(err);
  }
}
