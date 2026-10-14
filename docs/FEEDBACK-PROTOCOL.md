# 피드백 프로토콜 — 사람과 Claude 가 한 회차씩 주고받는 법

사람은 읽으면서 **초안**을 쌓고, 다 읽은 뒤(또는 급한 것만 먼저) **한 번에 보낸다**. Claude 가 한 일은 **볼 것**에 회차별로 모이고,
사람이 하나씩 확인·되돌리기·다시 요청을 고른다. 피드백 하나마다 대화가 오가지 않는다(D73).

## 상태

| 상태 | 뜻 | 화면 |
|---|---|---|
| `draft` | 사람이 적어 둔 메모. 아직 아무에게도 가지 않음 — 쓴 사람만 본다 | 초안 (파랑) |
| `open` + `waitingOn: assistant` | 보냄 — Claude 가 할 일 | 보냄 (초록) |
| `open` + `waitingOn: owner` | 볼 것 — Claude 의 결과·질문·제안, 사람이 확인할 차례 | 볼 것 (호박) |
| `resolved` | 사람이 확인함 | 끝남 |
| `declined` | 하지 않기로 함 | 끝남 |

- 초안은 디스크에 무엇이 적혀 있든 `waitingOn: owner` 로 읽는다 — 예전 판의 엔진·CLI 가 Claude 차례로 집어 가지 않게.
- 초안의 주인은 `drafter`(사람이 볼 것에서 초안으로 가져오거나·되돌리거나·답할 때 화면이 적는 사람 id), 없으면 마지막으로 말한 사람, 없으면 작성자. 함께 쓰는 기록 폴더에서 남의 초안은 보이지 않는다. 보내면 `drafter` 는 지워진다.
- Claude 의 결과는 **끝이 아니다**. `result` 가 붙은 채 볼 것에 남고, 닫는 것은 사람이다.

`result` — Claude 가 무엇을 했는지:

```json
{ "kind": "edit", "at": "…", "run": "run-20261009-…", "change": { "docId": "docs/런북.md", "section": "런북 › 배포", "from": "<판>", "to": "<판>" } }
```

`kind`: `edit`(바로 고침 — `change` 의 전·후 판으로 차이를 보이고 되돌린다) · `propose`(제안을 붙임) · `answer` · `ask` · `decline` · `review`(Claude 가 먼저 올린 제안·질문) · `failed`(반영하지 못함 — 까닭은 `problem`. 사람이 다시 보내거나 초안으로 가져간다). 되돌리면 `reverted` 시각이 붙고 피드백은 초안으로 돌아온다 — 다시 보내면 Claude 에게 "지난 고침을 되돌렸다"고 함께 알린다.

고치기(PATCH·`feedback.update`)는 준 키만 바꾸고, 값이 `null` 이면 그 값을 지운다(★ 끄기 = `severity: null`).

### 종류 (`category`, D85)

무엇이 문제인가로 나눈 고정 목록 — 사람과 Claude 가 같은 것을 쓴다. 화면의 **골라 보기**·**말풍선**이 이것과 `severity` 로 거른다.

| 값 | 화면 | 뜻 |
|---|---|---|
| `typo` | 오탈자 | 오타·맞춤법·띄어쓰기·표기 — 손으로 고치면 끝나는 것 |
| `fact` | 사실·수치 | 틀리거나 낡은 사실·숫자·날짜·이름 |
| `conflict` | 충돌 | 이 문서나 다른 문서의 다른 곳과 어긋남 — 용어·숫자·규칙·결정 |
| `duplicate` | 중복 | 같은 내용이 여러 곳에 |
| `gap` | 누락 | 있어야 할 것이 없음 — 빈칸·확인 안 됨·답 없는 질문·할 일 |
| `structure` | 구조 | 순서·묶음·제목, 섹션 나누기·합치기, 내용이 놓인 자리 |
| `clarity` | 표현 | 읽기 어렵거나 뜻이 갈림 — 말투·길이·어조 |
| `risk` | 위험 | 놓치면 사고가 나는 것 — 보안·법·개인정보·규정·마감·평판 |
| `direction` | 방향 | 범위·목적·전략, 전체 접근 |

