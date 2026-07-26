import { basename } from "path";
import { RawRecord, Segment, SegmentCategory, ConfigBlueprint, ContextGroup, CompactMetadata } from "./types";
import { TokenEstimator } from "./tokenEstimator";
import { PayloadCalibration, BUILTIN_CALIBRATION } from "./payloadModel";

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

function makeMk(est: TokenEstimator): Mk {
  let counter = 0;
  return (category, source, rawText, opts = {}) => ({
    id: `seg-${counter++}`,
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
      let category: SegmentCategory = "user";
      let source = "user";
      if (content.includes("<claudeMd>")) { category = "claudeMd"; source = "CLAUDE.md"; }
      else if (content.includes("<system-reminder>")) { category = "systemReminder"; source = "system-reminder"; }
      out.push(applyAttribution(mk(category, source, content), rec));
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "tool_result") {
          const name = b.tool_use_id ? toolNameById.get(b.tool_use_id) : undefined;
          const label = name ? toolSource(name, undefined).replace(/^tool:|^skill:|^mcp:/, "") : "tool";
          const { text, imageCount } = toolResultContent(b.content, rec.toolUseResult);
          const seg = mk("toolResult", `result:${name ? label : "tool"}`, text);
          if (imageCount > 0) {
            seg.tokenEstimate += imageCount * IMAGE_TOKEN_ESTIMATE;
            seg.note = `Includes ${imageCount} image${imageCount > 1 ? "s" : ""} — billed as image tokens (~${IMAGE_TOKEN_ESTIMATE.toLocaleString()} each), not as base64 text.`;
          }
          out.push(seg);
        } else if (b?.type === "text") {
          out.push(applyAttribution(mk("user", "user", b.text ?? ""), rec));
        }
      }
    }
    return out;
  }
  if (rec.type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === "thinking") out.push(applyAttribution(mk("thinking", "assistant:thinking", b.thinking ?? ""), rec));
      else if (b?.type === "text") out.push(applyAttribution(mk("assistant", "assistant", b.text ?? ""), rec));
      else if (b?.type === "tool_use") out.push(mk("toolUse", toolSource(b.name, b.input), prettyInput(b.input)));
    }
  }
  return out;
}

function estimatedHeader(mk: Mk, blueprint: ConfigBlueprint, est: TokenEstimator, cal: PayloadCalibration): Segment[] {
  // Sizes come from a real captured request (see payloadModel.ts), not a guess.
  const src = cal.source === "calibrated" ? "measured on this machine" : "measured from a reference capture";
  return [
    mk("baseSystemPrompt", "base-system-prompt", "", {
      estimated: true, tokenEstimate: Math.round(cal.systemPromptChars * 0.27),
      note: `Base system prompt — sent on every request but never written to the transcript. ~${cal.systemPromptChars.toLocaleString()} chars (${src}).`,
    }),
    mk("toolDefinitions", "tool-definitions", "", {
      estimated: true, tokenEstimate: Math.round(cal.toolSchemaChars * 0.27),
      note: `Tool JSON schemas for ${cal.toolCount} tools — sent on every request, never in the transcript. ~${cal.toolSchemaChars.toLocaleString()} chars (${src}).`,
    }),
  ];
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
  cal: PayloadCalibration = BUILTIN_CALIBRATION
): Segment[] {
  const mk = makeMk(est);
  const toolNameById = buildToolNameMap(records);
  const segs: Segment[] = [...estimatedHeader(mk, blueprint, est, cal)];
  for (const rec of records) segs.push(...classifyRecord(rec, mk, toolNameById));
  applyBlueprint(segs, blueprint, mk);
  markStrippedThinking(segs);
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
  cal: PayloadCalibration = BUILTIN_CALIBRATION
): AssembledContext {
  const mk = makeMk(est);
  const toolNameById = buildToolNameMap(records);
  const segments: Segment[] = [];
  const groups: ContextGroup[] = [];

  const SYS = "g-system";
  groups.push({ id: SYS, label: "System & config", isHistory: false, tokens: 0 });
  for (const s of estimatedHeader(mk, blueprint, est, cal)) { s.groupId = SYS; segments.push(s); }

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
  return { segments, groups, usage: readUsage(records) };
}
