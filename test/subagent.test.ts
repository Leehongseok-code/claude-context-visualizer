import { describe, it, expect } from "vitest";
import { join } from "path";
import { findSubagentFiles, extractAgentId } from "../src/core/subagentLocator";
import { readAllRecords } from "../src/core/transcriptParser";
import { assembleTurn, assembleSubagent } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { RawRecord, ConfigBlueprint } from "../src/core/types";

const PROJECTS = join(__dirname, "fixtures", "projects");
const SESSION = join(PROJECTS, "enc", "s1.jsonl");
const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: [] };

describe("findSubagentFiles", () => {
  it("maps agentId to its transcript under <sessionId>/subagents", async () => {
    const files = await findSubagentFiles(SESSION, "s1");
    expect(files.size).toBe(1);
    expect(files.get("a1b2c3d4e5f6a7b8")).toContain("agent-a1b2c3d4e5f6a7b8.jsonl");
  });
  it("returns empty for a session with no subagents dir", async () => {
    const files = await findSubagentFiles(join(PROJECTS, "enc2", "s3.jsonl"), "s3");
    expect(files.size).toBe(0);
  });
});

describe("extractAgentId", () => {
  it("pulls the id out of the Agent tool_result metadata", () => {
    const text =
      "Async agent launched successfully. (This tool result is internal metadata...)\n" +
      "agentId: a3a6d08e48dd95fe1 (internal ID - do not mention to user.)";
    expect(extractAgentId(text)).toBe("a3a6d08e48dd95fe1");
  });
  it("returns undefined when there is no agent id", () => {
    expect(extractAgentId("just a normal tool result")).toBeUndefined();
  });
});

describe("assembleTurn + Agent results", () => {
  const records: RawRecord[] = [
    {
      type: "assistant", uuid: "a1",
      message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Agent", input: { prompt: "go" } }] },
    },
    {
      type: "user", uuid: "a2",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "Async agent launched.\nagentId: a1b2c3d4e5f6a7b8 (internal ID)" }],
      },
    },
  ];

  it("tags the Agent tool_result with the agentId it launched", () => {
    const segs = assembleTurn(records, bp, est);
    const res = segs.find((s) => s.category === "toolResult");
    expect(res?.agentId).toBe("a1b2c3d4e5f6a7b8");
  });

  it("leaves non-Agent tool results untagged", () => {
    const plain: RawRecord[] = [
      { type: "assistant", uuid: "b1", message: { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "Read", input: {} }] } },
      { type: "user", uuid: "b2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", content: "agentId: deadbeef12345678" }] } },
    ];
    const segs = assembleTurn(plain, bp, est);
    expect(segs.find((s) => s.category === "toolResult")?.agentId).toBeUndefined();
  });
});

describe("assembleSubagent", () => {
  it("builds segments marked as a separate context at the given depth", async () => {
    const files = await findSubagentFiles(SESSION, "s1");
    const recs = await readAllRecords(files.get("a1b2c3d4e5f6a7b8")!);
    const segs = assembleSubagent(recs, est, "a1b2c3d4e5f6a7b8", 1);

    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.separateContext === true)).toBe(true);
    expect(segs.every((s) => s.depth === 1)).toBe(true);
    // ids must not collide with the parent's seg-N ids
    expect(segs.every((s) => s.id.startsWith("sub1-a1b2c3d4e5f6a7b8-"))).toBe(true);
    // no estimated base-prompt/tool-schema header: those are calibrated for the main agent
    expect(segs.some((s) => s.category === "baseSystemPrompt")).toBe(false);

    const cats = segs.map((s) => s.category);
    expect(cats).toContain("user");
    expect(cats).toContain("thinking");
    expect(cats).toContain("toolUse");
    expect(cats).toContain("toolResult");
    expect(cats).toContain("assistant");
    // the tool result is labelled by the tool that produced it
    expect(segs.find((s) => s.category === "toolResult")?.source).toBe("result:Grep");
  });
});
