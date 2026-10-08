# 구조

## 층

```
┌ src/ui ─────────────────────────────────────────────┐
│ App ─ DocView(접기·앵커·개요·바뀐 글) ─ Editor ─ Panel ─ RunDock ─ Hover ─ Dialogs │  화면. 어댑터 인터페이스만 안다
└───────────────▲─────────────────────────────────────┘
                │ DocBenchAdapters (src/types.ts)
┌ src/adapters ─┴─────────────────────────────────────┐
│ memory   rest(→ docs/openapi.yaml)   claude-artifact   folder(로컬 폴더 직접) │
└───────────────▲─────────────────────────────────────┘
                │
┌ src/core ─────┴──── DOM 없음 · 서버/CLI 와 공유(dist/core.mjs) ┐
│ source(섹션 키·범위) selectors(문구 앵커) feedback diff prompt │
│ textcodec(바이트↔글) workspace(작업 폴더 규약: 설정·glob·매니페스트·이력) │
│ runs(Claude 작업 규약: 요청·상태·로그 모양, 프롬프트, 결과 검사, 실행기 고르기) │
└───────────────────────────────────────────────────────┘
```

**같은 규칙은 한 곳에**: 바이트 보존(`textcodec`)과 `.docbench/` 디스크 모양(`workspace`)은 서버(Node)와 브라우저 폴더 어댑터가
같은 코드를 쓴다. 각자는 입출력(파일·해시·잠금)과 CP949 코덱만 다르다 — 서버는 `iconv-lite`, 브라우저는 내장 `euc-kr` 디코더로 만든 역표
(둘이 BMP 전 글자·2바이트 전 쌍에서 같음을 e2e 로 확인).

```
단일 HTML(release/docbench.html) ─ standalone.ts ─ folder 어댑터 ─ File System Access API ─┐
    └ Claude 작업: 요청 파일 ─▶ 이 PC 의 실행기 docbench runner (RunEngine) ─ claude -p ────┤
대시보드 패널 ─ <doc-bench> ─ rest 어댑터 ─ HTTP ─ server/ (Workspace + RunEngine) ─────────┼─ 같은 작업 폴더(.md + .docbench/)
터미널의 Claude Code ─ bin/docbench.mjs (Workspace) ───────────────────────────────────────┘
```

**어댑터** (src/types.ts) — 화면이 바깥에 기대는 것 전부.

| 어댑터 | 하는 일 | 필수 |
|---|---|---|
| `docs: DocSource` | 매니페스트, 문서 읽기·저장(판 비교), 특정 판·기준본, 이력, 폴더 지도, 변경 알림 | ✔ (`save` 없으면 읽기 전용) |
| `feedback: FeedbackStore` | 구독·생성·수정(판 비교)·삭제 | ✔ |
| `viewState` | 접기·깊이·마지막으로 본 판 (사람별) | 없으면 브라우저에만 |
| `identity` | 나, 권한(`doc.edit` `feedback.*` `assistant.*`) | 없으면 전부 허용 |
| `assistant` | 섹션 + 피드백 → 수정 제안 | 없으면 버튼 숨김 |
| `notifier` | "AI 에게 넘기기" 요청함 (터미널의 Claude Code 가 읽는다) | 없으면 `runs` 가 있을 때만 버튼 |
| `runs` | Claude 작업: 상태(실행기·Claude Code 판)·시작·취소·목록·로그 | 없으면 Claude 작업 창 없음(예전 `assistant`·`notifier` 로) |
| `platform` | 복사·내려받기 | 선택 |

## 불변식: 섹션 키

섹션 편집이 안전한 이유는 **원문에서 계산한 섹션 키 = 화면에서 계산한 섹션 키** 이기 때문이다.

