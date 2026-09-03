import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Play,
  RotateCw,
  Square,
  X,
  XCircle,
} from "lucide-react";
import { AGENT_DISPLAY_NAMES, type AgentType } from "./types";
import { formatRelativeTime } from "./overviewFilters";
import type { NodeRuntimeState, WorkflowRun } from "../../shared/types";
import { sanitizeSecretText } from "../../shared/sanitize";

interface RunHistoryViewerProps {
  workflowId?: string;
  onClose: () => void;
}

function agentLabel(agentType: string): string {
  return AGENT_DISPLAY_NAMES[agentType as AgentType] ?? agentType;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function formatDuration(startedAt: number, endedAt: number | null): string | null {
  if (endedAt === null) return null;
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Compact Run History UI allowing the user to view past executions and inspect execution details, node outputs, and handoffs in read-only mode.
 */
export function RunHistoryViewer({ workflowId, onClose }: RunHistoryViewerProps) {
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.tako.runtime.listRuns(workflowId).then((result) => {
      if (!cancelled) setRuns(result);
    });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const openRun = async (executionId: string) => {
    const full = await window.tako.runtime.getRun(executionId);
    setSelectedRun(full);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedRun) setSelectedRun(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedRun, onClose]);

  return (
    <div className="overlay overlay--focused" onClick={onClose}>
      <div className="history-view" onClick={(e) => e.stopPropagation()}>
        <div className="focused-view__header">
          <h2>{selectedRun ? `Run ${selectedRun.executionId.slice(0, 8)}` : "Run History"}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {selectedRun ? (
          <div className="history-inspect">
            <div className="history-view__toolbar">
              <button type="button" className="history-view__back" onClick={() => setSelectedRun(null)}>
                <ArrowLeft size={13} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                Back to runs
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={`status-badge status-badge--${selectedRun.status}`}>
                  {selectedRun.status}
                </span>
                <span className="history-view__run-cost">
                  {formatDuration(selectedRun.startedAt, selectedRun.completedAt) ?? "Running"}
                </span>
              </div>
            </div>

            {selectedRun.error && (
              <div className="agent-node__error-banner" style={{ margin: "12px 0" }}>
                <strong>Workflow failed:</strong> {sanitizeSecretText(selectedRun.error.message)}
              </div>
            )}

            <div className="history-inspect__section">
              <h3>Node Executions ({Object.keys(selectedRun.nodeRuns).length})</h3>
              <div className="history-inspect__node-list">
                {Object.values(selectedRun.nodeRuns).map((nr) => (
                  <div key={nr.nodeId} className="history-inspect__node-card">
                    <div className="history-inspect__node-header">
                      <div className="history-inspect__node-identity">
                        <strong>{nr.nodeName}</strong>
                        <span style={{ color: "#94a3b8", fontSize: "12px", marginLeft: "6px" }}>
                          ({agentLabel(nr.agentType)})
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {nr.startedAt && nr.completedAt && (
                          <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>
                            {formatDuration(nr.startedAt, nr.completedAt)}
                          </span>
                        )}
                        <span className={`status-badge status-badge--${nr.status}`}>
                          {nr.status}
                        </span>
                      </div>
                    </div>

                    {nr.error && (
                      <div className="history-inspect__error-box">
                        ✕ {sanitizeSecretText(nr.error.message)}
                      </div>
                    )}

                    {nr.output?.outputText ? (
                      <pre className="history-log__payload">
                        {nr.output.outputText}
                      </pre>
                    ) : (
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
                        (No output recorded)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {selectedRun.handoffs && selectedRun.handoffs.length > 0 && (
              <div className="history-inspect__section" style={{ marginTop: "16px" }}>
                <h3>Handoffs ({selectedRun.handoffs.length})</h3>
                <div className="history-inspect__handoff-list">
                  {selectedRun.handoffs.map((h) => (
                    <div key={h.id} className="handoff-card">
                      <div className="handoff-card__route">
                        <span>{h.fromNodeId} → {h.toNodeId}</span>
                        <span className={`status-badge status-badge--${h.status === "created" ? "queued" : h.status === "delivered" ? "completed" : "failed"}`}>
                          {h.status}
                        </span>
                      </div>
                      {h.sourceOutput && (
                        <pre className="history-log__payload">{h.sourceOutput}</pre>
                      )}
                      <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
                        {formatTime(h.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="history-run-list">
            {runs === null && <p className="history-view__empty">Loading runs…</p>}
            {runs !== null && runs.length === 0 && (
              <p className="history-view__empty">No runs recorded for this workflow yet.</p>
            )}
            {runs?.map((run, index) => {
              const nodeCount = Object.keys(run.nodeRuns).length;
              const duration = formatDuration(run.startedAt, run.completedAt);
              return (
                <button
                  key={run.executionId}
                  type="button"
                  className="history-run-list__item"
                  onClick={() => void openRun(run.executionId)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span className={`history-run-list__status-icon history-run-list__status-icon--${run.status}`}>
                      {run.status === "completed" && <CheckCircle2 size={16} />}
                      {run.status === "failed" && <XCircle size={16} />}
                      {run.status === "cancelled" && <Square size={14} fill="currentColor" />}
                      {run.status === "running" && <Play size={14} fill="currentColor" />}
                    </span>
                    <div>
                      <span style={{ fontWeight: 600 }}>Run #{runs.length - index}</span>
                      <span style={{ fontSize: "12px", color: "#94a3b8", marginLeft: "8px" }}>
                        {run.executionId.slice(0, 8)}
                      </span>
                      {run.error && (
                        <div style={{ fontSize: "11.5px", color: "#f87171", marginTop: "2px" }}>
                          {sanitizeSecretText(run.error.message)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="history-run-list__meta" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span>{nodeCount} node{nodeCount === 1 ? "" : "s"}</span>
                    {duration && <span>{duration}</span>}
                    <span>{formatRelativeTime(run.startedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
