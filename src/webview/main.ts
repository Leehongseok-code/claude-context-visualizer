import { ViewModel, categoryColor } from "../core/viewModel";
import { STYLES } from "./styles";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscodeApi = acquireVsCodeApi();

const styleEl = document.createElement("style");
styleEl.textContent = STYLES;
document.head.appendChild(styleEl);

// ---- state ----
type Mode = "sessions" | "turns" | "context";
interface SessionMeta { id: string; mtimeMs: number; preview?: string; }
interface TurnMeta { turn: number; promptPreview: string; timestamp?: string; }

let mode: Mode = "sessions";
let sessions: SessionMeta[] = [];
let sessionId: string | null = null;
let turns: TurnMeta[] = [];
let curTurn = -1;
let totalTurns = 0;
let vm: ViewModel | null = null;
let selectedId: string | null = null;
let wasteBySeg: Record<string, string[]> = {};
let rawMode = false; // markdown toggle: false = rendered, true = raw
const hidden = new Set<string>(); // category filters (persist across turns)

interface Group { id: string; label: string; isHistory: boolean; tokens: number; }
interface Usage { realContextTokens: number; cacheRead: number; cacheCreation: number; freshInput: number; output: number; }
let groups: Group[] = [];
let usage: Usage | null = null;
let viewMode: "context" | "turn" = "context"; // full-context (parentUuid thread) vs this-turn-only
const collapsed = new Set<string>(); // collapsed group ids

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg?.type === "sessions") {
    sessions = msg.sessions || [];
    if (sessions.length === 0) { sessionId = null; requestLoadTurn(null, -1); } // blueprint
    else { mode = "sessions"; renderApp(); }
  } else if (msg?.type === "turns") {
    turns = msg.turns || [];
    totalTurns = turns.length;
    mode = "turns";
    renderApp();
  } else if (msg?.type === "render") {
    vm = msg.vm as ViewModel;
    sessionId = msg.sessionId ?? null;
    curTurn = msg.turn;
    totalTurns = msg.totalTurns ?? 0;
    groups = msg.groups || [];
    usage = msg.usage || null;
    viewMode = msg.mode === "turn" ? "turn" : (groups.length ? "context" : "turn");
    wasteBySeg = {};
    for (const f of vm.wasteFlags) (wasteBySeg[f.segmentId] ||= []).push(f.kind);
    // default: collapse prior-turn history groups; keep system, compaction summary, and current turn open
    collapsed.clear();
    for (const g of groups) if (g.isHistory && !g.id.startsWith("g-compact")) collapsed.add(g.id);
    mode = "context";
    renderApp();
  }
});

vscodeApi.postMessage({ type: "ready" });

// ---- requests ----
function requestListTurns(id: string) { sessionId = id; vscodeApi.postMessage({ type: "listTurns", sessionId: id }); }
function requestLoadTurn(id: string | null, turn: number, m: "context" | "turn" = viewMode) {
  vscodeApi.postMessage({ type: "loadTurn", sessionId: id, turn, mode: m });
}

// ---- render ----
function renderApp() {
  renderCrumbs();
  const view = document.getElementById("view")!;
  view.innerHTML = "";
  if (mode === "sessions") renderSessions(view);
  else if (mode === "turns") renderTurns(view);
  else renderContext(view);
}

function renderCrumbs() {
  const c = document.getElementById("crumbs")!;
  const parts: string[] = [`<a data-nav="sessions" class="crumb${mode === "sessions" ? " active" : ""}">Sessions</a>`];
  if (sessionId && (mode === "turns" || mode === "context")) {
    parts.push(`<span class="sep">▸</span><a data-nav="turns" class="crumb${mode === "turns" ? " active" : ""}">${escapeHtml(shortId(sessionId))}</a>`);
  }
  if (mode === "context" && curTurn >= 0) {
    parts.push(`<span class="sep">▸</span><span class="crumb active">turn #${curTurn + 1}</span>`);
  }
  c.innerHTML = parts.join("");
  c.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    el.onclick = () => {
      const nav = el.dataset.nav;
      if (nav === "sessions") { mode = "sessions"; renderApp(); }
      else if (nav === "turns" && sessionId) requestListTurns(sessionId);
    };
  });
}

