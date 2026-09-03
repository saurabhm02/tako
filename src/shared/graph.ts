export interface GraphEdge {
  from: string;
  to: string;
}

// Directed-cycle detection over the connection graph (docs/07-architecture.md
// §7). Pure and dependency-free by design — no Electron, no SQLite, so it's
// trivially unit-testable and usable from both the renderer (the canvas's
// non-blocking cycle badge) and, if ever needed, the main process.
//
// Each cycle is returned as an ordered loop of node ids (e.g. ["a", "b"]
// means a -> b -> a), deduplicated regardless of which node in the loop a
// standard DFS happens to visit first.
export function findCycles(edges: GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
  }

  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();

  function normalize(cycle: string[]): string {
    const start = cycle.indexOf(cycle.reduce((min, id) => (id < min ? id : min)));
    return [...cycle.slice(start), ...cycle.slice(0, start)].join(">");
  }

  function visit(node: string): void {
    visited.add(node);
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (onStack.has(next)) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = normalize(cycle);
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push(cycle);
        }
      } else if (!visited.has(next)) {
        visit(next);
      }
    }

    stack.pop();
    onStack.delete(node);
  }

  for (const node of adjacency.keys()) {
    if (!visited.has(node)) visit(node);
  }

  return cycles;
}

// Convenience for the canvas badge: the set of edges ("from>to" keys) that
// participate in at least one cycle, so each can be styled as a warning.
export function cycleEdgeKeys(edges: GraphEdge[]): Set<string> {
  const keys = new Set<string>();
  for (const cycle of findCycles(edges)) {
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      keys.add(`${from}>${to}`);
    }
  }
  return keys;
}
