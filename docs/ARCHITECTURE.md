# 구조

## 층

```
┌ src/ui ─────────────────────────────────────────────┐
│ App ─ Explorer(펼친 폴더만) ─ DocView(접기·앵커·개요·바뀐 글·읽기 정리) ─ Editor ─ Composer(그 자리에서 적기) ─ Panel(초안·볼 것·보냄·끝남) ─ RunDock ─ Hover ─ Dialogs │  화면. 어댑터 인터페이스만 안다
└───────────────▲─────────────────────────────────────┘
                │ DocBenchAdapters (src/types.ts)
┌ src/adapters ─┴─────────────────────────────────────┐
│ memory   rest(→ docs/openapi.yaml)   claude-artifact   folder(로컬 폴더 직접) │
└───────────────▲─────────────────────────────────────┘
                │
┌ src/core ─────┴──── DOM 없음 · 서버/CLI 와 공유(dist/core.mjs) ┐
│ source(섹션 키·범위) selectors(문구 앵커) feedback diff prompt │
│ textcodec(바이트↔글) workspace(작업 폴더 규약: 설정·glob·매니페스트·이력·나무·큰 폴더) │
│ records(기록 합치기) runs(Claude 작업 규약: 요청·상태·로그 모양, 프롬프트, 결과 검사, 실행기 고르기) │
│ apply(결과 반영 한 벌 — 엔진·화면·흉내, D75) room(Claude 자리: 기록 폴더의 지시·권한·터미널 한 줄, D76) │
└───────────────────────────────────────────────────────┘
```

**들어가는 곳** — 화면(`App`)은 하나이고 감싸는 껍데기만 다르다.

| 껍데기 | 만드는 것 | 어댑터 |
|---|---|---|
| `src/index.ts` | `createDocBench`·`<doc-bench>`(dist/docbench.js) — 대시보드에 직접 끼움 | 호스트가 준 것(보통 rest) |
| `src/standalone.ts` | 서버 없는 단일 HTML(release/docbench.html) | folder, 시작하기는 memory |
| `src/app-shell.ts` | DocBench 앱 화면 `/` 와 대시보드 탭 `/embed`(dist/app.js) | rest(`/api/w/<id>`), 시작하기는 memory |
| `src/welcome.ts` | "시작하기" 작업 공간의 글(문서 둘·예제 피드백 하나) — 저장하지 않는다. 흉내 Claude(`demoRuns`, 실행기 종류 `demo`, D72) — 결과 반영은 진짜와 같은 `core/apply`(D75) | memory |

**같은 규칙은 한 곳에**: 바이트 보존(`textcodec`)·기록 폴더 모양(`workspace`)·기록 합치기(`records`)·결과 반영(`apply`)·Claude 자리(`room`)는 서버(Node)와 브라우저 폴더 어댑터가
같은 코드를 쓴다. 각자는 입출력(파일·해시·잠금)과 CP949 코덱만 다르다 — 서버는 `iconv-lite`, 브라우저는 내장 `euc-kr` 디코더로 만든 역표
(둘이 BMP 전 글자·2바이트 전 쌍에서 같음을 e2e 로 확인).

```
단일 HTML(release/docbench.html) ─ standalone.ts ─ folder 어댑터 ─ File System Access API ─────┐
    └ Claude 작업: 요청 파일 ─▶ 이 PC 의 DocBench 앱(또는 실행기) RunEngine ─ claude -p ───────┤
DocBench 앱 화면 ─ app-shell.ts ─ rest 어댑터 ─ HTTP(127.0.0.1·열쇠) ─ server/app.mjs ─────────┤
대시보드 탭 ─ host.js ─ iframe /embed ─ app-shell.ts ─ (위와 같은 앱) ───────────────────────────┼─ 같은 문서 폴더(.md) + 같은 기록 폴더
대시보드 패널 ─ <doc-bench> ─ rest 어댑터 ─ HTTP ─ server/ (Workspace + RunEngine) ─────────────┤
터미널의 Claude Code ─ bin/docbench.mjs (Workspace) ────────────────────────────────────────────┘
```

**어댑터** (src/types.ts) — 화면이 바깥에 기대는 것 전부.

| 어댑터 | 하는 일 | 필수 |
|---|---|---|
| `docs: DocSource` | 매니페스트, 문서 읽기·저장(판 비교), 특정 판·기준본, 이력, 폴더 지도, 변경 알림, 폴더 나무(`tree` — 펼친 폴더만) | ✔ (`save` 없으면 읽기 전용, `tree` 없으면 매니페스트의 폴더 나무로) |
| `feedback: FeedbackStore` | 구독·생성·수정(판 비교)·삭제 | ✔ |
| `viewState` | 접기·깊이·마지막으로 본 판·고정·최근·펼친 폴더 (사람별) | 없으면 브라우저에만 |
| `identity` | 나(계정 `id`·표시 이름 `name`), 권한(`doc.edit` `feedback.*` `assistant.*`), 표시 이름 바꾸기(`setName`), 계정이 어디서 왔나(`source`: browser·pc·host) | 없으면 전부 허용 |
| `assistant` | 섹션 + 피드백 → 수정 제안 (REST 계약 호환 — 화면은 부르지 않는다, D78) | 선택 |
| `notifier` | 요청함으로 보내기 (터미널의 Claude Code 가 읽는다, 아티팩트는 대화창으로) | `runs` 가 없을 때 "어디로"의 한 갈래 |
| `runs` | Claude 작업: 상태(실행기·Claude Code 판·로그인)·시작·취소·목록·로그, 터미널 요청 `startTerminal`(설치 없음, D76), 연결 전 준비(`prepare`)·연결 안내 재료(`setup`) | 없으면 Claude 작업 창 없음(예전 `assistant`·`notifier` 로) |
| `instructions` | 늘 지킬 지시 읽기·쓰기(기록 폴더 `instructions.md`) | 없으면 단추 숨김 |
| `platform` | 복사·내려받기 | 선택 |

**선택 사항** (`DocBenchOptions`): `workspace` — 왼쪽 위 작업 공간 이름을 누르면 여는 메뉴(단일 HTML·앱이 폴더 열기·바꾸기·기록 자리를 둔다),
`scope` — 이 폴더 아래만 보인다(기록은 작업 공간 하나 그대로, D66), `chrome: 'embedded'` — 대시보드 탭, `host.handoff` — 보내기를 호스트가 맡는다(D68 — 셸 한 줄 `command` 와 켜진 Claude 대화용 `prompt`), `onEvent`.

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
  author, thread: [{author, text, at}],        // author = { kind: human|assistant|external, id?(계정), name?(표시 이름) }
  proposal?: { path, before, after, rationale, author, at, state: pending|applied|rejected },
  wasCollapsed?, createdAt, updatedAt }
