# 피드백 프로토콜 — 사람과 AI 가 번갈아 두는 법

## 차례

모든 피드백은 **다음 수를 둘 쪽**을 갖는다.

| 상태 | 뜻 | 화면 표시 |
|---|---|---|
| `open` + `waitingOn: assistant` | AI 가 처리할 차례 | 초록 "Claude 차례" |
| `open` + `waitingOn: owner` | 사람이 결정·답할 차례 (AI 의 질문, 제안 검토) | 주황 "내 차례" |
| `resolved` | 반영됨 | 끝난 것 |
| `declined` | 하지 않기로 함 | 끝난 것 |

사람이 새로 달면 기본은 AI 차례, AI 가 달면 사람 차례. 화면의 "받는 쪽" 칩으로 바꿀 수 있다.

## 사람이 하는 일 (화면)

- 섹션 제목 줄의 **피드백** — 그 섹션(하위 포함) 전체가 대상. 접힌 상태로 달면 `wasCollapsed: true`.
- 글을 고르면 뜨는 **이 문구에 피드백** — 인용문(`selector`)이 붙고 본문에 밑줄로 보인다.
- 카드: **반영해**(AI 차례로) · **아니**(보류) · **해결** · **답글** · **Claude 제안**(Claude 가 수정안을 만들어 붙임 — 아래 Claude 작업).
- 제안 상자: 차이를 보고 **적용**(문서 저장 + 반영됨) 또는 **거절**(다시 AI 차례).
- 상단 **Claude에게 넘기기** — AI 차례인 것들을 Claude 작업으로 맡기거나(엔진이 없으면 그 자리에서 연결 안내 — 연결되면 이어서 맡긴다), 터미널 Claude Code 에 알린다(요청함 + 붙여 넣을 한 줄). 대시보드 탭이면 대시보드가 자기 터미널로 맡을 수 있다.
- 피드백 밑줄·배지에 마우스를 올리면 내용과 마지막 회신이 뜬다. 바뀐 글은 초록(더함)·취소선(지움)으로 그 자리에 보인다.

## Claude 작업 (백그라운드)

화면의 **Claude에게 넘기기**·**Claude 제안**은 이 PC 에 엔진(DocBench 앱 `docbench app`, 서버 `docbench serve`, 또는 예전 실행기 `docbench runner`)이 있으면 "Claude 작업"이 된다. 단일 HTML 은 연결 문구가 `docbench link <문서 폴더> [--data <기록 폴더>] --owner <화면의 계정>` 으로 이 폴더와 화면의 계정을 이 PC 의 설정에 적고 앱을 켠다 — 앱이 그 폴더의 Claude 작업을 맡는다. 엔진이 `claude -p` 를 문서 폴더 밖에서 읽기 도구만 주어 띄우고, Claude 가 돌려준 결과를 엔진이 위의 CLI 와 같은 규칙(판 비교·섹션 안전장치)으로 반영한다.

Claude 가 항목마다 돌려주는 것(`action`):

| action | 엔진이 하는 일 | 피드백 |
|---|---|---|
| `edit` | 섹션 저장(그 사이 사람이 고쳤으면 덮지 않고 제안으로) + 이력 `by: assistant` | 반영됨 + 회신 |
| `propose` | 제안을 붙인다 | 내 차례 |
| `answer` | 회신만 | 반영됨 |
| `ask` | 되묻기 | 내 차례 |
| `decline` | 회신만 | 보류 |

- "제안만" 방식이면 `edit` 도 제안으로 바뀐다. 섹션이 아닌 문서 전체 피드백은 고칠 섹션을 Claude 가 고른다(`section`).
- 고친 글이 비었거나 안전장치에 걸리면 그 항목은 **실패**로 남고 피드백은 손대지 않는다(그대로 Claude 차례).
- 그 사이 닫혔거나 사람 차례로 바뀐 피드백은 건너뛴다. 같은 피드백을 터미널 Claude 와 동시에 잡아도 판 비교로 한쪽만 반영된다.

## AI 가 하는 일 (터미널, `docbench` CLI)

```bash
docbench status                                  # 차례별 수
docbench fb list --waiting assistant [--json]    # 할 일
docbench fb show <id> [--json]                   # 피드백 + 지금 그 섹션 원문·줄 번호·인코딩
```

처리 셋 중 하나:

```bash
# 1) 바로 고치기 — 섹션만 바꾸고 나머지는 바이트 그대로, 원래 인코딩·줄바꿈으로
docbench doc write <문서> --section "<섹션 키>" --file new.md --base <판> -m "<요약>" --fb <id>
docbench fb reply <id> -m "<무엇을 바꿨는지>" --resolve

# 2) 제안만 — 사람이 화면에서 차이를 보고 적용
docbench fb propose <id> --file new.md -m "<이유>"

# 3) 되묻기
docbench fb reply <id> -m "<질문>" --ask
```

| 종료 코드 | 뜻 | 할 일 |
|---|---|---|
| 0 | 성공 | |
| 1 | 잘못된 입력·없는 문서·안전장치에 걸림(제목 줄 없음, 하위 섹션 사라짐, `--base` 없음) | 메시지 확인 |
| 2 | 작업 폴더·기록 폴더를 못 찾음 | `--root`(`DOCBENCH_ROOT`)·`--data`(`DOCBENCH_DATA`), 브라우저로 만든 기록이면 `docbench link <문서 폴더> --data <기록 폴더>`. 단일 HTML 은 처음 저장할 때 기록을 만든다 — 보기만 한 폴더에는 기록이 없다 |
| 3 | 그 사이 문서가 바뀜 | `fb show` 로 다시 읽고 고친다 |
| 4 | 읽기 전용 (EUC-KR + iconv 없음, 설정) | 사람에게 UTF-8 변환(`--convert-utf8`) 여부를 묻는다 |

