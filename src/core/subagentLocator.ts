import { readdir } from "fs/promises";
import { dirname, join } from "path";

const AGENT_FILE_RE = /^agent-([0-9a-f]+)\.jsonl$/;

// Claude Code writes each subagent's conversation to its own file:
//   <projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl
// Those records carry isSidechain:true and a parentUuid chain rooted at null, so
// they are a context window of their own and never show up in the parent thread.
export async function findSubagentFiles(
  sessionFilePath: string, sessionId: string
): Promise<Map<string, string>> {
  const dir = join(dirname(sessionFilePath), sessionId, "subagents");
  const out = new Map<string, string>();
  let files: string[];
  try { files = await readdir(dir); } catch { return out; } // older sessions have no subagents dir
  for (const f of files) {
    const m = AGENT_FILE_RE.exec(f);
    if (m) out.set(m[1], join(dir, f));
  }
  return out;
}

// The Agent/Task tool_result is internal metadata naming the agent it launched:
//   "agentId: a3a6d08e48dd95fe1 (internal ID - do not mention to user...)"
// That id is the only link from the parent transcript to the subagent's file. A
// subagent that spawns its own subagents carries the same marker, so resolving it
// recursively reaches nested agents too.
const AGENT_ID_RE = /agentId:\s*([0-9a-f]{8,})/;

export function extractAgentId(text: string): string | undefined {
  return AGENT_ID_RE.exec(text)?.[1];
}
