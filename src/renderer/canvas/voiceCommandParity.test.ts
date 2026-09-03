import { describe, expect, test } from "bun:test";
import { interpret, resolveAction, type ResolveContext } from "./commandLayer";
import { VoiceRecorder, type AudioCaptureSession, type StartCapture, type Transcribe } from "./voiceRecorder";
import type { TakoEdge, TakoNode } from "./types";
import type { AdapterManifestSummary, AgentProfile } from "../../shared/types";

// Voice never gets its own execution system — a transcript is just a
// string that lands in the exact same `text` state a keystroke would.
// These tests exist to guard that architectural claim explicitly (not
// just re-prove commandLayer.ts's own already-tested behavior): feed the
// ticket's own example voice phrasings through the UNMODIFIED
// interpret()/resolveAction() pipeline and confirm nothing voice-specific
// was ever needed for them to work.

function agentNode(id: string, name: string, agentType = "claude-code"): TakoNode {
  return {
    id,
    type: "agentNode",
    position: { x: 0, y: 0 },
    data: { name, agentType, adapterKind: "terminal", workingDirectory: "/tmp", config: {}, status: "idle", error: null, lastActivityAt: null },
  };
}

const ADAPTERS: AdapterManifestSummary[] = [
  { agentType: "claude-code", displayName: "Claude Code", kind: "terminal", workingDirectoryRequired: true, installed: true },
  { agentType: "pi", displayName: "Pi", kind: "terminal", workingDirectoryRequired: true, installed: true },
];
const PROFILES: Record<string, AgentProfile[]> = {};

function ctx(nodes: TakoNode[] = [], edges: TakoEdge[] = [], selectedNodeId: string | null = null): ResolveContext {
  return { nodes, edges, adapters: ADAPTERS, profilesByAgentType: PROFILES, selectedNodeId };
}

describe("voice phrasing — the same deterministic parser and resolver, unmodified", () => {
  test('"stop this agent" resolves the selected node via the existing $selected mechanism', () => {
    const nodes = [agentNode("a", "Apollo")];
    const parsed = interpret("stop this agent");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx(nodes, [], "a"))) : [];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, action: { kind: "stopNode", nodeId: "a" } });
  });

  test('"restart this node" also resolves via $selected — every pronoun variant, not just "this agent"', () => {
    const nodes = [agentNode("a", "Apollo")];
    const parsed = interpret("restart this node");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx(nodes, [], "a"))) : [];
    expect(results[0]).toMatchObject({ ok: true, action: { kind: "restartNode", nodeId: "a" } });
  });

  test('"stop this agent" with nothing selected fails closed — voice phrasing gets no special guessing leniency', () => {
    const nodes = [agentNode("a", "Apollo")];
    const parsed = interpret("stop this agent");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx(nodes, [], null))) : [];
    expect(results[0].ok).toBe(false);
  });

  test('"connect Apollo with Reviewer" (natural spoken phrasing, "with" not "to") parses via the existing connect pattern', () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Reviewer")];
    const parsed = interpret("connect Apollo with Reviewer");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx(nodes))) : [];
    expect(results[0]).toMatchObject({ ok: true, action: { kind: "connect", fromId: "a", toId: "b" } });
  });

  test('"stop Apollo" when two nodes share that name fails closed, never guesses which one was meant', () => {
    const nodes = [agentNode("a", "Apollo"), agentNode("b", "Apollo")];
    const parsed = interpret("stop Apollo");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx(nodes))) : [];
    expect(results[0].ok).toBe(false);
  });

  test('a destructive spoken command ("remove Apollo") is still classified destructive, same confirmation gate as typed', () => {
    const nodes = [agentNode("a", "Apollo")];
    const parsed = interpret("remove Apollo");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx(nodes))) : [];
    expect(results[0]).toMatchObject({ ok: true, destructive: true });
  });

  test('voice command "create a claude agent called Apollo" produces name "Apollo"', () => {
    const parsed = interpret("create a claude agent called Apollo");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx())) : [];
    expect(results[0]).toMatchObject({
      ok: true,
      action: {
        kind: "addNode",
        agentType: "claude-code",
        name: "Apollo",
      },
    });
  });

  test('voice command "create Apollo using Claude" produces name "Apollo"', () => {
    const parsed = interpret("create Apollo using Claude");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx())) : [];
    expect(results[0]).toMatchObject({
      ok: true,
      action: {
        kind: "addNode",
        agentType: "claude-code",
        name: "Apollo",
      },
    });
  });

  test('voice command "add a Claude agent named Apollo" produces name "Apollo"', () => {
    const parsed = interpret("add a Claude agent named Apollo");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx())) : [];
    expect(results[0]).toMatchObject({
      ok: true,
      action: {
        kind: "addNode",
        agentType: "claude-code",
        name: "Apollo",
      },
    });
  });

  test('voice command "I want a Claude agent called Apollo" produces name "Apollo"', () => {
    const parsed = interpret("I want a Claude agent called Apollo");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx())) : [];
    expect(results[0]).toMatchObject({
      ok: true,
      action: {
        kind: "addNode",
        agentType: "claude-code",
        name: "Apollo",
      },
    });
  });

  test('voice command "make Apollo a Claude agent" produces name "Apollo"', () => {
    const parsed = interpret("make Apollo a Claude agent");
    expect(parsed.ok).toBe(true);
    const results = parsed.ok ? parsed.actions.map((a) => resolveAction(a, ctx())) : [];
    expect(results[0]).toMatchObject({
      ok: true,
      action: {
        kind: "addNode",
        agentType: "claude-code",
        name: "Apollo",
      },
    });
  });
});

describe("VoiceRecorder — structurally cannot reach execution, no second command system", () => {
  function fakeSession(): AudioCaptureSession {
    return { stop: async () => ({ audio: new ArrayBuffer(4), mimeType: "audio/webm" }), cancel: () => {} };
  }

  test("onTranscript only ever receives the transcript string — nothing else is ever passed through", async () => {
    const startCapture: StartCapture = async () => fakeSession();
    const transcribe: Transcribe = async () => ({ ok: true, text: "start Apollo" });
    const received: unknown[] = [];
    // The constructor's own type signature (text: string) => void is the
    // real guarantee — this just proves it holds at runtime too.
    const recorder = new VoiceRecorder(startCapture, transcribe, (text) => received.push(text));
    await recorder.start();
    await recorder.stop();
    expect(received).toEqual(["start Apollo"]);
  });

  test("a malformed/failed transcription never reaches onTranscript at all — nothing is ever handed to any pipeline", async () => {
    const startCapture: StartCapture = async () => fakeSession();
    const transcribe: Transcribe = async () => ({ ok: false, reason: "empty" });
    const received: unknown[] = [];
    const recorder = new VoiceRecorder(startCapture, transcribe, (text) => received.push(text));
    await recorder.start();
    await recorder.stop();
    expect(received).toEqual([]);
  });
});
