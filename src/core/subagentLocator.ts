import { readdir } from "fs/promises";
import { dirname, join } from "path";
import { forEachLine } from "./transcriptParser";
import { RawRecord } from "./types";

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

// Which Agent call launched which agent, for the whole session file.
//
// This cannot be derived from an assembled context: launching several async agents
// fans the transcript out — each result record hangs off its own tool_use — so the
// parentUuid thread keeps only the branch the conversation continued from and drops
// the other results. The agentId lives in exactly those dropped results, so the link
// has to be indexed from the file rather than from the thread that is being rendered.
//
// A tool_use_id is only accepted when an Agent/Task call in the file actually owns it,
// so a stray "agentId:" in some other tool's output can never mint a link.
export async function indexAgentLaunches(filePath: string): Promise<Map<string, string>> {
  const agentCalls = new Set<string>();
  const claimed = new Map<string, string>();
  await forEachLine(filePath, (line) => {
    if (!line.trim()) return;
    let rec: RawRecord;
    try { rec = JSON.parse(line); } catch { return; }
    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_use" && b.id && (b.name === "Agent" || b.name === "Task")) {
        agentCalls.add(b.id);
      } else if (b.type === "tool_result" && b.tool_use_id) {
        const c = b.content;
        const text = typeof c === "string" ? c : JSON.stringify(c ?? "");
        const id = extractAgentId(text);
        if (id) claimed.set(b.tool_use_id, id);
      }
    }
  });
  const out = new Map<string, string>();
  for (const [toolUseId, agentId] of claimed) {
    if (agentCalls.has(toolUseId)) out.set(toolUseId, agentId);
  }
  return out;
}
