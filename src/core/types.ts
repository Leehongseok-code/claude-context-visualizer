export interface RawRecord {
  type?: string;
  isMeta?: boolean;
  promptId?: string;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  attributionSkill?: string;
  attributionMcpServer?: string;
  attributionMcpTool?: string;
  attachment?: any;
  message?: { role?: string; content?: any; model?: string };
  toolUseResult?: any;
  [k: string]: any;
}

export type SegmentCategory =
  | "baseSystemPrompt" | "toolDefinitions" | "claudeMd" | "skill"
  | "hook" | "memory" | "mcpInstructions" | "toolResult"
  | "user" | "assistant" | "thinking" | "systemReminder";

export interface Segment {
  id: string;
  category: SegmentCategory;
  source: string;         // e.g. "CLAUDE.md", "hook:SessionStart", "skill:brainstorming"
  sourcePath?: string;    // clickable file path when known
  rawText: string;
  tokenEstimate: number;
  estimated: boolean;     // true = not captured in transcript (base prompt/tool schemas)
  note?: string;
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
}
