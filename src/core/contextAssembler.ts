import { RawRecord, Segment, SegmentCategory, ConfigBlueprint } from "./types";
import { TokenEstimator } from "./tokenEstimator";

let counter = 0;
function mk(
  category: SegmentCategory, source: string, rawText: string,
  est: TokenEstimator, opts: Partial<Segment> = {}
): Segment {
  return {
    id: `seg-${counter++}`,
    category, source, rawText,
    tokenEstimate: opts.estimated ? (opts.tokenEstimate ?? 0) : est.estimate(rawText),
    estimated: opts.estimated ?? false,
    sourcePath: opts.sourcePath,
    note: opts.note,
  };
}

function decodeHook(att: any): { name: string; text: string } {
  const name = att.hookName ?? "unknown";
  let text = att.content ?? "";
  try {
    const parsed = JSON.parse(att.stdout ?? "{}");
    text = parsed?.hookSpecificOutput?.additionalContext ?? att.stdout ?? text;
  } catch { text = att.stdout ?? text; }
  return { name, text: String(text) };
}

function applyAttribution(seg: Segment, rec: RawRecord): Segment {
  if (rec.attributionSkill) { seg.category = "skill"; seg.source = `skill:${rec.attributionSkill}`; }
  else if (rec.attributionMcpServer) { seg.category = "mcpInstructions"; seg.source = `mcp:${rec.attributionMcpServer}`; }
  return seg;
}

export function assembleTurn(
  records: RawRecord[], blueprint: ConfigBlueprint, est: TokenEstimator
): Segment[] {
  counter = 0;
  const segs: Segment[] = [];

  segs.push(mk("baseSystemPrompt", "base-system-prompt", "", est, {
    estimated: true, tokenEstimate: 2500,
    note: "Base system prompt — constructed by the CLI at runtime, not captured in the transcript (rough estimate).",
  }));
  segs.push(mk("toolDefinitions", "tool-definitions", "", est, {
    estimated: true, tokenEstimate: blueprint.mcpServers.length * 250,
    note: "Tool JSON schemas — not captured; estimated from MCP server count (~250 tokens/server).",
  }));

  for (const rec of records) {
    if (rec.type === "attachment" && rec.attachment?.type === "hook_success") {
      const { name, text } = decodeHook(rec.attachment);
      segs.push(applyAttribution(mk("hook", `hook:${name}`, text, est), rec));
      continue;
    }

    const content = rec.message?.content;
    if (rec.type === "user") {
      if (typeof content === "string") {
        let category: SegmentCategory = "user";
        let source = "user";
        if (content.includes("<claudeMd>")) { category = "claudeMd"; source = "CLAUDE.md"; }
        else if (content.includes("<system-reminder>")) { category = "systemReminder"; source = "system-reminder"; }
        segs.push(applyAttribution(mk(category, source, content, est), rec));
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "tool_result") {
            const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
            segs.push(applyAttribution(mk("toolResult", "tool-result", t, est), rec));
          } else if (b?.type === "text") {
            segs.push(applyAttribution(mk("user", "user", b.text ?? "", est), rec));
          }
        }
      }
      continue;
    }

    if (rec.type === "assistant" && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "thinking") {
          segs.push(applyAttribution(mk("thinking", "assistant:thinking", b.thinking ?? "", est), rec));
        } else if (b?.type === "text") {
          segs.push(applyAttribution(mk("assistant", "assistant", b.text ?? "", est), rec));
        } else if (b?.type === "tool_use") {
          const t = `${b.name}(${JSON.stringify(b.input ?? {})})`;
          segs.push(applyAttribution(mk("assistant", "assistant:tool_use", t, est), rec));
        }
      }
    }
  }
  return segs;
}
