import { describe, it, expect } from "vitest";
import { contextWindowFor, threadModel } from "../src/core/modelLimits";

describe("contextWindowFor", () => {
  it("knows the published windows", () => {
    expect(contextWindowFor("claude-opus-5")).toBe(1_000_000);
    expect(contextWindowFor("claude-fable-5")).toBe(1_000_000);
    expect(contextWindowFor("claude-opus-4-8")).toBe(1_000_000);
    expect(contextWindowFor("claude-sonnet-5")).toBe(1_000_000);
    expect(contextWindowFor("claude-haiku-4-5")).toBe(200_000);
  });

  it("strips the deployment suffix transcripts decorate ids with", () => {
    expect(contextWindowFor("claude-opus-5[1m]")).toBe(1_000_000);
    expect(contextWindowFor("claude-haiku-4-5-20251001")).toBe(200_000);
  });

  it("resolves the bare tier aliases Claude Code also records", () => {
    expect(contextWindowFor("opus")).toBe(1_000_000);
    expect(contextWindowFor("haiku")).toBe(200_000);
  });

  it("returns undefined rather than guessing a ceiling", () => {
    expect(contextWindowFor("<synthetic>")).toBeUndefined();
    expect(contextWindowFor("claude-3-opus-20240229")).toBeUndefined();
    expect(contextWindowFor(undefined)).toBeUndefined();
  });
});

describe("threadModel", () => {
  it("takes the last record naming a model — the one answering now", () => {
    expect(threadModel([
      { message: { model: "claude-opus-5" } },
      { message: { model: "claude-haiku-4-5" } },
    ])).toBe("claude-haiku-4-5");
  });

  it("skips records whose model we cannot size", () => {
    // a title-generation record can trail the real answer
    expect(threadModel([
      { message: { model: "claude-opus-5" } },
      { message: { model: "<synthetic>" } },
      { message: {} },
    ])).toBe("claude-opus-5");
  });

  it("returns undefined when nothing names a known model", () => {
    expect(threadModel([{ message: {} }, {}])).toBeUndefined();
  });
});
