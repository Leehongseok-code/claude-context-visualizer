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
import { TurnIndex, SessionInfo } from "./core/types";

export function activate(context: vscode.ExtensionContext) {
  const est = new HeuristicTokenEstimator();

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeContext.visualize", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) { vscode.window.showErrorMessage("Open a workspace folder first."); return; }
      const ws = folder.uri.fsPath;
      const blueprint = await scanBlueprint(ws);
      const sessions = await findSessionsForWorkspace(ws, join(homedir(), ".claude", "projects"));
      const byId = new Map<string, SessionInfo>(sessions.map(s => [s.sessionId, s]));
      const turnsCache = new Map<string, TurnIndex[]>();

      async function getTurns(sessionId: string): Promise<TurnIndex[]> {
        if (turnsCache.has(sessionId)) return turnsCache.get(sessionId)!;
        const s = byId.get(sessionId);
        const turns = s ? await indexTurns(s.filePath) : [];
        turnsCache.set(sessionId, turns);
        return turns;
      }

      const panel = vscode.window.createWebviewPanel(
        "claudeContext", "Claude Context", vscode.ViewColumn.One, { enableScripts: true }
      );
      panel.webview.html = renderHtml(panel.webview, context);

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === "ready") {
          panel.webview.postMessage({
            type: "sessions",
            sessions: sessions.map(s => ({ id: s.sessionId, mtimeMs: s.mtimeMs })),
          });
        } else if (msg?.type === "listTurns") {
          const turns = await getTurns(String(msg.sessionId));
          panel.webview.postMessage({
            type: "turns",
            sessionId: msg.sessionId,
            turns: turns.map(t => ({ turn: t.turn, promptPreview: t.promptPreview, timestamp: t.timestamp })),
          });
        } else if (msg?.type === "loadTurn") {
          const sessionId: string | null = msg.sessionId ?? null;
          const turnIdx = Number(msg.turn);
          let segments;
          let prev;
          let totalTurns = 0;
          if (sessionId && byId.has(sessionId)) {
            const s = byId.get(sessionId)!;
            const turns = await getTurns(sessionId);
            totalTurns = turns.length;
            if (turns[turnIdx]) {
              const cur = await readTurn(s.filePath, turns[turnIdx]);
              segments = assembleTurn(cur, blueprint, est);
              if (turnIdx > 0) {
                const p = await readTurn(s.filePath, turns[turnIdx - 1]);
                prev = assembleTurn(p, blueprint, est);
              }
            }
          }
          if (!segments) segments = assembleTurn([], blueprint, est); // blueprint fallback
          const vm = buildViewModel(segments, prev);
          panel.webview.postMessage({ type: "render", vm, sessionId, turn: turnIdx, totalTurns });
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
  <nav id="crumbs" class="crumbs"></nav>
  <div id="view"></div>
</div>
<script src="${script}"></script></body></html>`;
}

export function deactivate() {}
