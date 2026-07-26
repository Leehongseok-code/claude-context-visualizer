import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexTurns, readTurn } from "../src/core/transcriptParser";

const FIX = join(__dirname, "fixtures", "sample.jsonl");

describe("transcriptParser", () => {
  it("indexes two turns keyed on real user prompts", async () => {
    const turns = await indexTurns(FIX);
    expect(turns.length).toBe(2);
    expect(turns[0].promptPreview).toContain("first question");
    expect(turns[1].promptPreview).toContain("두번째");
  });
  it("turn 1 includes the preceding hook attachment", async () => {
    const turns = await indexTurns(FIX);
    const recs = await readTurn(FIX, turns[0]);
    const kinds = recs.map(r => r.type);
    expect(kinds).toContain("attachment");
    expect(kinds).toContain("user");
    expect(kinds).toContain("assistant");
  });
  it("readTurn only reads that turn's slice", async () => {
    const turns = await indexTurns(FIX);
    const recs = await readTurn(FIX, turns[1]);
    expect(recs.some(r => r.attributionSkill === "brainstorming")).toBe(true);
    expect(recs.some(r => r.promptId === "p1")).toBe(false);
  });
});