function renderSessions(view: HTMLElement) {
  const wrap = document.createElement("div");
  wrap.className = "picklist";
  wrap.innerHTML =
    `<div class="pl-title">Choose a session <span class="muted">(${sessions.length})</span></div>` +
    sessions
      .map(
        (s) =>
          `<div class="pl-row pl-row-2" data-id="${escapeHtml(s.id)}">` +
          `<div class="pl-col">` +
          `<span class="pl-main">${escapeHtml(cleanPreview(s.preview) || "(no user prompt)")}</span>` +
          `<span class="pl-sub">${escapeHtml(shortId(s.id))} · ${new Date(s.mtimeMs).toLocaleString()}</span>` +
          `</div>` +
          `<span class="pl-arrow">▸</span>` +
          `</div>`
      )
      .join("");
  view.appendChild(wrap);
  wrap.querySelectorAll<HTMLElement>(".pl-row").forEach((r) => {
    r.onclick = () => requestListTurns(r.dataset.id!);
  });
}

function renderTurns(view: HTMLElement) {
  const wrap = document.createElement("div");
  wrap.className = "picklist";
  wrap.innerHTML =
    `<div class="pl-title">Choose a turn <span class="muted">(${turns.length})</span></div>` +
    turns
      .map(
        (t) =>
          `<div class="pl-row" data-turn="${t.turn}">` +
          `<span class="pl-idx">#${t.turn + 1}</span>` +
          `<span class="pl-main">${escapeHtml(t.promptPreview || "(no user text)")}</span>` +
          (t.timestamp ? `<span class="pl-sub">${escapeHtml(new Date(t.timestamp).toLocaleString())}</span>` : "") +
          `<span class="pl-arrow">▸</span>` +
          `</div>`
      )
      .join("");
  view.appendChild(wrap);
  wrap.querySelectorAll<HTMLElement>(".pl-row").forEach((r) => {
    r.onclick = () => requestLoadTurn(sessionId, Number(r.dataset.turn));
  });
}

function renderContext(view: HTMLElement) {
  if (!vm) return;
  const modeBtn =
    totalTurns > 0
      ? `<button id="modeToggle" class="tb-btn" title="Full context = the entire parentUuid thread Claude actually received (all history + compaction summaries). This turn = only this turn's own records.">${viewMode === "context" ? "🧵 Full context" : "◻ This turn only"}</button>`
      : "";
  const stepper =
    totalTurns > 0
      ? `<div class="stepper">` +
        `<button id="tbPrev" class="tb-btn" ${curTurn <= 0 ? "disabled" : ""}>◀ prev</button>` +
        `<span class="tb-count">turn ${curTurn + 1} / ${totalTurns}</span>` +
        `<button id="tbNext" class="tb-btn" ${curTurn >= totalTurns - 1 ? "disabled" : ""}>next ▶</button>` +
        modeBtn +
        `</div>`
      : `<div class="stepper"><span class="muted">config blueprint (no session)</span></div>`;

  view.innerHTML =
    stepper +
    `<header id="summary"></header>` +
    `<div id="bar" class="bar"></div>` +
    `<div id="legend" class="legend"></div>` +
    `<div class="panes"><div id="stack" class="list"></div><div id="detail" class="detail"></div></div>`;

  if (totalTurns > 0) {
    const prevB = document.getElementById("tbPrev") as HTMLButtonElement | null;
    const nextB = document.getElementById("tbNext") as HTMLButtonElement | null;
    if (prevB) prevB.onclick = () => requestLoadTurn(sessionId, curTurn - 1);
    if (nextB) nextB.onclick = () => requestLoadTurn(sessionId, curTurn + 1);
    const mB = document.getElementById("modeToggle");
    if (mB) mB.onclick = () => { viewMode = viewMode === "context" ? "turn" : "context"; requestLoadTurn(sessionId, curTurn, viewMode); };
  }

  renderHeader(vm);
  renderBar(vm);
  renderList(vm);
  selectFirstVisible(vm);
}

