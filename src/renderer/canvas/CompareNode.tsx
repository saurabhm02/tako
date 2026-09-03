import { useEffect, useState } from "react";
import { Position, Handle } from "@xyflow/react";
import { Send, X } from "lucide-react";
import { stripAnsi } from "../../shared/ansi";
import { AGENT_DISPLAY_NAMES, formatStatus, type AgentType, type CompareNodeData } from "./types";
import type { NodeStatus } from "../../shared/types";

interface CompareTarget {
  id: string;
  name: string;
  agentType: string;
  status: NodeStatus;
}

interface CompareNodeProps {
  id: string;
  data: CompareNodeData;
  targets: CompareTarget[];
  onPromptChange: (nodeId: string, prompt: string) => void;
  onSend: (nodeId: string, prompt: string) => void;
  onRemove: (nodeId: string) => void;
}

// Fans one prompt out to whichever agent nodes it's connected to and shows
// each one's live output side by side. It has no adapter of its own — the
// connected nodes are the same real, independent NodeSessions already on
// the canvas; this is only a lens over them (docs/07-architecture.md §21).
export function CompareNode({ id, data, targets, onPromptChange, onSend, onRemove }: CompareNodeProps) {
  const prompt = typeof data.config.prompt === "string" ? data.config.prompt : "";
  const canSend = prompt.trim().length > 0 && targets.length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(id, prompt.trim());
  };

  return (
    <div className="compare-node">
      <div className="node-chrome node-chrome--compare">
        <span className="node-chrome__lights">
          <span className="node-chrome__light node-chrome__light--red" />
          <span className="node-chrome__light node-chrome__light--yellow" />
          <span className="node-chrome__light node-chrome__light--green" />
        </span>
        <span className="node-chrome__title" title={data.name}>
          {data.name}
        </span>
        <span className="node-chrome__actions nodrag">
          <button type="button" title="Remove" onClick={() => onRemove(id)}>
            <X size={13} />
          </button>
        </span>
      </div>

      <div className="compare-node__prompt-row nodrag">
        <input
          type="text"
          placeholder="Ask every connected agent…"
          value={prompt}
          onChange={(e) => onPromptChange(id, e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button type="button" title="Send to all" disabled={!canSend} onClick={send}>
          <Send size={14} />
        </button>
      </div>

      {targets.length === 0 ? (
        <div className="compare-node__hint">Connect this to two or more agent nodes to compare their answers.</div>
      ) : (
        <div className="compare-node__columns nodrag nowheel">
          {targets.map((target) => (
            <CompareColumn key={target.id} target={target} />
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function CompareColumn({ target }: { target: CompareTarget }) {
  const [output, setOutput] = useState("");

  useEffect(() => {
    let cancelled = false;
    setOutput("");
    void window.tako.nodes.getOutputBuffer(target.id).then((buffer) => {
      if (!cancelled) setOutput(buffer);
    });
    const unsubscribe = window.tako.nodes.onOutputChunk(({ nodeId, chunk }) => {
      if (nodeId !== target.id) return;
      setOutput((current) => (current + chunk).slice(-4000));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [target.id]);

  const agentLabel = AGENT_DISPLAY_NAMES[target.agentType as AgentType] ?? target.agentType;
  const clean = stripAnsi(output).trim();

  return (
    <div className="compare-node__column">
      <div className="compare-node__column-header">
        <span className="compare-node__column-name" title={target.name}>
          {target.name}
        </span>
        <span className={`status-badge status-badge--${target.status}`}>{formatStatus(target.status)}</span>
      </div>
      <div className="compare-node__column-body">
        {target.status === "not_started" ? (
          <span className="compare-node__column-placeholder">Start {agentLabel} to include it.</span>
        ) : target.status === "working" || target.status === "starting" ? (
          <span className="compare-node__column-placeholder">Working…</span>
        ) : clean ? (
          <pre>{clean}</pre>
        ) : (
          <span className="compare-node__column-placeholder">No output yet.</span>
        )}
      </div>
    </div>
  );
}
