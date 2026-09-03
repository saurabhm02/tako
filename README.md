# Tako

Tako is a macOS desktop application that lets you compose, connect, and execute multi-agent AI workflows on an interactive canvas.

Instead of multiplexing terminal tabs or manually copying diffs and context between CLI tools, Tako runs real agent sessions (`claude`, `codex`, `agy`, `gemini`, `pi`, or raw shells) inside isolated node harnesses and routes context across explicit graph connections.

```
┌────────────────────────────────────────────────────────┐
│                   React Flow Canvas                    │
│   [Claude Code] ────(Handoff)────► [Codex Reviewer]    │
│         │                                 │            │
│     (Handoff)                             │            │
│         ▼                                 ▼            │
│   [Terminal Test] ◄───────────────────────┘            │
└───────────────────────────┬────────────────────────────┘
                            │
                  Typed Electron IPC
                            │
┌───────────────────────────▼────────────────────────────┐
│                    Workflow Runtime                    │
│  • Topological DAG scheduler & concurrency manager     │
│  • Step handoff queue with review gate / auto-approve  │
│  • Local SQLite database (runs, events, snapshots)     │
└───────────────────────────┬────────────────────────────┘
                            │
               PTY & AppServer Adapters
                            │
┌───────────────────────────▼────────────────────────────┐
│                  Local CLI Processes                   │
│   claude-code | codex | agy | gemini | pi | bash/zsh   │
└────────────────────────────────────────────────────────┘
```

---

## Why Tako?

1. **Wraps Real CLIs (No Toy API Re-implementations)**
   Tako doesn't make simplified OpenAI/Anthropic API calls pretending to be agents. It launches the actual binaries installed on your `PATH` via pseudo-terminals (`node-pty`) or native app-servers, preserving tools, MCP configs, permissions, and shell context.

2. **Deterministic Context Isolation**
   Agents only receive context across edges you draw on the canvas. If two nodes aren't connected, they share zero context. Every handoff payload can be inspected and edited before delivery, or set to auto-approve.

3. **Local-First & Offline-Safe**
   All graph topology, node configs, terminal buffers, and execution histories persist to a local SQLite database (`better-sqlite3`). No cloud backend, telemetry, or remote storage required.

4. **Secret Sanitization**
   Output streams and error events are scrubbed before reaching UI renderers or SQLite event logs to prevent leaking API keys (`sk-*`, `AIza*`, `ghp_*`, `AKIA*`, Bearer tokens).

---

## Architecture & Internals

Tako is structured into three main layers:

* **Renderer (`src/renderer`)**: Built with React, React Flow, and Xterm.js. Handles whiteboard interaction, viewport controls, terminal rendering, node task prompt drawers, live execution states, and the activity timeline.
* **Electron Preload & Typed IPC (`src/preload`, `src/main/ipc`)**: Secure context bridge exposing strictly typed asynchronous operations (`runtime:start`, `runtime:cancel`, `runtime:retry`, `workflows:*`, `nodes:*`) and real-time runtime event streaming (`runtime:event`).
* **Main Runtime Engine (`src/main/runtime`)**: Headless graph execution engine. Resolves topological dependencies, coordinates concurrent branches, manages handoff delivery queues, detects process turn completion, and writes audit trails to SQLite.

---

## Supported CLI Adapters

Tako dynamically checks your system `PATH` at runtime and enables adapters only when the binary is installed:

| Agent | CLI Executable | Adapter Type | Features |
|---|---|---|---|
| **Claude Code** | `claude` | PTY / Terminal | Live terminal streaming, session resume, cost tracking |
| **Codex** | `codex` | AppServer / Terminal | JSON-RPC thread integration, real-time delta stream |
| **Antigravity** | `agy` | PTY / Terminal | Native star theme, full CLI tool support |
| **Gemini CLI** | `gemini` | PTY / Terminal | Official Google Gemini CLI wrapper |
| **Pi** | `pi` | PTY / Terminal | Subagent runner, transcript tailing |
| **Kiro / Kimi** | `kiro` / `kimi` | PTY / Terminal | PTY terminal streaming |
| **Terminal** | `bash` / `zsh` | Login Shell | Arbitrary shell scripts, build pipelines, test runners |
| **Note** | — | Passive | Markdown documentation & scratchpad |

---

## Getting Started

### Prerequisites

* macOS (Apple Silicon or Intel)
* [Bun](https://bun.sh) (v1.1+ recommended)
* At least one supported AI CLI tool installed (e.g. `claude`, `codex`, `gemini`)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-username/tako.git
cd tako

# Install dependencies
bun install

# Start the desktop app in dev mode (Vite + Electron)
bun run start
```

### Scripts

```bash
# Run test suite (550+ unit and integration tests)
bun test

# Typecheck whole codebase
bun run typecheck

# Package the application for macOS (arm64 / x64)
bun run package
```

---

## Repository Layout

```text
tako/
├── src/
│   ├── main/
│   │   ├── adapters/         # CLI runners (PTY wrappers, session clients)
│   │   ├── graph/            # Connection routing and cycle detection
│   │   ├── handoff-engine/   # Handoff queues, review gates, payload payloads
│   │   ├── ipc/              # Typed IPC handlers for Electron
│   │   ├── node-manager/     # Process lifecycle and turn completion heuristics
│   │   ├── runtime/          # Headless DAG execution scheduler and runner
│   │   └── store/            # SQLite schemas and repositories
│   ├── preload/              # Secure Electron preload bridge
│   ├── renderer/             # React Flow whiteboard, node components, CSS
│   └── shared/               # Shared domain types, sanitizers, graph algorithms
├── docs/                     # Architecture Decision Records (ADRs) and specs
├── CONTEXT.md                # Project glossary and core domain concepts
└── package.json
```

---

## License

MIT
