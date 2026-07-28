import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexByUuid, buildThread, threadUuids } from "../src/core/transcriptParser";

const FIX = join(__dirname, "fixtures", "fanout.jsonl");

// Claude Code splits one assistant message with N parallel tool_use blocks into N
// records chained parent->child, and each async tool_result attaches to its own call.
// A plain parentUuid walk therefore follows one strand and drops the rest, even though
// every call and every result was in the context the model received.
describe("fan-out reconstruction", () => {
  it("keeps every tool_use of the same request, not just the ones on the strand", async () => {
    const meta = await indexByUuid(FIX);
    const order = threadUuids(meta, "u7");
    expect(order).toContain("u3"); // call C: a child of call B, never an ancestor of the leaf
  });

  it("keeps the results of those calls even though they hang off sibling branches", async () => {
    const meta = await indexByUuid(FIX);
    const order = threadUuids(meta, "u7");
    expect(order).toContain("u4"); // result A
    expect(order).toContain("u5"); // result C
  });

  it("returns them in the order they were written", async () => {
    const meta = await indexByUuid(FIX);
    expect(threadUuids(meta, "u7")).toEqual(["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7"]);
  });

  it("still excludes a genuinely abandoned branch", async () => {
    const meta = await indexByUuid(FIX);
    expect(threadUuids(meta, "u7")).not.toContain("x1");
  });

  it("does not pull in a result whose call is not in the context", async () => {
    const meta = await indexByUuid(FIX);
    expect(threadUuids(meta, "u7")).not.toContain("u8");
  });

  it("materializes the recovered records too", async () => {
    const meta = await indexByUuid(FIX);
    const recs = await buildThread(FIX, meta, "u7");
    expect(recs.map((r) => r.uuid)).toEqual(["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7"]);
  });
});