- 키 = 상위 제목부터 자기 제목까지 **화면 글자**를 ` › ` 로 이은 것. 같은 키가 또 나오면 ` #2`, ` #3`.
- 원문 쪽(`core/source.ts`)은 marked lexer 토큰의 `raw` 길이로 오프셋을 잰다. `raw` 를 이으면 입력과 같다(테스트로 고정).
- 제목 글자는 `headingPlain` — 인라인 마크다운을 HTML 로 그린 뒤 태그를 지우고 엔티티를 푼 값 = 브라우저 `textContent`.
- 화면 쪽(`ui/render.ts sectionize`)은 마크다운이 만든 제목(`data-md` 표시)의 `textContent` 로 같은 규칙을 적용한다. 문서에 HTML 로 직접 쓴 `<h2>` 는 섹션이 아니다.
- 열린 HTML 상자(`<details>`·`<div>` …) 안의 마크다운 제목은 브라우저가 상자 안에 넣으므로, 원문 쪽도 세지 않는다.
- `test/unit/parity.test.ts` 가 예제·까다로운 고정 문서(+ `DOCBENCH_PARITY_DIR`)로 둘이 같은지 확인한다.

섹션 하나를 바꾸면(`replaceSection`) 그 범위 밖 글자는 바이트 그대로이고, 끝의 빈 줄 모양도 유지된다.

**GFM 물결표**: `9/29~10/2 … 10/5~10/9` 처럼 한 문단에 홑물결이 둘이면 GFM 은 사이를 취소선으로 읽는다. `protectTildes` 가 코드 밖 홑물결만 이스케이프한다(`~~취소선~~` 은 그대로).

## 피드백 모델

```ts
{ id, version, docId,
  target: { kind:'section', path:[...], heading, occurrence? } | { kind:'doc' } | { kind:'item', itemId },
  selector?: { exact, prefix, suffix },       // W3C TextQuoteSelector
  body, kind?, severity?: high|medium|low,
  status: open|resolved|declined,
  waitingOn: owner|assistant,                  // 다음 수를 둘 쪽
  author, thread: [{author, text, at}],
  proposal?: { path, before, after, rationale, author, at, state: pending|applied|rejected },
  wasCollapsed?, createdAt, updatedAt }
```

- **차례**: `status=open` 이면 `waitingOn` 이 차례, 아니면 `resolved`/`declined`. 화면 상단과 패널 거르기가 이것으로 돈다.
- **앵커**: 섹션 경로로 먼저 찾고, 같은 이름 제목이면 `occurrence` → 인용문이 들어 있는 곳 순. 제목이 바뀌어 못 찾으면 "떨어진 피드백"으로 센다(지우지 않는다).
- **판 비교**: 피드백 수정은 `version` 이 같을 때만. 다르면 409 + 현재 값.
- 예전(작업대 v1) 행은 `normalizeFeedback` 이 읽어서 새 모양으로 맞춘다.

## 흐름

**저장** — `save(id, md, { baseVersion })`. 판이 다르면 `DocConflictError(current)`.
화면(Editor)은 최신본에서 내 섹션이 그대로면 내 편집을 다시 얹어 저장하고, 같은 섹션이 바뀌었으면 차이를 보여 주고 "최신본에 내 편집 적용 / 내 편집 버리기" 를 고르게 한다.

**밖에서 고침** — 로컬 서버는 파일을 감시한다. 알던 판과 다르면 이력에 `by: external` 로 남기고(바뀐 섹션 포함) SSE 로 알린다. 열려 있는 화면은 다시 읽고 바뀐 섹션에 표시를 단다. CLI 가 `docbench log` 로 요약을 덧붙이면 그 이력에 합쳐진다.
CLI 가 `doc write` 로 고친 문서는 새 판을 `state.json` 에 먼저 적으므로 외부 편집이 아니다 — 대신 `changes.jsonl` 에 새로 붙은 줄의 문서를 알려 화면이 다시 읽는다(빠졌던 것을 e2e 로 재현해 고침).

**마지막으로 본 뒤** — 보기 상태에 문서별 `lastSeen`(판)을 둔다. 다시 열 때 그 판 본문(`loadVersion`)과 비교해 바뀐 섹션에 표시하고 "이 변경 이후 차이"를 보여 준다. 로컬 서버는 본 적 있는 판 본문을 `.docbench/blobs/` 에 둔다.

