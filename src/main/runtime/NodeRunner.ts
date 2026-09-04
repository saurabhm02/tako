import os from "node:os";
import fs from "node:fs";
import { createAdapter, getAdapterManifest } from "../adapters/registry";
import type { Adapter, AdapterError } from "../adapters/Adapter";
import { stripAnsi } from "../../shared/ansi";
import { prepareExecution, parseStructuredOutput, type HarnessDefinition } from "../../shared/harness";
import type { NodeInput, NodeOutput, NodeRecord, RuntimeErrorDetails } from "../../shared/types";
import type { AdapterFactoryFn, INodeRunner, NodeRunnerContext } from "./types";

/**
 * Prepares the single text prompt/payload sent to an agent by formatting direct input and upstream handoffs.
 *
 * @param input - The NodeInput object containing direct input and incoming handoff contexts.
 * @returns Formatted input text ready to send to the adapter.
 *
 * @example
 * Input:
 *   prepareInputText({ directInput: "Analyze this:", upstreamContext: [{ sourceOutput: "Code diff" }] })
 * Output:
 *   "Analyze this:\n\nCode diff"
 */
export function prepareInputText(input: NodeInput): string {
  const parts: string[] = [];

  if (input.directInput && input.directInput.trim().length > 0) {
    parts.push(input.directInput.trim());
  }

  if (input.upstreamContext && input.upstreamContext.length > 0) {
    if (input.upstreamContext.length === 1) {
      parts.push(input.upstreamContext[0].sourceOutput.trim());
    } else {
      const formattedHandoffs = input.upstreamContext
        .map((h, index) => `--- Input ${index + 1} (from node ${h.fromNodeId}) ---\n${h.sourceOutput.trim()}`)
        .join("\n\n");
      parts.push(formattedHandoffs);
    }
  }

  return parts.join("\n\n").trim();
}

/**
 * Default NodeRunner that executes nodes by dynamically creating and driving real or mock adapters.
 */
export class NodeRunner implements INodeRunner {
  private readonly adapterFactory: AdapterFactoryFn;
  private readonly activeAdapters = new Map<string, Adapter>();

  constructor(customAdapterFactory?: AdapterFactoryFn) {
    this.adapterFactory =
      customAdapterFactory ??
      ((agentType, input) =>
        createAdapter(agentType, {
          nodeId: input.nodeId,
          workingDirectory: input.workingDirectory,
          config: input.config,
          resumeSessionRef: input.resumeSessionRef,
        }));
  }

