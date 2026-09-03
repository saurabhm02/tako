# 🐙 Tako — Visual Workspace for AI Coding Agents

**Tako** is a desktop application for macOS that lets you arrange, connect, and run multiple AI coding agents on an interactive visual canvas. 

Instead of juggling multiple terminal windows and copy-pasting code between tools, you can put agents like **Claude Code**, **Codex**, **ChatGPT**, **Antigravity**, **Gemini**, and **Pi** on a board, connect them together, and let them pass work to each other safely.

---

## 💡 What Tako Does

Think of Tako as a visual whiteboard for your AI agents:
1. **Add your agents:** Place your favorite coding agents on the canvas.
2. **Give them tasks:** Write specific instructions or prompts for each agent.
3. **Connect the dots:** Draw lines between agents to define who passes work to whom.
4. **Hit Run:** Watch the workflow execute step-by-step or in parallel, streaming terminal output in real time.
5. **Review & Inspect:** Check outputs, review diffs, explore execution history, or retry failed steps with one click.

---

## 🏗️ How It Works (App Architecture)

Tako is built with **Electron**, **React**, **TypeScript**, and **SQLite**. It runs 100% locally on your machine.

Here is how the parts talk to each other:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        TAKO DESKTOP APP                                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   🎨 RENDERER (User Interface)                                         │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  Visual Canvas (React Flow)                                     │   │
│   │   • Agent Cards (Claude, Codex, Antigravity, Terminal, Note)   │   │
│   │   • Task & Prompt Drawers                                      │   │
│   │   • Live Terminal Windows (Xterm.js)                           │   │
│   │   • Natural Command Bar & Voice Control                        │   │
│   │   • Live Activity Timeline & Run History Viewer                │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                   │
│                        ⚡ Typed Electron IPC Bridge                    │
│                                    │                                   │
│   ⚙️ MAIN PROCESS (Backend Engine)                                      │
│   ┌────────────────────────────────┴───────────────────────────────┐   │
│   │  Workflow Runtime & Graph Engine                               │   │
│   │   • Schedules node execution in correct topological order      │   │
│   │   • Coordinates handoffs between connected agents              │   │
│   │   • Manages concurrency, retries, and cancellation             │   │
│   │                                                                │   │
│   │  Adapter Registry & Process Runners                            │   │
│   │   • Detects installed CLIs on your PATH                        │   │
│   │   • Drives real pseudo-terminals (PTY) and session clients     │   │
│   │                                                                │   │
│   │  SQLite Persistence (better-sqlite3)                           │   │
│   │   • Workflows, nodes, connections, configs, and run history    │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                   │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │
                                     ▼
                ┌────────────────────────────────────────┐
                │   YOUR INSTALLED LOCAL CLI AGENTS      │
                │   • Claude Code (`claude`)             │
                │   • Codex (`codex`)                    │
                │   • Antigravity (`agy`)                │
                │   • Gemini (`gemini`)                  │
                │   • Pi (`pi`)                          │
                │   • System Terminal (`bash`/`zsh`)     │
                └────────────────────────────────────────┘
```

---

## ✨ Features Built Up to Now

* **🎨 Interactive Visual Canvas**: Drag, drop, pan, zoom, connect, and organize your AI workflow easily.
* **🔌 Real CLI Integration**: Runs your actual local CLI tools directly on your computer — no fake mockups or downgraded APIs.
* **🔍 Dynamic Agent Discovery**: Automatically detects which CLI tools are installed on your machine (`PATH`) and shows only what's ready to use.
* **📝 In-Node Task & Prompt Editor**: Write and edit instructions right inside each node. Prompts are saved automatically with your workflow.
* **⚡ Workflow Runtime Engine**: Runs full graphs of agents sequentially or in parallel. Passes output from one agent to the next automatically.
* **📺 Live Terminal Streaming**: See live terminal logs, color highlights, and progress as agents work.
* **📜 Execution History & Inspection**: Browse past runs, review outputs, check durations, and view handoff packets in read-only mode without messing up your canvas.
* **⏱️ Live Activity Timeline**: Real-time event log tracking every workflow start, node finish, handoff, or error.
* **🔁 One-Click Retry**: If an agent fails (like a network timeout), click `Retry` to resume from that exact step without re-running finished upstream work.
* **🛡️ Secret & Credential Safety**: Automatically masks API keys (OpenAI `sk-***`, Google `AIza***`, GitHub tokens, Bearer headers) so they never leak into logs or UI screenshots.
* **💬 Natural Command Bar & Voice**: Type or speak everyday commands like `"run workflow"`, `"retry Codex"`, `"duplicate this"`, or `"fit view"`.
* **💾 Reliable Local Persistence**: Everything is saved to a local SQLite database on your Mac. If your computer reboots or crashes, your work and history stay safe.

---

## 🚀 Quick Start

### Prerequisites
* **macOS** (Apple Silicon or Intel)
* **[Bun](https://bun.sh/)** installed (`curl -fsSL https://bun.sh/install | bash`)
* Any AI CLI agents you want to use (e.g. `claude`, `codex`, `agy`, `gemini`, `pi`)

### Installation & Running

```bash
# 1. Clone the repository
git clone https://github.com/your-username/tako.git
cd tako

# 2. Install dependencies
bun install

# 3. Start the application in development mode
bun run start
```

### Testing & Verification

```bash
# Run all unit and integration tests (550+ tests)
bun test

# Check TypeScript types
bun run typecheck

# Package the app for macOS
bun run package
```

---

## 📁 Project Structure

```text
tako/
├── src/
│   ├── main/                 # Electron main process (Backend)
│   │   ├── adapters/         # Adapters driving real CLI processes (Claude, Codex, etc.)
│   │   ├── ipc/              # Typed IPC handlers connecting frontend to backend
│   │   ├── runtime/          # Workflow runtime graph engine and execution scheduler
│   │   └── store/            # SQLite database repositories (workflows, runs, logs)
│   ├── preload/              # Secure Electron preload bridge
│   ├── renderer/             # Frontend UI (React + React Flow)
│   │   └── canvas/           # Canvas components, node cards, toolbars, timeline, history
│   └── shared/               # Shared types, validation rules, graph utilities, secret sanitizer
├── docs/                     # Architecture designs, decision records (ADRs), and PRDs
├── CONTEXT.md                # Project terminology dictionary and concepts glossary
└── package.json              # App configuration and scripts
```

---

## ❓ Frequently Asked Questions

### What is the `CONTEXT.md` file?
`CONTEXT.md` is our **project dictionary**. It defines the exact terms we use across the codebase (like what a *Node*, *Connection*, *Handoff*, *Payload*, or *Run* means). It helps all developers, contributors, and AI assistants use the exact same terminology and mental model.

### Should `CONTEXT.md` be added to Git?
**Yes, absolutely!** Keep `CONTEXT.md` in Git. It is important documentation for the project, contains zero secrets, and ensures everyone working on Tako understands the core concepts.

---

## 📄 License
MIT License. Built with ❤️ for the AI developer community.
