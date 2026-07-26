import { ViewModel, categoryColor } from "../core/viewModel";
import { STYLES } from "./styles";

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscodeApi = acquireVsCodeApi();

const styleEl = document.createElement("style");
styleEl.textContent = STYLES;
document.head.appendChild(styleEl);

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg?.type === "init") initTurns(msg.turns || []);
  else if (msg?.type === "render") {
    curTurn = msg.turn;
    totalTurns = msg.totalTurns ?? 0;
    render(msg.vm as ViewModel);
    renderTurnbar();
  }
});

vscodeApi.postMessage({ type: "ready" });

let currentVm: ViewModel | null = null;
let selectedId: string | null = null;
let wasteBySeg: Record<string, string[]> = {};

interface TurnMeta { turn: number; promptPreview: string; timestamp?: string; }
let turnsMeta: TurnMeta[] = [];
let curTurn = -1;
let totalTurns = 0;

function initTurns(turns: TurnMeta[]) {
  turnsMeta = turns;
  totalTurns = turns.length;
  renderTurnbar();
}

function requestTurn(idx: number) {
  if (idx < 0 || idx >= totalTurns) return;
  vscodeApi.postMessage({ type: "selectTurn", turn: idx });
}

function renderTurnbar() {
  const bar = document.getElementById("turnbar")!;
  if (totalTurns === 0) {
    bar.innerHTML = `<span class="tb-note">No Claude Code sessions for this workspace — showing config blueprint only.</span>`;
    return;
  }
  const options = turnsMeta
    .map((t) => {
      const label = t.promptPreview ? t.promptPreview : "(no user text)";
      const sel = t.turn === curTurn ? " selected" : "";
      return `<option value="${t.turn}"${sel}>#${t.turn + 1} · ${escapeHtml(label).slice(0, 70)}</option>`;
    })
    .join("");
  bar.innerHTML =
    `<button id="tbPrev" class="tb-btn" ${curTurn <= 0 ? "disabled" : ""}>◀</button>` +
    `<select id="tbSel" class="tb-sel">${options}</select>` +
    `<button id="tbNext" class="tb-btn" ${curTurn >= totalTurns - 1 ? "disabled" : ""}>▶</button>` +
    `<span class="tb-count">turn ${curTurn + 1} / ${totalTurns}</span>`;

  (document.getElementById("tbPrev") as HTMLButtonElement).onclick = () => requestTurn(curTurn - 1);
  (document.getElementById("tbNext") as HTMLButtonElement).onclick = () => requestTurn(curTurn + 1);
  (document.getElementById("tbSel") as HTMLSelectElement).onchange = (ev) =>
    requestTurn(Number((ev.target as HTMLSelectElement).value));
}

function pct(tokens: number): string {
  if (!currentVm || currentVm.totalTokens === 0) return "0%";
  return ((tokens / currentVm.totalTokens) * 100).toFixed(1) + "%";
}

function render(vm: ViewModel) {
  currentVm = vm;
  wasteBySeg = {};
  for (const f of vm.wasteFlags) (wasteBySeg[f.segmentId] ||= []).push(f.kind);

  renderHeader(vm);
  renderBar(vm);
  renderList(vm);

  const largest = [...vm.segments].sort((a, b) => b.tokenEstimate - a.tokenEstimate)[0];
  if (largest) select(largest.id);
}

function renderHeader(vm: ViewModel) {
  const el = document.getElementById("summary")!;
  el.innerHTML =
    `<div class="hrow">` +
    `<span class="total">${vm.totalTokens.toLocaleString()}</span>` +
    `<span class="total-label">tokens assembled this turn · ${vm.segments.length} segments</span>` +
    (vm.wasteFlags.length
      ? `<span class="waste-badge" title="optimization flags">⚠ ${vm.wasteFlags.length}</span>`
      : "") +
    `</div>`;
}

