# DocBench

사람과 AI가 같은 문서를 **읽고 · 피드백하고 · 고치고 · 기록**하는 작업대.

- **보기**: 제목 깊이별 접기(상태 기억), 근거 표기 칩(`[실측]` `[추정]` …), 빈칸 형광, 이름표 거르기, 찾기, 개요
- **피드백**: 섹션·접힌 덩어리·고른 문구에 단다. 카드마다 "누구 차례"(사람 / AI)가 있고 대화가 이어진다
- **편집**: 섹션 단위 편집 → 미리보기 → 차이 → 저장. 그 사이 바뀌었으면 다른 섹션은 자동 재적용, 같은 섹션은 차이를 보여 주고 고르게 한다
- **AI**: 피드백에 대한 수정 제안을 받아 차이로 보고 적용·거절. 터미널의 Claude Code 는 CLI 로 같은 피드백을 처리한다
- **기록**: 누가 어느 섹션을 바꿨는지 이력, 마지막으로 본 뒤 바뀐 섹션 표시, 커밋본(git HEAD) 대비 차이, 폴더 지도

문서 원본은 언제나 **작업 폴더의 `.md` 파일**이다. 피드백·이력은 그 옆 `.docbench/` 에 사람도 읽을 수 있는 JSON 으로 남는다.

![흐름](docs/flow.svg)

## 세 가지 쓰는 법

| | 언제 | 어떻게 |
|---|---|---|
| **로컬 작업 폴더** | 내 PC 의 문서 폴더를 바로 | `node bin/docbench.mjs serve <폴더>` → 브라우저 |
| **웹 대시보드에 끼우기** | 사내 대시보드의 패널로 | `<doc-bench api="/docbench/api">` + 서버 처리기 끼우기 → [docs/PORTING.md](docs/PORTING.md) |
| **claude.ai 아티팩트** | 로컬 없이 공유·코멘트 | `createArtifactAdapters()` → [docs/claude-artifact.md](docs/claude-artifact.md) |

