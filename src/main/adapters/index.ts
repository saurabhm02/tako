import { registerAdapter } from "./registry";
import { createClaudeCodeAdapter } from "./terminal/claudeCode";
import { createPiAdapter } from "./terminal/pi";
import { createCodexAdapter } from "./terminal/codex";
import { createGeminiAdapter } from "./terminal/gemini";
import { createKiroAdapter } from "./terminal/kiro";
import { createKimiAdapter } from "./terminal/kimi";
import { createBashAdapter } from "./terminal/bash";
import { createAntigravityAdapter } from "./terminal/antigravity";
import { createCodexAppServerAdapter } from "./session/codexAppServer";

export function registerBuiltinAdapters(): void {
  registerAdapter({
    agentType: "claude-code",
    displayName: "Claude Code",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createClaudeCodeAdapter,
    checkCommand: "claude",
    shortcut: "C",
    order: 1,
    brandColor: "#d97757", // Claude Orange
  });

  registerAdapter({
    agentType: "pi",
    displayName: "Pi",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createPiAdapter,
    checkCommand: "pi",
    shortcut: "P",
    order: 2,
    brandColor: "#a78bfa", // Pi Lavender
  });

  registerAdapter({
    agentType: "codex",
    displayName: "Codex",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createCodexAdapter,
    checkCommand: "codex",
    shortcut: "X",
    order: 3,
    brandColor: "#10a37f", // OpenAI Green
  });

  registerAdapter({
    agentType: "bash",
    displayName: "Terminal",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createBashAdapter,
    shortcut: "T",
    order: 4,
    brandColor: "#38bdf8", // Terminal Cyan
  });

  registerAdapter({
    agentType: "codex-chatgpt",
    displayName: "ChatGPT",
    kind: "session",
    workingDirectoryRequired: false,
    factory: createCodexAppServerAdapter,
    checkCommand: "codex",
    shortcut: "G",
    order: 5,
    brandColor: "#10a37f", // OpenAI Green
  });

  registerAdapter({
    agentType: "antigravity",
    displayName: "Antigravity",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createAntigravityAdapter,
    checkCommand: "agy",
    shortcut: "A",
    order: 6,
    brandColor: "#8b5cf6", // Antigravity Purple
  });

  registerAdapter({
    agentType: "gemini",
    displayName: "Gemini",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createGeminiAdapter,
    checkCommand: "gemini",
    shortcut: "M",
    order: 7,
    brandColor: "#4285f4", // Google Blue
  });

  registerAdapter({
    agentType: "kiro",
    displayName: "Kiro",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createKiroAdapter,
    checkCommand: "kiro",
    shortcut: "K",
    order: 8,
    brandColor: "#f472b6", // Kiro Pink
  });

  registerAdapter({
    agentType: "kimi",
    displayName: "Kimi",
    kind: "terminal",
    workingDirectoryRequired: true,
    factory: createKimiAdapter,
    checkCommand: "kimi",
    shortcut: "I",
    order: 9,
    brandColor: "#38bdf8", // Kimi Sky
  });
}
