# 제3자 구성 요소

`dist/` 번들과 `release/` 의 두 파일에 아래 라이브러리가 들어 있다. 각 라이선스 전문은 `node_modules/<이름>/LICENSE*` 에 있다.

| 이름 | 버전 | 라이선스 | 쓰는 곳 | 들어 있는 파일 |
|---|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.1.0 | MIT | 마크다운 → HTML, 섹션 위치 계산(lexer) | 화면 번들·`docbench.html`·`core.mjs`·`docbench.mjs` |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | MPL-2.0 OR Apache-2.0 | 그린 HTML 정제 | 화면 번들·`docbench.html` |
| [jsdiff (diff)](https://github.com/kpdecker/jsdiff) | 9.0.0 | BSD-3-Clause | 줄·낱말 차이, 바뀐 글 표시 | 화면 번들·`docbench.html`·`core.mjs`·`docbench.mjs` |
| [iconv-lite](https://github.com/ashtuchkin/iconv-lite) | 0.7.3 | MIT | EUC-KR(CP949) 문서 저장 | `docbench.mjs`(CLI 파일 하나) |
| [safer-buffer](https://github.com/ChALkeR/safer-buffer) | 2.1.2 | MIT | iconv-lite 가 씀 | `docbench.mjs` |

저장소에서 서버·CLI(`server/`·`bin/`)를 그대로 쓸 때 iconv-lite 는 선택 의존성이다(묶지 않고 있으면 쓴다).

개발 전용(배포물에 들어가지 않음): esbuild, TypeScript, vitest, jsdom, Playwright, @types/node.
