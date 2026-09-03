import { useEffect } from "react";
import type { TakoEdge } from "./types";

interface ConnectionInspectorProps {
  edge: TakoEdge;
  fromLabel: string;
  toLabel: string;
  onToggleAutoApprove: (edgeId: string, value: boolean) => void;
  onDelete: (edgeId: string) => void;
  onClose: () => void;
}

export function ConnectionInspector({
  edge,
  fromLabel,
  toLabel,
  onToggleAutoApprove,
  onDelete,
  onClose,
}: ConnectionInspectorProps) {
  const autoApprove = Boolean(edge.data?.autoApprove);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="inspector">
      <div className="inspector__header">
        <strong>
          {fromLabel} → {toLabel}
        </strong>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(e) => onToggleAutoApprove(edge.id, e.target.checked)}
        />
        Auto-approve this connection
      </label>
      <button type="button" className="danger" onClick={() => onDelete(edge.id)}>
        Delete connection
      </button>
    </div>
  );
}
