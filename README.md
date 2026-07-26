# Claude Context Visualizer

A VS Code extension that visualizes **how Claude Code assembles its per-turn LLM
context** — CLAUDE.md, skills, hooks, memory, MCP instructions, tool calls/results,
and history — with local token estimates, so you can debug and optimize what
actually goes into the model.

- **Session → Turn → Context** drill-down, entirely in a panel
- Token-weighted segment list + composition bar; click a segment to see its **raw data**
- **Auto-formatted raw view**: JSON pretty-printed & highlighted, code syntax-highlighted, Markdown rendered
- First-class **tool_use / tool_result / skill** segments (see exactly what tools and skills pulled in)
- Click-to-toggle **type filters**; optimization **waste flags** (repeated / large / estimated)
- Portable: matches sessions to the open workspace by the `cwd` recorded in each transcript — one install works in every project

Nothing leaves your machine: it reads local Claude Code transcripts
(`~/.claude/projects/…`) and your workspace config. No network, no API key.

## Screenshots

Every turn broken into token-weighted segments — click one to see the exact raw
data it contributed. Tool results are auto-formatted (here, pretty-printed JSON):

![Context view — a tool result auto-formatted as pretty JSON](docs/images/context-json.png)

CLAUDE.md, skill bodies, and hook injections render as Markdown; toggle to raw anytime:

![Context view — CLAUDE.md rendered as Markdown](docs/images/context-markdown.png)

Pick a session by its first prompt, then drill into a turn:

![Session picker showing each session's first prompt](docs/images/sessions.png)

> Screenshots use synthetic sample data.

## Install

> After installing, run **Developer: Reload Window**, open any project you've used
> with Claude Code, then Command Palette → **Claude Context: Visualize**.

### Option A — download the `.vsix` from Releases (recommended)

1. Open the [**Releases**](https://github.com/Leehongseok-code/claude-context-visualizer/releases) page and download the latest `claude-context-visualizer-*.vsix`.
2. Install it, either:
   - **CLI:** `code --install-extension claude-context-visualizer-*.vsix`
   - **UI:** Extensions panel → `⋯` menu → **Install from VSIX…**

### Option B — one line (needs the [GitHub CLI](https://cli.github.com))

```bash
gh release download -R Leehongseok-code/claude-context-visualizer --pattern '*.vsix' --clobber \
  && code --install-extension claude-context-visualizer-*.vsix
```

### Option C — build from source

```bash
git clone https://github.com/Leehongseok-code/claude-context-visualizer
cd claude-context-visualizer
npm install && npm run build && npm run package
code --install-extension claude-context-visualizer-*.vsix
```

> No `code` command? In VS Code run Command Palette → **Shell Command: Install 'code' command in PATH**, or just use the UI install (Option A, second bullet).

## Develop

- `npm install` · `npm run build` · `npm test` · `npm run typecheck`
- Press **F5** for the Extension Development Host.
- `npm run package` produces the `.vsix`.

## Releasing

Pushing a `v*` tag builds, tests, packages, and attaches the `.vsix` to a GitHub
Release automatically (see `.github/workflows/release.yml`):

```bash
# bump "version" in package.json, then:
git tag v0.1.1 && git push origin v0.1.1
```

## License

MIT — see [LICENSE](LICENSE).
