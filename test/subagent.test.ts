import { describe, it, expect } from "vitest";
import { join } from "path";
import { findSubagentFiles, extractAgentId, indexAgentLaunches, offThreadLaunches } from "../src/core/subagentLocator";
import { readAllRecords, indexByUuid, buildThread } from "../src/core/transcriptParser";
import { assembleTurn, assembleContext, assembleSubagent } from "../src/core/contextAssembler";
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

  it("hangs the subagent off the Agent call, not its result", () => {
    const segs = assembleTurn(records, bp, est);
    const call = segs.find((s) => s.category === "toolUse");
    const res = segs.find((s) => s.category === "toolResult");
    expect(call?.agentId).toBe("a1b2c3d4e5f6a7b8"); // the call holds the prompt
    expect(res?.agentId).toBeUndefined();           // moved off the launch metadata
  });

  it("tags nothing when the call is absent — the tool is then unidentifiable", () => {
    // Only reachable if a result were ever separated from its call; in practice a
    // tool_result comes back within the request that issued it, so both are always
    // in the same turn. Without the call, the result's tool name is unknown and the
    // agentId marker is deliberately not trusted on its own.
    const segs = assembleTurn([records[1]], bp, est);
    expect(segs.find((s) => s.category === "toolResult")?.agentId).toBeUndefined();
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

// Launching several async agents fans the transcript out: each result attaches to its
// own tool_use record, so only the branch the conversation continued from stays on the
// parentUuid thread. The agentId lives in those results, so a thread-local join loses
// every agent but one — the link has to come from the whole session file.
describe("agent launches across branches", () => {
  const AGENTS = join(__dirname, "fixtures", "agents.jsonl");

  it("indexes every launch in the file, on-thread or not", async () => {
    const launches = await indexAgentLaunches(AGENTS);
    const byTool = new Map(launches.map((l) => [l.toolUseId, l]));
    expect(byTool.get("tu-A")?.agentId).toBe("aaaa1111bbbb2222"); // result sits off-thread
    expect(byTool.get("tu-B")?.agentId).toBe("cccc3333dddd4444");
    expect(launches.length).toBe(2);
  });

  it("carries the call's description and prompt for listing agents apart from the thread", async () => {
    const launches = await indexAgentLaunches(AGENTS);
    const a = launches.find((l) => l.toolUseId === "tu-A");
    expect(a?.description).toBe("first");
    expect(a?.prompt).toBe("do A");
  });

  it("ignores an agentId marker with no Agent call behind it", async () => {
    const launches = await indexAgentLaunches(AGENTS);
    expect(launches.some((l) => l.toolUseId === "tu-Z")).toBe(false);
  });

  it("tags every Agent call in the thread once the index is supplied", async () => {
    const meta = await indexByUuid(AGENTS);
    const thread = await buildThread(AGENTS, meta, "r6");
    const launches = await indexAgentLaunches(AGENTS);

    const withIndex = assembleContext(thread, bp, est, undefined, launches).segments;
    const tagged = withIndex.filter((s) => s.category === "toolUse" && s.agentId);
    expect(tagged.map((s) => s.agentId).sort()).toEqual(["aaaa1111bbbb2222", "cccc3333dddd4444"]);

    // without it, only the agent whose result stayed on the thread is reachable
    const noIndex = assembleContext(thread, bp, est).segments;
    expect(noIndex.filter((s) => s.category === "toolUse" && s.agentId).length).toBe(1);
  });
});

describe("offThreadLaunches", () => {
  const L = [
    { toolUseId: "t1", agentId: "shown", description: "in the thread" },
    { toolUseId: "t2", agentId: "hidden", description: "abandoned branch" },
    { toolUseId: "t3", agentId: "gone", description: "no transcript" },
  ];
  const onDisk = new Set(["shown", "hidden"]);

  it("lists only agents the context does not reach", () => {
    const out = offThreadLaunches(L, new Set(["shown"]), onDisk);
    expect(out.map((l) => l.agentId)).toEqual(["hidden"]);
  });

  it("drops agents with no transcript on disk — nothing to open", () => {
    const out = offThreadLaunches(L, new Set(), onDisk);
    expect(out.map((l) => l.agentId)).toEqual(["shown", "hidden"]);
  });

  it("lists a re-launched agent once", () => {
    const dupes = [...L, { toolUseId: "t4", agentId: "hidden", description: "same agent again" }];
    const out = offThreadLaunches(dupes, new Set(), onDisk);
    expect(out.filter((l) => l.agentId === "hidden").length).toBe(1);
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
