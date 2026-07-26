import * as vscode from "vscode";
import { homedir } from "os";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { findSessionsForWorkspace } from "./core/sessionLocator";
import { indexTurns, readTurn } from "./core/transcriptParser";
import { scanBlueprint } from "./core/configScanner";
import { assembleTurn } from "./core/contextAssembler";
import { buildViewModel } from "./core/viewModel";
import { HeuristicTokenEstimator } from "./core/tokenEstimator";
import { TurnIndex } from "./core/types";

export function activate(context: vscode.ExtensionContext) {
  const est = new HeuristicTokenEstimator();

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeContext.visualize", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) { vscode.window.showErrorMessage("Open a workspace folder first."); return; }
      const ws = folder.uri.fsPath;
      const blueprint = await scanBlueprint(ws);

      const sessions = await findSessionsForWorkspace(ws, join(homedir(), ".claude", "projects"));

      // Session-only pick; turns are chosen inside the webview.
      let sessionFile: string | null = null;
      let sessionId: string | null = null;
      let turns: TurnIndex[] = [];

      if (sessions.length) {
        const pick = await vscode.window.showQuickPick(
          sessions.map(s => ({ label: s.sessionId, description: new Date(s.mtimeMs).toLocaleString(), s })),
          { placeHolder: "Select a Claude Code session" }
        );
        if (!pick) return; // cancelled
        sessionFile = pick.s.filePath;
        sessionId = pick.s.sessionId;
        turns = await indexTurns(sessionFile);
      }

      const panel = vscode.window.createWebviewPanel(
        "claudeContext", "Claude Context", vscode.ViewColumn.One, { enableScripts: true }
      );
      panel.webview.html = renderHtml(panel.webview, context);

      async function sendRender(turnIdx: number) {
        let segments;
        let prev;
        if (sessionFile && turns[turnIdx]) {
          const cur = await readTurn(sessionFile, turns[turnIdx]);
          segments = assembleTurn(cur, blueprint, est);
          if (turnIdx > 0) {
            const p = await readTurn(sessionFile, turns[turnIdx - 1]);
            prev = assembleTurn(p, blueprint, est);
          }
        } else {
          segments = assembleTurn([], blueprint, est);
        }
        const vm = buildViewModel(segments, prev);
        panel.webview.postMessage({ type: "render", vm, turn: turnIdx, totalTurns: turns.length });
      }

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === "ready") {
          panel.webview.postMessage({
            type: "init",
            sessionId,
            turns: turns.map(t => ({ turn: t.turn, promptPreview: t.promptPreview, timestamp: t.timestamp })),
          });
          // default: newest turn, or blueprint-only mode
          await sendRender(turns.length ? turns.length - 1 : -1);
        } else if (msg?.type === "selectTurn") {
          const idx = Number(msg.turn);
          if (Number.isInteger(idx)) await sendRender(idx);
        } else if (msg?.type === "openFile" && msg.path) {
          if (!existsSync(msg.path) || !statSync(msg.path).isFile()) {
            vscode.window.showWarningMessage("Cannot open: " + msg.path);
            return;
          }
          vscode.window.showTextDocument(vscode.Uri.file(msg.path));
        }
      });
    })
  );
}

function renderHtml(webview: vscode.Webview, ctx: vscode.ExtensionContext): string {
  const script = webview.asWebviewUri(vscode.Uri.file(join(ctx.extensionPath, "dist", "webview.js")));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body>
<div id="app">
  <div id="turnbar" class="turnbar"></div>
  <header id="summary"></header>
  <div id="bar" class="bar"></div>
  <div class="panes">
    <div id="stack" class="list"></div>
    <div id="detail" class="detail"></div>
  </div>
</div>
<script src="${script}"></script></body></html>`;
}

export function deactivate() {}