- 사람은 적는 칸에서 고를 수 있다(선택). 비워 두면 Claude 가 처리하며 붙인다 — **사람이 고른 종류는 Claude 가 바꾸지 않는다**(엔진은 종류가 없는 피드백에만 `category` 를 쓴다).
- Claude 가 먼저 남기는 것(제안·질문)에는 `category` 와 `severity` 를 늘 붙인다(`high` 그대로 두면 틀리거나 해가 됨·목적을 막음 / `medium` 공유 전에 고칠 것 / `low` 하면 좋은 것).
- 예전 자유 꼬리표(`kind` — 0.1 사전 리뷰의 "사실 갱신"·"불일치" 등)는 그대로 두고, 저장된 종류가 없으면 화면이 꼬리표에서 짐작해 보인다(`categoryOf`). 짐작은 화면 표시용이라 Claude 는 저장된 `category` 가 없는 것을 "종류 없음"으로 받아 처리하며 붙인다(꼬리표는 함께 본다). 고정 목록이 아닌 `category` 값은 꼬리표로 읽는다.

## 사람이 하는 일 (화면)

- **적기**: 섹션 옆 말풍선, 글을 고르면 뜨는 **이 문구에 적기**, 위의 **문서 전체에** — 그 자리에 작은 칸이 열린다(창이 화면을 덮지 않는다).
  - **요청**: 무엇을 어떻게. 자주 쓰는 말은 단추(줄이기·쉽게·근거·표로·접기·나누기·빼기·확인만).
  - **이렇게 바꿔**: 바꿀 글을 직접 쓴다(`suggestion`) — 고른 문구면 그 문구를, 섹션이면 본문을. 요청 문구를 고민하지 않아도 된다.
  - **★ 급함**(`severity: high`): 보낼 때 맨 앞, "★만" 골라 먼저 보낼 수 있다.
  - **종류**(`category`): 고르지 않으면 보낼 때 Claude 가 붙인다.
  - Ctrl+Enter = 초안에 두기, Ctrl+Shift+Enter = 이것만 바로 보내기.
- **검토 패널**: 초안 · 볼 것 · 보냄 · 끝남.
  - 초안: 고르기(모두·★만·하나도), 고치기, 합치기(같은 곳이면 그곳, 여러 섹션이면 문서 전체로 — 답글 초안은 내 답까지, 알림에서 원래대로), 지우기(되살리기 있음).
  - 적던 글은 잃지 않는다: 다른 곳에 새로 적거나 화면을 옮기면 초안으로 남고, Esc·닫기는 적은 글이 있으면 한 번 더 눌러야 버린다. 패널의 고치던·답하던 글은 목록이 다시 그려져도 남는다.
  - 보내기 막대: **이번 묶음에 붙일 말**(`note` — 묶음 전체에 붙는 지시), 반영 방식 **바로 고치기**(기본)·**제안만**(기억함), **어디로**(아래), 모델·노력, **늘 지킬 지시**.
  - 볼 것(회차별, 전체 보기면 회차 안에서 문서별로): 고침 — 바뀐 곳·되돌리기·다시 요청·확인(문서의 바뀐 곳 표시에서도 그 섹션을 뺀다) / 제안 — 적용·답하기·거절 / 질문 — 답하기·닫기 / 못 함 — 까닭·다시 보내기·초안으로. 회차 머리에서 모두 확인·이 회차 되돌리기·요약 복사.
  - Claude 가 먼저 남긴 의견(결과 꼬리표 없이 작성자 Claude — 대화의 Claude 가 저장소에 직접 올린 것, 0.1 판의 사전 리뷰)은 한 묶음 "Claude 가 먼저 남긴 것"에 "Claude 의견"으로: **반영해**("반영해 주세요"를 붙여 내 초안으로 — 다음 묶음과 함께)·답하기·닫기. 한꺼번에 닫지 않는다(D81). 작업 회차(`result.run`) 없이 Claude 가 올린 것은 질문(`result.kind: review`)도 같은 묶음에 — 질문은 답하기·닫기(D83).
  - 위 막대의 초안·볼 것 숫자는 모든 문서의 것 — 패널 범위가 "이 문서"인데 이 문서에 없으면 누를 때 모든 문서로 연다.
  - 보냄: 맡긴 작업이 멈췄거나 취소됐으면 그 까닭과 다시 보내기.
  - 답하기·다시 요청은 초안이 된다(다음 묶음과 함께). 급하면 그 자리에서 바로 보내기.
