import { describe, expect, test } from "bun:test";
import { createRequestSequencer } from "./requestSequencer";

describe("createRequestSequencer — the stale-async-result guard CommandBar relies on", () => {
  test("each start() is a distinct, monotonically increasing id", () => {
    const seq = createRequestSequencer();
    const a = seq.start();
    const b = seq.start();
    const c = seq.start();
    expect(new Set([a, b, c]).size).toBe(3);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  test("only the most recently started request is current", () => {
    const seq = createRequestSequencer();
    const a = seq.start();
    const b = seq.start();
    expect(seq.isCurrent(a)).toBe(false);
    expect(seq.isCurrent(b)).toBe(true);
  });

  test("the exact race this exists for: request A starts, request B starts before A finishes, A's late result must not look current", () => {
    const seq = createRequestSequencer();
    const requestA = seq.start(); // e.g. an LLM call kicked off first
    // ...time passes, the user edits the text or a voice transcript
    // arrives, and a second request starts before A ever resolves...
    const requestB = seq.start();
    // ...A's network call finally resolves, late:
    expect(seq.isCurrent(requestA)).toBe(false); // A must not be allowed to touch state
    expect(seq.isCurrent(requestB)).toBe(true); // B is what the user is actually looking at
  });

  test("a chain of several stale requests in a row — only the very last one is ever current", () => {
    const seq = createRequestSequencer();
    const ids = [seq.start(), seq.start(), seq.start(), seq.start()];
    const last = ids[ids.length - 1];
    for (const id of ids) {
      expect(seq.isCurrent(id)).toBe(id === last);
    }
  });

  test("a single request with nothing started after it stays current indefinitely (the common, non-overlapping case)", () => {
    const seq = createRequestSequencer();
    const only = seq.start();
    expect(seq.isCurrent(only)).toBe(true);
    expect(seq.isCurrent(only)).toBe(true); // checking twice must not itself consume/invalidate it
  });
});
