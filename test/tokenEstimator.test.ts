import { describe, it, expect } from "vitest";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";

describe("HeuristicTokenEstimator", () => {
  const est = new HeuristicTokenEstimator();
  it("names itself", () => expect(est.name).toBe("heuristic"));
  // Coefficients are calibrated against real `usage` totals (see tokenEstimator.ts),
  // so these assert the calibrated scale rather than a naive chars/4 rule.
  it("estimates ascii at roughly two chars per token", () => {
    const n = est.estimate("hello world"); // 10 latin + 1 space
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(8);
  });
  it("weights CJK heavier per char", () => {
    const n = est.estimate("안녕하세요"); // 5 hangul syllables ~ 5 tokens
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(7);
  });
  it("counts whitespace, which code and JSON are full of", () => {
    expect(est.estimate("a\n  b\n  c")).toBeGreaterThan(est.estimate("abc"));
  });
  it("returns 0 for empty", () => expect(est.estimate("")).toBe(0));
});
