// Strips terminal escape sequences so a handoff payload (or a Compare Node
// preview) reads as plain text instead of raw TUI control codes.
// Best-effort, not a full terminal emulator — some redraw noise from chatty
// TUIs can still slip through. Shared because both the main process
// (handoff payloads, run history) and the renderer (Compare Node previews)
// need the same stripping.
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?<>=]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b[()][AB012]/g, "")
    .replace(/\x1b[78c]/g, "");
}
