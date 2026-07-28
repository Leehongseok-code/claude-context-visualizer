import { basename } from "path";
import { RawRecord, Segment, SegmentCategory, ConfigBlueprint, ContextGroup, CompactMetadata } from "./types";
import { TokenEstimator } from "./tokenEstimator";
import { PayloadCalibration, BUILTIN_CALIBRATION } from "./payloadModel";
import { extractAgentId, AgentLaunch } from "./subagentLocator";
import { contextWindowFor, threadModel } from "./modelLimits";

function decodeHook(att: any): { name: string; text: string } {
  const name = att.hookName ?? "unknown";
  let text = att.content ?? "";
  try {
    const parsed = JSON.parse(att.stdout ?? "{}");
    text = parsed?.hookSpecificOutput?.additionalContext ?? att.stdout ?? text;
  } catch { text = att.stdout ?? text; }
  return { name, text: String(text) };
}

// Attribution reclassifies only reasoning/text records (thinking/assistant) to
// the skill/mcp they were produced under. Tool calls/results keep their
// structural category — their skill/mcp origin is already encoded in the source.
function applyAttribution(seg: Segment, rec: RawRecord): Segment {
  if (seg.category !== "assistant" && seg.category !== "thinking") return seg;
  if (rec.attributionSkill) { seg.category = "skill"; seg.source = `skill:${rec.attributionSkill}`; }
  else if (rec.attributionMcpServer) { seg.category = "mcpInstructions"; seg.source = `mcp:${rec.attributionMcpServer}`; }
  return seg;
}

// Label a tool call by what it really is: a skill launch, an MCP call, or a plain tool.
function toolSource(name: string | undefined, input: any): string {
  const n = name ?? "tool";
  if (n === "Skill" && input && typeof input.skill === "string") return `skill:${input.skill}`;
  if (n.startsWith("mcp__")) return `mcp:${n.replace(/^mcp__/, "")}`;
  return `tool:${n}`;
}