**밖에서 고친 것 따라가기** — 도구 밖(에디터·터미널의 Claude·동기화)에서 고쳐도 화면이 최신인지 보이게:
문서 머리에 "최신 · n초 전 확인"(서버는 "실시간 반영")과 **다시 읽기**(디스크와 지금 맞춰 보고 바깥 편집이면 이력에 남김), 다른 문서가 바뀌면 왼쪽 목록에 "바뀜",
단일 HTML 은 창으로 돌아오면(`focus`) 바로 확인한다. 편집하는 동안 바뀌면 내 글은 지키고 — 다른 섹션만 바뀌었으면 저장 때 최신 판에 끼우고,
같은 섹션이면 그쪽 글과 내 글의 차이를 보여 주고 "그쪽 글로 바꾸고 이어서 / 내 글 지키기"를 고르게 한다.

**바뀐 글 표시** (`ui/track.ts`) — "마지막으로 본 뒤" 바뀐 섹션마다 자기 본문(하위 섹션 제외)을 예전 판과 낱말 단위로 비교해,
더한 글은 `<ins>`(초록), 지운 글은 `<del>`(취소선)으로 그 자리에 그린다. 바뀐 곳 사이의 짧은 같은 글(문장부호·한두 글자)은 묶어
"(최대 5회)" → "— 최대 3회, …" 처럼 구절 단위로 보인다(글자 하나씩 지우고 더한 표시는 읽기 어렵다). 60% 넘게 바뀌면 "크게 바뀜"으로 섹션만 표시.
지운 글은 `.db-noindex` 라 피드백 문구 찾기·찾기에서 빠진다. 누가·언제는 이력(`changes`)에서 "본 판 → 지금 판"으로 이어지는 기록을 거슬러 찾는다
(Claude·바깥 편집·사람 이름 + 피드백 수). 위쪽 줄에 이전/다음 바뀐 곳, 표시 끄기, 줄 단위 차이, "확인"(본 판으로).

**AI 제안** — 패널이 섹션 원문 + 피드백으로 `assistant.propose` 를 부른다. 응답은 `{ after, rationale }` 하나(`core/prompt.ts` 의 스키마, 머리줄이 사라지면 거부). 제안은 피드백의 `proposal` 로 저장되고 사람 차례가 된다. 적용 때 섹션이 `before` 와 같으면 바로 저장, 다르면 편집기에 제안을 넣어 사람이 확인한다.
`runs` 어댑터가 있으면 카드의 "Claude 제안"은 아래 Claude 작업(종류 `propose`)으로 간다 — 모델·노력을 고르고 진행이 보인다. `assistant.propose` 는 REST 계약을 위해 남는다.

## Claude 작업 (`server/runs.mjs` · `src/core/runs.ts` · `src/ui/runs.ts`)

화면이 넘긴 피드백을 Claude 가 백그라운드에서 처리한다. 화면 ↔ 실행 엔진은 **작업 폴더의 파일**로만 주고받는다(서버 모드는 REST 가 같은 파일을 쓴다):

| 파일 (`.docbench/`) | 쓰는 쪽 | 내용 |
|---|---|---|
| `runs/<id>.req.json` | 화면(단일 HTML)·서버 | 요청: 종류(handoff·propose)·피드백 id·모델·노력·방식(Claude 판단·제안만)·**실행기 id** |
| `runs/<id>.json` | 엔진만 | 상태: queued·running(진행 단계·토큰)·done·failed·canceled, 요약(고침·제안·답·질문·보류·건너뜀·실패), 사용량(5시간 한도 몫 포함) |
| `runs/<id>.log.jsonl` | 엔진만 (덧붙임) | 로그 줄 `{at, k, v, text, ref}` — 화면 사전 `run.log.<k>` 로 그린다 |
| `runs/<id>.cancel` | 누구나 | 취소 요청 |
| `runners/<id>.json` | 엔진만 (4초마다) | 심장 박동: 사용자·PC·pid·판·Claude Code 판과 안전 플래그 확인 결과. 20초 소식이 없으면 꺼진 것 |

