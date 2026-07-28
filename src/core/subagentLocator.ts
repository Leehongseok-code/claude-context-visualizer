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

// Agents this session launched that the rendered context does not reach: their Agent
// call sits on a branch the conversation moved off (an edited or re-sent prompt leaves
// one behind). They ran for real and their transcripts exist, so they are worth
// listing — apart from the context, never folded into it. Agents with no transcript on
// disk are dropped: there would be nothing to open.
export function offThreadLaunches(
  launches: AgentLaunch[], inView: Set<string>, onDisk: Set<string>
): AgentLaunch[] {
  const seen = new Set<string>();
  return launches.filter((l) => {
    if (inView.has(l.agentId) || !onDisk.has(l.agentId) || seen.has(l.agentId)) return false;
    seen.add(l.agentId);
    return true;
  });
}

export interface AgentLaunch {
  toolUseId: string;
  agentId: string;
  description?: string; // the Agent call's short description input
  prompt?: string;      // what the agent was asked to do
}

// Every Agent call in the session file and the agent it launched, in file order.
//
// This cannot be derived from an assembled context: launching several async agents
// fans the transcript out — each result record hangs off its own tool_use — so the
// parentUuid thread keeps only the branch the conversation continued from and drops
// the other results. The agentId lives in exactly those dropped results, so the link
// has to be indexed from the file rather than from the thread that is being rendered.
//
// A tool_use_id is only accepted when an Agent/Task call in the file actually owns it,
// so a stray "agentId:" in some other tool's output can never mint a link.
export async function indexAgentLaunches(filePath: string): Promise<AgentLaunch[]> {
  const calls = new Map<string, { description?: string; prompt?: string }>();
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
        calls.set(b.id, { description: b.input?.description, prompt: b.input?.prompt });
      } else if (b.type === "tool_result" && b.tool_use_id) {
        const c = b.content;
        const text = typeof c === "string" ? c : JSON.stringify(c ?? "");
        const id = extractAgentId(text);
        if (id) claimed.set(b.tool_use_id, id);
      }
    }
  });
  const out: AgentLaunch[] = [];
  for (const [toolUseId, agentId] of claimed) {
    const call = calls.get(toolUseId);
    if (call) out.push({ toolUseId, agentId, description: call.description, prompt: call.prompt });
  }
  return out;
}
