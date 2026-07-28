export interface RawRecord {
  type?: string;
  subtype?: string;
  isMeta?: boolean;
  promptId?: string;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  logicalParentUuid?: string | null;
  isCompactSummary?: boolean;
  compactMetadata?: CompactMetadata;
  attributionSkill?: string;
  attributionMcpServer?: string;
  attributionMcpTool?: string;
  attachment?: any;
  message?: { role?: string; content?: any; model?: string };
  toolUseResult?: any;
  [k: string]: any;
}

// Emitted by Claude Code on a `system` / subtype:"compact_boundary" record when the
// conversation is compacted. Everything needed to monitor "how earlier context was
// summarized" without approximation.
export interface CompactMetadata {
  trigger?: string;              // "auto" | "manual"
  preTokens?: number;            // context size before compaction
  postTokens?: number;           // context size after
  cumulativeDroppedTokens?: number;
  durationMs?: number;
  preservedMessages?: { anchorUuid?: string; uuids?: string[]; allUuids?: string[] };
  [k: string]: any;
}

export type SegmentCategory =
  | "baseSystemPrompt" | "toolDefinitions" | "claudeMd" | "skill"
  | "hook" | "memory" | "mcpInstructions" | "toolUse" | "toolResult"
  | "user" | "assistant" | "thinking" | "systemReminder" | "compactionSummary";

export interface Segment {
  id: string;
  category: SegmentCategory;
  source: string;         // e.g. "CLAUDE.md", "hook:SessionStart", "skill:brainstorming"
  sourcePath?: string;    // clickable file path when known
  rawText: string;
  tokenEstimate: number;
  estimated: boolean;     // true = not captured in transcript (base prompt/tool schemas)
  note?: string;
  groupId?: string;       // context group (a prior turn, the summary, or the current turn)
  groupLabel?: string;
  isHistory?: boolean;    // true = belongs to a prior turn carried in as history
  compaction?: CompactMetadata; // set on a compactionSummary segment
  toolUseId?: string;     // the tool_use id, on both the call and its result — joins the two
  agentId?: string;       // the subagent this Agent/Task call launched (see linkSubagents)
  depth?: number;         // nesting level: 0 = this session, 1 = subagent, 2 = its subagent
  separateContext?: boolean; // subagent segment — its own context window, not this one's
}

export interface ContextGroup {
  id: string;
  label: string;
  isHistory: boolean;
  tokens: number;
}

export interface ConfigProvider {
  kind: "claudeMd" | "settings" | "memory" | "mcp";
  path: string;
  summary: string;
  content?: string;
}

export interface ConfigBlueprint {
  providers: ConfigProvider[];
  mcpServers: string[];
}

export interface SessionInfo {
  sessionId: string;
  filePath: string;
  cwd: string;
  mtimeMs: number;
}

export interface TurnIndex {
  turn: number;
  byteStart: number;
  byteEnd: number;
  promptPreview: string;
  timestamp?: string;
  uuid?: string;       // the turn-start record's uuid — the leaf we reconstruct context from
}

// Lightweight per-record metadata built in one streaming pass, used to walk the
// parentUuid thread (the exact message sequence Claude received).
export interface UuidMeta {
  parentUuid: string | null;
  byteStart: number;
  byteEnd: number;
  requestId?: string;      // assistant records of one API response share this
  toolUseIds?: string[];   // tool_use ids this record issues
  toolResultIds?: string[]; // tool_use ids this record answers
}