화면 코드는 셋 다 같다. 저장소·인증·AI 연결만 **어댑터**로 갈아 끼운다([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## 빠르게 켜 보기

```bash
npm install                                             # 빌드(dist/)까지 한다 — Node 20 이상
node bin/docbench.mjs serve examples/sample-workspace   # → http://127.0.0.1:4317/
```

예제 폴더에는 일부러 까다로운 문서(같은 이름 제목, `9/29~10/2` 물결표, UTF-8 BOM+CRLF, EUC-KR)가 들어 있다.

## 사람 ↔ Claude Code 한 바퀴

```
사람 (브라우저)                         Claude Code (터미널)
───────────────                         ────────────────────
섹션에 피드백 "근거 보강해"   ──파일──▶  docbench fb list --waiting assistant
                                         docbench fb show <id>        # 피드백 + 지금 섹션 원문
                                         docbench doc write <문서> --section "<키>" --base <판> --file new.md --fb <id>
화면에 '바뀐 섹션' 표시      ◀──감시──   docbench fb reply <id> -m "보강함" --resolve
카드가 '반영됨' 으로
```

- 작업 폴더에 `docbench init . --claude` 를 하면 Claude Code 스킬 `/docbench-feedback` 이 깔린다([integrations/claude-code](integrations/claude-code)).
- 화면의 **"Claude에게 넘기기"** 는 `.docbench/inbox/` 에 요청을 남기고, 설정하면 명령을 실행해 터미널을 깨운다.
- 화면의 **"Claude 제안"** 은 서버가 `claude -p` 를 헤드리스로 부른다. 구독 로그인을 그대로 쓰며 API 키가 필요 없다(설정: [docs/PORTING.md](docs/PORTING.md#ai-제안-켜기)).

## CLI

```
docbench serve [폴더] [--port 4317] [--token T] [--allow-origin URL]
docbench init [폴더] [--claude]
docbench status [--json]
docbench fb list|show|add|reply|propose …
docbench doc list|sections|show|write …
docbench log <문서> -m 요약 [--fb id]
docbench inbox [--clear]
```

모든 명령은 `--json` 으로 기계가 읽기 좋은 출력을 낸다. 작업 폴더는 `--root` → `DOCBENCH_ROOT` → 현재 폴더에서 위로 `.docbench` 순으로 찾고, 없으면 만들지 않고 종료 코드 2.
판이 바뀐 사이 쓰기를 시도하면 3, 읽기 전용이면 4. 섹션 쓰기는 판(`--base`)이 필수이고, 제목 줄이 바뀌거나 하위 섹션이 사라지면 멈춘다. 자세한 흐름은 [docs/FEEDBACK-PROTOCOL.md](docs/FEEDBACK-PROTOCOL.md).

## 저장소 지도

```
src/core/        DOM 없는 핵심 — 섹션 키·범위, 문구 앵커, 피드백 모델, 차이, AI 프롬프트 (서버·CLI 와 공유)
src/ui/          화면 — 컨테이너 쿼리 기반이라 어떤 패널 폭에도 맞는다
src/adapters/    memory · rest · claude-artifact
src/element.ts   <doc-bench> 웹 컴포넌트
server/          로컬 작업 폴더 서버 (의존성 0, Node 20+) — 인코딩·줄바꿈 보존, 감시, SSE
bin/docbench.mjs CLI
integrations/    Claude Code 스킬
examples/        sample-workspace(까다로운 예제 문서) · dashboard-embed(대시보드 끼우기, PORTING §3-C) · react(래퍼) · claude-artifact(아티팩트 한 장 만들기)
docs/            설계·이식·보안·REST 계약(openapi.yaml)·결정 기록
test/            단위(vitest) · 서버(node:test) · 브라우저 e2e(Playwright)
```

## 개발

```bash
npm run typecheck   # 브라우저 TS + 서버/CLI JSDoc
npm test            # 단위 + 서버
npm run test:e2e    # Chromium 필요: npx playwright install chromium
npm run check       # 전부
```

빌드 결과물: `dist/docbench.js`(ESM), `dist/docbench.iife.js`(전역 `DocBench`), `dist/docbench.css`, `dist/core.mjs`(서버·CLI), `dist/types/`.
marked·DOMPurify·jsdiff 는 번들에 들어 있어 사내망·엄격한 CSP 에서도 CDN 없이 돈다([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## 파일 모양 보존

| 파일 | 읽기 | 저장 |
|---|---|---|
| UTF-8 (BOM 유무) | ✔ | ✔ 바이트 그대로 (BOM 유지) |
| UTF-16LE (BOM, PowerShell 5.1 기본) | ✔ | ✔ |
| CP949 / EUC-KR | ✔ (`iconv-lite` 있으면 확장 음절까지) | ✔ 다시 인코딩해 원래 바이트가 그대로 나올 때만. CP949 에 없는 글자(— ✅ 등)를 넣으면 막고 UTF-8 변환을 묻는다 |
| 깨진 바이트가 섞인 UTF-8, UTF-16BE | ✔ | ✘ 읽기 전용 (사람이 동의하면 UTF-8 로 정리해 저장) |
| CRLF·LF (섞여 있어도) | 화면은 LF | 손대지 않은 줄은 원래 줄바꿈 그대로, 바뀐 줄은 그 자리의 줄바꿈 |

## 알려진 한계

- 섹션은 마크다운 **제목** 단위다. 제목이 없는 긴 문서는 문서 전체 편집만 된다. 문서에 HTML 로 쓴 `<h2>` 나 `<details>` 안의 제목은 섹션이 아니다(화면과 원문이 같은 규칙).
- AI 제안은 6만 자 이하 섹션만 — 더 크면 하위 섹션에 피드백을 달라고 안내한다(잘라 보내 나머지를 지우는 일을 막는다).
- 동시 편집은 낙관적 잠금(판 비교) + 같은 문서 쓰기 줄 세우기(프로세스 안·서버와 CLI 사이 잠금 파일)다. 실시간 공동 타이핑(CRDT)은 하지 않는다.