```

- **차례**(D73): `draft`(초안 — 쓴 사람만, 디스크의 `waitingOn` 은 owner 로 읽음) → 보내면 `open`·`waitingOn: assistant`(보냄) → Claude 의 결과는 `open`·`waitingOn: owner` + `result`(볼 것) → 사람이 확인하면 `resolved`/`declined`. 화면 상단 수(초안·볼 것)와 패널 칸(초안·볼 것·보냄·끝남)이 이것으로 돈다. 남의 초안은 `isMyDraft` 로 거른다.
- **결과**(`result`): `{ kind: edit|propose|answer|ask|decline|review, at, run, change?: { docId, section?, from, to }, reverted? }` — 고침은 전·후 판을 남겨 볼 것에서 차이를 보이고 되돌린다(`planRevert` — 그 뒤 그 자리가 또 바뀌었으면 저절로 하지 않음).
- **바꿀 글**(`suggestion`): 사람이 "이렇게 바꿔"로 직접 쓴 글(고른 문구면 그 문구, 섹션이면 본문). 프롬프트에 그대로 간다.
- **앵커**: 섹션 경로로 먼저 찾고, 같은 이름 제목이면 `occurrence` → 인용문이 들어 있는 곳 순. 제목이 바뀌어 못 찾으면 "떨어진 피드백"으로 센다(지우지 않는다).
- **판 비교**: 피드백 수정은 `version` 이 같을 때만. 다르면 409 + 현재 값.
- **작성자**: 사람은 계정(`id`)으로 "내 것"을 가린다(아래 "사람"). `name` 은 쓸 때의 표시 이름이다.
- 예전(작업대 v1) 행은 `normalizeFeedback` 이 읽어서 새 모양으로 맞춘다.

## 흐름

**저장** — `save(id, md, { baseVersion })`. 판이 다르면 `DocConflictError(current)`.
화면(Editor)은 최신본에서 내 섹션이 그대로면 내 편집을 다시 얹어 저장하고, 같은 섹션이 바뀌었으면 차이를 보여 주고 "최신본에 내 편집 적용 / 내 편집 버리기" 를 고르게 한다.

**밖에서 고침** — 로컬 서버는 파일을 감시한다(큰 폴더는 아는 문서만 몇 초마다, 아래 "큰 폴더"). **따라가는 문서**(한 번이라도 연 문서 — `state.json` 에 판이 있다)가 알던 판과 다르면
이력에 `by: external` 로 남기고(바뀐 섹션 포함) SSE 로 알린다. 열려 있는 화면은 다시 읽고 바뀐 섹션에 표시를 단다. 연 적 없는 문서는 이력 없이 알리기만 한다.
CLI 가 `docbench log` 로 요약을 덧붙이면 그 이력에 합쳐진다.
CLI 가 `doc write` 로 고친 문서는 새 판을 `state.json` 에 먼저 적으므로 외부 편집이 아니다 — 대신 `changes.jsonl` 에 새로 붙은 줄의 문서를 알려 화면이 다시 읽는다(빠졌던 것을 e2e 로 재현해 고침).

**마지막으로 본 뒤** — 보기 상태에 문서별 `lastSeen`(판)을 둔다. 다시 열 때 그 판 본문(`loadVersion`)과 비교해 바뀐 섹션에 표시하고 "이 변경 이후 차이"를 보여 준다. `lastSeen` 은 **확인**을 눌러야 넘어간다(`DocView.markSeen` — 확인 전 바뀜이 있으면 그 기준을 지킨다, D77). 본 적 있는 판 본문은 기록 폴더 `blobs/` 에 둔다.

**밖에서 고친 것 따라가기** — 도구 밖(에디터·터미널의 Claude·동기화)에서 고쳐도 화면이 최신인지 보이게:
문서 머리에 "최신 · n초 전 확인"(서버는 "실시간 반영")과 **다시 읽기**(디스크와 지금 맞춰 보고 바깥 편집이면 이력에 남김), 다른 문서가 바뀌면 왼쪽 목록에 "바뀜",
단일 HTML 은 창으로 돌아오면(`focus`) 바로 확인한다. 편집하는 동안 바뀌면 내 글은 지키고 — 다른 섹션만 바뀌었으면 저장 때 최신 판에 끼우고,
같은 섹션이면 그쪽 글과 내 글의 차이를 보여 주고 "그쪽 글로 바꾸고 이어서 / 내 글 지키기"를 고르게 한다.

**바뀐 글 표시** (`ui/track.ts`) — "마지막으로 본 뒤" 바뀐 섹션마다 자기 본문(하위 섹션 제외)을 예전 판과 낱말 단위로 비교해,
더한 글은 `<ins>`(초록), 지운 글은 `<del>`(취소선)으로 그 자리에 그린다. 바뀐 곳 사이의 짧은 같은 글(문장부호·한두 글자)은 묶어
"(최대 5회)" → "— 최대 3회, …" 처럼 구절 단위로 보인다(글자 하나씩 지우고 더한 표시는 읽기 어렵다). 60% 넘게 바뀌면 "크게 바뀜"으로 섹션만 표시.
지운 글은 `.db-noindex` 라 피드백 문구 찾기·찾기에서 빠진다. 누가·언제는 이력(`changes`)에서 "본 판 → 지금 판"으로 이어지는 기록을 거슬러 찾는다
(Claude·바깥 편집·사람 이름 + 피드백 수). 위쪽 줄에 이전/다음 바뀐 곳, 표시 끄기, 줄 단위 차이, "확인"(본 판으로).

**검토 회차** (D73·D74) — 적기는 그 자리의 작은 칸(`ui/composer.ts`, 요청 / 이렇게 바꿔 / ★)이고 초안으로 저장된다. 검토 패널(`ui/panel.ts`)이 초안을 고르고 합치고, 보내기 막대가 고른 것을 **한 번에** 보낸다(`App.sendDrafts`: 초안 → 보냄, Claude 작업 하나 — 시작하지 못하면 초안으로 되돌림). 결과는 볼 것에 회차(`result.run`)별로 모인다.
"Claude 검토"(`App.requestReview`)는 종류 `review` 작업 — 제안·질문은 작성자 Claude 의 피드백으로, 읽기 정리(`ReadingPlan`)는 내 보기 상태의 접기(`folds`·`foldsBefore`·`guide`)로만 받아들인다(끝나면 바로 적용, 되돌리기 있음).
**제안 적용** — 섹션(또는 `path: []` 면 문서 전체)이 `before` 와 같으면 바로 저장, 다르면 편집기에 제안을 넣어 사람이 확인한다. 카드별 "Claude 제안" 단추는 없앴다(D78) — `assistant.propose` 는 REST 계약을 위해 남는다.

## 사람: 계정과 표시 이름 (D63)

작성자(`Person`)·보기 상태(`viewstate/<계정>.json`)·실행기 짝은 **계정**(`id`)으로 잇고, **표시 이름**(`name`)은 보여 주기만 한다 — 이름을 바꿔도 예전 피드백은 계속 "내 것"이다.
처음에 이름을 묻지 않는다.

| 화면 | 계정 | 표시 이름 |
|---|---|---|
| 단일 HTML | 브라우저(출처)마다 저절로 만든다: `u-` + 10자리 16진(localStorage `docbench:account`). 예전 판의 이름(`docbench:standalone:name`·`?name=`)이 있으면 그 이름(`safeName`)을 계정으로 이어받는다 | 같은 곳에. 오른쪽 위 "나"(또는 `?name=`)에서 바꾼다 |
| 서버·앱 | 이 PC 의 설정 `user`(폴더별 `workspaces[…].user`), 없으면 운영체제 로그인 → `safeName` | 이 PC 의 설정 `name`. "나"가 `PUT /me` 로 고친다(세션이 `identity: 'pc'` 일 때만) |
| 호스트가 사람을 정하는 대시보드 | 호스트의 `identity` 어댑터 | 바꾸지 못한다(`source: 'host'`) |

- 화면은 내 것이면 지금 표시 이름(없으면 "나"), 남의 것은 적힌 이름, 이름이 없으면 "사용자 xxxx"(계정 끝 4자)로 보인다.
- 계정은 구분이지 인증이 아니다(보안 문서). CLI 는 `assistant:Claude` 로, 사람이 쓰면 `--as human:<이름>`(계정 없이 이름만) 으로 적는다.
- **실행기 짝**: 단일 HTML 의 연결 문구가 `docbench link … --owner <계정>` 으로 이 PC 의 설정 `workspaces[<문서 폴더>].owners`(최대 20)에 계정을 적는다(`core.safeAccountId` — 모양이 틀리면 고쳐 쓰지 않고 거부).
  엔진은 그것을 15초마다 다시 읽어 심장 박동에 `owners` 로 싣는다. 화면의 `pickRunner`: 사람이 고른 것 → **내 것**(`runnerIsMine`: `owners` 에 내 계정이 있거나, 엔진의 사용자 이름이 내 계정과 같다(예전 판의 이름 = 계정) — 대소문자 무시. 표시 이름으로는 가리지 않는다)
  중 앱·실행기 먼저(서버는 뒤), Claude 를 쓸 수 있는 것, 최근 순. 남의 것은 저절로 고르지 않는다(D54).

## 큰 폴더: 펼친 폴더만 읽는다 (D64)

드라이브를 열어도 바로 뜨게. 서버(`Workspace`)와 폴더 어댑터(`FolderWorkspace`)가 같은 규칙(`core/workspace.ts`)을 쓴다.

- **열 때 훑기**(`scan`): 얕은 곳부터(너비 우선) 한도 안에서만 — 들른 항목 2만·2.5초(`SCAN_LIMITS`), 문서 `maxDocs`(2000), 깊이 12. 드라이브·홈·시스템 맨 위처럼 보이면(`looksBigRoot`:
  드라이브 문자·빈 이름, 맨 위에 `Windows`·`Program Files`·`Users`·`AppData`·`Library`·`usr` … 가 둘 이상, 또는 `$RECYCLE.BIN`·`System Volume Information`·`NTUSER.DAT`) 맨 위만 본다.
  숨김·의존성·시스템 폴더에는 들어가지 않는다. 얼마나 찾았는지는 `manifest.index`(`complete`·`docs`·`reason: big-root | many`).
- **나무**(`DocSource.tree(dir)`, REST `GET /tree?dir=`): 폴더 하나의 항목만 — 숨김·의존성·시스템 폴더와 점·`~$` 로 시작하는 파일을 빼고, 폴더 먼저 이름순(숫자는 크기순), 한 폴더 2000개(`toTreeEntries`·`TREE_MAX`).
  여기서 본 문서는 문서 목록에 더한다 — 한도 밖 깊은 곳의 문서도 열고 피드백할 수 있다. 서버는 심볼릭 링크·정션을 빼고, 실제 경로가 작업 폴더 밖이면 없는 폴더로 답한다.
- **제목**: 매니페스트 한 번에 첫 `#` 줄을 새로 읽는 것은 300개까지, 나머지는 파일 이름(다음에 채운다).
- **판은 연 문서부터**: 문서를 처음 읽을 때(`readDoc`) 판을 `state.json` 에 적는다(알던 판은 덮지 않는다). 열 때(`reconcileAll`)는 **알던 문서만** 디스크와 맞춘다 — 처음 보는 문서를 모두 읽어 해시하지 않는다.
  파일이 바뀌면 따라가는 문서는 외부 편집 이력을 남기고, 연 적 없는 문서는 이력 없이 `doc` 알림만 낸다(열지 않은 문서로 기록 폴더를 채우지 않는다).
