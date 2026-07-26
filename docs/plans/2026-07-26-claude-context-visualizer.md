# Claude Context Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A portable VS Code extension that visualizes how Claude Code's per-turn LLM context is assembled from its raw sources (CLAUDE.md, skills, hooks, memory, MCP, tool results, history), with local token estimates for debugging/optimization.

**Architecture:** Six decoupled core modules (pure Node + `fs`, no `vscode` import → fast unit tests): SessionLocator, TranscriptParser, ConfigScanner, ContextAssembler, TokenEstimator, plus a Webview UI. The extension host wires a QuickPick session/turn picker to a Webview that renders a layered, token-weighted segment stack with click-to-drill-down. It resolves the **active workspace at runtime** (matching sessions by each transcript's `cwd` field), so one install works in every project.

**Tech Stack:** TypeScript, VS Code Extension API, esbuild (bundling), Vitest (unit tests for core modules), `@vscode/vsce` (packaging). No runtime npm dependencies; no network/API key.

## Global Constraints

- Node/`fs` only in `src/core/**` — **no `import ... from 'vscode'`** in core modules (keeps them Vitest-testable). `vscode` is used only in `src/extension.ts` and message wiring.
- Never read a transcript file whole — stream and index by byte offset; `readTurn` reads only its byte slice.
- Token counts are **estimates** via the `TokenEstimator` interface; the heuristic impl is the default and the interface must stay swappable (Anthropic API impl is a future drop-in).
- Transcript location: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Match sessions by the `cwd` field inside records, **not** by reverse-engineering the directory name.
- Malformed JSONL lines are skipped and counted, never fatal.
- Property/type names are fixed by the `Interfaces` blocks below; do not rename across tasks.

---

## File Structure

```
claude-context-visualizer/
  package.json            # extension manifest, scripts, devDeps
  tsconfig.json
  esbuild.js              # bundles extension (node) + webview (browser)
  vitest.config.ts
  .vscodeignore
  README.md
  src/
    core/
      types.ts            # RawRecord, Segment, SegmentCategory, blueprint & interfaces
      tokenEstimator.ts   # TokenEstimator interface + HeuristicTokenEstimator
      transcriptParser.ts # forEachLine, indexTurns, readTurn
      configScanner.ts    # scanBlueprint (CLAUDE.md/@imports, settings, memory, mcp)
      contextAssembler.ts # assembleTurn -> Segment[]
      sessionLocator.ts   # findSessionsForWorkspace
      viewModel.ts        # buildViewModel (pure: summary, waste flags, colors)
    extension.ts          # activate(), command, QuickPick, Webview host
    webview/
      main.ts             # DOM render of stack + drilldown (browser bundle)
      styles.css
  test/
    fixtures/
      sample.jsonl
      ws/CLAUDE.md, ws/AGENTS.md, ws/.mcp.json, ws/.claude/settings.json
      projects/<enc>/<sid>.jsonl
    tokenEstimator.test.ts
    transcriptParser.test.ts
    configScanner.test.ts
    contextAssembler.test.ts
    sessionLocator.test.ts
    viewModel.test.ts
```

---

## Task 1: Scaffold + Core Types + TokenEstimator

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.js`, `.vscodeignore`
- Create: `src/core/types.ts`
- Create: `src/core/tokenEstimator.ts`
- Test: `test/tokenEstimator.test.ts`

**Interfaces:**
- Produces: `RawRecord`, `SegmentCategory`, `Segment`, `ConfigProvider`, `ConfigBlueprint`, `SessionInfo`, `TurnIndex` (in `types.ts`); `TokenEstimator` interface + `HeuristicTokenEstimator` class with `estimate(text: string): number` and `name: string`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-context-visualizer",
  "displayName": "Claude Context Visualizer",
  "description": "Visualize how Claude Code assembles its per-turn LLM context.",
  "version": "0.1.0",
  "publisher": "local",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Visualization", "Other"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "claudeContext.visualize", "title": "Claude Context: Visualize" }
    ]
  },
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "test": "vitest run",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.24.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2021", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "out",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts` and `esbuild.js` and `.vscodeignore`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
```

`esbuild.js`:
```js
const esbuild = require("esbuild");
const watch = process.argv.includes("--watch");
const common = { bundle: true, sourcemap: true, logLevel: "info" };
async function run() {
  const ext = await esbuild.context({
    ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js",
    platform: "node", format: "cjs", external: ["vscode"],
  });
  const web = await esbuild.context({
    ...common, entryPoints: ["src/webview/main.ts"], outfile: "dist/webview.js",
    platform: "browser", format: "iife",
  });
  if (watch) { await ext.watch(); await web.watch(); }
  else { await ext.rebuild(); await web.rebuild(); await ext.dispose(); await web.dispose(); }
}
run();
```

`.vscodeignore`:
```
src/**
test/**
out/**
node_modules/**
esbuild.js
vitest.config.ts
tsconfig.json
docs/**
**/*.map
```

- [ ] **Step 4: Create `src/core/types.ts`**

```ts
export interface RawRecord {
  type?: string;
  isMeta?: boolean;
  promptId?: string;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  attributionSkill?: string;
  attributionMcpServer?: string;
  attributionMcpTool?: string;
  attachment?: any;
  message?: { role?: string; content?: any; model?: string };
  toolUseResult?: any;
  [k: string]: any;
}

export type SegmentCategory =
  | "baseSystemPrompt" | "toolDefinitions" | "claudeMd" | "skill"
  | "hook" | "memory" | "mcpInstructions" | "toolResult"
  | "user" | "assistant" | "thinking" | "systemReminder";

export interface Segment {
  id: string;
  category: SegmentCategory;
  source: string;         // e.g. "CLAUDE.md", "hook:SessionStart", "skill:brainstorming"
  sourcePath?: string;    // clickable file path when known
  rawText: string;
  tokenEstimate: number;
  estimated: boolean;     // true = not captured in transcript (base prompt/tool schemas)
  note?: string;
}

export interface ConfigProvider {
  kind: "claudeMd" | "settings" | "memory" | "mcp";
  path: string;
  summary: string;
  content?: string;
}

export interface ConfigBlueprint {
  providers: ConfigProvider[];
  mcpServers: string[];
}

export interface SessionInfo {
  sessionId: string;
  filePath: string;
  cwd: string;
  mtimeMs: number;
}

export interface TurnIndex {
  turn: number;
  byteStart: number;
  byteEnd: number;
  promptPreview: string;
  timestamp?: string;
}
```

- [ ] **Step 5: Write the failing test** — `test/tokenEstimator.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";

describe("HeuristicTokenEstimator", () => {
  const est = new HeuristicTokenEstimator();
  it("names itself", () => expect(est.name).toBe("heuristic"));
  it("estimates ascii near chars/4", () => {
    const n = est.estimate("hello world");
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
  });
  it("weights CJK heavier per char", () => {
    const n = est.estimate("안녕하세요"); // 5 hangul syllables
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
  });
  it("returns 0 for empty", () => expect(est.estimate("")).toBe(0));
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm i && npx vitest run test/tokenEstimator.test.ts`
Expected: FAIL — cannot find module `tokenEstimator`.

- [ ] **Step 7: Write `src/core/tokenEstimator.ts`**

```ts
export interface TokenEstimator {
  readonly name: string;
  estimate(text: string): number;
}

function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) ||   // hiragana/katakana
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK unified
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff)      // CJK compat
  );
}

