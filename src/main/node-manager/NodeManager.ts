import fs from "node:fs";
import os from "node:os";
import { createAdapter, getAdapterManifest } from "../adapters/registry";
import type { Adapter, AdapterError } from "../adapters/Adapter";
import { CompletionDetector } from "./CompletionDetector";
import { stripAnsi } from "../../shared/ansi";
import { getOrCreateCurrentRun } from "../store/runsRepo";
import { insertNodeRun, finishNodeRun } from "../store/nodeRunsRepo";
import { getCostSummary, insertCost } from "../store/costsRepo";
import { insertCodeChange } from "../store/codeChangesRepo";
import { diffTrees, snapshotTree } from "../git/codeChanges";
import { ensureNodeExists, ensureWorkflowExists, getActiveWorkflowId, getNodeRuntimeState, saveNodeRuntimeState } from "../store/workflowsRepo";
import type { NodeStatus } from "../../shared/types";

interface RegisteredNode {
  agentType: string;
  workingDirectory: string | null;
  config: Record<string, unknown>;
  adapter: Adapter | null;
  status: NodeStatus;
  outputBuffer: string; 
  turnBuffer: string; 
  nodeRunId: string | null;
  // Git tree id captured right before this turn's input was sent — null
  // whenever there's nothing to diff against (no working directory, not a
  // git repo, or git itself unavailable). Code Changes v1 is git-only.
  pendingBeforeTree: string | null;
}

type Broadcast = (channel: string, payload: unknown) => void;
type StatusListener = (nodeId: string, status: NodeStatus) => void;
type HandoffReadyListener = (nodeId: string, payload: string) => void;

const BUSY_STATUSES: NodeStatus[] = ["working", "starting", "not_started", "error"];

// ponytail: trailing-window bound on outputBuffer only (never turnBuffer —
// that feeds the handoff payload fallback and must stay whole). Without
// this, an hours-long verbose session grows one string forever, rewritten
// to SQLite and re-sent whole over IPC on every checkpoint/remount. 200K
// chars is generous for real terminal scrollback replay; bump if a real
// session shows it's too small.
const MAX_OUTPUT_BUFFER_CHARS = 200_000;

// Owns every adapter instance and its lifecycle. This is where EE1 (kill
// everything Tako started on quit) and per-node isolation (ADR-0004 — one
// adapter per node, never shared) live.
export class NodeManager {
  private readonly nodes = new Map<string, RegisteredNode>();
  private readonly completionDetector: CompletionDetector;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly handoffReadyListeners = new Set<HandoffReadyListener>();
  private broadcast: Broadcast = () => {};

  constructor(idleTimeoutMs?: number) {
    this.completionDetector = new CompletionDetector(idleTimeoutMs);
    this.completionDetector.onSignal((nodeId) => this.handleCompletionSignal(nodeId));
  }

  setBroadcast(fn: Broadcast): void {
    this.broadcast = fn;
  }

