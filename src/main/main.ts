import { app, BrowserWindow } from "electron";
import path from "node:path";
import { initDatabase } from "./store/db";
import { closeOrphanedNodeRuns } from "./store/nodeRunsRepo";
import { resetQueuedHandoffsToPending } from "./store/handoffsRepo";
import { registerWorkflowsIpc } from "./ipc/workflowsIpc";
import { registerAdaptersIpc } from "./ipc/adaptersIpc";
import { registerNodesIpc } from "./ipc/nodesIpc";
import { registerConnectionsIpc } from "./ipc/connectionsIpc";
import { registerHandoffsIpc } from "./ipc/handoffsIpc";
import { registerCostsIpc } from "./ipc/costsIpc";
import { registerHistoryIpc } from "./ipc/historyIpc";
import { registerDialogsIpc } from "./ipc/dialogsIpc";
import { registerGitIpc } from "./ipc/gitIpc";
import { registerCodeChangesIpc } from "./ipc/codeChangesIpc";
import { registerLlmIpc } from "./ipc/llmIpc";
import { registerVoiceIpc } from "./ipc/voiceIpc";
import { registerRuntimeIpc } from "./ipc/runtimeIpc";
import { registerBuiltinAdapters } from "./adapters";
import { NodeManager } from "./node-manager/NodeManager";
import { ConnectionGraph } from "./graph/ConnectionGraph";
import { HandoffEngine } from "./handoff-engine/HandoffEngine";
import { WorkflowRuntime } from "./runtime/WorkflowRuntime";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

const nodeManager = new NodeManager();
const connectionGraph = new ConnectionGraph();
const workflowRuntime = new WorkflowRuntime();

let currentWindow: BrowserWindow | null = null;
const broadcast = (channel: string, payload: unknown) => {
  if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send(channel, payload);
};
nodeManager.setBroadcast(broadcast);
const handoffEngine = new HandoffEngine(nodeManager, connectionGraph, broadcast);

function createWindow(): void {
  currentWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Tako",
    icon: path.join(__dirname, "../../assets/icon_macos.png"),
    backgroundColor: "#0b1020",
    // No separate native title bar row (that gray strip above the app's own
    // header) — traffic lights float over our own dark header instead, same
    // as every other native-feeling macOS app. .workspace-header carries the
    // drag region since there's no native title bar left to drag by.
    titleBarStyle: "hiddenInset",
    webPreferences: {
      // Every Vite Forge target builds flat into `.vite/build/` — the
      // preload entry lands right next to main.js as `index.js`.
      preload: path.join(__dirname, "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    currentWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    currentWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, "../../assets/icon_macos.png"));
    } catch {
      // Best effort dock icon
    }
  }
  initDatabase(path.join(app.getPath("userData"), "tako.sqlite3"));
  // NodeManager's registry is provably empty right here — nothing has
  // registered a node yet this process — so any node_runs row still open
  // at this exact point belongs to a previous process that's gone.
  closeOrphanedNodeRuns();
  resetQueuedHandoffsToPending();
  registerBuiltinAdapters();
  registerWorkflowsIpc(connectionGraph);
  registerAdaptersIpc();
  registerNodesIpc(nodeManager, connectionGraph);
  registerConnectionsIpc(connectionGraph);
  registerHandoffsIpc(handoffEngine);
  registerCostsIpc();
  registerHistoryIpc();
  registerDialogsIpc(() => currentWindow);
  registerGitIpc();
  registerCodeChangesIpc();
  registerLlmIpc();
  registerVoiceIpc();
  registerRuntimeIpc(workflowRuntime, broadcast);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// EE1: kill every process Tako started before the app actually exits.
let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void nodeManager.shutdownAll().finally(() => app.quit());
});
