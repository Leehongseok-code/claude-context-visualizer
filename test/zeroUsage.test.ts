import { describe, it, expect } from "vitest";
import { join } from "path";
import { readAllRecords } from "../src/core/transcriptParser";
import { assembleContext } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { ConfigBlueprint } from "../src/core/types";

// Claude Code writes an all-zero `usage` block on a record that never became an API
// request — a local stop-sequence completion, an aborted turn. Reading it as "the context
// was 0 tokens" throws away the real measurement one record earlier, and the panel then
// falls back to scaling by its own estimate, which keeps growing after a compaction and
// makes the context look like it never shrank.
const FIX = join(__dirname, "fixtures", "zerousage.jsonl");
const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: [] };

describe("usage records that measure nothing", () => {
  it("skips an all-zero usage block and reads the real measurement behind it", async () => {
    const { usage } = assembleContext(await readAllRecords(FIX), bp, est);
    expect(usage!.realContextTokens).toBe(304_763); // 2 + 1,796 + 302,965
    expect(usage!.cacheRead).toBe(302_965);
  });

  it("reports no measurement at all when every usage block is zero", async () => {
    const recs = await readAllRecords(FIX);
    const allZero = recs.map((r) =>
      (r.message as any)?.usage
        ? { ...r, message: { ...r.message, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } }
        : r
    );
    // undefined, not a zero total — the panel falls back to its own estimate rather
    // than claiming the model received nothing
    expect(assembleContext(allZero, bp, est).usage).toBeUndefined();
  });
});
