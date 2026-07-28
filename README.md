# Claude Context Visualizer

**English** | [한국어](#한국어)

A VS Code extension that visualizes **how Claude Code assembles its per-turn LLM
context** — CLAUDE.md, skills, hooks, memory, MCP instructions, tool calls/results,
and history — with local token estimates, so you can debug and optimize what
actually goes into the model.

- **Session → Turn → Context** drill-down, entirely in a panel
- Token-weighted segment list + composition bar; click a segment to see its **raw data**
- **Auto-formatted raw view**: JSON pretty-printed & highlighted, code syntax-highlighted, Markdown rendered
- First-class **tool_use / tool_result / skill** segments (see exactly what tools and skills pulled in)
- **Subagent drill-down**: expand an `Agent` call to read that agent's own transcript, kept out of this turn's totals because it ran in its own context window
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

---

# 한국어

[English](#claude-context-visualizer) | **한국어**

**Claude Code가 매 턴 LLM 컨텍스트를 어떻게 조립하는지** 눈으로 확인하는 VS Code
확장입니다. CLAUDE.md, 스킬, 훅, 메모리, MCP 지시문, 도구 호출/결과, 대화 히스토리를
토큰 추정치와 함께 분해해서 보여주므로, **실제로 모델에 무엇이 들어가는지** 디버깅하고
최적화할 수 있습니다.

- **세션 → 턴 → 컨텍스트** 드릴다운을 패널 하나에서
- 토큰 비중 순 세그먼트 목록 + 구성 막대. 세그먼트를 클릭하면 **원본 데이터**를 그대로 확인
- **원본 자동 포매팅**: JSON은 정렬·하이라이트, 코드는 문법 강조, 마크다운은 렌더링
- **tool_use / tool_result / 스킬**을 1급 세그먼트로 취급 — 어떤 도구와 스킬이 무엇을 끌어왔는지 정확히 표시
- **서브에이전트 드릴다운**: `Agent` 호출을 펼치면 그 에이전트의 트랜스크립트를 그대로 열람. 별도 컨텍스트 윈도우에서 실행됐으므로 현재 턴의 토큰 합계에는 포함되지 않습니다
- 클릭 토글 **타입 필터**와 최적화용 **낭비 플래그**(중복 / 과대 / 추정치)
- 프로젝트 이식성: 각 트랜스크립트에 기록된 `cwd`로 열려 있는 워크스페이스와 세션을 매칭하므로, 한 번 설치하면 모든 프로젝트에서 동작합니다

**아무것도 외부로 나가지 않습니다.** 로컬 Claude Code 트랜스크립트(`~/.claude/projects/…`)와
워크스페이스 설정만 읽습니다. 네트워크 통신도, API 키도 필요 없습니다.

## 스크린샷

턴 전체가 토큰 비중별 세그먼트로 쪼개집니다. 하나를 클릭하면 그 세그먼트가 기여한 원본
데이터를 볼 수 있고, 도구 결과는 자동 포매팅됩니다(아래는 JSON 정렬 예시):

![컨텍스트 화면 — 도구 결과가 정렬된 JSON으로 표시](docs/images/context-json.png)

CLAUDE.md, 스킬 본문, 훅 주입 내용은 마크다운으로 렌더링되며 언제든 원본 보기로 전환할 수 있습니다:

![컨텍스트 화면 — CLAUDE.md가 마크다운으로 렌더링](docs/images/context-markdown.png)

첫 프롬프트를 보고 세션을 고른 뒤, 원하는 턴으로 들어갑니다:

![각 세션의 첫 프롬프트를 보여주는 세션 선택 화면](docs/images/sessions.png)

> 스크린샷은 예시용 합성 데이터입니다.

## 설치

> 설치 후 **Developer: Reload Window**를 실행하고, Claude Code로 작업한 적 있는 프로젝트를
> 연 다음 명령 팔레트에서 **Claude Context: Visualize**를 실행하세요.

### 방법 A — Releases에서 `.vsix` 내려받기 (권장)

1. [**Releases**](https://github.com/Leehongseok-code/claude-context-visualizer/releases) 페이지에서 최신 `claude-context-visualizer-*.vsix`를 받습니다.
2. 둘 중 편한 방식으로 설치합니다:
   - **CLI:** `code --install-extension claude-context-visualizer-*.vsix`
   - **UI:** 확장 패널 → `⋯` 메뉴 → **Install from VSIX…**

### 방법 B — 한 줄로 ([GitHub CLI](https://cli.github.com) 필요)

```bash
gh release download -R Leehongseok-code/claude-context-visualizer --pattern '*.vsix' --clobber \
  && code --install-extension claude-context-visualizer-*.vsix
```

### 방법 C — 소스에서 직접 빌드

```bash
git clone https://github.com/Leehongseok-code/claude-context-visualizer
cd claude-context-visualizer
npm install && npm run build && npm run package
code --install-extension claude-context-visualizer-*.vsix
```

> `code` 명령이 없나요? VS Code에서 명령 팔레트 → **Shell Command: Install 'code' command in PATH**를 실행하거나, 그냥 UI로 설치하세요(방법 A의 두 번째 항목).

## 개발

- `npm install` · `npm run build` · `npm test` · `npm run typecheck`
- **F5**를 누르면 Extension Development Host가 뜹니다.
- `npm run package`로 `.vsix`를 만듭니다.

## 릴리스

`v*` 태그를 푸시하면 빌드·테스트·패키징 후 `.vsix`가 GitHub Release에 자동으로
첨부됩니다(`.github/workflows/release.yml` 참고):

```bash
# package.json의 "version"을 올린 뒤:
git tag v0.1.1 && git push origin v0.1.1
```

## 라이선스

MIT — [LICENSE](LICENSE) 참고.
