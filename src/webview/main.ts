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

// The sticky breadcrumb bar wraps to a second line on a narrow panel, so its height is
// not a constant. Publish the measured height as --topbar-h so the sticky detail pane
// parks below the bar instead of scrolling under it.
const crumbsEl = document.getElementById("crumbs");
if (crumbsEl && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    const h = Math.round(crumbsEl.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty("--topbar-h", `${h}px`);
  }).observe(crumbsEl);
}

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
let model: string | null = null;
let contextWindow: number | null = null; // the answering model's ceiling — the bar's full width
// "window" answers "how full is the context?"; "composition" answers "what is it made of?".
// The first is the honest default — a normalized bar looks identical at 4% and 60% — but
// it squeezes the small categories, so the other reading stays one click away.
let barScale: "window" | "composition" = "window";
let viewMode: "context" | "turn" = "context"; // full-context (parentUuid thread) vs this-turn-only
const collapsed = new Set<string>(); // collapsed group ids

// Subagents run in their own context window, written to a separate transcript file. They
// hang off the Agent tool_result that launched them and are pulled in only when expanded,
// so their tokens never touch this turn's totals.
interface OffThreadAgent { agentId: string; description?: string; prompt?: string; }
let offThread: OffThreadAgent[] = [];        // launched here, but off the thread being shown
const offRows: Record<string, any> = {};     // synthetic rows for those, so they stay selectable
const subSegs: Record<string, any[]> = {};   // agentId -> that agent's segments
const subDepth: Record<string, number> = {}; // agentId -> nesting level (1 = direct child)
const subExpanded = new Set<string>();
const subLoading = new Set<string>();
const subMissing = new Set<string>();

// Claude Code keeps appending to the transcript while this panel is open. Refresh re-reads
// it, so it has to restore what the user had open/selected instead of resetting the view.
let refreshing = false;
let lastUpdated: number | null = null;
let keepSelection: string | null = null;
let keepScrollY: number | null = null;

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg?.type) return;
  if (["sessions", "turns", "render"].includes(msg.type)) { refreshing = false; lastUpdated = Date.now(); }
  if (msg.type === "sessions") {
    sessions = msg.sessions || [];
    if (sessions.length === 0) { sessionId = null; requestLoadTurn(null, -1); } // blueprint
    else { mode = "sessions"; renderApp(); restoreScroll(); }
  } else if (msg.type === "turns") {
    turns = msg.turns || [];
    totalTurns = turns.length;
    sessionId = msg.sessionId ?? sessionId;
    mode = "turns";
    renderApp();
    restoreScroll();
  } else if (msg.type === "render") {
    const knownGroups = new Set(groups.map((g) => g.id));
    vm = msg.vm as ViewModel;
    sessionId = msg.sessionId ?? null;
    curTurn = msg.turn;
    totalTurns = msg.totalTurns ?? 0;
    groups = msg.groups || [];
    usage = msg.usage || null;
    model = msg.model || null;
    contextWindow = msg.contextWindow || null;
    offThread = msg.offThreadAgents || [];
    viewMode = msg.mode === "turn" ? "turn" : (groups.length ? "context" : "turn");
    wasteBySeg = {};
    for (const f of vm.wasteFlags) (wasteBySeg[f.segmentId] ||= []).push(f.kind);
    // default: collapse prior-turn history groups; keep system, compaction summary, and current turn open
    if (msg.refreshed) {
      // a refresh keeps whatever the user expanded, and only applies the default to the
      // groups that appeared since the last read (e.g. the turn Claude just finished).
      for (const g of groups) {
        if (!knownGroups.has(g.id) && g.isHistory && !g.id.startsWith("g-compact")) collapsed.add(g.id);
      }
      for (const id of [...collapsed]) if (!groups.some((g) => g.id === id)) collapsed.delete(id);
    } else {
      collapsed.clear();
      for (const g of groups) if (g.isHistory && !g.id.startsWith("g-compact")) collapsed.add(g.id);
    }
    // subagent transcripts grow with the session, so drop what was read before; a
    // refresh re-reads whatever was expanded, a fresh load starts collapsed.
    for (const k of Object.keys(subSegs)) delete subSegs[k];
    subLoading.clear();
    subMissing.clear();
    if (!msg.refreshed) subExpanded.clear();
    mode = "context";
    renderApp();
    restoreScroll();
    for (const aid of subExpanded) requestSubagent(aid, subDepth[aid] ?? 1);
  } else if (msg.type === "subagent") {
    const aid: string = msg.agentId;
    subLoading.delete(aid);
    if (msg.missing) subMissing.add(aid);
    else subSegs[aid] = msg.segments || [];
    if (vm && mode === "context") renderList(vm);
  }
});

