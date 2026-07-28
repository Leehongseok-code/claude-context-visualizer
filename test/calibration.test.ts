import { describe, it, expect } from "vitest";
import { fitCalibration, sampleTurns } from "../src/core/calibration";

const line = (n: number, slope: number, intercept: number) =>
  Array.from({ length: n }, (_, i) => {
    const recorded = 5_000 + i * 10_000;
    return { recorded, measured: Math.round(slope * recorded + intercept) };
  });

// measured wanders independently of recorded — the shape a session would have if the
// relationship the split relies on did not hold
const scattered = [
  { recorded: 5_000, measured: 400_000 }, { recorded: 15_000, measured: 30_000 },
  { recorded: 25_000, measured: 350_000 }, { recorded: 35_000, measured: 60_000 },
  { recorded: 45_000, measured: 500_000 }, { recorded: 55_000, measured: 90_000 },
  { recorded: 65_000, measured: 420_000 }, { recorded: 75_000, measured: 120_000 },
];

describe("fitCalibration", () => {
  it("recovers the slope and intercept a session was generated from", () => {
    const c = fitCalibration(line(17, 1.398, 22_928))!;
    expect(c.slope).toBeCloseTo(1.398, 3);
    expect(Math.round(c.intercept)).toBe(22_928);
    expect(c.r2).toBeGreaterThan(0.999);
    expect(c.turns).toBe(17);
  });

  it("declines a fit it cannot stand behind", () => {
    expect(fitCalibration(line(4, 1.4, 20_000))).toBeUndefined();          // too few turns
    expect(fitCalibration(scattered)).toBeUndefined();                      // no linear relation
    expect(fitCalibration([])).toBeUndefined();
  });

  it("declines when there is no undercount to break out", () => {
    // the estimator overshoots on this session's content — one combined row is honest,
    // a negative "estimate gap" is not
    expect(fitCalibration(line(10, 0.75, 30_000))).toBeUndefined();
  });

  it("declines a negative intercept rather than reporting a negative payload", () => {
    expect(fitCalibration(line(10, 1.4, -50_000))).toBeUndefined();
  });

  it("ignores turns with no measurement", () => {
    const pts = [...line(6, 1.4, 20_000), { recorded: 9_999, measured: 0 }, { recorded: 0, measured: 9_999 }];
    expect(fitCalibration(pts)!.turns).toBe(6);
  });
});

describe("sampleTurns", () => {
  it("takes every turn when the session is short", () => {
    expect(sampleTurns(5)).toEqual([0, 1, 2, 3, 4]);
  });
  it("spreads the sample across a long session, ends included", () => {
    const s = sampleTurns(126);
    expect(s.length).toBe(8);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBe(125);
    expect([...new Set(s)].length).toBe(8); // no repeats
  });
});
