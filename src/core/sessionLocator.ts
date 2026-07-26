import { readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { join, basename } from "path";
import { SessionInfo } from "./types";

async function firstRecordCwd(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    let buf = "";
    stream.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        stream.destroy();
        try { resolve(JSON.parse(buf.slice(0, nl)).cwd ?? null); }
        catch { resolve(null); }
      }
    });
    stream.on("end", () => {
      try { resolve(buf.trim() ? JSON.parse(buf).cwd ?? null : null); } catch { resolve(null); }
    });
    stream.on("error", () => resolve(null));
  });
}

export async function findSessionsForWorkspace(
  workspacePath: string, projectsDir: string
): Promise<SessionInfo[]> {
  const out: SessionInfo[] = [];
  let dirs: string[];
  try { dirs = await readdir(projectsDir); } catch { return []; }
  for (const d of dirs) {
    const sub = join(projectsDir, d);
    let files: string[];
    try { files = await readdir(sub); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const filePath = join(sub, f);
      const cwd = await firstRecordCwd(filePath);
      if (cwd !== workspacePath) continue;
      const s = await stat(filePath);
      out.push({ sessionId: basename(f, ".jsonl"), filePath, cwd, mtimeMs: s.mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