- **감시**: 작은 폴더(다 훑었고 들른 항목 5000 이하)만 재귀 감시·통째로 다시 훑기. 큰 폴더는 통째로 감시하지 않고 아는 문서(앞 400개)의 크기·시각만 본다(서버 3초, 단일 HTML 10초).
  서버의 폴더 지도(`inventory`)도 큰 폴더에서는 두 단계까지다(단일 HTML 은 항목 수 한도 `maxInventory` 만).
- **화면**(`ui/explorer.ts`): 왼쪽 목록이 탐색기처럼 펼친 폴더만 읽어 그린다 — 폴더 → 문서(README 먼저) → 다른 파일(흐리게, 30개 넘으면 접음). 고정(`pins`)·최근(`recent`)은 위쪽 "작업 중"에,
  펼친 폴더(`open`)는 보기 상태에 둔다.

## Claude 작업 (`server/runs.mjs` · `src/core/runs.ts` · `src/core/apply.ts` · `src/ui/runs.ts`)

화면이 보낸 묶음(또는 먼저 검토)을 Claude 가 처리한다. 화면 ↔ 실행 쪽은 **기록 폴더의 파일**로만 주고받는다(서버·앱 모드는 REST 가 같은 파일을 쓴다). 실행 쪽은 둘이다:
엔진(앱·서버·실행기가 `claude -p` 를 띄움)과 **터미널 Claude**(설치 없음, D76 — 사람이 기록 폴더에서 켠 Claude Code 가 결과 파일을 남기고, 같은 계정의 화면·앱이 반영). 반영 규칙은 둘 다 `core/apply.ts`(D75).

