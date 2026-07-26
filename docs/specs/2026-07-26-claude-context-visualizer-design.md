# Claude Context Visualizer — Design Spec

- **Date:** 2026-07-26
- **Status:** Approved (design phase)
- **Type:** Standalone VS Code Extension (TypeScript)

## 1. Purpose

A VS Code extension that visualizes **what actually goes into Claude Code's LLM
context each turn**, and shows **how each raw-data chunk is assembled** into the
final prompt — so a developer can **debug and optimize** their setup (CLAUDE.md,
skills, hooks, memory, MCP instructions, tool results, history).

Primary goal: **debugging / optimization** — find token waste, spot settings that
inflate context, and confirm that a given config actually lands in the prompt.

## 2. Key Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Core purpose | Debugging / optimization | Accuracy over prettiness |
| Data source | **Hybrid** — static config "blueprint" + live transcript overlay | Shows both "what would assemble" and "what actually did" |
| Token counting | **Local estimate** (script-aware heuristic), behind a swappable interface | No API key / network; relative weight is enough. API-exact deferred to v2 |
| Main visualization | **Layered segment view** — vertical color-coded stack, click → raw drill-down | Best conveys "assembly" of chunks |
| Portability | Extension resolves the **active workspace at runtime**; install once, works in any project | Reusable across all projects, not hardcoded |
| Code location | Standalone repo `~/Desktop/claude-context-visualizer/` | Independent of the MSW project it's first tested against |

## 3. Grounding (verified against real data)

Claude Code writes session transcripts to
`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Verified record types and
fields in a real session:

- `attachment` (`type: hook_success`) → contains the **full hook `additionalContext`
  raw text** (e.g. SessionStart injecting a skill body). This is the literal
  injected content.
- `user` / `assistant` messages → carry `<claudeMd>` blocks, `<system-reminder>`
  blocks, tool results, thinking/text/tool_use content blocks.
- `toolUseResult` → tool result payloads.
- Every record carries **`cwd`**, `sessionId`, `timestamp`, `gitBranch`, `version`.
- Attribution metadata on records: **`attributionSkill`, `attributionMcpServer`,
  `attributionMcpTool`** → lets us auto-classify a chunk's origin.
- **Not logged** (constructed by the CLI at runtime): the base system prompt and
  full tool JSON-schemas. These are shown as **estimated / uncaptured** (hatched).
- Files can be **large (observed up to ~190 MB)** → must stream, never load whole.

`cwd` on every record means **SessionLocator can match the active workspace by
reading each session's `cwd` field** — no need to reverse-engineer the dir-name
encoding.

## 4. Architecture

VS Code extension (TypeScript) + a **Webview** panel. Command
`Claude Context: Visualize` → pick session → pick turn → render segment view.

Six independent, unit-testable modules:

| Module | Responsibility | Depends on |
|---|---|---|
| **SessionLocator** | Enumerate `~/.claude/projects/*/*.jsonl`; match sessions whose `cwd` == active workspace folder; list by recency | fs |
| **TranscriptParser** | **Streaming** line-by-line parse; index turn boundaries; lazy-load a turn's records. Handles `attachment`/`user`/`assistant`/`toolUseResult`/`system`/`mode`/`file-history-snapshot`. Skips + counts malformed lines | fs |
| **ConfigScanner** | Static "blueprint": scan CLAUDE.md/AGENTS.md (recursively resolve `@import`), settings.json (project + `.local` + user `~/.claude/settings.json`: hooks & permissions), skill `SKILL.md` frontmatter, `MEMORY.md` + memory dir, `.mcp.json`. Produces the list of context providers | fs |
| **ContextAssembler** | For a selected turn, decompose content into **segments**; classify each origin via `attribution*` meta + config cross-reference + pattern match (`<claudeMd>`, `<system-reminder>`, hook markers, skill headers). Emit ordered `Segment[]` | Parser + Scanner |
| **TokenEstimator** | Local script-aware heuristic (CJK vs latin). `TokenEstimator` interface so an Anthropic `count_tokens` impl can be swapped in later | — |
| **Webview UI** | Layered segment stack + drill-down + summary bar | all above |

### Segment model

```ts
interface Segment {
  id: string;
  category: SegmentCategory;   // enum, drives color
  source: string;              // e.g. "CLAUDE.md", "hook:SessionStart", "skill:brainstorming", "mcp:msw-maker"
  sourcePath?: string;         // clickable file path when known
  rawText: string;             // original chunk
  tokenEstimate: number;
  estimated: boolean;          // true = not captured in transcript (base prompt, tool schemas) → hatched
  note?: string;               // "why it's here"
}
```

### Categories (color-coded)

Base system prompt *(estimated)* · Tool definitions *(estimated)* ·
CLAUDE.md/AGENTS.md · Loaded skills · **Hook injections** (SessionStart /
UserPromptSubmit / …) · Memory · MCP server instructions · Tool results ·
User messages · Assistant history · Thinking.

## 5. Data Flow

```
ConfigScanner (blueprint) ─┐
                           ├─► ContextAssembler ─► Segment[] (per turn) ─► Webview
TranscriptParser (actual) ─┘
```

## 6. UI

**Main screen — layered segment view:**
- **Top:** turn selector + summary bar — total tokens, per-category donut/legend,
  top token consumers.
- **Center:** vertical stack of blocks **sized proportional to token weight**,
  colored by category. Estimated/uncaptured regions are **hatched**.
- **Click a block → drill-down:** raw original text + source file path (click to
  open in editor) + token count + "why it's here" note.

**Optimization affordances:**
- Distinct hatch for estimated/uncaptured regions.
- Highlight largest chunks.
- **Flag identical blocks re-injected every turn** (e.g. a router reminder costing
  ~21 KB per turn) as waste candidates.
- Show cumulative context growth across turns.

## 7. Edge Cases

- **No transcript for workspace** → fall back to config-only **"blueprint mode"**
  (works without any session).
- **Huge files** → stream + turn-index; never load whole.
- **Malformed lines** → skip and surface the count.
- **No API key needed** (local estimation).

## 8. Testing

- Unit tests per module using a **small fixture jsonl** derived from the real
  record structure:
  - TranscriptParser: turn boundary indexing, record-type handling, malformed skip.
  - ConfigScanner: `@import` recursive resolution, multi-level settings merge.
  - ContextAssembler: origin classification (attribution + pattern match).
  - TokenEstimator: CJK vs latin heuristic sanity.
- Integration: load fixture → assert produced `Segment[]`.

## 9. Scope

**MVP (v1):**
- Command → pick session → pick turn → layered segment view + drill-down +
  local token estimates + category summary + waste flags.
- Config-only blueprint fallback.
- Portable: resolves active workspace at runtime; packaged as an installable
  `.vsix` (install once, use in every project).

**Deferred (v2, YAGNI):**
- Real-time live watching of the active session.
- Anthropic `count_tokens` exact tokens (swap the TokenEstimator impl).
- Turn-by-turn timeline view.

## 10. Dev / Test Loop

1. Develop against this first project (PuzzleMaple) in the **Extension
   Development Host**.
2. Once stable, `vsce package` → install the `.vsix` globally.
3. Open any other project → command works there via runtime workspace resolution.