- **Claude 검토**(먼저 말 걸기, D74): 내가 다 읽기 전에 —
  - 제안·질문 받기: 이 문서 / 지금 섹션 / 같은 폴더의 문서(최대 10개). Claude 가 올린 것은 작성자 Claude 로 볼 것에.
  - 읽기 정리: 접을 섹션·먼저 볼 섹션·안내 한 단락. **문서는 그대로**, 내 화면의 접기 상태만 바뀌고 되돌릴 수 있다. 그 문서를 보고 있으면 바로 적용, 다른 곳을 보고 있으면 끌고 가지 않고 볼 것에 남는다(적용·필요 없음). 아직 확인하지 않은 바뀐 섹션은 접지 않는다.
- **말풍선·골라 보기**(D85): 문서 위 **말풍선**(`b`)을 켜면 피드백이 문서 안 그 자리에 뜬다 — 고른 문구가 든 문단·항목·표 바로 아래, 섹션 피드백은 섹션 머리 아래(접혀도 보인다), 문서 전체는 맨 위. 누르면 패널의 그 카드로(할 일은 카드에서). **골라 보기**(깔때기)는 중요도(모두·중간 이상·높음만 — 중요도가 없으면 중간으로 친다)·종류(여럿, 미분류 포함)·끝난 것을 고르고, 말풍선·문구 표시·패널의 볼 것·보냄·끝남이 함께 따른다. 초안 칸은 늘 모두(보내기가 숨은 초안까지 보내지 않게). 고른 조건은 보기 상태(`lens`)에 남는다. 말풍선은 본문 글자가 아니다(찾기·인용·바뀐 글 표시에서 빠진다).
- 바뀐 글은 문서 위에 초록(더함)·취소선(지움)으로 보인다. "마지막으로 본 판"은 **표시 지우기**(또는 볼 것에서 그 고침을 확인)를 해야 넘어간다 — 다시 열어도 표시가 사라지지 않는다.

### 어디로 보내나

| 어디로 | 하는 일 | 준비 |
|---|---|---|
| 이 PC 의 DocBench 앱 / 서버 | 엔진이 `claude -p` 를 문서 폴더 밖에서 읽기 도구만 주어 띄우고 결과를 반영한다. 진행은 Claude 작업 창에 | `docbench app` (설치 문구 하나) 또는 `docbench serve` |
| 터미널 한 줄 (설치 없음, D76·D80) | 기록 폴더에 요청 파일을 쓰고 **Claude Code 에서 열기**(deep link — 새 터미널 창에 요청이 입력된 채로, Enter 만) · 칠 한 줄 · 켜 둔 Claude 에 "다음"을 보여 준다. Claude 가 결과 파일을 남기면 열려 있는 화면(또는 앱)이 반영한다 | Claude Code 만(대화형으로 한 번이라도 쓴 PC — deep link 가 그때 등록된다) |
| 대시보드 터미널 | 대시보드가 자기 터미널로 위의 한 줄을 실행한다(본문은 넘기지 않는다) | 대시보드 연결 |
| 요청함 | `inbox/req-*.json` 을 남기고 알린다 — 터미널에서 `/docbench:docbench-feedback` | Claude Code + 플러그인 |

