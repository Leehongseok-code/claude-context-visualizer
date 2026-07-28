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
  // The uuids known to descend from the current turn's prompt. A turn's byte range also
  // catches records that belong to no thread or to the previous one: `compact_boundary`
  // is written with parentUuid null (a fresh root), `away_summary` and a re-sent prompt's
  // sibling hang off the previous turn's tail. Taking the last-written record as the leaf
  // would walk past this turn's prompt and reconstruct the previous turn instead — or,
  // for a null-parent leaf, collapse the thread to that one record.
  let descendants = new Set<string>();
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
      descendants = rec.uuid ? new Set([rec.uuid]) : new Set();
    }
    if (cur) {
      cur.byteEnd = byteEnd;
      // the leaf is the last record actually reachable from this turn's prompt
      if (rec.uuid && rec.parentUuid && descendants.has(rec.parentUuid)) {
        descendants.add(rec.uuid);
        cur.uuid = rec.uuid;
      }
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
    if (!rec.uuid) return;
    const toolUseIds: string[] = [];
    const toolResultIds: string[] = [];
    const content = rec.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "tool_use" && b.id) toolUseIds.push(b.id);
        else if (b.type === "tool_result" && b.tool_use_id) toolResultIds.push(b.tool_use_id);
      }
    }
    map.set(rec.uuid, {
      parentUuid: rec.parentUuid ?? null, byteStart, byteEnd,
      requestId: rec.requestId,
      toolUseIds: toolUseIds.length ? toolUseIds : undefined,
      toolResultIds: toolResultIds.length ? toolResultIds : undefined,
    });
  });
  return map;
}

// The uuids of the context Claude received at a leaf, in the order they were written:
// compaction summary + preserved messages + later turns, with summarized history and
// sidechains excluded (they are genuinely off-thread).
//
// The parentUuid chain alone is not that context. Claude Code splits one assistant
// response holding N parallel tool_use blocks into N records chained parent->child,
// and an async tool_result attaches to its own call rather than to the newest record.
// Several agents launched together therefore fan the log into sibling branches, and a
// plain walk follows one strand — dropping calls and results that were all in the
// request. Two structural rules recover them without guessing:
//
//   1. records sharing a requestId with an ancestor are one assistant message that was
//      split across lines, so including one means including all of them;
//   2. a tool_use in the context must be answered by its tool_result (the API rejects
//      a request otherwise), so the matching result belongs in, wherever it was filed.
//
// Anything neither rule reaches stays out: a branch abandoned by an edited or re-sent
// prompt shares no requestId with the thread and answers no call that is in it.
export function threadUuids(uuidMeta: Map<string, UuidMeta>, leafUuid: string): string[] {
  const included = new Set<string>();
  let cur: string | null = leafUuid;
  while (cur && uuidMeta.has(cur) && !included.has(cur)) {
    included.add(cur);
    cur = uuidMeta.get(cur)!.parentUuid;
  }

  // 1. the rest of each assistant response the strand passed through
  const requests = new Set<string>();
  for (const u of included) {
    const r = uuidMeta.get(u)!.requestId;
    if (r) requests.add(r);
  }
  for (const [uuid, m] of uuidMeta) {
    if (m.requestId && requests.has(m.requestId)) included.add(uuid);
  }

  // 2. the results answering calls now in context, up to the leaf
  const answered = new Set<string>();
  for (const u of included) for (const id of uuidMeta.get(u)!.toolUseIds ?? []) answered.add(id);
  const leafEnd = uuidMeta.get(leafUuid)?.byteEnd ?? Infinity;
  for (const [uuid, m] of uuidMeta) {
    if (included.has(uuid) || m.byteStart >= leafEnd) continue;
    if ((m.toolResultIds ?? []).some((id) => answered.has(id))) included.add(uuid);
  }

  // write order is conversation order: the log is append-only
  return [...included].sort((a, b) => uuidMeta.get(a)!.byteStart - uuidMeta.get(b)!.byteStart);
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

// Every record in a file, in write order. Used for subagent transcripts, which are
// a whole conversation per file and small enough to read in one pass.
export async function readAllRecords(filePath: string): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  await forEachLine(filePath, (line) => {
    if (!line.trim()) return;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  });
  return records;
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
