import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexTurns, indexByUuid, threadUuids } from "../src/core/transcriptParser";

// Claude Code appends records inside a turn's byte range that do not descend from that
// turn's prompt: `system`/away_summary branches off the *previous* turn's tail, and
// `system`/compact_boundary is written with parentUuid null (a fresh root). Taking the
// last-written record as the turn's leaf walks straight past the turn's own prompt, so
// the reconstructed context is the previous turn's (or, for a null-parent leaf, empty).
const FIX = join(__dirname, "fixtures", "offthread.jsonl");

describe("turn leaf selection with off-thread trailing records", () => {
  it("picks a leaf that descends from the turn's own prompt", async () => {
    const turns = await indexTurns(FIX);
    expect(turns.map((t) => t.uuid)).toEqual(["D1", "U2", "A3"]);
  });

  it("reconstructs each turn's own prompt, not the previous turn's", async () => {
    const turns = await indexTurns(FIX);
    const meta = await indexByUuid(FIX);
    const threads = turns.map((t) => threadUuids(meta, t.uuid!));

    expect(threads[0]).toEqual(["U1", "A1", "D1"]);
    // away_summary is a sibling of U2 — it must not become the leaf and hide U2
    expect(threads[1]).toContain("U2");
    // compact_boundary has parentUuid null — as a leaf it collapses the thread to itself
    expect(threads[2]).toContain("U3");
    expect(threads[2]).toContain("A3");
  });

  it("keeps every turn's context strictly growing", async () => {
    const turns = await indexTurns(FIX);
    const meta = await indexByUuid(FIX);
    const sizes = turns.map((t) => threadUuids(meta, t.uuid!).length);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
  });
});
