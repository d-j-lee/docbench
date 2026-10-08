# DocBench — 이 저장소에서 일할 때

사람과 AI 가 같은 문서를 읽고·피드백하고·고치는 작업대. 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 결정은 [docs/DECISIONS.md](docs/DECISIONS.md).

## 명령

```bash
npm install          # 빌드까지 (prepare). 실행 Node 20.11+, 개발·시험 Node 22.22+
npm run typecheck    # 브라우저 TS + 서버/CLI JSDoc
npm test             # 단위(vitest) + 서버·CLI(node:test) — Claude 는 test/fixtures/fake-claude.mjs 가 대신
npm run test:e2e     # Playwright Chromium — npx playwright install chromium (한 번)
npm run check        # 전부 + release 사본·플러그인 버전 확인. 끝내기 전에 이것
npm run release      # 화면·CLI 를 고쳤으면: release/docbench.{html,mjs} + 플러그인 cli/ 갱신(함께 커밋)
claude plugin validate . && claude plugin validate ./integrations/claude-code --strict   # 스킬·플러그인을 고쳤으면
```

## 깨면 안 되는 것

- **섹션 키 패리티**: 원문(`src/core/source.ts`)과 화면(`src/ui/render.ts sectionize`)이 같은 키를 낸다. 제목·HTML 처리 규칙을 바꾸면 `test/unit/parity.test.ts` 와 `test/fixtures/tricky.md` 에 경우를 더한다.
- **바이트 보존**: 저장은 다시 인코딩해 원래 바이트가 나올 때만(`server/textio.mjs`). 바뀌지 않은 줄의 줄바꿈은 그대로. 인코딩 경로를 고치면 `test/server/encoding.test.mjs` 에 실제 파일 모양을 더한다.
- **판 비교 + 줄 세우기**: 문서·피드백 쓰기는 `Workspace.withLock`(서버·CLI) / `FolderWorkspace.withLock`(브라우저) 안에서 판을 다시 비교한다. 우회하는 쓰기 경로를 만들지 않는다.
- **한 벌의 규칙**: 바이트↔글은 `src/core/textcodec.ts`, 기록 폴더 모양은 `src/core/workspace.ts` — 서버와 단일 HTML 이 같이 쓴다. 한쪽에만 규칙을 넣지 않는다.
- **문서 폴더에는 문서만** (D57): 기록(피드백·이력·작업·잠금)은 기록 폴더에 — 기본은 문서 폴더 밖(기록 보관함/<이름>), 고른 경우만 안(`.docbench`). 기록 경로는 서버·CLI 는 `ws.dir`, 브라우저는 `FolderWorkspace.data` 로만 만든다(`<root>/.docbench` 를 직접 잇지 않는다). 기록 자리 찾기는 `server/workspace.mjs locateData` 한 곳(D58). CLI 는 기록을 찾기만 하고 만들지 않는다(`init`·`link`·`serve`·앱에 더하기만). 단일 HTML 은 처음 저장할 때 기록 자리를 묻는다(`FolderWorkspace.ensureData`, D65) — 보기만 할 때 쓰는 길을 만들지 않는다. 넓은 작업 공간으로 합친 기록(표식 `mergedInto`)은 다시 쓰지 않는다(D66).
- **단일 HTML**: `release/docbench.html` 은 `npm run release` 로만 바꾼다. 바깥으로 나가는 길 차단(CSP `connect-src 'none'`·`img-src data: blob:`)을 풀지 않는다.
- **CLI 파일 하나**: `release/docbench.mjs`·`integrations/claude-code/cli/docbench.mjs` 도 `npm run release` 로만. HTML 이 그 지문(SHA-256)과 `v<판>` 태그 주소를 담는다. 태그·Release 는 CI 가 만든다(`main` 에 새 판 → `check` 통과 → `release`) — 손으로 태그를 올리지 않는다.
- **Claude 작업은 읽기만**: 엔진(`server/runs.mjs`)이 claude 를 문서 폴더 밖에서 `--restricted --safe-mode --permission-mode dontAsk --tools Read,Grep,Glob --add-dir` 로 띄운다(`REQUIRED_CLAUDE_FLAGS` 가 없으면 실행하지 않음). 쓰기 도구·문서 폴더 cwd 를 주지 않는다 — 그 폴더의 훅·CLAUDE.md 가 실행·지시가 된다(실측, SECURITY.md). 반영은 엔진이 `planRun` → `Workspace` 로만.
- **runs 파일의 주인** (기록 폴더 `runs/`): `runs/<id>.req.json`·`.cancel` 은 화면·서버, `<id>.json`·`.log.jsonl` 은 그 요청의 `runner` 엔진만 쓴다.
- **실행 명령·사람은 이 PC 의 설정에서만**: `assistant`·`notify.command`·`user`·`name`·`workspaces[…].owners`·`added`·`app.allowOrigins` 는 문서 폴더 밖 이 PC 의 설정(`server/workspace.mjs defaultPcConfigFile` — Windows `%LOCALAPPDATA%\docbench\config.json`; `core.pcSettingsFor` → `core.mergeConfig`)에서만 읽는다. 문서 폴더 `config.json` 에서 읽는 길을 만들지 않는다. 시험은 `DOCBENCH_HOME` 을 임시 폴더로(`scripts/node-test.mjs`).
- **이력 덧붙이기는 `changes` 잠금 안에서** (브라우저는 O_APPEND 가 없다).
- **DocBench 앱의 열쇠** (D67·D70): `/` 껍데기와 `/host.js` 말고는 열쇠가 있어야 한다(`Authorization: Bearer`·`?token=`·`/embed` 의 `?t=`). 쿠키를 쓰지 않는다(포트를 가리지 않아 다른 로컬 서버로 샌다). 127.0.0.1 + Host 검사, 바꾸는 요청은 `X-DocBench`. `/embed` 를 끼울 수 있는 출처는 `app.allowOrigins` 만(frame-ancestors), host.js ↔ 화면 메시지는 그 출처·`e.source` 만, 대시보드로 가는 이벤트에 문서·피드백 본문을 싣지 않는다.
- **실행기 짝은 계정으로** (D63): 남의 앱·실행기를 저절로 고르지 않는다(`core.pickRunner` — 짝 계정 `owners` 또는 같은 이름만). 계정 id 는 모양이 맞을 때만 쓰고 고쳐 쓰지 않는다(`core.safeAccountId`).
- **큰 폴더는 펼친 곳만** (D64): 열 때 모든 문서를 읽지 않는다(`SCAN_LIMITS`·`looksBigRoot`, 나무는 `tree`). 판은 연 문서부터 적는다 — 열 때 문서를 읽어 해시하는 길을 다시 만들지 않는다.
- **AI 제안은 섹션을 자르지 않는다**: 한도를 넘으면 거부(`src/core/prompt.ts`). Claude 작업 결과도 `checkSectionText` 를 지나야 반영된다(CLI `doc write` 와 같은 안전장치).
- 브라우저 번들은 CDN 없이 돈다(의존성 번들). 서버는 의존성 0(선택: iconv-lite).

## 고칠 때

- 공개 API(`src/types.ts`, REST 계약 `docs/openapi.yaml`, CLI 명령·종료 코드)를 바꾸면 문서(README·PORTING·FEEDBACK-PROTOCOL·스킬 둘)도 같은 커밋에서 맞춘다. 문서가 코드와 다르면 그것이 버그다.
- 버전을 올리면 `integrations/claude-code/.claude-plugin/plugin.json` 의 version 과 `CHANGELOG.md` 의 그 판 절도(check 가 본다 — CI 가 그 절로 Release 를 만든다).
- 결정은 `docs/DECISIONS.md` 에 한 줄. 뒤집으면 지우지 말고 새 줄.
- 화면 문구는 `src/ui/i18n.ts` (ko·en 둘 다). 사람이 읽는 말로, 시스템 용어 대신.
- 스타일은 `.docbench` 아래 `--db-*` 토큰으로. 빌드가 선택자 우선순위를 올리므로 `.docbench` 밖 선택자를 쓰지 않는다.
- 줄바꿈은 LF(`.gitattributes`). `examples/sample-workspace/notes/**`·`test/fixtures/**` 는 바이트 그대로 둔다.