vscodeApi.postMessage({ type: "ready" });

// ---- requests ----
function requestListTurns(id: string) { sessionId = id; vscodeApi.postMessage({ type: "listTurns", sessionId: id }); }
function requestLoadTurn(id: string | null, turn: number, m: "context" | "turn" = viewMode) {
  vscodeApi.postMessage({ type: "loadTurn", sessionId: id, turn, mode: m });
}
function requestSubagent(agentId: string, depth: number) {
  if (subLoading.has(agentId) || subSegs[agentId]) return;
  subLoading.add(agentId);
  subDepth[agentId] = depth;
  vscodeApi.postMessage({ type: "loadSubagent", sessionId, agentId, depth });
}
function toggleAgent(agentId: string, depth: number) {
  if (subExpanded.has(agentId)) subExpanded.delete(agentId);
  else { subExpanded.add(agentId); requestSubagent(agentId, depth); }
  if (vm) renderList(vm);
}
function requestRefresh() {
  if (refreshing) return;
  refreshing = true;
  keepSelection = selectedId;
  keepScrollY = window.scrollY;
  renderCrumbs();
  vscodeApi.postMessage({
    type: "refresh",
    view: mode,
    sessionId,
    turn: curTurn,
    mode: viewMode,
    // parked on the newest turn → follow the tail as the session grows
    atTail: totalTurns > 0 && curTurn >= totalTurns - 1,
  });
  // don't leave the button stuck on "Refreshing…" if the read never answers
  setTimeout(() => { if (refreshing) { refreshing = false; renderCrumbs(); } }, 15000);
}
function restoreScroll() {
  if (keepScrollY === null) return;
  const y = keepScrollY;
  keepScrollY = null;
  requestAnimationFrame(() => window.scrollTo(0, y));
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
  const stamp = lastUpdated ? `<span class="upd">updated ${new Date(lastUpdated).toLocaleTimeString()}</span>` : "";
  // the button sits right after the trail so it stays next to what it reloads; the
  // timestamp is what gets pushed to the far end.
  c.innerHTML =
    parts.join("") +
    `<button id="refreshBtn" class="tb-btn refresh"${refreshing ? " disabled" : ""}` +
    ` title="Re-read the transcript and config files from disk. Use it while Claude Code is running to pull in new turns.">` +
    `${refreshing ? "⏳ Refreshing…" : "⟳ Refresh"}</button>` + stamp;
  c.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    el.onclick = () => {
      const nav = el.dataset.nav;
      if (nav === "sessions") { mode = "sessions"; renderApp(); }
      else if (nav === "turns" && sessionId) requestListTurns(sessionId);
    };
  });
  const rb = document.getElementById("refreshBtn");
  if (rb) rb.onclick = () => requestRefresh();
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
  // after a refresh, stay on the segment the user was reading if it's still there
  const keep = keepSelection;
  keepSelection = null;
  if (keep && selectableSegments(vm).some((s) => s.id === keep)) select(keep);
  else selectFirstVisible(vm);
}

function grouped(): boolean { return viewMode === "context" && groups.length > 0; }

function visibleSegments(v: ViewModel) {
  return v.segments.filter((s) => !hidden.has(s.category));
}

/** Rows actually reachable in the list right now (filters + collapsed groups applied). */
function selectableSegments(v: ViewModel) {
  const vis = visibleSegments(v);
  return grouped() ? vis.filter((s) => !collapsed.has(s.groupId ?? "")) : vis;
}