## Claude 가 돌려주는 것 (엔진·터미널 공통 — `src/core/apply.ts`, D75)

보낸 묶음(`kind: handoff`)에는 항목마다 `action`:

| action | 반영 | 피드백 |
|---|---|---|
| `edit` | 섹션(또는 `section: "*"` 면 문서 전체) 저장 — 판 비교, 그 사이 사람이 같은 곳을 고쳤으면 덮지 않고 제안으로. 이력 `by: assistant` | 볼 것 + `result.edit`(전·후 판) |
| `propose` | 제안을 붙인다 | 볼 것 + `result.propose` |
| `answer` · `ask` · `decline` | 회신만 | 볼 것 + 그 `result` |

- "제안만"이면 `edit` 도 제안으로. 문서 전체 피드백은 고칠 섹션을 Claude 가 고르거나, 문서가 크지 않으면 문서 전체(`"*"`)를 고친다 — 제목 구조가 바뀌면 바로 고치지 않고 제안으로.
- 고친 글이 비었거나 안전장치에 걸리면 그 항목은 **못 함** — 문서는 그대로, 피드백은 볼 것에 `result: { kind: "failed", problem }`. Claude 가 결과에 빠뜨린 항목도 같다(`problem`: 답하지 않음). 보냄에 말없이 남지 않는다.
- 그 사이 초안으로 되가져갔거나 닫힌 피드백은 건너뛴다.
- 급한 것(★)이 프롬프트 앞에 온다. 공통 지시(`note`)와 늘 지킬 지시(기록 폴더 `instructions.md`)가 함께 간다.

먼저 검토(`kind: review`)는 `{ overview, items: [{ docId, section, kind: suggest|question, title, message, quote?, text }], view: [{ docId, fold, focus, guide }] }`:
제안은 Claude 가 본 글과 지금 글이 같을 때만 제안(전·후 글)으로 — 다르면 질문으로 바꾼다. 읽기 정리(`goal: view`)는 피드백을 만들지 않는다.

## AI 가 하는 일 (터미널, `docbench` CLI)

```bash
docbench status                                  # 보냄·볼 것·초안 수, 터미널 요청
docbench fb list --waiting assistant [--json]    # 할 일 = 사람이 보낸 것 (초안은 나오지 않는다)
docbench fb show <id> [--json]                   # 피드백 + 지금 그 섹션 원문·줄 번호·인코딩
```

처리 셋 중 하나 — 결과는 모두 사람의 "볼 것"으로 간다(닫는 것은 사람):

```bash
# 1) 바로 고치기 — 섹션만 바꾸고 나머지는 바이트 그대로, 원래 인코딩·줄바꿈으로. --fb 가 결과(전·후 판)를 붙인다
docbench doc write <문서> --section "<섹션 키>" --file new.md --base <판> -m "<요약>" --fb <id>
docbench fb reply <id> -m "<무엇을 바꿨는지>" --resolve

# 2) 제안만 — 사람이 화면에서 차이를 보고 적용 (섹션 피드백은 그 섹션, 문서 전체 피드백은 문서 전체)
docbench fb propose <id> --file new.md -m "<이유>"

# 3) 되묻기
docbench fb reply <id> -m "<질문>" --ask

# 먼저 말 걸기 — 사람이 부탁하면 제안·질문을 올린다(작성자 Claude, 볼 것)
docbench fb add --doc <문서> --section "<섹션 키>" --title "<짧은 제목>" -m "<왜>"

# 그 밖에
docbench doc new <문서> --file new.md -m "<요약>"   # 새 문서 (폴더는 있어야 한다, 있으면 종료 3)
docbench overview [--json]                          # 작업 공간 개요 — 목적·구성·폴더 역할·메타데이터·점검
docbench check [--json]                             # 팀 규칙(docbench.json)·점검 — 걸리면 종료 5 (새 문서를 만들거나 고친 뒤 확인)
```

