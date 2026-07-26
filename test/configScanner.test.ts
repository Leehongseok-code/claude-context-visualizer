import { describe, it, expect } from "vitest";
import { join } from "path";
import { scanBlueprint } from "../src/core/configScanner";

const WS = join(__dirname, "fixtures", "ws");

describe("scanBlueprint", () => {
  it("finds CLAUDE.md and resolves @AGENTS.md import as a provider", async () => {
    const bp = await scanBlueprint(WS);
    const paths = bp.providers.map(p => p.path);
    expect(paths.some(p => p.endsWith("CLAUDE.md"))).toBe(true);
    expect(paths.some(p => p.endsWith("AGENTS.md"))).toBe(true);
  });
  it("lists mcp servers", async () => {
    const bp = await scanBlueprint(WS);
    expect(bp.mcpServers).toContain("msw-maker-mcp");
    expect(bp.mcpServers).toContain("msw-mcp");
  });
  it("captures settings hooks provider", async () => {
    const bp = await scanBlueprint(WS);
    expect(bp.providers.some(p => p.kind === "settings")).toBe(true);
  });
});
