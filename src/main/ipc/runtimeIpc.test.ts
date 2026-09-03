import { describe, expect, it } from "bun:test";
import { ipcMain } from "electron";
import { registerRuntimeIpc } from "./runtimeIpc";
import { WorkflowRuntime } from "../runtime/WorkflowRuntime";
import { InMemoryWorkflowRunStore } from "../store/workflowRunsRepo";
import type { NodeOutput, NodeRecord, WorkflowSnapshot } from "../../shared/types";

describe("runtimeIpc — Main Process IPC Registration & Dispatch", () => {
  it("registers IPC handlers and correctly delegates runtime:start, cancel, retry, getRun, listRuns, and event broadcasting", async () => {
    const handlers = new Map<string, (...args: any[]) => Promise<any>>();
    const broadcastEvents: Array<{ channel: string; payload: unknown }> = [];

    // Save and mock ipcMain.handle and removeHandler methods
    const originalHandle = ipcMain.handle?.bind(ipcMain);
    const originalRemove = ipcMain.removeHandler?.bind(ipcMain);

    ipcMain.handle = ((channel: string, fn: any) => {
      handlers.set(channel, fn);
      return undefined as any;
    }) as any;
    ipcMain.removeHandler = ((channel: string) => {
      handlers.delete(channel);
    }) as any;

    try {
      const mockRunner = {
        async run(node: NodeRecord): Promise<NodeOutput> {
          return { outputText: `Done ${node.name}` };
        },
      };

      const runtime = new WorkflowRuntime({
        nodeRunner: mockRunner,
        store: new InMemoryWorkflowRunStore(),
      });

      const broadcast = (channel: string, payload: unknown) => {
        broadcastEvents.push({ channel, payload });
      };

      const unregister = registerRuntimeIpc(runtime, broadcast);

      expect(handlers.has("runtime:start")).toBe(true);
      expect(handlers.has("runtime:cancel")).toBe(true);
      expect(handlers.has("runtime:retry")).toBe(true);
      expect(handlers.has("runtime:getRun")).toBe(true);
      expect(handlers.has("runtime:listRuns")).toBe(true);

      // 1. Test runtime:start
      const workflow: WorkflowSnapshot = {
        id: "wf-ipc-1",
        name: "IPC Workflow",
        nodes: [
          {
            id: "n1",
            name: "Claude",
            kind: "agent",
            agentType: "claude-code",
            adapterKind: "terminal",
            workingDirectory: "/tmp",
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
        connections: [],
      };

      const startHandler = handlers.get("runtime:start")!;
      const runResult = (await startHandler({}, workflow)) as any;

      expect(runResult.status).toBe("completed");
      expect(runResult.nodeRuns["n1"].status).toBe("completed");
      expect(broadcastEvents.some((b) => b.channel === "runtime:event")).toBe(true);

      // 2. Test runtime:getRun & runtime:listRuns
      const getRunHandler = handlers.get("runtime:getRun")!;
      const fetchedRun = (await getRunHandler({}, runResult.executionId)) as any;
      expect(fetchedRun.executionId).toBe(runResult.executionId);
      expect(fetchedRun.status).toBe("completed");

      const listRunsHandler = handlers.get("runtime:listRuns")!;
      const listedRuns = (await listRunsHandler({}, "wf-ipc-1")) as any[];
      expect(listedRuns.length).toBeGreaterThan(0);
      expect(listedRuns[0].executionId).toBe(runResult.executionId);

      // 3. Test invalid payloads fail safely
      expect(startHandler({}, null)).rejects.toThrow();
      const cancelHandler = handlers.get("runtime:cancel")!;
      expect(cancelHandler({}, "")).rejects.toThrow();
      const retryHandler = handlers.get("runtime:retry")!;
      expect(retryHandler({}, "", null)).rejects.toThrow();

      // 4. Test unregister
      unregister();
      expect(handlers.has("runtime:start")).toBe(false);
      expect(handlers.has("runtime:cancel")).toBe(false);
      expect(handlers.has("runtime:retry")).toBe(false);
      expect(handlers.has("runtime:getRun")).toBe(false);
      expect(handlers.has("runtime:listRuns")).toBe(false);
    } finally {
      if (originalHandle) ipcMain.handle = originalHandle;
      if (originalRemove) ipcMain.removeHandler = originalRemove;
    }
  });
});
