import { findCycles } from "./graph";
import type { ConnectionRecord, NodeRecord, WorkflowSnapshot } from "./types";

export interface WorkflowValidationIssue {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  connectionId?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: WorkflowValidationIssue[];
}

export interface WorkflowValidationOptions {
  installedAgentTypes?: Set<string>;
  disallowCycles?: boolean;
}

/**
 * Validates a workflow definition before execution, checking for missing nodes, unavailable CLIs, broken connections, or cycle issues.
 *
 * @param workflow - The workflow snapshot containing nodes and connections.
 * @param options - Optional validation rules such as installed agent types.
 * @returns Structured validation result containing boolean valid status and actionable issue descriptions.
 *
 * @example
 * Input:
 *   validateWorkflow({ id: "wf-1", name: "Build", nodes: [], connections: [] })
 * Output:
 *   { valid: false, errors: ["Workflow has no nodes. Add at least one agent node to run."], ... }
 */
export function validateWorkflow(
  workflow: WorkflowSnapshot | { id: string; name: string; nodes: NodeRecord[]; connections: ConnectionRecord[] },
  options?: WorkflowValidationOptions,
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];

  // 1. Check for empty workflow
  if (!workflow.nodes || workflow.nodes.length === 0) {
    issues.push({
      severity: "error",
      message: "Workflow has no nodes. Add at least one agent node to run.",
    });
    return buildResult(issues);
  }

  // 2. Check for at least one executable node (agent or compare)
  const executableNodes = workflow.nodes.filter((n) => n.kind === "agent" || n.kind === "compare");
  if (executableNodes.length === 0) {
    issues.push({
      severity: "error",
      message: "Workflow contains only passive notes and has no executable agent nodes.",
    });
  }

  // 3. Check individual nodes
  const nodeMap = new Map<string, NodeRecord>();
  for (const node of workflow.nodes) {
    if (!node.id || typeof node.id !== "string") {
      issues.push({
        severity: "error",
        message: "A node has an invalid or missing ID.",
      });
      continue;
    }
    nodeMap.set(node.id, node);

    const displayName = node.name || node.agentType || "Agent";

    if (node.kind === "agent" && options?.installedAgentTypes) {
      if (node.agentType !== "bash" && !options.installedAgentTypes.has(node.agentType)) {
        issues.push({
          severity: "error",
          nodeId: node.id,
          message: `"${displayName}" uses ${node.agentType}, which is not installed or not available on PATH. Please install it to run this workflow.`,
        });
      }
    }
  }

  // 4. Check connections
  const seenConnections = new Set<string>();
  for (const conn of workflow.connections || []) {
    const fromNode = nodeMap.get(conn.fromNodeId);
    const toNode = nodeMap.get(conn.toNodeId);

    if (!fromNode) {
      issues.push({
        severity: "error",
        connectionId: conn.id,
        message: `Connection references a missing source node (${conn.fromNodeId}).`,
      });
    }

    if (!toNode) {
      issues.push({
        severity: "error",
        connectionId: conn.id,
        message: `Connection references a missing target node (${conn.toNodeId}).`,
      });
    }

    if (fromNode && toNode) {
      if (conn.fromNodeId === conn.toNodeId) {
        issues.push({
          severity: "error",
          connectionId: conn.id,
          nodeId: conn.fromNodeId,
          message: `Self-connection detected on "${fromNode.name || fromNode.agentType}". Self-loops are not allowed.`,
        });
      }

      const edgeKey = `${conn.fromNodeId}>${conn.toNodeId}`;
      if (seenConnections.has(edgeKey)) {
        issues.push({
          severity: "warning",
          connectionId: conn.id,
          message: `Duplicate connection from "${fromNode.name || fromNode.agentType}" to "${toNode.name || toNode.agentType}".`,
        });
      } else {
        seenConnections.add(edgeKey);
      }
    }
  }

  // 5. Check graph cycles
  if (workflow.connections && workflow.connections.length > 0) {
    const graphEdges = workflow.connections
      .filter((c) => nodeMap.has(c.fromNodeId) && nodeMap.has(c.toNodeId))
      .map((c) => ({ from: c.fromNodeId, to: c.toNodeId }));

    const cycles = findCycles(graphEdges);
    if (cycles.length > 0) {
      if (options?.disallowCycles) {
        issues.push({
          severity: "error",
          message: `Workflow contains ${cycles.length} cycle(s). Cycles are disabled.`,
        });
      }
    }
  }

  return buildResult(issues);
}

function buildResult(issues: WorkflowValidationIssue[]): WorkflowValidationResult {
  const errors = issues.filter((i) => i.severity === "error").map((i) => i.message);
  const warnings = issues.filter((i) => i.severity === "warning").map((i) => i.message);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
