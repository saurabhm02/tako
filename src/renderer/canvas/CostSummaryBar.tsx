import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CostSummary, CostTotals } from "../../shared/types";

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

// Real known numbers only, ever — a totals row with nothing known at all
// (CT1: dollarTotal/tokensOrUnits both 0, hasUnknown true) reads as
// "Usage unavailable," never a fake "$0.00 · 0 tokens."
export function formatCostLine(totals: CostTotals | null): string {
  if (!totals) return "No usage yet";
  const parts: string[] = [];
  if (totals.dollarTotal > 0) parts.push(`$${totals.dollarTotal.toFixed(2)}`);
  if (totals.tokensOrUnits > 0) parts.push(`${formatTokens(totals.tokensOrUnits)} tokens`);
  return parts.length > 0 ? parts.join(" · ") : "Usage unavailable";
}

// Summary is owned by CanvasApp (same lifted-state idea as pendingHandoffs)
// — this used to independently subscribe to costs.onUpdated itself, which
// meant N mounted AgentNodes plus this bar were all N+1 identical
// subscriptions holding N+1 copies of the same object.
export function CostSummaryBar({
  nodeLabel,
  summary,
}: {
  nodeLabel: (nodeId: string) => string;
  summary: CostSummary | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const perNode = (summary?.perNode ?? []).filter((n) => n.dollarTotal > 0 || n.tokensOrUnits > 0 || n.hasUnknown);

  return (
    <div className="cost-summary">
      <button
        type="button"
        className="cost-summary__toggle"
        onClick={() => setExpanded((v) => !v)}
        disabled={perNode.length === 0}
        title="This run's usage, per node"
      >
        <span>This run: {formatCostLine(summary?.currentRun ?? null)}</span>
        {perNode.length > 0 && <ChevronDown size={13} className={expanded ? "cost-summary__chevron--open" : ""} />}
      </button>
      {expanded && perNode.length > 0 && (
        <div className="cost-summary__detail">
          {perNode.map((node) => (
            <div key={node.nodeId} className="cost-summary__detail-row">
              <span>{nodeLabel(node.nodeId)}</span>
              <span>{formatCostLine(node)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
