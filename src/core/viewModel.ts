import { Segment, SegmentCategory } from "./types";

const COLORS: Record<SegmentCategory, string> = {
  unrecorded: "#9ca3af", claudeMd: "#2563eb",
  skill: "#7c3aed", hook: "#dc2626", memory: "#0d9488", mcpInstructions: "#d97706",
  toolUse: "#ca8a04", toolResult: "#65a30d", user: "#0891b2", autoInserted: "#78716c",
  assistant: "#4f46e5",
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
  /** Sum of segments actually present in the transcript — no estimates mixed in. */
  recordedTokens: number;
  /** Exact input size from the response's `usage`, when the transcript carries one. */
  measuredTokens?: number;
  /** measured - recorded: the base prompt, tool schemas, and estimator error. */
  unrecordedTokens?: number;
  byCategory: CategoryTotal[];
  top: Segment[];
  wasteFlags: WasteFlag[];
}

const LARGE_THRESHOLD = 1500;

// `measured` is ground truth and `tokenEstimate` is not, so the two are reported side by
// side rather than blended: the panel leads with what was measured and shows how much of
// it the reconstruction accounts for, instead of presenting a sum of guesses as a total.
export function buildViewModel(segments: Segment[], previous?: Segment[], measured?: number): ViewModel {
  const totalTokens = segments.reduce((n, s) => n + s.tokenEstimate, 0);
  const recordedTokens = segments.reduce((n, s) => (s.estimated ? n : n + s.tokenEstimate), 0);

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

  return {
    segments, totalTokens, recordedTokens, byCategory, top, wasteFlags,
    measuredTokens: measured,
    unrecordedTokens: measured == null ? undefined : Math.max(0, measured - recordedTokens),
  };
}