- **엔진**(`RunEngine`)은 서버(`docbench serve`, 대시보드 처리기 — id `server:<사용자>@<PC>`)와 실행기(`docbench runner` — `runner:…`) 둘 다다. 자기 id 앞으로 온 요청만 집어 **한 번에 하나씩** 돌린다(폴더를 함께 쓰는 다른 PC 의 실행기가 집어 가지 않게).
- **실행**: 문서 폴더 밖(이 PC 의 설정 폴더 아래 `work/`)에서 `claude -p --restricted --safe-mode --permission-mode dontAsk --tools Read,Grep,Glob --add-dir <문서 폴더> --strict-mcp-config --no-session-persistence --output-format stream-json --verbose --json-schema <RUN_SCHEMA> [--model] [--effort]`, 프롬프트는 표준입력. 시작할 때 `claude --version`·`--help` 로 판과 필요한 플래그(`REQUIRED_CLAUDE_FLAGS`)를 확인하고, 없으면 실행하지 않는다(`old-claude`). Windows 의 npm 설치본(`claude.cmd`)은 그 옆 `cli.js` 를 node 로 부른다.
- **프롬프트**(`buildRunPrompt`): 항목마다 피드백·인용·대화·지금 섹션 글·허용 처리(`edit propose answer ask decline` 중 — 설정으로 막힌 문서는 고치기 없음, 6만 자 넘는 섹션은 답·질문·보류만)·문서 파일 경로. 사람·문서에서 온 글은 `<<< >>>` 경계 안의 데이터로 다룬다.
- **결과 검사**(`planRun`): 모르는 피드백 id 는 버리고, 허용되지 않은 처리는 질문으로, 고친 글은 `checkSectionText`(CLI `doc write` 와 같은 규칙: 같은 단계 제목 줄, 제목 그대로, 하위 섹션 보존)를 통과해야 한다. 고친 글이 비었거나 모양이 틀리면 **반영하지 않고 실패로**(피드백은 Claude 차례 그대로 — "바꿨습니다" 회신이 실제로 반영되지 않은 채 사람에게 가지 않게). 같은 섹션을 두 번 고치면 둘째부터 제안으로, 글이 그대로면 답으로.
- **반영**(엔진): 고치기는 지금 판을 다시 읽어 — 그 섹션이 Claude 가 본 그대로면 지금 판에 끼워 `Workspace.writeDoc`(판 비교·잠금·인코딩 보존·이력 `by: Claude`·`feedbackIds`), 사람이 그 사이 같은 섹션을 고쳤으면 **덮지 않고 제안으로**. 피드백 회신·상태는 판 비교로(충돌이면 다시 읽어 세 번까지). 그 사이 사람이 닫거나 넘긴 피드백은 건너뛴다.
- **로그**: stream-json 줄을 `streamEventToLog`(시작·Claude 의 말·읽음·찾음·막음·결과 정리)로 옮기고, 반영 줄은 문서·섹션·피드백으로 이어진다(화면의 "보기"). `DOCBENCH_RUN_DEBUG=1` 이면 Claude 의 결과를 `runs/<id>.out.json` 에 그대로 남긴다(문제 살펴보기용).
- **정리**: 최근 60개 작업만 남긴다. 실행기가 다시 켜지면 돌던 작업은 실패로, 줄 서 있던 요청은 다시 줄에.
- **화면**(`RunDock`): 아래 창 — 모델·노력·방식 고르기(보기 상태에 기억), 넘기기 준비 카드, 작업 목록, 실시간 로그(돌고 있는 동안 1초마다 당김), 취소, 끝나면 알림. 실행기가 없으면 설치 안내(Claude Code 에 붙여 넣을 문구: CLI 파일 주소·SHA-256·폴더 이름 — 빌드가 같은 판으로 채운다), 실행기의 로그인 이름과 화면 이름이 다르면 맞추자고 한다.

## 로컬 서버 (`server/`)

