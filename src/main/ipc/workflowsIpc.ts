import { ipcMain } from "electron";
import {
  deleteWorkflow,
  listWorkflows,
  loadWorkflow,
  renameWorkflow,
  saveWorkflow,
  setActiveWorkflowId,
} from "../store/workflowsRepo";
import type { ConnectionGraph } from "../graph/ConnectionGraph";
import type { WorkflowSnapshot } from "../../shared/types";

function isValidSnapshot(value: unknown): value is WorkflowSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<WorkflowSnapshot>;
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.name === "string" &&
    Array.isArray(snapshot.nodes) &&
    Array.isArray(snapshot.connections)
  );
}

export function registerWorkflowsIpc(connectionGraph: ConnectionGraph): void {
  ipcMain.handle("workflows:save", (_event, snapshot: unknown) => {
    if (!isValidSnapshot(snapshot)) {
      throw new Error("workflows:save received an invalid workflow snapshot");
    }
    saveWorkflow(snapshot);
  });

  ipcMain.handle("workflows:load", (_event, id: unknown) => {
    if (typeof id !== "string") {
      throw new Error("workflows:load requires a string id");
    }
    // Every switch (and the initial boot load) goes through here, so this
    // is the one place "which workflow is active" changes on the main
    // side — nodes:create/connections:create/getOrCreateCurrentRun all
    // read it from here instead of a hardcoded id.
    setActiveWorkflowId(id);
    const snapshot = loadWorkflow(id);
    connectionGraph.replaceAll(snapshot?.connections ?? []);
    return snapshot;
  });

  ipcMain.handle("workflows:list", () => listWorkflows());

  ipcMain.handle("workflows:rename", (_event, id: unknown, name: unknown) => {
    if (typeof id !== "string" || typeof name !== "string") {
      throw new Error("workflows:rename requires a string id and name");
    }
    renameWorkflow(id, name);
  });

  ipcMain.handle("workflows:delete", (_event, id: unknown) => {
    if (typeof id !== "string") {
      throw new Error("workflows:delete requires a string id");
    }
    deleteWorkflow(id);
  });
}
