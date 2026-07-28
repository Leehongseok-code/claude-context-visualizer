// Webview stylesheet, bundled as a string so the packaged .vsix needs no src/ file at runtime.
export const STYLES = `
:root {
  --border: var(--vscode-panel-border, rgba(128,128,128,0.35));
  --muted: var(--vscode-descriptionForeground, #999);
  --card: var(--vscode-editorWidget-background, rgba(128,128,128,0.08));
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
}
#app { padding: 14px 16px; }

/* turn bar */
.turnbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tb-btn {
  cursor: pointer; border: 1px solid var(--border); border-radius: 5px; padding: 3px 9px;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
  color: var(--vscode-button-secondaryForeground, inherit);
}
.tb-btn:disabled { opacity: .4; cursor: default; }
.tb-sel {
  flex: 1; min-width: 180px; max-width: 640px; padding: 4px 8px; border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
}
.tb-count { color: var(--muted); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tb-note { color: var(--muted); font-style: italic; }

/* breadcrumbs */
.crumbs { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; font-size: 13px; }
.crumb { cursor: pointer; color: var(--vscode-textLink-foreground, #3794ff); }
.crumb.active { color: var(--vscode-editor-foreground); cursor: default; font-weight: 600; }
.crumb:not(.active):hover { text-decoration: underline; }
.sep { color: var(--muted); }
.crumbs .upd { margin-left: auto; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.crumbs .tb-btn.refresh { margin-left: 4px; font-size: 12px; }
.crumbs .tb-btn.refresh:not(:disabled):hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.28)); }

/* pick lists (session / turn) */
.picklist { display: flex; flex-direction: column; gap: 4px; }
.pl-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.pl-title .muted, .muted { color: var(--muted); font-weight: 400; }
.pl-row {
  display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 6px;
  cursor: pointer; background: var(--card); border: 1px solid transparent;
}
.pl-row:hover { border-color: var(--vscode-focusBorder, #007acc); background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12)); }
.pl-idx { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 34px; }
.pl-main { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-sub { color: var(--muted); font-size: 11px; white-space: nowrap; }
.pl-arrow { color: var(--muted); }
.pl-row-2 { align-items: center; }
.pl-col { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.pl-col .pl-main { font-weight: 600; }
.pl-col .pl-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* turn stepper (context view) */
.stepper { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }

/* rendered markdown */
.d-md {
  max-height: 60vh; overflow: auto; padding: 12px 14px; border-radius: 6px;
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
  border: 1px solid var(--border); line-height: 1.55;
}
.d-md h1, .d-md h2, .d-md h3 { margin: 0.6em 0 0.35em; line-height: 1.25; }
.d-md h1 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
.d-md h2 { font-size: 1.25em; border-bottom: 1px solid var(--border); padding-bottom: 0.15em; }
.d-md h3 { font-size: 1.1em; }
.d-md p { margin: 0.5em 0; }
.d-md ul, .d-md ol { padding-left: 1.4em; margin: 0.4em 0; }
.d-md li { margin: 0.15em 0; }
.d-md code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em; background: rgba(128,128,128,0.18); padding: 1px 5px; border-radius: 4px; }
.d-md pre { background: var(--vscode-editor-background); border: 1px solid var(--border); padding: 10px; border-radius: 6px; overflow: auto; }
.d-md pre code { background: none; padding: 0; }
.d-md blockquote { margin: 0.5em 0; padding-left: 12px; border-left: 3px solid var(--border); color: var(--muted); }
.d-md table { border-collapse: collapse; margin: 0.5em 0; }
.d-md th, .d-md td { border: 1px solid var(--border); padding: 4px 8px; }
.d-md a { color: var(--vscode-textLink-foreground, #3794ff); }
.d-md hr { border: none; border-top: 1px solid var(--border); margin: 0.8em 0; }

/* header */
.hrow { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.total { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
.total-label { color: var(--muted); }
.waste-badge {
  margin-left: auto; padding: 2px 9px; border-radius: 999px;
  background: var(--vscode-inputValidation-warningBackground, #6b4d00);
  color: var(--vscode-inputValidation-warningForeground, #fff);
  font-weight: 600; font-size: 12px;
}

/* proportional composition bar */
.bar { display: flex; width: 100%; height: 14px; border-radius: 7px; overflow: hidden; border: 1px solid var(--border); }
.bar-seg { height: 100%; transition: filter .15s, opacity .15s; }
.bar-seg:hover { filter: brightness(1.2); }
.bar-seg.dim { opacity: 0.18; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 10px 0 4px; }
.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); }
.chip i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.chip.filter { cursor: pointer; user-select: none; padding: 2px 7px; border-radius: 999px; border: 1px solid transparent; }
.chip.filter:hover { border-color: var(--border); }
.chip.filter.off { opacity: 0.45; text-decoration: line-through; }
.chip.filter.off i { filter: grayscale(1); }
.chip.reset { cursor: pointer; user-select: none; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--vscode-textLink-foreground, #3794ff); }

/* two panes — responsive to the webview/panel width */
.panes { display: grid; grid-template-columns: minmax(0, 38%) minmax(0, 1fr); gap: 14px; margin-top: 12px; align-items: start; }
.panes > .list, .panes > .detail { min-width: 0; } /* let columns shrink instead of overflowing */
/* narrow (side-docked) panel: stack the panes, detail no longer sticky */
@media (max-width: 680px) {
  #app { padding: 10px 12px; }
  .panes { grid-template-columns: 1fr; }
  .detail { position: static; }
  .d-raw, .hl, .d-md { max-height: 45vh; }
}

/* left list */
.list { display: flex; flex-direction: column; gap: 4px; }
/* group headers (full-context view) */
.grp-head {
  display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
  padding: 6px 8px; margin-top: 6px; border-radius: 5px; font-size: 12px; font-weight: 600;
  background: var(--vscode-editorWidget-background, rgba(128,128,128,0.1));
  border: 1px solid var(--border);
}
.grp-head:hover { border-color: var(--vscode-focusBorder, #007acc); }
.grp-head.hist { opacity: 0.8; font-weight: 500; }
.grp-head.compact { border-color: #e11d48; background: rgba(225,29,72,0.12); }
.grp-caret { color: var(--muted); width: 10px; }
.grp-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp-tok { color: var(--muted); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.row {
  padding: 7px 9px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; border-left: 3px solid var(--cat);
  background: var(--card);
}
.row:hover { border-color: var(--border); }
.row.selected { border-color: var(--vscode-focusBorder, #007acc); background: var(--vscode-list-activeSelectionBackground, rgba(0,122,204,0.2)); }
.row.estimated { background-image: repeating-linear-gradient(45deg, transparent 0 7px, rgba(128,128,128,0.14) 7px 14px); }
.row-head { display: flex; align-items: center; gap: 6px; }
.row-source { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.row-tok { margin-left: auto; color: var(--muted); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.row-bar { height: 4px; margin-top: 6px; border-radius: 2px; background: var(--border); overflow: hidden; }
.row-fill { height: 100%; background: var(--cat); }
.flag { font-size: 11px; opacity: .85; }

/* subagent rows: indented under the Agent call, dimmed because they belong to a
   separate context window rather than this turn's */
.row-caret { color: var(--muted); width: 10px; flex: none; cursor: pointer; }
.row-caret:hover { color: var(--vscode-editor-foreground); }
.row.sub { opacity: 0.92; background: rgba(124,58,237,0.06); }
.row.sub .row-source { font-weight: 500; }
.sub-head {
  margin: 6px 0 2px; padding: 4px 8px; border-radius: 4px;
  border-left: 2px dashed #7c3aed; background: rgba(124,58,237,0.1);
  color: var(--muted); font-size: 11px;
}
.sub-note { margin: 4px 0; padding: 4px 8px; color: var(--muted); font-size: 11px; font-style: italic; }
.sub-note.miss { color: var(--vscode-inputValidation-warningForeground, #d7a000); }
.tag-sub { color: #a855f7; font-weight: 600; }

/* right detail */
.detail { position: sticky; top: 12px; border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--card); min-height: 200px; }
.d-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.d-badge { color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.d-title { font-size: 15px; font-weight: 700; word-break: break-all; }
.d-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: 12px; margin-bottom: 10px; }
.d-meta b { color: var(--vscode-editor-foreground); font-size: 14px; }
.tag-est { color: var(--vscode-inputValidation-warningForeground, #d7a000); }
.d-flag { color: var(--vscode-inputValidation-warningForeground, #d7a000); }
.d-note { padding: 8px 10px; border-left: 3px solid var(--vscode-textLink-foreground, #3794ff); background: rgba(128,128,128,0.1); border-radius: 4px; font-style: italic; margin-bottom: 10px; }
.d-actions { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.d-actions button {
  cursor: pointer; border: 1px solid var(--border); border-radius: 5px; padding: 5px 11px;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
  color: var(--vscode-button-secondaryForeground, inherit); font-size: 12px;
}
.d-actions button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.28)); }
.d-raw, .hl {
  margin: 0; padding: 12px; border-radius: 6px; max-height: 60vh; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px; line-height: 1.5;
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
  border: 1px solid var(--border);
}
.hl code.hljs { background: none; padding: 0; font: inherit; }
.fmt-label {
  font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px;
  border: 1px solid var(--border); border-radius: 4px; padding: 1px 7px; align-self: center;
}

/* highlight.js theme — token colors for light/dark (vscode-* body class) */
.hljs-comment, .hljs-quote { color: #6a9955; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-doctag { color: #569cd6; }
.hljs-string, .hljs-attr, .hljs-meta-string { color: #ce9178; }
.hljs-number, .hljs-symbol, .hljs-bullet { color: #b5cea8; }
.hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #dcdcaa; }
.hljs-type, .hljs-class .hljs-title, .hljs-built_in, .hljs-builtin-name { color: #4ec9b0; }
.hljs-attribute, .hljs-variable, .hljs-template-variable { color: #9cdcfe; }
.hljs-meta { color: #c586c0; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
body.vscode-light .hljs-comment, body.vscode-light .hljs-quote { color: #008000; }
body.vscode-light .hljs-keyword, body.vscode-light .hljs-selector-tag, body.vscode-light .hljs-literal { color: #0000ff; }
body.vscode-light .hljs-string, body.vscode-light .hljs-attr { color: #a31515; }
body.vscode-light .hljs-number { color: #098658; }
body.vscode-light .hljs-title, body.vscode-light .hljs-name { color: #795e26; }
body.vscode-light .hljs-type, body.vscode-light .hljs-built_in { color: #267f99; }
body.vscode-light .hljs-attribute, body.vscode-light .hljs-variable { color: #001080; }
body.vscode-light .hljs-meta { color: #af00db; }
`;
