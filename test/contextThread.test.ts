import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexByUuid, buildThread, threadUuids } from "../src/core/transcriptParser";
import { assembleContext } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { ConfigBlueprint } from "../src/core/types";

const FIX = join(__dirname, "fixtures", "thread.jsonl");
const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: [] };

describe("parentUuid thread reconstruction", () => {
  it("walks parentUuid from a leaf and stops at the compact boundary (drops summarized history)", async () => {
    const meta = await indexByUuid(FIX);
    const order = threadUuids(meta, "A2");
    expect(order).toEqual(["CB", "SUM", "U1", "A1", "U2", "A2"]);
    // pre-compaction messages are NOT in the thread Claude received
    expect(order).not.toContain("m1");
    expect(order).not.toContain("m2");
  });

  it("materializes the thread records in root->leaf order", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "A2");
    expect(recs.map((r) => r.uuid)).toEqual(["CB", "SUM", "U1", "A1", "U2", "A2"]);
  });
});

describe("assembleContext", () => {
  it("emits a compaction-summary segment carrying the real compaction metadata", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "A2");
    const { segments } = assembleContext(recs, bp, est);
    const summary = segments.find((s) => s.category === "compactionSummary")!;
    expect(summary).toBeTruthy();
    expect(summary.compaction?.preTokens).toBe(738375);
    expect(summary.compaction?.postTokens).toBe(31652);
    expect(summary.note).toContain("738,375");
    expect(summary.rawText).toContain("continued from a previous conversation");
  });

  it("groups by turn and marks all but the current turn as history", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "A2");
    const { segments, groups } = assembleContext(recs, bp, est);

    const turnGroups = groups.filter((g) => g.id.startsWith("g-turn-"));
    expect(turnGroups.length).toBe(2);
    // last turn group is current (not history)
    expect(turnGroups[turnGroups.length - 1].isHistory).toBe(false);
    expect(turnGroups[0].isHistory).toBe(true);

    const second = segments.find((s) => s.category === "user" && s.rawText.includes("second task"))!;
    const first = segments.find((s) => s.category === "user" && s.rawText.includes("first task"))!;
    expect(second.isHistory).toBe(false); // current turn
    expect(first.isHistory).toBe(true); // prior turn carried as history
  });

  it("reports the real context size from the last assistant's usage", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "A2");
    const { usage } = assembleContext(recs, bp, est);
    expect(usage).toBeTruthy();
    // input(5) + cache_creation(1200) + cache_read(30000)
    expect(usage!.realContextTokens).toBe(31205);
    expect(usage!.cacheRead).toBe(30000);
    expect(usage!.output).toBe(42);
  });

  it("sizes the system prompt and tool schemas from the measured capture, not a guess", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "A2");
    const { segments } = assembleContext(recs, bp, est);
    const sys = segments.find((s) => s.category === "baseSystemPrompt")!;
    const tools = segments.find((s) => s.category === "toolDefinitions")!;
    // 9,733 and 85,896 chars measured from a real captured request
    expect(sys.tokenEstimate).toBeGreaterThan(2000);
    expect(tools.tokenEstimate).toBeGreaterThan(15000); // ~20k tokens, not 0
    expect(tools.note).toContain("85,896");
    // tool schemas dwarf the system prompt — the old estimate had this backwards
    expect(tools.tokenEstimate).toBeGreaterThan(sys.tokenEstimate * 5);
  });

  it("does not count thinking as input (stripped by context_management)", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "A2");
    const { segments } = assembleContext(recs, bp, est);
    const thinking = segments.filter((s) => s.category === "thinking");
    expect(thinking.length).toBeGreaterThan(0);
    for (const t of thinking) {
      expect(t.tokenEstimate).toBe(0);
      expect(t.note).toContain("clear_thinking");
    }
  });

  it("still prepends the estimated base prompt + tool definitions in the system group", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "A2");
    const { segments, groups } = assembleContext(recs, bp, est);
    expect(segments[0].category).toBe("baseSystemPrompt");
    expect(segments[0].groupId).toBe("g-system");
    expect(groups.find((g) => g.id === "g-system")!.isHistory).toBe(false);
  });
});