  onStatusChanged(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onHandoffReady(cb: HandoffReadyListener): () => void {
    this.handoffReadyListeners.add(cb);
    return () => this.handoffReadyListeners.delete(cb);
  }

  async startNode(
    nodeId: string,
    agentType: string,
    requestedWorkingDirectory: string | null,
    config: Record<string, unknown>,
  ): Promise<string | null> {
    if (this.nodes.get(nodeId)?.adapter) {
      throw new Error(`Node ${nodeId} is already running`);
    }

    // No folder picked at creation time isn't a blocker — a terminal agent
    // still needs *some* real cwd, so it gets the same default a normal
    // Terminal.app window would (EE3 still lets the user change it later
    // via "Change Directory"). Session adapters never require one, so they
    // stay null exactly as before.
    const requiresWorkingDirectory = getAdapterManifest(agentType)?.workingDirectoryRequired ?? false;
    const workingDirectory =
      requestedWorkingDirectory ?? (requiresWorkingDirectory ? os.homedir() : null);

    // A node that's ever run before already has a row — restoring its
    // prior output/session identity here is what makes "reopen Tako" feel
    // like the same workspace instead of a blank one (a brand-new node has
    // no row yet, so this is just ""/null, a no-op).
    const { lastOutputText, sessionRef } = getNodeRuntimeState(nodeId);

    const node: RegisteredNode = {
      agentType,
      workingDirectory,
      config,
      adapter: null,
      status: "not_started",
      outputBuffer: lastOutputText,
      turnBuffer: "",
      nodeRunId: null,
      pendingBeforeTree: null,
    };
    this.nodes.set(nodeId, node);

    if (workingDirectory && !fs.existsSync(workingDirectory)) {
      const message = `Working directory does not exist: ${workingDirectory}`;
      this.setStatus(nodeId, "error", { kind: "unknown", message, recoverable: true });
      throw new Error(message);
    }

    this.setStatus(nodeId, "starting");

    let adapter: Adapter;
    try {
      adapter = createAdapter(agentType, { nodeId, workingDirectory, config, resumeSessionRef: sessionRef });
    } catch (err) {
      this.failStart(nodeId, err);
      throw err;
    }
    node.adapter = adapter;

    adapter.onOutput((chunk) => {
      node.outputBuffer += chunk;
      if (node.outputBuffer.length > MAX_OUTPUT_BUFFER_CHARS) {
        node.outputBuffer = node.outputBuffer.slice(-MAX_OUTPUT_BUFFER_CHARS);
      }
      node.turnBuffer += chunk;
      this.broadcast("node:outputChunk", { nodeId, chunk });
    });
    adapter.onError((error) => {
      // "session_recovered" means the adapter already fixed itself (an
      // invalid resume silently fell back to a fresh session) before
      // reporting this — the node was never actually broken, so it stays
      // whatever it already was (idle) instead of getting pinned at
      // "error" for a problem that's already resolved. Still broadcast so
      // the UI can show the notice. Every other kind is a real problem —
      // unchanged, still flips status to "error".
      if (error.kind === "session_recovered") {
        this.broadcast("node:error", { nodeId, error });
      } else {
        this.setStatus(nodeId, "error", error);
      }
      // Whatever just changed (e.g. a resume failure silently moved the
      // adapter to a fresh session id) must become durable right away, not
      // wait for the next turn-complete/stop checkpoint — otherwise quitting
      // in that window leaves the old, now-invalid id persisted, and the
      // next launch retries that same failed resume instead of the fresh
      // id that's already live.
      this.persistSnapshot(nodeId, node, adapter.getSessionRef?.() ?? null);
    });
    adapter.onExit?.(() => this.finalizeDeadNode(nodeId));

    try {
      const runId = getOrCreateCurrentRun();
      const adapterKind = getAdapterManifest(agentType)?.kind ?? "terminal";
      const workflowId = getActiveWorkflowId();
      ensureWorkflowExists(workflowId, "My Workflow");
      ensureNodeExists({
        id: nodeId,
        workflowId,
        // Insurance only (ON CONFLICT DO NOTHING) — the real name/position
        // come from `nodes:create`, already called before start in the
        // normal flow. An empty name falls back to the agent's display
        // name wherever it's rendered.
        name: "",
        kind: "agent",
        agentType,
        adapterKind,
        workingDirectory,
        config,
        position: { x: 0, y: 0 },
      });
      node.nodeRunId = insertNodeRun(runId, nodeId);

      await adapter.start();
      this.completionDetector.attach(nodeId, adapter);
      this.setStatus(nodeId, "idle");
      this.persistSnapshot(nodeId, node, adapter.getSessionRef?.() ?? null);
      return workingDirectory;
    } catch (err) {
      this.failStart(nodeId, err);
      throw err;
    }
  }

  private failStart(nodeId: string, err: unknown): void {
    this.setStatus(nodeId, "error", {
      kind: "unknown",
      message: err instanceof Error ? err.message : String(err),
      recoverable: false,
    });
  }

  // Manual input (from the user's own keystrokes) and handoff delivery both
  // go through here — either way, the node is now working on something new.
  async sendInput(nodeId: string, text: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node?.adapter) {
      throw new Error(`Node ${nodeId} is not running`);
    }
    node.turnBuffer = "";
    // Before-snapshot for Code Changes v1, taken right here, before the
    // agent gets the input, so a fast turn can never race ahead of it.
    // Non-git / no-working-directory nodes just get null and skip the
    // whole feature at completeTurn. Never blocks or fails the actual
    // send — a snapshot failure only means no code changes get recorded
    // this turn, never a broken turn.
    node.pendingBeforeTree = node.workingDirectory
      ? await snapshotTree(node.workingDirectory).catch(() => null)
      : null;
    this.setStatus(nodeId, "working");
    await node.adapter.send(text);
  }

