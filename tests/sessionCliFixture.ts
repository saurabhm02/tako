// A tiny controllable stand-in for a session-based agent's CLI, used only by
// SessionAdapter tests. Behavior is picked via FIXTURE_MODE so a real child
// process (not a mock) exercises spawn/stdout/exit exactly like the real
// adapter will see it. Always echoes its own argv as the first line so a
// test can confirm exactly what SessionAdapter spawned it with.
const argv = process.argv.slice(2);
console.log(JSON.stringify({ type: "debug.argv", argv }));

const mode = process.env.FIXTURE_MODE ?? "success";
const prompt = argv[argv.length - 1] ?? "";

if (mode === "success") {
  console.log(JSON.stringify({ type: "thread.started", thread_id: process.env.FIXTURE_THREAD_ID ?? "thread-1" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "message", text: `echo:${prompt}` } }));
  process.exit(0);
}

if (mode === "error") {
  console.log(JSON.stringify({ type: "error", message: "You've hit your usage limit." }));
  process.exit(1);
}

if (mode === "double-error") {
  // Matches a real Codex failure: a top-level `error` event and a
  // `turn.failed` event both describing the same thing.
  console.log(JSON.stringify({ type: "error", message: "You've hit your usage limit." }));
  console.log(JSON.stringify({ type: "turn.failed", message: "You've hit your usage limit." }));
  process.exit(1);
}

if (mode === "crash") {
  process.exit(1);
}

if (mode === "stderr-crash") {
  console.error("panic: something broke");
  process.exit(2);
}

if (mode === "empty-success") {
  // Exits cleanly but never reports any real text — the observed real-world
  // Codex quirk when spawned outside a TTY (confirmed inconsistent against
  // a real, rate-limited account: manual terminal runs always report the
  // error; spawned runs sometimes exit 0 with nothing at all).
  process.exit(0);
}

if (mode === "hang") {
  setInterval(() => {}, 1000);
}
