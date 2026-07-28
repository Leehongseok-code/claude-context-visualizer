// Measured against a session's own `usage`, the per-segment estimator lands consistently
// wide of the mark — and consistently is the operative word. Across a session,
//
//   measured ≈ slope × recorded + intercept
//
// fits at R² > 0.99. The two terms mean different things and belong on different rows:
// `intercept` is what rides along no matter how long the conversation gets (the base
// system prompt and tool schemas, which the transcript never holds), while
// `(slope - 1) × recorded` grows with the content and is not missing content at all —
// it is the weight of rows already on screen that the estimator sized too small.
//
// Fitting per session rather than shipping a constant is deliberate: the slope ranges
// from 0.6 to 1.6 across the sessions on one machine, because it tracks what the
// conversation is made of. Inside one session it is stable.
export interface SessionCalibration {
  slope: number;
  intercept: number;
  r2: number;
  turns: number; // how many turns the fit saw
}

export interface CalibrationPoint {
  recorded: number; // sum of the segments the transcript actually holds
  measured: number; // realContextTokens from that turn's usage
}

// Below these the split would be asserting more than the data supports, and the panel
// keeps the single combined row instead.
const MIN_POINTS = 5;
const MIN_R2 = 0.9;

export function fitCalibration(points: CalibrationPoint[]): SessionCalibration | undefined {
  const pts = points.filter((p) => p.recorded > 0 && p.measured > 0);
  if (pts.length < MIN_POINTS) return undefined;

  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.recorded, 0) / n;
  const my = pts.reduce((a, p) => a + p.measured, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.recorded - mx) * (p.measured - my); den += (p.recorded - mx) ** 2; }
  if (den === 0) return undefined; // every turn the same size — nothing to fit against

  const slope = num / den;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (const p of pts) { ssRes += (p.measured - (slope * p.recorded + intercept)) ** 2; ssTot += (p.measured - my) ** 2; }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  if (!Number.isFinite(slope) || !Number.isFinite(intercept) || r2 < MIN_R2) return undefined;
  // A slope at or below 1 means the estimator is not undercounting on this session's
  // content, so there is no gap to break out — and a negative intercept would put the
  // invisible payload below zero. Either way, fall back to the single row.
  if (slope <= 1 || intercept < 0) return undefined;
  return { slope, intercept, r2, turns: n };
}

/** Turn indices to sample for the fit: evenly spread, so the fit sees the whole range. */
export function sampleTurns(total: number, max = 8): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const step = (total - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}