**팀 규칙 (D90)** — 문서 폴더 맨 위 `docbench.json` 이 있으면 새 문서·앞머리·이름은 그 규칙(앞머리 키와 값 목록·이름 규칙·폴더 README)을 따른다. 규칙 파일은 사람이 정하는 문서라 Claude 는 고치지 않고(JSON — 제안만) 바꿀 점은 `fb add` 로 제안한다.

**형식마다 할 수 있는 일 (D87)** — `fb show` 가 그 문서의 형식과 함께 알려 준다. 앱의 Claude 작업과 같은 규칙이다.

| 형식 | 섹션 | Claude 가 할 수 있는 일 |
|---|---|---|
| 마크다운 · AsciiDoc · rST · Org | 제목 | 고치기(`doc write`) · 제안 |
| YAML · JSON · TOML · INI | 키·표 (`doc sections` 로 확인) | **제안만**(`fb propose`) — `doc write` 는 종료 4. 키 줄·들여쓰기를 지키고, JSON 은 저장 뒤에도 읽혀야 한다 |
| 글 · CSV/TSV · JSON Lines · Mermaid · PlantUML · Graphviz | 없음(문서 전체) | 고치기 · 제안 |
| 코드 · HTML · XML · SVG · SQL · diff · 의존성 목록(`requirements*.txt`) · `CODEOWNERS` | 없음(문서 전체) | **제안만** — 문서 전체 피드백에 `fb propose`(문서 전체 글) |
| MDX · AI 지시 파일(`CLAUDE.md`·`AGENTS.md`·`GEMINI.md`·`SKILL.md`) | 제목 | **제안만** — 다음 세션의 지시가 되는 글 |
| 로그 | 없음 | 읽고 답만(`fb reply`) |
| Word · PowerPoint · Excel · 한글(HWPX) · Jupyter | 뽑은 글의 제목 | 읽고 답만 — `doc show` 가 DocBench 가 뽑은 글을 준다(오피스·HWPX 원본은 Read 도구로 읽을 수 없다) |
| PDF · 그림 | 없음 | 읽고 답만 — 파일을 Read 도구로 직접 읽는다 |

5 MB 넘는 글은 앞 512 KB 만 읽히고(`doc show --json` 의 `truncated`) 고치지 않는다.

초안(`status: draft`)은 사람의 메모라 `fb reply`·`fb propose` 가 거부한다(종료 코드 1).

| 종료 코드 | 뜻 | 할 일 |
|---|---|---|
| 0 | 성공 | |
| 1 | 잘못된 입력·없는 문서·안전장치에 걸림(제목 줄 없음, 하위 섹션 사라짐, `--base` 없음) | 메시지 확인 |
| 2 | 작업 폴더·기록 폴더를 못 찾음 | `--root`(`DOCBENCH_ROOT`)·`--data`(`DOCBENCH_DATA`), 브라우저로 만든 기록이면 `docbench link <문서 폴더> --data <기록 폴더>`. 단일 HTML 은 처음 저장할 때 기록을 만든다 — 보기만 한 폴더에는 기록이 없다 |
| 3 | 그 사이 문서가 바뀜 | `fb show` 로 다시 읽고 고친다 |
| 4 | 읽기 전용 (EUC-KR + iconv 없음, 설정, 형식 — 뽑은 글·그림·큰 글, Claude 가 제안만 하는 형식) | 인코딩이면 사람에게 UTF-8 변환(`--convert-utf8`) 여부를 묻는다. 형식이면 `fb propose` 또는 `fb reply` |

**직접 편집도 된다.** 에디터·Edit 도구로 파일을 고치면 화면(서버·앱, 또는 단일 HTML 이 열려 있으면 그것)이 `by: external` 로 기록하고 바뀐 글을 문서 위에 표시한다 — 한 번이라도 연 문서만 따라간다(`fb show`·`doc show` 로 읽은 문서도). 연 적 없는 문서는 이력 없이 다시 읽기만 한다. 그 다음 `docbench log <문서> -m "<요약>" --fb <id>` 로 요약을 붙이면 같은 이력 줄에 합쳐진다.
단, **CP949·UTF-16 문서는 Edit 도구로 고치지 않는다** — UTF-8 로 다시 써서 글자가 깨질 수 있다. 그런 문서는 `doc write` 로.

