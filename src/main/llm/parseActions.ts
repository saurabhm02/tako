import type { CanvasAction, CanvasQuery, LlmInterpretation } from "../../shared/types";

// The one gate between whatever text a model returns and the existing
// resolver/executor (for actions) or the read-only answer path (for
// queries). Fails closed on anything that isn't exactly one of the known
// shapes — no partial acceptance, no coercion, no unknown `type`/`bucket`
// ever passed through. This is the real safety mechanism, not the
// provider's own "JSON mode" (a best-effort prompt hint, not a guarantee).
const MAX_ACTIONS = 20; // a real user command is never a few hundred steps

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

const VALIDATORS: Record<string, (o: Record<string, unknown>) => boolean> = {
  addNode: (o) => isString(o.agentType) && isOptionalString(o.name),
  renameNode: (o) => isString(o.nodeRef) && isString(o.newName),
  removeNode: (o) => isString(o.nodeRef),
  connect: (o) => isString(o.from) && isString(o.to),
  disconnect: (o) => isString(o.from) && isString(o.to),
  setProfile: (o) => isString(o.nodeRef) && isString(o.profileRef),
  startNode: (o) => isString(o.nodeRef),
  stopNode: (o) => isString(o.nodeRef),
  restartNode: (o) => isString(o.nodeRef),
  markDone: (o) => isString(o.nodeRef),
  stopAll: () => true,
  clearAll: () => true,
  changeAgentType: (o) => isString(o.nodeRef) && isString(o.agentType),
  duplicateNode: (o) => isString(o.nodeRef) && isOptionalString(o.name),
};

// Only the fields each variant's validator actually checked are kept in
// the output — a model padding the object with extra junk fields never
// reaches CanvasAction.
const FIELD_ALLOWLIST: Record<string, string[]> = {
  addNode: ["agentType", "name"],
  renameNode: ["nodeRef", "newName"],
  removeNode: ["nodeRef"],
  connect: ["from", "to"],
  disconnect: ["from", "to"],
  setProfile: ["nodeRef", "profileRef"],
  startNode: ["nodeRef"],
  stopNode: ["nodeRef"],
  restartNode: ["nodeRef"],
  markDone: ["nodeRef"],
  stopAll: [],
  clearAll: [],
  changeAgentType: ["nodeRef", "agentType"],
  duplicateNode: ["nodeRef", "name"],
};

function parseOneAction(value: unknown): CanvasAction | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !(type in VALIDATORS)) return null;
  if (!VALIDATORS[type](obj)) return null;

  const picked: Record<string, unknown> = { type };
  for (const field of FIELD_ALLOWLIST[type]) {
    if (obj[field] !== undefined) picked[field] = obj[field];
  }
  return picked as CanvasAction;
}

function parseQuery(value: unknown): CanvasQuery | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.type === "countAgents") return { type: "countAgents" };
  if (obj.type === "listByStatus") {
    const bucket = obj.bucket;
    if (bucket === "running" || bucket === "waiting" || bucket === "error" || bucket === "completed") {
      return { type: "listByStatus", bucket };
    }
  }
  return null;
}

// Raw model text -> a validated action batch or a validated query, never
// both, never anything else. Accepts a bare JSON array (legacy shape), an
// {actions: [...]} wrapper, or a {query: {...}} wrapper (some providers'
// JSON modes only accept an object at the top level, not a bare array).
// Any parse error, unknown type, or a single invalid batch element: null,
// not a partial result.
export function parseLlmResponse(text: string): LlmInterpretation | null {
  let json: unknown;
  try {
    // Models sometimes wrap JSON in a ```json fence despite instructions
    // not to — strip it rather than fail on formatting alone.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    json = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const maybeQuery = !Array.isArray(json) && typeof json === "object" && json !== null ? (json as { query?: unknown }).query : undefined;
  if (maybeQuery !== undefined) {
    const query = parseQuery(maybeQuery);
    return query ? { kind: "query", query } : null; // a malformed query key fails closed, never falls through to the actions branch
  }

  const array = Array.isArray(json) ? json : Array.isArray((json as { actions?: unknown })?.actions) ? (json as { actions: unknown[] }).actions : null;
  if (!array || array.length === 0 || array.length > MAX_ACTIONS) return null;

  const actions: CanvasAction[] = [];
  for (const item of array) {
    const action = parseOneAction(item);
    if (!action) return null; // one bad element fails the whole batch, same as the deterministic parser
    actions.push(action);
  }
  return { kind: "actions", actions };
}
