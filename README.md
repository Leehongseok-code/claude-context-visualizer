# Claude Context Visualizer

Visualize how Claude Code assembles its per-turn LLM context from CLAUDE.md,
skills, hooks, memory, MCP instructions, tool results, and history — with local
token estimates for debugging and optimization.

## Use
1. Install the `.vsix` (`code --install-extension claude-context-visualizer-0.1.0.vsix`).
2. Open any project folder that you have used with Claude Code.
3. Command Palette → **Claude Context: Visualize** → pick a session → pick a turn.

Sessions are matched to the open workspace by the `cwd` recorded in each
transcript, so one install works in every project. Base system prompt and tool
schemas are shown as hatched **estimated** blocks (not captured in transcripts).

## Develop
- `npm i` · `npm run build` · `npm test`
- F5 (Run Extension) for the Extension Development Host.
- `npm run package` to produce the `.vsix`.
