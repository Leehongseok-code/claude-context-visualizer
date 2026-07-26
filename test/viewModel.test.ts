import { describe, it, expect } from "vitest";
import { buildViewModel, categoryColor } from "../src/core/viewModel";
import { Segment } from "../src/core/types";

function seg(id: string, cat: any, tokens: number, text = "x", estimated = false): Segment {
  return { id, category: cat, source: cat, rawText: text, tokenEstimate: tokens, estimated };
}

describe("viewModel", () => {
  it("sums totals and groups by category descending", () => {
    const vm = buildViewModel([seg("a", "user", 10), seg("b", "hook", 100), seg("c", "user", 5)]);
    expect(vm.totalTokens).toBe(115);
    expect(vm.byCategory[0].category).toBe("hook");
  });
  it("flags large and estimated segments", () => {
    const vm = buildViewModel([seg("big", "hook", 2000), seg("est", "baseSystemPrompt", 2500, "", true)]);
    const kinds = vm.wasteFlags.map(f => f.kind);
    expect(kinds).toContain("large");
    expect(kinds).toContain("estimated");
  });
  it("flags text repeated from the previous turn", () => {
    const prev = [seg("p", "hook", 50, "ROUTER REMINDER")];
    const vm = buildViewModel([seg("cur", "hook", 50, "ROUTER REMINDER")], prev);
    expect(vm.wasteFlags.some(f => f.kind === "repeated")).toBe(true);
  });
  it("gives every category a distinct color string", () => {
    expect(categoryColor("hook")).toMatch(/^#/);
    expect(categoryColor("hook")).not.toBe(categoryColor("user"));
  });
});
