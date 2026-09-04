import { getRoleDefinition } from "./roles";
import type { NodeInput, RuntimeHandoff } from "./types";

/**
 * Harness definition specifying role instructions, task instructions, input/output contracts,
 * tools, acceptance criteria, and context policies for executing a role.
 */
export interface HarnessDefinition {
  /** Optional reference to a registered RoleDefinition by ID. */
  roleId?: string;
  /** Custom or overridden system instructions for the role. */
  systemInstructions?: string;
  /** Specific task prompt or objective for this execution turn. */
  taskInstructions?: string;
  /** Direct or structured input payload. */
  input?: unknown;
  /** Additional workflow context or environmental data. */
  context?: Record<string, unknown>;
  /** Tools or capabilities permitted for this execution. */
  tools?: string[];
  /** Expected JSON schema for structured output (additive). */
  outputSchema?: Record<string, unknown> | null;
  /** Explicit acceptance criteria the agent must fulfill. */
  acceptanceCriteria?: string[];
  /** Context policies controlling how upstream handoffs and environment are formatted. */
  contextPolicy?: {
    includeUpstreamHandoffs?: boolean;
    includeWorkingDirectory?: boolean;
    maxUpstreamHandoffs?: number;
    formatStructuredOutput?: boolean;
  };
}

/**
 * Result of preparing execution via Harness.
 * Consumed by NodeRunner and passed to the underlying Adapter.
 */
export interface PreparedExecutionConfig {
  /** The final assembled prompt text ready to be sent to the adapter CLI. */
  promptText: string;
  /** The assembled system instructions combining role instructions, quality criteria, and contracts. */
  systemInstructions: string;
  /** Parsed structured input if available from upstream handoffs. */
  structuredInput?: Record<string, unknown> | null;
  /** Expected output schema formatted for the model. */
  outputSchema?: Record<string, unknown> | null;
  /** Acceptance criteria formatted for the model. */
  acceptanceCriteria: string[];
  /** Execution metadata for tracing, audit, and persistence. */
  metadata: Record<string, unknown>;
}

/**
 * Formats upstream handoffs into structured or text context.
 *
 * @param upstream - Array of incoming RuntimeHandoff packets.
 * @returns Cleanly formatted string representation of upstream handoff data.
 */
export function formatHandoffContext(upstream: RuntimeHandoff[]): {
  formattedText: string;
  structuredPayloads: Record<string, unknown>[];
} {
  if (!upstream || upstream.length === 0) {
    return { formattedText: "", structuredPayloads: [] };
  }

  const structuredPayloads: Record<string, unknown>[] = [];
  const textSections: string[] = [];

  for (let i = 0; i < upstream.length; i++) {
    const handoff = upstream[i];
    const sourceNodeLabel = handoff.fromNodeId;
    const rawText = handoff.sourceOutput.trim();

    // Check if source output contains structured JSON
    const parsed = parseStructuredOutput(rawText);
    if (parsed) {
      structuredPayloads.push(parsed);
      textSections.push(
        `--- Upstream Context ${i + 1} (from node ${sourceNodeLabel}) ---\n${JSON.stringify(parsed, null, 2)}`,
      );
    } else {
      textSections.push(`--- Upstream Context ${i + 1} (from node ${sourceNodeLabel}) ---\n${rawText}`);
    }
  }

  return {
    formattedText: textSections.join("\n\n"),
    structuredPayloads,
  };
}

/**
 * Prepares execution configuration by combining role definitions, task instructions,
 * upstream handoff contexts, acceptance criteria, and output contracts.
 *
 * NOTE: This function is strictly adapter-independent. It contains zero adapter-specific
 * branches or platform execution logic.
 *
 * @param harness - The HarnessDefinition describing the role and task expectations.
 * @param input - The runtime NodeInput containing direct input and incoming handoffs.
 * @param options - Additional runtime context like workingDirectory.
 * @returns PreparedExecutionConfig ready for NodeRunner and Adapter execution.
 */
