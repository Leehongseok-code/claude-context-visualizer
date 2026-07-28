import * as vscode from "vscode";
import { homedir } from "os";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { findSessionsForWorkspace } from "./core/sessionLocator";
import { indexTurns, readTurn, firstPromptPreview, indexByUuid, buildThread, readAllRecords } from "./core/transcriptParser";
import { scanBlueprint } from "./core/configScanner";
import { findSubagentFiles, indexAgentLaunches, offThreadLaunches, AgentLaunch } from "./core/subagentLocator";
import { assembleTurn, assembleContext, assembleSubagent } from "./core/contextAssembler";
import { buildViewModel } from "./core/viewModel";
import { HeuristicTokenEstimator } from "./core/tokenEstimator";
import { TurnIndex, SessionInfo, UuidMeta, ConfigBlueprint, Segment } from "./core/types";

export function activate(context: vscode.ExtensionContext) {
  const est = new HeuristicTokenEstimator();

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeContext.visualize", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) { vscode.window.showErrorMessage("Open a workspace folder first."); return; }
      const ws = folder.uri.fsPath;
      const projectsDir = join(homedir(), ".claude", "projects");

      // Everything read off disk is cached for the panel's lifetime, so a session Claude
      // Code is still writing to would otherwise stay frozen at whatever it looked like
      // when the panel opened. `rescan()` drops the caches for the refresh button.
      let blueprint: ConfigBlueprint = await scanBlueprint(ws);
      let sessions = await findSessionsForWorkspace(ws, projectsDir);
      let byId = new Map<string, SessionInfo>(sessions.map(s => [s.sessionId, s]));
      const turnsCache = new Map<string, TurnIndex[]>();
      const uuidCache = new Map<string, Map<string, UuidMeta>>();
      const subagentCache = new Map<string, Map<string, string>>();
      const launchCache = new Map<string, AgentLaunch[]>();

      async function rescan(): Promise<void> {
        blueprint = await scanBlueprint(ws);
        sessions = await findSessionsForWorkspace(ws, projectsDir);
        byId = new Map(sessions.map(s => [s.sessionId, s]));
        turnsCache.clear();
        uuidCache.clear();
        subagentCache.clear();
        launchCache.clear();
      }

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

      // tool_use_id -> agentId for the whole session: async agents launched together
      // fan out across branches, so this cannot be read off the assembled thread.
      async function getLaunches(sessionId: string): Promise<AgentLaunch[]> {
        if (launchCache.has(sessionId)) return launchCache.get(sessionId)!;
        const s = byId.get(sessionId);
        const list = s ? await indexAgentLaunches(s.filePath) : [];
        launchCache.set(sessionId, list);
        return list;
      }

      async function getSubagentFiles(sessionId: string): Promise<Map<string, string>> {
        if (subagentCache.has(sessionId)) return subagentCache.get(sessionId)!;
        const s = byId.get(sessionId);
        const files = s ? await findSubagentFiles(s.filePath, sessionId) : new Map<string, string>();
        subagentCache.set(sessionId, files);
        return files;
      }

      const panel = vscode.window.createWebviewPanel(
        "claudeContext", "Claude Context", vscode.ViewColumn.One, { enableScripts: true }
      );
      panel.webview.html = renderHtml(panel.webview, context);

      async function sendSessions(refreshed = false): Promise<void> {
        panel.webview.postMessage({
          type: "sessions",
          refreshed,
          sessions: await Promise.all(sessions.map(async s => ({
            id: s.sessionId,
            mtimeMs: s.mtimeMs,
            preview: await firstPromptPreview(s.filePath),
          }))),
        });
      }

      async function sendTurns(sessionId: string, refreshed = false): Promise<void> {
        const turns = await getTurns(sessionId);
        panel.webview.postMessage({
          type: "turns",
          refreshed,
          sessionId,
          turns: turns.map(t => ({ turn: t.turn, promptPreview: t.promptPreview, timestamp: t.timestamp })),
        });
      }

      async function offThreadAgents(sessionId: string, segments: Segment[]) {
        const inView = new Set(segments.map((s) => s.agentId).filter((x): x is string => !!x));
        const onDisk = new Set((await getSubagentFiles(sessionId)).keys());
        return offThreadLaunches(await getLaunches(sessionId), inView, onDisk)
          .map((l) => ({ agentId: l.agentId, description: l.description, prompt: l.prompt }));
      }

      async function sendTurn(
        sessionId: string | null, turnIdx: number, mode: "turn" | "context", refreshed = false
      ): Promise<void> {
        let segments;
        let prev;
        let groups;
        let usage;
        let model: string | undefined;
        let contextWindow: number | undefined;
        let totalTurns = 0;
        if (sessionId && byId.has(sessionId)) {
          const s = byId.get(sessionId)!;
          const turns = await getTurns(sessionId);
          totalTurns = turns.length;
          const t = turns[turnIdx];
          const launches = await getLaunches(sessionId);
          if (t && mode === "context" && t.uuid) {
            const meta = await getUuidMeta(sessionId);
            const thread = await buildThread(s.filePath, meta, t.uuid);
            // prompt uuid -> the turn number the sidebar shows, so the group labels and
            // the breadcrumb agree even when a prompt never reached this context
            const turnNumbers = new Map<string, number>();
            for (const x of turns) if (x.startUuid) turnNumbers.set(x.startUuid, x.turn + 1);
            const ctx = assembleContext(thread, blueprint, est, undefined, launches, turnNumbers);
            segments = ctx.segments; groups = ctx.groups; usage = ctx.usage;
            model = ctx.model; contextWindow = ctx.contextWindow;
          } else if (t) {
            const cur = await readTurn(s.filePath, t);
            segments = assembleTurn(cur, blueprint, est, undefined, launches);
            if (turnIdx > 0) prev = assembleTurn(await readTurn(s.filePath, turns[turnIdx - 1]), blueprint, est, undefined, launches);
          }
        }
        if (!segments) segments = assembleTurn([], blueprint, est); // blueprint fallback
        const vm = buildViewModel(segments, prev, usage?.realContextTokens);
        panel.webview.postMessage({
          type: "render", vm, groups, usage, model, contextWindow, mode, sessionId, turn: turnIdx, totalTurns, refreshed,
          offThreadAgents: sessionId ? await offThreadAgents(sessionId, segments) : [],
        });
      }

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === "ready") {
          await sendSessions();
        } else if (msg?.type === "listTurns") {
          await sendTurns(String(msg.sessionId));
        } else if (msg?.type === "loadTurn") {
          const mode: "turn" | "context" = msg.mode === "turn" ? "turn" : "context"; // default: full context
          await sendTurn(msg.sessionId ?? null, Number(msg.turn), mode);
        } else if (msg?.type === "loadSubagent") {
          // Lazy: a subagent transcript runs to a few hundred KB, so it is only read
          // when someone actually expands that Agent call.
          const sid = String(msg.sessionId ?? "");
          const agentId = String(msg.agentId ?? "");
          const depth = Math.max(1, Number(msg.depth) || 1);
          const path = (await getSubagentFiles(sid)).get(agentId);
          let segments: Segment[] = [];
          if (path) segments = assembleSubagent(await readAllRecords(path), est, agentId, depth);
          panel.webview.postMessage({ type: "subagent", agentId, depth, segments, missing: !path });
        } else if (msg?.type === "refresh") {
          await rescan();
          const sid: string | null = msg.sessionId ?? null;
          const known = sid !== null && byId.has(sid);
          const viewMode: "turn" | "context" = msg.mode === "turn" ? "turn" : "context";
          if (msg.view === "context" && !known && sessions.length === 0) {
            await sendTurn(null, -1, viewMode, true); // still no session: blueprint only
          } else if (!known) {
            await sendSessions(true); // session vanished (or none was picked yet)
          } else if (msg.view === "turns") {
            await sendTurns(sid!, true);
          } else if (msg.view === "context") {
            const turns = await getTurns(sid!);
            let idx = Number(msg.turn);
            if (!Number.isFinite(idx)) idx = 0;
            // The point of the button is watching a live session, so someone parked on the
            // newest turn stays pinned to the newest turn as the transcript grows.
            if (msg.atTail || idx >= turns.length) idx = turns.length - 1;
            if (idx < 0) idx = 0;
            await sendTurn(sid!, idx, viewMode, true);
          } else {
            await sendSessions(true);
          }
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
