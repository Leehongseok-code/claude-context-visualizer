import { ViewModel, categoryColor } from "../core/viewModel";
import { STYLES } from "./styles";

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscodeApi = acquireVsCodeApi();

const styleEl = document.createElement("style");
styleEl.textContent = STYLES;
document.head.appendChild(styleEl);

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg?.type === "render") render(msg.vm as ViewModel);
});

vscodeApi.postMessage({ type: "ready" });

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
    `<h3>${escapeHtml(s.source)} — ${s.tokenEstimate} tokens${s.estimated ? " (estimated)" : ""}</h3>` +
    (s.note ? `<p class="note">${escapeHtml(s.note)}</p>` : "") +
    (s.sourcePath ? `<button id="openBtn">Open ${escapeHtml(s.sourcePath)}</button>` : "") +
    `<pre>${escapeHtml(s.rawText || "(no captured text)")}</pre>`;
  const btn = document.getElementById("openBtn");
  if (btn) btn.onclick = () => vscodeApi.postMessage({ type: "openFile", path: s.sourcePath });
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