**직접 편집도 된다.** 에디터·Edit 도구로 파일을 고치면 화면(서버·앱, 또는 단일 HTML 이 열려 있으면 그것)이 `by: external` 로 기록하고 바뀐 글을 문서 위에 표시한다 — 한 번이라도 연 문서만 따라간다(`fb show`·`doc show` 로 읽은 문서도). 연 적 없는 문서는 이력 없이 다시 읽기만 한다. 그 다음 `docbench log <문서> -m "<요약>" --fb <id>` 로 요약을 붙이면 같은 이력 줄에 합쳐진다.
단, **CP949·UTF-16 문서는 Edit 도구로 고치지 않는다** — UTF-8 로 다시 써서 글자가 깨질 수 있다. 그런 문서는 `doc write` 로.

**안전장치**: 섹션 쓰기(`doc write --section`, `fb propose`)는 새 글의 첫 줄이 같은 단계의 제목이어야 하고, 하위 섹션이 사라지면 멈춘다. 제목을 바꾸려면 `--rename`, 하위 섹션을 지우려면 `--force`. 입력 파일의 BOM·UTF-16 은 풀어서 받고, 깨진 글자가 있으면 거부한다.

**요청함**: 화면의 "넘기기"는 기록 폴더 `inbox/req-*.json` 을 남긴다. `docbench inbox` 로 보고, 처리한 뒤 `docbench inbox --clear`.
엔진 없이 터미널로 넘길 때 화면은 붙여 넣을 한 줄을 복사한다: `/docbench:docbench-feedback 문서 폴더 "<이름>" 의 Claude 차례 피드백을 처리해 줘.` — 기록이 밖이면 기록 보관함·기록 폴더 이름을 덧붙이고, 대시보드 탭에서 넘기면 피드백 수와 id(`… 피드백 2건(fb-…, fb-…)을 …`)를 넣는다.

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
  "status": "resolved",
  "waitingOn": "assistant",
  "author": { "kind": "human", "id": "u-3f9a0c71be", "name": "민지" },
  "thread": [{ "author": { "kind": "assistant", "name": "Claude" }, "text": "수치는 확인 못 해서 [미확인]으로 적었습니다.", "at": "…" }],
  "createdAt": "…", "updatedAt": "…"
}
```

`changes.jsonl` — 한 줄 = 한 번 저장.

```json
{"at":"…","docId":"docs/설계-노트.md","by":{"kind":"assistant","name":"Claude"},"summary":"한도 미확인 명시","fromVersion":"4f9f…","toVersion":"b298…","feedbackIds":["fb-…"],"sections":["알림 서비스 설계 노트 › 위험 › 메모"]}
```

`inbox/req-<시각>.json` — "넘기기" 요청 `{ at, count, docs, feedbackIds }`. 처리한 뒤 지운다.

`runs/` — Claude 작업. 화면이 요청을 쓰고, 엔진만 상태·로그를 쓴다. 최근 60건만 남긴다.

| 파일 | 누가 | 내용 |
|---|---|---|
| `<id>.req.json` | 화면·서버 | `{ id, kind: handoff\|propose, feedbackIds, model?, effort?, mode?: auto\|propose, by?, runner, at }` — `runner` 는 맡을 엔진 id |
| `<id>.json` | 엔진 | 상태 `queued → running → done\|failed\|canceled` + 요약(고침·제안·답·질문·보류·실패 수) |
| `<id>.log.jsonl` | 엔진(덧붙이기) | 진행 로그 한 줄씩 — 읽은 파일, 막힌 접근, 반영 결과 |
| `<id>.cancel` | 화면 | 멈춤 요청 |

`runners/<엔진>.json` — 엔진이 4초마다 고쳐 쓰는 살아 있음 표시(`id`, `kind: app|server|runner`, `user`, `host`, `owners?`(짝 지은 계정), `protocol`, `claude: { ok, version?, reason?: no-claude|old-claude|not-logged-in }`, `seenAt` …). 20초 넘게 안 바뀌면 꺼진 것으로 본다. 화면은 `owners` 에 자기 계정이 있거나 사용자 이름이 자기 계정·표시 이름과 같은 엔진만 저절로 고른다. `<엔진>.stop` 이 생기면 실행기(`runner`)가 스스로 끈다.
`runs/`·`runners/` 는 이 PC 의 상태라 공유하지 않는다(기록이 문서 폴더 안이면 `.docbench/.gitignore` 에 들어 있다).

`docbench-data.json` — 기록을 밖에 둘 때 어느 문서 폴더의 것인지 `{ protocol, docsName, docsPath?, docs?, mergedInto? }`. 브라우저는 경로를 몰라 `docsPath` 를 비워 두고(문서 표본 `docs` 로 가린다), `docbench link`(실행기 `--data`, 앱에 더한 폴더도)가 채운다. 다른 폴더를 가리키는 기록에는 이어지지 않는다. `mergedInto` 가 있으면 넓은 작업 공간의 기록으로 합쳐진 것이라 더 쓰지 않는다 — 그 문서 폴더는 넓은 쪽 기록을 쓴다.

## 지킬 것 (AI 쪽)

- 요청한 것만 바꾼다. 근거 표기(`[실측]` `[문서]` `[추정]` `[미확인]`)는 지우거나 올리지 않는다.
- 확인하지 못한 사실은 지어내지 않는다 — `[미확인]` 으로 두거나 되묻는다.
- 판이 바뀌었으면(종료 코드 3) 덮어쓰지 않는다.
- 회신은 사람이 읽는 한두 문장. 무엇을 바꿨는지, 못 한 것은 왜인지.
