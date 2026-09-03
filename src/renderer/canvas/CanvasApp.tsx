import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Activity,
  LayoutList,
  Plus,
  Save,
  Image,
  ImageOff,
  History,
  Trash2,
  Play,
  Square,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { AgentNode } from "./AgentNode";
import { NoteNode } from "./NoteNode";
import { CompareNode } from "./CompareNode";
import { AddNodePopover, buildCreatableNodeList, findNextNodeForShortcut } from "./AddNodePopover";
import { ConnectionInspector } from "./ConnectionInspector";
import { ApprovalSidebar } from "./ApprovalSidebar";
import { ActivityTimeline } from "./ActivityTimeline";
import { CostSummaryBar } from "./CostSummaryBar";
import { NodeOverview } from "./NodeOverview";
import { CommandBar } from "./CommandBar";
import { RunHistoryViewer } from "./RunHistoryViewer";
import { CodeChangesViewer } from "./CodeChangesViewer";
import { edgeVisualProps } from "./edgeStyle";
import { cycleEdgeKeys, findCycles } from "../../shared/graph";
import { validateWorkflow } from "../../shared/workflowValidation";
import { WorkflowValidationDialog } from "./WorkflowValidationDialog";
import { WorkflowSwitcher } from "./WorkflowSwitcher";
import {
  connectionRecordToTakoEdge,
  DEFAULT_AGENT_NODE_HEIGHT,
  DEFAULT_AGENT_NODE_WIDTH,
  duplicateSnapshotWithFreshIds,
  hasPendingHandoffForEdge,
  isAgentNode,
  nodeDisplayName,
  nodeRecordToTakoNode,
  takoEdgeToConnectionRecord,
  takoNodeToNodeRecord,
  pendingHandoffCountForNode,
  removePendingHandoffsForNode,
  serializeWorkflowContent,
  type AgentNodeData,
  type CompareNodeData,
  type NoteNodeData,
  type TakoEdge,
  type TakoNode,
} from "./types";
import {
  DEFAULT_WORKFLOW_ID,
  type AdapterKind,
  type AdapterManifestSummary,
  type ConnectionRecord,
  type CodeChangeEvent,
  type CodeChangeSummaryRow,
  type CostSummary,
  type HandoffSummary,
  type NodeKind,
  type NodeRecord,
  type RuntimeHandoff,
  type WorkflowRunState,
  type WorkflowRuntimeEvent,
  type WorkflowSnapshot,
} from "../../shared/types";
import { DEFAULT_BACKGROUND_IMAGE } from "./defaultBackground";
import { APP_ICON } from "./appIcon";

const DEFAULT_WORKFLOW_NAME = "My Workflow";
const BACKGROUND_IMAGE_STORAGE_KEY = "tako:canvasBackgroundImage";
const ACTIVE_WORKFLOW_STORAGE_KEY = "tako:activeWorkflowId";