function prettyInput(input: any): string {
  if (input == null) return "";
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

// An image block costs image tokens, not text tokens. Anthropic bills an image at
// roughly (width*height)/750 tokens, capped ~1600; without dimensions a screenshot
// sits around this. Counting its base64 as text overstated a single screenshot by
// ~150,000 tokens.
const IMAGE_TOKEN_ESTIMATE = 1500;

interface ToolResultContent { text: string; imageCount: number; }

// tool_result content may be a string, an Anthropic content-block array, or an object.
function toolResultContent(blockContent: any, toolUseResult: any): ToolResultContent {
  let imageCount = 0;
  const render = (x: any): string => {
    if (typeof x === "string") return x;
    if (x?.type === "image") { imageCount++; return "[image]"; }
    if (typeof x?.text === "string") return x.text;
    try { return JSON.stringify(x); } catch { return String(x); }
  };

  let s: string;
  if (typeof blockContent === "string") s = blockContent;
  else if (Array.isArray(blockContent)) s = blockContent.map(render).join("\n");
  else if (blockContent != null) s = render(blockContent);
  else s = "";

  if (!s.trim() && toolUseResult != null) {
    if (Array.isArray(toolUseResult)) s = toolUseResult.map(render).join("\n");
    else s = render(toolUseResult);
  }
  return { text: s, imageCount };
}

type Mk = (category: SegmentCategory, source: string, rawText: string, opts?: Partial<Segment>) => Segment;

function makeMk(est: TokenEstimator, prefix = "seg"): Mk {
  let counter = 0;
  return (category, source, rawText, opts = {}) => ({
    id: `${prefix}-${counter++}`,
    category, source, rawText,
    tokenEstimate: opts.estimated ? (opts.tokenEstimate ?? 0) : est.estimate(rawText),
    estimated: opts.estimated ?? false,
    sourcePath: opts.sourcePath,
    note: opts.note,
  });
}

function buildToolNameMap(records: RawRecord[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const rec of records) {
    const c = rec.message?.content;
    if (rec.type === "assistant" && Array.isArray(c)) {
      for (const b of c) if (b?.type === "tool_use" && b.id) m.set(b.id, b.name);
    }
  }
  return m;
}

const AUTO_INSERTED_NOTE =
  "Claude Code inserted this into the user turn; the human did not type it.";

// A `user`-role record is not the same thing as something a human typed. Claude Code
// writes skill bodies, slash-command expansions, task notifications, and reminders into
// the user turn — and flags them `isMeta`. Sorting the text by what it actually is keeps
// `user` meaning "a person typed this", which is the one thing nothing else can be.
//
// The `isMeta` check is deliberately last: it is a flag the transcript already sets to
// say "not a real user message", so anything the named rules miss — including wrappers
// that do not exist yet — still stays out of `user` instead of inflating it.
function classifyUserText(text: string, rec: RawRecord): { category: SegmentCategory; source: string } {
  if (text.includes("<claudeMd>")) return { category: "claudeMd", source: "CLAUDE.md" };
  if (text.includes("<user-memory-input>")) return { category: "memory", source: "user-memory" };
  const skill = /^Base directory for this skill:\s*(\S+)/.exec(text);
  if (skill) {
    const name = skill[1].split("/").filter(Boolean).pop() ?? "skill";
    return { category: "skill", source: `skill:${name}` };
  }
  if (text.includes("<system-reminder>")) return { category: "systemReminder", source: "system-reminder" };
  if (/<command-(name|message|args)>|<local-command-(stdout|stderr|caveat)>/.test(text)) {
    return { category: "autoInserted", source: "auto-inserted:command" };
  }
  if (text.includes("<task-notification>")) return { category: "autoInserted", source: "auto-inserted:notification" };
  if (rec.isMeta === true) return { category: "autoInserted", source: "auto-inserted:meta" };
  return { category: "user", source: "user" };
}

function userTextSegment(text: string, rec: RawRecord, mk: Mk): Segment {
  const { category, source } = classifyUserText(text, rec);
  const seg = mk(category, source, text);
  if (category === "autoInserted") seg.note = AUTO_INSERTED_NOTE;
  return applyAttribution(seg, rec);
}

// One transcript record -> zero or more segments (hook / user / assistant blocks).
function classifyRecord(rec: RawRecord, mk: Mk, toolNameById: Map<string, string>): Segment[] {
  const out: Segment[] = [];
  if (rec.type === "attachment" && rec.attachment?.type === "hook_success") {
    const { name, text } = decodeHook(rec.attachment);
    out.push(applyAttribution(mk("hook", `hook:${name}`, text), rec));
    return out;
  }
  const content = rec.message?.content;
  if (rec.type === "user") {
    if (typeof content === "string") {
      out.push(userTextSegment(content, rec, mk));
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "tool_result") {
          const name = b.tool_use_id ? toolNameById.get(b.tool_use_id) : undefined;
          const label = name ? toolSource(name, undefined).replace(/^tool:|^skill:|^mcp:/, "") : "tool";
          const { text, imageCount } = toolResultContent(b.content, rec.toolUseResult);
          const seg = mk("toolResult", `result:${name ? label : "tool"}`, text);
          seg.toolUseId = b.tool_use_id;
          // An Agent/Task result names the subagent it launched; that id is what
          // lets the panel pull in that agent's own transcript on demand.
          if (name === "Agent" || name === "Task") seg.agentId = extractAgentId(text);
          if (imageCount > 0) {
            seg.tokenEstimate += imageCount * IMAGE_TOKEN_ESTIMATE;
            seg.note = `Includes ${imageCount} image${imageCount > 1 ? "s" : ""} — billed as image tokens (~${IMAGE_TOKEN_ESTIMATE.toLocaleString()} each), not as base64 text.`;
          }
          out.push(seg);
        } else if (b?.type === "text") {
          // Same sorting as the string branch above. It used to be missing here, so an
          // array-shaped record put a whole skill body under `user`.
          out.push(userTextSegment(b.text ?? "", rec, mk));
        }
      }
    }
    return out;
  }
  if (rec.type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === "thinking") out.push(applyAttribution(mk("thinking", "assistant:thinking", b.thinking ?? ""), rec));
      else if (b?.type === "text") out.push(applyAttribution(mk("assistant", "assistant", b.text ?? ""), rec));
      else if (b?.type === "tool_use") {
        const seg = mk("toolUse", toolSource(b.name, b.input), prettyInput(b.input));
        seg.toolUseId = b.id;
        out.push(seg);
      }
    }
  }
  return out;
}

