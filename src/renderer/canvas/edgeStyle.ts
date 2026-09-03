import { MarkerType, type Edge } from "@xyflow/react";

// CV3 (docs/06-decisions-log.md): approval-required and auto-approved
// connections must be visually distinct. Solid = approval required
// (default), dashed = auto-approve. When both A→B and B→A exist, each is
// still rendered as its own single-arrowhead edge — the two overlapping
// paths naturally read as one line with arrows at both ends, so no custom
// bidirectional-edge merging is needed.
export function edgeVisualProps(
  autoApprove: boolean,
): Pick<Edge, "markerEnd" | "style"> {
  return {
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      strokeDasharray: autoApprove ? "6 4" : undefined,
      stroke: autoApprove ? "#a78bfa" : "#64748b",
      strokeWidth: 2,
    },
  };
}
