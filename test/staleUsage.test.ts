import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexByUuid, buildThread } from "../src/core/transcriptParser";
import { assembleContext } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { ConfigBlueprint } from "../src/core/types";

// Compaction replays a tail of earlier messages verbatim, and those records still carry
// the `usage` of the request they were originally part of — a pre-compaction figure.
// Reading one as the current context size makes a turn whose context just collapsed
// report the size it had before, and the whole difference then lands in the
// not-in-transcript remainder.
const FIX = join(__dirname, "fixtures", "staleusage.jsonl");
const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: [] };

describe("usage on replayed messages", () => {
  it("measures the turn from a record written after the boundary", async () => {
    const meta = await indexByUuid(FIX);
    const { usage } = assembleContext(await buildThread(FIX, meta, "A1"), bp, est);
    expect(usage!.realContextTokens).toBe(9_604); // 4 + 600 + 9,000
    expect(usage!.realContextTokens).not.toBe(231_748); // the replayed record's figure
  });

  it("reports no measurement when only replayed records carry one", async () => {
    const meta = await indexByUuid(FIX);
    // the state right after /compact: summary in, nothing new answered yet
    const { usage } = assembleContext(await buildThread(FIX, meta, "U1"), bp, est);
    expect(usage).toBeUndefined();
  });

  it("still replays the messages themselves into the context", async () => {
    const meta = await indexByUuid(FIX);
    const thread = await buildThread(FIX, meta, "A1");
    expect(thread.map((r) => r.uuid)).toEqual(["CB", "SUM", "K1", "K2", "U1", "A1"]);
  });
});