function selectFirstVisible(v: ViewModel) {
  const vis = selectableSegments(v);
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
  if (usage && viewMode === "context" && v.measuredTokens != null) {
    // Measured leads; the reconstruction is reported against it rather than as a total of
    // its own, so the part the transcript never recorded stays visible instead of implied.
    // The per-segment estimator can overshoot the measurement. Saying "159% reconstructed"
    // with a 0 remainder would dress that up as a finding, so an overshoot is labelled as
    // what it is: the estimate exceeding ground truth.
    const over = v.recordedTokens > v.measuredTokens;
    const pctRec = Math.round((v.recordedTokens / Math.max(1, v.measuredTokens)) * 100);
    el.innerHTML =
      `<div class="hrow">` +
      `<span class="total">${v.measuredTokens.toLocaleString()}</span>` +
      `<span class="total-label">measured context tokens · ${v.segments.length} segments` +
      `<span class="muted"> — cache-read ${usage.cacheRead.toLocaleString()} · fresh ${usage.freshInput.toLocaleString()} · out ${usage.output.toLocaleString()}</span></span>` +
      waste + `</div>` +
      `<div class="hrow split">` +
      windowChip(v.measuredTokens) +
      `<span class="chip-num${over ? " over" : ""}" title="Sum of the segments the transcript actually contains, at estimated per-segment sizes. ` +
      `${over ? "Here that sum runs past the measured total, so the estimator is overshooting on this session's content — read the shares below as relative, not absolute."
              : "It tracks the measured total only approximately."}">` +
      `≈ ${v.recordedTokens.toLocaleString()} reconstructed <b>${pctRec}%</b>${over ? " ⚠ over-estimated" : ""}</span>` +
      (over ? "" :
        `<span class="chip-num" title="Measured minus reconstructed: the base system prompt and tool schemas (never written to the transcript), plus estimator error.">` +
        `≈ ${v.unrecordedTokens!.toLocaleString()} not in transcript</span>`) +
      `</div>`;
  } else {
    el.innerHTML =
      `<div class="hrow">` +
      `<span class="total">${v.totalTokens.toLocaleString()}</span>` +
      `<span class="total-label">≈ estimated tokens · ${v.segments.length} segments${viewMode === "turn" ? " (this turn only)" : ""}</span>` +
      waste + `</div>`;
  }
}

// How full the model's window is. Only rendered when the model is one whose window we can
// name — a percentage of an assumed ceiling would be worse than no percentage.
function windowChip(used: number): string {
  if (!contextWindow) return "";
  const share = ((used / contextWindow) * 100).toFixed(1);
  const label = contextWindow >= 1_000_000 ? `${contextWindow / 1_000_000}M` : `${contextWindow / 1_000}K`;
  return `<span class="chip-num win" title="Context window of ${escapeHtml(model ?? "this model")}. The bar below spans it.">` +
    `<b>${share}%</b> of ${label} window</span>`;
}

// Offered only when there is a window to scale against — otherwise both modes draw the
// same bar and the control would be a switch that does nothing.
function scaleChip(): string {
  if (!contextWindow) return "";
  const win = barScale === "window";
  return `<span class="chip scale" data-scale="1" title="${win
    ? "Bar spans the model's full context window. Click to rescale it to this turn's own composition."
    : "Bar spans this turn only, so the categories fill it. Click to rescale it to the model's context window."}">` +
    `${win ? "▭ window scale" : "▬ composition scale"}</span>`;
}