| 파일 (기록 폴더) | 쓰는 쪽 | 내용 |
|---|---|---|
| `runs/<id>.req.json` | 화면(단일 HTML)·서버 | 요청: 종류(handoff·propose·review)·피드백 id·문서 id·섹션·목표(suggest·view)·공통 지시(`note`)·모델·노력·방식(바로 고치기·제안만)·누가(계정)·**맡을 쪽 id**(엔진 또는 `terminal:<계정>`) |
| `runs/<id>.prompt.md` · `<id>.ctx.json` | 화면·서버 | 터미널 요청의 지시(결과 모양 포함)와 반영할 때 쓸 맥락 |
| `runs/<id>.result.json` · `inbox-<이름>.result.json` | 터미널 Claude | 결과 하나 / 요청 없이 올린 제안 |
| `runs/<id>.json` | 엔진만 | 상태: queued·running(진행 단계·토큰)·done·failed·canceled, 요약(고침·제안·답·질문·보류·건너뜀·실패), 사용량(5시간 한도 몫 포함) |
| `runs/<id>.log.jsonl` | 엔진만 (덧붙임) | 로그 줄 `{at, k, v, text, ref}` — 화면 사전 `run.log.<k>` 로 그린다 |
| `runs/<id>.cancel` | 누구나 | 취소 요청 |
| `runners/<id>.json` | 엔진만 (4초마다) | 심장 박동: 종류(server·app·runner)·사용자·PC·pid·판·Claude Code 판과 안전 플래그·로그인 확인 결과·짝 계정(`owners`). 20초 소식이 없으면 꺼진 것 |

- **엔진**(`RunEngine`)은 서버(`docbench serve`, 대시보드 처리기 — id `server:<사용자>@<PC>`), DocBench 앱(작업 공간마다 하나 — `app:…`), 실행기(`docbench runner` — `runner:…`)다. 자기 id 앞으로 온 요청만 집어 **한 번에 하나씩** 돌린다(폴더를 함께 쓰는 다른 PC 의 엔진이 집어 가지 않게).
- **실행**: 문서 폴더 밖(이 PC 의 설정 폴더 아래 `work/`)에서 `claude -p --restricted --safe-mode --permission-mode dontAsk --tools Read,Grep,Glob --add-dir <문서 폴더> --strict-mcp-config --no-session-persistence --output-format stream-json --verbose --json-schema <RUN_SCHEMA> [--model] [--effort]`, 프롬프트는 표준입력.
  시작할 때 `claude --version`·`--help` 로 판과 필요한 플래그(`REQUIRED_CLAUDE_FLAGS`)를 확인하고, 없으면 실행하지 않는다(`old-claude`). 이어서 `claude auth status --json` 의 `loggedIn` 이 false 면 `not-logged-in`(그 명령이 없는 판이면 넘어간다, D69).
  확인도 문서 폴더 밖에서 하고, 실패한 확인은 1분마다 다시 한다. Windows 의 npm 설치본(`claude.cmd`)은 그 옆 `cli.js` 를 node 로 부른다.
- **프롬프트**(`buildRunPrompt`): 공통 지시·늘 지킬 지시(기록 폴더 `instructions.md`), 항목마다(★ 먼저) 피드백·인용·바꿀 글(`suggestion`)·대화·지금 섹션 글·허용 처리(`edit propose answer ask decline` 중 — 설정으로 막힌 문서는 고치기 없음, 6만 자 넘는 섹션은 답·질문·보류만)·문서 파일 경로. 문서 전체 피드백은 문서가 크지 않으면 문서 글을 넣고 `"*"`(통째로)를 허용한다. 사람·문서에서 온 글은 `<<< >>>` 경계 안의 데이터로 다룬다.
  먼저 검토는 `buildReviewPrompt` + `REVIEW_SCHEMA`(제안·질문 또는 읽기 정리), 결과 검사는 `planReview`(모르는 문서·고른 섹션 밖·깨진 글을 빼고 이유를 남김).
- **결과 검사**(`planRun`): 모르는 피드백 id 는 버리고, 허용되지 않은 처리는 질문으로, 고친 글은 `checkSectionText`(CLI `doc write` 와 같은 규칙: 같은 단계 제목 줄, 제목 그대로, 하위 섹션 보존)를 통과해야 한다. 고친 글이 비었거나 모양이 틀리면 **반영하지 않고 실패로**(피드백은 보냄 그대로 — "바꿨습니다" 회신이 실제로 반영되지 않은 채 사람에게 가지 않게). 같은 섹션을 두 번 고치면 둘째부터 제안으로, 글이 그대로면 답으로.
- **반영**(`core/apply.ts`): 고치기는 지금 판을 다시 읽어 — 그 섹션이 Claude 가 본 그대로면 지금 판에 끼워 `writeDoc`(판 비교·잠금·인코딩 보존·이력 `by: Claude`·`feedbackIds`), 사람이 그 사이 같은 섹션을 고쳤으면 **덮지 않고 제안으로**. 결과는 피드백을 닫지 않고 `result` 를 붙여 볼 것으로(판 비교, 충돌이면 다시 읽어 세 번까지). 그 사이 초안으로 되가져갔거나 닫힌 피드백은 건너뛴다.
- **터미널 요청**: 맡을 쪽이 `terminal:<계정>` — 엔진이 집지 않는다. 같은 계정의 화면(`pickupTerminal`)·앱(`pickupResults`)이 결과 파일을 보면 잠금(`lockKey.run`) 안에서 상태를 다시 보고 한 번만 반영한다. 멈춘 요청·다른 길로 이미 처리된 요청(피드백이 더는 보냄이 아님)은 저절로 닫는다.
- **로그**: stream-json 줄을 `streamEventToLog`(시작·Claude 의 말·읽음·찾음·막음·결과 정리)로 옮기고, 반영 줄은 문서·섹션·피드백으로 이어진다(화면의 "보기"). `DOCBENCH_RUN_DEBUG=1` 이면 Claude 의 결과를 `runs/<id>.out.json` 에 그대로 남긴다(문제 살펴보기용).
- **정리**: 최근 60개 작업만 남긴다. 엔진이 다시 켜지면 돌던 작업은 실패로, 줄 서 있던 요청은 다시 줄에.
- **화면**(`RunDock`): 아래 창 — 작업 목록, 실시간 로그(돌고 있는 동안 1초마다 당김), 취소, 끝나면 알림("볼 것 보기"). 모델·노력·방식은 검토 패널의 보내기 막대에서 고른다. 터미널 요청은 "터미널 기다리는 중"과 명령 다시 보기.
  엔진이 없으면 창에 **연결 안내**(D69) — 앱 없이 터미널 한 줄로도 된다고 함께 알린다: 기록 폴더가 아직 없으면 먼저 고르기 → Claude Code 에 붙여 넣을 문구(CLI 파일 주소·SHA-256·폴더 이름·이 화면의 계정 — 빌드가 같은 판으로 채운다) → 연결을 기다림.
  연결되면 하던 일을 이어 간다(바로 시작하지 않고 모델·노력을 보고 사람이 누른다). Claude Code 가 없거나 낡았거나 로그인하지 않았으면 그 이유와 명령(`claude update`·`claude auth login`)을 보여 준다. 구독 로그인 그대로 — API 키를 묻지 않는다.
  남의 실행기만 켜져 있으면 "내 것인지 확인"으로 보여 주고 사람이 고르게 한다(D54).

