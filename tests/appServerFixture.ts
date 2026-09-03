// A tiny controllable stand-in for `codex app-server`'s JSON-RPC-over-stdio
// protocol, used only by AppServerClient/codexAppServer tests. Behavior is
// picked via FIXTURE_MODE so a real child process (not a mock) exercises
// spawn/stdin/stdout/exit exactly like the real adapter will see it.
const mode = process.env.FIXTURE_MODE ?? "logged-in-success";

function send(message: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(method: string, params: unknown) {
  send({ jsonrpc: "2.0", method, params });
}

// `total` (cumulative for the thread) is deliberately different from
// `last` (this turn only) so a test can prove the adapter reports the
// per-turn figure, not the cumulative one.
const usage = {
  total: { totalTokens: 100, inputTokens: 50, outputTokens: 50, cachedInputTokens: 0, reasoningOutputTokens: 0 },
  last: { totalTokens: 42, inputTokens: 10, outputTokens: 32, cachedInputTokens: 0, reasoningOutputTokens: 0 },
};

function runTurn() {
  if (mode === "turn-crash") {
    process.exit(1);
  }
  if (mode === "turn-error") {
    notify("error", {
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: false,
      error: { message: "You've hit your usage limit." },
    });
    notify("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", error: { message: "You've hit your usage limit." } },
    });
    return;
  }
  // default: a successful turn
  notify("item/agentMessage/delta", { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "pong" });
  notify("thread/tokenUsage/updated", { threadId: "thread-1", turnId: "turn-1", tokenUsage: usage });
  notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", error: null } });
}

let buffer = "";
process.stdin.on("data", (data: Buffer) => {
  buffer += data.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line) as { id: number; method: string; params: unknown };

    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: { codexHome: "/fake" } });
      continue;
    }

    if (mode === "hang-then-exit") {
      // Deliberately never responds — used to prove a pending request
      // rejects (rather than hanging forever) if the process dies first.
      setTimeout(() => process.exit(1), 20);
      continue;
    }

    if (request.method === "account/read") {
      const loggedOut = mode.startsWith("needs-login");
      send({ jsonrpc: "2.0", id: request.id, result: { account: loggedOut ? null : { type: "chatgpt" }, requiresOpenaiAuth: loggedOut } });
      continue;
    }

    if (request.method === "account/login/start") {
      send({ jsonrpc: "2.0", id: request.id, result: { type: "chatgpt", authUrl: "https://example.com/auth", loginId: "login-1" } });
      if (mode === "needs-login-success") {
        setTimeout(() => notify("account/login/completed", { loginId: "login-1", success: true, error: null }), 20);
      } else if (mode === "needs-login-fails") {
        setTimeout(() => notify("account/login/completed", { loginId: "login-1", success: false, error: "User denied access" }), 20);
      }
      if (mode === "needs-login-exit") {
        setTimeout(() => process.exit(1), 20);
      }
      continue;
    }

    if (request.method === "thread/resume" && mode === "resume-fails") {
      send({ jsonrpc: "2.0", id: request.id, error: { message: "thread not found" } });
      continue;
    }

    if (request.method === "thread/start" || request.method === "thread/resume") {
      const model = mode === "unpriced-model" ? "some-future-model" : "gpt-5";
      send({ jsonrpc: "2.0", id: request.id, result: { thread: { id: "thread-1" }, model } });
      continue;
    }

    if (request.method === "turn/start") {
      // Every turn must target the one thread created at start() — a
      // mismatch means the adapter created (or reached for) a different
      // thread instead of continuing the existing conversation.
      const turnParams = request.params as { threadId?: string };
      if (turnParams.threadId !== "thread-1") {
        send({ jsonrpc: "2.0", id: request.id, error: { message: `unknown thread: ${turnParams.threadId}` } });
        continue;
      }
      send({ jsonrpc: "2.0", id: request.id, result: { turn: { id: "turn-1" } } });
      setTimeout(runTurn, 10);
      continue;
    }

    send({ jsonrpc: "2.0", id: request.id, result: {} });
  }
});