- 의존성 없음(선택: `iconv-lite`). Node 20+.
- **텍스트 입출력**(`textio.mjs` → 규칙은 `src/core/textcodec.ts`): BOM(UTF-8·UTF-16) → UTF-8 → 깨진 바이트가 조금 섞인 UTF-8(읽기 전용) → CP949. **다시 인코딩해 원래 바이트가 그대로 나올 때만 저장 가능**, CP949 에 없는 글자가 들어오면 저장을 막는다. 화면에는 LF 로 주고, 저장할 때 바뀌지 않은 줄은 원래 줄바꿈 그대로, 바뀐 줄은 그 자리 줄바꿈으로. 판 = 파일 바이트 sha256 앞 16자.
- **쓰기 줄 세우기**: 같은 문서·피드백 쓰기는 프로세스 안 약속 사슬 + `.docbench/locks/` 잠금 파일(O_EXCL, 15초 지나면 죽은 잠금)로 한 줄로 세운 뒤 판을 다시 비교한다 — 서버와 CLI 가 동시에 써도 하나만 이긴다.
- **쓰기**: 같은 폴더 임시 파일 → rename. Windows 에서 다른 프로그램이 잡고 있으면(EPERM/EBUSY) 잠깐씩 재시도 후 직접 쓰기.
- **감시**: `fs.watch` 재귀(Windows·macOS·Linux Node 20+), 안 되면 3초 폴링(문서·이력·피드백 폴더).
- **Windows 빌드**: 스크립트 경로는 `fileURLToPath` 로 — `URL.pathname` 은 `/C:/…` 가 되어 `npm install` 의 빌드가 깨진다.
- **git**: 있으면 HEAD 판을 기준본으로, `git status` 를 폴더 지도 표시로.
- `createDocBenchHandler(ws, opts)` 는 `(req, res) => boolean` — Node http, Express, Fastify raw 어디에나 끼운다.

`.docbench/` 구성:

| 경로 | 내용 | 커밋 |
|---|---|---|
| `config.json` | 제목·그룹·문서별 설정·알림 안내 (함께 쓰는 설정) | ✔ |

실행 명령(`assistant`·`notify.command`)과 이름(`user`)은 문서 폴더가 아니라 **이 PC 의 설정**(Windows `%LOCALAPPDATA%\docbench\config.json` 등 운영체제의 앱 설정 자리, `workspaces["<폴더>"]` 로 폴더별)에서만 읽는다 — 문서 폴더는 git·동기화로 남과 나누기 때문(D40).
| `feedback/<id>.json` | 피드백 한 건 = 파일 하나 (충돌 적고 diff 읽기 쉬움) | 팀이 정함 |
| `changes.jsonl` | 저장 이력, 한 줄 = 한 번 | 팀이 정함 |
| `blobs/` `state.json` `viewstate/` `inbox/` | 캐시·개인 상태·요청함 | ✘ (`.docbench/.gitignore`) |
| `runs/` `runners/` | Claude 작업 요청·상태·로그, 실행기 심장 박동 | ✘ (`.docbench/.gitignore`) |

## 서버 없는 단일 HTML (`src/standalone.ts` · `src/adapters/folder*.ts`)

`dist/docbench.html`(= 저장소 `release/docbench.html`)은 CSS·스크립트가 다 들어 있는 파일 하나다. 엣지·크롬으로 열고 문서 폴더를 고르면
**폴더 어댑터**가 File System Access API 로 그 폴더를 직접 읽고 쓴다. 디스크 모양·판(바이트 해시)·이력·잠금 파일 이름까지 서버와 같아서,
같은 폴더를 CLI·서버가 이어받는다(실제 디스크에서 어댑터 ↔ CLI 왕복을 단위 시험으로 확인).