export class HeuristicTokenEstimator implements TokenEstimator {
  readonly name = "heuristic";
  estimate(text: string): number {
    if (!text) return 0;
    let cjk = 0, other = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (isCjk(cp)) cjk++;
      else if (!/\s/.test(ch)) other++;
    }
    return Math.ceil(cjk * 0.7 + other * 0.27);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/tokenEstimator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts esbuild.js .vscodeignore src/core/types.ts src/core/tokenEstimator.ts test/tokenEstimator.test.ts
git commit -m "feat: scaffold extension + core types + heuristic token estimator"
```

---

## Task 2: TranscriptParser (streaming index + turn read)

**Files:**
- Create: `src/core/transcriptParser.ts`
- Create: `test/fixtures/sample.jsonl`
- Test: `test/transcriptParser.test.ts`

**Interfaces:**
- Consumes: `RawRecord`, `TurnIndex` from `types.ts`.
- Produces:
  - `forEachLine(filePath: string, cb: (line: string, byteStart: number, byteEnd: number) => void): Promise<void>`
  - `indexTurns(filePath: string): Promise<TurnIndex[]>` — a turn starts at a record where `type === "user" && rec.promptId && !rec.isMeta`.
  - `readTurn(filePath: string, turn: TurnIndex): Promise<RawRecord[]>`
  - `userPreview(rec: RawRecord): string` — first 80 chars of the user prompt text.

- [ ] **Step 1: Create `test/fixtures/sample.jsonl`** (one line per record; a two-turn session)

```
{"type":"attachment","attachment":{"type":"hook_success","hookName":"SessionStart","stdout":"{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"HOOK BODY ALPHA\"}}"},"cwd":"/tmp/ws","sessionId":"s1","timestamp":"2026-07-01T00:00:00Z"}
{"type":"user","promptId":"p1","isMeta":false,"cwd":"/tmp/ws","sessionId":"s1","timestamp":"2026-07-01T00:00:01Z","message":{"role":"user","content":"first question about widgets"}}
{"type":"assistant","cwd":"/tmp/ws","sessionId":"s1","timestamp":"2026-07-01T00:00:02Z","message":{"role":"assistant","model":"claude-opus-5","content":[{"type":"thinking","thinking":"reasoning one"},{"type":"text","text":"answer one"}]}}
{"type":"user","promptId":"p2","isMeta":false,"cwd":"/tmp/ws","sessionId":"s1","timestamp":"2026-07-01T00:00:03Z","message":{"role":"user","content":"두번째 질문입니다"}}
{"type":"assistant","attributionSkill":"brainstorming","cwd":"/tmp/ws","sessionId":"s1","timestamp":"2026-07-01T00:00:04Z","message":{"role":"assistant","content":[{"type":"text","text":"answer two"}]}}
```

- [ ] **Step 2: Write the failing test** — `test/transcriptParser.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { join } from "path";
import { indexTurns, readTurn } from "../src/core/transcriptParser";

const FIX = join(__dirname, "fixtures", "sample.jsonl");

describe("transcriptParser", () => {
  it("indexes two turns keyed on real user prompts", async () => {
    const turns = await indexTurns(FIX);
    expect(turns.length).toBe(2);
    expect(turns[0].promptPreview).toContain("first question");
    expect(turns[1].promptPreview).toContain("두번째");
  });
  it("turn 1 includes the preceding hook attachment", async () => {
    const turns = await indexTurns(FIX);
    const recs = await readTurn(FIX, turns[0]);
    const kinds = recs.map(r => r.type);
    expect(kinds).toContain("attachment");
    expect(kinds).toContain("user");
    expect(kinds).toContain("assistant");
  });
  it("readTurn only reads that turn's slice", async () => {
    const turns = await indexTurns(FIX);
    const recs = await readTurn(FIX, turns[1]);
    expect(recs.some(r => r.attributionSkill === "brainstorming")).toBe(true);
    expect(recs.some(r => r.promptId === "p1")).toBe(false);
  });
});
```

Note: the leading hook attachment belongs to turn 0 because turn 0's byte range starts at file offset 0 (there is no earlier real-user-prompt boundary), so pre-prompt records fold into the first turn.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/transcriptParser.test.ts`
Expected: FAIL — cannot find module `transcriptParser`.

- [ ] **Step 4: Write `src/core/transcriptParser.ts`**

```ts
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
    stream.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
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
    stream.on("data", (c: Buffer) => chunks.push(c));
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/transcriptParser.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/transcriptParser.ts test/fixtures/sample.jsonl test/transcriptParser.test.ts
git commit -m "feat: streaming transcript parser with byte-offset turn index"
```

---

## Task 3: ConfigScanner (blueprint)

**Files:**
- Create: `src/core/configScanner.ts`
- Create: `test/fixtures/ws/CLAUDE.md`, `test/fixtures/ws/AGENTS.md`, `test/fixtures/ws/.mcp.json`, `test/fixtures/ws/.claude/settings.json`
- Test: `test/configScanner.test.ts`

**Interfaces:**
- Consumes: `ConfigProvider`, `ConfigBlueprint` from `types.ts`.
- Produces: `scanBlueprint(workspacePath: string): Promise<ConfigBlueprint>` — reads `CLAUDE.md`/`AGENTS.md` and recursively resolves `@import` lines (a line whose trimmed text is `@<relative-path>`), `.claude/settings.json`, `MEMORY.md` if present, `.mcp.json` server names.

- [ ] **Step 1: Create fixtures**

`test/fixtures/ws/CLAUDE.md`:
```
# Project rules
@AGENTS.md
Follow the house style.
```

`test/fixtures/ws/AGENTS.md`:
```
# Agent rules
Always write tests first.
```

`test/fixtures/ws/.mcp.json`:
```json
{ "mcpServers": { "msw-maker-mcp": { "command": "x" }, "msw-mcp": { "command": "y" } } }
```

`test/fixtures/ws/.claude/settings.json`:
```json
{ "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "echo hi" } ] } ] } }
```

- [ ] **Step 2: Write the failing test** — `test/configScanner.test.ts`

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/configScanner.test.ts`
Expected: FAIL — cannot find module `configScanner`.

- [ ] **Step 4: Write `src/core/configScanner.ts`**

```ts
import { readFile } from "fs/promises";
import { existsSync } from "fs";
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
```

Note: `existsSync` import is intentionally retained for future use in the extension host; if a linter flags it, remove it — the tests do not require it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/configScanner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/configScanner.ts test/fixtures/ws test/configScanner.test.ts
git commit -m "feat: config scanner with recursive @import resolution"
```

---

## Task 4: ContextAssembler (RawRecord[] → Segment[])

**Files:**
- Create: `src/core/contextAssembler.ts`
- Test: `test/contextAssembler.test.ts`

**Interfaces:**
- Consumes: `RawRecord`, `Segment`, `SegmentCategory`, `ConfigBlueprint` from `types.ts`; `TokenEstimator` from `tokenEstimator.ts`.
- Produces: `assembleTurn(records: RawRecord[], blueprint: ConfigBlueprint, est: TokenEstimator): Segment[]`.
  - Emits two leading `estimated: true` segments: `baseSystemPrompt` (note: "Base system prompt — not captured in transcript") and `toolDefinitions` (tokenEstimate `= blueprint.mcpServers.length * 250`, note explaining the rough estimate).
  - Classifies each record's content: hook attachment → `hook` (`source: "hook:<hookName>"`, rawText = decoded `additionalContext`); user text containing `<claudeMd>` → `claudeMd`; `<system-reminder>` → `systemReminder`; other user string → `user`; user `tool_result` blocks → `toolResult`; assistant `thinking` → `thinking`; assistant `text`/`tool_use` → `assistant`. `attributionSkill` overrides source to `skill:<name>` + category `skill`; `attributionMcpServer` overrides to `mcp:<server>`.

- [ ] **Step 1: Write the failing test** — `test/contextAssembler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { assembleTurn } from "../src/core/contextAssembler";
import { HeuristicTokenEstimator } from "../src/core/tokenEstimator";
import { RawRecord, ConfigBlueprint } from "../src/core/types";

const est = new HeuristicTokenEstimator();
const bp: ConfigBlueprint = { providers: [], mcpServers: ["a", "b"] };

describe("assembleTurn", () => {
  it("prepends estimated base prompt and tool-definitions segments", () => {
    const segs = assembleTurn([], bp, est);
    expect(segs[0].category).toBe("baseSystemPrompt");
    expect(segs[0].estimated).toBe(true);
    expect(segs[1].category).toBe("toolDefinitions");
    expect(segs[1].tokenEstimate).toBe(500); // 2 servers * 250
  });

  it("decodes a hook attachment into a hook segment", () => {
    const recs: RawRecord[] = [{
      type: "attachment",
      attachment: { type: "hook_success", hookName: "SessionStart",
        stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: "HOOK BODY" } }) },
    }];
    const segs = assembleTurn(recs, bp, est);
    const hook = segs.find(s => s.category === "hook")!;
    expect(hook.source).toBe("hook:SessionStart");
    expect(hook.rawText).toBe("HOOK BODY");
  });

  it("classifies claudeMd, user, thinking, assistant", () => {
    const recs: RawRecord[] = [
      { type: "user", message: { role: "user", content: "<claudeMd>rules here</claudeMd>" } },
      { type: "user", promptId: "p", message: { role: "user", content: "plain question" } },
      { type: "assistant", message: { role: "assistant",
        content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "reply" }] } },
    ];
    const segs = assembleTurn(recs, bp, est);
    const cats = segs.map(s => s.category);
    expect(cats).toContain("claudeMd");
    expect(cats).toContain("user");
    expect(cats).toContain("thinking");
    expect(cats).toContain("assistant");
  });

  it("attributionSkill overrides to skill category", () => {
    const recs: RawRecord[] = [{
      type: "assistant", attributionSkill: "brainstorming",
      message: { role: "assistant", content: [{ type: "text", text: "x" }] },
    }];
    const segs = assembleTurn(recs, bp, est);
    const skill = segs.find(s => s.category === "skill")!;
    expect(skill.source).toBe("skill:brainstorming");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/contextAssembler.test.ts`
Expected: FAIL — cannot find module `contextAssembler`.

- [ ] **Step 3: Write `src/core/contextAssembler.ts`**

```ts
import { RawRecord, Segment, SegmentCategory, ConfigBlueprint } from "./types";
import { TokenEstimator } from "./tokenEstimator";

let counter = 0;
function mk(
  category: SegmentCategory, source: string, rawText: string,
  est: TokenEstimator, opts: Partial<Segment> = {}
): Segment {
  return {
    id: `seg-${counter++}`,
    category, source, rawText,
    tokenEstimate: opts.estimated ? (opts.tokenEstimate ?? 0) : est.estimate(rawText),
    estimated: opts.estimated ?? false,
    sourcePath: opts.sourcePath,
    note: opts.note,
  };
}

function decodeHook(att: any): { name: string; text: string } {
  const name = att.hookName ?? "unknown";
  let text = att.content ?? "";
  try {
    const parsed = JSON.parse(att.stdout ?? "{}");
    text = parsed?.hookSpecificOutput?.additionalContext ?? att.stdout ?? text;
  } catch { text = att.stdout ?? text; }
  return { name, text: String(text) };
}

function applyAttribution(seg: Segment, rec: RawRecord): Segment {
  if (rec.attributionSkill) { seg.category = "skill"; seg.source = `skill:${rec.attributionSkill}`; }
  else if (rec.attributionMcpServer) { seg.category = "mcpInstructions"; seg.source = `mcp:${rec.attributionMcpServer}`; }
  return seg;
}

export function assembleTurn(
  records: RawRecord[], blueprint: ConfigBlueprint, est: TokenEstimator
): Segment[] {
  counter = 0;
  const segs: Segment[] = [];

  segs.push(mk("baseSystemPrompt", "base-system-prompt", "", est, {
    estimated: true, tokenEstimate: 2500,
    note: "Base system prompt — constructed by the CLI at runtime, not captured in the transcript (rough estimate).",
  }));
  segs.push(mk("toolDefinitions", "tool-definitions", "", est, {
    estimated: true, tokenEstimate: blueprint.mcpServers.length * 250,
    note: "Tool JSON schemas — not captured; estimated from MCP server count (~250 tokens/server).",
  }));

  for (const rec of records) {
    if (rec.type === "attachment" && rec.attachment?.type === "hook_success") {
      const { name, text } = decodeHook(rec.attachment);
      segs.push(applyAttribution(mk("hook", `hook:${name}`, text, est), rec));
      continue;
    }

    const content = rec.message?.content;
    if (rec.type === "user") {
      if (typeof content === "string") {
        let category: SegmentCategory = "user";
        let source = "user";
        if (content.includes("<claudeMd>")) { category = "claudeMd"; source = "CLAUDE.md"; }
        else if (content.includes("<system-reminder>")) { category = "systemReminder"; source = "system-reminder"; }
        segs.push(applyAttribution(mk(category, source, content, est), rec));
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "tool_result") {
            const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
            segs.push(applyAttribution(mk("toolResult", "tool-result", t, est), rec));
          } else if (b?.type === "text") {
            segs.push(applyAttribution(mk("user", "user", b.text ?? "", est), rec));
          }
        }
      }
      continue;
    }

    if (rec.type === "assistant" && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "thinking") {
          segs.push(applyAttribution(mk("thinking", "assistant:thinking", b.thinking ?? "", est), rec));
        } else if (b?.type === "text") {
          segs.push(applyAttribution(mk("assistant", "assistant", b.text ?? "", est), rec));
        } else if (b?.type === "tool_use") {
          const t = `${b.name}(${JSON.stringify(b.input ?? {})})`;
          segs.push(applyAttribution(mk("assistant", "assistant:tool_use", t, est), rec));
        }
      }
    }
  }
  return segs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/contextAssembler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/contextAssembler.ts test/contextAssembler.test.ts
git commit -m "feat: context assembler classifies records into typed segments"
```

---

## Task 5: SessionLocator (match sessions by cwd)

**Files:**
- Create: `src/core/sessionLocator.ts`
- Create: `test/fixtures/projects/enc/s1.jsonl`, `test/fixtures/projects/enc/other.jsonl`
- Test: `test/sessionLocator.test.ts`

**Interfaces:**
- Consumes: `SessionInfo` from `types.ts`.
- Produces: `findSessionsForWorkspace(workspacePath: string, projectsDir: string): Promise<SessionInfo[]>` — scans `projectsDir/*/*.jsonl`, reads each file's first valid record, keeps those whose `cwd === workspacePath`, sorted by `mtimeMs` descending.

- [ ] **Step 1: Create fixtures**

`test/fixtures/projects/enc/s1.jsonl` (first record carries matching cwd):
```
{"type":"user","promptId":"p1","cwd":"/tmp/target-ws","sessionId":"s1","message":{"role":"user","content":"hi"}}
```

`test/fixtures/projects/enc/other.jsonl` (different cwd):
```
{"type":"user","promptId":"p1","cwd":"/tmp/other-ws","sessionId":"other","message":{"role":"user","content":"hi"}}
```

- [ ] **Step 2: Write the failing test** — `test/sessionLocator.test.ts`

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/sessionLocator.test.ts`
Expected: FAIL — cannot find module `sessionLocator`.

- [ ] **Step 4: Write `src/core/sessionLocator.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/sessionLocator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/sessionLocator.ts test/fixtures/projects test/sessionLocator.test.ts
git commit -m "feat: locate sessions for a workspace by transcript cwd"
```

---

## Task 6: ViewModel (summary, waste flags, colors)

**Files:**
- Create: `src/core/viewModel.ts`
- Test: `test/viewModel.test.ts`

**Interfaces:**
- Consumes: `Segment`, `SegmentCategory` from `types.ts`.
- Produces:
  - `categoryColor(cat: SegmentCategory): string` — stable hex per category.
  - `buildViewModel(segments: Segment[], previous?: Segment[]): ViewModel` where
    ```ts
    interface CategoryTotal { category: SegmentCategory; tokens: number; }
    interface WasteFlag { segmentId: string; kind: "large" | "repeated" | "estimated"; detail: string; }
    interface ViewModel {
      segments: Segment[];
      totalTokens: number;
      byCategory: CategoryTotal[];   // desc by tokens
      top: Segment[];                // top 3 by tokens (non-estimated)
      wasteFlags: WasteFlag[];
    }
    ```
  - Waste rules: `estimated` segment → `estimated` flag; token ≥ 1500 → `large` flag; a segment whose `rawText` also appears in `previous` (same text) → `repeated` flag ("re-injected from previous turn").

- [ ] **Step 1: Write the failing test** — `test/viewModel.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildViewModel, categoryColor } from "../src/core/viewModel";
import { Segment } from "../src/core/types";

