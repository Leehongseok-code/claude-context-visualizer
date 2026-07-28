# Claude Context Visualizer

**English** | [한국어](#한국어)

A VS Code extension that shows **what Claude Code actually sent to the model on each
turn** — your CLAUDE.md, skills, hooks, memory, MCP instructions, tool calls and their
output, and the conversation so far — broken down by size, so you can see where the
tokens went.

- **Session → turn → breakdown**, all in one panel
- Every piece sized and ranked; click one to read the exact text it contributed
- Text is formatted by what it is: JSON pretty-printed, code highlighted, Markdown rendered
- **Open an `Agent` call** to read that subagent's own conversation
- Click a category to hide it; flags for repeated, oversized, and estimated pieces
- Works in any project — sessions are matched to the folder you have open

Nothing leaves your machine. It reads the log files Claude Code already writes to
`~/.claude/projects/` plus your project config. No network, no API key.

## Screenshots

A turn broken into pieces, largest first. Click one to read what it contributed —
tool output is formatted automatically:

![A tool result shown as pretty-printed JSON](docs/images/context-json.png)

CLAUDE.md, skill bodies, and hook text render as Markdown; switch to raw any time:

![CLAUDE.md rendered as Markdown](docs/images/context-markdown.png)

Pick a session by its first message, then open a turn:

![The session list, each row showing its first message](docs/images/sessions.png)

> Screenshots use made-up sample data.

## What each category means

Every piece of the context gets one label. Click a label to hide that category.

**Things a person or the model wrote**

| Label | What it is |
| --- | --- |
| `user` | Text a human typed. Only that — see the note below. |
| `assistant` | Claude's replies. |
| `thinking` | Claude's reasoning. Shown at 0 tokens: the API drops it from the next request, so carrying it costs nothing. |

**Things tools did**

| Label | What it is |
| --- | --- |
| `toolUse` | A tool call and the arguments it was given. |
| `toolResult` | What the tool sent back. Usually the biggest category by far. |

**Things your setup added**

| Label | What it is |
| --- | --- |
| `claudeMd` | Your CLAUDE.md. |
| `memory` | Memory files. |
| `hook` | Text a hook injected. |
| `skill` | A skill's full body, loaded when Claude used it. Often very large. |
| `mcpInstructions` | Instructions that came from an MCP server. |
| `systemReminder` | The `<system-reminder>` blocks Claude Code adds. |
| `auto-inserted` | Everything else Claude Code writes into the user's turn — slash commands and their output, task notifications. Nobody typed these. |

**Bookkeeping**

| Label | What it is |
| --- | --- |
| `compactionSummary` | The summary written in place of older messages when the conversation was compacted. |
| `not-in-transcript` | The base system prompt and the tool definitions. Sent on every request, saved to the log on none of them. |
| `estimate gap` | The rows above are bigger than the sizes shown. This is the difference. |

### Two labels that are easy to misread

**`user` really means "a person typed this."** Claude Code also writes skill bodies,
slash commands, task notifications, and reminders into the user's turn. Those get
sorted out by what they actually are, and anything left that the log marks as
not-a-real-message becomes `auto-inserted`. Before this was fixed, 97% of the tokens
labelled `user` had never been typed by anyone.

**`estimate gap` is not missing content.** The panel guesses each piece's size from
its text, and that guess runs low. Every response records how many tokens the model
really received, so the panel compares the two across the session and splits the
difference in half:

- `not-in-transcript` — the part that is there no matter how long the conversation
  gets. That is the system prompt and the tool definitions, which the log genuinely
  never holds.
- `estimate gap` — the part that grows with the conversation. That content *is* in
  the log; only the size estimate fell short.

The split only appears when the comparison is consistent enough to trust (at least
5 turns, and a tight fit). Otherwise the two stay merged into one row, because
dividing them would be guesswork. On one session the gap was 69% of the combined
figure — big enough that reading the whole thing as "content the log never had"
would be wrong about most of it.

This also explains something that looks like a bug after `/compact`: the
`not-in-transcript` share jumps. Compacting shortens the conversation but does
nothing to the system prompt or the tool definitions. The top of the fraction stays
put while the bottom collapses, so the percentage rises.

## Install

> After installing, run **Developer: Reload Window**, open a project you've used with
> Claude Code, then Command Palette → **Claude Context: Visualize**.

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

> No `code` command? In VS Code run Command Palette → **Shell Command: Install 'code' command in PATH**, or use the UI install above.

## Develop

- `npm install` · `npm run build` · `npm test` · `npm run typecheck`
- Press **F5** for the Extension Development Host.
- `npm run package` produces the `.vsix`.

## Releasing

Pushing a `v*` tag builds, tests, packages, and attaches the `.vsix` to a GitHub
Release (see `.github/workflows/release.yml`):

```bash
# bump "version" in package.json, then:
git tag v0.1.1 && git push origin v0.1.1
```

## License

MIT — see [LICENSE](LICENSE).

---

# 한국어

[English](#claude-context-visualizer) | **한국어**

Claude Code가 매 턴 모델한테 실제로 뭘 보냈는지 보여주는 VS Code 확장입니다.
CLAUDE.md, 스킬, 훅, 메모리, MCP 지시문, 도구 호출과 결과, 지금까지의 대화를
크기별로 쪼개서 토큰이 어디로 갔는지 볼 수 있습니다.

- 세션 → 턴 → 내역을 패널 하나에서
- 조각마다 크기를 재서 큰 순으로 정렬. 클릭하면 그 조각이 넣은 내용이 그대로 나옵니다
- 내용은 종류에 맞게 보여줍니다. JSON은 줄맞춤, 코드는 색칠, 마크다운은 렌더링
- `Agent` 호출을 펼치면 그 서브에이전트가 나눈 대화까지 볼 수 있습니다
- 카테고리를 눌러서 숨기기, 중복되거나 지나치게 큰 조각에 경고 표시
- 어느 프로젝트에서든 씁니다. 열어둔 폴더에 맞는 세션을 알아서 찾습니다

밖으로 나가는 건 없습니다. Claude Code가 `~/.claude/projects/`에 남기는 기록 파일과
프로젝트 설정만 읽습니다. 네트워크도 API 키도 안 씁니다.

## 화면 예시

한 턴을 조각내서 큰 순서로 보여줍니다. 하나를 클릭하면 그 조각의 내용이 나오고,
도구 결과는 알아서 정리됩니다:

![도구 결과가 줄맞춤된 JSON으로 표시](docs/images/context-json.png)

CLAUDE.md, 스킬 본문, 훅이 넣은 내용은 마크다운으로 보여주고, 언제든 원본으로 바꿀 수 있습니다:

![CLAUDE.md가 마크다운으로 렌더링](docs/images/context-markdown.png)

첫 메시지를 보고 세션을 고른 다음, 원하는 턴을 엽니다:

![각 세션의 첫 메시지가 보이는 세션 목록](docs/images/sessions.png)

> 화면 예시는 샘플 데이터입니다.

## 각 카테고리가 뜻하는 것

컨텍스트의 모든 조각에 라벨이 하나씩 붙습니다. 라벨을 클릭하면 그 카테고리가 숨겨집니다.

**사람이나 모델이 쓴 것**

| 라벨 | 뜻 |
| --- | --- |
| `user` | 사람이 직접 친 것. 아래 설명 참고 |
| `assistant` | Claude의 답변 |
| `thinking` | Claude가 생각한 내용. 0토큰으로 잡힙니다. 다음 요청 때 API가 빼기 때문에 남아 있어도 비용은 안 듭니다 |

**도구가 한 일**

| 라벨 | 뜻 |
| --- | --- |
| `toolUse` | 도구 호출과 넘긴 인자 |
| `toolResult` | 도구가 돌려준 결과. 보통 여기가 제일 큽니다 |

**설정이 넣은 것**

| 라벨 | 뜻 |
| --- | --- |
| `claudeMd` | 프로젝트의 CLAUDE.md |
| `memory` | 메모리 파일 |
| `hook` | 훅이 끼워넣은 내용 |
| `skill` | 스킬 본문. Claude가 스킬을 쓰면 통째로 실립니다. 보통 꽤 큽니다 |
| `mcpInstructions` | MCP 서버에서 온 지시문 |
| `systemReminder` | Claude Code가 붙이는 `<system-reminder>` 블록 |
| `auto-inserted` | 그 밖에 Claude Code가 사용자 턴에 써 넣는 것들. 슬래시 커맨드와 그 출력, 작업 알림 같은 것으로 사용자가 친 게 아닙니다 |

**계산용**

| 라벨 | 뜻 |
| --- | --- |
| `compactionSummary` | 대화를 압축할 때 옛 메시지 대신 들어간 요약 |
| `not-in-transcript` | 기본 시스템 프롬프트와 도구 정의. 매 요청 나가지만 기록 파일에는 안 남습니다 |
| `estimate gap` | 위 항목들이 표시된 크기보다 실제로 더 큽니다. 그 차이 |

### 오해하기 쉬운 라벨 두 개

`user`는 사람이 직접 친 것만 들어갑니다. Claude Code는 스킬 본문이나 슬래시 커맨드,
작업 알림, 리마인더도 사용자 턴에 써 넣는데, 그런 건 종류별로 따로 분류합니다. 남은 것
중에서 기록 파일이 "진짜 사용자 메시지가 아니다"라고 표시해둔 건 `auto-inserted`로
갑니다. 고치기 전에는 `user`로 잡힌 토큰의 97%가 사용자가 친 게 아니었습니다.

`estimate gap`은 없는 내용이 아닙니다. 패널은 조각 크기를 글자 수로 짐작하는데 실제보다
작게 나옵니다. 대신 응답마다 모델이 실제로 받은 토큰 수가 기록에 남아 있어서, 세션
전체에서 짐작과 실제를 비교한 다음 차이를 둘로 나눕니다.

- `not-in-transcript`: 대화가 길어져도 크기가 안 변하는 부분. 시스템 프롬프트와 도구
  정의로, 기록 파일에 정말 없는 내용입니다.
- `estimate gap`: 대화가 길어질수록 같이 커지는 부분. 이 내용은 기록에 있습니다. 크기만
  작게 짐작한 겁니다.

비교가 충분히 일관될 때만 나눕니다. 최소 5턴이 있어야 하고, 잘 들어맞아야 합니다. 아니면
나눌 근거가 없으니 한 줄로 합쳐둡니다. 어떤 세션에서는 gap이 합계의 69%였습니다. 전체를
"기록에 없는 것"으로 읽으면 대부분을 잘못 이해하게 되는 셈입니다.

`/compact` 직후 `not-in-transcript` 비중이 갑자기 커지는 것도 같은 이유입니다. 압축은
대화를 줄이지 시스템 프롬프트와 도구 정의는 안 건드립니다. 위쪽 숫자는 그대로인데
아래쪽만 줄어드니 비율이 오릅니다.

## 설치

> 설치하고 나서 **Developer: Reload Window**를 실행하고, Claude Code로 작업한 적 있는
> 프로젝트를 연 다음 명령 팔레트에서 **Claude Context: Visualize**를 실행하세요.

### 방법 A — Releases에서 `.vsix` 받기 (권장)

1. [**Releases**](https://github.com/Leehongseok-code/claude-context-visualizer/releases) 페이지에서 최신 `claude-context-visualizer-*.vsix`를 받습니다.
2. 둘 중 편한 쪽으로 설치합니다:
   - **CLI:** `code --install-extension claude-context-visualizer-*.vsix`
   - **UI:** 확장 패널 → `⋯` 메뉴 → **Install from VSIX…**

### 방법 B — 한 줄로 ([GitHub CLI](https://cli.github.com) 필요)

```bash
gh release download -R Leehongseok-code/claude-context-visualizer --pattern '*.vsix' --clobber \
  && code --install-extension claude-context-visualizer-*.vsix
```

### 방법 C — 소스에서 빌드

```bash
git clone https://github.com/Leehongseok-code/claude-context-visualizer
cd claude-context-visualizer
npm install && npm run build && npm run package
code --install-extension claude-context-visualizer-*.vsix
```

> `code` 명령이 없으면 VS Code에서 명령 팔레트 → **Shell Command: Install 'code' command in PATH**를 실행하거나, 위의 UI 방식으로 설치하세요.

## 개발

- `npm install` · `npm run build` · `npm test` · `npm run typecheck`
- **F5**를 누르면 Extension Development Host가 뜹니다.
- `npm run package`로 `.vsix`를 만듭니다.

## 릴리스

`v*` 태그를 푸시하면 빌드, 테스트, 패키징까지 하고 `.vsix`를 GitHub Release에
붙여줍니다 (`.github/workflows/release.yml` 참고).

```bash
# package.json의 "version"을 올린 다음:
git tag v0.1.1 && git push origin v0.1.1
```

## 라이선스

MIT — [LICENSE](LICENSE) 참고.
