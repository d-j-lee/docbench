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
- 카드: **반영해**(AI 차례로) · **아니**(보류) · **해결** · **답글** · **Claude 제안**(헤드리스 AI 가 수정안을 만듦).
- 제안 상자: 차이를 보고 **적용**(문서 저장 + 반영됨) 또는 **거절**(다시 AI 차례).
- 상단 **Claude에게 넘기기** — AI 차례인 것들을 터미널에 알린다.

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
| 2 | 작업 폴더(.docbench)를 못 찾음 | `--root` 또는 `DOCBENCH_ROOT` |
| 3 | 그 사이 문서가 바뀜 | `fb show` 로 다시 읽고 고친다 |
| 4 | 읽기 전용 (EUC-KR + iconv 없음, 설정) | 사람에게 UTF-8 변환(`--convert-utf8`) 여부를 묻는다 |

**직접 편집도 된다.** 에디터·Edit 도구로 파일을 고치면 서버가 `by: external` 로 기록하고 화면에 바뀐 섹션을 띄운다. 그 다음 `docbench log <문서> -m "<요약>" --fb <id>` 로 요약을 붙이면 같은 이력 줄에 합쳐진다.

**안전장치**: 섹션 쓰기(`doc write --section`, `fb propose`)는 새 글의 첫 줄이 같은 단계의 제목이어야 하고, 하위 섹션이 사라지면 멈춘다. 제목을 바꾸려면 `--rename`, 하위 섹션을 지우려면 `--force`. 입력 파일의 BOM·UTF-16 은 풀어서 받고, 깨진 글자가 있으면 거부한다.

**요청함**: 화면의 "넘기기"는 `.docbench/inbox/req-*.json` 을 남긴다. `docbench inbox` 로 보고, 처리한 뒤 `docbench inbox --clear`.

**작성자 표시**: CLI 는 기본으로 `assistant:Claude` 로 기록한다. 사람이 CLI 를 쓰면 `--as human:<이름>` 또는 `DOCBENCH_ACTOR=human:<이름>`.

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

`.docbench/feedback/<id>.json` — 한 건 = 한 파일. 손으로 고치지 말고 CLI·화면을 쓴다(판 번호 `version` 관리).

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
  "author": { "kind": "human", "name": "민지" },
  "thread": [{ "author": { "kind": "assistant", "name": "Claude" }, "text": "수치는 확인 못 해서 [미확인]으로 적었습니다.", "at": "…" }],
  "createdAt": "…", "updatedAt": "…"
}
```

`.docbench/changes.jsonl` — 한 줄 = 한 번 저장.

```json
{"at":"…","docId":"docs/설계-노트.md","by":{"kind":"assistant","name":"Claude"},"summary":"한도 미확인 명시","fromVersion":"4f9f…","toVersion":"b298…","feedbackIds":["fb-…"],"sections":["알림 서비스 설계 노트 › 위험 › 메모"]}
```

`.docbench/inbox/req-<시각>.json` — "넘기기" 요청 `{ at, count, docs, feedbackIds }`. 처리한 뒤 지운다.

## 지킬 것 (AI 쪽)

- 요청한 것만 바꾼다. 근거 표기(`[실측]` `[문서]` `[추정]` `[미확인]`)는 지우거나 올리지 않는다.
- 확인하지 못한 사실은 지어내지 않는다 — `[미확인]` 으로 두거나 되묻는다.
- 판이 바뀌었으면(종료 코드 3) 덮어쓰지 않는다.
- 회신은 사람이 읽는 한두 문장. 무엇을 바꿨는지, 못 한 것은 왜인지.
