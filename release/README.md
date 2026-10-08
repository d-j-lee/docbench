# release/

두 파일. 둘 다 `npm run release` 로만 만든다(`dist/` 복사본). `npm run check` 가 빌드와 같은지 확인한다.

`docbench.html` — DocBench 를 **파일 하나**로. 서버·설치 없이 엣지·크롬으로 열고 **폴더 열기**로 문서 폴더를 고르면
그 폴더의 `.md` 를 접어 보고·피드백하고·고친다. 피드백·이력은 **기록 보관함**(처음에 고르는 문서 폴더 밖 폴더 — 예: 이 HTML 옆 `docbench-기록`) 아래 문서 폴더 이름의 폴더에 남아, 터미널의 Claude Code(`docbench` CLI)·실행기가 이어받는다. 문서 폴더에는 아무것도 생기지 않는다(팀이 git 으로 함께 쓰려면 문서 폴더 안 `.docbench/` 를 고를 수도 있다).

- 받기: GitHub 에서 이 파일을 열고 Download(raw). 다른 파일은 필요 없다.
- 문서를 어디로도 보내지 않고, 페이지 안에서 요청·그림으로 새는 길도 막아 두었다(CSP `connect-src 'none'`·`img-src data: blob:`). 그래서 문서 속 바깥 주소 그림은 보이지 않는다.
- 처음에 이름을 적는다(피드백 작성자·보기 상태의 주인). 파일로 바로 열면 고른 폴더를 기억하지 않는다 — 같은 브라우저로 연 다른 로컬 HTML 이 꺼내 쓸 수 있어서.
- 다른 브라우저·`http://사내호스트` 에서는 읽기만 된다. 자세한 것은 저장소 README 와 `docs/ARCHITECTURE.md`.

`docbench.mjs` — `docbench` CLI 를 **파일 하나**로(서버·코어·iconv-lite 를 묶음, Node 20.11+ 만 있으면 돈다).

- 단일 HTML 의 **Claude 작업**(백그라운드 처리)을 돌리는 실행기: `node docbench.mjs runner "<문서 폴더>" --detach`. 화면의 Claude 작업 창이 받기·지문 확인·켜기까지 Claude Code 에 붙여 넣을 설치 문구를 준다(이 파일의 주소와 SHA-256 이 HTML 에 들어 있다).
- 터미널 Claude Code 가 피드백을 처리할 때도 같은 파일: `node docbench.mjs fb list --waiting assistant` 등. 서버(`serve`)와 `init --claude` 는 저장소판에서만.
- 주소는 판마다 고정된다: `https://raw.githubusercontent.com/d-j-lee/docbench/v<판>/release/docbench.mjs` — 그래서 판을 올리면 같은 이름의 git 태그(`v0.3.0` 등)가 있어야 한다.
