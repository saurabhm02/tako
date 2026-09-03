import { AlertCircle, X } from "lucide-react";

interface WorkflowValidationDialogProps {
  errors: string[];
  warnings?: string[];
  onClose: () => void;
}

/**
 * Renders a clean, actionable validation error modal when a workflow cannot run due to missing nodes, unavailable CLIs, or broken connections.
 */
export function WorkflowValidationDialog({ errors, warnings = [], onClose }: WorkflowValidationDialogProps) {
  return (
    <div className="overlay overlay--focused" onClick={onClose}>
      <div className="workflow-validation-dialog nodrag" onClick={(e) => e.stopPropagation()}>
        <div className="workflow-validation-dialog__header">
          <div className="workflow-validation-dialog__title">
            <AlertCircle size={18} className="workflow-validation-dialog__icon" />
            <h3>Workflow cannot run</h3>
          </div>
          <button
            type="button"
            className="workflow-validation-dialog__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="workflow-validation-dialog__body">
          <p className="workflow-validation-dialog__subtitle">
            Please resolve the following issue{errors.length > 1 ? "s" : ""} before running this workflow:
          </p>
          <ul className="workflow-validation-dialog__list">
            {errors.map((err, idx) => (
              <li key={idx} className="workflow-validation-dialog__item">
                {err}
              </li>
            ))}
          </ul>

          {warnings.length > 0 && (
            <div className="workflow-validation-dialog__warnings">
              <span className="workflow-validation-dialog__warning-title">Warnings:</span>
              <ul className="workflow-validation-dialog__list">
                {warnings.map((w, idx) => (
                  <li key={idx} className="workflow-validation-dialog__item workflow-validation-dialog__item--warning">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="workflow-validation-dialog__footer">
          <button
            type="button"
            className="workflow-validation-dialog__btn"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
