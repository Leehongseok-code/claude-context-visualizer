import { describe, it, expect } from "vitest";
import { assembleTurn, assembleContext } from "../src/core/contextAssembler";
import { buildViewModel } from "../src/core/viewModel";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { ConfigBlueprint, RawRecord } from "../src/core/types";

// A CLAUDE.md the panel adds from the workspace was read off disk, not observed in this
// thread. Counting it as recorded put a file we merely assume was in context into the one
// figure that is supposed to hold only what the transcript actually shows.
const est = new HeuristicTokenEstimator();
const withClaudeMd: ConfigBlueprint = {
  providers: [{ kind: "claudeMd", path: "/ws/CLAUDE.md", summary: "x", content: "# Project rules\n".repeat(50) }],
  mcpServers: [],
};
const bare: ConfigBlueprint = { providers: [], mcpServers: [] };

const turn: RawRecord[] = [
  { type: "user", uuid: "U1", parentUuid: null, promptId: "p1", message: { role: "user", content: "hi" } },
  {
    type: "assistant", uuid: "A1", parentUuid: "U1", requestId: "r1",
    message: {
      role: "assistant", content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 990, output_tokens: 2 },
    } as any,
  },
];

describe("config the panel supplies rather than observes", () => {
  it("marks a blueprint-injected CLAUDE.md as inferred, not as transcript content", () => {
    const seg = assembleTurn(turn, withClaudeMd, est).find((s) => s.category === "claudeMd")!;
    expect(seg).toBeTruthy();
    expect(seg.estimated).toBe(true);
    expect(seg.note).toContain("workspace");
    expect(seg.sourcePath).toBe("/ws/CLAUDE.md");
  });

  it("keeps it out of recordedTokens", () => {
    const segs = assembleContext(turn, withClaudeMd, est).segments;
    const vm = buildViewModel(segs, undefined, 1000);
    const md = segs.find((s) => s.category === "claudeMd")!;
    expect(md.tokenEstimate).toBeGreaterThan(0);
    expect(vm.inferredTokens).toBe(md.tokenEstimate);
    expect(vm.recordedTokens).toBeLessThan(md.tokenEstimate); // the turn's own text is tiny
  });

  it("splits the measurement three ways without double counting", () => {
    const segs = assembleContext(turn, withClaudeMd, est).segments;
    const vm = buildViewModel(segs, undefined, 1000);
    expect(vm.recordedTokens + vm.inferredTokens + vm.unrecordedTokens!).toBe(1000);
  });

  it("still fills the bar exactly when there is nothing to infer", () => {
    const segs = assembleContext(turn, bare, est).segments;
    const vm = buildViewModel(segs, undefined, 1000);
    expect(vm.inferredTokens).toBe(0);
    expect(vm.recordedTokens + vm.unrecordedTokens!).toBe(1000);
  });
});