function grouped(): boolean { return viewMode === "context" && groups.length > 0; }

function visibleSegments(v: ViewModel) {
  return v.segments.filter((s) => !hidden.has(s.category));
}

function selectFirstVisible(v: ViewModel) {
  let vis = visibleSegments(v);
  if (grouped()) vis = vis.filter((s) => !collapsed.has(s.groupId ?? ""));
  const current = vis.filter((s) => !s.isHistory);
  const pool = current.length ? current : vis;
  const largest = [...pool].sort((a, b) => b.tokenEstimate - a.tokenEstimate)[0];
  if (largest) select(largest.id);
  else document.getElementById("detail")!.innerHTML = `<span class="muted">Nothing to show — expand a group or clear filters.</span>`;
}

function toggleCategory(cat: string) {
  if (hidden.has(cat)) hidden.delete(cat); else hidden.add(cat);
  if (!vm) return;
  renderBar(vm);
  renderList(vm);
  const sel = selectedId ? vm.segments.find((s) => s.id === selectedId) : undefined;
  if (!sel || hidden.has(sel.category)) selectFirstVisible(vm);
}

function renderHeader(v: ViewModel) {
  const el = document.getElementById("summary")!;
  const waste = v.wasteFlags.length ? `<span class="waste-badge" title="optimization flags">⚠ ${v.wasteFlags.length}</span>` : "";
  if (usage && viewMode === "context") {
    el.innerHTML =
      `<div class="hrow">` +
      `<span class="total">${usage.realContextTokens.toLocaleString()}</span>` +
      `<span class="total-label">real context tokens (from usage) · ${v.segments.length} segments ` +
      `<span class="muted">— cache-read ${usage.cacheRead.toLocaleString()} · fresh ${usage.freshInput.toLocaleString()} · out ${usage.output.toLocaleString()}; per-segment sizes below are estimated</span></span>` +
      waste + `</div>`;
  } else {
    el.innerHTML =
      `<div class="hrow">` +
      `<span class="total">${v.totalTokens.toLocaleString()}</span>` +
      `<span class="total-label">≈ estimated tokens · ${v.segments.length} segments${viewMode === "turn" ? " (this turn only)" : ""}</span>` +
      waste + `</div>`;
  }
}

function renderBar(v: ViewModel) {
  const bar = document.getElementById("bar")!;
  bar.innerHTML = "";
  const total = Math.max(1, v.totalTokens);
  for (const c of v.byCategory) {
    const seg = document.createElement("div");
    seg.className = "bar-seg" + (hidden.has(c.category) ? " dim" : "");
    seg.style.width = `${(c.tokens / total) * 100}%`;
    seg.style.background = categoryColor(c.category);
    seg.title = `${c.category}: ${c.tokens.toLocaleString()} (${pct(c.tokens)})`;
    bar.appendChild(seg);
  }
  const legend = document.getElementById("legend")!;
  legend.innerHTML =
    v.byCategory
      .map((c) =>
        `<span class="chip filter${hidden.has(c.category) ? " off" : ""}" data-cat="${c.category}" title="click to show/hide">` +
        `<i style="background:${categoryColor(c.category)}"></i>${c.category} · ${c.tokens.toLocaleString()}</span>`
      )
      .join("") +
    (hidden.size ? `<span class="chip reset" data-cat="__all__" title="show all types">↺ show all</span>` : "");
  legend.querySelectorAll<HTMLElement>("[data-cat]").forEach((el) => {
    el.onclick = () => {
      const cat = el.dataset.cat!;
      if (cat === "__all__") { hidden.clear(); if (vm) { renderBar(vm); renderList(vm); } }
      else toggleCategory(cat);
    };
  });
}

function makeRow(s: any, maxTok: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "row" + (s.estimated ? " estimated" : "");
  row.dataset.id = s.id;
  row.style.setProperty("--cat", categoryColor(s.category));
  const flags = wasteBySeg[s.id] || [];
  const badges = flags.map((k) => `<span class="flag" title="${k}">${flagIcon(k)}</span>`).join("");
  row.innerHTML =
    `<div class="row-head"><span class="row-source">${escapeHtml(s.source)}</span>${badges}` +
    `<span class="row-tok">${s.tokenEstimate.toLocaleString()} · ${pct(s.tokenEstimate)}</span></div>` +
    `<div class="row-bar"><div class="row-fill" style="width:${(s.tokenEstimate / maxTok) * 100}%"></div></div>`;
  row.onclick = () => select(s.id);
  return row;
}

