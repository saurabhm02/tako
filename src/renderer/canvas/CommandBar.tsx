import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownLeft, Loader2, Mic, Square, X } from "lucide-react";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { VOICE_NOT_CONFIGURED_MESSAGE } from "./voiceRecorder";
import { createRequestSequencer } from "./requestSequencer";
import {
  answerCanvasQuery,
  buildCommandContext,
  interpret,
  referencesUnresolvedTempNode,
  resolveActionsSequential,
  substituteTempIds,
  type CanvasAction,
  type ResolveOk,
  type ResolveResult,
  type ResolvedAction,
} from "./commandLayer";
import { isAgentNode, type TakoEdge, type TakoNode } from "./types";
import type { AdapterKind, AdapterManifestSummary, AgentProfile, NodeKind } from "../../shared/types";

const MAX_HISTORY = 20;

interface CommandBarProps {
  nodes: TakoNode[];
  edges: TakoEdge[];
  selectedNodeId: string | null;
  workflowName: string;
  onAddNode: (input: {
    name: string;
    kind: NodeKind;
    agentType: string;
    adapterKind: AdapterKind;
    workingDirectory: string | null;
    config?: Record<string, unknown>;
    position?: { x: number; y: number };
  }) => string;
  onRenameNode: (nodeId: string, name: string) => void;
  onRemoveNode: (nodeId: string) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onDisconnect: (edgeId: string) => void;
  onSetProfile: (nodeId: string, profileId: string) => void;
  onChangeAgentType: (nodeId: string, agentType: string, adapterKind: AdapterKind) => void;
  onMarkDone: (nodeId: string) => void;
  onStopAll: () => void;
  onClearAll: () => void;
  onRunWorkflow?: () => void;
  onStopWorkflow?: () => void;
  onRetryNode?: (nodeId?: string) => void;
  onFitView?: () => void;
  onOpenHistory?: () => void;
  onOpenActivity?: () => void;
  onSetRole?: (nodeId: string, roleId: string | null) => void;
  onCreateTeamWorkflow?: (name?: string, goal?: string) => void;
  onCreateManagerWorkflow?: (goal: string, name?: string, constraints?: string[]) => void;
  onClose?: () => void;
}