## 로컬 서버 (`server/`)

- 의존성 없음(선택: `iconv-lite`). Node 20+.
- **텍스트 입출력**(`textio.mjs` → 규칙은 `src/core/textcodec.ts`): BOM(UTF-8·UTF-16) → UTF-8 → 깨진 바이트가 조금 섞인 UTF-8(읽기 전용) → CP949. **다시 인코딩해 원래 바이트가 그대로 나올 때만 저장 가능**, CP949 에 없는 글자가 들어오면 저장을 막는다. 화면에는 LF 로 주고, 저장할 때 바뀌지 않은 줄은 원래 줄바꿈 그대로, 바뀐 줄은 그 자리 줄바꿈으로. 판 = 파일 바이트 sha256 앞 16자.
- **쓰기 줄 세우기**: 같은 문서·피드백 쓰기는 프로세스 안 약속 사슬 + 기록 폴더 `locks/` 잠금 파일(O_EXCL, 15초 지나면 죽은 잠금)로 한 줄로 세운 뒤 판을 다시 비교한다 — 서버와 CLI 가 동시에 써도 하나만 이긴다.
- **쓰기**: 같은 폴더 임시 파일(`.<이름>.docbench-….tmp`, 몇 ms) → rename. Windows 에서 다른 프로그램이 잡고 있으면(EPERM/EBUSY) 잠깐씩 재시도 후 직접 쓰기.
- **감시**: 작은 폴더는 `fs.watch` 재귀(Windows·macOS·Linux Node 20+), 안 되면 3초 폴링(문서·이력·피드백 폴더). 큰 폴더는 3초마다 아는 문서만(위 "큰 폴더"). 밖에 둔 기록 폴더는 따로 감시한다. 30초마다 한 번은 안전망으로 훑는다.
- **나무·나**: `GET /tree?dir=`(펼친 폴더만), `PUT /me`(표시 이름 → 이 PC 의 설정 `name`). 세션의 `features.tree`·`identity: 'pc'` 로 알린다 — 그것을 모르는 예전 서버·다른 백엔드면 화면이 예전 목록·바꿀 수 없는 이름으로 돈다(`trimBySession`).
- **Windows 빌드**: 스크립트 경로는 `fileURLToPath` 로 — `URL.pathname` 은 `/C:/…` 가 되어 `npm install` 의 빌드가 깨진다.
- **git**: 있으면 HEAD 판을 기준본으로, `git status` 를 폴더 지도 표시로.
- `createDocBenchHandler(ws, opts)` 는 `(req, res) => boolean` — Node http, Express, Fastify raw 어디에나 끼운다. `engine` 을 주면 이미 도는 엔진을 빌려 쓰고 닫을 때 끄지 않는다(앱).

## DocBench 앱 (`server/app.mjs` · `src/app-shell.ts`, D67)

이 PC 에 하나 도는 서비스가 여러 작업 공간과 그 Claude 작업을 맡는다. 폴더마다 `serve`·`runner` 를 켜지 않는다(둘은 예전 연결을 위해 남는다).

- **켜기**: `docbench app`(앞에서) · `--detach`(뒤에서, 로그 `logs/app.log`) · `--status` · `--stop` · `--open`(한 번 쓰는 열기 코드 `?c=` 붙은 주소로 브라우저 — 열쇠는 명령 줄·로그에 싣지 않는다) · `--startup on`(Windows 시작프로그램 `DocBench-app.cmd`) · `--shortcut on`(시작 메뉴 `DocBench.cmd`) · `--allow-origin <출처>`.
  `127.0.0.1:4317`(쓰이고 있으면 다음 포트, 10개까지 — `--port` 를 주면 그 포트만). 켜진 앱은 이 PC 의 설정 폴더 `app.json`(pid·포트·주소·판)에 적힌다. `--detach` 는 판이 다른 앱이 켜져 있으면 새 판으로 다시 켠다.
- **작업 공간 목록**: 이 PC 의 설정 `workspaces[<폴더>]` 중 `added`(앱에서 더함) 또는 `owners`(`docbench link` 로 이음 — 단일 HTML 의 연결 문구). 설정 파일이 바뀌면(5초마다 확인) 새 것은 켜고 빠진 것은 끈다.
  작업 공간마다 `Workspace`(더한 것은 보관함에 기록을 만들고, 이은 것은 찾기만) + `RunEngine`(kind `app`) + 처리기 `createDocBenchHandler(ws, { base: '/api/w/<id>', ui: false, engine, allowOrigins })`. id 는 폴더 경로 sha1 앞 12자(주소에 경로를 싣지 않는다).
- **앱 API**(`/api/app/*`): `info`(판·나·허용 출처·작업 공간과 Claude 상태), `browse?path=`(폴더 이름만 — 시작점은 드라이브·홈·문서·바탕 화면·OneDrive), `POST workspaces`(더하기, 아래 "범위와 합치기"), `DELETE workspaces/<id>`(앱에서 빼기 — `added`·`owners` 만 지우고 기록과 기록 짝은 그대로), `PUT me`, `POST shutdown`.
- **화면 파일**: `scripts/build.mjs` 가 `src/app-shell.ts` 를 `dist/app.js` 로 묶는다. 저장소 설치본은 `server/app-assets.mjs` 가 `dist/`·`server/static/host.js` 에서 읽고, CLI 파일 하나(`release/docbench.mjs`)는 빌드가 그 모듈을 묶어 넣은 글(`dist/app-assets.bundle.mjs`)로 바꿔 끼운다 — 파일 하나만 받아도 앱 화면이 뜬다.
- **앱 화면**(`/`): 작업 공간 메뉴(바꾸기·폴더 추가·빼기·시작하기). 폴더 추가는 고르기 창 대신 이 PC 의 폴더를 둘러보는 창(드라이브도 바로 — 펼친 곳만 읽는다). 작업 공간은 rest 어댑터(`/api/w/<id>`, SSE 실시간). 작업 공간이 없으면 시작하기.
  사람은 이 PC 의 로그인, 기록은 이 PC 의 기록 보관함(`locateData`) — 묻지 않는다. 열쇠는 열기 코드(`?c=` → `POST /api/app/redeem`)나 앱이 맞다고 한 `?t=` 로 받아 이 출처의 localStorage 에 두고 주소에서 지운다(D70, 보안 문서). 같은 폴더를 동시에 준비하면 하나만 준비하고 기다리며(엔진 하나), 이 PC 의 설정·기록 보관함을 품는 폴더는 더하지 않는다. 열쇠가 없거나 틀리면 여는 방법(`docbench app --open`)을 보여 준다.

