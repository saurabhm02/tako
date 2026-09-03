import type { NodeManager } from "../node-manager/NodeManager";
import type { ConnectionGraph } from "../graph/ConnectionGraph";
import { HandoffQueue } from "./HandoffQueue";
import {
  getHandoff,
  insertHandoff,
  listPendingHandoffs,
  updateHandoffPayload,
  updateHandoffStatus,
  type HandoffRow,
} from "../store/handoffsRepo";
import { countApprovedHandoffsInRun, getOrCreateCurrentRun, markHopLimitReachedOnce } from "../store/runsRepo";
import type { HandoffSummary } from "../../shared/types";

const DEFAULT_HOP_LIMIT = 25;

type Broadcast = (channel: string, payload: unknown) => void;

function toSummary(handoff: HandoffRow): HandoffSummary {
  return {
    id: handoff.id,
    fromNodeId: handoff.fromNodeId,
    toNodeId: handoff.toNodeId,
    payloadText: handoff.payloadText,
    edited: handoff.edited,
    autoApproved: handoff.autoApproved,
    status: handoff.status,
    createdAt: handoff.createdAt,
  };
}

// The only path that can move a payload from one node's session into
// another's (docs/07-architecture.md §9). Auto-approve skips the sidebar,
// never this class — it calls the same approve() every manual click does.
export class HandoffEngine {
  private readonly queue = new HandoffQueue();
  private readonly runsAtHopLimit = new Set<string>();

  constructor(
    private readonly nodeManager: NodeManager,
    private readonly connectionGraph: ConnectionGraph,
    private readonly broadcast: Broadcast,
    private readonly hopLimit: number = DEFAULT_HOP_LIMIT,
  ) {
    nodeManager.onHandoffReady((nodeId, payload) => this.proposeForOutgoing(nodeId, payload));
    nodeManager.onStatusChanged((nodeId, status) => {
      if (status === "idle" || status === "handoff_ready") this.drainQueue(nodeId);
    });
  }

  listPending(): HandoffSummary[] {
    return listPendingHandoffs().map(toSummary);
  }

  editPayload(handoffId: string, newText: string): void {
    const handoff = getHandoff(handoffId);
    if (!handoff || handoff.status !== "pending") return;
    updateHandoffPayload(handoffId, newText);
  }

  approve(handoffId: string): void {
    const handoff = getHandoff(handoffId);
    if (!handoff || handoff.status !== "pending") return; // already resolved

    if (this.nodeManager.isFreeToReceive(handoff.toNodeId)) {
      this.deliver(handoff);
    } else {
      updateHandoffStatus(handoffId, "queued");
      this.queue.enqueue(handoff.toNodeId, handoff);
      this.broadcast("handoff:resolved", toSummary({ ...handoff, status: "queued" }));
    }
  }

  reject(handoffId: string): void {
    const handoff = getHandoff(handoffId);
    if (!handoff || handoff.status !== "pending") return;
    updateHandoffStatus(handoffId, "rejected");
    this.broadcast("handoff:resolved", toSummary({ ...handoff, status: "rejected" }));
  }

  // Fans one payload out to every outgoing connection from a node — the
  // normal path when a real node finishes a turn (via onHandoffReady above),
  // and also the Compare Node's entry point: it has no adapter/session of
  // its own, so it calls this directly with whatever the user typed instead
  // of waiting for a completion signal that will never come.
  proposeForOutgoing(fromNodeId: string, payload: string): void {
    if (!payload.trim()) return;
    for (const connection of this.connectionGraph.getOutgoing(fromNodeId)) {
      const runId = getOrCreateCurrentRun();
      const handoff = insertHandoff({
        runId,
        connectionId: connection.id,
        fromNodeId,
        toNodeId: connection.toNodeId,
        payloadText: payload,
        autoApproved: connection.autoApprove,
      });

      const underHopLimit = countApprovedHandoffsInRun(runId) < this.hopLimit;
      if (connection.autoApprove && underHopLimit) {
        this.approve(handoff.id);
      } else {
        if (connection.autoApprove && !underHopLimit) this.announceHopLimit(runId);
        this.broadcast("handoff:pending", toSummary(handoff));
      }
    }
  }

  private announceHopLimit(runId: string): void {
    markHopLimitReachedOnce(runId);
    if (this.runsAtHopLimit.has(runId)) return;
    this.runsAtHopLimit.add(runId);
    this.broadcast("run:hopLimitReached", { runId });
  }

  private deliver(handoff: HandoffRow): void {
    updateHandoffStatus(handoff.id, "delivered");
    this.broadcast("handoff:resolved", toSummary({ ...handoff, status: "delivered" }));
    void this.nodeManager.sendInput(handoff.toNodeId, `${handoff.payloadText}\r`);
  }

  private drainQueue(nodeId: string): void {
    const next = this.queue.dequeue(nodeId);
    if (next) this.deliver(next);
  }
}