function seg(id: string, cat: any, tokens: number, text = "x", estimated = false): Segment {
  return { id, category: cat, source: cat, rawText: text, tokenEstimate: tokens, estimated };
}

describe("viewModel", () => {
  it("sums totals and groups by category descending", () => {
    const vm = buildViewModel([seg("a", "user", 10), seg("b", "hook", 100), seg("c", "user", 5)]);
    expect(vm.totalTokens).toBe(115);
    expect(vm.byCategory[0].category).toBe("hook");
  });
  it("flags large and estimated segments", () => {
    const vm = buildViewModel([seg("big", "hook", 2000), seg("est", "baseSystemPrompt", 2500, "", true)]);
    const kinds = vm.wasteFlags.map(f => f.kind);
    expect(kinds).toContain("large");
    expect(kinds).toContain("estimated");
  });
  it("flags text repeated from the previous turn", () => {
    const prev = [seg("p", "hook", 50, "ROUTER REMINDER")];
    const vm = buildViewModel([seg("cur", "hook", 50, "ROUTER REMINDER")], prev);
    expect(vm.wasteFlags.some(f => f.kind === "repeated")).toBe(true);
  });
  it("gives every category a distinct color string", () => {
    expect(categoryColor("hook")).toMatch(/^#/);
    expect(categoryColor("hook")).not.toBe(categoryColor("user"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/viewModel.test.ts`
Expected: FAIL — cannot find module `viewModel`.

- [ ] **Step 3: Write `src/core/viewModel.ts`**

```ts
import { Segment, SegmentCategory } from "./types";

const COLORS: Record<SegmentCategory, string> = {
  baseSystemPrompt: "#6b7280", toolDefinitions: "#9ca3af", claudeMd: "#2563eb",
  skill: "#7c3aed", hook: "#dc2626", memory: "#0d9488", mcpInstructions: "#d97706",
  toolResult: "#65a30d", user: "#0891b2", assistant: "#4f46e5",
  thinking: "#a855f7", systemReminder: "#db2777",
};

export function categoryColor(cat: SegmentCategory): string {
  return COLORS[cat] ?? "#888888";
}

export interface CategoryTotal { category: SegmentCategory; tokens: number; }
export interface WasteFlag { segmentId: string; kind: "large" | "repeated" | "estimated"; detail: string; }
export interface ViewModel {
  segments: Segment[];
  totalTokens: number;
  byCategory: CategoryTotal[];
  top: Segment[];
  wasteFlags: WasteFlag[];
}

const LARGE_THRESHOLD = 1500;

export function buildViewModel(segments: Segment[], previous?: Segment[]): ViewModel {
  const totalTokens = segments.reduce((n, s) => n + s.tokenEstimate, 0);

  const byMap = new Map<SegmentCategory, number>();
  for (const s of segments) byMap.set(s.category, (byMap.get(s.category) ?? 0) + s.tokenEstimate);
  const byCategory = [...byMap.entries()]
    .map(([category, tokens]) => ({ category, tokens }))
    .sort((a, b) => b.tokens - a.tokens);

  const top = [...segments].filter(s => !s.estimated)
    .sort((a, b) => b.tokenEstimate - a.tokenEstimate).slice(0, 3);

  const prevTexts = new Set((previous ?? []).map(s => s.rawText).filter(Boolean));
  const wasteFlags: WasteFlag[] = [];
  for (const s of segments) {
    if (s.estimated) wasteFlags.push({ segmentId: s.id, kind: "estimated", detail: "Not captured in transcript (estimated)." });
    if (s.tokenEstimate >= LARGE_THRESHOLD) wasteFlags.push({ segmentId: s.id, kind: "large", detail: `${s.tokenEstimate} tokens` });
    if (s.rawText && prevTexts.has(s.rawText)) wasteFlags.push({ segmentId: s.id, kind: "repeated", detail: "Re-injected from previous turn." });
  }

  return { segments, totalTokens, byCategory, top, wasteFlags };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/viewModel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/viewModel.ts test/viewModel.test.ts
git commit -m "feat: view model with token summary and waste flags"
```

---

## Task 7: Extension host + Webview UI (integration, visual verify)

**Files:**
- Create: `src/extension.ts`
- Create: `src/webview/main.ts`
- Create: `src/webview/styles.css`

**Interfaces:**
- Consumes: all core modules; `ViewModel` from `viewModel.ts`.
- Produces: the `claudeContext.visualize` command. Extension→Webview message: `{ type: "render", vm: ViewModel }`. Webview→Extension message: `{ type: "openFile", path: string }`.
- Flow: command → resolve `workspaceFolders[0]` → `findSessionsForWorkspace(ws, join(homedir(), ".claude", "projects"))` → QuickPick session → `indexTurns` → QuickPick turn (label = `promptPreview`) → `readTurn` current (+ previous) → `scanBlueprint(ws)` → `assembleTurn` → `buildViewModel(cur, prev)` → post to webview. Empty sessions → still open webview in blueprint mode using `assembleTurn([], blueprint, est)`.

- [ ] **Step 1: Write `src/extension.ts`**

```ts
import * as vscode from "vscode";
import { homedir } from "os";
import { join } from "path";
import { readFileSync } from "fs";
import { findSessionsForWorkspace } from "./core/sessionLocator";
import { indexTurns, readTurn } from "./core/transcriptParser";
import { scanBlueprint } from "./core/configScanner";
import { assembleTurn } from "./core/contextAssembler";
import { buildViewModel } from "./core/viewModel";
import { HeuristicTokenEstimator } from "./core/tokenEstimator";

export function activate(context: vscode.ExtensionContext) {
  const est = new HeuristicTokenEstimator();

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeContext.visualize", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) { vscode.window.showErrorMessage("Open a workspace folder first."); return; }
      const ws = folder.uri.fsPath;
      const blueprint = await scanBlueprint(ws);

      const sessions = await findSessionsForWorkspace(ws, join(homedir(), ".claude", "projects"));
      let segments = assembleTurn([], blueprint, est);
      let prev = undefined;

      if (sessions.length) {
        const pick = await vscode.window.showQuickPick(
          sessions.map(s => ({ label: s.sessionId, description: new Date(s.mtimeMs).toLocaleString(), s })),
          { placeHolder: "Select a Claude Code session" }
        );
        if (pick) {
          const turns = await indexTurns(pick.s.filePath);
          const tPick = await vscode.window.showQuickPick(
            turns.map(t => ({ label: `#${t.turn + 1} ${t.promptPreview}`, t })),
            { placeHolder: "Select a turn" }
          );
          if (tPick) {
            const cur = await readTurn(pick.s.filePath, tPick.t);
            segments = assembleTurn(cur, blueprint, est);
            if (tPick.t.turn > 0) {
              const p = await readTurn(pick.s.filePath, turns[tPick.t.turn - 1]);
              prev = assembleTurn(p, blueprint, est);
            }
          }
        }
      }

      const vm = buildViewModel(segments, prev);
      const panel = vscode.window.createWebviewPanel(
        "claudeContext", "Claude Context", vscode.ViewColumn.One, { enableScripts: true }
      );
      panel.webview.html = renderHtml(panel.webview, context);
      panel.webview.onDidReceiveMessage((msg) => {
        if (msg?.type === "openFile" && msg.path) {
          vscode.window.showTextDocument(vscode.Uri.file(msg.path));
        }
      });
      panel.webview.postMessage({ type: "render", vm });
    })
  );
}

function renderHtml(webview: vscode.Webview, ctx: vscode.ExtensionContext): string {
  const script = webview.asWebviewUri(vscode.Uri.file(join(ctx.extensionPath, "dist", "webview.js")));
  const css = readFileSync(join(ctx.extensionPath, "src", "webview", "styles.css"), "utf8");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div id="summary"></div><div id="stack"></div><div id="drilldown"></div>
<script src="${script}"></script></body></html>`;
}

export function deactivate() {}
```

- [ ] **Step 2: Write `src/webview/main.ts`**

```ts
import { ViewModel, categoryColor } from "../core/viewModel";

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscodeApi = acquireVsCodeApi();

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg?.type === "render") render(msg.vm as ViewModel);
});

function render(vm: ViewModel) {
  const summary = document.getElementById("summary")!;
  summary.innerHTML =
    `<h2>Total ≈ ${vm.totalTokens} tokens</h2>` +
    `<div class="legend">` +
    vm.byCategory.map(c =>
      `<span class="chip" style="background:${categoryColor(c.category)}">${c.category}: ${c.tokens}</span>`
    ).join("") + `</div>` +
    (vm.wasteFlags.length ? `<div class="waste">⚠ ${vm.wasteFlags.length} optimization flag(s)</div>` : "");

  const stack = document.getElementById("stack")!;
  stack.innerHTML = "";
  const maxTok = Math.max(1, ...vm.segments.map(s => s.tokenEstimate));
  for (const s of vm.segments) {
    const block = document.createElement("div");
    block.className = "block" + (s.estimated ? " estimated" : "");
    block.style.background = categoryColor(s.category);
    block.style.height = `${Math.max(18, (s.tokenEstimate / maxTok) * 120)}px`;
    block.title = `${s.source} — ${s.tokenEstimate} tokens`;
    block.textContent = `${s.source} (${s.tokenEstimate})`;
    block.onclick = () => showDrill(s);
    stack.appendChild(block);
  }
}

function showDrill(s: any) {
  const d = document.getElementById("drilldown")!;
  d.innerHTML =
    `<h3>${s.source} — ${s.tokenEstimate} tokens${s.estimated ? " (estimated)" : ""}</h3>` +
    (s.note ? `<p class="note">${escapeHtml(s.note)}</p>` : "") +
    (s.sourcePath ? `<button id="openBtn">Open ${escapeHtml(s.sourcePath)}</button>` : "") +
    `<pre>${escapeHtml(s.rawText || "(no captured text)")}</pre>`;
  const btn = document.getElementById("openBtn");
  if (btn) btn.onclick = () => vscodeApi.postMessage({ type: "openFile", path: s.sourcePath });
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
```

- [ ] **Step 3: Write `src/webview/styles.css`**

```css
body { font-family: sans-serif; padding: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chip { color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.waste { color: #b45309; margin: 6px 0; font-weight: 600; }
#stack { display: flex; flex-direction: column; gap: 2px; margin: 12px 0; }
.block { color: #fff; font-size: 12px; padding: 2px 8px; cursor: pointer; overflow: hidden; border-radius: 3px; }
.block.estimated { background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px); }
#drilldown pre { background: #1e1e1e; color: #eee; padding: 10px; overflow: auto; max-height: 320px; white-space: pre-wrap; }
.note { font-style: italic; color: #555; }
```

- [ ] **Step 4: Build the bundles**

Run: `npm run build`
Expected: `dist/extension.js` and `dist/webview.js` are produced with no errors.

- [ ] **Step 5: Visual verify in the Extension Development Host**

Create `.vscode/launch.json`:
```json
{ "version": "0.2.0", "configurations": [
  { "name": "Run Extension", "type": "extensionHost", "request": "launch",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}"], "outFiles": ["${workspaceFolder}/dist/**/*.js"] } ] }
```
Press F5. In the new window, open the PuzzleMaple folder, run **"Claude Context: Visualize"** from the Command Palette, pick a session and a turn. Confirm: the segment stack renders with colored blocks, clicking a hook block shows its raw `additionalContext`, the summary shows totals and at least one waste flag. This is a manual verification step (no automated assertion).

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts src/webview/main.ts src/webview/styles.css .vscode/launch.json
git commit -m "feat: extension host wiring + webview segment stack UI"
```

---

## Task 8: Packaging + README + portability verification

**Files:**
- Create: `README.md`
- Modify: none (uses `package.json` script from Task 1)

**Interfaces:**
- Consumes: the built extension.
- Produces: a `.vsix` installable in any VS Code, plus usage docs.

- [ ] **Step 1: Write `README.md`**

```markdown
# Claude Context Visualizer

Visualize how Claude Code assembles its per-turn LLM context from CLAUDE.md,
skills, hooks, memory, MCP instructions, tool results, and history — with local
token estimates for debugging and optimization.

## Use
1. Install the `.vsix` (`code --install-extension claude-context-visualizer-0.1.0.vsix`).
2. Open any project folder that you have used with Claude Code.
3. Command Palette → **Claude Context: Visualize** → pick a session → pick a turn.

Sessions are matched to the open workspace by the `cwd` recorded in each
transcript, so one install works in every project. Base system prompt and tool
schemas are shown as hatched **estimated** blocks (not captured in transcripts).

## Develop
- `npm i` · `npm run build` · `npm test`
- F5 (Run Extension) for the Extension Development Host.
- `npm run package` to produce the `.vsix`.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all suites PASS (tokenEstimator, transcriptParser, configScanner, contextAssembler, sessionLocator, viewModel).

- [ ] **Step 3: Package the extension**

Run: `npm run package`
Expected: `claude-context-visualizer-0.1.0.vsix` is created. (If `vsce` prompts about a missing repository field, add `"repository": "none"` to `package.json` and re-run.)

- [ ] **Step 4: Portability verification**

Install the `.vsix` into your main VS Code, open a **different** project you have
used with Claude Code, and run **Claude Context: Visualize**. Confirm sessions for
that other project appear and a turn renders. This is manual verification.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json
git commit -m "docs: readme + packaging for portable install"
```

---

## Self-Review Notes

- **Spec coverage:** hybrid source (Tasks 3+2+4), local token estimate behind swappable interface (Task 1), layered segment view + drill-down (Task 7), waste flags incl. per-turn repeat (Task 6), estimated/uncaptured hatching (Tasks 4 color + 7 CSS), blueprint fallback (Task 7 empty-session path), streaming large files (Task 2), cwd-match portability (Task 5), packaging (Task 8). All spec sections map to a task.
- **Type consistency:** `Segment`, `ViewModel`, `assembleTurn`, `buildViewModel`, `findSessionsForWorkspace`, `indexTurns`, `readTurn`, `scanBlueprint`, `categoryColor` names are used identically across tasks.
- **Deferred (v2):** live watching, Anthropic exact tokens, timeline view — intentionally out of MVP.
```