**대시보드 탭** (`server/static/host.js` · `/embed`, D68) — 대시보드가 어떤 언어든 백엔드를 고치지 않고 탭에 꽂는다.

```js
const bench = DocBenchHost.mount(el, { root, key, scope?, theme?, lang?, view?, tokens?, app?, onTodo?, onHandoff?, onEvent? });
// → { iframe, setTheme(t), setTokens(t), navigate(view), destroy() }
```

- host.js 가 `/embed?root=…&t=<열쇠>[&scope&theme&lang]` iframe 을 만든다. embed 화면은 허용한 출처의 호스트가 보낸 `init` 을 최대 1.5초 기다린 뒤 `root` 를 작업 공간으로 더하고(이미 더한 작업 공간 안이면 그 범위로, 품는 폴더라 합치기가 필요하면 안내만) `chrome: 'embedded'`·`routing: 'none'`·`shortcuts: 'scoped'` 로 띄운다.
- 메시지(`{ docbench: 1, type }`): embed → 호스트 `hello`·`event`(줄인 이벤트: 피드백은 id·문서·상태·차례만, `todo` 할 일 수, `navigate`, `doc:saved`, `assistant:requested`, `error` 문구)·`handoff`(피드백 id·문서 경로·`terminalHandoffPrompt` 한 줄).
  호스트 → embed `init`(테마·보내기를 맡는지·처음 문서·모양 토큰)·`theme`·`tokens`·`navigate`·`handoff:result`. 호스트가 보내기를 맡지 않거나 15초 안에 답이 없으면 작업대가 스스로(Claude 작업 창·요청함) 처리한다.
- 모양 토큰은 `--db-*` 이름과 정해진 글자의 값만 받는다. 출처 검사·허용 목록은 보안 문서.

## 기록 폴더 (`src/core/workspace.ts` · `server/workspace.mjs locateData`)

문서 폴더(`.md`, 정본)와 **기록 폴더**는 따로다(D57). 기록 폴더는 둘 중 한 곳, 모양은 같다:

- **밖 (기본)**: 기록 보관함/<문서 폴더 이름>/ — 문서 폴더에는 문서만 있다. 보관함은 서버·CLI·앱에서 이 PC 의 설정 `dataHome`(없으면 `<PC 설정 폴더>/data`), 단일 HTML 에서 사람이 처음 저장할 때 고른 폴더(예: HTML 옆 `docbench-기록`). 표식 `docbench-data.json` `{ protocol, docsName, docsPath?, docs?, mergedInto? }` 가 어느 문서 폴더의 기록인지 적는다 — 브라우저는 경로를 몰라 `docsPath` 를 비워 두고(`link`·실행기 `--data`·앱에 더한 폴더가 채운다) 문서 표본 `docs`(정렬한 앞 40개)로 이름이 같은 다른 문서 폴더를 가려낸다. 같은 이름이 이미 다른 폴더의 것이면 `<이름> (2)` 를 쓴다. 보관함에는 표식 `docbench-home.json`.
- **안**: `<문서 폴더>/.docbench/` — 예전 판 폴더, 팀이 git 으로 함께 쓸 때(`init --inside`, 화면의 "문서 폴더 안에 두기"). `.gitignore` 로 캐시·개인 상태를 뺀다.

서버·CLI·앱이 찾는 순서(D58·D61): `--data`·`DOCBENCH_DATA` → 문서 폴더 안 `.docbench`(있으면 먼저 — 브라우저도 그렇게 본다) → 이 PC 의 설정 `workspaces[<문서 폴더>].data`(init·serve·앱·실행기·`docbench link` 가 적는 짝, D60 — 그 폴더가 없으면 만들지 않고 멈춘다) → 보관함/`<이름>`, `<이름> (2)` … 중 표식이 이 문서 폴더를 가리키는 것(`docsPath`, 경로가 없는 브라우저 기록은 문서 표본이 절반 이상 겹치는 것). 표식에 `mergedInto` 가 있는(넓은 작업 공간에 합쳐진) 기록은 건너뛴다(D66). CLI 는 찾기만 하고 표식도 바꾸지 않는다(`init`·`link`·`serve`·실행기·앱에 더한 폴더만 만들고 `docsPath` 를 채운다). 위로 올라가며 문서 폴더를 찾고, 기록 폴더 안에서 불렀으면 표식의 `docsPath` 로 — 단 그 문서 폴더의 기록이 정말 여기일 때만(아무 데나 놓은 표식으로 CLI 를 남의 폴더로 돌리지 못하게). 기록 폴더가 문서 폴더 안이거나 문서 폴더를 품으면 거부한다(기록의 `blobs/*.md` 가 문서로 훑힌다).

| 경로 (기록 폴더 기준) | 내용 | 안에 둘 때 커밋 |
|---|---|---|
| `config.json` | 제목·그룹·문서별 설정·알림 안내 (함께 쓰는 설정) | ✔ |
| `feedback/<id>.json` | 피드백 한 건 = 파일 하나 (충돌 적고 diff 읽기 쉬움) | 팀이 정함 |
| `changes.jsonl` | 저장 이력, 한 줄 = 한 번 | 팀이 정함 |
| `blobs/` `state.json` `viewstate/` `inbox/` `locks/` | 캐시·따라가는 문서의 판·개인 상태·요청함·잠금 | ✘ (`.docbench/.gitignore`) |
| `runs/` `runners/` | Claude 작업 요청·상태·로그, 엔진 심장 박동 | ✘ |
| `docbench-data.json` | 밖에 둘 때만: 어느 문서 폴더의 기록인지, 합쳐졌으면 어디로(`mergedInto`) | — |

