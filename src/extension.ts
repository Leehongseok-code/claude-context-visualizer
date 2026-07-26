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
          if (!existsSync(msg.path) || !statSync(msg.path).isFile()) {
            vscode.window.showWarningMessage("Cannot open: " + msg.path);
            return;
          }
          vscode.window.showTextDocument(vscode.Uri.file(msg.path));
        } else if (msg?.type === "ready") {
          panel.webview.postMessage({ type: "render", vm });
        }
      });
    })
  );
}

function renderHtml(webview: vscode.Webview, ctx: vscode.ExtensionContext): string {
  const script = webview.asWebviewUri(vscode.Uri.file(join(ctx.extensionPath, "dist", "webview.js")));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body><div id="summary"></div><div id="stack"></div><div id="drilldown"></div>
<script src="${script}"></script></body></html>`;
}

export function deactivate() {}
