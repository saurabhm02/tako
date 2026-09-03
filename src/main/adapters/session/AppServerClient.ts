import { spawn, type ChildProcess } from "node:child_process";

export interface JsonRpcNotification {
  method: string;
  params: unknown;
}

type Unsubscribe = () => void;

const GRACEFUL_STOP_TIMEOUT_MS = 3000;

// A minimal JSON-RPC 2.0 client over a child process's stdio (newline-
// delimited JSON, matching `codex app-server`'s default `stdio://`
// transport). Deliberately knows nothing about Codex's own method names or
// param shapes — that protocol-specific knowledge belongs entirely in
// codexAppServer.ts, so a future breaking change to the (experimental)
// app-server protocol only touches that one file.
export class AppServerClient {
  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private readonly notificationListeners = new Set<(n: JsonRpcNotification) => void>();
  private readonly exitListeners = new Set<(code: number | null) => void>();

  start(command: string, args: string[]): void {
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout?.on("data", (data: Buffer) => this.handleData(data));
    this.child.on("exit", (code) => {
      this.rejectAllPending(new Error(`"${command}" exited`));
      for (const listener of this.exitListeners) listener(code);
    });
  }

  onStderr(cb: (chunk: string) => void): void {
    this.child?.stderr?.on("data", (data: Buffer) => cb(data.toString("utf8")));
  }

  onNotification(cb: (n: JsonRpcNotification) => void): Unsubscribe {
    this.notificationListeners.add(cb);
    return () => this.notificationListeners.delete(cb);
  }

  onExit(cb: (code: number | null) => void): Unsubscribe {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (!this.child) return Promise.reject(new Error("AppServerClient not started"));
    const id = this.nextId++;
    const child = this.child;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString("utf8");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // not a JSON-RPC line — ignore rather than crash the client
      }
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) {
          const err = message.error as { message?: string };
          reject(new Error(err.message ?? "app-server request failed"));
        } else {
          resolve(message.result);
        }
      } else if (typeof message.method === "string") {
        const notification: JsonRpcNotification = { method: message.method, params: message.params };
        for (const listener of this.notificationListeners) listener(notification);
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once("close", finish);
      child.kill();
      setTimeout(() => {
        if (!settled) {
          try {
            child.kill("SIGKILL");
          } catch {
            // already dead
          }
          finish();
        }
      }, GRACEFUL_STOP_TIMEOUT_MS);
    });
  }
}