function renderBar(vm: ViewModel) {
  const bar = document.getElementById("bar")!;
  bar.innerHTML = "";
  const total = Math.max(1, vm.totalTokens);
  for (const c of vm.byCategory) {
    const seg = document.createElement("div");
    seg.className = "bar-seg";
    seg.style.width = `${(c.tokens / total) * 100}%`;
    seg.style.background = categoryColor(c.category);
    seg.title = `${c.category}: ${c.tokens.toLocaleString()} (${pct(c.tokens)})`;
    bar.appendChild(seg);
  }
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = vm.byCategory
    .map(
      (c) =>
        `<span class="chip"><i style="background:${categoryColor(c.category)}"></i>${c.category} · ${c.tokens.toLocaleString()}</span>`
    )
    .join("");
  bar.appendChild(legend);
}

function renderList(vm: ViewModel) {
  const list = document.getElementById("stack")!;
  list.innerHTML = "";
  const maxTok = Math.max(1, ...vm.segments.map((s) => s.tokenEstimate));
  for (const s of vm.segments) {
    const row = document.createElement("div");
    row.className = "row" + (s.estimated ? " estimated" : "");
    row.dataset.id = s.id;
    row.style.setProperty("--cat", categoryColor(s.category));

    const flags = wasteBySeg[s.id] || [];
    const badges = flags
      .map((k) => `<span class="flag flag-${k}" title="${k}">${flagIcon(k)}</span>`)
      .join("");

    row.innerHTML =
      `<div class="row-head">` +
      `<span class="row-source">${escapeHtml(s.source)}</span>` +
      badges +
      `<span class="row-tok">${s.tokenEstimate.toLocaleString()} · ${pct(s.tokenEstimate)}</span>` +
      `</div>` +
      `<div class="row-bar"><div class="row-fill" style="width:${(s.tokenEstimate / maxTok) * 100}%"></div></div>`;

    row.onclick = () => select(s.id);
    list.appendChild(row);
  }
}

function flagIcon(kind: string): string {
  if (kind === "repeated") return "♻";
  if (kind === "large") return "▲";
  if (kind === "estimated") return "≈";
  return "⚠";
}

function select(id: string) {
  selectedId = id;
  document.querySelectorAll(".row").forEach((r) => {
    (r as HTMLElement).classList.toggle("selected", (r as HTMLElement).dataset.id === id);
  });
  const s = currentVm?.segments.find((x) => x.id === id);
  if (s) renderDetail(s);
}

function renderDetail(s: any) {
  const d = document.getElementById("detail")!;
  const flags = wasteBySeg[s.id] || [];
  d.innerHTML =
    `<div class="d-head">` +
    `<span class="d-badge" style="background:${categoryColor(s.category)}">${s.category}</span>` +
    `<span class="d-title">${escapeHtml(s.source)}</span>` +
    `</div>` +
    `<div class="d-meta">` +
    `<span><b>${s.tokenEstimate.toLocaleString()}</b> tokens</span>` +
    `<span>${pct(s.tokenEstimate)} of turn</span>` +
    (s.estimated ? `<span class="tag-est">estimated · not captured</span>` : "") +
    flags.map((k) => `<span class="d-flag">${flagIcon(k)} ${k}</span>`).join("") +
    `</div>` +
    (s.note ? `<div class="d-note">${escapeHtml(s.note)}</div>` : "") +
    `<div class="d-actions">` +
    (s.sourcePath ? `<button id="openBtn">📄 Open source file</button>` : "") +
    (s.rawText ? `<button id="copyBtn">⧉ Copy raw</button>` : "") +
    `</div>` +
    `<pre class="d-raw">${escapeHtml(s.rawText || "(no raw text captured — this segment is reconstructed/estimated)")}</pre>`;

  const openBtn = document.getElementById("openBtn");
  if (openBtn) openBtn.onclick = () => vscodeApi.postMessage({ type: "openFile", path: s.sourcePath });
  const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement | null;
  if (copyBtn)
    copyBtn.onclick = () => {
      try {
        navigator.clipboard?.writeText(s.rawText || "");
        copyBtn.textContent = "✓ Copied";
        setTimeout(() => (copyBtn.textContent = "⧉ Copy raw"), 1200);
      } catch {
        /* clipboard unavailable */
      }
    };
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