  /**
   * Executes a single node given its record, prepared input, and execution context.
   *
   * @param node - The NodeRecord definition to execute.
   * @param input - Direct and upstream handoff input for this turn.
   * @param context - Execution context with output streaming and abort signals.
   * @returns Structured NodeOutput upon completion.
   */
  async run(node: NodeRecord, input: NodeInput, context: NodeRunnerContext): Promise<NodeOutput> {
    // 1. Handle passive note nodes
    if (node.kind === "note") {
      const noteText = typeof node.config.text === "string" ? node.config.text : "";
      return { outputText: noteText };
    }

    // 2. Handle compare nodes (pass-through of prepared input)
    if (node.kind === "compare") {
      const inputText = prepareInputText(input) || (typeof node.config.prompt === "string" ? node.config.prompt : "");
      return { outputText: inputText };
    }

    // 3. Handle agent nodes: validate manifest and working directory
    const manifest = getAdapterManifest(node.agentType);
    let workingDirectory = node.workingDirectory;
    if (manifest?.workingDirectoryRequired && !workingDirectory) {
      workingDirectory = os.homedir();
    }
    if (workingDirectory && !fs.existsSync(workingDirectory)) {
      const error: RuntimeErrorDetails = {
        code: "INVALID_WORKING_DIRECTORY",
        message: `Working directory does not exist: ${workingDirectory}`,
        nodeId: node.id,
        executionId: context.executionId,
        recoverable: true,
      };
      throw error;
    }

    // 4. Resolve session reference from persisted context
    const resumeSessionRef =
      typeof input.persistedContext?.sessionRef === "string" ? input.persistedContext.sessionRef : null;

    // 5. Instantiate adapter dynamically
    let adapter: Adapter;
    try {
      adapter = this.adapterFactory(node.agentType, {
        nodeId: node.id,
        workingDirectory,
        config: node.config,
        resumeSessionRef,
      });
    } catch (err) {
      const error: RuntimeErrorDetails = {
        code: "ADAPTER_INSTANTIATION_FAILED",
        message: err instanceof Error ? err.message : String(err),
        nodeId: node.id,
        executionId: context.executionId,
        recoverable: false,
      };
      throw error;
    }

    this.activeAdapters.set(node.id, adapter);

    // 6. Check for Role / Harness definition and prepare input
    const roleId = node.roleId ?? (typeof node.config?.roleId === "string" ? node.config.roleId : null);
    const hasRoleOrHarness = Boolean(roleId || node.config?.harness || node.config?.systemInstructions);

    let preparedText = "";
    let preparedConfig: ReturnType<typeof prepareExecution> | null = null;

    if (hasRoleOrHarness) {
      const harnessDef: HarnessDefinition = {
        roleId: roleId ?? undefined,
        systemInstructions:
          typeof node.config?.systemInstructions === "string" ? node.config.systemInstructions : undefined,
        taskInstructions:
          typeof node.config?.taskPrompt === "string"
            ? node.config.taskPrompt
            : typeof node.config?.prompt === "string"
              ? node.config.prompt
              : undefined,
        acceptanceCriteria: Array.isArray(node.config?.acceptanceCriteria)
          ? (node.config.acceptanceCriteria as string[])
          : undefined,
        outputSchema: (node.config?.outputSchema as Record<string, unknown>) ?? undefined,
      };
      preparedConfig = prepareExecution(harnessDef, input, { workingDirectory });
      preparedText = preparedConfig.promptText;
    } else {
      preparedText = prepareInputText(input);
    }

    const buildNodeOutput = (finalOutputText: string): NodeOutput => {
      let metadata: Record<string, unknown> | undefined;
      if (preparedConfig) {
        const structuredOutput = preparedConfig.outputSchema
          ? parseStructuredOutput(finalOutputText, preparedConfig.outputSchema)
          : null;
        metadata = {
          ...(preparedConfig.metadata ?? {}),
          ...(structuredOutput ? { structuredOutput } : {}),
          ...(roleId ? { roleId } : {}),
        };
      } else if (node.config && Object.keys(node.config).length > 0) {
        metadata = { ...node.config };
      }

      return {
        outputText: finalOutputText,
        sessionRef: adapter.getSessionRef?.() ?? null,
        usage:
          adapter.getUsage() === "unknown"
            ? undefined
            : (adapter.getUsage() as { tokensOrUnits?: number; dollarCost?: number }),
        metadata,
      };
    };

    let outputBuffer = "";
    let turnBuffer = "";
    let unsubs: Array<() => void> = [];
    let isFinished = false;

    try {
      if (context.signal?.aborted) {
        throw { code: "CANCELLED", message: "Execution was cancelled", nodeId: node.id, executionId: context.executionId };
      }

      await adapter.start();

      const runPromise = new Promise<NodeOutput>((resolve, reject) => {
        // Output streaming
        const unsubOutput = adapter.onOutput((chunk) => {
          outputBuffer += chunk;
          turnBuffer += chunk;
          if (context.onOutput) {
            context.onOutput(chunk);
          }
        });
        unsubs.push(unsubOutput);

        // Error handling
        const unsubError = adapter.onError((err: AdapterError) => {
          if (err.kind !== "session_recovered" && !isFinished) {
            isFinished = true;
            reject({
              code: `ADAPTER_ERROR_${err.kind.toUpperCase()}`,
              message: err.message,
              nodeId: node.id,
              executionId: context.executionId,
              recoverable: err.recoverable,
            });
          }
        });
        unsubs.push(unsubError);

        // Process exit handling
        if (adapter.onExit) {
          const unsubExit = adapter.onExit(() => {
            if (!isFinished) {
              isFinished = true;
              const finalOutput = adapter.getFinalOutput?.() ?? stripAnsi(turnBuffer);
              if (finalOutput && finalOutput.trim().length > 0) {
                resolve(buildNodeOutput(finalOutput));
              } else {
                reject({
                  code: "PROCESS_EXITED_UNEXPECTEDLY",
                  message: `Agent process for node ${node.id} exited unexpectedly`,
                  nodeId: node.id,
                  executionId: context.executionId,
                });
              }
            }
          });
          unsubs.push(unsubExit);
        }

        // Completion signal handling
        if (adapter.onCompletionSignal) {
          const unsubCompletion = adapter.onCompletionSignal(() => {
            if (!isFinished) {
              isFinished = true;
              const finalOutput = adapter.getFinalOutput?.() ?? stripAnsi(turnBuffer);
              resolve(buildNodeOutput(finalOutput));
            }
          });
          unsubs.push(unsubCompletion);
        }

        // Handle cancellation via signal
        if (context.signal) {
          const onAbort = () => {
            if (!isFinished) {
              isFinished = true;
              reject({
                code: "CANCELLED",
                message: "Node execution was cancelled",
                nodeId: node.id,
                executionId: context.executionId,
              });
            }
          };
          context.signal.addEventListener("abort", onAbort, { once: true });
        }
      });

      // Send prepared text to adapter
      if (preparedText.length > 0) {
        await adapter.send(preparedText.endsWith("\n") || preparedText.endsWith("\r") ? preparedText : `${preparedText}\n`);
      }

      // If adapter does not implement completion signals (like synchronous or immediate mock), check if already done
      const result = await runPromise;
      return result;
    } finally {
      for (const unsub of unsubs) unsub();
      this.activeAdapters.delete(node.id);
      try {
        await adapter.stop();
      } catch {
        // Stop best-effort
      }
    }
  }

  /**
   * Cancels a currently running node and terminates its adapter.
   *
   * @param nodeId - The ID of the node to cancel.
   */
  async cancel(nodeId: string): Promise<void> {
    const adapter = this.activeAdapters.get(nodeId);
    if (adapter) {
      this.activeAdapters.delete(nodeId);
      try {
        await adapter.stop();
      } catch {
        // Best effort
      }
    }
  }
}
