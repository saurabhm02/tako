import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AgentProfile {
  id: string; // "" = the agent's own default config dir, no env override
  label: string;
}

// Claude Code reads CLAUDE_CONFIG_DIR (default $HOME/.claude); Pi reads
// PI_CODING_AGENT_DIR (default $HOME/.pi/agent) — both confirmed against
// the real CLIs, not guessed. A "profile" is just another local config
// directory sibling to the default one, named "<default>-<name>" (e.g.
// $HOME/.claude-saurabh) — discovered from disk, never parsed out of shell
// aliases (CLAUDE_CONFIG_DIR strings never reach the UI).
const PROFILE_KINDS: Record<string, { envVar: string; defaultDir: (home: string) => string }> = {
  "claude-code": { envVar: "CLAUDE_CONFIG_DIR", defaultDir: (home) => path.join(home, ".claude") },
  pi: { envVar: "PI_CODING_AGENT_DIR", defaultDir: (home) => path.join(home, ".pi", "agent") },
};

export function supportsProfiles(agentType: string): boolean {
  return agentType in PROFILE_KINDS;
}

export function listProfiles(agentType: string, homeDir: string = os.homedir()): AgentProfile[] {
  const kind = PROFILE_KINDS[agentType];
  if (!kind) return [];

  const defaultDir = kind.defaultDir(homeDir);
  const profiles: AgentProfile[] = [{ id: "", label: "Default" }];

  const parentDir = path.dirname(defaultDir);
  const prefix = `${path.basename(defaultDir)}-`;
  let entries: string[];
  try {
    entries = fs.readdirSync(parentDir);
  } catch {
    return profiles; // parent dir doesn't exist yet — just the default
  }

  for (const entry of entries.sort()) {
    if (!entry.startsWith(prefix)) continue;
    if (!fs.statSync(path.join(parentDir, entry)).isDirectory()) continue;
    const name = entry.slice(prefix.length);
    profiles.push({ id: name, label: name.charAt(0).toUpperCase() + name.slice(1) });
  }
  return profiles;
}

export function profileConfigDir(agentType: string, profileId: string, homeDir: string = os.homedir()): string {
  const kind = PROFILE_KINDS[agentType];
  const defaultDir = kind ? kind.defaultDir(homeDir) : "";
  return profileId ? `${defaultDir}-${profileId}` : defaultDir;
}

// The default profile means "don't override anything" — the agent's own
// normal env already points at its own default config dir.
export function profileEnv(agentType: string, profileId: string, homeDir: string = os.homedir()): Record<string, string> {
  const kind = PROFILE_KINDS[agentType];
  if (!kind || !profileId) return {};
  return { [kind.envVar]: profileConfigDir(agentType, profileId, homeDir) };
}
