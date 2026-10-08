# 구조

## 층

```
┌ src/ui ─────────────────────────────────────────────┐
│ App ─ DocView(접기·앵커·개요) ─ Editor ─ Panel ─ Dialogs │  화면. 어댑터 인터페이스만 안다
└───────────────▲─────────────────────────────────────┘
                │ DocBenchAdapters (src/types.ts)
┌ src/adapters ─┴─────────────────────────────────────┐
│ memory          rest(→ docs/openapi.yaml)   claude-artifact │
└───────────────▲─────────────────────────────────────┘
                │
┌ src/core ─────┴──── DOM 없음 · 서버/CLI 와 공유(dist/core.mjs) ┐
│ source(섹션 키·범위) selectors(문구 앵커) feedback diff prompt │
└───────────────────────────────────────────────────────┘
```

**어댑터** (src/types.ts) — 화면이 바깥에 기대는 것 전부.

| 어댑터 | 하는 일 | 필수 |
|---|---|---|
| `docs: DocSource` | 매니페스트, 문서 읽기·저장(판 비교), 특정 판·기준본, 이력, 폴더 지도, 변경 알림 | ✔ (`save` 없으면 읽기 전용) |
| `feedback: FeedbackStore` | 구독·생성·수정(판 비교)·삭제 | ✔ |
| `viewState` | 접기·깊이·마지막으로 본 판 (사람별) | 없으면 브라우저에만 |
| `identity` | 나, 권한(`doc.edit` `feedback.*` `assistant.*`) | 없으면 전부 허용 |
| `assistant` | 섹션 + 피드백 → 수정 제안 | 없으면 버튼 숨김 |
| `notifier` | "AI 에게 넘기기" | 없으면 버튼 숨김 |
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

**마지막으로 본 뒤** — 보기 상태에 문서별 `lastSeen`(판)을 둔다. 다시 열 때 그 판 본문(`loadVersion`)과 비교해 바뀐 섹션에 표시하고 "이 변경 이후 차이"를 보여 준다. 로컬 서버는 본 적 있는 판 본문을 `.docbench/blobs/` 에 둔다.

**AI 제안** — 패널이 섹션 원문 + 피드백으로 `assistant.propose` 를 부른다. 응답은 `{ after, rationale }` 하나(`core/prompt.ts` 의 스키마, 머리줄이 사라지면 거부). 제안은 피드백의 `proposal` 로 저장되고 사람 차례가 된다. 적용 때 섹션이 `before` 와 같으면 바로 저장, 다르면 편집기에 제안을 넣어 사람이 확인한다.

## 로컬 서버 (`server/`)

- 의존성 없음(선택: `iconv-lite`). Node 20+.
- **텍스트 입출력**(`textio.mjs`): BOM(UTF-8·UTF-16) → UTF-8 → 깨진 바이트가 조금 섞인 UTF-8(읽기 전용) → CP949. **다시 인코딩해 원래 바이트가 그대로 나올 때만 저장 가능**, CP949 에 없는 글자가 들어오면 저장을 막는다. 화면에는 LF 로 주고, 저장할 때 바뀌지 않은 줄은 원래 줄바꿈 그대로, 바뀐 줄은 그 자리 줄바꿈으로. 판 = 파일 바이트 sha256 앞 16자.
- **쓰기 줄 세우기**: 같은 문서·피드백 쓰기는 프로세스 안 약속 사슬 + `.docbench/locks/` 잠금 파일(O_EXCL, 15초 지나면 죽은 잠금)로 한 줄로 세운 뒤 판을 다시 비교한다 — 서버와 CLI 가 동시에 써도 하나만 이긴다.
- **쓰기**: 같은 폴더 임시 파일 → rename. Windows 에서 다른 프로그램이 잡고 있으면(EPERM/EBUSY) 잠깐씩 재시도 후 직접 쓰기.
- **감시**: `fs.watch` 재귀(Windows·macOS·Linux Node 20+), 안 되면 3초 폴링.
- **git**: 있으면 HEAD 판을 기준본으로, `git status` 를 폴더 지도 표시로.
- `createDocBenchHandler(ws, opts)` 는 `(req, res) => boolean` — Node http, Express, Fastify raw 어디에나 끼운다.

`.docbench/` 구성:

| 경로 | 내용 | 커밋 |
|---|---|---|
| `config.json` | 제목·그룹·문서별 설정·AI 연결·알림 | ✔ |
| `feedback/<id>.json` | 피드백 한 건 = 파일 하나 (충돌 적고 diff 읽기 쉬움) | 팀이 정함 |
| `changes.jsonl` | 저장 이력, 한 줄 = 한 번 | 팀이 정함 |
| `blobs/` `state.json` `viewstate/` `inbox/` | 캐시·개인 상태·요청함 | ✘ (`.docbench/.gitignore`) |

## 화면

- 모든 스타일은 `.docbench` 아래 `--db-*` 토큰(우선순위 0 인 `:where()` 로 선언 — 호스트가 쉽게 덮는다). 테마는 `data-theme=light|dark|auto`.
- **호스트 CSS 차단막**: 작업대 안 요소를 `all: revert` 로 브라우저 기본값에 되돌린 뒤 작업대 규칙만 얹는다. 빌드가 `.docbench` 를 세 번 겹쳐 대시보드 전역 규칙보다 우선하게 한다(e2e 로 확인).
- 배치는 **컨테이너 쿼리**(`container: docbench`)로 정한다 — 화면 폭이 아니라 *끼워진 패널 폭*에 반응한다. 1099px 이하면 피드백 패널이, 760px 이하면 목록이 서랍이 된다.
- 단축키는 기본으로 작업대에 초점이 있을 때만(`shortcuts: 'scoped'`) — 대시보드의 다른 입력과 부딪히지 않는다.
- 이벤트: `onEvent` 콜백과 `docbench:<type>` CustomEvent (`doc:saved`, `feedback:created` …).
