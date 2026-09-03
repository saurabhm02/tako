import { describe, expect, test } from "bun:test";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  test("masks a known Anthropic-style key", () => {
    const text = `here is my key: sk-ant-${"a".repeat(30)} — keep it secret`;
    expect(redactSecrets(text)).toBe("here is my key: [REDACTED] — keep it secret");
  });

  test("masks a GitHub token", () => {
    const text = `token=ghp_${"a".repeat(36)}`;
    expect(redactSecrets(text)).toBe("token=[REDACTED]");
  });

  test("leaves ordinary text alone", () => {
    const text = "The secret code is BANANA77, nothing sensitive here.";
    expect(redactSecrets(text)).toBe(text);
  });
});
