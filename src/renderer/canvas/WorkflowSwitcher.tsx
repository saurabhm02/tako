import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import type { WorkflowSummary } from "../../shared/types";

interface WorkflowSwitcherProps {
  activeId: string;
  activeName: string;
  isDirty: boolean;
  onSwitch: (id: string) => void;
  onNew: (name: string) => void;
  onNewTeam?: () => void;
  onSaveAs: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (id: string, name: string) => void;
}

type Mode = "list" | "new" | "save-as" | "rename";

export function validateWorkflowName(raw: string, workflows: WorkflowSummary[], mode: Mode, activeId: string): string | null {
  const name = raw.trim();
  if (!name) return "Enter a name.";
  const lower = name.toLowerCase();
  const collision = workflows.some((w) => w.name.trim().toLowerCase() === lower && !(mode === "rename" && w.id === activeId));
  if (collision) return `A workflow named "${name}" already exists.`;
  return null;
}

export function WorkflowSwitcher({
  activeId,
  activeName,
  isDirty,
  onSwitch,
  onNew,
  onNewTeam,
  onSaveAs,
  onRename,
  onDelete,
}: WorkflowSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("list");
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const refresh = () => void window.tako.workflows.list().then(setWorkflows);

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode !== "list") setMode("list");
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, mode]);

  const close = () => {
    setOpen(false);
    setMode("list");
  };

  const startMode = (next: Mode, prefill: string) => {
    setNameInput(prefill);
    setNameError(null);
    setMode(next);
  };

  const submitName = () => {
    const name = nameInput.trim();
    const error = validateWorkflowName(nameInput, workflows, mode, activeId);
    if (error) {
      setNameError(error);
      return;
    }
    if (mode === "new") onNew(name);
    else if (mode === "save-as") onSaveAs(name);
    else if (mode === "rename") onRename(name);
    close();
  };

  return (
    <div className="workflow-switcher">
      <button
        type="button"
        className={`workflow-switcher__trigger${open ? " workflow-switcher__trigger--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch workflow"
      >
        <span className="workflow-switcher__active-name">{activeName}</span>
        {isDirty && (
          <span
            className="workflow-switcher__dirty-dot"
            title="Unsaved changes"
            aria-label="Unsaved changes"
          />
        )}
        <ChevronDown size={13} className="workflow-switcher__chevron" />
      </button>

      {open && (
        <>
          <div className="popover-backdrop" onClick={close} />
          <div className="workflow-switcher__dropdown omni-panel" onClick={(e) => e.stopPropagation()}>
            {mode === "list" ? (
              <>
                <div className="omni-panel-header">
                  <span>Workflows</span>
                  <button type="button" onClick={close} aria-label="Close">
                    <X size={14} />
                  </button>
                </div>
                <div className="workflow-switcher__list">
                  {workflows.map((w) => {
                    const isActive = w.id === activeId;
                    return (
                      <button
                        type="button"
                        key={w.id}
                        className={`workflow-switcher__item${isActive ? " workflow-switcher__item--active" : ""}`}
                        onClick={() => {
                          if (w.id !== activeId) onSwitch(w.id);
                          close();
                        }}
                      >
                        <span className="workflow-switcher__item-name">
                          {w.name}
                          {w.workflowType === "team" && <span className="workflow-switcher__team-badge">Team</span>}
                        </span>
                        {isActive && <Check size={14} className="workflow-switcher__item-check" />}
                      </button>
                    );
                  })}
                </div>
                <div className="workflow-switcher__actions">
                  <button type="button" className="omni-btn-secondary" onClick={() => startMode("new", "")}>
                    <Plus size={13} />
                    New
                  </button>
                  {onNewTeam && (
                    <button
                      type="button"
                      className="omni-btn-secondary"
                      onClick={() => {
                        onNewTeam();
                        close();
                      }}
                      title="Create Team Workflow (PM → Architect → Reviewer)"
                    >
                      <Users size={13} />
                      + Team
                    </button>
                  )}
                  <button type="button" className="omni-btn-secondary" onClick={() => startMode("save-as", `${activeName} copy`)}>
                    <Copy size={13} />
                    Save As
                  </button>
                  <button type="button" className="omni-btn-secondary" onClick={() => startMode("rename", activeName)}>
                    <Pencil size={13} />
                    Rename
                  </button>
                  <button
                    type="button"
                    className="omni-btn-danger"
                    onClick={() => onDelete(activeId, activeName)}
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="omni-panel-header">
                  <span>
                    {mode === "new" ? "New workflow" : mode === "save-as" ? "Save As" : "Rename workflow"}
                  </span>
                  <button type="button" onClick={() => setMode("list")} aria-label="Back">
                    <X size={14} />
                  </button>
                </div>

                <div className="workflow-switcher__dialog-form">
                  <div className="workflow-switcher__field">
                    <label htmlFor="workflow-name-input">Name</label>
                    <input
                      id="workflow-name-input"
                      autoFocus
                      className="omni-input"
                      value={nameInput}
                      onChange={(e) => {
                        setNameInput(e.target.value);
                        setNameError(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && submitName()}
                      placeholder="Workflow name"
                    />
                  </div>
                  {nameError && <p className="omni-field-error">{nameError}</p>}
                </div>

                <div className="workflow-switcher__dialog-actions">
                  <button type="button" className="omni-btn-secondary" onClick={() => setMode("list")}>
                    Cancel
                  </button>
                  <button type="button" className="omni-btn-primary" onClick={submitName}>
                    {mode === "new" ? "Create" : mode === "save-as" ? "Save As" : "Rename"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