**안전장치**: 섹션 쓰기(`doc write --section`, `fb propose`)는 새 글의 첫 줄이 같은 단계의 제목이어야 하고, 하위 섹션이 사라지면 멈춘다. 제목을 바꾸려면 `--rename`, 하위 섹션을 지우려면 `--force`. 입력 파일의 BOM·UTF-16 은 풀어서 받고, 깨진 글자가 있으면 거부한다.

**요청함**: "어디로 = 요청함"이면 기록 폴더 `inbox/req-*.json` 을 남긴다. `docbench inbox` 로 보고, 처리한 뒤 `docbench inbox --clear`.

**터미널 한 줄 (설치 없음, D76)**: 기록 폴더가 "Claude 자리"다. DocBench 가 거기에 `CLAUDE.md`(할 일·결과 쓰는 법, `@instructions.md`), `.claude/settings.json`(결과 파일 `runs/*.result.json` 만 묻지 않고 쓰기, 기록·문서 폴더 직접 편집 금지, 위 폴더의 CLAUDE.md 빼기 `claudeMdExcludes`), `instructions.md`(늘 지킬 지시)를 둔다. 보내면 `runs/<id>.req.json`·`<id>.prompt.md`(지시 + 결과 모양 + 고칠 글)·`<id>.ctx.json` 이 생기고, 화면이 한 줄을 보여 준다:

```powershell
Set-Location -LiteralPath '<기록 폴더>'; claude 'DocBench 요청 <id> 를 처리해 줘 (runs/<id>.prompt.md).'
```

