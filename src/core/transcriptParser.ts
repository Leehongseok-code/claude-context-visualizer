import { createReadStream } from "fs";
import { RawRecord, TurnIndex } from "./types";

export async function forEachLine(
  filePath: string,
  cb: (line: string, byteStart: number, byteEnd: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    let buf = Buffer.alloc(0);
    let fileOffset = 0;
    stream.on("data", (chunk: Buffer | string) => {
      const b = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      buf = Buffer.concat([buf, b]);
      let nl: number;
      while ((nl = buf.indexOf(0x0a)) !== -1) {
        const lineBuf = buf.subarray(0, nl);
        const byteStart = fileOffset;
        const byteEnd = fileOffset + nl + 1;
        cb(lineBuf.toString("utf8"), byteStart, byteEnd);
        buf = buf.subarray(nl + 1);
        fileOffset = byteEnd;
      }
    });
    stream.on("end", () => {
      if (buf.length) cb(buf.toString("utf8"), fileOffset, fileOffset + buf.length);
      resolve();
    });
    stream.on("error", reject);
  });
}

export function userPreview(rec: RawRecord): string {
  const c = rec.message?.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 80);
}

function isTurnStart(rec: RawRecord): boolean {
  return rec.type === "user" && !!rec.promptId && rec.isMeta !== true;
}

export async function indexTurns(filePath: string): Promise<TurnIndex[]> {
  const turns: TurnIndex[] = [];
  let cur: TurnIndex | null = null;
  await forEachLine(filePath, (line, byteStart, byteEnd) => {
    if (!line.trim()) return;
    let rec: RawRecord;
    try { rec = JSON.parse(line); } catch { return; }
    if (isTurnStart(rec)) {
      if (cur) { cur.byteEnd = byteStart; turns.push(cur); }
      cur = {
        turn: turns.length,
        byteStart: cur ? byteStart : 0, // fold pre-prompt records into first turn
        byteEnd,
        promptPreview: userPreview(rec),
        timestamp: rec.timestamp,
      };
    }
    if (cur) cur.byteEnd = byteEnd;
  });
  if (cur) turns.push(cur);
  return turns;
}

export async function readTurn(filePath: string, turn: TurnIndex): Promise<RawRecord[]> {
  const data: string = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, { start: turn.byteStart, end: turn.byteEnd - 1 });
    stream.on("data", (c: Buffer | string) => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
  const records: RawRecord[] = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return records;
}
