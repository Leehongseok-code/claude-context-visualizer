import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexTurns, readTurn, firstPromptPreview } from "../src/core/transcriptParser";

const FIX = join(__dirname, "fixtures", "sample.jsonl");

describe("transcriptParser", () => {
  it("indexes two turns keyed on real user prompts", async () => {
    const turns = await indexTurns(FIX);
    expect(turns.length).toBe(2);
    expect(turns[0].promptPreview).toContain("first question");
    expect(turns[1].promptPreview).toContain("두번째");
  });
  it("does not start a turn on a tool_result-only user record", async () => {
    // fixture has a promptId'd user record whose content is only a tool_result;
    // it must fold into turn 0, not create a phantom empty-text turn.
    const turns = await indexTurns(FIX);
    expect(turns.length).toBe(2);
    expect(turns.every(t => t.promptPreview.trim().length > 0)).toBe(true);
    const recs = await readTurn(FIX, turns[0]);
    expect(recs.some(r => r.promptId === "p1b")).toBe(true); // folded into turn 0
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
  it("firstPromptPreview returns the first real user prompt", async () => {
    const preview = await firstPromptPreview(FIX);
    expect(preview).toContain("first question about widgets");
  });
});
