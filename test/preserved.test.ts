import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexByUuid, buildThread, threadUuids } from "../src/core/transcriptParser";
import { assembleContext } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { ConfigBlueprint } from "../src/core/types";

// Compaction replaces the old history with a summary but replays a tail of recent
// messages verbatim. Those live *before* the boundary, and the boundary is a fresh root
// (parentUuid null), so walking parentUuid from the leaf never reaches them — yet the
// model received every one.
const FIX = join(__dirname, "fixtures", "preserved.jsonl");
const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: [] };

describe("compaction-preserved messages", () => {
  it("restores the replayed messages the parentUuid walk cannot reach", async () => {
    const meta = await indexByUuid(FIX);
    const order = threadUuids(meta, "A1");
    expect(order).toContain("K1");
    expect(order).toContain("K2");
  });

  it("replays them after the summary, not at their original byte position", async () => {
    const meta = await indexByUuid(FIX);
    expect(threadUuids(meta, "A1")).toEqual(["CB", "SUM", "K1", "K2", "U1", "A1"]);
  });

  it("still drops history that compaction genuinely summarized away", async () => {
    const meta = await indexByUuid(FIX);
    const order = threadUuids(meta, "A1");
    expect(order).not.toContain("m1");
    expect(order).not.toContain("m2");
  });

  it("ignores preserved uuids with no record in this file", async () => {
    const meta = await indexByUuid(FIX);
    // allUuids lists GONE, which was written by an earlier session file
    expect(threadUuids(meta, "A1")).not.toContain("GONE");
  });

  it("counts the replayed messages toward the turn's context", async () => {
    const meta = await indexByUuid(FIX);
    const { segments } = assembleContext(await buildThread(FIX, meta, "A1"), bp, est);
    const kept = segments.find((s) => s.rawText.includes("kept prompt replayed verbatim"));
    expect(kept).toBeTruthy();
    expect(kept!.tokenEstimate).toBeGreaterThan(0);
  });
});
