import type { Adapter } from "../adapters/Adapter";
import { stripAnsi } from "../../shared/ansi";

const DEFAULT_IDLE_TIMEOUT_MS = 4000;

type Source = "provider-signal" | "idle-timeout";
type SignalListener = (nodeId: string, source: Source) => void;

interface Attachment {
  idleTimer: ReturnType<typeof setTimeout> | null;
  unsubscribers: Array<() => void>;
}

// Watches each attached node's output and reports when it looks finished.
// Hybrid detection (ADR-0001): an adapter's own completion signal if it has
// one, otherwise a period of silence. It doesn't know or care about node
// status — NodeManager decides whether a signal actually means anything
// right now.
export class CompletionDetector {
  private readonly attachments = new Map<string, Attachment>();
  private readonly listeners = new Set<SignalListener>();

  constructor(private readonly idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS) {}

  attach(nodeId: string, adapter: Adapter): void {
    this.detach(nodeId);

    const attachment: Attachment = { idleTimer: null, unsubscribers: [] };
    this.attachments.set(nodeId, attachment);

    const resetIdleTimer = () => {
      if (attachment.idleTimer) clearTimeout(attachment.idleTimer);
      attachment.idleTimer = setTimeout(() => this.emit(nodeId, "idle-timeout"), this.idleTimeoutMs);
    };

    attachment.unsubscribers.push(
      adapter.onOutput((chunk) => {
        // A chatty TUI's own idle chrome (blinking cursor, cursor
        // repositioning) can arrive forever without the agent doing
        // anything — none of that is real text, so it shouldn't keep
        // pushing the idle window back. Only output with actual visible
        // content counts as activity.
        if (stripAnsi(chunk).trim().length === 0) return;
        resetIdleTimer();
      }),
    );

    if (adapter.onCompletionSignal) {
      attachment.unsubscribers.push(
        adapter.onCompletionSignal(() => this.emit(nodeId, "provider-signal")),
      );
    }

    // Arm the timer immediately, not only once output arrives — a process
    // that never produces any meaningful text (e.g. hung on a first-run
    // prompt) would otherwise sit "working" forever with no idle timer
    // ever scheduled to rescue it.
    resetIdleTimer();
  }

  detach(nodeId: string): void {
    const attachment = this.attachments.get(nodeId);
    if (!attachment) return;
    if (attachment.idleTimer) clearTimeout(attachment.idleTimer);
    for (const unsubscribe of attachment.unsubscribers) unsubscribe();
    this.attachments.delete(nodeId);
  }

  onSignal(cb: SignalListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // Called once a turn actually completes (manual override, provider
  // signal, or the idle-timeout itself) so a stale timer from the
  // just-finished turn can't fire later against whatever comes next —
  // NodeManager's own status guard already ignores that case, but there's
  // no reason to leave a dangling timer armed at all.
  clearPendingIdleTimer(nodeId: string): void {
    const attachment = this.attachments.get(nodeId);
    if (attachment?.idleTimer) {
      clearTimeout(attachment.idleTimer);
      attachment.idleTimer = null;
    }
  }

  private emit(nodeId: string, source: Source): void {
    for (const listener of this.listeners) listener(nodeId, source);
  }
}