// The base system prompt and the tool JSON schemas are sent on every request and written
// to the transcript on none of them, so there is no text to show and no way to tell the
// two apart from the log. They are one row, not two: splitting a number we cannot
// decompose into named parts would assert a breakdown nothing in the log supports.
function unrecordedRow(mk: Mk): Segment {
  return mk("unrecorded", "not-in-transcript", "", { estimated: true, tokenEstimate: 0 });
}

// Size it from the measurement when the transcript carries one — the remainder after
// everything the log does record. Only when there is no `usage` does it fall back to the
// reference capture's constant.
function sizeUnrecorded(row: Segment, segments: Segment[], usage: ContextUsage | undefined, cal: PayloadCalibration): void {
  const src = cal.source === "calibrated" ? "measured on this machine" : "a reference capture";
  const reference = Math.round((cal.systemPromptChars + cal.toolSchemaChars) * 0.27);
  if (usage) {
    const recorded = segments.reduce((n, s) => (s.estimated ? n : n + s.tokenEstimate), 0);
    row.tokenEstimate = Math.max(0, usage.realContextTokens - recorded);
    row.note =
      `The measured context minus everything the transcript records. It holds the base system prompt and ` +
      `the JSON schemas for the session's tools — neither is ever written to the transcript, so their sizes ` +
      `cannot be separated here — plus whatever the per-segment estimator got wrong. ` +
      `For scale, ${src} put the prompt and schemas together at ~${reference.toLocaleString()} tokens.`;
    return;
  }
  row.tokenEstimate = reference;
  row.note =
    `Base system prompt + tool JSON schemas — sent on every request, never written to the transcript. ` +
    `Sized at ~${reference.toLocaleString()} tokens from ${src}; this turn records no \`usage\` to measure it against.`;
}

function applyBlueprint(segs: Segment[], blueprint: ConfigBlueprint, mk: Mk, groupId?: string): void {
  const produced = new Set(segs.map((s) => s.category));
  for (const provider of blueprint.providers) {
    if (provider.kind !== "claudeMd" && provider.kind !== "memory") continue;
    const category: SegmentCategory = provider.kind === "claudeMd" ? "claudeMd" : "memory";
    if (!produced.has(category)) {
      const seg = mk(category, basename(provider.path), provider.content ?? "", { sourcePath: provider.path });
      if (groupId) { seg.groupId = groupId; }
      segs.push(seg);
    } else {
      for (const seg of segs) if (seg.category === category && !seg.sourcePath) seg.sourcePath = provider.path;
    }
  }
}

// Single-turn view: only the selected turn's own records (fast; no prior history).
export function assembleTurn(
  records: RawRecord[], blueprint: ConfigBlueprint, est: TokenEstimator,
  cal: PayloadCalibration = BUILTIN_CALIBRATION, launches?: AgentLaunch[]
): Segment[] {
  const mk = makeMk(est);
  const toolNameById = buildToolNameMap(records);
  const unrecorded = unrecordedRow(mk);
  const segs: Segment[] = [unrecorded];
  for (const rec of records) segs.push(...classifyRecord(rec, mk, toolNameById));
  applyBlueprint(segs, blueprint, mk);
  markStrippedThinking(segs);
  linkSubagents(segs, launches);
  // single-turn view: this turn's own records only, so a usage total covering the whole
  // thread would not describe them — always the reference constant here.
  sizeUnrecorded(unrecorded, segs, undefined, cal);
  return segs;
}

