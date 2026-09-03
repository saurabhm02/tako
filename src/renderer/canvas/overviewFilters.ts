import type { CostTotals, NodeStatus } from "../../shared/types";

export type StatusBucket = "running" | "waiting" | "error" | "completed";
export type OverviewFilter = "all" | StatusBucket;

export interface OverviewRow {
  id: string;
  name: string;
  agentType: string;
  profileId: string;
  status: NodeStatus | string;
  bucket: StatusBucket;
  pendingHandoffCount: number;
  cost: CostTotals | null;
  lastActivityAt: number | null;
}

// The product asks for a 4-way Running/Waiting/Error/Completed split, but
// the real state machine only has 6 values (docs/07-architecture.md §6) —
// this maps onto them, it never invents a new one.
// ponytail: "not_started" folds into "completed" — there's no dedicated
// bucket for "never started yet" in a 4-way split, and a node auto-starts
// on creation/load so this state is only ever seen for a brief flicker.
export function statusBucket(status: NodeStatus | string): StatusBucket {
  switch (status) {
    case "working":
    case "starting":
    case "running":
      return "running";
    case "handoff_ready":
    case "queued":
    case "blocked":
      return "waiting";
    case "error":
    case "failed":
      return "error";
    case "idle":
    case "not_started":
    case "completed":
    case "cancelled":
    default:
      return "completed";
  }
}

// Same 4-word vocabulary the Overview filter chips already use — Run
// History reuses it instead of showing raw NodeStatus strings.
export const STATUS_BUCKET_LABEL: Record<StatusBucket, string> = {
  running: "Running",
  waiting: "Waiting",
  error: "Error",
  completed: "Completed",
};

export function matchesOverviewFilter(row: OverviewRow, filter: OverviewFilter): boolean {
  return filter === "all" || row.bucket === filter;
}

export function matchesSearch(row: OverviewRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || row.name.toLowerCase().includes(q);
}

// `now` is a param (not Date.now() inline) purely so tests are
// deterministic — same calibration-knob idea as any other time-derived UI.
export function formatRelativeTime(ts: number | null, now: number = Date.now()): string {
  if (ts === null) return "—";
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}