  resize(nodeId: string, cols: number, rows: number): void {
    this.nodes.get(nodeId)?.adapter?.resize?.(cols, rows);
  }

  // The manual completion override (ADR-0001) — works even after a crash,
  // since ER2 keeps the turn buffer around for exactly this. A turn can
  // only complete once per "working" session — calling this again on a
  // node that already finished (or never started a turn) is a no-op, the
  // same guard handleCompletionSignal already applies, so a duplicate
  // click (or a race with an automatic signal) can't insert a second cost
  // entry or propose the same handoff twice.
  markDone(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} was never started`);
    if (node.status !== "working") return;
    this.completeTurn(nodeId, node);
  }

  async stopNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node?.adapter) return;

    const adapter = node.adapter;
    const finalStatus = node.status;
    const sessionRef = adapter.getSessionRef?.() ?? null;
    node.adapter = null;
    this.completionDetector.detach(nodeId);

    await adapter.stop();
    if (node.nodeRunId) {
      finishNodeRun(node.nodeRunId, finalStatus, stripAnsi(node.outputBuffer));
      node.nodeRunId = null;
    }
    this.persistSnapshot(nodeId, node, sessionRef);
    this.setStatus(nodeId, "not_started");
  }

  // The adapter's own process/session died on its own (not via stopNode) —
  // the run is over whether or not anyone's watching, so close it out
  // immediately rather than leaving an orphaned "still running" node_run
  // until the next explicit stop/dispose/restart. Status is left as
  // whatever adapter.onError already set (typically "error") instead of
  // being reset to "not_started", so the failure stays visible.
  private finalizeDeadNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node?.adapter) return;
    const sessionRef = node.adapter.getSessionRef?.() ?? null;
    node.adapter = null;
    this.completionDetector.detach(nodeId);
    if (node.nodeRunId) {
      finishNodeRun(node.nodeRunId, "error", stripAnsi(node.outputBuffer));
      node.nodeRunId = null;
    }
    this.persistSnapshot(nodeId, node, sessionRef);
  }

  async restartNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} was never started`);
    await this.stopNode(nodeId);
    // A restart is a deliberate "start over," not the app relaunching — wipe
    // whatever stopNode just persisted so the new session doesn't silently
    // inherit the old one's transcript/thread id.
    saveNodeRuntimeState(nodeId, "", null);
    await this.startNode(nodeId, node.agentType, node.workingDirectory, node.config);
  }

  // A node the renderer restored on load but never explicitly started has
  // no live registry entry at all (restore no longer implies run — see
  // CanvasApp's loadFromDisk) — its output only exists on disk. Falling
  // back to it here means AgentTerminal/ChatConversation's existing
  // replay-on-mount call still shows the real prior conversation without
  // needing a second IPC method just for the not-running case.
  getOutputBuffer(nodeId: string): string {
    const node = this.nodes.get(nodeId);
    if (node) return node.outputBuffer;
    return getNodeRuntimeState(nodeId).lastOutputText;
  }

  getStatus(nodeId: string): NodeStatus {
    return this.nodes.get(nodeId)?.status ?? "not_started";
  }

  isFreeToReceive(nodeId: string): boolean {
    return !BUSY_STATUSES.includes(this.getStatus(nodeId));
  }

  async disposeNode(nodeId: string): Promise<void> {
    await this.stopNode(nodeId);
    this.nodes.delete(nodeId);
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.nodes.keys()].map((nodeId) => this.stopNode(nodeId)));
  }

  // A stray signal while nothing was in flight (e.g. the startup banner
  // settling) isn't a real completion — ignore it.
  private handleCompletionSignal(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.status !== "working") return;
    this.completeTurn(nodeId, node);
  }

  // Shared by the automatic and manual completion paths: mark the node
  // ready for a handoff, record whatever this turn cost (CT1 — real number
  // or explicitly unknown, never guessed), and notify listeners.
  private completeTurn(nodeId: string, node: RegisteredNode): void {
    // Drop any idle timer still ticking down from this turn — once it's
    // done, further redraw noise from the adapter must not be able to
    // matter to it (nothing left for it to fire against).
    this.completionDetector.clearPendingIdleTimer(nodeId);
    this.setStatus(nodeId, "handoff_ready");

    if (node.adapter) {
      insertCost(getOrCreateCurrentRun(), nodeId, node.adapter.getUsage());
      // Carries the freshly computed summary so every subscriber reads the
      // event instead of each independently re-querying it (N+1 fetches
      // across N mounted nodes for one turn completing).
      this.broadcast("cost:updated", getCostSummary());
      this.persistSnapshot(nodeId, node, node.adapter.getSessionRef?.() ?? null);
    }

    // A handoff must carry only the agent's final user-facing answer —
    // never the raw terminal stream, which also contains the echoed input,
    // thinking/tool-call rendering, and shell/tool output. Adapters with a
    // real structured record of their own turns (Claude Code/Pi/Codex CLI's
    // on-disk transcripts — see each factory's finalOutputReader) report it
    // via getFinalOutput(); node.turnBuffer is only ever used as a fallback
    // for adapters with no such source (Gemini/Kiro/Kimi/bash — none of
    // them have a known, verified transcript format in this codebase, so
    // there's nothing safe to parse instead of guessing at terminal noise).
    const finalOutput = node.adapter?.getFinalOutput?.() ?? null;
    const payload = finalOutput ?? stripAnsi(node.turnBuffer);
    for (const listener of this.handoffReadyListeners) listener(nodeId, payload);

    this.captureCodeChange(nodeId, node);
  }

  // Fire-and-forget: diffing must never delay the handoff-ready signal or
  // any other turn-completion behavior above. A snapshot/diff failure is
  // silently "no code changes recorded," never a surfaced error — this is
  // an inspection feature, not something the turn's correctness depends on.
  private captureCodeChange(nodeId: string, node: RegisteredNode): void {
    const workingDirectory = node.workingDirectory;
    const beforeTree = node.pendingBeforeTree;
    node.pendingBeforeTree = null;
    if (!workingDirectory || !beforeTree) return;

    const runId = getOrCreateCurrentRun();
    // Another node already sharing this directory and still "working" right
    // now — the diff below may include its changes too (EE3: Tako doesn't
    // isolate nodes sharing a directory). Checked before the async gap so
    // it reflects the state genuinely overlapping this turn's tail end.
    const concurrentRisk = [...this.nodes.entries()].some(
      ([otherId, other]) => otherId !== nodeId && other.workingDirectory === workingDirectory && other.status === "working",
    );

    void snapshotTree(workingDirectory)
      .then(async (afterTree) => {
        if (!afterTree) return;
        const diff = await diffTrees(workingDirectory, beforeTree, afterTree);
        if (diff.files.length === 0) return; // no-op turn — nothing worth recording
        const summary = insertCodeChange({
          runId,
          nodeId,
          agentType: node.agentType,
          workingDirectory,
          beforeTree,
          afterTree,
          files: diff.files,
          insertions: diff.insertions,
          deletions: diff.deletions,
          diffText: diff.diffText,
          truncated: diff.truncated,
          concurrentRisk,
        });
        // Nothing previously told the renderer this happened at all — the
        // agent node's own "View changes" affordance (Code Workspace v2)
        // needs to know a real code change now exists for this node, the
        // same way node:statusChanged/node:error already tell it about
        // every other kind of turn-completion state. Summary only (no
        // diff text), matching the existing lazy-detail-fetch split.
        this.broadcast("codeChanges:recorded", summary);
      })
      .catch(() => {
        /* best-effort — see method comment */
      });
  }

  // The one place a node's conversation actually gets saved for next
  // launch — called at every natural checkpoint (start, turn complete,
  // stop, crash) rather than on a timer/debounce, since none of those are
  // hot paths and app quit already routes every node through stopNode
  // (shutdownAll), so there's no separate "flush on quit" needed.
  private persistSnapshot(nodeId: string, node: RegisteredNode, sessionRef: string | null): void {
    saveNodeRuntimeState(nodeId, node.outputBuffer, sessionRef);
  }

  private setStatus(nodeId: string, status: NodeStatus, error: AdapterError | null = null): void {
    const node = this.nodes.get(nodeId);
    if (node) node.status = status;

    if (error) this.broadcast("node:error", { nodeId, error });
    this.broadcast("node:statusChanged", { nodeId, status });
    for (const listener of this.statusListeners) listener(nodeId, status);
  }
}