function renderBar(v: ViewModel) {
  const bar = document.getElementById("bar")!;
  bar.innerHTML = "";
  // The bar spans the answering model's context window, so its fill is how full the
  // window actually is rather than a normalized breakdown that always looks full.
  const total = barTotal();
  for (const c of v.byCategory) {
    const seg = document.createElement("div");
    seg.className = "bar-seg" + (hidden.has(c.category) ? " dim" : "");
    seg.style.width = `${(c.tokens / total) * 100}%`;
    seg.style.background = categoryColor(c.category);
    seg.title = `${c.category}: ${c.tokens.toLocaleString()} (${pct(c.tokens)})`;
    bar.appendChild(seg);
  }
  const used = v.measuredTokens ?? v.totalTokens;
  if (windowScaled() && used < total) {
    const free = document.createElement("div");
    free.className = "bar-seg free";
    free.style.width = `${((total - used) / total) * 100}%`;
    free.title = `unused context window: ${(total - used).toLocaleString()} of ${total.toLocaleString()}`;
    bar.appendChild(free);
  }
  const legend = document.getElementById("legend")!;
  legend.innerHTML =
    v.byCategory
      .map((c) =>
        `<span class="chip filter${hidden.has(c.category) ? " off" : ""}" data-cat="${c.category}" title="click to show/hide">` +
        `<i style="background:${categoryColor(c.category)}"></i>${c.category} · ${c.tokens.toLocaleString()}</span>`
      )
      .join("") +
    (hidden.size ? `<span class="chip reset" data-cat="__all__" title="show all types">↺ show all</span>` : "") +
    (hidden.size < v.byCategory.length ? `<span class="chip reset" data-cat="__none__" title="hide all types, then pick the ones you want">⊘ hide all</span>` : "") +
    scaleChip();
  const scaleEl = legend.querySelector<HTMLElement>("[data-scale]");
  if (scaleEl) {
    scaleEl.onclick = () => {
      barScale = barScale === "window" ? "composition" : "window";
      if (vm) { renderHeader(vm); renderBar(vm); renderList(vm); }
    };
  }
  legend.querySelectorAll<HTMLElement>("[data-cat]").forEach((el) => {
    el.onclick = () => {
      const cat = el.dataset.cat!;
      if (cat === "__all__" || cat === "__none__") {
        hidden.clear();
        if (cat === "__none__" && vm) for (const c of vm.byCategory) hidden.add(c.category);
        if (vm) { renderBar(vm); renderList(vm); selectFirstVisible(vm); }
      } else toggleCategory(cat);
    };
  });
}

function makeRow(s: any, maxTok: number): HTMLElement {
  const row = document.createElement("div");
  const depth: number = s.depth ?? 0;
  row.className = "row" + (s.estimated ? " estimated" : "") + (depth ? " sub" : "");
  if (depth) row.style.marginLeft = `${depth * 16}px`;
  row.dataset.id = s.id;
  row.style.setProperty("--cat", categoryColor(s.category));
  const flags = wasteBySeg[s.id] || [];
  const badges = flags.map((k) => `<span class="flag" title="${k}">${flagIcon(k)}</span>`).join("");
  // a subagent's share of *this* turn is meaningless — it was never in this context
  const size = s.separateContext
    ? s.tokenEstimate.toLocaleString()
    : `${s.tokenEstimate.toLocaleString()} · ${pct(s.tokenEstimate)}`;
  const caret = s.agentId
    ? `<span class="row-caret" title="show this subagent's own context">${subExpanded.has(s.agentId) ? "▾" : "▸"}</span>`
    : "";
  row.innerHTML =
    `<div class="row-head">${caret}<span class="row-source">${escapeHtml(s.source)}</span>${badges}` +
    `<span class="row-tok">${size}</span></div>` +
    `<div class="row-bar"><div class="row-fill" style="width:${Math.min(100, (s.tokenEstimate / maxTok) * 100)}%"></div></div>`;
  row.onclick = (e) => {
    if (s.agentId && (e.target as HTMLElement).classList.contains("row-caret")) {
      toggleAgent(s.agentId, depth + 1);
      return;
    }
    select(s.id);
  };
  return row;
}

