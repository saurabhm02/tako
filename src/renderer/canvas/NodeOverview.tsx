import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import {
  formatRelativeTime,
  matchesOverviewFilter,
  matchesSearch,
  statusBucket,
  type OverviewFilter,
  type OverviewRow,
} from "./overviewFilters";
import { AGENT_DISPLAY_NAMES, formatStatus, isAgentNode, nodeDisplayName, pendingHandoffCountForNode, type AgentType } from "./types";
import { formatCostLine } from "./CostSummaryBar";
import type { AgentProfile, CostSummary, HandoffSummary } from "../../shared/types";
import type { TakoNode } from "./types";

interface NodeOverviewProps {
  nodes: TakoNode[];
  pendingHandoffs: HandoffSummary[];
  costSummary: CostSummary | null;
  onFocusNode: (nodeId: string) => void;
  onClose: () => void;
}

const FILTERS: { key: OverviewFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "waiting", label: "Waiting" },
  { key: "error", label: "Error" },
  { key: "completed", label: "Completed" },
];

export function NodeOverview({ nodes, pendingHandoffs, costSummary, onFocusNode, onClose }: NodeOverviewProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [profilesByAgentType, setProfilesByAgentType] = useState<Record<string, AgentProfile[]>>({});

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const rows: OverviewRow[] = useMemo(
    () =>
      nodes.filter(isAgentNode).map((n) => ({
        id: n.id,
        name: nodeDisplayName(n.data.name, n.data.agentType),
        agentType: n.data.agentType,
        profileId: typeof n.data.config.profileId === "string" ? n.data.config.profileId : "",
        status: n.data.status,
        bucket: statusBucket(n.data.status),
        pendingHandoffCount: pendingHandoffCountForNode(pendingHandoffs, n.id),
        cost: costSummary?.perNode.find((c) => c.nodeId === n.id) ?? null,
        lastActivityAt: n.data.lastActivityAt,
      })),
    [nodes, pendingHandoffs, costSummary],
  );

  const agentTypesKey = useMemo(() => [...new Set(rows.map((r) => r.agentType))].sort().join(","), [rows]);
  useEffect(() => {
    const types = agentTypesKey ? agentTypesKey.split(",") : [];
    let cancelled = false;
    void Promise.all(types.map((t) => window.tako.adapters.listProfiles(t).then((profiles) => [t, profiles] as const))).then(
      (entries) => {
        if (!cancelled) setProfilesByAgentType(Object.fromEntries(entries));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [agentTypesKey]);

  const filtered = rows.filter((r) => matchesOverviewFilter(r, filter) && matchesSearch(r, search));

  return (
    <div className="node-overview omni-panel" onClick={(e) => e.stopPropagation()}>
      <div className="omni-panel-header">
        <span>Overview</span>
        <button type="button" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="node-overview__search">
        <Search size={13} />
        <input
          type="text"
          placeholder="Search nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </div>

      <div className="node-overview__filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`node-overview__filter${filter === f.key ? " node-overview__filter--active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="node-overview__list">
        {filtered.length === 0 && <p className="node-overview__empty">No matching nodes.</p>}
        {filtered.map((row) => {
          const agentLabel = AGENT_DISPLAY_NAMES[row.agentType as AgentType] ?? row.agentType;
          const profile = profilesByAgentType[row.agentType]?.find((p) => p.id === row.profileId);
          return (
            <button key={row.id} type="button" className="node-overview__row" onClick={() => onFocusNode(row.id)}>
              <span
                className={`agent-node__status-dot agent-node__status-dot--${row.status}`}
                title={formatStatus(row.status)}
              />
              <span className="node-overview__row-main">
                <span className="node-overview__row-name">{row.name}</span>
                <span className="node-overview__row-agent">
                  {agentLabel}
                  {profile && profile.id !== "" ? ` · ${profile.label}` : ""}
                </span>
              </span>
              {row.pendingHandoffCount > 0 && (
                <span className="node-overview__row-handoff" title="Pending handoff">
                  {row.pendingHandoffCount}
                </span>
              )}
              <span className="node-overview__row-cost">{formatCostLine(row.cost)}</span>
              <span className="node-overview__row-time">{formatRelativeTime(row.lastActivityAt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
