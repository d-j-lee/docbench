# 제3자 구성 요소

`dist/` 번들과 `release/docbench.html` 에 아래 라이브러리가 들어 있다. 각 라이선스 전문은 `node_modules/<이름>/LICENSE*` 에 있다.

| 이름 | 버전 | 라이선스 | 쓰는 곳 |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.1.0 | MIT | 마크다운 → HTML, 섹션 위치 계산(lexer) |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | MPL-2.0 OR Apache-2.0 | 그린 HTML 정제 |
| [jsdiff (diff)](https://github.com/kpdecker/jsdiff) | 9.0.0 | BSD-3-Clause | 줄·낱말 차이 |

선택 의존성(번들 아님, 서버가 있을 때만 씀):

| 이름 | 버전 | 라이선스 | 쓰는 곳 |
|---|---|---|---|
| [iconv-lite](https://github.com/ashtuchkin/iconv-lite) | 0.7.3 | MIT | EUC-KR(CP949) 문서 저장 |

개발 전용(배포물에 들어가지 않음): esbuild, TypeScript, vitest, jsdom, Playwright, @types/node.
