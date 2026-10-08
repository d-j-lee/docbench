# DocBench — 이 저장소에서 일할 때

사람과 AI 가 같은 문서를 읽고·피드백하고·고치는 작업대. 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 결정은 [docs/DECISIONS.md](docs/DECISIONS.md).

## 명령

```bash
npm install          # 빌드까지 (prepare). 실행 Node 20.11+, 개발·시험 Node 22.22+
npm run typecheck    # 브라우저 TS + 서버/CLI JSDoc
npm test             # 단위(vitest) + 서버·CLI(node:test)
npm run test:e2e     # Playwright Chromium — npx playwright install chromium (한 번)
npm run check        # 전부 + release 사본·플러그인 버전 확인. 끝내기 전에 이것
npm run release      # 화면을 고쳤으면: release/docbench.html 갱신(함께 커밋)
claude plugin validate . && claude plugin validate ./integrations/claude-code --strict   # 스킬·플러그인을 고쳤으면
```

## 깨면 안 되는 것

- **섹션 키 패리티**: 원문(`src/core/source.ts`)과 화면(`src/ui/render.ts sectionize`)이 같은 키를 낸다. 제목·HTML 처리 규칙을 바꾸면 `test/unit/parity.test.ts` 와 `test/fixtures/tricky.md` 에 경우를 더한다.
- **바이트 보존**: 저장은 다시 인코딩해 원래 바이트가 나올 때만(`server/textio.mjs`). 바뀌지 않은 줄의 줄바꿈은 그대로. 인코딩 경로를 고치면 `test/server/encoding.test.mjs` 에 실제 파일 모양을 더한다.
- **판 비교 + 줄 세우기**: 문서·피드백 쓰기는 `Workspace.withLock`(서버·CLI) / `FolderWorkspace.withLock`(브라우저) 안에서 판을 다시 비교한다. 우회하는 쓰기 경로를 만들지 않는다.
- **한 벌의 규칙**: 바이트↔글은 `src/core/textcodec.ts`, `.docbench/` 디스크 모양은 `src/core/workspace.ts` — 서버와 단일 HTML 이 같이 쓴다. 한쪽에만 규칙을 넣지 않는다.
- **단일 HTML**: `release/docbench.html` 은 `npm run release` 로만 바꾼다. 바깥으로 나가는 길 차단(CSP `connect-src 'none'`·`img-src data: blob:`)을 풀지 않는다.
- **실행 명령·이름은 이 PC 의 설정에서만**: `assistant`·`notify.command`·`user` 는 문서 폴더 밖 이 PC 의 설정(`server/workspace.mjs defaultPcConfigFile` — Windows `%LOCALAPPDATA%\docbench\config.json`; `core.pcSettingsFor` → `core.mergeConfig`)에서만 읽는다. 문서 폴더 `config.json` 에서 읽는 길을 만들지 않는다. 시험은 `DOCBENCH_HOME` 을 임시 폴더로(`scripts/node-test.mjs`).
- **이력 덧붙이기는 `changes` 잠금 안에서** (브라우저는 O_APPEND 가 없다).
- **AI 제안은 섹션을 자르지 않는다**: 한도를 넘으면 거부(`src/core/prompt.ts`).
- 브라우저 번들은 CDN 없이 돈다(의존성 번들). 서버는 의존성 0(선택: iconv-lite).

## 고칠 때

- 공개 API(`src/types.ts`, REST 계약 `docs/openapi.yaml`, CLI 명령·종료 코드)를 바꾸면 문서(README·PORTING·FEEDBACK-PROTOCOL·스킬 둘)도 같은 커밋에서 맞춘다. 문서가 코드와 다르면 그것이 버그다.
- 버전을 올리면 `integrations/claude-code/.claude-plugin/plugin.json` 의 version 도(check 가 본다).
- 결정은 `docs/DECISIONS.md` 에 한 줄. 뒤집으면 지우지 말고 새 줄.
- 화면 문구는 `src/ui/i18n.ts` (ko·en 둘 다). 사람이 읽는 말로, 시스템 용어 대신.
- 스타일은 `.docbench` 아래 `--db-*` 토큰으로. 빌드가 선택자 우선순위를 올리므로 `.docbench` 밖 선택자를 쓰지 않는다.
- 줄바꿈은 LF(`.gitattributes`). `examples/sample-workspace/notes/**`·`test/fixtures/**` 는 바이트 그대로 둔다.
