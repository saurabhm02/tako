import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AGENT_DISPLAY_NAMES, type AgentType } from "./types";
import { diffLineKind, splitDiffByFile } from "./diffParsing";
import type { CodeChangeDetail, CodeChangeEvent } from "../../shared/types";

interface CodeChangesViewerProps {
  // nodeName is resolved by whichever entry point opened this before the
  // event ever reaches here: Run History's row already carries it (the
  // existing nodes join in listCodeChangeSummariesForRun); the agent node
  // entry point (CanvasApp) fills it in from the node's own live name,
  // since the live codeChanges:recorded broadcast only carries agentType.
  // Falls back to the agent type label below — never blank, never a raw id.
  event: CodeChangeEvent;
  onClose: () => void;
}

function agentLabel(agentType: string): string {
  return AGENT_DISPLAY_NAMES[agentType as AgentType] ?? agentType;
}

// The stored diff is fetched once on mount and never re-requested — no
// re-diffing on open, per the persisted-result requirement. Escape and the
// overlay/backdrop pattern match RunHistoryViewer exactly.
export function CodeChangesViewer({ event, onClose }: CodeChangesViewerProps) {
  const [detail, setDetail] = useState<CodeChangeDetail | null | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const displayName = event.nodeName ?? agentLabel(event.agentType);

  useEffect(() => {
    void window.tako.codeChanges.getDetail(event.id).then(setDetail);
  }, [event.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fileSegments = useMemo(() => (detail ? splitDiffByFile(detail.diffText) : []), [detail]);
  const selectedFile = detail?.files[selectedIndex];
  const selectedDiffText = fileSegments[selectedIndex];

  return (
    <div className="overlay overlay--focused" onClick={onClose}>
      <div className="code-changes-view" onClick={(e) => e.stopPropagation()}>
        <div className="focused-view__header code-changes-view__header">
          <button type="button" className="code-changes-view__back" onClick={onClose} aria-label="Back to canvas">
            <ArrowLeft size={15} />
            <span className="code-changes-view__title" title={displayName}>
              {displayName}
            </span>
          </button>
          <div className="code-changes-view__header-right">
            <div className="code-changes-view__header-meta">
              <span className="code-changes-view__subtitle">
                {agentLabel(event.agentType)} · Completed
              </span>
              <span className="code-changes-view__totals">
                {event.filesChanged} file{event.filesChanged === 1 ? "" : "s"} · +{event.insertions} −{event.deletions}
              </span>
            </div>
            <button type="button" className="code-changes-view__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {event.concurrentRisk && (
          <div className="code-changes-view__warning">
            ⚠ Another agent was active in this same working directory during this turn — this diff may include its
            changes too.
          </div>
        )}
        {event.truncated && (
          <div className="code-changes-view__warning">Showing the stored portion of this diff.</div>
        )}

        {detail === undefined && <p className="history-view__empty">Loading…</p>}
        {detail === null && <p className="history-view__empty">These changes are no longer available.</p>}

        {detail && (
          <div className="code-changes-view__body">
            <div className="code-changes-view__file-list">
              {detail.files.map((file, i) => (
                <button
                  type="button"
                  key={file.path}
                  className={`code-changes-view__file${i === selectedIndex ? " code-changes-view__file--active" : ""}`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <span className="code-changes-view__file-path" title={file.path}>
                    {file.status === "renamed" ? `${file.oldPath} → ${file.path}` : file.path}
                  </span>
                  <span className="code-changes-view__file-stat">
                    {file.binary ? (
                      "binary"
                    ) : (
                      <>
                        <span className="code-changes-view__add">+{file.insertions}</span>{" "}
                        <span className="code-changes-view__remove">−{file.deletions}</span>
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <pre className="code-changes-view__diff">
              {selectedFile?.binary
                ? "Binary file — no text diff to show."
                : selectedDiffText
                  ? selectedDiffText
                      .split("\n")
                      .map((line, i) => (
                        <div key={i} className={`diff-line diff-line--${diffLineKind(line)}`}>
                          {line}
                        </div>
                      ))
                  : "This file's diff was truncated."}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
