import { createReadStream } from "fs";
import { RawRecord, TurnIndex, UuidMeta } from "./types";

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

// True only for a user message carrying actual typed text. In agentic sessions
// most user-role records are tool_result continuations (they still have a
// promptId) — those belong to the current turn, not a new one.
function hasUserText(rec: RawRecord): boolean {
  const c = rec.message?.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) return c.some((b: any) => b?.type === "text" && String(b.text ?? "").trim().length > 0);
  return false;
}

function isTurnStart(rec: RawRecord): boolean {
  return rec.type === "user" && !!rec.promptId && rec.isMeta !== true && hasUserText(rec);
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
        uuid: rec.uuid,
      };
    }
    if (cur) {
      cur.byteEnd = byteEnd;
      if (rec.uuid) cur.uuid = rec.uuid; // track the turn's last record = the leaf to reconstruct from
    }
  });
  if (cur) turns.push(cur);
  return turns;
}

// One streaming pass building uuid -> { parentUuid, byte range }. Used to walk the
// parentUuid thread — the exact ordered message sequence Claude received.
export async function indexByUuid(filePath: string): Promise<Map<string, UuidMeta>> {
  const map = new Map<string, UuidMeta>();
  await forEachLine(filePath, (line, byteStart, byteEnd) => {
    if (!line.trim()) return;
    let rec: RawRecord;
    try { rec = JSON.parse(line); } catch { return; }
    if (rec.uuid) map.set(rec.uuid, { parentUuid: rec.parentUuid ?? null, byteStart, byteEnd });
  });
  return map;
}

// Walk parentUuid from a leaf to the root (or a compact_boundary, whose parentUuid is
// null) and return the uuids in root->leaf order. This is exactly the context Claude
// received at that leaf: compaction summary + preserved messages + later turns, with
// dropped/summarized history and sidechains naturally excluded (they are off-thread).
export function threadUuids(uuidMeta: Map<string, UuidMeta>, leafUuid: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = leafUuid;
  while (cur && uuidMeta.has(cur) && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    cur = uuidMeta.get(cur)!.parentUuid;
  }
  return chain.reverse();
}

// Materialize the thread's records (root->leaf order) with one filtering pass.
export async function buildThread(
  filePath: string, uuidMeta: Map<string, UuidMeta>, leafUuid: string
): Promise<RawRecord[]> {
  const order = threadUuids(uuidMeta, leafUuid);
  const want = new Set(order);
  const byUuid = new Map<string, RawRecord>();
  await forEachLine(filePath, (line) => {
    if (!line.trim()) return;
    let rec: RawRecord;
    try { rec = JSON.parse(line); } catch { return; }
    if (rec.uuid && want.has(rec.uuid)) byUuid.set(rec.uuid, rec);
  });
  return order.map((u) => byUuid.get(u)).filter((r): r is RawRecord => !!r);
}

// A cheap one-line summary of what a session is about: its first real user
// prompt. Streams from the top and stops as soon as one is found, so it stays
// fast even for very large transcripts.
export async function firstPromptPreview(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    let buf = "";
    let settled = false;
    const finish = (v: string) => {
      if (settled) return;
      settled = true;
      try { stream.destroy(); } catch { /* already closed */ }
      resolve(v);
    };
    const consume = (line: string): boolean => {
      if (!line.trim()) return false;
      let rec: RawRecord;
      try { rec = JSON.parse(line); } catch { return false; }
      if (rec.type === "user" && rec.promptId && rec.isMeta !== true) {
        const p = userPreview(rec);
        if (p) { finish(p); return true; }
      }
      return false;
    };
    stream.on("data", (chunk: Buffer | string) => {
      buf += String(chunk);
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (consume(line)) return;
      }
    });
    stream.on("end", () => { if (!settled) { consume(buf); finish(""); } });
    stream.on("error", () => finish(""));
  });
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
