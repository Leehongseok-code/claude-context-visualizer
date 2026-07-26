import { Segment, SegmentCategory } from "./types";

const COLORS: Record<SegmentCategory, string> = {
  baseSystemPrompt: "#6b7280", toolDefinitions: "#9ca3af", claudeMd: "#2563eb",
  skill: "#7c3aed", hook: "#dc2626", memory: "#0d9488", mcpInstructions: "#d97706",
  toolUse: "#ca8a04", toolResult: "#65a30d", user: "#0891b2", assistant: "#4f46e5",
  thinking: "#a855f7", systemReminder: "#db2777", compactionSummary: "#e11d48",
};

export function categoryColor(cat: SegmentCategory): string {
  return COLORS[cat] ?? "#888888";
}

export interface CategoryTotal { category: SegmentCategory; tokens: number; }
export interface WasteFlag { segmentId: string; kind: "large" | "repeated" | "estimated"; detail: string; }
export interface ViewModel {
  segments: Segment[];
  totalTokens: number;
  byCategory: CategoryTotal[];
  top: Segment[];
  wasteFlags: WasteFlag[];
}

const LARGE_THRESHOLD = 1500;

export function buildViewModel(segments: Segment[], previous?: Segment[]): ViewModel {
  const totalTokens = segments.reduce((n, s) => n + s.tokenEstimate, 0);

  const byMap = new Map<SegmentCategory, number>();
  for (const s of segments) byMap.set(s.category, (byMap.get(s.category) ?? 0) + s.tokenEstimate);
  const byCategory = [...byMap.entries()]
    .map(([category, tokens]) => ({ category, tokens }))
    .sort((a, b) => b.tokens - a.tokens);

  const top = [...segments].filter(s => !s.estimated)
    .sort((a, b) => b.tokenEstimate - a.tokenEstimate).slice(0, 3);

  const prevTexts = new Set((previous ?? []).map(s => s.rawText).filter(Boolean));
  const wasteFlags: WasteFlag[] = [];
  for (const s of segments) {
    if (s.estimated) wasteFlags.push({ segmentId: s.id, kind: "estimated", detail: "Not captured in transcript (estimated)." });
    if (s.tokenEstimate >= LARGE_THRESHOLD) wasteFlags.push({ segmentId: s.id, kind: "large", detail: `${s.tokenEstimate} tokens` });
    if (s.rawText && prevTexts.has(s.rawText)) wasteFlags.push({ segmentId: s.id, kind: "repeated", detail: "Re-injected from previous turn." });
  }

  return { segments, totalTokens, byCategory, top, wasteFlags };
}
