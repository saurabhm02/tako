import { contextBridge, ipcRenderer } from "electron";
import type {
  AdapterError,
  AdapterManifestSummary,
  AgentProfile,
  CanvasCommandContext,
  CodeChangeDetail,
  CodeChangeSummaryRow,
  ConnectionRecord,
  CostSummary,
  HandoffSummary,
  LlmCommandOutcome,
  VoiceTranscriptionOutcome,
  NodeRecord,
  NodeStatus,
  TakoBridge,
  RunDetail,
  RunSummary,
  WorkflowSnapshot,
} from "../shared/types";

// The only surface Renderer code may use to reach the outside world
// (docs/07-architecture.md §3).
const tako: TakoBridge = {
  workflows: {
    save: (snapshot: WorkflowSnapshot) => ipcRenderer.invoke("workflows:save", snapshot),
    load: (id: string) => ipcRenderer.invoke("workflows:load", id),
    list: () => ipcRenderer.invoke("workflows:list"),
    rename: (id: string, name: string) => ipcRenderer.invoke("workflows:rename", id, name),
    remove: (id: string) => ipcRenderer.invoke("workflows:delete", id),
  },

  adapters: {
    list: (): Promise<AdapterManifestSummary[]> => ipcRenderer.invoke("adapters:list"),
    listProfiles: (agentType: string): Promise<AgentProfile[]> => ipcRenderer.invoke("adapters:listProfiles", agentType),
  },

  nodes: {
    create: (node: NodeRecord) => ipcRenderer.invoke("nodes:create", node),
    start: (nodeId, agentType, workingDirectory, config) =>
      ipcRenderer.invoke("nodes:start", nodeId, agentType, workingDirectory, config),
    stop: (nodeId) => ipcRenderer.invoke("nodes:stop", nodeId),
    restart: (nodeId) => ipcRenderer.invoke("nodes:restart", nodeId),
    dispose: (nodeId) => ipcRenderer.invoke("nodes:dispose", nodeId),
    markDone: (nodeId) => ipcRenderer.invoke("nodes:markDone", nodeId),
    sendManualInput: (nodeId, text) => ipcRenderer.invoke("nodes:sendManualInput", nodeId, text),
    resize: (nodeId, cols, rows) => ipcRenderer.invoke("nodes:resize", nodeId, cols, rows),
    getOutputBuffer: (nodeId) => ipcRenderer.invoke("nodes:getOutputBuffer", nodeId),
    getStatus: (nodeId) => ipcRenderer.invoke("nodes:getStatus", nodeId),

    onOutputChunk(cb: (payload: { nodeId: string; chunk: string }) => void) {
      const handler = (_event: unknown, payload: { nodeId: string; chunk: string }) => cb(payload);
      ipcRenderer.on("node:outputChunk", handler);
      return () => ipcRenderer.removeListener("node:outputChunk", handler);
    },

    onStatusChanged(cb: (payload: { nodeId: string; status: NodeStatus }) => void) {
      const handler = (_event: unknown, payload: { nodeId: string; status: NodeStatus }) => cb(payload);
      ipcRenderer.on("node:statusChanged", handler);
      return () => ipcRenderer.removeListener("node:statusChanged", handler);
    },

    onError(cb: (payload: { nodeId: string; error: AdapterError }) => void) {
      const handler = (_event: unknown, payload: { nodeId: string; error: AdapterError }) => cb(payload);
      ipcRenderer.on("node:error", handler);
      return () => ipcRenderer.removeListener("node:error", handler);
    },
  },

  connections: {
    create: (connection: ConnectionRecord) => ipcRenderer.invoke("connections:create", connection),
    remove: (connectionId) => ipcRenderer.invoke("connections:remove", connectionId),
    setAutoApprove: (connectionId, autoApprove) =>
      ipcRenderer.invoke("connections:setAutoApprove", connectionId, autoApprove),
  },

  handoffs: {
    listPending: (): Promise<HandoffSummary[]> => ipcRenderer.invoke("handoffs:listPending"),
    edit: (handoffId, newText) => ipcRenderer.invoke("handoffs:edit", handoffId, newText),
    approve: (handoffId) => ipcRenderer.invoke("handoffs:approve", handoffId),
    reject: (handoffId) => ipcRenderer.invoke("handoffs:reject", handoffId),
    sendFromNode: (nodeId, payloadText) => ipcRenderer.invoke("handoffs:sendFromNode", nodeId, payloadText),

    onPending(cb: (handoff: HandoffSummary) => void) {
      const handler = (_event: unknown, handoff: HandoffSummary) => cb(handoff);
      ipcRenderer.on("handoff:pending", handler);
      return () => ipcRenderer.removeListener("handoff:pending", handler);
    },

    onResolved(cb: (handoff: HandoffSummary) => void) {
      const handler = (_event: unknown, handoff: HandoffSummary) => cb(handoff);
      ipcRenderer.on("handoff:resolved", handler);
      return () => ipcRenderer.removeListener("handoff:resolved", handler);
    },

    onHopLimitReached(cb: (payload: { runId: string }) => void) {
      const handler = (_event: unknown, payload: { runId: string }) => cb(payload);
      ipcRenderer.on("run:hopLimitReached", handler);
      return () => ipcRenderer.removeListener("run:hopLimitReached", handler);
    },
  },

  costs: {
    getSummary: (): Promise<CostSummary> => ipcRenderer.invoke("costs:getSummary"),

    onUpdated(cb: (summary: CostSummary) => void) {
      const handler = (_event: unknown, summary: CostSummary) => cb(summary);
      ipcRenderer.on("cost:updated", handler);
      return () => ipcRenderer.removeListener("cost:updated", handler);
    },
  },

  history: {
    listRuns: (): Promise<RunSummary[]> => ipcRenderer.invoke("history:listRuns"),
    getRunDetail: (runId: string): Promise<RunDetail | null> => ipcRenderer.invoke("history:getRunDetail", runId),
  },

  codeChanges: {
    getDetail: (id: string): Promise<CodeChangeDetail | null> => ipcRenderer.invoke("codeChanges:getDetail", id),

    onRecorded(cb: (summary: CodeChangeSummaryRow) => void) {
      const handler = (_event: unknown, summary: CodeChangeSummaryRow) => cb(summary);
      ipcRenderer.on("codeChanges:recorded", handler);
      return () => ipcRenderer.removeListener("codeChanges:recorded", handler);
    },
  },

  dialogs: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialogs:pickDirectory"),
  },

  git: {
    getBranch: (directory: string): Promise<string | null> => ipcRenderer.invoke("git:getBranch", directory),
  },

  llm: {
    interpretCommand: (text: string, context: CanvasCommandContext): Promise<LlmCommandOutcome> =>
      ipcRenderer.invoke("llm:interpretCommand", text, context),
  },

  voice: {
    transcribe: (audio: ArrayBuffer, mimeType: string): Promise<VoiceTranscriptionOutcome> =>
      ipcRenderer.invoke("voice:transcribe", audio, mimeType),
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke("voice:isAvailable"),
  },

  runtime: {
    start: (workflow, options) => ipcRenderer.invoke("runtime:start", workflow, options),
    cancel: (executionId) => ipcRenderer.invoke("runtime:cancel", executionId),
    retry: (executionId, nodeId) => ipcRenderer.invoke("runtime:retry", executionId, nodeId),
    getRun: (executionId) => ipcRenderer.invoke("runtime:getRun", executionId),
    listRuns: (workflowId) => ipcRenderer.invoke("runtime:listRuns", workflowId),
    onEvent(cb) {
      const handler = (_event: unknown, payload: any) => cb(payload);
      ipcRenderer.on("runtime:event", handler);
      return () => ipcRenderer.removeListener("runtime:event", handler);
    },
  },
};

contextBridge.exposeInMainWorld("tako", tako);