// Bottom horizontal command dock integrating typed and voice input.
// Maintains the deterministic interpret -> LLM fallback -> sequential resolve
// -> confirmation pipeline.
export function CommandBar({
  nodes,
  edges,
  selectedNodeId,
  workflowName,
  onAddNode,
  onRenameNode,
  onRemoveNode,
  onConnect,
  onDisconnect,
  onSetProfile,
  onChangeAgentType,
  onMarkDone,
  onStopAll,
  onClearAll,
  onRunWorkflow,
  onStopWorkflow,
  onRetryNode,
  onFitView,
  onOpenHistory,
  onOpenActivity,
  onSetRole,
  onCreateTeamWorkflow,
  onCreateManagerWorkflow,
  onClose,
}: CommandBarProps) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ResolveResult[] | null>(null);
  const [queryAnswer, setQueryAnswer] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adapters, setAdapters] = useState<AdapterManifestSummary[]>([]);
  const [profilesByAgentType, setProfilesByAgentType] = useState<Record<string, AgentProfile[]>>({});
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const sequencerRef = useRef(createRequestSequencer());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void window.tako.voice.isAvailable().then(setVoiceAvailable);
  }, []);

  const voice = useVoiceRecorder((transcript) => {
    setText(transcript);
    setPreview(null);
    setQueryAnswer(null);
    setErrorMessage(null);
    setHistoryIndex(null);
    inputRef.current?.focus();
  });

  useEffect(() => {
    void window.tako.adapters.list().then(setAdapters);
  }, []);

  const agentTypesKey = useMemo(
    () => [...new Set(nodes.filter(isAgentNode).map((n) => n.data.agentType))].sort().join(","),
    [nodes],
  );

  useEffect(() => {
    const types = agentTypesKey ? agentTypesKey.split(",") : [];
    let cancelled = false;
    void Promise.all(types.map((t) => window.tako.adapters.listProfiles(t).then((p) => [t, p] as const))).then((entries) => {
      if (!cancelled) setProfilesByAgentType(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [agentTypesKey]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key !== "Escape") return;
      if (voice.state.status === "listening") {
        voice.cancel();
        return;
      }
      if (voice.state.status === "transcribing") return;
      if (preview !== null) {
        setPreview(null);
        return;
      }
      if (queryAnswer !== null) {
        setQueryAnswer(null);
        return;
      }
      if (errorMessage !== null) {
        setErrorMessage(null);
        return;
      }
      if (text !== "") {
        setText("");
        return;
      }
      inputRef.current?.blur();
      onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, voice, preview, queryAnswer, errorMessage, text]);

  const runResolver = (actions: CanvasAction[]): ResolveResult[] => {
    const results = resolveActionsSequential(actions, { nodes, edges, adapters, profilesByAgentType, selectedNodeId });
    setQueryAnswer(null);
    setPreview(results);
    return results;
  };

  const resolve = async (input: string): Promise<ResolveResult[] | null> => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const mySeq = sequencerRef.current.start();
    setErrorMessage(null);
    setQueryAnswer(null);
    const parsed = interpret(trimmed);
    if (parsed.ok) return runResolver(parsed.actions);

    setIsInterpreting(true);
    try {
      const context = buildCommandContext(nodes, edges, adapters, profilesByAgentType, selectedNodeId, workflowName);
      const outcome = await window.tako.llm.interpretCommand(trimmed, context);
      if (!sequencerRef.current.isCurrent(mySeq)) return null;
      if (!outcome.ok) {
        setErrorMessage(
          outcome.reason === "invalid_output"
            ? "I couldn't understand that."
            : "Advanced understanding isn't available right now — try phrasing it as a direct command.",
        );
        setPreview(null);
        return null;
      }
      if (outcome.result.kind === "query") {
        setQueryAnswer(answerCanvasQuery(outcome.result.query, nodes));
        setPreview(null);
        return null;
      }
      return runResolver(outcome.result.actions);
    } finally {
      if (sequencerRef.current.isCurrent(mySeq)) setIsInterpreting(false);
    }
  };

  const executeOne = async (action: ResolvedAction): Promise<string | undefined> => {
    switch (action.kind) {
      case "addNode": {
        let workingDirectory: string | null;
        if (action.workingDirectory !== undefined) {
          workingDirectory = action.workingDirectory;
        } else if (action.workingDirectoryRequired && action.agentType !== "bash") {
          const picked = await window.tako.dialogs.pickDirectory();
          if (!picked) return undefined;
          workingDirectory = picked;
        } else {
          workingDirectory = null;
        }
        return onAddNode({
          name: action.name,
          kind: "agent",
          agentType: action.agentType,
          adapterKind: action.adapterKind,
          workingDirectory,
          config: action.config,
          position: action.position,
        });
      }
      case "renameNode":
        onRenameNode(action.nodeId, action.newName);
        return undefined;
      case "removeNode":
        onRemoveNode(action.nodeId);
        return undefined;
      case "connect":
        onConnect(action.fromId, action.toId);
        return undefined;
      case "disconnect":
        onDisconnect(action.edgeId);
        return undefined;
      case "setProfile":
        onSetProfile(action.nodeId, action.profileId);
        return undefined;
      case "changeAgentType":
        onChangeAgentType(action.nodeId, action.agentType, action.adapterKind);
        return undefined;
      case "startNode":
        void window.tako.nodes.start(action.nodeId, action.agentType, action.workingDirectory, action.config);
        return undefined;
      case "stopNode":
        void window.tako.nodes.stop(action.nodeId);
        return undefined;
      case "restartNode":
        void window.tako.nodes.restart(action.nodeId);
        return undefined;
      case "markDone":
        onMarkDone(action.nodeId);
        return undefined;
      case "stopAll":
        onStopAll();
        return undefined;
      case "clearAll":
        onClearAll();
        return undefined;
      case "runWorkflow":
        onRunWorkflow?.();
        return undefined;
      case "stopWorkflow":
        onStopWorkflow?.();
        return undefined;
      case "retryNode":
        onRetryNode?.(action.nodeId);
        return undefined;
      case "fitView":
        onFitView?.();
        return undefined;
      case "openHistory":
        onOpenHistory?.();
        return undefined;
      case "openActivity":
        onOpenActivity?.();
        return undefined;
      case "setRole":
        onSetRole?.(action.nodeId, action.roleId);
        return undefined;
      case "createTeamWorkflow":
        onCreateTeamWorkflow?.(action.name, action.goal);
        return undefined;
      case "createManagerWorkflow":
        onCreateManagerWorkflow?.(action.goal, action.name, action.constraints);
        return undefined;
    }
  };

  const runResults = async (results: ResolveResult[]) => {
    if (!results.every((r): r is ResolveOk => r.ok)) return;
    const needsConfirm = results.some((r) => r.ok && r.destructive && r.action.kind !== "clearAll");
    if (needsConfirm) {
      const summary = results.map((r) => (r.ok ? r.description : "")).join("\n");
      if (!confirm(`Run this?\n\n${summary}`)) return;
    }

    const tempIdToRealId = new Map<string, string>();
    for (const r of results) {
      if (!r.ok) continue;
      const action = substituteTempIds(r.action, tempIdToRealId);
      if (referencesUnresolvedTempNode(action)) {
        setErrorMessage("Stopped: a node earlier in this command wasn't created, so the rest of the command didn't run.");
        return;
      }
      let realId: string | undefined;
      try {
        realId = await executeOne(action);
      } catch {
        setErrorMessage("Something went wrong partway through running this command. Some steps may not have completed.");
        return;
      }
      if (action.kind === "addNode" && action.tempId && realId) tempIdToRealId.set(action.tempId, realId);
    }

    setHistory((current) => (current[0] === text ? current : [text, ...current].slice(0, MAX_HISTORY)));
    setText("");
    setPreview(null);
    setHistoryIndex(null);
    onClose?.();
  };

  const handleEnter = async () => {
    if (preview) {
      if (preview.every((r): r is ResolveOk => r.ok)) {
        void runResults(preview);
      }
      return;
    }
    const results = await resolve(text);
    if (!results) return;
    const allOk = results.every((r): r is ResolveOk => r.ok);
    const hasDestructive = results.some((r) => r.ok && r.destructive);
    if (allOk && !hasDestructive) {
      void runResults(results);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleEnter();
    } else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const next = historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setText(history[next]);
    } else if (e.key === "ArrowDown") {
      if (historyIndex === null) return;
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next < 0 ? null : next);
      setText(next < 0 ? "" : history[next]);
    }
  };

  const allResolved = preview !== null && preview.every((r): r is ResolveOk => r.ok);

  const placeholderText = useMemo(() => {
    if (voice.state.status === "listening") return "Listening…";
    if (voice.state.status === "transcribing") return "Transcribing…";
    if (isInterpreting) return "Thinking…";
    return "Describe what you want…";
  }, [voice.state.status, isInterpreting]);

  return (
    <div className="command-bar" onClick={(e) => e.stopPropagation()}>
      {(preview || queryAnswer || errorMessage || voice.state.status === "error") && (
        <div className="command-bar__popup omni-panel">
          <div className="omni-panel-header">
            <span>
              {preview ? "I understood:" : queryAnswer ? "Answer" : "Notice"}
            </span>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setQueryAnswer(null);
                setErrorMessage(null);
              }}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {voice.state.status === "error" && (
            <p className="omni-field-error">{voice.state.message}</p>
          )}

          {errorMessage && <p className="omni-field-error">{errorMessage}</p>}

          {queryAnswer && (
            <div className="command-bar__answer">
              <p>{queryAnswer}</p>
            </div>
          )}

          {preview && (
            <div className="command-bar__preview">
              {preview.map((r, i) => (
                <div key={i} className={`command-bar__preview-row${r.ok ? "" : " command-bar__preview-row--error"}`}>
                  {r.ok ? <Check size={13} /> : <X size={13} />}
                  <span>{r.description}</span>
                </div>
              ))}
              <div className="command-bar__popup-actions">
                <button
                  type="button"
                  className="omni-btn-secondary"
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="omni-btn-primary"
                  disabled={!allResolved}
                  onClick={() => void runResults(preview)}
                >
                  Run
                </button>
                {!allResolved && <span className="command-bar__blocked">Fix the errors above to run.</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="command-bar__dock">
        <button
          type="button"
          className={`command-bar__mic${voice.state.status === "listening" ? " command-bar__mic--active" : ""}`}
          disabled={voice.state.status === "transcribing"}
          onClick={() => {
            if (voice.state.status === "listening") {
              void voice.stop();
              return;
            }
            if (voiceAvailable === false) {
              setErrorMessage(VOICE_NOT_CONFIGURED_MESSAGE);
              return;
            }
            setErrorMessage(null);
            void voice.start();
          }}
          aria-label={voice.state.status === "listening" ? "Stop recording" : "Speak a command"}
          title={voice.state.status === "listening" ? "Stop recording (Esc to cancel)" : "Speak a command"}
        >
          {voice.state.status === "listening" ? (
            <Square size={13} fill="currentColor" />
          ) : voice.state.status === "transcribing" ? (
            <Loader2 size={14} className="command-bar__spinner" />
          ) : (
            <Mic size={14} />
          )}
        </button>

        <input
          ref={inputRef}
          className="command-bar__input"
          placeholder={placeholderText}
          value={text}
          disabled={voice.state.status === "transcribing"}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setQueryAnswer(null);
            setErrorMessage(null);
            setHistoryIndex(null);
          }}
          onKeyDown={handleKeyDown}
        />

        <div className="command-bar__dock-right">
          {voice.state.status === "listening" ? (
            <button
              type="button"
              className="command-bar__badge-btn"
              onClick={() => voice.cancel()}
              title="Cancel recording"
            >
              Esc
            </button>
          ) : voice.state.status === "transcribing" ? (
            <span className="command-bar__dock-status">
              <Loader2 size={12} className="command-bar__spinner" />
              Transcribing…
            </span>
          ) : isInterpreting ? (
            <span className="command-bar__dock-status">
              <Loader2 size={12} className="command-bar__spinner" />
              Thinking…
            </span>
          ) : text.trim() ? (
            <button
              type="button"
              className="command-bar__submit-btn"
              onClick={() => void handleEnter()}
              title="Run command (Enter)"
            >
              <CornerDownLeft size={13} />
            </button>
          ) : (
            <span className="command-bar__shortcut-hint" title="Press Enter to run, ⌘K to focus">
              ⌘ ↵
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