// The agentId only ever appears in the Agent/Task *result*, but the call is the
// better place to hang the subagent off: it holds the prompt the agent was given,
// so "what I asked" reads directly into "what it did". For an async agent the
// result is just launch metadata, which makes it a poor anchor for a whole
// conversation.
//
// `launches` is the session-wide tool_use_id -> agentId index. It is needed because
// async agents launched together fan the transcript out: each result hangs off its own
// tool_use, so the parentUuid thread keeps the one branch the conversation continued
// from and drops the other results. Joining only within the records being assembled
// therefore finds at most one agent no matter how many ran. The in-record join stays
// as the fallback for callers with no index (and for an agent's own nested calls).
function linkSubagents(segs: Segment[], launches?: AgentLaunch[]): void {
  const calls = new Map<string, Segment>();
  for (const s of segs) if (s.category === "toolUse" && s.toolUseId) calls.set(s.toolUseId, s);
  for (const s of segs) {
    if (s.category !== "toolResult" || !s.agentId || !s.toolUseId) continue;
    const call = calls.get(s.toolUseId);
    if (call) { call.agentId = s.agentId; s.agentId = undefined; }
  }
  if (!launches) return;
  for (const l of launches) {
    const call = calls.get(l.toolUseId);
    if (call && !call.agentId) call.agentId = l.agentId;
  }
}

// A subagent's own transcript. It ran in a separate context window, so its segments
// are marked `separateContext` and carry a nesting depth — the panel indents them
// under the Agent call that launched them and keeps them out of this turn's totals.
// No estimated header here: the base prompt/tool schemas are calibrated for the main
// agent, and guessing a subagent's would be inventing numbers.
export function assembleSubagent(
  records: RawRecord[], est: TokenEstimator, agentId: string, depth: number
): Segment[] {
  const mk = makeMk(est, `sub${depth}-${agentId}`);
  const toolNameById = buildToolNameMap(records);
  const segs: Segment[] = [];
  for (const rec of records) segs.push(...classifyRecord(rec, mk, toolNameById));
  for (const s of segs) { s.depth = depth; s.separateContext = true; }
  markStrippedThinking(segs);
  // An agent can spawn its own agents; no launch index is needed here because this
  // reads the agent's whole file rather than a thread, so no result is filtered out.
  linkSubagents(segs);
  return segs;
}

// context_management.clear_thinking removes thinking blocks from the request, so
// they are shown but must not count toward the input context.
function markStrippedThinking(segs: Segment[]): void {
  for (const s of segs) {
    if (s.category === "thinking") {
      s.tokenEstimate = 0;
      s.note = "Stripped from the request by context_management.clear_thinking — shown for reference, not counted as input.";
    }
  }
}

export interface ContextUsage {
  realContextTokens: number; // input + cache_creation + cache_read = true input size the model saw
  cacheRead: number;
  cacheCreation: number;
  freshInput: number;
  output: number;
}

export interface AssembledContext {
  segments: Segment[];
  groups: ContextGroup[];
  usage?: ContextUsage; // ground-truth token counts from the last assistant response
  model?: string;        // the model that answered — its window is the bar's ceiling
  contextWindow?: number;
}

// The real context size for a request = input + cache_creation + cache_read tokens.
function readUsage(records: RawRecord[]): ContextUsage | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const u = (records[i]?.message as any)?.usage;
    if (u && (u.input_tokens != null || u.cache_read_input_tokens != null)) {
      const freshInput = u.input_tokens ?? 0;
      const cacheCreation = u.cache_creation_input_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      return {
        realContextTokens: freshInput + cacheCreation + cacheRead,
        cacheRead, cacheCreation, freshInput,
        output: u.output_tokens ?? 0,
      };
    }
  }
  return undefined;
}

