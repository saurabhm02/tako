import type { HandoffRow } from "../store/handoffsRepo";

// Per-destination FIFO of approved handoffs waiting for a busy node to
// free up (HA1) — delivery never interrupts a node mid-task.
export class HandoffQueue {
  private readonly queues = new Map<string, HandoffRow[]>();

  enqueue(toNodeId: string, handoff: HandoffRow): void {
    const queue = this.queues.get(toNodeId) ?? [];
    queue.push(handoff);
    this.queues.set(toNodeId, queue);
  }

  dequeue(toNodeId: string): HandoffRow | undefined {
    const queue = this.queues.get(toNodeId);
    return queue?.shift();
  }
}
