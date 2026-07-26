import { readFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { ConfigBlueprint, ConfigProvider } from "./types";

async function readIfExists(p: string): Promise<string | null> {
  try { return await readFile(p, "utf8"); } catch { return null; }
}

async function collectClaudeMd(
  filePath: string, providers: ConfigProvider[], seen: Set<string>
): Promise<void> {
  const abs = resolve(filePath);
  if (seen.has(abs)) return;
  const content = await readIfExists(abs);
  if (content === null) return;
  seen.add(abs);
  providers.push({
    kind: "claudeMd", path: abs,
    summary: `${content.length} chars`, content,
  });
  for (const line of content.split("\n")) {
    const m = line.trim().match(/^@(.+)$/);
    if (m) await collectClaudeMd(join(dirname(abs), m[1].trim()), providers, seen);
  }
}

export async function scanBlueprint(workspacePath: string): Promise<ConfigBlueprint> {
  const providers: ConfigProvider[] = [];
  const seen = new Set<string>();

  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    await collectClaudeMd(join(workspacePath, name), providers, seen);
  }

  const settingsPath = join(workspacePath, ".claude", "settings.json");
  const settings = await readIfExists(settingsPath);
  if (settings !== null) {
    let hookCount = 0;
    try {
      const parsed = JSON.parse(settings);
      hookCount = Object.keys(parsed.hooks ?? {}).length;
    } catch { /* keep 0 */ }
    providers.push({
      kind: "settings", path: resolve(settingsPath),
      summary: `${hookCount} hook event(s)`, content: settings,
    });
  }

  const memPath = join(workspacePath, "MEMORY.md");
  const mem = await readIfExists(memPath);
  if (mem !== null) {
    providers.push({ kind: "memory", path: resolve(memPath), summary: `${mem.length} chars`, content: mem });
  }

  let mcpServers: string[] = [];
  const mcpPath = join(workspacePath, ".mcp.json");
  const mcp = await readIfExists(mcpPath);
  if (mcp !== null) {
    try {
      const parsed = JSON.parse(mcp);
      mcpServers = Object.keys(parsed.mcpServers ?? {});
      providers.push({
        kind: "mcp", path: resolve(mcpPath),
        summary: `${mcpServers.length} server(s)`, content: mcp,
      });
    } catch { /* ignore malformed */ }
  }

  return { providers, mcpServers };
}
