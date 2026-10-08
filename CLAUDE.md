# DocBench — 이 저장소에서 일할 때

사람과 AI 가 같은 문서를 읽고·피드백하고·고치는 작업대. 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 결정은 [docs/DECISIONS.md](docs/DECISIONS.md).

## 명령

```bash
npm install          # 빌드까지 (prepare). Node 20+
npm run typecheck    # 브라우저 TS + 서버/CLI JSDoc
npm test             # 단위(vitest) + 서버·CLI(node:test)
npm run test:e2e     # Playwright Chromium — npx playwright install chromium (한 번)
npm run check        # 전부. 끝내기 전에 이것
```

## 깨면 안 되는 것

- **섹션 키 패리티**: 원문(`src/core/source.ts`)과 화면(`src/ui/render.ts sectionize`)이 같은 키를 낸다. 제목·HTML 처리 규칙을 바꾸면 `test/unit/parity.test.ts` 와 `test/fixtures/tricky.md` 에 경우를 더한다.
- **바이트 보존**: 저장은 다시 인코딩해 원래 바이트가 나올 때만(`server/textio.mjs`). 바뀌지 않은 줄의 줄바꿈은 그대로. 인코딩 경로를 고치면 `test/server/encoding.test.mjs` 에 실제 파일 모양을 더한다.
- **판 비교 + 줄 세우기**: 문서·피드백 쓰기는 `Workspace.withLock` 안에서 판을 다시 비교한다. 우회하는 쓰기 경로를 만들지 않는다.
- **AI 제안은 섹션을 자르지 않는다**: 한도를 넘으면 거부(`src/core/prompt.ts`).
- 브라우저 번들은 CDN 없이 돈다(의존성 번들). 서버는 의존성 0(선택: iconv-lite).

## 고칠 때

- 공개 API(`src/types.ts`, REST 계약 `docs/openapi.yaml`, CLI 명령·종료 코드)를 바꾸면 문서(README·PORTING·FEEDBACK-PROTOCOL·SKILL)도 같은 커밋에서 맞춘다. 문서가 코드와 다르면 그것이 버그다.
- 결정은 `docs/DECISIONS.md` 에 한 줄. 뒤집으면 지우지 말고 새 줄.
- 화면 문구는 `src/ui/i18n.ts` (ko·en 둘 다). 사람이 읽는 말로, 시스템 용어 대신.
- 스타일은 `.docbench` 아래 `--db-*` 토큰으로. 빌드가 선택자 우선순위를 올리므로 `.docbench` 밖 선택자를 쓰지 않는다.
- 줄바꿈은 LF(`.gitattributes`). `examples/sample-workspace/notes/**`·`test/fixtures/**` 는 바이트 그대로 둔다.
