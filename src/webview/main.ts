import { ViewModel, categoryColor } from "../core/viewModel";
import { STYLES } from "./styles";
import { marked } from "marked";
import DOMPurify from "dompurify";

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscodeApi = acquireVsCodeApi();

const styleEl = document.createElement("style");
styleEl.textContent = STYLES;
document.head.appendChild(styleEl);

// ---- state ----
type Mode = "sessions" | "turns" | "context";
interface SessionMeta { id: string; mtimeMs: number; }
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
    wasteBySeg = {};
    for (const f of vm.wasteFlags) (wasteBySeg[f.segmentId] ||= []).push(f.kind);
    mode = "context";
    renderApp();
  }
});

vscodeApi.postMessage({ type: "ready" });

// ---- requests ----
function requestListTurns(id: string) { sessionId = id; vscodeApi.postMessage({ type: "listTurns", sessionId: id }); }
function requestLoadTurn(id: string | null, turn: number) { vscodeApi.postMessage({ type: "loadTurn", sessionId: id, turn }); }

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
          `<div class="pl-row" data-id="${escapeHtml(s.id)}">` +
          `<span class="pl-main">${escapeHtml(shortId(s.id))}</span>` +
          `<span class="pl-sub">${new Date(s.mtimeMs).toLocaleString()}</span>` +
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
  // turn stepper
  const stepper =
    totalTurns > 0
      ? `<div class="stepper">` +
        `<button id="tbPrev" class="tb-btn" ${curTurn <= 0 ? "disabled" : ""}>◀ prev</button>` +
        `<span class="tb-count">turn ${curTurn + 1} / ${totalTurns}</span>` +
        `<button id="tbNext" class="tb-btn" ${curTurn >= totalTurns - 1 ? "disabled" : ""}>next ▶</button>` +
        `</div>`
      : `<div class="stepper"><span class="muted">config blueprint (no session)</span></div>`;

  view.innerHTML =
    stepper +
    `<header id="summary"></header>` +
    `<div id="bar" class="bar"></div>` +
    `<div class="panes"><div id="stack" class="list"></div><div id="detail" class="detail"></div></div>`;

  if (totalTurns > 0) {
    const prevB = document.getElementById("tbPrev") as HTMLButtonElement | null;
    const nextB = document.getElementById("tbNext") as HTMLButtonElement | null;
    if (prevB) prevB.onclick = () => requestLoadTurn(sessionId, curTurn - 1);
    if (nextB) nextB.onclick = () => requestLoadTurn(sessionId, curTurn + 1);
  }

  renderHeader(vm);
  renderBar(vm);
  renderList(vm);
  const largest = [...vm.segments].sort((a, b) => b.tokenEstimate - a.tokenEstimate)[0];
  if (largest) select(largest.id);
}

function renderHeader(v: ViewModel) {
  const el = document.getElementById("summary")!;
  el.innerHTML =
    `<div class="hrow">` +
    `<span class="total">${v.totalTokens.toLocaleString()}</span>` +
    `<span class="total-label">tokens assembled · ${v.segments.length} segments</span>` +
    (v.wasteFlags.length ? `<span class="waste-badge" title="optimization flags">⚠ ${v.wasteFlags.length}</span>` : "") +
    `</div>`;
}

function renderBar(v: ViewModel) {
  const bar = document.getElementById("bar")!;
  bar.innerHTML = "";
  const total = Math.max(1, v.totalTokens);
  for (const c of v.byCategory) {
    const seg = document.createElement("div");
    seg.className = "bar-seg";
    seg.style.width = `${(c.tokens / total) * 100}%`;
    seg.style.background = categoryColor(c.category);
    seg.title = `${c.category}: ${c.tokens.toLocaleString()} (${pct(c.tokens)})`;
    bar.appendChild(seg);
  }
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = v.byCategory
    .map((c) => `<span class="chip"><i style="background:${categoryColor(c.category)}"></i>${c.category} · ${c.tokens.toLocaleString()}</span>`)
    .join("");
  bar.appendChild(legend);
}

function renderList(v: ViewModel) {
  const list = document.getElementById("stack")!;
  list.innerHTML = "";
  const maxTok = Math.max(1, ...v.segments.map((s) => s.tokenEstimate));
  for (const s of v.segments) {
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
    list.appendChild(row);
  }
}

function select(id: string) {
  selectedId = id;
  document.querySelectorAll(".row").forEach((r) => {
    (r as HTMLElement).classList.toggle("selected", (r as HTMLElement).dataset.id === id);
  });
  const s = vm?.segments.find((x) => x.id === id);
  if (s) renderDetail(s);
}

function isMarkdownSeg(s: any): boolean {
  if (typeof s.sourcePath === "string" && s.sourcePath.toLowerCase().endsWith(".md")) return true;
  return ["claudeMd", "memory", "skill", "hook"].includes(s.category);
}

function renderDetail(s: any) {
  const d = document.getElementById("detail")!;
  const flags = wasteBySeg[s.id] || [];
  const canMd = isMarkdownSeg(s) && !!s.rawText;
  const showRendered = canMd && !rawMode;

  let bodyHtml: string;
  if (showRendered) {
    const dirty = marked.parse(s.rawText, { async: false }) as string;
    bodyHtml = `<div class="d-md">${DOMPurify.sanitize(dirty)}</div>`;
  } else {
    bodyHtml = `<pre class="d-raw">${escapeHtml(s.rawText || "(no raw text captured — reconstructed/estimated)")}</pre>`;
  }

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
    (canMd ? `<button id="mdToggle">${rawMode ? "📖 Rendered" : "</> Raw"}</button>` : "") +
    (s.sourcePath ? `<button id="openBtn">📄 Open source file</button>` : "") +
    (s.rawText ? `<button id="copyBtn">⧉ Copy</button>` : "") +
    `</div>` +
    bodyHtml;

  const mdToggle = document.getElementById("mdToggle");
  if (mdToggle) mdToggle.onclick = () => { rawMode = !rawMode; renderDetail(s); };
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
function flagIcon(kind: string): string {
  return kind === "repeated" ? "♻" : kind === "large" ? "▲" : kind === "estimated" ? "≈" : "⚠";
}
function escapeHtml(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