/** A row, followed by the subagent it launched when that one is expanded. */
function appendRow(list: HTMLElement, s: any, maxTok: number): void {
  list.appendChild(makeRow(s, maxTok));
  const aid: string | undefined = s.agentId;
  if (!aid || !subExpanded.has(aid)) return;
  const depth = (s.depth ?? 0) + 1;
  const indent = `margin-left:${depth * 16}px`;
  const kids = subSegs[aid];
  if (!kids) {
    const msg = subMissing.has(aid)
      ? "no transcript on disk for this agent — it predates per-agent logging"
      : "reading this agent's transcript…";
    list.appendChild(note(`sub-note${subMissing.has(aid) ? " miss" : ""}`, indent, msg));
    return;
  }
  const vis = kids.filter((k) => !hidden.has(k.category));
  const tokens = kids.reduce((n, k) => n + k.tokenEstimate, 0);
  list.appendChild(note(
    "sub-head", indent,
    `⤷ subagent ${aid.slice(0, 8)} · ${kids.length} segments · ~${tokens.toLocaleString()} tokens ` +
    `(separate context window — not counted in this turn)`
  ));
  if (vis.length === 0) { list.appendChild(note("sub-note", indent, "all of this agent's types are filtered out")); return; }
  const kidMax = Math.max(1, ...vis.map((k) => k.tokenEstimate)); // scaled within the agent
  for (const k of vis) appendRow(list, k, kidMax);
}

function note(cls: string, style: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  el.setAttribute("style", style);
  el.textContent = text;
  return el;
}

function renderList(v: ViewModel) {
  const list = document.getElementById("stack")!;
  list.innerHTML = "";
  const vis = visibleSegments(v);
  if (vis.length === 0) { list.innerHTML = `<div class="muted" style="padding:8px">No segments — all types filtered out.</div>`; return; }
  const maxTok = Math.max(1, ...vis.map((s) => s.tokenEstimate));
  if (grouped()) { renderGroupedList(v, vis, maxTok, list); renderOffThread(list); return; }
  for (const s of vis) appendRow(list, s, maxTok);
  renderOffThread(list);
}

// Agents that ran in this session but whose Agent call is not on the thread being
// shown — kept below the context proper, never folded into it.
function renderOffThread(list: HTMLElement): void {
  if (offThread.length === 0) return;
  const head = document.createElement("div");
  head.className = "off-head";
  head.textContent =
    `⚑ ${offThread.length} subagent${offThread.length > 1 ? "s" : ""} launched off this thread — ` +
    `ran in this session, but the call is not in this context (an abandoned branch, e.g. an edited prompt)`;
  list.appendChild(head);
  for (const a of offThread) {
    const row = offRows[a.agentId] ||= {
      id: `off-${a.agentId}`,
      category: "toolUse",
      source: `tool:Agent · ${a.description || a.agentId.slice(0, 8)}`,
      rawText: a.prompt || "",
      tokenEstimate: 0,
      estimated: false,
      agentId: a.agentId,
      depth: 0,
      separateContext: true,
      note: "Launched in this session but off the thread shown here, so it was never part of this context. Expand to read what it did.",
    };
    appendRow(list, row, 1);
  }
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
    if (!isColl) for (const s of segs) appendRow(list, s, maxTok);
  }
}

/** Segments live in the view model or, for subagents, in their own lazily-read store. */
function findSeg(id: string): any {
  const s = vm?.segments.find((x) => x.id === id);
  if (s) return s;
  if (id.startsWith("off-") && offRows[id.slice(4)]) return offRows[id.slice(4)];
  for (const kids of Object.values(subSegs)) {
    const k = kids.find((x) => x.id === id);
    if (k) return k;
  }
  return undefined;
}

function select(id: string) {
  selectedId = id;
  document.querySelectorAll(".row").forEach((r) => {
    (r as HTMLElement).classList.toggle("selected", (r as HTMLElement).dataset.id === id);
  });
  const s = findSeg(id);
  rawMode = false; // each newly selected segment starts in auto view
  if (s) renderDetail(s);
}

// The Read tool returns file contents in `cat -n` form ("   12\tconst x = 1").
// Those prefixes are genuinely in the context, but they stop markdown from parsing
// (headings/tables no longer start the line, and every line looks indented enough
// to be a code block). Strip them for rendering only; Raw still shows the original.
const LINE_NUM_RE = /^\s*\d+\t/;

function isLineNumbered(t: string): boolean {
  const lines = t.split("\n", 40).filter((l) => l.trim().length > 0);
  if (lines.length < 3) return false;
  const hits = lines.filter((l) => LINE_NUM_RE.test(l)).length;
  return hits / lines.length >= 0.8;
}

function stripLineNumbers(t: string): string {
  return t.split("\n").map((l) => l.replace(LINE_NUM_RE, "")).join("\n");
}

