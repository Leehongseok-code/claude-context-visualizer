# Claude Context Visualizer

**English** | [한국어](#한국어)

A VS Code extension that shows **what Claude Code actually sent to the model on each
turn** — your CLAUDE.md, skills, hooks, memory, MCP instructions, tool calls and their
output, and the conversation so far — broken down by size, so you can see where the
tokens went.

- **Session → turn → breakdown**, all in one panel
- Every piece is measured and ranked; click one to read the exact text it contributed
- Text is formatted according to what it is: JSON pretty-printed, code highlighted,
  Markdown rendered
- **Open an `Agent` call** to read that subagent's own conversation
- Click a category to hide it; repeated, oversized, and estimated pieces are flagged
- Works in any project — sessions are matched to the folder you have open

Nothing leaves your machine. It reads the log files Claude Code already writes to
`~/.claude/projects/`, plus your project config. No network, no API key.

## Screenshots

A turn broken into pieces, largest first. Click one to read what it contributed —
tool output is formatted automatically:

![A tool result shown as pretty-printed JSON](docs/images/context-json.png)

CLAUDE.md, skill bodies, and hook text render as Markdown; switch to raw text at any
time:

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
slash commands, task notifications, and reminders into the user's turn. Those are
sorted out by what they actually are, and anything left that the log marks as
not-a-real-message becomes `auto-inserted`. Before this was fixed, 97% of the tokens
labelled `user` had never been typed by anyone.

**`estimate gap` is not missing content.** The panel estimates each piece's size from
its text, and that estimate runs low. Every response records how many tokens the model
actually received, so the panel compares the two across the session and splits the
difference in half:

- `not-in-transcript` — the part that is there no matter how long the conversation
  gets. That is the system prompt and the tool definitions, which the log genuinely
  never holds.
- `estimate gap` — the part that grows with the conversation. That content *is* in
  the log; only the size estimate fell short.

The split only appears when the comparison is consistent enough to trust (at least
5 turns, and a tight fit). Otherwise the two stay merged into one row, because
dividing them would be guesswork. In one session the gap was 69% of the combined
figure — big enough that reading the whole thing as "content the log never had"
would be wrong about most of it.

This also explains something that looks like a bug after `/compact`: the
`not-in-transcript` share jumps. Compacting shortens the conversation but leaves the
system prompt and the tool definitions untouched. The numerator stays put while the
denominator collapses, so the percentage rises.

## Install

> After installing, run **Developer: Reload Window**, open a project you have used with
> Claude Code, then go to the Command Palette → **Claude Context: Visualize**.

### Option A — download the `.vsix` from Releases (recommended)

1. Open the [**Releases**](https://github.com/Leehongseok-code/claude-context-visualizer/releases) page and download the latest `claude-context-visualizer-*.vsix`.
2. Install it in either of these ways:
   - **CLI:** `code --install-extension claude-context-visualizer-*.vsix`
   - **UI:** Extensions panel → `⋯` menu → **Install from VSIX…**

### Option B — one line (requires the [GitHub CLI](https://cli.github.com))

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

> No `code` command? In VS Code, go to the Command Palette → **Shell Command: Install 'code' command in PATH**, or use the UI install above.

## Develop

- `npm install` · `npm run build` · `npm test` · `npm run typecheck`
- Press **F5** to launch the Extension Development Host.
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

Claude Code가 매 턴 모델에 실제로 무엇을 보냈는지 보여 주는 VS Code 확장입니다.
CLAUDE.md, 스킬, 훅, 메모리, MCP 지시문, 도구 호출과 그 결과, 지금까지의 대화를
크기별로 나누어 보여 주므로 토큰이 어디에 쓰였는지 확인할 수 있습니다.

- 세션 → 턴 → 내역을 하나의 패널에서 확인합니다
- 조각마다 크기를 측정해 큰 순서로 정렬하며, 클릭하면 그 조각이 더한 내용을 그대로 볼 수 있습니다
- 내용은 종류에 맞게 표시합니다. JSON은 정렬하고, 코드는 구문 강조를 적용하며, 마크다운은 렌더링합니다
- `Agent` 호출을 펼치면 해당 서브에이전트가 나눈 대화까지 확인할 수 있습니다
- 카테고리를 클릭해 숨길 수 있고, 중복되거나 지나치게 큰 조각과 추정값에는 표시가 붙습니다
- 어떤 프로젝트에서든 사용할 수 있습니다. 열어 둔 폴더에 해당하는 세션을 자동으로 찾습니다

밖으로 나가는 정보는 없습니다. Claude Code가 `~/.claude/projects/`에 이미 남기는 기록
파일과 프로젝트 설정만 읽습니다. 네트워크와 API 키는 사용하지 않습니다.

## 화면 예시

한 턴을 조각으로 나누어 큰 순서대로 보여 줍니다. 하나를 클릭하면 그 조각의 내용이
나타나고, 도구 결과는 자동으로 정리됩니다:

![도구 결과가 정렬된 JSON으로 표시](docs/images/context-json.png)

CLAUDE.md와 스킬 본문, 훅이 넣은 내용은 마크다운으로 표시하며, 언제든 원본 텍스트로
전환할 수 있습니다:

![CLAUDE.md가 마크다운으로 렌더링](docs/images/context-markdown.png)

첫 메시지를 보고 세션을 고른 다음, 원하는 턴을 엽니다:

![각 세션의 첫 메시지가 보이는 세션 목록](docs/images/sessions.png)

> 화면 예시에는 임의로 만든 샘플 데이터를 사용했습니다.

## 각 카테고리의 의미

컨텍스트의 모든 조각에는 라벨이 하나씩 붙습니다. 라벨을 클릭하면 해당 카테고리가
숨겨집니다.

**사람이나 모델이 작성한 것**

| 라벨 | 의미 |
| --- | --- |
| `user` | 사람이 직접 입력한 내용. 아래 설명을 참고하세요 |
| `assistant` | Claude의 답변 |
| `thinking` | Claude가 추론한 내용. 0토큰으로 표시됩니다. 다음 요청에서 API가 제외하므로 남아 있어도 비용이 들지 않습니다 |

**도구가 수행한 일**

| 라벨 | 의미 |
| --- | --- |
| `toolUse` | 도구 호출과 함께 전달된 인자 |
| `toolResult` | 도구가 반환한 결과. 대개 가장 큰 카테고리입니다 |

**설정이 추가한 것**

| 라벨 | 의미 |
| --- | --- |
| `claudeMd` | 프로젝트의 CLAUDE.md |
| `memory` | 메모리 파일 |
| `hook` | 훅이 삽입한 내용 |
| `skill` | 스킬 본문. Claude가 스킬을 사용하면 전체가 함께 실립니다. 대개 크기가 큽니다 |
| `mcpInstructions` | MCP 서버에서 전달된 지시문 |
| `systemReminder` | Claude Code가 덧붙이는 `<system-reminder>` 블록 |
| `auto-inserted` | 그 밖에 Claude Code가 사용자 턴에 기록하는 내용. 슬래시 명령과 그 출력, 작업 알림 등으로 사용자가 직접 입력한 것이 아닙니다 |

**집계 항목**

| 라벨 | 의미 |
| --- | --- |
| `compactionSummary` | 대화를 압축할 때 이전 메시지를 대신해 들어간 요약 |
| `not-in-transcript` | 기본 시스템 프롬프트와 도구 정의. 요청마다 전송되지만 기록 파일에는 남지 않습니다 |
| `estimate gap` | 위 항목들의 실제 크기가 표시된 크기보다 큽니다. 그 차이입니다 |

### 오해하기 쉬운 라벨 두 가지

**`user`는 사람이 직접 입력한 내용만을 뜻합니다.** Claude Code는 스킬 본문과 슬래시
명령, 작업 알림, 리마인더도 사용자 턴에 기록하는데, 이러한 항목은 실제 성격에 따라
따로 분류합니다. 그러고도 남은 것 가운데 기록 파일이 실제 사용자 메시지가 아니라고
표시해 둔 항목은 `auto-inserted`로 분류됩니다. 이 부분을 고치기 전에는 `user`로 집계된
토큰의 97%가 사람이 입력한 내용이 아니었습니다.

**`estimate gap`은 누락된 내용이 아닙니다.** 패널은 각 조각의 크기를 텍스트를 바탕으로
추정하는데, 이 추정값은 실제보다 작게 나옵니다. 한편 모델이 실제로 받은 토큰 수는
응답마다 기록에 남으므로, 패널은 세션 전체에서 두 값을 비교한 뒤 그 차이를 절반으로
나눕니다.

- `not-in-transcript`: 대화가 길어져도 크기가 변하지 않는 부분입니다. 시스템 프롬프트와
  도구 정의로, 기록 파일에 실제로 존재하지 않는 내용입니다.
- `estimate gap`: 대화가 길어질수록 함께 커지는 부분입니다. 이 내용은 기록 파일에 있으며,
  크기만 작게 추정된 것입니다.

두 값의 비교가 충분히 일관될 때만 이렇게 나눕니다. 최소 5개 턴이 있어야 하고, 오차도
작아야 합니다. 그렇지 않으면 나눌 근거가 부족하므로 한 줄로 합쳐서 표시합니다. 어떤
세션에서는 이 차이가 합계의 69%를 차지했습니다. 전체를 "기록에 없는 내용"으로 읽었다면
대부분을 잘못 이해한 셈이 됩니다.

`/compact` 직후 `not-in-transcript` 비중이 갑자기 커지는 현상도 같은 이유입니다. 압축은
대화를 줄일 뿐 시스템 프롬프트와 도구 정의는 그대로 둡니다. 분자는 그대로인데 분모만
줄어들기 때문에 비율이 올라갑니다.

## 설치

> 설치한 뒤 **Developer: Reload Window**를 실행하고, Claude Code로 작업한 적이 있는
> 프로젝트를 연 다음 명령 팔레트에서 **Claude Context: Visualize**를 실행하세요.

### 방법 A — Releases에서 `.vsix` 내려받기 (권장)

1. [**Releases**](https://github.com/Leehongseok-code/claude-context-visualizer/releases) 페이지에서 최신 `claude-context-visualizer-*.vsix`를 내려받습니다.
2. 다음 중 편한 방법으로 설치합니다.
   - **CLI:** `code --install-extension claude-context-visualizer-*.vsix`
   - **UI:** 확장 패널 → `⋯` 메뉴 → **Install from VSIX…**

### 방법 B — 명령 한 줄로 설치 ([GitHub CLI](https://cli.github.com) 필요)

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

> `code` 명령을 사용할 수 없다면 VS Code에서 명령 팔레트 → **Shell Command: Install 'code' command in PATH**를 실행하거나, 위의 UI 방식으로 설치하세요.

## 개발

- `npm install` · `npm run build` · `npm test` · `npm run typecheck`
- **F5**를 누르면 Extension Development Host가 실행됩니다.
- `npm run package`로 `.vsix` 파일을 만듭니다.

## 릴리스

`v*` 태그를 푸시하면 빌드와 테스트, 패키징을 거쳐 `.vsix` 파일이 GitHub Release에
첨부됩니다(`.github/workflows/release.yml` 참고).

```bash
# package.json의 "version"을 올린 다음:
git tag v0.1.1 && git push origin v0.1.1
```

## 라이선스

MIT — [LICENSE](LICENSE) 참고.