export function prepareExecution(
  harness: HarnessDefinition,
  input: NodeInput,
  options?: { workingDirectory?: string | null },
): PreparedExecutionConfig {
  const roleDef = harness.roleId ? getRoleDefinition(harness.roleId) : undefined;

  // 1. Resolve system / role instructions
  const roleName = roleDef?.name ?? "Specialist";
  const baseInstructions = harness.systemInstructions || roleDef?.instructions || "";

  // 2. Resolve acceptance criteria
  const acceptanceCriteria: string[] = [
    ...(roleDef?.acceptanceCriteria ?? []),
    ...(harness.acceptanceCriteria ?? []),
  ];

  // 3. Resolve output schema
  const outputSchema =
    harness.outputSchema !== undefined ? harness.outputSchema : (roleDef?.outputSchema ?? null);

  // 4. Resolve task instructions / direct input
  const directTask =
    harness.taskInstructions ||
    (typeof input.directInput === "string" ? input.directInput.trim() : "") ||
    "Execute assigned role responsibilities.";

  // 5. Format upstream context
  const upstreamContext = input.upstreamContext ?? [];
  const { formattedText: formattedHandoffs, structuredPayloads } = formatHandoffContext(upstreamContext);

  // 6. Build system instructions summary
  const systemInstructionParts: string[] = [];
  if (baseInstructions) {
    const roleHeader = roleDef?.purpose
      ? `[ROLE: ${roleName}]\nPurpose: ${roleDef.purpose}\n\n${baseInstructions}`
      : `[ROLE: ${roleName}]\n${baseInstructions}`;
    systemInstructionParts.push(roleHeader);
  }

  if (roleDef?.allowedResponsibilities && roleDef.allowedResponsibilities.length > 0) {
    const allowedText = roleDef.allowedResponsibilities.map((r, idx) => `  ${idx + 1}. ${r}`).join("\n");
    systemInstructionParts.push(`[ALLOWED RESPONSIBILITIES]\n${allowedText}`);
  }

  if (roleDef?.prohibitedResponsibilities && roleDef.prohibitedResponsibilities.length > 0) {
    const prohibitedText = roleDef.prohibitedResponsibilities.map((r, idx) => `  - MUST NOT: ${r}`).join("\n");
    systemInstructionParts.push(`[PROHIBITED ACTIONS & BOUNDARIES]\n${prohibitedText}`);
  }

  if (roleDef?.allowedTools && roleDef.allowedTools.length > 0) {
    const toolsText = roleDef.allowedTools.map((t, idx) => `  ${idx + 1}. ${t}`).join("\n");
    systemInstructionParts.push(`[ALLOWED TOOLS & CAPABILITIES]\n${toolsText}`);
  }

  if (acceptanceCriteria.length > 0) {
    const criteriaText = acceptanceCriteria.map((c, idx) => `  ${idx + 1}. ${c}`).join("\n");
    systemInstructionParts.push(`[ACCEPTANCE CRITERIA]\n${criteriaText}`);
  }

  if (roleDef?.failureConditions && roleDef.failureConditions.length > 0) {
    const failureText = roleDef.failureConditions.map((f, idx) => `  - Condition ${idx + 1}: ${f}`).join("\n");
    systemInstructionParts.push(`[FAILURE CONDITIONS (REJECT IF)]\n${failureText}`);
  }

  if (roleDef?.handoffContract) {
    const target = roleDef.handoffContract.downstreamRoleId
      ? `Downstream Role: "${roleDef.handoffContract.downstreamRoleId}"`
      : "Target: User / Terminal Delivery";
    systemInstructionParts.push(`[HANDOFF CONTRACT]\n${target}\n${roleDef.handoffContract.description}`);
  }

  if (outputSchema) {
    systemInstructionParts.push(
      `[OUTPUT CONTRACT]\nEnsure your response provides the required information matching this schema where appropriate:\n${JSON.stringify(
        outputSchema,
        null,
        2,
      )}`,
    );
  }

  const fullSystemInstructions = systemInstructionParts.join("\n\n");

  // 7. Build prompt text sent to adapter
  const promptParts: string[] = [];

  if (fullSystemInstructions) {
    promptParts.push(fullSystemInstructions);
  }

  if (options?.workingDirectory) {
    promptParts.push(`[WORKING DIRECTORY]\n${options.workingDirectory}`);
  }

  if (formattedHandoffs) {
    promptParts.push(`[UPSTREAM INPUTS]\n${formattedHandoffs}`);
  }

  promptParts.push(`[TASK]\n${directTask}`);

  const fullPromptText = promptParts.join("\n\n").trim();

  return {
    promptText: fullPromptText,
    systemInstructions: fullSystemInstructions,
    structuredInput: structuredPayloads.length > 0 ? structuredPayloads[0] : null,
    outputSchema,
    acceptanceCriteria,
    metadata: {
      roleId: harness.roleId ?? null,
      roleName,
      purpose: roleDef?.purpose,
      allowedResponsibilities: roleDef?.allowedResponsibilities ?? [],
      prohibitedResponsibilities: roleDef?.prohibitedResponsibilities ?? [],
      failureConditions: roleDef?.failureConditions ?? [],
      handoffContract: roleDef?.handoffContract ?? null,
      tools: harness.tools ?? roleDef?.allowedTools ?? roleDef?.capabilities ?? [],
      hasUpstreamContext: upstreamContext.length > 0,
      upstreamCount: upstreamContext.length,
    },
  };
}

/**
 * Attempts to parse structured JSON from text output if present (e.g. within ```json codeblocks or raw JSON).
 * Returns null if the text does not contain valid structured JSON, allowing normal text/markdown to pass through.
 *
 * @param rawText - Raw output string from the adapter.
 * @param _schema - Optional JSON schema for validation (future enhancement).
 * @returns Parsed JSON object or null.
 */
export function parseStructuredOutput(
  rawText: string,
  _schema?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!rawText || typeof rawText !== "string") return null;

  const trimmed = rawText.trim();

  // 1. Try parsing directly if string begins with { and ends with }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue to regex fallback
    }
  }

  // 2. Try extracting JSON from markdown code block ```json ... ```
  const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = jsonCodeBlockRegex.exec(trimmed)) !== null) {
    const candidate = match[1].trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Try next block
      }
    }
  }

  return null;
}
