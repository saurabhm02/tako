import { useEffect, useRef, useState } from "react";
import type { AdapterError, NodeStatus } from "../../shared/types";
import { formatAdapterError } from "./types";

interface ChatConversationProps {
  nodeId: string;
  status: NodeStatus;
  error: AdapterError | null;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

// A session-based agent (the ChatGPT/Codex App Server node) is a real
// conversation, not a raw byte stream — reusing AgentTerminal's xterm.js
// view for it just looks like a broken empty terminal. This reads the same
// Adapter output/status the terminal view reads, but buckets it into
// message bubbles instead: text arriving while `status` is "working" is
// the assistant's streamed reply for the turn in progress; anything else
// (login/connect notices) is a system line.
export function ChatConversation({ nodeId, status, error }: ChatConversationProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const statusRef = useRef(status);
  const assistantIndexRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    statusRef.current = status;
    if (status !== "working") assistantIndexRef.current = null; // next chunk starts a fresh bubble
  }, [status]);

  useEffect(() => {
    let disposed = false;

    // Replay whatever this node already produced (ER2) as one system
    // block — the raw buffer has no per-message role markers to rebuild a
    // full transcript from, so this is a best-effort restore, not a replay
    // of the exact conversation.
    void window.tako.nodes.getOutputBuffer(nodeId).then((buffer) => {
      if (!disposed && buffer.trim()) {
        setMessages((current) => [{ role: "system", text: buffer.trim() }, ...current]);
      }
    });

    const unsubscribe = window.tako.nodes.onOutputChunk(({ nodeId: id, chunk }) => {
      if (id !== nodeId || !chunk) return;
      setMessages((current) => {
        if (statusRef.current === "working") {
          if (assistantIndexRef.current !== null) {
            const next = [...current];
            const idx = assistantIndexRef.current;
            next[idx] = { ...next[idx], text: next[idx].text + chunk };
            return next;
          }
          assistantIndexRef.current = current.length;
          return [...current, { role: "assistant", text: chunk }];
        }
        return [...current, { role: "system", text: chunk }];
      });
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [nodeId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, error]);

  const canSend = status === "idle" || status === "handoff_ready" || status === "error";

  const send = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setDraft("");
    void window.tako.nodes.sendManualInput(nodeId, `${text}\r`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-conversation">
      <div className="chat-conversation__messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-conversation__empty">
            {status === "starting" ? "Connecting to ChatGPT…" : "Send a message to start the conversation."}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message chat-message--${m.role}`}>
            {m.text}
          </div>
        ))}
        {error && <div className="chat-message chat-message--error">{formatAdapterError(error)}</div>}
      </div>
      <div className="chat-conversation__input nodrag">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={canSend ? "Message ChatGPT…" : status === "working" ? "Waiting for a response…" : "Connecting…"}
          disabled={!canSend}
          rows={2}
        />
        <button type="button" onClick={send} disabled={!canSend || !draft.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
