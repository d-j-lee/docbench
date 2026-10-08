---
name: docbench-feedback
description: DocBench 작업 폴더에서 사람이 남긴 문서 피드백 중 AI 차례인 것을 처리한다 — 섹션을 고치거나, 수정 제안을 올리거나, 되묻는다. 사용자가 "피드백 반영", "넘긴 거 처리", "/docbench-feedback" 이라고 하거나 넘기기 요청(docbench inbox)이 쌓였을 때 쓴다. Process DocBench document feedback waiting on the assistant.
---

# DocBench 피드백 처리

사람은 화면(대시보드 패널·`docbench serve`·단일 HTML `docbench.html`)에서 문서에 피드백을 달고, 너는 이 터미널에서 `docbench` CLI 로 같은 작업 폴더를 다룬다.
화면이 켜져 있으면 네가 고친 글이 화면에 표시된다(서버는 바로, 단일 HTML 은 몇 초 안에 — 바뀐 글을 초록·취소선으로). 꺼져 있어도 파일만으로 기록이 맞는다.

**CLI 찾기** — 처음 된 것을 쓴다:
1. `docbench` (PATH)
2. `node "${CLAUDE_PLUGIN_ROOT}/cli/docbench.mjs"` — 이 플러그인에 들어 있는 CLI 파일 하나(Node 20.11+). 이 경로가 실제 폴더로 바뀌어 있지 않으면(플러그인이 아니라 복사해 둔 스킬) 건너뛴다
3. `node "%LOCALAPPDATA%\docbench\docbench.mjs"` (macOS `~/Library/Application Support/docbench/`, Linux `~/.config/docbench/`) — 화면의 Claude 작업 실행기를 설치했으면 여기 있다
4. `node <DocBench 위치>/bin/docbench.mjs` — 대시보드에 붙였다면 보통 `vendor/docbench`
**작업 폴더와 기록 폴더**: 피드백·이력은 문서 폴더가 아니라 **기록 폴더**에 있다 — 기본은 문서 폴더 밖(기록 보관함/<문서 폴더 이름>), 예전·팀 공유 폴더는 문서 폴더 안 `.docbench`. CLI 는 현재 폴더에서 위로 문서 폴더를 찾고 기록 폴더도 스스로 찾는다(`docbench status` 가 둘 다 보여 준다). 다른 곳에서 부르면 `--root <문서 폴더>`(`DOCBENCH_ROOT`). 종료 코드 2 = 못 찾음 — 만들지 않는다:
- 브라우저(단일 HTML)로만 쓰던 폴더면 기록 짝이 아직 없다. 사용자에게 기록 보관함 위치를 물어 `docbench link "<문서 폴더>" --data "<보관함>/<문서 폴더 이름>"` 로 한 번 잇는다(그 폴더에 `docbench-data.json` 이 있다).
- 기록 폴더 안의 파일은 직접 읽거나 고치지 않는다 — 언제나 CLI 로.

**화면의 "Claude 작업"과 함께 쓸 때**: 화면이 같은 폴더의 피드백을 백그라운드 Claude 에 맡겼을 수 있다. `docbench status` 에 `실행 중`·`대기` 줄로 보이는 피드백은 건드리지 말고(그 작업이 처리한다), 사용자에게 그렇다고 알린다. 동시에 잡아도 판 비교로 한쪽만 반영되지만, 같은 일을 두 번 하게 된다.

## 순서

1. **현황**: `docbench status`(맡겨 둔 Claude 작업이 있는지도) → `docbench fb list --waiting assistant`
   `docbench inbox` 에 "넘기기" 요청이 있으면 거기 적힌 문서·`feedbackIds` 부터.
2. **한 건씩**: `docbench fb show <id>`
   - 피드백 내용·인용문·대화, 그리고 **지금 그 섹션 원문**과 줄 번호가 나온다.
   - 문서 인코딩(utf-8 / euc-kr / utf-16le), 줄바꿈(LF / CRLF), BOM 도 나온다.
3. **판단** — 셋 중 하나:
   - **바로 고친다** (요청이 분명하고 사실을 지어낼 필요가 없을 때)
     섹션 새 글을 임시 파일에 쓰고
     `docbench doc write <docId> --section "<섹션 키>" --file <임시파일> --base <show 에서 본 판> -m "<한 줄 요약>" --fb <id>`
     → `docbench fb reply <id> -m "<무엇을 바꿨는지 한 줄>" --resolve`
   - **제안만 올린다** (사람이 보고 고를 일, 범위가 큰 변경)
     `docbench fb propose <id> --file <임시파일> -m "<이유 한 줄>"` — 화면에 차이가 뜨고 사람이 적용한다.
   - **되묻는다** (정보가 없거나 요청이 모호할 때)
     `docbench fb reply <id> -m "<구체적인 질문>" --ask`
   - 하지 않는 게 맞다고 보면 이유와 함께 `--decline`.
4. **마무리**: 처리 건수와 남은 것(사람 차례로 넘긴 질문)을 사용자에게 짧게 알리고, `docbench inbox --clear` 로 요청함을 비운다.

## 지킬 것

- **섹션 단위로 고친다.** `--section` 을 쓰면 나머지 글자는 바이트 그대로 남고, 원래 인코딩·줄바꿈·BOM 으로 저장된다.
  새 섹션 글은 **제목 줄부터** 주고, 하위 섹션도 함께 준다(빠지면 멈춘다 — 지우려는 것이면 `--force`, 제목을 바꾸려면 `--rename`). `--base` 는 필수.
- **CP949·UTF-16 문서는 Edit·Write 도구로 직접 고치지 않는다** — 도구가 UTF-8 로 다시 써서 글자가 깨질 수 있다. `fb show` 에 euc-kr·utf-16le 가 보이면 반드시 `docbench doc write` 로.
  UTF-8 문서는 Edit 도구로 고쳐도 되지만(외부 편집으로 기록됨), 그때는 `docbench log <docId> -m "<요약>" --fb <id>` 로 요약을 남긴다.
- 제목 줄은 바꾸라는 요청이 없으면 그대로. 제목이 바뀌면 그 섹션에 달린 다른 피드백이 떨어져 나간다.
- 근거 표기(`[실측]` `[문서]` `[추정]` `[미확인]` 등)는 지우거나 올리지 않는다. 확인 못 한 사실은 지어내지 말고 `[미확인]` 으로 두거나 되묻는다.
- 종료 코드 3 = 그 사이 문서가 바뀜 → `fb show` 로 다시 읽고 고친다. 덮어쓰지 않는다.
- 종료 코드 4 = 읽기 전용(CP949 인데 iconv-lite 없음 등) → 사람에게 UTF-8 변환 저장(`--convert-utf8`) 여부를 묻는다.
- 섹션 키는 `docbench doc sections <docId>` 로 확인한다. 같은 이름 제목이 여럿이면 키 끝에 ` #2` 가 붙는다.
- 기록 폴더의 `feedback/*.json` 을 손으로 고치지 않는다(판 번호). 회신·제안은 `fb reply`·`fb propose` 로.
