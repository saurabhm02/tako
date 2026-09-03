import { shell } from "electron";
import { AppServerClient } from "./AppServerClient";
import { calculateDollarCost } from "../../store/pricing";
import type { AdapterFactoryInput } from "../registry";
import type { Adapter, AdapterError, Unsubscribe, UsageReport } from "../Adapter";

// The real ChatGPT/Codex subscription experience (docs/08-chatgpt-codex-app-server-investigation.md):
// a long-lived `codex app-server` process driven over JSON-RPC, instead of
// spawning `codex exec` fresh per message. All protocol-specific knowledge
// (method names, param/notification shapes) lives in this one file, on top
// of AppServerClient's protocol-agnostic transport — OpenAI calls this
// protocol experimental, so a future breaking change should only ever
// require editing here.
export class CodexAppServerAdapter implements Adapter {
  readonly kind = "session" as const;

  private readonly client = new AppServerClient();
  private threadId: string | null = null;
  private model: string | null = null;
  private turnInProgress = false;
  private turnErrorReported = false;
  private inputBuffer = "";
  private stderrText = "";
  private lastUsage: UsageReport | "unknown" = "unknown";
  private readonly outputListeners = new Set<(chunk: string) => void>();
  private readonly completionListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(err: AdapterError) => void>();
  private readonly exitListeners = new Set<() => void>();

  constructor(
    private readonly workingDirectory: string | null,
    private readonly spawnTarget: { command: string; args: string[] } = {
      command: "codex",
      args: ["app-server", "--listen", "stdio://"],
    },
    // A thread id this node used last launch, if any — start() tries to
    // resume it (docs/08-chatgpt-codex-app-server-investigation.md §
    // thread/resume) so the conversation continues instead of starting
    // blank.
    private readonly resumeThreadId: string | null = null,
  ) {}

  async start(): Promise<void> {
    this.client.start(this.spawnTarget.command, this.spawnTarget.args);
    this.client.onNotification((n) => this.handleNotification(n));
    this.client.onStderr((chunk) => {
      this.stderrText += chunk;
    });
    this.client.onExit((code) => {
      if (code !== 0 && code !== null) {
        this.emitError({
          kind: "unknown",
          message: this.stderrText.trim() || `"codex app-server" exited with code ${code}`,
          recoverable: false,
        });
        for (const listener of this.exitListeners) listener();
      }
    });

    await this.client.request("initialize", { clientInfo: { name: "tako", version: "0.1.0" } });

    const account = await this.client.request<{ account: { type: string } | null }>("account/read", {
      refreshToken: false,
    });
    if (!account.account) {
      await this.login();
    }

    const started = this.resumeThreadId ? await this.resumeOrStartThread() : await this.startThread();
    this.threadId = started.thread.id;
    this.model = started.model;
  }

  private startThread(): Promise<{ thread: { id: string }; model: string | null }> {
    return this.client.request("thread/start", { sandbox: "read-only", cwd: this.workingDirectory });
  }

  // A persisted thread id can go stale server-side (expired, deleted) —
  // falling back to a brand-new thread keeps the node usable instead of
  // failing to start; "continue where you left off" is best-effort, not a
  // hard guarantee the server can't take back.
  private async resumeOrStartThread(): Promise<{ thread: { id: string }; model: string | null }> {
    try {
      return await this.client.request("thread/resume", { threadId: this.resumeThreadId });
    } catch {
      return this.startThread();
    }
  }

  // Standard OAuth handoff, not browser automation: the app-server hands
  // back a URL, Tako opens it in the user's real system browser, and the
  // user signs in on OpenAI's own hosted page. Tako never sees a password.
  private async login(): Promise<void> {
    this.emitOutput("Opening your browser to sign in to ChatGPT...\r\n");
    const response = await this.client.request<{ authUrl: string; loginId: string }>("account/login/start", {
      type: "chatgpt",
    });
    await shell.openExternal(response.authUrl);
    await this.waitForLoginCompletion(response.loginId);
    this.emitOutput("Signed in.\r\n");
  }