기록 폴더의 절대 경로를 알면(앱·서버, 또는 단일 HTML 에 사람이 한 번 알려 준 경로 — 끝 폴더가 기록 폴더여야 받는다) 같은 일을 deep link 로: `claude-cli://open?cwd=<기록 폴더>&q=<위 요청 말>`. Claude Code 가 대화형으로 처음 쓰일 때 OS 에 등록하고(Windows `HKCU\Software\Classes\claude-cli`), 새 터미널 창에 그 폴더에서 요청을 **입력만** 해 둔다(보내기는 사람이 Enter — [공식 문서](https://code.claude.com/docs/en/deep-links)). 처음 켤 때의 신뢰 창은 기본값이 "No, exit" 이라 ↓ 로 "Yes, I trust this folder" 를 고른다. 이미 그 폴더에서 Claude 를 켜 두었으면 "다음"이라고만 하면 기다리는 요청을 오래된 것부터 처리한다(자리의 CLAUDE.md).

Claude 는 `runs/<id>.result.json` 하나만 쓴다. 같은 계정의 화면·앱이 그 파일을 보고 같은 규칙으로 반영한다. 요청 없이 스스로 올리는 제안은 `runs/inbox-<이름>.result.json`(먼저 검토 모양). 경로를 모르는 브라우저는 위치를 한 번 묻거나 그 폴더에서 열라고 안내한다(Windows: 탐색기 주소창에 `pwsh`).

**작성자 표시**: 사람 작성자는 `{ kind: "human", id: <계정>, name?: <표시 이름> }` — 화면은 계정(`id`)으로 "내 것"을 가린다. 계정은 단일 HTML 이면 그 브라우저에 저절로 만든 `u-` + 10자리 16진, 서버·앱이면 이 PC 의 설정 `user`(없으면 운영체제 로그인 이름)다. 표시 이름은 쓸 때의 별명이고 바뀔 수 있다.
CLI 는 기본으로 `assistant:Claude` 로 기록한다. 사람이 CLI 를 쓰면 `--as human:<이름>` 또는 `DOCBENCH_ACTOR=human:<이름>` — 계정 없이 이름만 적힌다.

## 섹션 키

```
$ docbench doc sections docs/설계-노트.md
    1  알림 서비스 설계 노트          ⟨알림 서비스 설계 노트⟩
   16    구조                         ⟨알림 서비스 설계 노트 › 구조⟩
   35      메모                       ⟨알림 서비스 설계 노트 › 구조 › 메모⟩
   45      메모                       ⟨알림 서비스 설계 노트 › 위험 › 메모⟩
```

- 상위 제목부터 ` › ` 로 잇는다. 같은 경로가 또 나오면 ` #2`.
- 제목 글자는 화면에 보이는 글자다(`**굵게**` → `굵게`, `&amp;` → `&`).
- 문서 맨 앞 YAML 앞머리(`---` 로 감싼 `키: 값`)는 섹션이 아니다 — 첫 제목 앞 머리말로 친다. 개요·문서 머리는 그 안의 `status`·`owner(s)`·`tags`·`review`(검토 기한) 같은 키를 메타데이터로 읽는다.
- 마크다운이 아닌 형식(D87): YAML·TOML·INI·JSON 은 키·표가 섹션이다(맨 위 키 = 2단계, 그 아래 블록 키 = 3단계 — 예 `server › tls`). YAML 은 바로 위 주석 줄이 그 키에 붙고 아래 키는 그 블록까지(뒤따르는 같은 단계 값은 위 섹션), JSON 은 값이 끝나는 줄까지가 섹션이다. 글·코드·표는 섹션이 없다(문서 전체).
- 제목을 바꾸면 그 섹션에 달린 피드백이 떨어질 수 있다(인용문이 있으면 다른 섹션에서라도 찾는다). 바꾸라는 요청이 없으면 제목 줄은 그대로 둔다.

## 파일 모양

아래 경로는 모두 **기록 폴더** 기준이다. 기록 폴더는 기본으로 문서 폴더 밖 "기록 보관함/<문서 폴더 이름>/"(표식 `docbench-data.json`), 팀이 git 으로 함께 쓰면 문서 폴더 안 `.docbench/` 다. `docbench status` 가 어디인지 보여 준다.

`feedback/<id>.json` — 한 건 = 한 파일. 손으로 고치지 말고 CLI·화면을 쓴다(판 번호 `version` 관리).

```json
{
  "id": "fb-20261008-094132-0o4i",
  "version": 2,
  "docId": "docs/설계-노트.md",
  "target": { "kind": "section", "path": ["알림 서비스 설계 노트", "위험", "메모"], "heading": "메모" },
  "selector": { "exact": "초당 한도", "prefix": "공급자 계약서의 ", "suffix": " 확인 필요" },
  "body": "한도 수치를 적어 줘. 모르면 모른다고",
  "severity": "high",
  "category": "gap",
  "status": "open",
  "waitingOn": "owner",
  "result": { "kind": "edit", "at": "…", "run": "run-20261009-101500-a1b2", "change": { "docId": "docs/설계-노트.md", "section": "알림 서비스 설계 노트 › 위험 › 메모", "from": "4f9f…", "to": "b298…" } },
  "author": { "kind": "human", "id": "u-3f9a0c71be", "name": "민지" },
  "thread": [{ "author": { "kind": "assistant", "name": "Claude" }, "text": "수치는 확인 못 해서 [미확인]으로 적었습니다.", "at": "…" }],
  "createdAt": "…", "updatedAt": "…"
}
```

`changes.jsonl` — 한 줄 = 한 번 저장.

```json
{"at":"…","docId":"docs/설계-노트.md","by":{"kind":"assistant","name":"Claude"},"summary":"한도 미확인 명시","fromVersion":"4f9f…","toVersion":"b298…","feedbackIds":["fb-…"],"sections":["알림 서비스 설계 노트 › 위험 › 메모"]}
```

`inbox/req-<시각>.json` — 요청함으로 보낸 것 `{ at, count, docs, feedbackIds, note? }`. 처리한 뒤 지운다.

`runs/` — Claude 작업. 화면이 요청을 쓰고, 상태·로그는 그 요청의 `runner` 만 쓴다(터미널 요청이면 같은 계정의 화면·앱). 최근 60건만 남긴다.

| 파일 | 누가 | 내용 |
|---|---|---|
| `<id>.req.json` | 화면·서버 | `{ id, kind: handoff\|propose\|review, feedbackIds, docIds?, sections?, goal?: suggest\|view, note?, model?, effort?, mode?: auto\|propose, by?, runner, at }` — `runner` 는 맡을 엔진 id 또는 `terminal:<계정>` |
| `<id>.json` | runner | 상태 `queued → running → done\|failed\|canceled` + 요약(고침·제안·답·질문·보류·올림·실패 수), `overview?`, `created?`(올린 피드백 id), `view?`(읽기 정리) |
| `<id>.log.jsonl` | runner(덧붙이기) | 진행 로그 한 줄씩 — 읽은 파일, 막힌 접근, 반영 결과 |
| `<id>.cancel` | 화면 | 멈춤 요청 |
| `<id>.prompt.md` · `<id>.ctx.json` | 화면·서버 | 터미널 요청의 지시와 반영할 때 쓸 맥락 |
| `<id>.result.json` · `inbox-<이름>.result.json` | 터미널 Claude | 결과 하나(위 모양) |

`runners/<엔진>.json` — 엔진이 4초마다 고쳐 쓰는 살아 있음 표시(`id`, `kind: app|server|runner`, `user`, `host`, `owners?`(짝 지은 계정), `protocol`(지금 2 — 초안·볼 것 규칙. 1 인 예전 엔진에는 맡기지 않고 "앱을 새 판으로"라고 안내), `claude: { ok, version?, reason?: no-claude|old-claude|not-logged-in }`, `seenAt` …). 20초 넘게 안 바뀌면 꺼진 것으로 본다. 화면은 `owners` 에 자기 계정이 있거나 사용자 이름이 자기 계정·표시 이름과 같은 엔진만 저절로 고른다. `<엔진>.stop` 이 생기면 실행기(`runner`)가 스스로 끈다.
`runs/`·`runners/` 는 이 PC 의 상태라 공유하지 않는다(기록이 문서 폴더 안이면 `.docbench/.gitignore` 에 들어 있다).

`docbench-data.json` — 기록을 밖에 둘 때 어느 문서 폴더의 것인지 `{ protocol, docsName, docsPath?, docs?, mergedInto? }`. 브라우저는 경로를 몰라 `docsPath` 를 비워 두고(문서 표본 `docs` 로 가린다), `docbench link`(실행기 `--data`, 앱에 더한 폴더도)가 채운다. 다른 폴더를 가리키는 기록에는 이어지지 않는다. `mergedInto` 가 있으면 넓은 작업 공간의 기록으로 합쳐진 것이라 더 쓰지 않는다 — 그 문서 폴더는 넓은 쪽 기록을 쓴다.

## 지킬 것 (AI 쪽)

- 초안은 건드리지 않는다. 결과는 볼 것으로 — 피드백을 닫지 않는다(닫는 것은 사람).
- 요청한 것만 바꾼다. 근거 표기(`[실측]` `[문서]` `[추정]` `[미확인]`)는 지우거나 올리지 않는다.
- 확인하지 못한 사실은 지어내지 않는다 — `[미확인]` 으로 두거나 되묻는다.
- 판이 바뀌었으면(종료 코드 3) 덮어쓰지 않는다.
- 회신은 사람이 읽는 한두 문장. 무엇을 바꿨는지, 못 한 것은 왜인지.
- 설정·코드 파일은 제안으로, 뽑은 글·로그·그림은 답으로 — 형식의 한도를 우회해 Edit 도구로 고치지 않는다(터미널 자리가 막는다).
