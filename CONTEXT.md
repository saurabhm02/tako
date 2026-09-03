# 🐙 Tako — Concepts & Common Terms

This guide explains the core words and concepts we use in **Tako** in simple, plain English. 

Whenever you are working on the code, talking to other developers, or prompting AI helpers, using these exact terms keeps everyone on the same page!

---

## 🧭 The Main Concepts

### 1. Canvas
The visual whiteboard where you see, arrange, drag, and connect all your agents.

### 2. Node
Any single card or box you drop onto the canvas.
* **Agent Node:** An active AI worker (like Claude Code, Codex, or Terminal) doing real coding work.
* **Note Node:** A simple sticky note for your own thoughts, plans, or project notes.
* **Compare Node:** A special card that sends the same question to multiple agents at the same time so you can compare their answers side-by-side.

> 💡 *Tip:* Call them **Nodes**, not generic "boxes". An agent is the tool itself (e.g. Claude); a node is that agent's specific card on your board.

### 3. Harness
The real CLI program or app running under the hood (for example, the actual `claude` or `codex` command installed on your computer). Tako drives the real tool — it never fakes it or replaces it with a watered-down API.

### 4. Adapter
The bridge code in Tako that talks to the harness. It types commands into the agent, listens for when it finishes, and reads the output just like a human sitting at the terminal would.

### 5. Connection
The line drawn between two nodes. 
* It is the **only way** data travels between agents. 
* If two nodes aren't connected by a line, they cannot see each other's work.
* Connections have arrows pointing from the source node to the destination node.

### 6. Handoff
The act of taking the result from one agent and passing it as the starting prompt to the next connected agent.
* **Payload:** The actual text or code being passed along. You can read or edit it before it gets sent.
* **Approval Gate:** The review step. By default, Tako pauses and asks you: *"Do you want to send this to the next agent?"* (You can also turn on *Auto-Approve* if you want it to run without asking).
* **Handoff Ready:** Means an agent finished its task and its output is ready for you to review and hand off.

### 7. Completion Signal
How Tako knows an agent has finished its work (e.g., when the CLI command exits or prints its completion message). You can also click **Mark Done** manually at any time if you want to move on right away.

### 8. Node Session
The memory of one agent node during a single run. As it works and gets handoffs, its chat and terminal history build up in that session. When you start a fresh workflow run, nodes get a clean, fresh start.

### 9. Working Directory
The local folder on your computer that the agent is working in (for example: `/Users/you/Developer/my-app`). Each node can work in its own project folder.

### 10. Hop Limit
A safety guard for loops. If you connect Agent A → Agent B → Agent A and turn on auto-approve, Tako sets a limit (e.g. 25 hops) so it doesn't run endlessly in a loop and use up your tokens without your supervision.

### 11. Workflow
The saved blueprint of your canvas — your nodes, layout, prompts, and connection lines. You can save multiple workflows (like *"Bug Fixer"*, *"Feature Builder"*, or *"Code Reviewer"*) and switch between them anytime.

### 12. Run
One execution of your workflow from start to finish. Every run is automatically recorded in your local history so you can see past logs, costs, and durations.

---

## 🎯 Quick Reference Cheat Sheet

| Term | What it means in plain English |
|---|---|
| **Canvas** | The visual workspace whiteboard |
| **Node** | A card on the canvas (Agent, Note, or Compare) |
| **Connection** | A line connecting two nodes |
| **Handoff** | Passing output from Agent A to Agent B |
| **Payload** | The text/data being handed off |
| **Workflow** | The saved layout of your connected nodes |
| **Run** | One execution of that workflow |
| **Adapter** | The code that drives the real CLI agent |
