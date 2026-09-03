import type { CanvasCommandContext, LlmCommandOutcome } from "../../shared/types";
import { loadLlmConfigFromEnv } from "./config";
import { createProvider } from "./createProvider";
import { parseLlmResponse } from "./parseActions";
import type { LlmProvider } from "./provider";

const ACTION_TYPES = [
  "addNode(agentType, name?)",
  "renameNode(nodeRef, newName)",
  "removeNode(nodeRef)",
  "connect(from, to)",
  "disconnect(from, to)",
  "setProfile(nodeRef, profileRef)",
  "startNode(nodeRef)",
  "stopNode(nodeRef)",
  "restartNode(nodeRef)",
  "markDone(nodeRef)",
  "stopAll()",
  "clearAll()",
  "changeAgentType(nodeRef, agentType)",
  "duplicateNode(nodeRef, name?)",
].join(", ");

function buildPrompt(text: string, context: CanvasCommandContext): string {
  return [
    "You translate one natural-language canvas request into a single JSON object. JSON only, no prose, no explanation.",
    "",
    `If the request is an instruction to change the canvas, respond with {"actions": [...]} where each element's "type" field is exactly one of: ${ACTION_TYPES}.`,
    'Example: {"actions": [{"type": "addNode", "agentType": "claude-code", "name": "Apollo"}, {"type": "connect", "from": "Apollo", "to": "Reviewer"}]}',
    "A request naming multiple steps becomes multiple ordered actions in that same array. You may reference a node an earlier action in the array creates by the exact name you gave it there.",
    "",
    'If the request is a QUESTION about current canvas state rather than an instruction, respond with {"query": {...}} instead:',
    '  {"query": {"type": "listByStatus", "bucket": "running"}} for "what/which agents are running"',
    '  {"query": {"type": "listByStatus", "bucket": "waiting"}} for "which agent is waiting for me / needs my review"',
    '  {"query": {"type": "listByStatus", "bucket": "error"}} for "which agents have errors"',
    '  {"query": {"type": "listByStatus", "bucket": "completed"}} for "which agents are done/idle"',
    '  {"query": {"type": "countAgents"}} for "how many agents do I have"',
    "",
    "Rules:",
    "- nodeRef/from/to/name must be an exact node name from the Nodes list below, or an agent type from Installed agent types for addNode/changeAgentType.",
    '- changeAgentType is for switching a node to a DIFFERENT agent entirely ("make this use Claude", "change this to the Pi agent") — never use it just to switch between that node\'s own profiles (use setProfile for that).',
    '- duplicateNode is for "create another node like this" / "duplicate this" — it copies the source node\'s own agent type, not a newly-chosen one.',
    "- Never invent a node name, agent type, or profile that doesn't appear below.",
    '- "this"/"this node"/"this agent"/"selected node"/"the selected agent"/"it"/"that" all refer to the Selected node below. If none is selected and the request depends on one, respond with {"actions": []}.',
    "- If the request is ambiguous, depends on something not listed below, or can't be safely completed, respond with {\"actions\": []} — never guess.",
    "",
    `Nodes (name, agent type, status, profile): ${JSON.stringify(context.nodes)}`,
    `Connections: ${JSON.stringify(context.edges)}`,
    `Installed agent types: ${JSON.stringify(context.installedAgents)}`,
    `Selected node: ${context.selectedNodeName ?? "none"}`,
    `Workflow: ${context.workflowName}`,
    "",
    `Request: ${text}`,
  ].join("\n");
}

// Testable core: given an already-constructed provider, run the prompt and
// validate the result. Never throws — a provider/network error and output
// that fails validation are reported as distinct reasons so the UI can
// tell "couldn't understand that" apart from "not available right now".
export async function interpretWithProvider(provider: LlmProvider, text: string, context: CanvasCommandContext): Promise<LlmCommandOutcome> {
  let raw: string;
  try {
    raw = await provider.interpret(buildPrompt(text, context));
  } catch {
    return { ok: false, reason: "provider_error" };
  }
  const result = parseLlmResponse(raw);
  if (!result) return { ok: false, reason: "invalid_output" };
  return { ok: true, result };
}

// Renderer-triggered only, and only when the deterministic parser in
// commandLayer.ts already failed to understand the text.
export async function interpretCanvasCommand(text: string, context: CanvasCommandContext): Promise<LlmCommandOutcome> {
  const config = loadLlmConfigFromEnv();
  if (!config) return { ok: false, reason: "not_configured" };
  return interpretWithProvider(createProvider(config), text, context);
}
