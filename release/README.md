# release/

`docbench.html` — DocBench 를 **파일 하나**로. 서버·설치 없이 엣지·크롬으로 열고 **폴더 열기**로 문서 폴더를 고르면
그 폴더의 `.md` 를 접어 보고·피드백하고·고친다. 피드백·이력은 그 폴더의 `.docbench/` 에 남아 터미널의 Claude Code(`docbench` CLI)가 이어받는다.

- 받기: GitHub 에서 이 파일을 열고 Download(raw). 다른 파일은 필요 없다.
- 문서를 어디로도 보내지 않고, 페이지 안에서 요청·그림으로 새는 길도 막아 두었다(CSP `connect-src 'none'`·`img-src data: blob:`). 그래서 문서 속 바깥 주소 그림은 보이지 않는다.
- 처음에 이름을 적는다(피드백 작성자·보기 상태의 주인). 파일로 바로 열면 고른 폴더를 기억하지 않는다 — 같은 브라우저로 연 다른 로컬 HTML 이 꺼내 쓸 수 있어서.
- 다른 브라우저·`http://사내호스트` 에서는 읽기만 된다. 자세한 것은 저장소 README 와 `docs/ARCHITECTURE.md`.
- 이 파일은 `npm run release` 로만 만든다(`dist/docbench.html` 복사본). `npm run check` 가 빌드와 같은지 확인한다.
