import { X } from "lucide-react";
import type { NoteNodeData } from "./types";

interface NoteNodeProps {
  id: string;
  data: NoteNodeData;
  onTextChange: (nodeId: string, text: string) => void;
  onRemove: (nodeId: string) => void;
}

// A passive workspace object, not an agent — no adapter, no status, no
// handles. Just a name and free-form text, persisted the same way a
// dragged position is: it's part of the canvas snapshot the next Save
// writes out, not something with its own IPC round-trip.
export function NoteNode({ id, data, onTextChange, onRemove }: NoteNodeProps) {
  const text = typeof data.config.text === "string" ? data.config.text : "";

  return (
    <div className="note-node">
      <div className="node-chrome node-chrome--note">
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

      <textarea
        className="note-node__text nodrag nowheel"
        placeholder="Write a note…"
        value={text}
        onChange={(e) => onTextChange(id, e.target.value)}
      />
    </div>
  );
}
