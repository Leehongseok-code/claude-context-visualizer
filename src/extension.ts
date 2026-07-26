import * as vscode from "vscode";
import { homedir } from "os";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { findSessionsForWorkspace } from "./core/sessionLocator";
import { indexTurns, readTurn, firstPromptPreview, indexByUuid, buildThread } from "./core/transcriptParser";
import { scanBlueprint } from "./core/configScanner";
import { assembleTurn, assembleContext } from "./core/contextAssembler";
import { buildViewModel } from "./core/viewModel";
import { HeuristicTokenEstimator } from "./core/tokenEstimator";
import { TurnIndex, SessionInfo, UuidMeta } from "./core/types";

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
      const uuidCache = new Map<string, Map<string, UuidMeta>>();

      async function getTurns(sessionId: string): Promise<TurnIndex[]> {
        if (turnsCache.has(sessionId)) return turnsCache.get(sessionId)!;
        const s = byId.get(sessionId);
        const turns = s ? await indexTurns(s.filePath) : [];
        turnsCache.set(sessionId, turns);
        return turns;
      }

      async function getUuidMeta(sessionId: string): Promise<Map<string, UuidMeta>> {
        if (uuidCache.has(sessionId)) return uuidCache.get(sessionId)!;
        const s = byId.get(sessionId);
        const meta = s ? await indexByUuid(s.filePath) : new Map<string, UuidMeta>();
        uuidCache.set(sessionId, meta);
        return meta;
      }

      const panel = vscode.window.createWebviewPanel(
        "claudeContext", "Claude Context", vscode.ViewColumn.One, { enableScripts: true }
      );
      panel.webview.html = renderHtml(panel.webview, context);

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === "ready") {
          panel.webview.postMessage({
            type: "sessions",
            sessions: await Promise.all(sessions.map(async s => ({
              id: s.sessionId,
              mtimeMs: s.mtimeMs,
              preview: await firstPromptPreview(s.filePath),
            }))),
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
          const mode: "turn" | "context" = msg.mode === "turn" ? "turn" : "context"; // default: full context
          let segments;
          let prev;
          let groups;
          let usage;
          let totalTurns = 0;
          if (sessionId && byId.has(sessionId)) {
            const s = byId.get(sessionId)!;
            const turns = await getTurns(sessionId);
            totalTurns = turns.length;
            const t = turns[turnIdx];
            if (t && mode === "context" && t.uuid) {
              const meta = await getUuidMeta(sessionId);
              const thread = await buildThread(s.filePath, meta, t.uuid);
              const ctx = assembleContext(thread, blueprint, est);
              segments = ctx.segments; groups = ctx.groups; usage = ctx.usage;
            } else if (t) {
              const cur = await readTurn(s.filePath, t);
              segments = assembleTurn(cur, blueprint, est);
              if (turnIdx > 0) prev = assembleTurn(await readTurn(s.filePath, turns[turnIdx - 1]), blueprint, est);
            }
          }
          if (!segments) segments = assembleTurn([], blueprint, est); // blueprint fallback
          const vm = buildViewModel(segments, prev);
          panel.webview.postMessage({ type: "render", vm, groups, usage, mode, sessionId, turn: turnIdx, totalTurns });
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