export function CanvasApp() {
  const [nodes, setNodes] = useState<TakoNode[]>([]);
  const [edges, setEdges] = useState<TakoEdge[]>([]);
  const [showAddNode, setShowAddNode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Same viewer RunHistoryViewer already uses internally — one
  // implementation, two entry points (agent node, Run History).
  const [viewingCodeChange, setViewingCodeChange] = useState<CodeChangeEvent | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [workflowRunState, setWorkflowRunState] = useState<WorkflowRunState>("idle");
  const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null);
  const [runtimeHandoffs, setRuntimeHandoffs] = useState<RuntimeHandoff[]>([]);
  const [activeHandoffEdgeKeys, setActiveHandoffEdgeKeys] = useState<Set<string>>(new Set());
  // Single source of truth for real handoff state (docs/07-architecture.md
  // §9) — ApprovalSidebar, the per-node "Review handoff" affordance, and
  // the per-edge "ready to hand off" label all read from this one list
  // instead of each keeping their own copy of the same IPC events.
  const [pendingHandoffs, setPendingHandoffs] = useState<HandoffSummary[]>([]);
  const [recentlyResolvedHandoffs, setRecentlyResolvedHandoffs] = useState<HandoffSummary[]>([]);
  const [hopLimitWarning, setHopLimitWarning] = useState(false);
  const [approvalExpanded, setApprovalExpanded] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [runtimeEvents, setRuntimeEvents] = useState<WorkflowRuntimeEvent[]>([]);
  // Single source of truth for cost/usage, same idea as pendingHandoffs
  // above — CostSummaryBar, every AgentNode's own footer, and the Node
  // Overview all read this one value instead of each independently
  // subscribing to costs.onUpdated (previously N+1 identical subscriptions
  // for N mounted agent nodes).
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  // Same "never chosen" vs. real-value distinction as backgroundImage below
  // — a fresh install has no last-selected workflow yet, so it falls back
  // to the same bootstrap identity the single-workflow app always used.
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_WORKFLOW_STORAGE_KEY) ?? DEFAULT_WORKFLOW_ID;
    } catch {
      return DEFAULT_WORKFLOW_ID;
    }
  });
  const [activeWorkflowName, setActiveWorkflowName] = useState(DEFAULT_WORKFLOW_NAME);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [adapters, setAdapters] = useState<AdapterManifestSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.tako.adapters
      .list()
      .then((list) => {
        if (!cancelled) setAdapters(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showAddNode]);

  const availableAgentTypes = useMemo(
    () => new Set(adapters.filter((a) => a.installed || a.agentType === "bash").map((a) => a.agentType)),
    [adapters],
  );
  // The workflow's exact content (positions/names/config/connections—never
  // status/output/session state) as of the last successful save or load.
  // Comparing this against the live canvas below is the whole unsaved-
  // changes mechanism — no separate dirty flag to keep in sync by hand.
  const [savedSnapshot, setSavedSnapshot] = useState(() => serializeWorkflowContent([], []));
  // Structural content only (see serializeWorkflowContent) — a node's
  // status/output/session changing constantly while it runs never touches
  // this, only real edits (add/remove/move/rename/connect/config) do.
  const isDirty = useMemo(
    () => serializeWorkflowContent(nodes.map(takoNodeToNodeRecord), edges.map(takoEdgeToConnectionRecord)) !== savedSnapshot,
    [nodes, edges, savedSnapshot],
  );
  const [backgroundImage, setBackgroundImage] = useState<string | null>(() => {
    try {
      // Distinguish "never chosen" (falls back to the shipped default) from
      // "explicitly cleared" (stored as "" — stays blank, even after
      // localStorage.getItem would otherwise look identical to unset).
      const stored = localStorage.getItem(BACKGROUND_IMAGE_STORAGE_KEY);
      if (stored === null) return DEFAULT_BACKGROUND_IMAGE;
      return stored === "" ? null : stored;
    } catch {
      return DEFAULT_BACKGROUND_IMAGE;
    }
  });
  const backgroundFileInputRef = useRef<HTMLInputElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<TakoNode, TakoEdge> | null>(null);
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);

  // Every load goes through here — the initial boot restore, a workflow
  // switch, and "New Workflow" (which loads an id with no row yet, so it
  // just clears the canvas). Pins the main process's active-workflow
  // pointer too (workflows:load's own handler), so nodes:create/
  // connections:create/new runs all attribute to the right workflow from
  // here on.
  // Resets the unsaved-changes baseline to exactly what's now on disk —
  // called after every successful load and every successful save, the two
  // moments the canvas and the saved workflow are guaranteed to match.
  const markSaved = useCallback((nodeRecords: NodeRecord[], connectionRecords: ConnectionRecord[]) => {
    setSavedSnapshot(serializeWorkflowContent(nodeRecords, connectionRecords));
  }, []);

  const loadFromDisk = useCallback(async (workflowId: string): Promise<WorkflowSnapshot | null> => {
    const snapshot = await window.tako.workflows.load(workflowId);
    if (!snapshot) {
      setNodes([]);
      setEdges([]);
      markSaved([], []);
      return null;
    }

    const restoredNodes = snapshot.nodes.map(nodeRecordToTakoNode);
    setNodes(restoredNodes);
    setEdges(snapshot.connections.map(connectionRecordToTakoEdge));
    // Loaded nodes have no running process yet — Node Manager's registry is
    // empty on every fresh launch — so every agent node is auto-started
    // here, same as a brand-new one. start() resumes the persisted session
    // (same profile, same session id) and replays its real prior output;
    // it never sends the agent any input on its own (see NodeManager.
    // startNode/sendInput — starting and sending are always two separate
    // calls), so a resumed node just sits idle at its real CLI prompt,
    // exactly as if the user had reopened a real terminal, until they
    // actually type something.
    for (const node of restoredNodes) {
      if (!isAgentNode(node)) continue;
      void window.tako.nodes
        .start(node.id, node.data.agentType, node.data.workingDirectory, node.data.config)
        .then((resolvedDirectory) => updateAgentNodeData(node.id, { workingDirectory: resolvedDirectory }))
        .catch(() => {
          /* surfaced via node:error / node:statusChanged already */
        });
    }

    // Fit the whole restored workflow into view exactly once, right after
    // load — never again on a later add (see handleAddNode), which used to
    // re-fit the entire canvas and yank the camera away from wherever the
    // user currently was. One frame so React Flow has actually measured
    // the newly-rendered nodes before computing bounds.
    if (restoredNodes.length > 0) {
      requestAnimationFrame(() => reactFlowRef.current?.fitView({ padding: 0.3, duration: 300 }));
    }
    markSaved(snapshot.nodes, snapshot.connections);
    return snapshot;
  }, [markSaved]);

  // Restore the exact canvas state after restart — whichever workflow was
  // last selected (activeWorkflowId's own initial state already resolved
  // that from localStorage), not always the bootstrap default.
  useEffect(() => {
    void loadFromDisk(activeWorkflowId).then((snapshot) => {
      if (snapshot) setActiveWorkflowName(snapshot.name);
    });
    // Deliberately once, with whatever activeWorkflowId was at mount —
    // switching later goes through handleSwitchWorkflow, never this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global subscriptions — node status/errors are runtime (NodeSession)
  // state, never part of the persisted node record (docs/07-architecture.md §6).
  // They live on the node's own `data` (not a separate side dictionary) so
  // React Flow's per-node memoization sees a real prop change and actually
  // re-renders that node — a dictionary kept outside `nodes` never
  // triggers React Flow's own node wrapper to update at all.
  const updateAgentNodeData = useCallback((nodeId: string, patch: Partial<AgentNodeData>) => {
    setNodes((current) =>
      current.map((n) => (n.id === nodeId && isAgentNode(n) ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }, []);

  useEffect(() => {
    const unsubStatus = window.tako.nodes.onStatusChanged(({ nodeId, status }) => {
      // A stale error would otherwise keep showing after a successful restart.
      // lastActivityAt is set only here and in onError — never from
      // node:outputChunk, which fires per PTY byte-chunk (see AgentNode
      // Overview's own note in types.ts).
      updateAgentNodeData(
        nodeId,
        status === "error"
          ? { status, lastActivityAt: Date.now() }
          : { status, error: null, lastActivityAt: Date.now() },
      );
    });
    const unsubError = window.tako.nodes.onError(({ nodeId, error }) => {
      updateAgentNodeData(nodeId, { error, lastActivityAt: Date.now() });
    });
    // Code Workspace v2's agent-node "View changes" affordance — a real,
    // non-empty code change just got recorded for this node. Summary only
    // (no diff text); the full detail is fetched lazily only if the user
    // actually opens the viewer, exactly like Run History's own "View
    // changes" already does.
    const unsubCodeChange = window.tako.codeChanges.onRecorded((summary) => {
      updateAgentNodeData(summary.nodeId, { lastCodeChange: summary });
    });
    return () => {
      unsubStatus();
      unsubError();
      unsubCodeChange();
    };
  }, [updateAgentNodeData]);

  // Subscribe to canonical WorkflowRuntime events emitted from the main process.
  // Updates real NodeRun statuses, WorkflowRun states, and live handoff animations.
  useEffect(() => {
    const unsubRuntime = window.tako.runtime.onEvent((event: WorkflowRuntimeEvent) => {
      // Ignore events for other workflows if activeWorkflowId is set
      if (event.workflowId && event.workflowId !== activeWorkflowId) {
        if (event.executionId !== currentExecutionId) return;
      }

      setRuntimeEvents((cur) => [...cur, event]);

      switch (event.type) {
        case "WORKFLOW_STARTED":
          setCurrentExecutionId(event.executionId);
          setWorkflowRunState("running");
          setRuntimeHandoffs([]);
          setActiveHandoffEdgeKeys(new Set());
          break;

        case "NODE_QUEUED":
          updateAgentNodeData(event.nodeId, { status: "queued", lastActivityAt: event.timestamp });
          break;

        case "NODE_STARTED":
          updateAgentNodeData(event.nodeId, { status: "running", error: null, lastActivityAt: event.timestamp });
          break;

        case "NODE_OUTPUT":
          updateAgentNodeData(event.nodeId, { lastActivityAt: event.timestamp });
          break;

        case "NODE_COMPLETED":
          updateAgentNodeData(event.nodeId, { status: "completed", lastActivityAt: event.timestamp });
          break;

        case "NODE_FAILED":
          updateAgentNodeData(event.nodeId, {
            status: "failed",
            error: { kind: "crash", message: event.error.message, recoverable: event.error.recoverable ?? true },
            lastActivityAt: event.timestamp,
          });
          break;

        case "NODE_CANCELLED":
          updateAgentNodeData(event.nodeId, { status: "cancelled", lastActivityAt: event.timestamp });
          break;

        case "HANDOFF_CREATED":
          setRuntimeHandoffs((current) => [...current, event.handoff]);
          const createdKey = `${event.handoff.fromNodeId}>${event.handoff.toNodeId}`;
          setActiveHandoffEdgeKeys((current) => new Set([...current, createdKey]));
          break;

        case "HANDOFF_DELIVERED":
          setRuntimeHandoffs((current) =>
            current.map((h) => (h.id === event.handoffId ? { ...h, status: "delivered" } : h)),
          );
          setTimeout(() => {
            setActiveHandoffEdgeKeys((current) => {
              const next = new Set(current);
              next.delete(`${event.toNodeId}`);
              return next;
            });
          }, 1500);
          break;

        case "WORKFLOW_COMPLETED":
          setWorkflowRunState("completed");
          setActiveHandoffEdgeKeys(new Set());
          break;

        case "WORKFLOW_FAILED":
          setWorkflowRunState("failed");
          setActiveHandoffEdgeKeys(new Set());
          break;

        case "WORKFLOW_CANCELLED":
          setWorkflowRunState("cancelled");
          setActiveHandoffEdgeKeys(new Set());
          break;
      }
    });

    return () => {
      unsubRuntime();
    };
  }, [activeWorkflowId, currentExecutionId, updateAgentNodeData]);

  // The only place any of this fires from — a connection existing on the
  // canvas never implies a handoff; only these real HandoffEngine events do
  // (docs/07-architecture.md §9). Auto-approved handoffs never reach
  // "pending" at all (HandoffEngine.proposeForOutgoing approves them
  // immediately), so they never appear here — nothing to leave stale.
  useEffect(() => {
    void window.tako.handoffs.listPending().then(setPendingHandoffs);

    const unsubPending = window.tako.handoffs.onPending((handoff) => {
      setPendingHandoffs((current) => [...current, handoff]);
    });
    const unsubResolved = window.tako.handoffs.onResolved((handoff) => {
      setPendingHandoffs((current) => current.filter((h) => h.id !== handoff.id));
      setRecentlyResolvedHandoffs((current) => [handoff, ...current].slice(0, 5));
    });
    const unsubHopLimit = window.tako.handoffs.onHopLimitReached(() => setHopLimitWarning(true));

    return () => {
      unsubPending();
      unsubResolved();
      unsubHopLimit();
    };
  }, []);

  // Lifted from CostSummaryBar/AgentNode — one fetch to populate, then
  // every update after that reads the event's own payload, no re-fetch.
  useEffect(() => {
    void window.tako.costs.getSummary().then(setCostSummary);
    return window.tako.costs.onUpdated(setCostSummary);
  }, []);

  // Nothing left to review — collapse back to the badge rather than leave
  // an empty panel open.
  useEffect(() => {
    if (pendingHandoffs.length === 0 && !hopLimitWarning) setApprovalExpanded(false);
  }, [pendingHandoffs.length, hopLimitWarning]);

  const handleHandoffPayloadChange = useCallback((handoffId: string, text: string) => {
    setPendingHandoffs((current) =>
      current.map((h) => (h.id === handoffId ? { ...h, payloadText: text, edited: true } : h)),
    );
    void window.tako.handoffs.edit(handoffId, text);
  }, []);

  // Opens the existing approval surface — a node's own "Review handoff"
  // button and CanvasApp's collapsed badge both lead here, never a second
  // review UI.
  const handleReviewHandoffs = useCallback(() => setApprovalExpanded(true), []);

  // The node only ever holds the lightweight summary (see AgentNodeData
  // above); CodeChangesViewer itself fetches the actual diff detail lazily
  // on open, exactly as it already does from Run History.
  const handleViewCodeChanges = useCallback(
    (summary: CodeChangeSummaryRow) => {
      // The live broadcast (NodeManager) never sets nodeName — it only
      // tracks agentType, not the canvas-level name — so it's resolved
      // here instead, from the node's own current live name.
      const node = nodes.find((n) => n.id === summary.nodeId);
      const nodeName = node && isAgentNode(node) ? node.data.name : undefined;
      setViewingCodeChange({ ...summary, nodeName: summary.nodeName ?? nodeName, kind: "code_change" });
    },
    [nodes],
  );

  // Never a fake/no-op success: skips the write entirely (and the caller's
  // button reflects this by disabling itself, see the dock button below)
  // when the canvas already matches what's on disk — not "write anyway,
  // just don't tell the user."
  const saveToDisk = useCallback(async () => {
    if (!isDirty) return;
    const nodeRecords = nodes.map(takoNodeToNodeRecord);
    const connectionRecords = edges.map(takoEdgeToConnectionRecord);
    await window.tako.workflows.save({ id: activeWorkflowId, name: activeWorkflowName, nodes: nodeRecords, connections: connectionRecords });
    markSaved(nodeRecords, connectionRecords);
  }, [nodes, edges, activeWorkflowId, activeWorkflowName, isDirty, markSaved]);

  // Same defensive try/catch as clearBackgroundImage below — a full write
  // failure just means the choice doesn't survive a restart, not a crash.
  const setActiveWorkflow = useCallback((id: string, name: string) => {
    setActiveWorkflowId(id);
    setActiveWorkflowName(name);
    try {
      localStorage.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  // Shared by every handler that leaves the current workflow (switch, new,
  // deleting the active one) — stops each agent's live process/session
  // (persisting its final snapshot exactly like a normal Stop) without
  // deleting the node itself, so the OLD workflow's own saved state is
  // untouched and nothing from it keeps running against whatever loads
  // next.
  const stopRunningAgents = useCallback(async (current: TakoNode[]) => {
    await Promise.all(
      current
        .filter(isAgentNode)
        .map((n) => window.tako.nodes.stop(n.id).catch(() => {
          /* already stopped/never started — nothing to do */
        })),
    );
  }, []);

  // Re-derives everything that's scoped to "whichever workflow is active"
  // right after that changes, so the Approval Sidebar/cost bar never keep
  // showing a previous workflow's pending handoffs or totals until some
  // unrelated event happens to overwrite them. listPending() is itself
  // scoped server-side to the active workflow (workflowsRepo.getActiveWorkflowId,
  // pinned by the workflows:load call loadFromDisk already makes) — this
  // just makes sure the renderer actually re-asks after that pin moves.
  const resetWorkflowScopedUiState = useCallback(() => {
    setRecentlyResolvedHandoffs([]);
    setHopLimitWarning(false);
    setWorkflowRunState("idle");
    setCurrentExecutionId(null);
    setRuntimeHandoffs([]);
    setRuntimeEvents([]);
    setActiveHandoffEdgeKeys(new Set());
    setShowActivity(false);
    void window.tako.handoffs.listPending().then(setPendingHandoffs);
    void window.tako.costs.getSummary().then(setCostSummary);
  }, []);

  const handleRunWorkflow = useCallback(async () => {
    if (workflowRunState === "running") return;

    const nodeRecords = nodes.map(takoNodeToNodeRecord);
    const connectionRecords = edges.map(takoEdgeToConnectionRecord);

    const installedAgentTypes = new Set(adapters.filter((a) => a.installed || a.agentType === "bash").map((a) => a.agentType));
    const validation = validateWorkflow(
      {
        id: activeWorkflowId,
        name: activeWorkflowName,
        nodes: nodeRecords,
        connections: connectionRecords,
      },
      { installedAgentTypes },
    );

    if (!validation.valid) {
      setValidationErrors(validation.errors);
      setValidationWarnings(validation.warnings);
      return;
    }

    setValidationErrors(null);
    setValidationWarnings([]);
    setWorkflowRunState("running");
    setRuntimeHandoffs([]);
    setRuntimeEvents([]);
    setActiveHandoffEdgeKeys(new Set());

    try {
      await window.tako.runtime.start({
        id: activeWorkflowId,
        name: activeWorkflowName,
        nodes: nodeRecords,
        connections: connectionRecords,
      });
    } catch (err) {
      console.error("Failed to start workflow run", err);
      setWorkflowRunState("failed");
    }
  }, [workflowRunState, nodes, edges, adapters, activeWorkflowId, activeWorkflowName]);

  const handleStopWorkflow = useCallback(async () => {
    if (currentExecutionId) {
      await window.tako.runtime.cancel(currentExecutionId);
    }
    setWorkflowRunState("cancelled");
    await stopRunningAgents(nodes);
  }, [currentExecutionId, nodes, stopRunningAgents]);

  const handleRetryNode = useCallback(
    async (nodeId?: string) => {
      const targetId =
        nodeId ?? nodes.find((n) => isAgentNode(n) && (n.data.status === "failed" || Boolean(n.data.error)))?.id;
      if (!targetId) return;

      let execId = currentExecutionId;
      if (!execId) {
        // Look up latest run for this workflow if currentExecutionId not set in session
        try {
          const runs = await window.tako.runtime.listRuns(activeWorkflowId);
          if (runs.length > 0) execId = runs[0].executionId;
        } catch {
          // ignore
        }
      }

      if (!execId) {
        console.warn("No executionId available to retry node", targetId);
        return;
      }

      setWorkflowRunState("running");
      updateAgentNodeData(targetId, { status: "running", error: null });

      try {
        await window.tako.runtime.retry(execId, targetId);
      } catch (err) {
        console.error("Retry node failed", err);
        updateAgentNodeData(targetId, {
          status: "failed",
          error: { kind: "crash", message: (err as Error).message || "Retry failed", recoverable: true },
        });
      }
    },
    [currentExecutionId, activeWorkflowId, nodes, updateAgentNodeData],
  );

  // Unsaved edits would otherwise be silently discarded the moment any of
  // these three run (none of them save first) — same confirm() pattern
  // already used for Delete, not a new dialog system.
  const confirmDiscardUnsavedChanges = useCallback(() => {
    return !isDirty || confirm("You have unsaved changes.\n\nDiscard them and continue?");
  }, [isDirty]);

  const handleSwitchWorkflow = useCallback(
    async (id: string) => {
      if (!confirmDiscardUnsavedChanges()) return;
      await stopRunningAgents(nodes);
      setSelectedEdgeId(null);
      const snapshot = await loadFromDisk(id);
      setActiveWorkflow(id, snapshot?.name ?? DEFAULT_WORKFLOW_NAME);
      resetWorkflowScopedUiState();
    },
    [nodes, stopRunningAgents, loadFromDisk, setActiveWorkflow, confirmDiscardUnsavedChanges, resetWorkflowScopedUiState],
  );

  const handleNewWorkflow = useCallback(
    async (name: string) => {
      if (!confirmDiscardUnsavedChanges()) return;
      await stopRunningAgents(nodes);
      const id = crypto.randomUUID();
      // No row exists for a brand-new id (same as a first-ever launch) —
      // still worth calling: it pins the main process's active-workflow
      // pointer and resets the connection graph to empty, same as any load.
      await window.tako.workflows.load(id);
      setNodes([]);
      setEdges([]);
      setSelectedEdgeId(null);
      setActiveWorkflow(id, name);
      markSaved([], []);
      resetWorkflowScopedUiState();
      reactFlowRef.current?.setCenter(0, 0, { zoom: 1 });
    },
    [nodes, stopRunningAgents, setActiveWorkflow, confirmDiscardUnsavedChanges, markSaved, resetWorkflowScopedUiState],
  );

  // Duplicates the CURRENT canvas under a new saved identity, then switches
  // to it — matching native "Save As" (you end up editing the new file, the
  // original is left exactly as it was on disk). Safe to jump straight to
  // it despite the fresh ids: loadFromDisk always starts every restored
  // agent node fresh regardless of workflow, the same as any other switch.
  const handleSaveAs = useCallback(
    async (name: string) => {
      const { nodes: dupNodes, connections: dupConnections } = duplicateSnapshotWithFreshIds(
        nodes.map(takoNodeToNodeRecord),
        edges.map(takoEdgeToConnectionRecord),
      );
      const newId = crypto.randomUUID();
      await window.tako.workflows.save({ id: newId, name, nodes: dupNodes, connections: dupConnections });
      await stopRunningAgents(nodes);
      setSelectedEdgeId(null);
      const snapshot = await loadFromDisk(newId);
      setActiveWorkflow(newId, snapshot?.name ?? name);
      resetWorkflowScopedUiState();
    },
    [nodes, edges, stopRunningAgents, loadFromDisk, setActiveWorkflow, resetWorkflowScopedUiState],
  );

  const handleRenameWorkflow = useCallback(
    async (name: string) => {
      await window.tako.workflows.rename(activeWorkflowId, name);
      setActiveWorkflowName(name);
    },
    [activeWorkflowId],
  );

  const handleDeleteWorkflow = useCallback(
    async (id: string, name: string) => {
      // One dialog, not two: deleting the active workflow already discards
      // whatever isn't saved (nothing here saves first), so that risk is
      // folded into the same confirmation rather than stacked as a second
      // "unsaved changes" prompt right after this one.
      const deletingActiveWithUnsavedChanges = id === activeWorkflowId && isDirty;
      const message = `Delete "${name}"? This permanently removes its nodes, connections, and history. This cannot be undone.${
        deletingActiveWithUnsavedChanges ? "\n\nYou also have unsaved changes on this workflow that will be lost." : ""
      }`;
      if (!confirm(message)) return;

      if (id !== activeWorkflowId) {
        await window.tako.workflows.remove(id);
        return;
      }

      await stopRunningAgents(nodes);
      await window.tako.workflows.remove(id);

      const remaining = await window.tako.workflows.list();
      if (remaining.length > 0) {
        const snapshot = await loadFromDisk(remaining[0].id);
        setActiveWorkflow(remaining[0].id, snapshot?.name ?? remaining[0].name);
      } else {
        // Nothing left — same empty-canvas bootstrap as a first-ever launch.
        const freshId = crypto.randomUUID();
        await window.tako.workflows.load(freshId);
        setNodes([]);
        setEdges([]);
        setActiveWorkflow(freshId, DEFAULT_WORKFLOW_NAME);
        markSaved([], []);
      }
      setSelectedEdgeId(null);
      resetWorkflowScopedUiState();
    },
    [activeWorkflowId, nodes, isDirty, stopRunningAgents, loadFromDisk, setActiveWorkflow, markSaved, resetWorkflowScopedUiState],
  );

  const onNodesChange = useCallback((changes: NodeChange<TakoNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<TakoEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return; // no self-loops

    setEdges((current) => {
      const duplicate = current.some(
        (e) => e.source === connection.source && e.target === connection.target,
      );
      if (duplicate) return current;

      const newEdge: TakoEdge = {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        data: { autoApprove: false },
        ...edgeVisualProps(false),
      };
      void window.tako.connections.create({
        id: newEdge.id,
        fromNodeId: newEdge.source,
        toNodeId: newEdge.target,
        autoApprove: false,
      });
      return addEdge(newEdge, current);
    });
  }, []);

  // Returns the new node's id synchronously (generated before any state
  // update or IPC call, same as before -- just no longer hidden inside the
  // setNodes updater) so a multi-step command bar batch can reference a
  // node it just created by name in a later step of the same command.
  const handleAddNode = useCallback(
    (input: {
      name: string;
      kind: NodeKind;
      agentType: string;
      adapterKind: AdapterKind;
      workingDirectory: string | null;
      // Only set by the command bar's "duplicate this" resolution — every
      // other caller (Add Node popover, plain addNode command) omits both
      // and gets exactly the existing auto-placement/blank-config behavior.
      config?: Record<string, unknown>;
      position?: { x: number; y: number };
    }): string => {
      const id = crypto.randomUUID();
      setNodes((current) => {
        // Center of whatever the user is actually looking at right now —
        // not a fixed canvas-space point — so a new node never lands
        // off-screen from wherever they've panned/zoomed to. Each
        // successive node in the same batch gets a small staggered offset
        // so they fan out instead of stacking exactly on top of each other.
        const stagger = 40 * (current.length % 6);
        let position = input.position ?? { x: 120 + stagger, y: 120 + stagger };
        const instance = reactFlowRef.current;
        const wrapper = flowWrapperRef.current;
        if (!input.position && instance && wrapper) {
          const rect = wrapper.getBoundingClientRect();
          const center = instance.screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
          position = { x: center.x - 150 + stagger, y: center.y - 100 + stagger };
        }
        const initialConfig = input.config ?? {};
        const newNode: TakoNode =
          input.kind === "note"
            ? { id, type: "noteNode", position, data: { name: input.name, config: { text: "" } } }
            : input.kind === "compare"
              ? { id, type: "compareNode", position, data: { name: input.name, config: { prompt: "" } } }
              : {
                  id,
                  type: "agentNode",
                  position,
                  width: DEFAULT_AGENT_NODE_WIDTH,
                  height: DEFAULT_AGENT_NODE_HEIGHT,
                  data: {
                    name: input.name,
                    agentType: input.agentType,
                    adapterKind: input.adapterKind,
                    workingDirectory: input.workingDirectory,
                    config: initialConfig,
                    status: "not_started",
                    error: null,
                    lastActivityAt: null,
                    lastCodeChange: null,
                  },
                };
        void window.tako.nodes.create(takoNodeToNodeRecord(newNode));
        // No "choose a folder first" gate — a terminal agent gets a real cwd
        // either way (NodeManager defaults to the home directory when none
        // was picked, same as opening a normal Terminal window); the actual
        // directory it started with comes back here once it's known.
        if (input.kind === "agent") {
          void window.tako.nodes
            .start(id, input.agentType, input.workingDirectory, initialConfig)
            .then((resolvedDirectory) => updateAgentNodeData(id, { workingDirectory: resolvedDirectory }))
            .catch(() => {
              /* surfaced via node:error / node:statusChanged already */
            });
        }
        return [...current, newNode];
      });
      setShowAddNode(false);
      return id;
    },
    [],
  );

  const handleClearAll = useCallback(() => {
    if (nodes.length === 0) return;
    if (!confirm("Clear all nodes? This stops every running agent and removes them from the canvas.")) return;
    for (const node of nodes) void window.tako.nodes.dispose(node.id);
    setNodes([]);
    setEdges([]);
    setSelectedEdgeId(null);
    // Only explicit event that should move the camera is emptying the
    // canvas entirely — adding a node deliberately does NOT re-fit the
    // whole view (see handleAddNode), since that used to yank the user's
    // current pan/zoom away to fit every node whenever one more was added.
    reactFlowRef.current?.setCenter(0, 0, { zoom: 1 });
  }, [nodes]);

  // Same local-state-only shape as handleNoteTextChange — name is a plain
  // NodeRecord field, already persisted by the next Save, no new IPC.
  const handleRenameNode = useCallback((nodeId: string, name: string) => {
    setNodes((current) =>
      current.map((n) => (n.id === nodeId && isAgentNode(n) ? { ...n, data: { ...n.data, name } } : n)),
    );
  }, []);

  const handleNoteTextChange = useCallback((nodeId: string, text: string) => {
    setNodes((current) =>
      current.map((n) =>
        n.id === nodeId && n.type === "noteNode"
          ? { ...n, data: { ...n.data, config: { ...(n.data as NoteNodeData).config, text } } }
          : n,
      ),
    );
  }, []);

  const handleSetTaskPrompt = useCallback((nodeId: string, prompt: string) => {
    setNodes((current) =>
      current.map((n) =>
        n.id === nodeId && isAgentNode(n)
          ? { ...n, data: { ...n.data, config: { ...n.data.config, prompt, taskPrompt: prompt } } }
          : n,
      ),
    );
  }, []);

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      const source = nodes.find((n) => n.id === nodeId);
      if (!source) return;
      const duplicateName = `${source.data.name || (isAgentNode(source) ? source.data.agentType : "Node")} Copy`;
      const newPos = { x: source.position.x + 40, y: source.position.y + 40 };

      if (isAgentNode(source)) {
        handleAddNode({
          name: duplicateName,
          kind: "agent",
          agentType: source.data.agentType,
          adapterKind: source.data.adapterKind,
          workingDirectory: source.data.workingDirectory,
          config: { ...source.data.config },
          position: newPos,
        });
      } else if (source.type === "noteNode") {
        handleAddNode({
          name: duplicateName,
          kind: "note",
          agentType: "note",
          adapterKind: "terminal",
          workingDirectory: null,
          config: { ...(source.data as NoteNodeData).config },
          position: newPos,
        });
      }
    },
    [nodes, handleAddNode],
  );

  const handleComparePromptChange = useCallback((nodeId: string, prompt: string) => {
    setNodes((current) =>
      current.map((n) =>
        n.id === nodeId && n.type === "compareNode"
          ? { ...n, data: { ...n.data, config: { ...(n.data as CompareNodeData).config, prompt } } }
          : n,
      ),
    );
  }, []);

  // The Compare Node has no adapter/session of its own — it just calls
  // straight into the same fan-out HandoffEngine already uses when a real
  // node finishes a turn (docs/07-architecture.md §21).
  const handleCompareSend = useCallback((nodeId: string, prompt: string) => {
    void window.tako.handoffs.sendFromNode(nodeId, prompt);
  }, []);

  const handleRemoveNode = useCallback((nodeId: string) => {
    void window.tako.nodes.dispose(nodeId); // clean process shutdown before it's forgotten
    setNodes((current) => current.filter((n) => n.id !== nodeId));
    setEdges((current) => current.filter((e) => e.source !== nodeId && e.target !== nodeId));
    // nodes:dispose's deleteNode() cascades any handoff row referencing this
    // node straight out of the DB (by design — "really delete" drops its
    // audit history too) but never broadcasts that, so without this the
    // Approval Sidebar keeps showing a stale card whose Approve/Reject
    // buttons silently no-op the moment they're clicked (the handoff row is
    // already gone). Drop it from view the same way its own row is gone.
    setPendingHandoffs((current) => removePendingHandoffsForNode(current, nodeId));
  }, []);

  const handleMarkDone = useCallback((nodeId: string) => {
    void window.tako.nodes.markDone(nodeId);
  }, []);

  // The toolbar's "Change Directory" action — stops the node, restarts it
  // with the newly picked directory as its cwd.
  const handleSetWorkingDirectory = useCallback((nodeId: string, directory: string) => {
    setNodes((current) => {
      const node = current.find((n) => n.id === nodeId);
      if (!node || !isAgentNode(node)) return current;
      const { agentType, config } = node.data;
      void (async () => {
        await window.tako.nodes.stop(nodeId);
        await window.tako.nodes.start(nodeId, agentType, directory, config).catch(() => {
          /* surfaced via node:error / node:statusChanged already */
        });
      })();
      return current.map((n) =>
        n.id === nodeId && isAgentNode(n) ? { ...n, data: { ...n.data, workingDirectory: directory } } : n,
      );
    });
  }, []);

  // Same shape as handleSetWorkingDirectory — an env var can't change on a
  // running process, so switching profiles is a real stop/restart with the
  // new config baked into the node's own persisted config (profileId), not
  // a separate field on the node record.
  const handleSetProfile = useCallback((nodeId: string, profileId: string) => {
    setNodes((current) => {
      const node = current.find((n) => n.id === nodeId);
      if (!node || !isAgentNode(node)) return current;
      const { agentType, workingDirectory, config } = node.data;
      const nextConfig = { ...config, profileId };
      void (async () => {
        await window.tako.nodes.stop(nodeId);
        await window.tako.nodes.start(nodeId, agentType, workingDirectory, nextConfig).catch(() => {
          /* surfaced via node:error / node:statusChanged already */
        });
      })();
      return current.map((n) =>
        n.id === nodeId && isAgentNode(n) ? { ...n, data: { ...n.data, config: nextConfig } } : n,
      );
    });
  }, []);

  // Same "can't change env vars on a running process" stop+restart shape
  // as handleSetProfile above, but the whole agent/adapter swaps here, not
  // just the config — so any profile tied to the OLD agent type is
  // dropped rather than kept (a Claude Code profile id means nothing to
  // Pi). Persisted the same way every other in-place node edit already is
  // (rename, setProfile, position): local state now, durable on the next
  // Save via saveWorkflow's existing upsert.
  const handleChangeAgentType = useCallback((nodeId: string, agentType: string, adapterKind: AdapterKind) => {
    setNodes((current) => {
      const node = current.find((n) => n.id === nodeId);
      if (!node || !isAgentNode(node)) return current;
      const { workingDirectory } = node.data;
      void (async () => {
        await window.tako.nodes.stop(nodeId);
        await window.tako.nodes.start(nodeId, agentType, workingDirectory, {}).catch(() => {
          /* surfaced via node:error / node:statusChanged already */
        });
      })();
      return current.map((n) =>
        n.id === nodeId && isAgentNode(n) ? { ...n, data: { ...n.data, agentType, adapterKind, config: {} } } : n,
      );
    });
  }, []);

  const handleToggleAutoApprove = useCallback((edgeId: string, value: boolean) => {
    setEdges((current) =>
      current.map((e) =>
        e.id === edgeId ? { ...e, data: { autoApprove: value }, ...edgeVisualProps(value) } : e,
      ),
    );
    void window.tako.connections.setAutoApprove(edgeId, value);
  }, []);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((e) => e.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
    void window.tako.connections.remove(edgeId);
  }, []);

  const handleBackgroundFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setBackgroundImage(dataUrl);
      try {
        localStorage.setItem(BACKGROUND_IMAGE_STORAGE_KEY, dataUrl);
      } catch {
        // localStorage full/unavailable — the image still applies for this session
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const clearBackgroundImage = useCallback(() => {
    setBackgroundImage(null);
    try {
      // "" (not removeItem) records an explicit choice to have no
      // background — removing the key would look identical to "never
      // chosen" on the next launch and bring the default image back.
      localStorage.setItem(BACKGROUND_IMAGE_STORAGE_KEY, "");
    } catch {
      // ignore
    }
  }, []);

  // React Flow remounts every custom node of a type whenever the `nodeTypes`
  // object reference changes — memoizing it on `nodes`/`edges`/`nodeStatuses`
  // meant it was recreated on nearly every event (any status change, any
  // React-Flow-internal node update), tearing down and rebuilding every
  // AgentTerminal's real xterm/PTY view each time. `nodeTypes` itself must
  // stay referentially stable; a ref holds whatever current data/callbacks
  // the renderer functions need instead.
  //
  // Status/error moved onto each node's own `data` (see updateAgentNodeData
  // above) specifically so this stability doesn't also break live status
  // display: React Flow wraps every node in its own memo() keyed on that
  // node's own props (id/data/selected), so a node only actually re-renders
  // when ITS OWN `data` changes — reading status from a side dictionary
  // here would update the ref, but React Flow would never know to call
  // this render function again.
  const latestRef = useRef({
    nodes,
    edges,
    pendingHandoffs,
    costSummary,
    availableAgentTypes,
    handleRemoveNode,
    handleMarkDone,
    handleSetWorkingDirectory,
    handleSetProfile,
    handleNoteTextChange,
    handleComparePromptChange,
    handleCompareSend,
    handleReviewHandoffs,
    handleViewCodeChanges,
    handleRetryNode,
    handleDuplicateNode,
    handleSetTaskPrompt,
  });
  latestRef.current = {
    nodes,
    edges,
    pendingHandoffs,
    costSummary,
    availableAgentTypes,
    handleRemoveNode,
    handleMarkDone,
    handleSetWorkingDirectory,
    handleSetProfile,
    handleNoteTextChange,
    handleComparePromptChange,
    handleCompareSend,
    handleReviewHandoffs,
    handleViewCodeChanges,
    handleRetryNode,
    handleDuplicateNode,
    handleSetTaskPrompt,
  };

  const nodeTypes = useMemo(
    () => ({
      agentNode: (props: NodeProps) => {
        const {
          pendingHandoffs,
          costSummary,
          availableAgentTypes,
          handleRemoveNode,
          handleMarkDone,
          handleRetryNode,
          handleDuplicateNode,
          handleSetTaskPrompt,
          handleSetWorkingDirectory,
          handleSetProfile,
          handleReviewHandoffs,
          handleViewCodeChanges,
        } = latestRef.current;
        const data = props.data as AgentNodeData;
        const pendingFromThisNode = pendingHandoffCountForNode(pendingHandoffs, props.id);
        const cost = costSummary?.perNode.find((n) => n.nodeId === props.id) ?? null;
        return (
          <AgentNode
            id={props.id}
            data={data}
            status={data.status}
            error={data.error}
            selected={Boolean(props.selected)}
            isAvailable={availableAgentTypes.has(data.agentType) || data.agentType === "bash"}
            pendingHandoffCount={pendingFromThisNode}
            cost={cost}
            onRemove={handleRemoveNode}
            onMarkDone={handleMarkDone}
            onRetry={handleRetryNode}
            onDuplicate={handleDuplicateNode}
            onSetTaskPrompt={handleSetTaskPrompt}
            onSetWorkingDirectory={handleSetWorkingDirectory}
            onSetProfile={handleSetProfile}
            onReviewHandoffs={handleReviewHandoffs}
            onViewCodeChanges={handleViewCodeChanges}
          />
        );
      },
      noteNode: (props: NodeProps) => {
        const { handleNoteTextChange, handleRemoveNode } = latestRef.current;
        return (
          <NoteNode
            id={props.id}
            data={props.data as NoteNodeData}
            onTextChange={handleNoteTextChange}
            onRemove={handleRemoveNode}
          />
        );
      },
      compareNode: (props: NodeProps) => {
        const { nodes, edges, handleComparePromptChange, handleCompareSend, handleRemoveNode } = latestRef.current;
        // Note: same caveat as the general nodeTypes-stability comment
        // above — since this Compare node's own `data`/`id` don't change
        // when a *target* agent's status changes, React Flow may not
        // re-invoke this renderer immediately when a connected node's
        // status updates. Not fixed here (no report of it being wrong in
        // practice); flagging in case a live column ever looks stale.
        const targets = edges
          .filter((e) => e.source === props.id)
          .map((e) => nodes.find((n) => n.id === e.target))
          .filter((n): n is NonNullable<typeof n> => Boolean(n) && isAgentNode(n!))
          .map((n) => ({
            id: n.id,
            name: nodeDisplayName((n.data as AgentNodeData).name, (n.data as AgentNodeData).agentType),
            agentType: (n.data as AgentNodeData).agentType,
            status: (n.data as AgentNodeData).status,
          }));
        return (
          <CompareNode
            id={props.id}
            data={props.data as CompareNodeData}
            targets={targets}
            onPromptChange={handleComparePromptChange}
            onSend={handleCompareSend}
            onRemove={handleRemoveNode}
          />
        );
      },
    }),
    [],
  );

  const nodeLabel = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return nodeId;
      return isAgentNode(node) ? nodeDisplayName(node.data.name, node.data.agentType) : node.data.name;
    },
    [nodes],
  );

  // Node Overview's "click a row" behavior — React Flow's own fitView
  // already supports centering on one specific node by id, no custom
  // camera math needed.
  const focusNode = useCallback((nodeId: string) => {
    setNodes((current) =>
      current.map((n) => ({
        ...n,
        selected: n.id === nodeId,
      })),
    );
    reactFlowRef.current?.fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.5 });
  }, []);

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  // React Flow already tracks .selected on each node via applyNodeChanges —
  // no new state/subscription. More than one selected node is exactly as
  // "no valid context" as zero, for the command bar's "it"/"this node".
  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedNodeId = selectedNodes.length === 1 ? selectedNodes[0].id : null;

  // Global keyboard shortcuts from the canvas:
  // When Add Node palette is CLOSED:
  // - Cmd/Ctrl+D: Duplicates the selected node
  // - Agent shortcut (e.g. C, A, P, T, N): focuses and selects an EXISTING node of that type on canvas.
  // NEVER creates a new node without explicit user intent.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showAddNode) return;

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest(".command-bar") ||
          target.closest(".workflow-switcher__dialog") ||
          target.closest(".monaco-editor"));

      if (isInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        if (selectedNodeId) {
          e.preventDefault();
          handleDuplicateNode(selectedNodeId);
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const creatableList = buildCreatableNodeList(adapters);
      const targetNode = findNextNodeForShortcut(e.key, nodes, creatableList, selectedNodeId);
      if (targetNode) {
        e.preventDefault();
        focusNode(targetNode.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAddNode, adapters, nodes, selectedNodeId, focusNode, handleDuplicateNode]);

  // Non-blocking cycle warning (ADR-0005) — cycles are allowed by design;
  // this is purely informational, never prevents drawing or saving a
  // connection. Recomputed from the live edge list, so it's accurate on
  // load, after every connect, and after every delete, not just on save.
  const graphEdges = useMemo(() => edges.map((e) => ({ from: e.source, to: e.target })), [edges]);
  const cyclesInGraph = useMemo(() => findCycles(graphEdges), [graphEdges]);
  const edgesInCycle = useMemo(() => cycleEdgeKeys(graphEdges), [graphEdges]);
  // A connection animates only while its source node is actually working —
  // "data is moving" reuses React Flow's own built-in animated-dash edge,
  // not a custom effect.
  // O(N+E) instead of an O(N) nodes.find() per edge — at 50 nodes/50
  // edges this whole map reruns on every single status broadcast (any
  // node starting/working/idle), so the per-edge lookup cost multiplies
  // by how often that fires, not just by edge count.
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const runningNodesCount = useMemo(
    () => nodes.filter(isAgentNode).filter((n) => n.data.status === "running" || n.data.status === "working").length,
    [nodes],
  );

  const renderedEdges = useMemo(
    () =>
      edges.map((edge): TakoEdge => {
        const source = nodesById.get(edge.source);
        const edgeKey = `${edge.source}>${edge.target}`;
        const isHandoffActive = activeHandoffEdgeKeys.has(edgeKey);
        const sourceWorking = Boolean(source && isAgentNode(source) && (source.data.status === "working" || source.data.status === "running"));
        const inCycle = edgesInCycle.has(edgeKey);
        const hasPendingHandoff = hasPendingHandoffForEdge(pendingHandoffs, edge.source, edge.target);

        return {
          ...edge,
          animated: isHandoffActive || sourceWorking,
          label: hasPendingHandoff ? "Ready to hand off" : isHandoffActive ? "Handoff in progress…" : undefined,
          style: isHandoffActive
            ? { ...edge.style, stroke: "#38bdf8", strokeWidth: 2.5 }
            : inCycle
              ? { ...edge.style, stroke: "#f59e0b" }
              : hasPendingHandoff
                ? { ...edge.style, stroke: "#facc15", strokeWidth: 2.5 }
                : edge.style,
        };
      }),
    [edges, edgesInCycle, nodesById, activeHandoffEdgeKeys, pendingHandoffs],
  );

  return (
    <div className="canvas-app">
      {backgroundImage && (
        <div className="canvas-app__bg-image" style={{ backgroundImage: `url(${backgroundImage})` }} />
      )}
      <nav className="dock" aria-label="Canvas actions">
        <div className="dock__item">
          <button
            type="button"
            className="dock__button dock__button--primary"
            aria-label="Add Node"
            data-tooltip="Add Node"
            onClick={() => setShowAddNode((current) => !current)}
          >
            <Plus size={18} strokeWidth={2} />
          </button>
          {showAddNode && <AddNodePopover onCreate={handleAddNode} onClose={() => setShowAddNode(false)} />}
        </div>
        <button
          type="button"
          className="dock__button"
          aria-label={isDirty ? "Save Workflow" : "All changes saved"}
          data-tooltip={isDirty ? "Save Workflow" : "All changes saved"}
          disabled={!isDirty}
          onClick={() => void saveToDisk()}
        >
          <Save size={18} strokeWidth={2} />
        </button>
        <span className="dock__divider" />
        <button
          type="button"
          className="dock__button"
          aria-label={backgroundImage ? "Change Background" : "Upload Background"}
          data-tooltip={backgroundImage ? "Change Background" : "Upload Background"}
          onClick={() => backgroundFileInputRef.current?.click()}
        >
          <Image size={18} strokeWidth={2} />
        </button>
        {backgroundImage && (
          <button
            type="button"
            className="dock__button"
            aria-label="Clear Background"
            data-tooltip="Clear Background"
            onClick={clearBackgroundImage}
          >
            <ImageOff size={18} strokeWidth={2} />
          </button>
        )}
        <span className="dock__divider" />
        <button
          type="button"
          className="dock__button"
          aria-label="Run History"
          data-tooltip="Run History"
          onClick={() => setShowHistory(true)}
        >
          <History size={18} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="dock__button"
          aria-label="Activity Timeline"
          data-tooltip="Activity Timeline"
          onClick={() => setShowActivity((v) => !v)}
        >
          <Activity size={18} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="dock__button"
          aria-label="Overview"
          data-tooltip="Overview"
          onClick={() => setShowOverview((v) => !v)}
        >
          <LayoutList size={18} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="dock__button"
          aria-label="Clear All Nodes"
          data-tooltip="Clear All Nodes"
          onClick={handleClearAll}
        >
          <Trash2 size={18} strokeWidth={2} />
        </button>
        <input
          ref={backgroundFileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleBackgroundFileChange}
        />
      </nav>

      <header className="workspace-header">
        <div className="workspace-header__brand">
          <img className="workspace-header__brand-mark" src={APP_ICON} alt="" />
          <span>Tako</span>
        </div>
        <span className="workspace-header__divider" />
        <WorkflowSwitcher
          activeId={activeWorkflowId}
          activeName={activeWorkflowName}
          isDirty={isDirty}
          onSwitch={(id) => void handleSwitchWorkflow(id)}
          onNew={(name) => void handleNewWorkflow(name)}
          onSaveAs={(name) => void handleSaveAs(name)}
          onRename={(name) => void handleRenameWorkflow(name)}
          onDelete={(id, name) => void handleDeleteWorkflow(id, name)}
        />
        <div className="workspace-header__status">
          {workflowRunState === "running" ? (
            <button
              type="button"
              className="workspace-header__btn workspace-header__btn--stop"
              onClick={() => void handleStopWorkflow()}
              title="Stop workflow execution"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="workspace-header__btn workspace-header__btn--run"
              onClick={() => void handleRunWorkflow()}
              title="Run workflow"
              disabled={nodes.length === 0}
            >
              <Play size={12} fill="currentColor" />
              Run
            </button>
          )}
          <span className={`status-pill status-pill--${workflowRunState}`}>
            {runningNodesCount} running
          </span>
          <span className="status-pill status-pill--cost">
            <CostSummaryBar nodeLabel={nodeLabel} summary={costSummary} />
          </span>
        </div>
      </header>

      <div className="canvas-app__body">
        <div className="canvas-app__flow" ref={flowWrapperRef}>
          {nodes.length === 0 && (
            <div className="canvas-empty-state">
              <Plus size={22} strokeWidth={1.5} />
              <p>Build your AI workspace</p>
              <span>Add an agent, connect your workers, and let Tako handle the handoff.</span>
              <button
                type="button"
                className="canvas-empty-state__cta"
                onClick={() => setShowAddNode(true)}
              >
                <Plus size={14} strokeWidth={2} />
                Add agent
              </button>
            </div>
          )}
          {cyclesInGraph.length > 0 && (
            <div
              className="cycle-badge"
              title="Cycles are allowed — this is informational only. The real safety net is the per-run hop limit, which forces manual approval if a loop of auto-approved connections would otherwise run forever."
            >
              ⚠ {cyclesInGraph.length} cycle{cyclesInGraph.length > 1 ? "s" : ""} in this workflow
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)}
            onPaneClick={() => setSelectedEdgeId(null)}
            onInit={(instance) => {
              reactFlowRef.current = instance;
              // Nodes haven't loaded yet at this point (loadFromDisk is
              // async) — its own effect fits the view once they have.
              instance.setCenter(0, 0, { zoom: 1 });
            }}
            proOptions={{ hideAttribution: true }}
          >
            {/* Dots stay visible over the custom image — Background renders
                only the dot pattern, no opaque fill. */}
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        <ApprovalSidebar
          nodeLabel={nodeLabel}
          pending={pendingHandoffs}
          recentlyResolved={recentlyResolvedHandoffs}
          runtimeHandoffs={runtimeHandoffs}
          hopLimitWarning={hopLimitWarning}
          expanded={approvalExpanded}
          onExpandedChange={setApprovalExpanded}
          onPayloadChange={handleHandoffPayloadChange}
        />
      </div>

      {showOverview && (
        <NodeOverview
          nodes={nodes}
          pendingHandoffs={pendingHandoffs}
          costSummary={costSummary}
          onFocusNode={focusNode}
          onClose={() => setShowOverview(false)}
        />
      )}

      {showActivity && (
        <ActivityTimeline
          events={runtimeEvents}
          nodeLabel={nodeLabel}
          onFocusNode={focusNode}
          onClose={() => setShowActivity(false)}
        />
      )}

      <CommandBar
        nodes={nodes}
        edges={edges}
        selectedNodeId={selectedNodeId}
        workflowName={activeWorkflowName}
        onAddNode={handleAddNode}
        onRenameNode={handleRenameNode}
        onRemoveNode={handleRemoveNode}
        onConnect={(sourceId, targetId) => onConnect({ source: sourceId, target: targetId, sourceHandle: null, targetHandle: null })}
        onDisconnect={handleDeleteEdge}
        onSetProfile={handleSetProfile}
        onChangeAgentType={handleChangeAgentType}
        onMarkDone={handleMarkDone}
        onStopAll={() => void stopRunningAgents(nodes)}
        onClearAll={handleClearAll}
        onRunWorkflow={() => void handleRunWorkflow()}
        onStopWorkflow={() => void handleStopWorkflow()}
        onRetryNode={(nodeId) => void handleRetryNode(nodeId)}
        onFitView={() => reactFlowRef.current?.fitView({ duration: 300, padding: 0.3 })}
        onOpenHistory={() => setShowHistory(true)}
        onOpenActivity={() => setShowActivity(true)}
      />

      {showAddNode && <div className="popover-backdrop" onClick={() => setShowAddNode(false)} />}

      {showHistory && <RunHistoryViewer workflowId={activeWorkflowId} onClose={() => setShowHistory(false)} />}
      {viewingCodeChange && <CodeChangesViewer event={viewingCodeChange} onClose={() => setViewingCodeChange(null)} />}

      {validationErrors && (
        <WorkflowValidationDialog
          errors={validationErrors}
          warnings={validationWarnings}
          onClose={() => {
            setValidationErrors(null);
            setValidationWarnings([]);
          }}
        />
      )}

      {selectedEdge && (
        <ConnectionInspector
          edge={selectedEdge}
          fromLabel={nodeLabel(selectedEdge.source)}
          toLabel={nodeLabel(selectedEdge.target)}
          onToggleAutoApprove={handleToggleAutoApprove}
          onDelete={handleDeleteEdge}
          onClose={() => setSelectedEdgeId(null)}
        />
      )}
    </div>
  );
}
