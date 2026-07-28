import { describe, it, expect } from "vitest";
import { join } from "path";
import { readAllRecords } from "../src/core/transcriptParser";
import { assembleTurn } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { ConfigBlueprint, Segment } from "../src/core/types";

// A `user`-role record is not the same thing as something a human typed. Claude Code
// writes skill bodies, slash-command expansions, task notifications, and reminders into
// the user turn and flags them `isMeta`. Measured against the transcripts on this
// machine, 97% of the tokens once labelled `user` were never typed by anyone.
const FIX = join(__dirname, "fixtures", "usertext.jsonl");
const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: [] };

async function segs(): Promise<Segment[]> {
  return assembleTurn(await readAllRecords(FIX), bp, est).filter((s) => !s.estimated);
}
const find = (all: Segment[], needle: string) => all.find((s) => s.rawText.includes(needle))!;

describe("what the user turn actually holds", () => {
  it("keeps `user` for text a human typed", async () => {
    const all = await segs();
    expect(find(all, "fix the login bug").category).toBe("user");
    expect(find(all, "make it faster").category).toBe("user");
  });

  it("sorts a skill body under skill, named from its directory", async () => {
    const s = find(await segs(), "Building LLM-Powered");
    expect(s.category).toBe("skill");
    expect(s.source).toBe("skill:claude-api");
  });

  it("recognises a system-reminder inside array content, not just string content", async () => {
    // the string branch always sniffed for this; the array branch never did
    expect(find(await segs(), "The task list is empty").category).toBe("systemReminder");
  });

  it("marks slash-command envelopes and their output as auto-inserted", async () => {
    const all = await segs();
    expect(find(all, "<command-name>").category).toBe("autoInserted");
    expect(find(all, "<command-name>").source).toBe("auto-inserted:command");
    expect(find(all, "local-command-stdout").category).toBe("autoInserted");
  });

  it("marks task notifications as auto-inserted", async () => {
    const s = find(await segs(), "task-notification");
    expect(s.category).toBe("autoInserted");
    expect(s.source).toBe("auto-inserted:notification");
  });

  it("falls back on isMeta so an unrecognised wrapper never counts as typed", async () => {
    const s = find(await segs(), "nobody has taught the parser");
    expect(s.category).toBe("autoInserted");
    expect(s.source).toBe("auto-inserted:meta");
    expect(s.note).toContain("did not type");
  });

  it("leaves only the two typed messages under `user`", async () => {
    const all = await segs();
    expect(all.filter((s) => s.category === "user").length).toBe(2);
  });
});
