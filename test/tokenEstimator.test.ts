import { describe, it, expect } from "vitest";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";

describe("HeuristicTokenEstimator", () => {
  const est = new HeuristicTokenEstimator();
  it("names itself", () => expect(est.name).toBe("heuristic"));
  it("estimates ascii near chars/4", () => {
    const n = est.estimate("hello world");
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
  });
  it("weights CJK heavier per char", () => {
    const n = est.estimate("안녕하세요"); // 5 hangul syllables
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
  });
  it("returns 0 for empty", () => expect(est.estimate("")).toBe(0));
});
