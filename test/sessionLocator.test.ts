import { describe, it, expect } from "vitest";
import { join } from "path";
import { findSessionsForWorkspace } from "../src/core/sessionLocator";

const PROJECTS = join(__dirname, "fixtures", "projects");

describe("findSessionsForWorkspace", () => {
  it("returns only sessions whose cwd matches", async () => {
    const found = await findSessionsForWorkspace("/tmp/target-ws", PROJECTS);
    expect(found.length).toBe(2);
    expect(found.some((s) => s.sessionId === "s1")).toBe(true);
    expect(found.some((s) => s.sessionId === "s3")).toBe(true);
    expect(found.every((s) => s.cwd === "/tmp/target-ws")).toBe(true);
  });
  it("returns empty when nothing matches", async () => {
    const found = await findSessionsForWorkspace("/tmp/nope", PROJECTS);
    expect(found).toEqual([]);
  });
  it("finds cwd from later record when first record lacks cwd", async () => {
    const found = await findSessionsForWorkspace("/tmp/target-ws", PROJECTS);
    const s3 = found.find((s) => s.sessionId === "s3");
    expect(s3).toBeDefined();
    expect(s3?.cwd).toBe("/tmp/target-ws");
  });
});
