import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Play,
  Square,
  X,
  XCircle,
} from "lucide-react";
import type { WorkflowRuntimeEvent } from "../../shared/types";
import { sanitizeSecretText } from "../../shared/sanitize";
import { formatRelativeTime } from "./overviewFilters";

interface ActivityTimelineProps {
  events: WorkflowRuntimeEvent[];
  nodeLabel: (nodeId: string) => string;
  onFocusNode?: (nodeId: string) => void;
  onClose: () => void;
}

export function formatEventDetails(
  event: WorkflowRuntimeEvent,
  nodeLabel: (nodeId: string) => string,
): { title: string; subtitle?: string; icon: "start" | "complete" | "fail" | "cancel" | "queue" | "handoff"; nodeId?: string } {
  switch (event.type) {
    case "WORKFLOW_STARTED":
      return { title: "Workflow started", subtitle: `${event.nodeIds.length} node(s) scheduled`, icon: "start" };

    case "NODE_QUEUED":
      return { title: `${nodeLabel(event.nodeId)} queued`, icon: "queue", nodeId: event.nodeId };

    case "NODE_STARTED":
      return { title: `${nodeLabel(event.nodeId)} started`, icon: "start", nodeId: event.nodeId };

    case "NODE_OUTPUT":
      return { title: `${nodeLabel(event.nodeId)} produced output`, icon: "queue", nodeId: event.nodeId };

    case "NODE_COMPLETED": {
      const outPreview = event.output.outputText?.trim();
      return {
        title: `${nodeLabel(event.nodeId)} completed`,
        subtitle: outPreview ? outPreview.slice(0, 100) + (outPreview.length > 100 ? "…" : "") : undefined,
        icon: "complete",
        nodeId: event.nodeId,
      };
    }

    case "NODE_FAILED":
      return {
        title: `${nodeLabel(event.nodeId)} failed`,
        subtitle: sanitizeSecretText(event.error.message),
        icon: "fail",
        nodeId: event.nodeId,
      };

    case "NODE_CANCELLED":
      return { title: `${nodeLabel(event.nodeId)} cancelled`, icon: "cancel", nodeId: event.nodeId };

    case "HANDOFF_CREATED":
      return {
        title: `Handoff: ${nodeLabel(event.handoff.fromNodeId)} → ${nodeLabel(event.handoff.toNodeId)}`,
        subtitle: "Handoff packet created",
        icon: "handoff",
        nodeId: event.handoff.toNodeId,
      };

    case "HANDOFF_DELIVERED":
      return {
        title: `Handoff delivered to ${nodeLabel(event.toNodeId)}`,
        icon: "complete",
        nodeId: event.toNodeId,
      };

    case "WORKFLOW_COMPLETED":
      return { title: "Workflow completed", icon: "complete" };

    case "WORKFLOW_FAILED":
      return { title: "Workflow failed", subtitle: sanitizeSecretText(event.error.message), icon: "fail" };

    case "WORKFLOW_CANCELLED":
      return { title: "Workflow cancelled", icon: "cancel" };
  }
}

/**
 * Renders a live chronological activity feed showing every real WorkflowRuntimeEvent emitted during execution.
 */
export function ActivityTimeline({ events, nodeLabel, onFocusNode, onClose }: ActivityTimelineProps) {
  const reversedEvents = useMemo(() => [...events].reverse(), [events]);

  return (
    <div className="activity-timeline-panel nodrag">
      <div className="activity-timeline__header">
        <div className="activity-timeline__title">
          <Activity size={16} />
          <span>Activity Timeline</span>
          {events.length > 0 && <span className="activity-timeline__count">{events.length}</span>}
        </div>
        <button type="button" className="activity-timeline__close" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>

      <div className="activity-timeline__body">
        {events.length === 0 ? (
          <div className="activity-timeline__empty">
            <Clock size={20} />
            <p>No activity yet</p>
            <span>Run your workflow to see live execution events.</span>
          </div>
        ) : (
          <div className="activity-timeline__list">
            {reversedEvents.map((event) => {
              const { title, subtitle, icon, nodeId } = formatEventDetails(event, nodeLabel);
              return (
                <div
                  key={event.id}
                  className={`activity-timeline__item activity-timeline__item--${icon}${nodeId && onFocusNode ? " activity-timeline__item--clickable" : ""}`}
                  onClick={() => {
                    if (nodeId && onFocusNode) onFocusNode(nodeId);
                  }}
                  title={nodeId ? "Click to focus node" : undefined}
                >
                  <div className="activity-timeline__icon">
                    {icon === "start" && <Play size={12} fill="currentColor" />}
                    {icon === "complete" && <CheckCircle2 size={13} />}
                    {icon === "fail" && <XCircle size={13} />}
                    {icon === "cancel" && <Square size={11} fill="currentColor" />}
                    {icon === "queue" && <Clock size={12} />}
                    {icon === "handoff" && <ArrowRight size={12} />}
                  </div>
                  <div className="activity-timeline__content">
                    <div className="activity-timeline__item-header">
                      <span className="activity-timeline__item-title">{title}</span>
                      <span className="activity-timeline__item-time">{formatRelativeTime(event.timestamp)}</span>
                    </div>
                    {subtitle && <p className="activity-timeline__item-sub">{subtitle}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