function renderList(v: ViewModel) {
  const list = document.getElementById("stack")!;
  list.innerHTML = "";
  const vis = visibleSegments(v);
  if (vis.length === 0) { list.innerHTML = `<div class="muted" style="padding:8px">No segments — all types filtered out.</div>`; return; }
  const maxTok = Math.max(1, ...vis.map((s) => s.tokenEstimate));
  if (grouped()) { renderGroupedList(v, vis, maxTok, list); return; }
  for (const s of vis) list.appendChild(makeRow(s, maxTok));
}

// Full-context view: segments grouped by turn (prior turns collapsible as history,
// the compaction summary highlighted, the current turn expanded).
function renderGroupedList(v: ViewModel, vis: any[], maxTok: number, list: HTMLElement) {
  const bySeg: Record<string, any[]> = {};
  for (const s of vis) (bySeg[s.groupId ?? "_"] ||= []).push(s);
  for (const g of groups) {
    const segs = bySeg[g.id] || [];
    if (segs.length === 0) continue;
    const isColl = collapsed.has(g.id);
    const head = document.createElement("div");
    head.className = "grp-head" + (g.isHistory ? " hist" : "") + (g.id.startsWith("g-compact") ? " compact" : "");
    const tag = g.id === "g-system" ? "" : g.isHistory ? " · history" : " · current";
    head.innerHTML =
      `<span class="grp-caret">${isColl ? "▸" : "▾"}</span>` +
      `<span class="grp-label">${escapeHtml(g.label)}</span>` +
      `<span class="grp-tok">${g.tokens.toLocaleString()}${tag}</span>`;
    head.onclick = () => { if (collapsed.has(g.id)) collapsed.delete(g.id); else collapsed.add(g.id); renderList(v); };
    list.appendChild(head);
    if (!isColl) for (const s of segs) list.appendChild(makeRow(s, maxTok));
  }
}

function select(id: string) {
  selectedId = id;
  document.querySelectorAll(".row").forEach((r) => {
    (r as HTMLElement).classList.toggle("selected", (r as HTMLElement).dataset.id === id);
  });
  const s = vm?.segments.find((x) => x.id === id);
  rawMode = false; // each newly selected segment starts in auto view
  if (s) renderDetail(s);
}

function looksMarkdown(t: string): boolean {
  const head = t.slice(0, 800);
  return /(^|\n)#{1,6}\s/.test(head) || /(^|\n)[-*]\s+\S/.test(head) || /\*\*[^*\n]+\*\*/.test(head) || /```/.test(t);
}
function isMarkdownSeg(s: any): boolean {
  if (typeof s.sourcePath === "string" && s.sourcePath.toLowerCase().endsWith(".md")) return true;
  if (["claudeMd", "memory", "skill", "hook", "compactionSummary"].includes(s.category)) return true;
  return !!s.rawText && looksMarkdown(s.rawText);
}

type Fmt = "json" | "markdown" | "code" | "text";
function detectFormat(s: any): Fmt {
  const t = (s.rawText || "").trim();
  if (!t) return "text";
  if (t[0] === "{" || t[0] === "[") {
    try { JSON.parse(t); return "json"; } catch { /* not json */ }
  }
  if (isMarkdownSeg(s)) return "markdown";
  return "code";
}