function isRealUserPrompt(rec: RawRecord): boolean {
  if (rec.type !== "user" || !rec.promptId || rec.isMeta === true) return false;
  const c = rec.message?.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) return c.some((b: any) => b?.type === "text" && String(b.text ?? "").trim().length > 0);
  return false;
}

function promptPreview(rec: RawRecord): string {
  const c = rec.message?.content;
  let t = "";
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) t = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ");
  return t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function fmt(n?: number): string {
  return n == null ? "?" : n.toLocaleString();
}

// Full-context view: the exact ordered message thread Claude received (built by
// walking parentUuid), grouped by turn, with compaction summaries rendered as
// first-class segments carrying the real compaction metadata.
export function assembleContext(
  records: RawRecord[], blueprint: ConfigBlueprint, est: TokenEstimator,
  cal: PayloadCalibration = BUILTIN_CALIBRATION, launches?: AgentLaunch[]
): AssembledContext {
  const mk = makeMk(est);
  const toolNameById = buildToolNameMap(records);
  const segments: Segment[] = [];
  const groups: ContextGroup[] = [];

  const SYS = "g-system";
  groups.push({ id: SYS, label: "System & config", isHistory: false, tokens: 0 });
  const unrecorded = unrecordedRow(mk);
  unrecorded.groupId = SYS;
  segments.push(unrecorded);

  let curGroup: ContextGroup | null = null;
  let pendingCompaction: CompactMetadata | undefined;
  let turnCounter = 0;

  const startGroup = (id: string, label: string): ContextGroup => {
    const g: ContextGroup = { id, label, isHistory: true, tokens: 0 };
    groups.push(g);
    curGroup = g;
    return g;
  };

  for (const rec of records) {
    if (rec.type === "system" && rec.subtype === "compact_boundary") {
      pendingCompaction = rec.compactMetadata; // stash for the summary that follows
      continue;
    }
    if (rec.isCompactSummary) {
      const g = startGroup(`g-compact-${groups.length}`, "🗜 Compacted summary");
      const c = rec.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => b?.text ?? "").join("\n") : "";
      const m = pendingCompaction;
      const note = m
        ? `Earlier conversation compacted (${m.trigger ?? "auto"}): ${fmt(m.preTokens)} → ${fmt(m.postTokens)} tokens` +
          (m.cumulativeDroppedTokens ? `, ~${fmt(m.cumulativeDroppedTokens)} dropped` : "") + "."
        : "Earlier conversation summarized into this block.";
      const seg = mk("compactionSummary", "compacted-summary", text, { note });
      seg.groupId = g.id; seg.groupLabel = g.label; seg.compaction = m;
      segments.push(seg);
      pendingCompaction = undefined;
      continue;
    }
    if (isRealUserPrompt(rec)) {
      turnCounter++;
      startGroup(`g-turn-${turnCounter}`, `turn ${turnCounter}: ${promptPreview(rec) || "(no text)"}`);
    }
    if (!curGroup) startGroup("g-start", "Session start");
    const segs = classifyRecord(rec, mk, toolNameById);
    for (const s of segs) { s.groupId = curGroup!.id; s.groupLabel = curGroup!.label; segments.push(s); }
  }

  applyBlueprint(segments, blueprint, mk, SYS);
  markStrippedThinking(segments);
  linkSubagents(segments, launches);
  const usage = readUsage(records);
  sizeUnrecorded(unrecorded, segments, usage, cal);

  // The last real turn group is the "current" turn; everything before it is history.
  const lastTurn = [...groups].reverse().find((g) => g.id.startsWith("g-turn-"));
  for (const g of groups) {
    g.isHistory = g.id !== SYS && !(lastTurn && g.id === lastTurn.id);
  }
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const s of segments) {
    const g = s.groupId ? byId.get(s.groupId) : undefined;
    if (g) { s.isHistory = g.isHistory; g.tokens += s.tokenEstimate; }
  }
  const model = threadModel(records);
  return { segments, groups, usage, model, contextWindow: contextWindowFor(model) };
}
