import type { HandoffSummary, RuntimeHandoff } from "../../shared/types";
import { formatRelativeTime } from "./overviewFilters";

interface ApprovalSidebarProps {
  nodeLabel: (nodeId: string) => string;
  pending: HandoffSummary[];
  recentlyResolved: HandoffSummary[];
  runtimeHandoffs?: RuntimeHandoff[];
  hopLimitWarning: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPayloadChange: (handoffId: string, text: string) => void;
}

/**
 * Displays live data handoffs and approval queues as messages travel between connected nodes in the workflow.
 *
 * @example
 * Input:
 *   <ApprovalSidebar nodeLabel={labelFn} pending={[]} runtimeHandoffs={[handoff]} expanded={true} ... />
 * Output:
 *   Renders a panel listing active and historical handoffs between nodes.
 */
export function ApprovalSidebar({
  nodeLabel,
  pending,
  recentlyResolved,
  runtimeHandoffs = [],
  hopLimitWarning,
  expanded,
  onExpandedChange,
  onPayloadChange,
}: ApprovalSidebarProps) {
  const totalCount = pending.length + runtimeHandoffs.length;

  if (!expanded) {
    if (totalCount === 0 && !hopLimitWarning) return null;
    return (
      <button type="button" className="approval-badge" onClick={() => onExpandedChange(true)}>
        {totalCount > 0 ? `${totalCount} handoff${totalCount > 1 ? "s" : ""}` : "⚠ hop limit"}
      </button>
    );
  }

  return (
    <div className="approval-sidebar">
      <div className="approval-sidebar__header">
        <h3>Handoffs</h3>
        <button type="button" onClick={() => onExpandedChange(false)} aria-label="Collapse">
          ×
        </button>
      </div>

      {hopLimitWarning && (
        <div className="approval-sidebar__hop-limit">
          Hop limit reached — auto-approve is paused for this run; every handoff now needs manual approval.
        </div>
      )}

      {/* Real Runtime Handoffs */}
      {runtimeHandoffs.length > 0 && (
        <div className="approval-sidebar__section">
          <h4>Active Workflow Handoffs</h4>
          {runtimeHandoffs.map((h) => (
            <div key={h.id} className="handoff-card">
              <div className="handoff-card__route">
                <span>{nodeLabel(h.fromNodeId)} → {nodeLabel(h.toNodeId)}</span>
                <span className={`status-badge status-badge--${h.status === "created" ? "queued" : h.status === "delivered" ? "completed" : "failed"}`}>
                  {h.status}
                </span>
              </div>
              <div className="handoff-card__output-preview" style={{ fontSize: "11.5px", color: "#cbd5e1", maxHeight: "120px", overflowY: "auto", background: "rgba(15, 23, 42, 0.6)", padding: "6px 8px", borderRadius: "6px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {h.sourceOutput || "(empty output)"}
              </div>
              <div className="handoff-card__meta" style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8", marginTop: "6px" }}>
                <span>From: {nodeLabel(h.fromNodeId)}</span>
                <span>{formatRelativeTime(h.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manual Pending Approvals */}
      {pending.length > 0 && (
        <div className="approval-sidebar__section">
          <h4>Awaiting Approval</h4>
          {pending.map((handoff) => (
            <div key={handoff.id} className="handoff-card">
              <div className="handoff-card__route">
                {nodeLabel(handoff.fromNodeId)} → {nodeLabel(handoff.toNodeId)}
              </div>
              <textarea
                value={handoff.payloadText}
                onChange={(e) => onPayloadChange(handoff.id, e.target.value)}
              />
              <div className="handoff-card__actions">
                <button type="button" onClick={() => void window.tako.handoffs.approve(handoff.id)}>
                  Approve &amp; Send
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void window.tako.handoffs.reject(handoff.id)}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalCount === 0 && <p className="approval-sidebar__empty">Nothing waiting for review.</p>}

      {recentlyResolved.length > 0 && (
        <div className="approval-sidebar__section">
          <h4>Recently resolved</h4>
          {recentlyResolved.map((h) => (
            <div key={h.id} className="handoff-log-row">
              {nodeLabel(h.fromNodeId)} → {nodeLabel(h.toNodeId)} — {h.status}
              {h.autoApproved ? " (auto-approved)" : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