실행 명령(`assistant`·`notify.command`)과 계정(`user`)·표시 이름(`name`)은 기록 폴더가 아니라 **이 PC 의 설정**(Windows `%LOCALAPPDATA%\docbench\config.json` 등 운영체제의 앱 설정 자리, `workspaces["<폴더>"]` 로 폴더별)에서만 읽는다 — 기록이 문서 폴더 안이면 git·동기화로 남과 나누기 때문(D40). 기록 자리(`dataHome`·`workspaces[…].data`), 앱의 작업 공간(`workspaces[…].added`·`owners`), 끼울 수 있는 대시보드 출처(`app.allowOrigins`)도 같은 파일에 둔다. 같은 폴더에 앱의 열쇠(`app-token`)·켜진 앱(`app.json`)·엔진 기록(`engines/`)·로그(`logs/`)·claude 작업 폴더(`work/`)가 있다.

## 작업 공간 범위와 기록 합치기 (D66)

같은 문서의 기록이 폴더를 연 높이마다 따로 생기지 않게 — 작업 공간은 넓게 한 번 열고, 좁은 곳은 **범위**(`scope`)로 본다.

- **범위**: 화면 옵션 `scope` 는 그 폴더 아래 문서·피드백만 보이게 한다(나무의 맨 위, 차례 수). 기록은 작업 공간 하나에 그대로 쌓이고, Claude 작업은 작업 공간 전체(`--add-dir <작업 공간>`)로 돈다.
- **앱**: 이미 더한 작업 공간 안의 폴더를 더하면 새로 만들지 않고 그 작업 공간 + 범위를 돌려준다. 더한 작업 공간을 품는 폴더를 더하면 합칠지 묻고(`needsMerge`), 합치면 하위 기록을 넓은 기록으로 옮기고(넓은 쪽 `changes`·`state` 잠금 안), 밖에 둔 하위 기록의 표식에 `mergedInto` 를 적고, 하위 폴더의 `added`·`data` 짝을 지운다.
- **단일 HTML**: 보관함이 붙으면(열 때 기억한 보관함, 또는 처음 저장할 때 고른 보관함) 같은 보관함에서 이 작업 공간의 하위 폴더 기록을 찾는다 — 표식의 폴더 이름과 같은 하위 폴더(3단계까지)가 있고 표식의 문서 표본 절반 이상(두 개 이상 — 표본이 하나면 하나)이 거기 있는 것. 하나씩 묻고 합친다.
  합쳐진 하위 폴더를 다시 따로 열면 새 기록으로 시작하되 예전 기록이 어디로 갔는지 알린다.
- **`core.mergeRecords(src, dst, prefix)`**: 피드백(문서 id·지도 항목 id 앞에 하위 폴더), 본문 판(`blobs`, 없을 때만), 이력(시각 순으로 섞고 같은 줄은 한 번), 알던 판(`state.json`, 없는 문서만), 보기 상태(사람별 — 넓은 쪽 값이 먼저, 고정·최근·펼친 폴더는 합침), 함께 쓰는 설정(문서별 설정·모음 — glob 앞에 하위 폴더, 넓은 쪽 먼저).
  옮기지 않는 것: Claude 작업(`runs`·`runners`)·요청함·잠금. 넓은 쪽에 같은 이름이 있으면 덮지 않고, 두 번 불러도 같다(끊기면 다시 부르면 된다). 하위 기록은 지우지 않는다.

## 서버 없는 단일 HTML (`src/standalone.ts` · `src/adapters/folder*.ts`)

`dist/docbench.html`(= 저장소 `release/docbench.html`)은 CSS·스크립트가 다 들어 있는 파일 하나다. 엣지·크롬으로 열고 문서 폴더를 고르면
**폴더 어댑터**가 File System Access API 로 그 폴더를 직접 읽고 쓴다. 디스크 모양·판(바이트 해시)·이력·잠금 파일 이름까지 서버와 같아서,
같은 폴더를 CLI·서버·앱이 이어받는다(실제 디스크에서 어댑터 ↔ CLI 왕복을 단위 시험으로 확인).

- **처음 열기**: 이름도 폴더도 묻지 않고 "시작하기" 작업 공간(메모리 — 저장하지 않음)이 뜬다(D63). 주소로 열었고 기억한 문서 폴더의 권한이 이미 있으면 그 폴더를 바로 연다(`?pick` 이면 시작하기). 작업 공간 메뉴: 폴더 열기·다시 열기·읽기만 열기·기록 자리·밖으로 옮기기·시작하기. 시작하기의 Claude 작업 창은 흉내 Claude 가 맡는다 — 되묻고, 답글의 값으로 그 섹션을 고치고, 흉내라고 밝힌다(D72).
- **고르기·기억**: 열 때는 문서 폴더만 `showDirectoryPicker` 로 고른다. 대시보드 주소(http·https)로 열면 문서 폴더와 기록 보관함 핸들을 그 출처의 IndexedDB 에 두고 다음에 묻지 않는다(권한은 브라우저가 다시 물을 수 있다). `file://` 로 열면 기억하지 않는다(D36). 다른 브라우저는 `<input webkitdirectory>` 로 읽기만.
- **기록 자리는 처음 저장할 때** (D65): 어댑터는 기록 폴더 없이(`data: null`) 시작해 읽기·둘러보기는 그대로 하고, 사람이 누른 첫 쓰기(저장·피드백·보내기·Claude 작업)에서 `ensureData` → `requestData` 로 한 번 묻는다 — 기억한 보관함 / 보관함 고르기 / 문서 폴더 안(`.docbench`).
  고른 보관함 아래 이 문서 폴더의 기록 폴더(위 "기록 폴더"의 이름 규칙)를 붙이고(`attachData` — 설정을 다시 읽고 아는 문서를 맞춘다), 취소하면 쓰지 않는다(`RecordsNeededError`). 보기 상태처럼 사람이 누르지 않은 쓰기는 묻지 않고 건너뛴다.
  보관함이 문서 폴더 자체·그 안·그것을 품은 곳이면 거부(`isSameEntry`·`resolve`), 다른 파일이 있는 폴더면 한 번 확인한다. 주소로 열었으면 고른 보관함을 기억해 다음 폴더부터는 묻지 않고 붙인다(파일로 열면 열 때마다 한 번).
  기록을 브라우저 안 저장소에 두지 않는다 — CLI·엔진이 못 읽고, `file://` 에서는 OPFS 가 막히고(SecurityError) IndexedDB 는 모든 로컬 HTML 파일이 나눠 쓴다(실측).
