import { spawn, type ChildProcess } from "node:child_process";
import type { Adapter, AdapterError, Unsubscribe, UsageReport } from "../Adapter";

export interface SessionTurnEvent {
  text?: string;
  sessionId?: string;
  usage?: UsageReport;
  error?: AdapterError;
}

export interface SessionAdapterOptions {
  command: string;
  workingDirectory?: string | null;
  // Build the argv for one turn. `sessionId` is null on the first turn;
  // once the agent has handed one back it's passed on every later turn so
  // the CLI resumes the same thread instead of starting a fresh one
  // (ADR-0003 — a handoff is a new message into the same session, never a
  // stateless call).
  buildArgs(prompt: string, sessionId: string | null): string[];
  // Parse one line of the child process's stdout into whatever it reveals.
  parseLine(line: string): SessionTurnEvent;
}

const GRACEFUL_STOP_TIMEOUT_MS = 3000;

// A session-based agent has no live PTY to keep alive (docs/07-architecture.md
// §4/§10) — each turn is its own short-lived child process, stitched into
// one persistent session purely by a session id the agent hands back. The
// completion signal is the process exiting cleanly, which is as trustworthy
// as a provider signal gets: there's nothing left running to be "still
// working" once that happens.
//
// The renderer feeds input character-by-character (the same xterm terminal
// every adapter kind shares), so input is buffered here until a newline
// before a turn is actually started — one full message per process spawn,
// not one process per keystroke.
export class SessionAdapter implements Adapter {
  readonly kind = "session" as const;

  private sessionId: string | null = null;
  private child: ChildProcess | null = null;
  private inputBuffer = "";
  private lastUsage: UsageReport | "unknown" = "unknown";
  private readonly outputListeners = new Set<(chunk: string) => void>();
  private readonly completionListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(err: AdapterError) => void>();

  constructor(private readonly options: SessionAdapterOptions) {}

  async start(): Promise<void> {
    // Nothing to keep alive between turns.
  }

  async send(text: string): Promise<void> {
    for (const char of text) {
      if (char === "\r" || char === "\n") {
        const prompt = this.inputBuffer.trim();
        this.inputBuffer = "";
        this.emitOutput("\r\n");
        if (prompt) await this.runTurn(prompt);
      } else if (char === "\x7f" || char === "\b") {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.emitOutput("\b \b");
      } else if (char >= " " || char === "\t") {
        this.inputBuffer += char;
        this.emitOutput(char);
      }
      // Anything else (arrow keys, escape sequences) isn't meaningful for a
      // one-shot process per message — silently dropped, not a full
      // terminal emulator.
    }
  }

  onOutput(cb: (chunk: string) => void): Unsubscribe {
    this.outputListeners.add(cb);
    return () => this.outputListeners.delete(cb);
  }

  onCompletionSignal(cb: () => void): Unsubscribe {
    this.completionListeners.add(cb);
    return () => this.completionListeners.delete(cb);
  }

  onError(cb: (err: AdapterError) => void): Unsubscribe {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  getUsage(): UsageReport | "unknown" {
    return this.lastUsage;
  }

  async stop(): Promise<void> {
    this.sessionId = null;
    this.inputBuffer = "";
    const child = this.child;
    if (!child) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once("close", finish);
      child.kill();
      setTimeout(() => {
        if (!settled) {
          try {
            child.kill("SIGKILL");
          } catch {
            // already dead
          }
          finish();
        }
      }, GRACEFUL_STOP_TIMEOUT_MS);
    });
    this.child = null;
  }

  private async runTurn(prompt: string): Promise<void> {
    if (this.child) {
      this.emitError({ kind: "unknown", message: "A turn is already in progress", recoverable: true });
      return;
    }

    this.lastUsage = "unknown";
    const args = this.options.buildArgs(prompt, this.sessionId);

    let child: ChildProcess;
    try {
      child = spawn(this.options.command, args, {
        cwd: this.options.workingDirectory ?? undefined,
        env: process.env,
        // No stdin — the prompt is already a CLI argument. Some CLIs (Codex
        // included) treat a piped-but-open stdin as extra input to append
        // to the prompt; not providing one at all matches how the command
        // behaves when a user runs it directly in a real terminal.
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      this.emitError({
        kind: "unknown",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
      return;
    }
    this.child = child;

    // A real failure (e.g. Codex's own usage-limit message) is reported
    // through more than one line — a top-level `error` event and a
    // `turn.failed` event both describe the same thing, and it's also a
    // non-zero exit on top. Only the first is surfaced; once a turn has
    // reported its error, nothing later this turn does it again.
    let reportedError = false;
    let sawText = false;
    let buffered = "";
    let stderrText = "";
    child.stdout?.on("data", (data: Buffer) => {
      buffered += data.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (reportedError) continue;
        const result = this.handleLine(line);
        if (result.reportedError) reportedError = true;
        if (result.sawText) sawText = true;
      }
    });
    // Not otherwise parsed as signal, but a non-zero exit with no parsed
    // stdout error is otherwise reported with no detail at all — this is
    // the only place that detail is available.
    child.stderr?.on("data", (data: Buffer) => {
      stderrText += data.toString("utf8");
    });

    child.on("close", (code) => {
      this.child = null;
      if (reportedError) return;
      if (code === 0 && sawText) {
        for (const listener of this.completionListeners) listener();
      } else if (code === 0) {
        // A clean exit with nothing to show is more likely a silent
        // failure than a genuinely empty answer — surfacing it beats a
        // handoff-ready turn with no actual content.
        this.emitError({
          kind: "unknown",
          message: `"${this.options.command}" produced no response`,
          recoverable: true,
        });
      } else if (code !== null) {
        const detail = stderrText.trim();
        this.emitError({
          kind: "unknown",
          message: detail
            ? `"${this.options.command}" exited with code ${code}: ${detail}`
            : `"${this.options.command}" exited with code ${code}`,
          recoverable: true,
        });
      }
    });

    child.on("error", (err) => {
      this.child = null;
      this.emitError({ kind: "unknown", message: err.message, recoverable: false });
    });
  }

  private handleLine(line: string): { reportedError: boolean; sawText: boolean } {
    const none = { reportedError: false, sawText: false };
    const trimmed = line.trim();
    if (!trimmed) return none;

    let event: SessionTurnEvent;
    try {
      event = this.options.parseLine(trimmed);
    } catch {
      return none; // a non-JSON line isn't fatal, just not signal
    }

    if (event.sessionId) this.sessionId = event.sessionId;
    if (event.usage) this.lastUsage = event.usage;
    if (event.text) this.emitOutput(event.text);
    if (event.error) {
      this.emitError(event.error);
      return { reportedError: true, sawText: false };
    }
    return { reportedError: false, sawText: Boolean(event.text) };
  }

  private emitOutput(chunk: string): void {
    for (const listener of this.outputListeners) listener(chunk);
  }

  private emitError(err: AdapterError): void {
    for (const listener of this.errorListeners) listener(err);
  }
}
