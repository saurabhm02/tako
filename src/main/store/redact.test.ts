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

  test("masks bearer authorization headers and tokens", () => {
    const text = "Authorization: Bearer my_secret_bearer_token_1234567890";
    expect(redactSecrets(text)).toBe("Authorization: [REDACTED]");
  });

  test("masks JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const text = `Session payload: ${jwt}`;
    expect(redactSecrets(text)).toBe("Session payload: [REDACTED]");
  });

  test("leaves ordinary text alone", () => {
    const text = "The secret code is BANANA77, nothing sensitive here.";
    expect(redactSecrets(text)).toBe(text);
  });
});
