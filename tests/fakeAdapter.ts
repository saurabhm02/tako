import type { Adapter, AdapterError, UsageReport } from "../src/main/adapters/Adapter";
import { registerAdapter } from "../src/main/adapters/registry";

// A controllable stand-in for a real TerminalAdapter — tests drive it by
// calling emitOutput/emitError/emitCompletionSignal directly instead of
// spawning a real process.
export class FakeAdapter implements Adapter {
  readonly kind = "terminal" as const;
  started = false;
  sent: string[] = [];
  usage: UsageReport | "unknown" = "unknown";
  sessionRef: string | null = null;
  // What NodeManager actually passed this instance at creation — lets a
  // test prove a persisted session ref really made it back into the next
  // adapter instance after a restart.
  receivedResumeSessionRef: string | null = null;

  private readonly outputListeners = new Set<(chunk: string) => void>();
  private readonly errorListeners = new Set<(err: AdapterError) => void>();
  private readonly completionListeners = new Set<() => void>();
  private readonly exitListeners = new Set<() => void>();

  onCompletionSignal?: (cb: () => void) => () => void;
  // Controllable stand-in for a real structured-transcript adapter
  // (Claude Code/Pi/Codex CLI) — set finalOutput and a test can prove the
  // handoff payload becomes exactly that value, never the raw turnBuffer,
  // and that it's ignored when null (mirrors those adapters' own "session
  // id not discovered yet" case).
  finalOutput: string | null = null;
  getFinalOutput?: () => string | null;

  constructor(supportsCompletionSignal = false, supportsFinalOutput = false) {
    if (supportsCompletionSignal) {
      this.onCompletionSignal = (cb: () => void) => {
        this.completionListeners.add(cb);
        return () => this.completionListeners.delete(cb);
      };
    }
    if (supportsFinalOutput) {
      this.getFinalOutput = () => this.finalOutput;
    }
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async send(text: string): Promise<void> {
    this.sent.push(text);
  }

  onOutput(cb: (chunk: string) => void) {
    this.outputListeners.add(cb);
    return () => this.outputListeners.delete(cb);
  }

  onError(cb: (err: AdapterError) => void) {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onExit(cb: () => void) {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  getUsage(): UsageReport | "unknown" {
    return this.usage;
  }

  getSessionRef(): string | null {
    return this.sessionRef;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  emitOutput(chunk: string): void {
    for (const listener of this.outputListeners) listener(chunk);
  }

  emitError(err: AdapterError): void {
    for (const listener of this.errorListeners) listener(err);
  }

  emitCompletionSignal(): void {
    for (const listener of this.completionListeners) listener();
  }

  // Simulates the real adapters' behavior on an actual process crash: an
  // error AND the process-exit signal, in that order — never one without
  // the other, since a real crash always produces both.
  emitCrash(message = "process died"): void {
    this.emitError({ kind: "crash", message, recoverable: false });
    for (const listener of this.exitListeners) listener();
  }
}

// Registers a fake agent type and returns the map of FakeAdapter instances
// created per nodeId, so a test can reach in and drive each node's output.
export function registerFakeAdapterType(
  agentType: string,
  options?: { supportsCompletionSignal?: boolean; supportsFinalOutput?: boolean; workingDirectoryRequired?: boolean },
): Map<string, FakeAdapter> {
  const instances = new Map<string, FakeAdapter>();
  registerAdapter({
    agentType,
    displayName: agentType,
    kind: "terminal",
    workingDirectoryRequired: options?.workingDirectoryRequired ?? false,
    factory: (input) => {
      const adapter = new FakeAdapter(options?.supportsCompletionSignal ?? false, options?.supportsFinalOutput ?? false);
      adapter.receivedResumeSessionRef = input.resumeSessionRef;
      instances.set(input.nodeId, adapter);
      return adapter;
    },
  });
  return instances;
}
