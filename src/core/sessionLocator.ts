import { readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { join, basename } from "path";
import { SessionInfo } from "./types";

async function firstRecordCwd(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    let buf = "";
    stream.on("data", (chunk: Buffer | string) => {
      buf += String(chunk);
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        try {
          const record = JSON.parse(line);
          if (record.cwd && typeof record.cwd === "string") {
            stream.destroy();
            resolve(record.cwd);
            return;
          }
        } catch {
          // Parse error, skip this line
        }
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    });
    stream.on("end", () => {
      // Check if remaining buffer has a valid record with cwd
      if (buf.trim()) {
        try {
          const record = JSON.parse(buf);
          if (record.cwd && typeof record.cwd === "string") {
            resolve(record.cwd);
            return;
          }
        } catch {
          // Parse error
        }
      }
      resolve(null);
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
      let s;
      try { s = await stat(filePath); } catch { continue; }
      out.push({ sessionId: basename(f, ".jsonl"), filePath, cwd, mtimeMs: s.mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
