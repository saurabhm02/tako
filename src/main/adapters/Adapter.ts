import type { AdapterKind } from "../../shared/types";

export interface AdapterError {
  // "session_recovered" is distinct from every other kind: it reports that
  // the adapter already silently fixed itself (e.g. an invalid resume
  // fell back to a fresh session) before this fired — the node was never
  // actually broken, so NodeManager must not pin its status to "error" for
  // this one kind (see NodeManager's onError handler).
  kind: "auth" | "network" | "rate_limit" | "crash" | "unknown" | "session_recovered";
  message: string;
  recoverable: boolean;
}

export type UsageReport = { tokensOrUnits?: number; dollarCost?: number };

export type Unsubscribe = () => void;

// docs/07-architecture.md §4 — one small interface, several depths of
// implementation behind it. Note what's deliberately absent: no markDone,
// no timeout logic, no cost-estimation math — those belong to Completion
// Detector and cost reporting (later epics), not here.
export interface Adapter {
  readonly kind: AdapterKind;
  start(): Promise<void>;
  send(text: string): Promise<void>;
  /** Resize the underlying terminal, if this adapter has one (terminal-kind only). */
  resize?(cols: number, rows: number): void;
  onOutput(cb: (chunk: string) => void): Unsubscribe;
  onCompletionSignal?(cb: () => void): Unsubscribe;
  onError(cb: (err: AdapterError) => void): Unsubscribe;
  /**
   * Fires once when this adapter's own underlying process/session has died
   * unexpectedly (not as a result of `stop()`). Only meaningful for
   * adapters that hold a persistent process across turns (terminal shells,
   * the Codex app-server) — one-shot-per-turn adapters have no such
   * process to outlive a turn, so implementing this is optional.
   */
  onExit?(cb: () => void): Unsubscribe;
  getUsage(): UsageReport | "unknown";
  /**
   * Whatever identity a fresh instance would need to resume this same
   * session/thread (e.g. the Codex App Server's thread id) — persisted by
   * NodeManager and passed back in as `resumeSessionRef` on the next
   * start. Adapters with nothing resumable (every terminal CLI today)
   * simply don't implement this.
   */
  getSessionRef?(): string | null;
  /**
   * The real, final user-facing text of the turn that just completed —
   * never thinking/reasoning, tool calls, tool output, or terminal chrome.
   * Only adapters with a genuine structured record of their own turns
   * (e.g. Claude Code/Pi/Codex CLI's own on-disk session transcripts)
   * implement this. Everything else has no reliable way to separate final
   * output from noise in a raw output stream, so NodeManager falls back to
   * the turn's raw buffer for those — a known, documented limitation, not
   * a guess dressed up as a fix.
   */
  getFinalOutput?(): string | null;
  stop(): Promise<void>;
}