interface Body { html: string; label: string; isMd?: boolean; }
function buildBody(s: any, fmt: Fmt): Body {
  const raw: string = s.rawText || "";
  if (!raw) return { html: `<pre class="d-raw">(no raw text captured — reconstructed/estimated)</pre>`, label: "empty" };
  try {
    if (fmt === "json") {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      const h = DOMPurify.sanitize(hljs.highlight(pretty, { language: "json" }).value);
      return { html: `<pre class="hl"><code class="hljs">${h}</code></pre>`, label: "JSON" };
    }
    if (fmt === "markdown") {
      const h = DOMPurify.sanitize(marked.parse(raw, { async: false }) as string);
      return { html: `<div class="d-md">${h}</div>`, label: "Markdown", isMd: true };
    }
    if (fmt === "code") {
      const res = hljs.highlightAuto(raw);
      const rel = res.relevance ?? 0;
      if (rel >= 3) {
        // auto-detected language is unreliable for short snippets — only name it
        // when highly confident, otherwise label generically but still highlight.
        const label = rel >= 6 && res.language ? res.language : "code";
        const h = DOMPurify.sanitize(res.value);
        return { html: `<pre class="hl"><code class="hljs">${h}</code></pre>`, label };
      }
    }
  } catch { /* fall through to plain text */ }
  return { html: `<pre class="d-raw">${escapeHtml(raw)}</pre>`, label: "text" };
}

function renderDetail(s: any) {
  const d = document.getElementById("detail")!;
  const flags = wasteBySeg[s.id] || [];
  const body: Body = rawMode
    ? { html: `<pre class="d-raw">${escapeHtml(s.rawText || "(no raw text)")}</pre>`, label: "raw" }
    : buildBody(s, detectFormat(s));

  d.innerHTML =
    `<div class="d-head">` +
    `<span class="d-badge" style="background:${categoryColor(s.category)}">${s.category}</span>` +
    `<span class="d-title">${escapeHtml(s.source)}</span></div>` +
    `<div class="d-meta">` +
    `<span><b>${s.tokenEstimate.toLocaleString()}</b> tokens</span><span>${pct(s.tokenEstimate)} of turn</span>` +
    (s.estimated ? `<span class="tag-est">estimated · not captured</span>` : "") +
    flags.map((k) => `<span class="d-flag">${flagIcon(k)} ${k}</span>`).join("") +
    `</div>` +
    (s.note ? `<div class="d-note">${escapeHtml(s.note)}</div>` : "") +
    `<div class="d-actions">` +
    (s.rawText ? `<button id="fmtToggle">${rawMode ? "✨ Auto view" : "</> Raw"}</button>` : "") +
    `<span class="fmt-label">${escapeHtml(body.label)}</span>` +
    (s.sourcePath ? `<button id="openBtn">📄 Open source file</button>` : "") +
    (s.rawText ? `<button id="copyBtn">⧉ Copy</button>` : "") +
    `</div>` +
    body.html;

  // highlight fenced code blocks inside rendered markdown
  if (body.isMd) d.querySelectorAll<HTMLElement>(".d-md pre code").forEach((el) => { try { hljs.highlightElement(el); } catch { /* ignore */ } });

  const fmtToggle = document.getElementById("fmtToggle");
  if (fmtToggle) fmtToggle.onclick = () => { rawMode = !rawMode; renderDetail(s); };
  const openBtn = document.getElementById("openBtn");
  if (openBtn) openBtn.onclick = () => vscodeApi.postMessage({ type: "openFile", path: s.sourcePath });
  const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement | null;
  if (copyBtn) copyBtn.onclick = () => {
    try {
      navigator.clipboard?.writeText(s.rawText || "");
      copyBtn.textContent = "✓ Copied";
      setTimeout(() => (copyBtn.textContent = "⧉ Copy"), 1200);
    } catch { /* clipboard unavailable */ }
  };
}

// ---- utils ----
function pct(tokens: number): string {
  if (!vm || vm.totalTokens === 0) return "0%";
  return ((tokens / vm.totalTokens) * 100).toFixed(1) + "%";
}
function shortId(id: string): string { return id.length > 12 ? id.slice(0, 8) + "…" : id; }
// Tidy up slash-command / caveat wrappers so the session preview reads cleanly.
function cleanPreview(t?: string): string {
  if (!t) return "";
  return t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function flagIcon(kind: string): string {
  return kind === "repeated" ? "♻" : kind === "large" ? "▲" : kind === "estimated" ? "≈" : "⚠";
}
function escapeHtml(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