- **안쪽 기록**: 문서 폴더 안에 `.docbench` 가 있으면 말없이 그것을 쓰고(예전 판·팀 공유) 밖으로 옮기기를 한 번 권한다. "보관함으로 옮기기"는 먼저 화면을 내려(이 창의 판 적기·보기 상태·폴링을 멈춤) 복사 → 바이트 비교 → 안쪽 삭제(실행기가 쓰는 중이면 멈춤, "옮기는 중" 표식으로 이어 감)한 뒤 다시 연다.
- **바뀜 확인**: 감시 대신 2.5초마다(탭이 보일 때만, 한 번에 하나) 기록 폴더가 있으면 이력 파일에 새로 붙은 **완성된 줄**의 문서(이 탭이 쓴 판은 빼고)·피드백 폴더 서명·설정 파일·작업 파일을, 그리고 화면이 보고 있는 문서(`docs.focus`)를 본다. 네 번에 한 번 문서 목록: 작은 폴더는 다시 훑고 큰 폴더는 아는 문서만(위 "큰 폴더"). 서버의 이력 감시도 같은 규칙(완성된 줄만, 자기 저장 빼고).
- **줄 세우기**: 브라우저에는 O_EXCL 이 없다. 같은 이름의 잠금 파일이 없으면 내 표식을 쓰고 25ms 뒤 되읽어 그대로인지 확인한다. 그래서 문서·피드백 쓰기는 **양쪽(서버·CLI·브라우저) 모두 쓰기 직전에 판을 한 번 더 비교**한다 — 잠금이 겹치는 아주 좁은 틈에서도 한쪽은 충돌로 멈춘다.
- **이력 덧붙이기**: 브라우저에는 O_APPEND 도 없어 `changes.jsonl` 을 복사본에 덧붙여 바꿔 끼운다. 그 사이 다른 쪽이 덧붙인 줄이 사라지지 않게 서버·CLI·브라우저 모두 `changes` 잠금 안에서 덧붙인다(독립 검토에서 줄 손실 재현, 고침).
- **JSON 파일**: 메모장·PowerShell 5.1 이 붙이는 BOM 을 떼고 읽는다(서버도 같게 — `core.parseJsonText`).
- **쓰기**: `createWritable()` 은 임시(.crswap) 파일에 쓰고 닫을 때 바꿔 끼운다.
- **Claude 작업**: 페이지는 PC 프로그램을 켤 수 없으므로 이 PC 의 DocBench 앱(또는 예전 실행기 `docbench runner`)이 기록 폴더의 요청 파일을 받아 claude 를 띄운다. 연결 문구는 CLI 파일을 받아 확인하고 `link "<문서 폴더>" [--data "<기록 폴더>"] --owner <이 화면의 계정>` → `app --detach` 로 잇는다 — 짝(기록 폴더·계정)이 이 PC 의 설정에 적히고 켜진 앱이 몇 초 안에 그 폴더를 맡는다(D60·D63·D67).
  엔진 없이는 "어디로 = 터미널 한 줄"(D76): 기록 폴더에 요청·자리 파일을 쓰고 칠 한 줄을 보여 준다. 페이지는 기록 폴더의 절대 경로를 몰라 위치를 한 번 묻고(끝 폴더가 기록 폴더일 때만 받아 이 브라우저에 기억), 그 뒤로는 Claude Code deep link 단추 하나(D80). 그 전까지는 "그 폴더에서 열기"를 안내한다(Windows: 탐색기 주소창에 `pwsh`). 결과 파일은 이 페이지가 몇 초마다 보고 반영한다.
- **없는 것**: git 기준본, 요청함 알림 명령(`notify.command`).
- **CSP**: 파일 안에 `connect-src 'none'`·`img-src data: blob:`·referrer 없음 — DocBench 가 문서를 어디로도 보내지 않는 데 더해, 페이지 안에서 요청·그림으로 새는 길도 막는다. 문서 속 바깥 주소 그림은 보이지 않는다. 새 창 이동은 CSP 로 못 막는다(문서 속 스크립트는 DOMPurify 가 지운다).
- `file://` 은 보안 문맥이라 쓰기가 된다. `http://사내호스트` 는 보안 문맥이 아니어서 읽기만 된다.

## 화면

- 모든 스타일은 `.docbench` 아래 `--db-*` 토큰(우선순위 0 인 `:where()` 로 선언 — 호스트가 쉽게 덮는다). 테마는 `data-theme=light|dark|auto`.
- **호스트 CSS 차단막**: 작업대 안 요소를 `all: revert` 로 브라우저 기본값에 되돌린 뒤 작업대 규칙만 얹는다. 빌드가 `.docbench` 를 세 번 겹쳐 대시보드 전역 규칙보다 우선하게 한다(e2e 로 확인).
- 배치는 **컨테이너 쿼리**(`container: docbench`)로 정한다 — 화면 폭이 아니라 *끼워진 패널 폭*에 반응한다. 761~1099px 은 목록이 서랍, 검토 패널은 열면 문서 옆에(D77), 760px 이하면 목록·패널 모두 서랍이고 적는 칸은 아래쪽 판이 된다.
- 단축키는 기본으로 작업대에 초점이 있을 때만(`shortcuts: 'scoped'`) — 대시보드의 다른 입력과 부딪히지 않는다.
- **위쪽 줄**: 초안·볼 것 수(대시보드 탭에는 `todo` 이벤트로 — 초안·볼 것·보냄), Claude 작업, 오른쪽 위 **나**(계정과 표시 이름 — 바꿀 수 없는 화면이면 읽기만). 끼움(`chrome: 'embedded'`)은 제목 줄을 지금 문서 이름만으로 줄이고 호스트의 테마·모양 토큰을 따른다.
- **왼쪽 목록**: 맨 위는 작업 공간 이름(범위가 있으면 그 폴더도 — `workspace` 메뉴를 주면 누르면 열린다), 그 아래 도구(Claude 작업·변경 이력·폴더 지도)와 "작업 중"(고정·최근), 아래는 문서. `docs.tree` 가 있으면 탐색기(위 "큰 폴더"), 없으면 매니페스트의 `folders`(폴더 → 문서 아닌 파일 수, 훑기가 센다)로 폴더 나무 — 폴더 먼저, 문서가 없는 폴더도 흐리게(누르면 폴더 지도의 그 폴더), 문서 제목 아래 파일 이름. config.json 에 모음(groups)을 적었으면 "모음 / 폴더"를 고른다.
- **마우스를 올리면**(`ui/hover.ts`): 본문의 피드백 표시·섹션 옆 피드백 수 → 미리보기(누가·언제·차례·내용·마지막 답, Claude 처리 중), 바뀐 글·"바뀜" 표 → 누가·언제, 패널 카드 → 본문의 그 문구·섹션을 밝힌다.
- **알림 한 줄**: 글 길이만큼(최대 12초) 두고 마우스를 올리면 멈춘다. 해야 할 일이 담긴 알림은 닫을 때까지, 버튼 하나를 달 수 있다.
- 이벤트: `onEvent` 콜백과 `docbench:<type>` CustomEvent (`doc:saved`, `feedback:created`, `todo` …).
