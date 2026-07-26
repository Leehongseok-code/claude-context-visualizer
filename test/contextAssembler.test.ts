import { describe, it, expect } from "vitest";
import { assembleTurn } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { RawRecord, ConfigBlueprint } from "../src/core/types";

const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: ["a", "b"] };

describe("assembleTurn", () => {
  it("prepends estimated base prompt and tool-definitions segments", () => {
    const segs = assembleTurn([], bp, est);
    expect(segs[0].category).toBe("baseSystemPrompt");
    expect(segs[0].estimated).toBe(true);
    expect(segs[1].category).toBe("toolDefinitions");
    expect(segs[1].tokenEstimate).toBe(500); // 2 servers * 250
  });

  it("decodes a hook attachment into a hook segment", () => {
    const recs: RawRecord[] = [{
      type: "attachment",
      attachment: { type: "hook_success", hookName: "SessionStart",
        stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: "HOOK BODY" } }) },
    }];
    const segs = assembleTurn(recs, bp, est);
    const hook = segs.find(s => s.category === "hook")!;
    expect(hook.source).toBe("hook:SessionStart");
    expect(hook.rawText).toBe("HOOK BODY");
  });

  it("classifies claudeMd, user, thinking, assistant", () => {
    const recs: RawRecord[] = [
      { type: "user", message: { role: "user", content: "<claudeMd>rules here</claudeMd>" } },
      { type: "user", promptId: "p", message: { role: "user", content: "plain question" } },
      { type: "assistant", message: { role: "assistant",
        content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "reply" }] } },
    ];
    const segs = assembleTurn(recs, bp, est);
    const cats = segs.map(s => s.category);
    expect(cats).toContain("claudeMd");
    expect(cats).toContain("user");
    expect(cats).toContain("thinking");
    expect(cats).toContain("assistant");
  });

  it("attributionSkill overrides to skill category for reasoning text", () => {
    const recs: RawRecord[] = [{
      type: "assistant", attributionSkill: "brainstorming",
      message: { role: "assistant", content: [{ type: "text", text: "x" }] },
    }];
    const segs = assembleTurn(recs, bp, est);
    const skill = segs.find(s => s.category === "skill")!;
    expect(skill.source).toBe("skill:brainstorming");
  });

  it("classifies a tool_use as its own toolUse segment with full input", () => {
    const recs: RawRecord[] = [{
      type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/a/b.ts" } },
      ] },
    }];
    const segs = assembleTurn(recs, bp, est);
    const tu = segs.find(s => s.category === "toolUse")!;
    expect(tu.source).toBe("tool:Read");
    expect(tu.rawText).toContain("/a/b.ts");
  });

  it("labels a Skill launch and an mcp call by their real origin", () => {
    const recs: RawRecord[] = [{
      type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "s1", name: "Skill", input: { skill: "brainstorming" } },
        { type: "tool_use", id: "m1", name: "mcp__msw-mcp__asset_search", input: { q: "slime" } },
      ] },
    }];
    const segs = assembleTurn(recs, bp, est).filter(s => s.category === "toolUse");
    expect(segs.map(s => s.source)).toEqual(["skill:brainstorming", "mcp:msw-mcp__asset_search"]);
  });

  it("captures tool_result raw data and links it to the calling tool", () => {
    const recs: RawRecord[] = [
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "tu9", name: "Grep", input: { pattern: "foo" } },
      ] } },
      { type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "tu9", content: "MATCH LINE 1\nMATCH LINE 2" },
      ] } },
    ];
    const segs = assembleTurn(recs, bp, est);
    const tr = segs.find(s => s.category === "toolResult")!;
    expect(tr.source).toBe("result:Grep");
    expect(tr.rawText).toContain("MATCH LINE 1");
  });

  it("falls back to toolUseResult when the tool_result block content is empty", () => {
    const recs: RawRecord[] = [{
      type: "user", toolUseResult: { success: true, rows: 3 },
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "" }] },
    }];
    const segs = assembleTurn(recs, bp, est);
    const tr = segs.find(s => s.category === "toolResult")!;
    expect(tr.rawText).toContain("rows");
  });

  it("appends a claudeMd segment from a blueprint provider when no record produced one", () => {
    const bpWithProvider: ConfigBlueprint = {
      providers: [{ kind: "claudeMd", path: "/x/CLAUDE.md", summary: "", content: "rules" }],
      mcpServers: [],
    };
    const segs = assembleTurn([], bpWithProvider, est);
    const claudeMdSegs = segs.filter(s => s.category === "claudeMd");
    expect(claudeMdSegs.length).toBe(1);
    expect(claudeMdSegs[0].sourcePath).toBe("/x/CLAUDE.md");
  });

  it("cross-references sourcePath onto a record-produced claudeMd segment instead of duplicating", () => {
    const bpWithProvider: ConfigBlueprint = {
      providers: [{ kind: "claudeMd", path: "/x/CLAUDE.md", summary: "", content: "rules" }],
      mcpServers: [],
    };
    const recs: RawRecord[] = [
      { type: "user", message: { role: "user", content: "<claudeMd>rules here</claudeMd>" } },
    ];
    const segs = assembleTurn(recs, bpWithProvider, est);
    const claudeMdSegs = segs.filter(s => s.category === "claudeMd");
    expect(claudeMdSegs.length).toBe(1);
    expect(claudeMdSegs[0].sourcePath).toBe("/x/CLAUDE.md");
  });
});