  private waitForLoginCompletion(loginId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.client.onNotification((n) => {
        if (n.method !== "account/login/completed") return;
        const params = n.params as { loginId: string | null; success: boolean; error: string | null };
        if (params.loginId !== loginId) return;
        cleanup();
        if (params.success) resolve();
        else reject(new Error(params.error ?? "Login failed"));
      });
      const unsubscribeExit = this.client.onExit(() => {
        cleanup();
        reject(new Error('"codex app-server" exited before login completed'));
      });
      function cleanup() {
        unsubscribe();
        unsubscribeExit();
      }
    });
  }

  // No character echo here — unlike a raw terminal, the renderer's chat
  // input already shows the user's own message locally before sending it,
  // so echoing it back would just duplicate it in the transcript.
  async send(text: string): Promise<void> {
    for (const char of text) {
      if (char === "\r" || char === "\n") {
        const prompt = this.inputBuffer.trim();
        this.inputBuffer = "";
        if (prompt) await this.startTurn(prompt);
      } else if (char === "\x7f" || char === "\b") {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
      } else if (char >= " " || char === "\t") {
        this.inputBuffer += char;
      }
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

  onExit(cb: () => void): Unsubscribe {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  getUsage(): UsageReport | "unknown" {
    return this.lastUsage;
  }

  getSessionRef(): string | null {
    return this.threadId;
  }

  async stop(): Promise<void> {
    this.threadId = null;
    this.inputBuffer = "";
    this.turnInProgress = false;
    await this.client.stop();
  }

  private async startTurn(prompt: string): Promise<void> {
    if (this.turnInProgress) {
      this.emitError({ kind: "unknown", message: "A turn is already in progress", recoverable: true });
      return;
    }
    if (!this.threadId) {
      this.emitError({ kind: "unknown", message: "No active thread", recoverable: false });
      return;
    }

    this.turnInProgress = true;
    this.turnErrorReported = false;
    this.lastUsage = "unknown";
    try {
      await this.client.request("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text: prompt }],
      });
    } catch (err) {
      this.turnInProgress = false;
      this.emitError({ kind: "unknown", message: err instanceof Error ? err.message : String(err), recoverable: true });
    }
  }

  // `turn/start` resolving only means the turn was accepted — the actual
  // streamed reply and completion arrive as notifications, handled here.
  private handleNotification(n: { method: string; params: unknown }): void {
    const params = n.params as Record<string, unknown> | null;
    if (!params || params.threadId !== this.threadId) return;

    switch (n.method) {
      case "item/agentMessage/delta": {
        this.emitOutput(params.delta as string);
        return;
      }
      case "error": {
        this.turnErrorReported = true;
        this.turnInProgress = false;
        const error = params.error as { message?: string } | undefined;
        this.emitError(classifyAppServerError(error?.message ?? "Codex reported an error"));
        return;
      }
      case "turn/completed": {
        this.turnInProgress = false;
        const turn = params.turn as { error?: { message?: string } | null } | undefined;
        if (turn?.error) {
          if (!this.turnErrorReported) this.emitError(classifyAppServerError(turn.error.message ?? "Codex reported an error"));
        } else {
          for (const listener of this.completionListeners) listener();
        }
        return;
      }
      case "thread/tokenUsage/updated": {
        // `last` is this turn's own usage; `total` is cumulative for the
        // whole thread — using `total` here would re-count every earlier
        // turn's tokens each time a cost row is inserted per turn.
        const last = (params.tokenUsage as { last?: Record<string, number> } | undefined)?.last;
        if (last && typeof last.totalTokens === "number") {
          this.lastUsage = {
            tokensOrUnits: last.totalTokens,
            dollarCost: this.model
              ? calculateDollarCost(this.model, {
                  inputTokens: last.inputTokens ?? 0,
                  outputTokens: last.outputTokens ?? 0,
                  reasoningOutputTokens: last.reasoningOutputTokens ?? 0,
                })
              : undefined,
          };
        }
        return;
      }
      default:
        return;
    }
  }

  private emitOutput(chunk: string): void {
    for (const listener of this.outputListeners) listener(chunk);
  }

  private emitError(err: AdapterError): void {
    for (const listener of this.errorListeners) listener(err);
  }
}

export function classifyAppServerError(message: string): AdapterError {
  const lower = message.toLowerCase();
  if (lower.includes("usage limit") || lower.includes("rate limit")) {
    return { kind: "rate_limit", message, recoverable: true };
  }
  if (lower.includes("log in") || lower.includes("not logged in") || lower.includes("authenticate")) {
    return { kind: "auth", message, recoverable: true };
  }
  return { kind: "unknown", message, recoverable: true };
}

export function createCodexAppServerAdapter(input: AdapterFactoryInput): Adapter {
  return new CodexAppServerAdapter(input.workingDirectory, undefined, input.resumeSessionRef);
}
