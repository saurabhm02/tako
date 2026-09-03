import { useEffect, useState } from "react";
import { Handle, NodeResizer, NodeToolbar, Position } from "@xyflow/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileDiff,
  FolderOpen,
  GitBranch,
  MessageSquare,
  RotateCw,
  Send,
  User,
  X,
} from "lucide-react";
import {
  AGENT_ACCENT_COLORS,
  AGENT_DISPLAY_NAMES,
  AGENT_ICONS,
  formatAdapterError,
  formatStatus,
  nodeDisplayName,
  type AgentNodeData,
  type AgentType,
} from "./types";
import type { AdapterError, AgentProfile, CostTotals, NodeRuntimeState, NodeStatus } from "../../shared/types";
import { AgentTerminal } from "./AgentTerminal";
import { ChatConversation } from "./ChatConversation";
import { formatCostLine } from "./CostSummaryBar";

export const AGENT_NODE_MIN_WIDTH = 360;
export const AGENT_NODE_MIN_HEIGHT = 280;

interface AgentNodeProps {
  id: string;
  data: AgentNodeData;
  status: NodeStatus;
  error: AdapterError | null;
  selected: boolean;
  isAvailable?: boolean;
  // Count of real, currently-pending handoffs FROM this node (never just
  // "has an outgoing connection") — see CanvasApp's pendingHandoffs, the
  // one list every handoff-UI surface on the canvas reads from.
  pendingHandoffCount: number;
  // Owned by CanvasApp (lifted, same reason pendingHandoffCount is a prop
  // instead of a self-subscription) — was previously this component's own
  // costs.onUpdated subscription, one per mounted agent node.
  cost: CostTotals | null;
  onRemove: (nodeId: string) => void;
  onMarkDone: (nodeId: string) => void;
  onRetry?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onSetTaskPrompt?: (nodeId: string, prompt: string) => void;
  onSetWorkingDirectory: (nodeId: string, directory: string) => void;
  onSetProfile: (nodeId: string, profileId: string) => void;
  onReviewHandoffs: () => void;
  // Only ever called with a real, non-empty code change summary — the
  // banner below doesn't render at all otherwise, so this is never
  // reachable for a zero-change turn.
  onViewCodeChanges: (summary: NonNullable<AgentNodeData["lastCodeChange"]>) => void;
}

async function pickAndSet(nodeId: string, onSetWorkingDirectory: AgentNodeProps["onSetWorkingDirectory"]) {
  const picked = await window.tako.dialogs.pickDirectory();
  if (picked) onSetWorkingDirectory(nodeId, picked);
}

