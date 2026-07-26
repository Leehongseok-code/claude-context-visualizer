import { describe, it, expect } from "vitest";
import { join } from "path";
import { findSessionsForWorkspace } from "../src/core/sessionLocator";

const PROJECTS = join(__dirname, "fixtures", "projects");

describe("findSessionsForWorkspace", () => {
  it("returns only sessions whose cwd matches", async () => {
    const found = await findSessionsForWorkspace("/tmp/target-ws", PROJECTS);
    expect(found.length).toBe(1);
    expect(found[0].sessionId).toBe("s1");
    expect(found[0].cwd).toBe("/tmp/target-ws");
  });
  it("returns empty when nothing matches", async () => {
    const found = await findSessionsForWorkspace("/tmp/nope", PROJECTS);
    expect(found).toEqual([]);
  });
});