/** Text to render (line numbers removed when present). */
function renderText(s: any): string {
  const raw: string = s.rawText || "";
  return isLineNumbered(raw) ? stripLineNumbers(raw) : raw;
}

function looksMarkdown(t: string): boolean {
  const head = t.slice(0, 800);
  return /(^|\n)#{1,6}\s/.test(head) || /(^|\n)[-*]\s+\S/.test(head) || /\*\*[^*\n]+\*\*/.test(head) || /```/.test(t);
}
function isMarkdownSeg(s: any): boolean {
  if (typeof s.sourcePath === "string" && s.sourcePath.toLowerCase().endsWith(".md")) return true;
  if (["claudeMd", "memory", "skill", "hook", "compactionSummary"].includes(s.category)) return true;
  return !!s.rawText && looksMarkdown(renderText(s));
}

type Fmt = "json" | "markdown" | "code" | "text";
function detectFormat(s: any): Fmt {
  const t = renderText(s).trim();
  if (!t) return "text";
  if (t[0] === "{" || t[0] === "[") {
    try { JSON.parse(t); return "json"; } catch { /* not json */ }
  }
  if (isMarkdownSeg(s)) return "markdown";
  return "code";
}

interface Body { html: string; label: string; isMd?: boolean; }
function buildBody(s: any, fmt: Fmt): Body {
  const original: string = s.rawText || "";
  if (!original) return { html: `<pre class="d-raw">(no raw text captured — reconstructed/estimated)</pre>`, label: "empty" };
  const numbered = isLineNumbered(original);
  const raw = numbered ? stripLineNumbers(original) : original;
  const suffix = numbered ? " · line-numbered" : "";
  try {
    if (fmt === "json") {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      const h = DOMPurify.sanitize(hljs.highlight(pretty, { language: "json" }).value);
      return { html: `<pre class="hl"><code class="hljs">${h}</code></pre>`, label: "JSON" + suffix };
    }
    if (fmt === "markdown") {
      const h = DOMPurify.sanitize(marked.parse(raw, { async: false }) as string);
      return { html: `<div class="d-md">${h}</div>`, label: "Markdown" + suffix, isMd: true };
    }
    if (fmt === "code") {
      const res = hljs.highlightAuto(raw);
      const rel = res.relevance ?? 0;
      if (rel >= 3) {
        // auto-detected language is unreliable for short snippets — only name it
        // when highly confident, otherwise label generically but still highlight.
        const label = rel >= 6 && res.language ? res.language : "code";
        const h = DOMPurify.sanitize(res.value);
        return { html: `<pre class="hl"><code class="hljs">${h}</code></pre>`, label: label + suffix };
      }
    }
  } catch { /* fall through to plain text */ }
  return { html: `<pre class="d-raw">${escapeHtml(raw)}</pre>`, label: "text" + suffix };
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
    `<span><b>${s.tokenEstimate.toLocaleString()}</b> tokens</span>` +
    (s.separateContext
      ? `<span class="tag-sub">subagent · separate context window</span>`
      : `<span>${pct(s.tokenEstimate)} of turn</span>`) +
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
// Share of the measured context when one was recorded, so a segment's percentage means
// "of what the model actually received" rather than "of our own sum of estimates".
// The denominator the bar and every percentage share. In window scale it is the model's
// ceiling; in composition scale it is this turn's own size, so the categories fill the
// track. max() keeps an overshooting estimate inside the track instead of letting
// overflow:hidden clip it away silently.
function barTotal(): number {
  const used = vm ? (vm.measuredTokens ?? vm.totalTokens) : 0;
  const span = Math.max(used, vm?.recordedTokens ?? 0);
  const ceiling = windowScaled() ? Math.max(contextWindow!, span) : span;
  return Math.max(1, ceiling);
}
// Window scale needs a window; without one there is nothing to scale against and the two
// modes would render identically, so the toggle is hidden and this stays false.
function windowScaled(): boolean {
  return barScale === "window" && !!contextWindow;
}
function pct(tokens: number): string {
  return ((tokens / barTotal()) * 100).toFixed(1) + "%";
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
