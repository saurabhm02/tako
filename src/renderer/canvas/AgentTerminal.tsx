import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface AgentTerminalProps {
  nodeId: string;
}

// Drives the node's live PTY exactly like a real terminal: every keystroke
// is forwarded raw (docs/07-architecture.md §5 — "the same way you would by
// typing into a terminal"), and incoming output is written to the terminal
// verbatim, ANSI sequences included, rather than parsed or reformatted.
//
// The font size never changes — resizing the node changes how many real
// columns/rows fit at that same natural size (exactly like dragging a real
// terminal window bigger or smaller), never a zoomed/scaled render of a
// fixed-size grid. That only works because xterm.js's own grid and the
// actual pty are kept in exact lockstep on every resize: TerminalAdapter's
// own floor (MIN_COLS/MIN_ROWS) is a trivial degenerate-case guard, not a
// real minimum, so it can't cause the two to disagree the way an earlier
// version of this did (see TerminalAdapter.ts) — that mismatch, not the
// scale, was what garbled a full-screen TUI's output.
export function AgentTerminal({ nodeId }: AgentTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Monaco, "Cascadia Code", "Courier New", monospace',
      lineHeight: 1,
      letterSpacing: 0,
      theme: { background: "#0b1020" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // A freshly-mounted container (e.g. switching back from Focused View
    // to this card) may not have its layout committed yet on this same
    // tick, especially inside a CSS-transformed React Flow node — fitting
    // immediately can measure a 0x0 box and leave the terminal sized wrong
    // before anything's ever written to it, with nothing to trigger a
    // re-fit afterward. One frame is enough for layout to settle.
    let disposed = false;
    requestAnimationFrame(() => {
      if (disposed) return;
      fitAddon.fit();
      void window.tako.nodes.resize(nodeId, term.cols, term.rows);

      // Replay whatever this node already produced (ER2 — partial output
      // survives a crash/stop) now that the terminal is sized correctly.
      void window.tako.nodes.getOutputBuffer(nodeId).then((buffer) => {
        if (!disposed && buffer) term.write(buffer);
      });
    });

    const unsubscribeOutput = window.tako.nodes.onOutputChunk(({ nodeId: id, chunk }) => {
      if (id === nodeId) term.write(chunk);
    });

    const dataDisposable = term.onData((data) => {
      void window.tako.nodes.sendManualInput(nodeId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      void window.tako.nodes.resize(nodeId, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      unsubscribeOutput();
      term.dispose();
    };
  }, [nodeId]);

  return <div ref={containerRef} className="agent-terminal" />;
}