// The canvas card *is* the agent experience — a minimal header (icon, name,
// agent type, live status dot, close) plus the agent's own live terminal
// underneath. Everything else (git branch, workspace, restart) lives in a
// toolbar that floats below the node only while it's selected (React
// Flow's NodeToolbar), so it never crowds the node body or fights the
// terminal for space, even when the node is resized small.
export function AgentNode({
  id,
  data,
  status,
  error,
  selected,
  isAvailable = true,
  pendingHandoffCount,
  cost,
  onRemove,
  onMarkDone,
  onRetry,
  onDuplicate,
  onSetTaskPrompt,
  onSetWorkingDirectory,
  onSetProfile,
  onReviewHandoffs,
  onViewCodeChanges,
}: AgentNodeProps) {
  const agentLabel = AGENT_DISPLAY_NAMES[data.agentType as AgentType] ?? data.agentType;
  const title = nodeDisplayName(data.name, data.agentType);
  const AgentIcon = AGENT_ICONS[data.agentType as AgentType] ?? AGENT_ICONS.bash;
  const accentColor = AGENT_ACCENT_COLORS[data.agentType as AgentType] ?? "#a5b4fc";

  const initialPrompt = typeof data.config?.taskPrompt === "string"
    ? data.config.taskPrompt
    : typeof data.config?.prompt === "string"
      ? data.config.prompt
      : "";
  const [showTaskPrompt, setShowTaskPrompt] = useState(Boolean(initialPrompt));
  const [taskPrompt, setTaskPrompt] = useState(initialPrompt);

  useEffect(() => {
    const updated = typeof data.config?.taskPrompt === "string"
      ? data.config.taskPrompt
      : typeof data.config?.prompt === "string"
        ? data.config.prompt
        : "";
    setTaskPrompt(updated);
    if (updated) setShowTaskPrompt(true);
  }, [data.config?.taskPrompt, data.config?.prompt]);

  const [gitBranch, setGitBranch] = useState<string | null>(null);
  useEffect(() => {
    if (!data.workingDirectory) {
      setGitBranch(null);
      return;
    }
    let cancelled = false;
    void window.tako.git.getBranch(data.workingDirectory).then((branch) => {
      if (!cancelled) setGitBranch(branch);
    });
    return () => {
      cancelled = true;
    };
  }, [data.workingDirectory]);

  const workspaceLabel = data.workingDirectory ? (data.workingDirectory.split("/").pop() ?? data.workingDirectory) : "workspace";

  // Only Claude Code and Pi nodes ever get more than the one "Default"
  // entry back — the picker only renders when there's an actual choice.
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  useEffect(() => {
    void window.tako.adapters.listProfiles(data.agentType).then(setProfiles);
  }, [data.agentType]);
  const profileId = typeof data.config.profileId === "string" ? data.config.profileId : "";
  const currentProfile = profiles.find((p) => p.id === profileId);

  // A native <select>'s own OS-rendered dropdown popup sits outside React
  // Flow's DOM entirely — opening it can register as a click "off" the
  // node and deselect it, which hides the whole NodeToolbar (isVisible
  // tracks selection) mid-interaction, taking the still-open dropdown with
  // it. A plain in-DOM popover has no such popup, so nothing outside React
  // ever fires; `isVisible` below also stays true while it's open as a
  // second guard against losing selection for any other reason.
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  useEffect(() => {
    if (!showProfileMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowProfileMenu(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showProfileMenu]);

  const statusAccent =
    status === "error" || status === "failed"
      ? " agent-node--status-error"
      : status === "working" || status === "running"
        ? " agent-node--status-working"
        : status === "completed"
          ? " agent-node--status-completed"
          : status === "queued"
            ? " agent-node--status-queued"
            : status === "blocked"
              ? " agent-node--status-blocked"
              : status === "cancelled"
                ? " agent-node--status-cancelled"
                : "";

  return (
    <div className={`agent-node${statusAccent}`}>
      <NodeResizer
        nodeId={id}
        isVisible={selected}
        minWidth={AGENT_NODE_MIN_WIDTH}
        minHeight={AGENT_NODE_MIN_HEIGHT}
      />

      <NodeToolbar
        nodeId={id}
        position={Position.Bottom}
        offset={10}
        isVisible={selected || showProfileMenu}
        className="agent-node__toolbar nodrag"
      >
        {/* Read-only branch badge, not a switcher — Tako doesn't manage git
            state, so this is intentionally just a label. */}
        <button
          type="button"
          className="agent-node__toolbar-btn"
          disabled
          title={gitBranch ? `Branch: ${gitBranch}` : "Not a git repository"}
        >
          <GitBranch size={13} />
          <span>{gitBranch ?? "git"}</span>
        </button>
        <button
          type="button"
          className="agent-node__toolbar-btn"
          title={data.workingDirectory ?? "Choose a working directory"}
          onClick={() => void pickAndSet(id, onSetWorkingDirectory)}
        >
          <FolderOpen size={13} />
          <span>{workspaceLabel}</span>
        </button>
        <button
          type="button"
          className={`agent-node__toolbar-btn${showTaskPrompt ? " agent-node__toolbar-btn--active" : ""}`}
          title="Task / Prompt"
          onClick={() => setShowTaskPrompt((v) => !v)}
        >
          <MessageSquare size={13} />
          <span>Task</span>
        </button>
        <button
          type="button"
          className="agent-node__toolbar-btn"
          title="Restart"
          onClick={() => void window.tako.nodes.restart(id)}
        >
          <RotateCw size={13} />
          <span>Restart</span>
        </button>
        {onDuplicate && (
          <button
            type="button"
            className="agent-node__toolbar-btn"
            title="Duplicate node (Cmd+D)"
            onClick={() => onDuplicate(id)}
          >
            <Copy size={13} />
            <span>Duplicate</span>
          </button>
        )}
        {profiles.length > 1 && (
          <div className="agent-node__profile-picker">
            <button
              type="button"
              className="agent-node__toolbar-btn"
              title="Profile"
              onClick={() => setShowProfileMenu((v) => !v)}
            >
              <User size={13} />
              <span>{currentProfile?.label ?? "Default"}</span>
              <ChevronDown size={11} />
            </button>
            {showProfileMenu && (
              <div className="agent-node__profile-menu nodrag">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`agent-node__profile-menu-item${p.id === profileId ? " agent-node__profile-menu-item--active" : ""}`}
                    onClick={() => {
                      onSetProfile(id, p.id);
                      setShowProfileMenu(false);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </NodeToolbar>
      {showProfileMenu && <div className="popover-backdrop" onClick={() => setShowProfileMenu(false)} />}

      <Handle type="target" position={Position.Top} />

      <div className="node-chrome">
        <span className="node-chrome__lights">
          <span className="node-chrome__light node-chrome__light--red" />
          <span className="node-chrome__light node-chrome__light--yellow" />
          <span className="node-chrome__light node-chrome__light--green" />
        </span>
        <span className="agent-node__header-icon" style={{ color: accentColor }}>
          <AgentIcon size={14} />
        </span>
        <span className="agent-node__header-title" title={title}>
          {title}
        </span>
        <span className="agent-node__header-agent" style={{ color: accentColor }}>
          {agentLabel}
          {currentProfile && currentProfile.id !== "" ? ` · ${currentProfile.label}` : ""}
        </span>

        {!isAvailable && data.agentType !== "bash" && (
          <span className="agent-node__unavailable-badge" title="Agent CLI is not installed or available on PATH">
            Unavailable
          </span>
        )}

        <span className="agent-node__header-actions nodrag">
          {(status === "working" || status === "running") && (
            <button type="button" title="Mark Done" onClick={() => onMarkDone(id)}>
              <CheckCircle2 size={13} />
            </button>
          )}
          <span
            className={`agent-node__status-dot agent-node__status-dot--${status}`}
            title={formatStatus(status)}
          />
          <button type="button" title="Close" onClick={() => onRemove(id)}>
            <X size={13} />
          </button>
        </span>
      </div>

      {showTaskPrompt && (
        <div className="agent-node__task-drawer nodrag">
          <div className="agent-node__task-header">
            <span className="agent-node__task-label">
              <MessageSquare size={12} />
              Task / Prompt
            </span>
            <button
              type="button"
              className="agent-node__task-toggle-btn"
              onClick={() => setShowTaskPrompt(false)}
              title="Close task editor"
            >
              <X size={11} />
            </button>
          </div>
          <textarea
            className="agent-node__task-textarea nodrag"
            placeholder={`Define task or prompt for ${agentLabel}…`}
            value={taskPrompt}
            onChange={(e) => {
              const val = e.target.value;
              setTaskPrompt(val);
              onSetTaskPrompt?.(id, val);
            }}
            rows={2}
          />
        </div>
      )}

      {!isAvailable && data.agentType !== "bash" && (
        <div className="agent-node__unavailable-banner nodrag">
          <AlertTriangle size={13} />
          <span>{agentLabel} CLI is not available on PATH.</span>
        </div>
      )}

      <div className="agent-node__body nodrag nowheel">
        {status === "not_started" ? (
          <div className="agent-node__placeholder">Launching {agentLabel}…</div>
        ) : data.adapterKind === "session" ? (
          <ChatConversation nodeId={id} status={status} error={error} />
        ) : (
          <AgentTerminal nodeId={id} />
        )}
      </div>

      {/* Structured runtime failure banner with direct Retry action */}
      {(status === "failed" || error) && (
        <div className="agent-node__error-banner nodrag">
          <div className="agent-node__error-content">
            <span className="agent-node__error-title">Node failed</span>
            <span className="agent-node__error-msg">
              {error ? formatAdapterError(error) : "Execution stopped or failed unexpectedly"}
            </span>
          </div>
          {onRetry && (
            <button
              type="button"
              className="agent-node__error-retry-btn"
              onClick={() => onRetry(id)}
              title="Retry this node"
            >
              <RotateCw size={11} />
              Retry
            </button>
          )}
        </div>
      )}

      {/* Only a real pending handoff shows this — never merely because the
          node reached handoff_ready or has an outgoing connection (that's
          formatStatus's own status-badge below, an honest but separate
          signal: "this node is done," not "there's a handoff to review"). */}
      {pendingHandoffCount > 0 && (
        <button type="button" className="agent-node__handoff-banner nodrag" onClick={onReviewHandoffs}>
          <span>
            Ready to hand off{pendingHandoffCount > 1 ? ` (${pendingHandoffCount})` : ""}
          </span>
          <span className="agent-node__handoff-banner-action">
            <Send size={12} />
            Review handoff
          </span>
        </button>
      )}

      {/* Only when a real, non-empty code change was actually recorded for
          this node's most recent completed turn this session (see
          codeChanges.onRecorded in CanvasApp) — never for a zero-change
          turn, a non-git directory, or a historical/pre-restart change. */}
      {data.lastCodeChange && (
        <button type="button" className="agent-node__code-change-banner nodrag" onClick={() => onViewCodeChanges(data.lastCodeChange!)}>
          <span>
            {data.lastCodeChange.filesChanged} file{data.lastCodeChange.filesChanged === 1 ? "" : "s"} changed{" "}
            <span className="agent-node__code-change-stat">
              <span className="code-changes-view__add">+{data.lastCodeChange.insertions}</span>{" "}
              <span className="code-changes-view__remove">−{data.lastCodeChange.deletions}</span>
            </span>
          </span>
          <span className="agent-node__handoff-banner-action">
            <FileDiff size={12} />
            View changes
          </span>
        </button>
      )}

      <div className="agent-node__footer">
        <span className="agent-node__footer-cost">{formatCostLine(cost)}</span>
        <span className={`status-badge status-badge--${status}`}>{formatStatus(status)}</span>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
