// Context window per model, so the composition bar can be drawn against the ceiling the
// conversation is actually filling rather than against its own running total.
//
// Only models whose window is published are listed. An id we cannot name returns
// undefined, and the panel falls back to scaling by what it measured — inventing a
// ceiling for an unknown model would put a number on the screen that nothing backs.
const M = 1_000_000;
const K = 1_000;

const WINDOWS: Record<string, number> = {
  "claude-fable-5": M,
  "claude-mythos-5": M,
  "claude-opus-5": M,
  "claude-opus-4-8": M,
  "claude-opus-4-7": M,
  "claude-opus-4-6": M,
  "claude-sonnet-5": M,
  "claude-sonnet-4-6": M,
  "claude-haiku-4-5": 200 * K,
  // Claude Code also records the bare tier alias when the model was picked by name;
  // each resolves to that tier's current model.
  fable: M,
  mythos: M,
  opus: M,
  sonnet: M,
  haiku: 200 * K,
};

// Transcripts carry decorated ids: a deployment suffix in brackets ("claude-opus-5[1m]")
// and, on dated snapshots, a trailing release date.
function normalize(model: string): string {
  return model.trim().toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "");
}

export function contextWindowFor(model?: string): number | undefined {
  if (!model) return undefined;
  return WINDOWS[normalize(model)];
}

// The model that produced the thread: the last record that names one. A turn can involve
// more than one (a Haiku title generation alongside the main model), and it is the model
// answering *now* whose window the context has to fit in.
export function threadModel(records: { message?: { model?: string } }[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const m = records[i]?.message?.model;
    if (m && contextWindowFor(m) != null) return m;
  }
  return undefined;
}