- **고르기·기억**: `showDirectoryPicker` → 핸들을 IndexedDB 에 두고 다음에 "다시 열기"(권한은 브라우저가 다시 물을 수 있다). 다른 브라우저는 `<input webkitdirectory>` 로 읽기만.
- **바뀜 확인**: 감시 대신 2.5초마다(탭이 보일 때만, 한 번에 하나) 이력 파일에 새로 붙은 **완성된 줄**의 문서(이 탭이 쓴 판은 빼고), 피드백 폴더 서명, 설정 파일, 화면이 보고 있는 문서(`docs.focus`)를 보고, 네 번에 한 번 전체 문서를 훑는다. 서버의 이력 감시도 같은 규칙(완성된 줄만, 자기 저장 빼고).
- **줄 세우기**: 브라우저에는 O_EXCL 이 없다. 같은 이름의 잠금 파일이 없으면 내 표식을 쓰고 25ms 뒤 되읽어 그대로인지 확인한다. 그래서 문서·피드백 쓰기는 **양쪽(서버·CLI·브라우저) 모두 쓰기 직전에 판을 한 번 더 비교**한다 — 잠금이 겹치는 아주 좁은 틈에서도 한쪽은 충돌로 멈춘다.
- **이력 덧붙이기**: 브라우저에는 O_APPEND 도 없어 `changes.jsonl` 을 복사본에 덧붙여 바꿔 끼운다. 그 사이 다른 쪽이 덧붙인 줄이 사라지지 않게 서버·CLI·브라우저 모두 `changes` 잠금 안에서 덧붙인다(독립 검토에서 줄 손실 재현, 고침).
- **처음 열기**: 처음 보는 문서들의 판은 잠금·쓰기 한 번에 적는다(문서마다 잠그면 300개에 17초 — 실측).
- **JSON 파일**: 메모장·PowerShell 5.1 이 붙이는 BOM 을 떼고 읽는다(서버도 같게 — `core.parseJsonText`).
- **쓰기**: `createWritable()` 은 임시(.crswap) 파일에 쓰고 닫을 때 바꿔 끼운다.
- **Claude 작업**: 페이지는 PC 프로그램을 켤 수 없으므로 이 PC 의 실행기(`docbench runner`)가 요청 파일을 받아 claude 를 띄운다. 실행기 없이는 "넘기기"가 요청함 파일만 남기고(`queued`) 터미널의 Claude Code 로 처리한다.
- **없는 것**: git 기준본, 넘기기 명령(`notify.command`).
- **CSP**: 파일 안에 `connect-src 'none'`·`img-src data: blob:`·referrer 없음 — DocBench 가 문서를 어디로도 보내지 않는 데 더해, 페이지 안에서 요청·그림으로 새는 길도 막는다. 문서 속 바깥 주소 그림은 보이지 않는다. 새 창 이동은 CSP 로 못 막는다(문서 속 스크립트는 DOMPurify 가 지운다).
- **이름·기억**: 쓰려면 이름이 필요하다(작성자·보기 상태의 주인). `file://` 로 열면 고른 폴더를 기억하지 않는다(다른 로컬 HTML 이 꺼내 쓸 수 있어서).
- `file://` 은 보안 문맥이라 쓰기가 된다. `http://사내호스트` 는 보안 문맥이 아니어서 읽기만 된다.

## 화면

- 모든 스타일은 `.docbench` 아래 `--db-*` 토큰(우선순위 0 인 `:where()` 로 선언 — 호스트가 쉽게 덮는다). 테마는 `data-theme=light|dark|auto`.
- **호스트 CSS 차단막**: 작업대 안 요소를 `all: revert` 로 브라우저 기본값에 되돌린 뒤 작업대 규칙만 얹는다. 빌드가 `.docbench` 를 세 번 겹쳐 대시보드 전역 규칙보다 우선하게 한다(e2e 로 확인).
- 배치는 **컨테이너 쿼리**(`container: docbench`)로 정한다 — 화면 폭이 아니라 *끼워진 패널 폭*에 반응한다. 1099px 이하면 피드백 패널이, 760px 이하면 목록이 서랍이 된다.
- 단축키는 기본으로 작업대에 초점이 있을 때만(`shortcuts: 'scoped'`) — 대시보드의 다른 입력과 부딪히지 않는다.
- **왼쪽 목록**: 위는 도구(Claude 작업·변경 이력·폴더 지도), 아래는 문서. 매니페스트에 `folders`(폴더 → 문서 아닌 파일 수, 훑기가 센다)가 있으면 탐색기처럼 폴더 나무로 — 폴더 먼저, 문서가 없는 폴더도 흐리게(누르면 폴더 지도의 그 폴더), 문서 제목 아래 파일 이름. config.json 에 모음(groups)을 적었으면 "모음 / 폴더"를 고른다.
- **마우스를 올리면**(`ui/hover.ts`): 본문의 피드백 표시·섹션 옆 피드백 수 → 미리보기(누가·언제·차례·내용·마지막 답, Claude 처리 중), 바뀐 글·"바뀜" 표 → 누가·언제, 패널 카드 → 본문의 그 문구·섹션을 밝힌다.
- **알림 한 줄**: 글 길이만큼(최대 12초) 두고 마우스를 올리면 멈춘다. 해야 할 일이 담긴 알림은 닫을 때까지, 버튼 하나를 달 수 있다.
- 이벤트: `onEvent` 콜백과 `docbench:<type>` CustomEvent (`doc:saved`, `feedback:created` …).
