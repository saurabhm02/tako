import { describe, expect, test } from "bun:test";
import { CompletionDetector } from "./CompletionDetector";
import { FakeAdapter } from "../../../tests/fakeAdapter";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("CompletionDetector", () => {
  test("fires idle-timeout after silence, using the adapter's own signal instead when it has one", async () => {
    const detector = new CompletionDetector(20);
    const adapter = new FakeAdapter();
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);
    adapter.emitOutput("some output");
    expect(signals).toEqual([]); // still within the idle window

    await wait(40);
    expect(signals).toEqual(["a:idle-timeout"]);
  });

  test("prefers the provider's own completion signal over the idle timeout", async () => {
    const detector = new CompletionDetector(20);
    const adapter = new FakeAdapter(true);
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);
    adapter.emitOutput("thinking...");
    adapter.emitCompletionSignal();

    expect(signals).toEqual(["a:provider-signal"]);
  });

  test("detach stops the idle timer from firing", async () => {
    const detector = new CompletionDetector(20);
    const adapter = new FakeAdapter();
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);
    adapter.emitOutput("output");
    detector.detach("a");

    await wait(40);
    expect(signals).toEqual([]);
  });

  test("each new output chunk resets the idle window", async () => {
    const detector = new CompletionDetector(30);
    const adapter = new FakeAdapter();
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);
    adapter.emitOutput("chunk 1");
    await wait(20);
    adapter.emitOutput("chunk 2"); // resets the 30ms window
    await wait(20);
    expect(signals).toEqual([]); // only 20ms since the last chunk

    await wait(20);
    expect(signals).toEqual(["a:idle-timeout"]);
  });

  // A chatty TUI's own idle chrome — cursor blink, cursor repositioning —
  // can arrive forever without the agent doing anything. If those bytes
  // counted as activity, the idle window would never elapse and the
  // fallback would never fire (the actual bug report: a real answer
  // already sat in the buffer while the node stayed "working" forever).
  test("pure ANSI/whitespace-only chunks (no visible text) don't reset the idle window", async () => {
    const detector = new CompletionDetector(30);
    const adapter = new FakeAdapter();
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);
    adapter.emitOutput("the real answer");
    await wait(20);
    adapter.emitOutput("\x1b[?25l\x1b[H\x1b[2K\x1b[?25h"); // cursor hide/home/clear-line/show — no text
    await wait(20); // 40ms since the real chunk, only 20ms since the noise

    // If the noise had reset the timer, this would still be empty.
    expect(signals).toEqual(["a:idle-timeout"]);
  });

  test("a chunk with real text alongside ANSI codes still resets the idle window normally", async () => {
    const detector = new CompletionDetector(30);
    const adapter = new FakeAdapter();
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);
    adapter.emitOutput("\x1b[31mstill thinking\x1b[0m");
    await wait(40);

    expect(signals).toEqual(["a:idle-timeout"]);
  });

  // The real bug report this guards against: a node whose process never
  // produces any output at all (hung on a first-run prompt, etc.) must
  // still eventually get rescued by the idle timer, not sit "working"
  // forever because nothing ever armed one.
  test("fires idle-timeout even when the adapter never produces any output", async () => {
    const detector = new CompletionDetector(20);
    const adapter = new FakeAdapter();
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);

    await wait(40);
    expect(signals).toEqual(["a:idle-timeout"]);
  });

  test("clearPendingIdleTimer cancels a timer already in flight", async () => {
    const detector = new CompletionDetector(20);
    const adapter = new FakeAdapter();
    const signals: string[] = [];
    detector.onSignal((nodeId, source) => signals.push(`${nodeId}:${source}`));

    detector.attach("a", adapter);
    adapter.emitOutput("output");
    detector.clearPendingIdleTimer("a");

    await wait(40);
    expect(signals).toEqual([]);
  });
});
