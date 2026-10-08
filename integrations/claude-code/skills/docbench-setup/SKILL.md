---
name: docbench-setup
description: DocBench(사람과 AI 가 같은 마크다운 문서를 접어 보고·피드백하고·고치는 작업대)를 지금 이 웹 대시보드나 로컬 문서 폴더에 붙이거나 갱신한다. 기본은 이 PC 의 DocBench 앱을 켜고 host.js 로 대시보드 탭에 끼우는 길(백엔드 언어 무관 — 백엔드는 열쇠 파일을 읽어 페이지에 넣기만). 대시보드를 먼저 살펴 방식을 고르고, 받기(판 고정)·연결·Windows 설정·Claude 연동·실제 확인·정리·기록까지 한다. "문서 작업대 붙여", "문서 탭", "docbench 이식/설치/업데이트", "대시보드에 문서 패널", "/docbench-setup" 이라고 할 때 쓴다. Use to integrate or update DocBench in any web dashboard (any backend language — DocBench app + host.js tab by default) or a local docs folder.
---

# DocBench 붙이기

DocBench 는 문서 폴더의 `.md` 를 제목 깊이별로 접어 보고, 섹션·문구에 피드백을 달고, 섹션 단위로 고치는 작업대다.
피드백·이력은 사람이 읽는 파일로 **기록 폴더**에 남는다 — 기본은 문서 폴더 밖(기록 보관함/<문서 폴더 이름>, 문서 폴더에는 문서만), 팀이 git 으로 함께 쓰면 문서 폴더 안 `.docbench/`.
대시보드에는 기본으로 **DocBench 앱**(`docbench app` — 이 PC 에 하나 도는 작은 서비스)을 켜 두고, 대시보드 탭이 앱의 `/host.js` 로 `DocBenchHost.mount(el, { root, key })` 를 부른다. 백엔드는 언어와 상관없이 이 PC 의 설정 폴더에서 열쇠 파일을 읽어 페이지에 넣기만 한다.
Claude 는 두 길로 처리한다: 화면 아래 **Claude 작업**(앱·서버가 띄우는 백그라운드 `claude -p`, 모델·노력 선택, 진행 로그 — 읽기만 하고 반영은 DocBench 가 판 비교로) 또는 터미널의 Claude Code 가 `docbench` CLI 로.
원본: https://github.com/d-j-lee/docbench (MIT). 세부 계약은 받은 판의 `docs/PORTING.md`·`docs/openapi.yaml` 이 정본이다 — 이 스킬과 다르면 그 판의 문서를 따른다.

## 0. 먼저 지킬 것

- **이 대시보드의 관례가 먼저다.** 대시보드는 이 환경의 Claude 가 관리해 왔다. `CLAUDE.md`·README·설정·메모리를 먼저 읽고 언어·폴더 구조·시작 방법·템플릿·보조 프로세스 관리·로그 위치를 그대로 따른다. 새 도구·관례를 들여오지 않는다.
- **되돌릴 수 있게.** `git status` 로 대시보드가 버전 관리되는지 본다. 아니면 바꾸기 전에 사용자에게 묻는다: (a) 원격 없이 `git init`, 또는 (b) 손댈 파일을 **정적 파일로 내주지 않는 곳**(예: `<대시보드>/.docbench-backup/<날짜>/`)에 복사 — 파일 옆 `*.bak` 은 정적 경로면 그대로 내보내진다. `npm install` 이 `package.json`·`package-lock.json` 을 바꿀 수 있다는 것도 셈에 넣는다. 바꾼 파일은 끝 보고에 전부 적는다.
- **회사 것은 밖으로 내보내지 않는다.** 회사 코드·문서·경로를 DocBench 저장소(공개)나 다른 외부로 올리지 않는다. DocBench 자체의 문제는 받은 사본을 고치지 말고, 회사 정보를 뺀 일반 서술로 사용자에게 알린다.
- **앱 열쇠는 비밀이다.** `app-token` 이 있으면 이 PC 의 어느 폴더든 앱으로 읽고 고칠 수 있다. 화면 출력·보고·커밋·로그에 열쇠 값을 적지 않는다(명령에는 변수로 넘긴다).
- **잰 것만 말한다.** 확인(§6)은 실제로 돌린 결과만 `[실측]`, 못 한 것은 `[미확인]` 과 이유. 실제 업무 문서로 시험했으면 끝에 되돌린다(§6 정리).
- 되돌리기 어렵거나 범위가 바뀌는 선택(방식, 로그인 때 켜기 같은 상시 실행 등록, 받은 사본을 커밋할지, 문서 폴더·기록 자리, 넓은 폴더를 작업 공간으로 더할지)은 근거를 붙여 한 번 묻는다. 정보가 없는 설정(문서 신뢰 표시 등)은 지어내지 말고 비우거나 묻는다.

## 1. 살피기 — 읽기만, 바꾸기 전에

| 볼 것 | 왜 |
|---|---|
| 대시보드를 **어느 브라우저·주소로** 여나 — 그 PC 의 `http://localhost:<포트>`·`127.0.0.1`, 사내 호스트 이름, https, 다른 PC 에서 접속 | T(앱 탭)는 앱이 도는 그 PC 의 브라우저에서만. 허용할 출처(주소창 그대로) |
| 대시보드 서버가 묶인 주소(`127.0.0.1`/`0.0.0.0`)와 Host 헤더 검사 여부 | 열쇠를 페이지에 넣어도 되는지(§4 T) |
| 백엔드 언어·프레임워크·템플릿, 프런트(빌드 유무·프레임워크), 탭·패널 구조와 탭마다 폴더를 어디서 아나 | 열쇠를 넣을 자리, `root` 를 정하는 법 |
| 시작 방법·포트, 보조 프로세스를 띄우는 관례 | 앱·곁 프로세스 수명 |
| 응답 헤더 CSP(`script-src`·`frame-src`·`style-src`·`img-src`·`frame-ancestors`) | 앱 출처를 더해야 하는지(T), 화면 스크립트·주입 스타일이 막히는지(B·C) |
| 미들웨어 순서(인증·본문 파서·압축), 라우터가 받는 HTTP 메서드 | B·C — DocBench 는 GET·POST·PUT·PATCH·DELETE 를 쓴다 |
| 대시보드 테마(밝게 고정 / 어둡게 고정 / OS 따라감 / 사용자가 바꿈) | `theme`·`setTheme` |
| 터미널의 Claude: 어디서(현재 폴더) 시작하나, 시작 환경 변수를 고칠 수 있나, 입력을 밀어 넣는 API 가 있나(Enter 포함 여부, 교차 사이트 요청 막힘 여부), docbench 플러그인이 깔렸나 | `onHandoff`·`DOCBENCH_ROOT`·넘기기(§5) |
| 문서 폴더: 경로, 문서 수, 인코딩(CP949·UTF-16·BOM·CRLF), **대시보드 저장소 안인가**, git 인가, 프로젝트 폴더들이 한 폴더 아래 있나 | 기록 자리·커밋 정책·작업 공간 범위·확인 대상 |
| 사용자가 여럿인가 | T 는 사람마다 자기 PC 의 앱. B·C 는 모든 쓰기가 한 사람(이 PC 의 설정 `user`, 없으면 OS 사용자)으로 기록되고 Claude 작업이 서버 PC 의 claude(그 계정)로 돈다 — 여럿이면 끈다(§5) |
| 이미 있는 DocBench: `node <cli> app --status`(켜져 있나·판·작업 공간), 이 PC 의 설정 폴더의 `app.json`·`config.json` | 다시 켜면 돌던 Claude 작업이 끊긴다, 이미 더한 작업 공간과 겹치는지 |
| 환경: `node -v`(실행 20.11+, 사본에서 시험까지 돌리려면 22.22+), `npm config get registry`, `git ls-remote https://github.com/d-j-lee/docbench HEAD`, `where.exe claude`(macOS·Linux 는 `which claude`) + `claude --version` + `claude --help` 에 `--restricted`·`--safe-mode` 가 있는지 + `claude auth status` | 받기·Claude 작업(그 둘이 없는 판이면 실행하지 않는다 → `claude update`, 로그인 안 됨 → `/login`) |

살핀 결과를 짧은 표로 사용자에게 먼저 보여 주고 §2 로 간다.

## 2. 방식 고르기

| 상황 | 방식 |
|---|---|
| 대시보드를 그 PC 의 브라우저로 `localhost`·`127.0.0.1` 주소로 본다 — 백엔드 언어 무관 | **T. 앱 탭** (기본) — 앱 + `host.js`, 백엔드는 열쇠 파일을 읽어 페이지에 넣기만 |
| 위와 같지만 대시보드 서버가 `0.0.0.0`·사내망에 열려 있고 `127.0.0.1` 로 묶을 수 없다 | 열쇠를 페이지에 넣지 않는다 → **C** 또는 **B** (토큰은 백엔드만 가진다) |
| 다른 PC 에서 접속하는 공용 대시보드 | **B·C** (Claude 작업 끔) 또는 **D** |
| DocBench API 도 대시보드 인증을 타야 한다 | **C** (Node) / **B** |
| Node 를 못 쓴다 | **E. 단일 HTML** — 단, Claude 작업은 앱(Node)이 필요하므로 터미널에서 직접 처리만 |
| 오늘 보기만 | `docbench app --open`, 또는 **A** |
| 문서가 DB·사내 시스템 | **D. 계약 구현** (`docs/openapi.yaml`) |

- **T 가 못 하는 것**: 다른 PC 의 브라우저(보는 사람 PC 의 앱에 붙는다), https·사내 호스트 이름 대시보드는 [미확인] — 브라우저가 `http://127.0.0.1` 로 가는 스크립트·iframe 을 막을 수 있으니 먼저 시험한다. 대시보드 인증은 DocBench 에 걸리지 않는다(앱 열쇠가 대신).
- **E 가 못 하는 것**: 넘기기 명령 실행(요청함 파일만 남김), 파일 감시(몇 초 간격 확인 + 창으로 돌아오면 바로), 바깥 주소 그림. 보안 문맥(`file://`·`http://localhost`·https)에서만 쓰기가 된다. 브라우저는 엣지·크롬.
- 모든 방식이 같은 기록 폴더 모양을 쓰므로 나중에 바꿔도 피드백은 이어진다.

## 3. DocBench 받기 — 판을 고정해서

**T·E — 파일 하나**: CLI `docbench.mjs`(앱 화면까지 들어 있다), E 는 `docbench.html` 도.

1. 플러그인을 깔았으면 그 안 `${CLAUDE_PLUGIN_ROOT}/cli/docbench.mjs` 가 플러그인과 같은 판의 CLI 다 — 복사해 쓴다.
2. 아니면 태그 주소에서 **바이트 그대로** 받는다: `https://raw.githubusercontent.com/d-j-lee/docbench/v<판>/release/docbench.mjs` (`docbench.html` 도 같은 자리). Windows PowerShell `Invoke-WebRequest -Uri <주소> -OutFile <저장 위치>`, 그 밖 `curl -fsSL -o <저장 위치> <주소>`. 웹 페이지 읽기 도구(WebFetch)는 내용을 바꾸므로 쓰지 않는다.
3. 저장 위치는 `%LOCALAPPDATA%\docbench\docbench.mjs`(macOS `~/Library/Application Support/docbench/`, Linux `~/.config/docbench/`) — 단일 HTML 의 연결 안내·앱 화면의 "여는 법"이 가리키는 자리이고, 로그인 때 켜기·바로가기는 경로에 영문이 아닌 글자가 있으면 만들지 않는다.
4. SHA-256 을 재어 §7 에 남긴다(Windows `Get-FileHash -Algorithm SHA256`). 플러그인 사본과 같은 판이면 지문도 같아야 한다. 확인: `node <저장 위치> --help` 맨 끝 줄 `판: <판>`.

**A·B·C·D — 저장소**: 대시보드에 `vendor/`·`tools/`·`third_party/` 같은 관례가 있으면 그 아래, 없으면 `vendor/docbench`.

1. **기본**: `git clone https://github.com/d-j-lee/docbench vendor/docbench` → `git -C vendor/docbench checkout v<판>` → 그 폴더에서 `npm ci`(개발 도구째 깔고 빌드 — 약 160 MB. CP949 저장용 `iconv-lite` 도). 빌드 뒤 `npm prune --omit=dev` 로 실행에 필요 없는 도구를 지워도 된다(갱신 때 `npm ci` 가 다시 깐다).
2. **GitHub 이 막힘, npm 은 됨**: 사용자에게 저장소 ZIP 이나 `docbench-<버전>.tgz`(`npm pack` 산출물, 빌드 포함)를 받아 달라고 한다 → ZIP 은 풀어서 `npm ci`. tgz 는 풀어 `package/` 를 `vendor/docbench` 로 두고 그 안에서 `npm install --omit=dev --ignore-scripts`(iconv-lite 만, 약 0.5 MB — `--ignore-scripts` 가 없으면 빌드 도구 없이 다시 빌드하려다 실패한다).
3. **npm 도 막힘**: T·E 로 간다.

- **판 기록**: 받은 커밋 SHA(`git -C vendor/docbench rev-parse HEAD`)와 `package.json` 버전을 §7 에 남긴다. 같은 판을 다시 받으려면 `git clone` 뒤 `git checkout <SHA>`(`--depth 1` 은 크기만 줄이지 고정이 아니다).
- **대시보드가 git 이면 받은 사본을 어떻게 둘지 묻는다**: ① `.gitignore` 에 넣고 SHA 만 기록(기본) ② 사본의 `.git` 을 지우고 소스를 커밋(dist 는 사본의 `.gitignore` 때문에 빠지고 `npm ci` 로 다시 만든다) ③ git submodule. 그냥 두면 사람이 `git add -A` 할 때 `.gitmodules` 없는 하위 저장소 링크가 커밋된다.
- npm 이 인증서·프록시로 실패하면 사내 저장소 설정(`.npmrc`)을 본다. `strict-ssl false` 같은 우회는 하지 않는다.
- 확인: `node vendor/docbench/bin/docbench.mjs --help`. Node 22.22+ 면 그 폴더에서 `npm test`(십여 초).
- 받은 사본의 파일은 고치지 않는다. 설정·옵션으로 맞춘다.

## 4. 연결

### T. 앱 탭 (기본)

아래 `<cli>` 는 §3 의 저장 위치. 사본의 `examples/dashboard-tab/`(의존성 없는 Node 예 — 백엔드가 열쇠를 읽어 넣고 탭마다 끼운다)와 `docs/PORTING.md` §2 가 정본이다.

1. **앱 켜기**: `node <cli> app --detach` → `node <cli> app --status`. 이미 켜져 있고 판이 다르면 `--detach` 가 끄고 새 판으로 켠다 — 돌던 Claude 작업은 취소로 남으니 먼저 알린다. 포트는 기본 4317, 쓰이고 있으면 다음 번호로 켜진다(실제 주소는 `--status`·`app.json`).
   로그인 때 켜기는 묻고 `node <cli> app --startup on`(Windows. macOS·Linux 는 로그인 항목·systemd 에 `app --detach`). 시작 메뉴 "DocBench" 가 필요하면 `--shortcut on`.
2. **출처 허용**: `node <cli> app --allow-origin <출처>` — 사용자가 주소창에서 보는 그대로(`http://localhost:3000` 과 `http://127.0.0.1:3000` 은 다르다, 둘 다 쓰면 쉼표로 둘). 이 PC 의 설정 `app.allowOrigins` 에 쌓이고 켜진 앱이 몇 초 안에 따른다. 빼는 명령은 없다 — 되돌릴 때 그 목록에서 지운다.
3. **백엔드 — 열쇠 넣기**: 이 PC 의 설정 폴더(Windows `%LOCALAPPDATA%\docbench\`, macOS `~/Library/Application Support/docbench/`, Linux `$XDG_CONFIG_HOME/docbench/` 기본 `~/.config/docbench/`, `DOCBENCH_HOME` 이 있으면 거기)의 `app-token`(열쇠)과 `app.json`(켜져 있을 때만, `url`)을 **페이지를 그릴 때마다** 읽어 대시보드의 템플릿 방식대로 페이지에 넣는다. 없으면 "DocBench 앱이 꺼져 있습니다 — docbench app --detach" 를 보인다. 언어별 예는 PORTING §2.2(Python), `examples/dashboard-tab/server.mjs`(Node).
   - 열쇠를 넣는 응답은 대시보드가 `127.0.0.1` 에만 열려 있을 때만, **Host 헤더가 `localhost`·`127.0.0.1` 일 때만**(없으면 그 응답에 검사를 더한다 — DNS rebinding), `Cache-Control: no-store`, `Access-Control-Allow-Origin` 없이. 정적 파일·빌드 산출물·로그에 굽지 않는다.
   - 대시보드 프로세스가 앱과 같은 사용자·같은 설정 폴더를 보는지 확인한다(서비스 계정·다른 `DOCBENCH_HOME` 이면 열쇠가 다르다).
4. **프런트 — 탭에 끼우기**: 앱의 `<url>host.js` 를 싣고(기본은 앱에서 — 앱 판과 늘 맞게. 여러 사람이 로그인해 쓰는 PC 면 다른 프로그램이 포트를 먼저 잡을 수 있어 대시보드에 복사해 두고 `app: <url>` 을 준다 — 사본 `docs/SECURITY.md` "DocBench 앱") 탭마다 `DocBenchHost.mount(el, { root, key, theme, onTodo, onHandoff, onEvent })`. 돌려받은 것으로 `setTheme`·`navigate`·`setTokens`·`destroy`.
   - `root` = 그 탭의 폴더 전체 경로(백엔드가 넣으면 JSON 으로 — Windows `\` 이스케이프). 처음 열면 앱의 작업 공간이 되고(이 PC 의 설정 `workspaces[…].added`), 기록은 기록 보관함(`dataHome`, 기본 `<설정 폴더>\data\<폴더 이름>`)에 생긴다 — 문서 폴더 안 `.docbench` 가 있으면 그것. 보관함 자리를 정하고 싶으면 **처음 열기 전에** 이 PC 의 설정 `dataHome` 을 묻고 적는다.
   - 프로젝트 폴더들이 한 폴더 아래 있으면, 그 위 폴더를 앱 화면(`app --open` → 폴더 추가)에서 한 번 더해 두면 탭들이 그 작업 공간의 범위로 열려 기록이 한 벌이 된다 — 묻고 한다. 이미 더한 작업 공간을 품는 폴더를 `root` 로 주면 탭이 "앱 화면에서 합친 뒤 다시 여세요"를 보인다.
   - 탭은 처음 보일 때 끼우고, 다른 탭으로 가도 지우지 않고 숨긴다(상태 유지). 탭을 없앨 때 `destroy()`.
   - 높이: 탭 칸이 정해진 높이를 가져야 한다(iframe 이 `height:100%`). 최소 420px 정도.
   - 테마: 대시보드 테마를 `theme` 로, 바뀌면 `setTheme`. 색·글꼴은 `tokens`(`--db-*`).
   - 배지: `onTodo({ owner, assistant })` — 사람 차례·Claude 차례 수, 바뀔 때만 온다. 사용자가 고른 대로 배지에.
   - 대시보드 CSP 가 있으면 `script-src`·`frame-src` 에 앱 출처를 더한다.
5. **넘기기**: §5.

### 공통 — 문서 폴더 준비 (A·B·C·D)

```powershell
node vendor\docbench\bin\docbench.mjs init "D:\work\docs"
```

- **기록 자리를 정한다**(사용자에게 한 번 묻는다 — 되돌리려면 옮겨야 하는 선택):
  - 기본(권장): 문서 폴더 **밖** — `init` 이 기록 보관함(이 PC 의 설정 `dataHome`, 없으면 `%LOCALAPPDATA%\docbench\data`) 아래 `<문서 폴더 이름>\` 에 만든다. 문서 폴더에는 아무것도 생기지 않아 대시보드·터미널의 다른 Claude 세션이 헷갈리지 않는다. 보관함을 사람이 보기 쉬운 곳에 두려면 먼저 이 PC 의 설정에 `"dataHome": "C:/tools/docbench/docbench-기록"`(단일 HTML 을 함께 쓰면 그 화면에서 고를 보관함과 같은 곳).
  - 팀이 git 으로 기록을 함께 쓸 때: `init "<문서 폴더>" --inside`(문서 폴더 안 `.docbench\`). 그 폴더가 대시보드 저장소 안이면 커밋 정책도 묻는다.
  - 예전 판이 만든 `.docbench\` 가 이미 있으면 그대로 안을 쓴다(밖으로 옮기려면 단일 HTML 의 "보관함으로 옮기기").
  - `docbench status` 가 "기록:" 자리를 보여 준다. §7 기록에 적는다.
- 기록 폴더의 `config.json`(함께 쓰는 설정): 그룹·문서 제목·처음 펼칠 깊이·신뢰 표시. 예: 사본의 `examples/sample-workspace/.docbench/config.json`.
- **이 PC 의 설정** `%LOCALAPPDATA%\docbench\config.json`(문서 폴더 밖, macOS `~/Library/Application Support/docbench/config.json`, Linux `~/.config/docbench/config.json`, `DOCBENCH_HOME` 으로 옮김): 실행 명령 `assistant`·`notify.command`, 이름 `user`·표시 이름 `name`, 기록 자리 `dataHome`, 앱의 `app.allowOrigins`. **실행 명령·이름은 여기에만** — 문서 폴더 `config.json` 에 적으면 무시하고 경고한다(git·OneDrive·공유 폴더로 퍼지는 폴더에 누가 명령을 넣어 남의 PC 에서 돌리지 못하게). 맨 위 값이 기본, 폴더별은 `"workspaces": { "D:/work/docs": { "notify": { "command": [...] }, "data": "<기록 폴더>" } }`(`data`·`owners` 는 `docbench link` 가, `added` 는 앱이 적는다). `docbench status` 가 그 파일 위치를 보여 준다. 바꾸면 `serve`·대시보드·앱을 다시 시작한다.
- `init --claude` 는 문서 폴더에 피드백 스킬을 복사한다 — 터미널 Claude 가 **문서 폴더에서 시작할 때만** 쓴다(§5).

### C. Node 백엔드에 끼우기

`package.json` 에 `"docbench": "file:vendor/docbench"` 로 넣지 않는다 — DocBench 의 개발 도구가 대시보드로 딸려 오고 사본의 파일 권한이 바뀐다. **상대 경로로 import** 한다. 실행해 볼 수 있는 예: 사본의 `examples/dashboard-embed/`.

```js
// CommonJS 대시보드 (ESM 이면 같은 내용을 최상위 await 로)
const path = require('path');
const { pathToFileURL } = require('url');
let docbench = null;                       // 준비 전에는 503
const docbenchReady = (async () => {
  const { Workspace, createDocBenchHandler } = await import(pathToFileURL(path.join(__dirname, 'vendor/docbench/server/index.mjs')).href);
  const ws = await new Workspace('D:/work/docs').init();
  await ws.reconcileAll();                 // 꺼져 있던 동안 바뀐 파일을 이력에
  docbench = createDocBenchHandler(ws, { base: '/docbench/api', ui: false /*, allowHosts: ['브라우저 주소의 호스트 이름'], runs: true (Claude 작업 — 한 사람이 쓰는 대시보드만) */ });
})().catch((e) => console.error('[docbench]', e));

// 맨 앞(압축·본문 파서보다 앞)에 둔다. 인증은 대시보드의 것을 이 안에서 부른다
app.use((req, res, next) => {
  if (!req.url.startsWith('/docbench/api')) return next();
  dashboardAuth(req, res, () => {                         // 대시보드 인증 미들웨어(함수로 꺼내 둔다)
    if (!docbench) return res.status(503).json({ error: 'DOCBENCH_STARTING' });
    if (!docbench(req, res)) next();
  });
});
server.on('close', () => void docbench?.close());   // Claude 작업 엔진도 멈춘다(돌던 claude 는 끝까지 기다리지 않고 끔)
```

- **순서**: 처리기는 요청 본문을 직접 읽는다 — `express.json()` 이 먼저 읽으면 PUT·POST 가 응답 없이 멈춘다. 압축은 실시간 알림(SSE)을 모아 버린다. 대시보드 순서가 "압축 → 파서 → 인증" 이면 위처럼 인증을 함수로 꺼내 DocBench 경로 안에서 부른다.
- `app.use('/docbench/api', …)` 로 걸지 않는다 — Express 가 `req.url` 에서 그 경로를 떼어 처리기가 못 알아본다.
- 브라우저 주소의 호스트 이름이 `localhost`·`127.0.0.1` 이 아니면 `allowHosts` 에 넣는다(DNS rebinding 막기용 Host 검사).
- 대시보드의 시험이 서버를 띄우면 이제 DocBench 도 실제 문서 폴더로 뜬다(그 기록 폴더의 `state.json` 등을 쓴다). 시험용 폴더를 쓰게 하거나 그 사실을 기록한다.
- **Claude 작업**: 처리기는 **기본 끔**. 이 PC 사람 한 명이 쓰는 대시보드면 `createDocBenchHandler(ws, { …, runs: true })` 로 켠다(`claude` 가 PATH 나 이 PC 의 설정 `assistant.command` 에 있어야). 여러 사람이 붙는 대시보드면 켜지 않는다 — 서버 PC 의 claude 가 그 계정·구독으로 돈다. 켰는지·끌지는 사용자에게 묻는다.

### B. 곁 프로세스 + 프록시

- **띄우기**: 대시보드가 보조 프로세스를 띄우는 곳에서 `node vendor/docbench/bin/docbench.mjs serve "<문서 폴더>" --port <포트>`. 토큰은 **환경 변수 `DOCBENCH_TOKEN`** 으로 준다(명령줄은 프로세스 목록에 보인다). 대시보드가 시작할 때 긴 임의 값을 만들고, 포트·pid·토큰을 정적으로 내주지 않는 git 제외 파일(예: `vendor/docbench-sidecar.json`)에 둔다. 앱의 기본 포트(4317)와 겹치지 않게 다른 포트를 쓴다.
- **다시 쓰기·정리**: Windows 는 부모가 죽어도 자식이 남는다. 시작할 때 그 파일의 포트로 `GET /api/session`(토큰 포함)이 답하고 `workspace.root` 가 같은 문서 폴더면 그 프로세스를 다시 쓴다. 포트를 다른 프로그램이 쓰면 다음 번호로. 끌 때 `taskkill /PID <pid> /T /F`(macOS·Linux 는 `kill`). 띄운 뒤 `/api/session` 이 답할 때까지 기다린다.
- **프록시** `/docbench/api/*` → `http://127.0.0.1:<포트>/api/*`:
  - 백엔드가 `Authorization: Bearer <토큰>` 을 붙인다. 브라우저에는 토큰을 주지 않는다.
  - **Host 는 브라우저가 보낸 그대로** 넘긴다(`localhost:8800` 같은 이름은 기본 통과). 바꿔 쓰면 DocBench 의 Host 검사가 꺼진다. 사내 호스트 이름으로 열면 serve 에 `--allow-host <이름>`.
  - 메서드 GET·POST·PUT·PATCH·DELETE, 본문과 `X-DocBench` 헤더를 그대로(쓰기 요청에 필수, 없으면 403). 응답에서 hop-by-hop 헤더(`connection`·`transfer-encoding` 등)는 빼고, 스트림이 아닌 응답은 길이를 맞춘다.
  - `/api/events`(SSE)는 버퍼링·압축 없이 바로 흘려보내고 시간 제한을 길게. 경로를 골라 넘기는 프록시면 `/api/runs*`(Claude 작업)도 넘긴다.
  - 여러 사람이 붙는 대시보드면 `serve … --no-claude`(§5).
  - 언어별: Python 표준 라이브러리만이면 `http.client` 로 요청하고 `resp.read1()` 고리로 `wfile` 에 바로 쓰기(`BaseHTTPRequestHandler` 는 `do_PUT`·`do_PATCH`·`do_DELETE` 도 만들어야 한다 — 없으면 501). FastAPI·Starlette 는 `httpx` 스트리밍, Flask 는 `requests(stream=True)`, .NET 은 YARP, Java 는 Spring Cloud Gateway, Go 는 `httputil.ReverseProxy`(`FlushInterval: -1`), nginx 는 `proxy_buffering off`.

### 프런트 (B·C) — 웹 컴포넌트

```html
<script src="/docbench/assets/docbench.iife.js"></script>   <!-- 사본 dist/ 를 대시보드 정적 경로로 -->
<doc-bench api="/docbench/api" theme="light" style="flex:1;min-height:0"></doc-bench>
```

- **높이**: 작업대는 부모가 준 높이를 채우고 문서는 그 안에서 스크롤한다. 부모를 세로 flex 로 두고 `flex:1;min-height:0`, 또는 높이가 정해진 부모 안에서 `height:100%`. 부모가 내용 따라 늘어나는 칸이면 `contain:size` 를 더한다. `display` 는 정하지 않는다(요소가 flex 로 둔다). 작업대 최소 높이는 420px — 그보다 낮은 칸이면 칸을 키운다.
- **테마**: 대시보드가 한 테마로 고정이면 그 값(`light`·`dark`), OS 를 따라가는 대시보드만 `auto`.
- **CSS**: IIFE 가 스타일을 스스로 넣는다. CSP 가 인라인 스타일을 막을 때만 `dist/docbench.css` 를 `<link>` 로 넣고 `el.options = { injectStyles: false }` 를 연결 전에.
- **CSP**: `script-src` 가 그 파일을 허용하는지, 문서에 그림이 있으면 `img-src`(https·data:)도.
- 엮기: `docbench:doc:saved`·`docbench:assistant:requested` 이벤트, `el.navigate('docs/x.md')`, 색·글꼴은 `--db-*` 토큰. 대시보드 전역 CSS 는 작업대 안으로 새지 않는다(아주 강한 id 선택자만 예외 — 그런 대시보드면 T).

### E. 단일 HTML

`release/docbench.html`(§3 의 판)을 같은 출처의 정적 파일로 내준다(예: `/docbench/`). 그 경로에는 대시보드 전역 CSP 대신 파일 안의 CSP(인라인 스크립트 허용, 바깥으로 나가는 요청·바깥 그림 차단)가 적용되게 한다.

```html
<iframe src="/docbench/?lang=ko" title="문서 작업대" style="border:0;width:100%;height:100%"></iframe>
```

- 열면 바로 작업대("시작하기")가 뜬다 — 이름도 폴더도 묻지 않는다(계정은 브라우저에 저절로, 표시 이름은 오른쪽 위 "나"). 사람이 왼쪽 위 작업 공간 메뉴의 "폴더 열기"로 문서 폴더를 연다. 같은 출처 iframe 이어야 한다(다른 출처는 폴더 고르기가 막힌다).
- **기록 보관함**(문서 폴더 밖 빈 폴더)은 처음 저장할 때 한 번 고른다. 서버·CLI·앱과 같은 보관함을 쓰게 하려면 이 PC 의 설정 `dataHome` 과 같은 폴더를 고르라고 안내한다.
- 대시보드 주소로 내주면 연 폴더·고른 보관함을 기억한다. 파일로 바로 열면(`file://`) 기억하지 않는다 — 같은 브라우저로 연 다른 로컬 HTML 이 꺼내 쓸 수 있어서.
- 문서 속 바깥 주소 그림은 보이지 않는다(그림 주소로 새는 길 차단). `data:` 그림만.
- Claude 작업: 넘기기·제안을 누른 자리에서 Claude 작업 창이 연결 안내 문구를 준다 — 그 PC 의 Claude Code 에 붙여 넣으면 CLI 를 받아 지문을 확인하고 `link --owner <이 화면의 계정>` 으로 폴더를 앱에 잇고 앱을 켠다. 이 스킬로 붙이는 중이면 그 단계를 대신 해도 된다: §3 의 CLI → `node <cli> link "<문서 폴더>" --data "<보관함>/<문서 폴더 이름>" --owner <계정>`(계정은 화면 "나"에 보이는 `u-…` — 사용자에게 받는다. 기록을 문서 폴더 안에 두기로 했으면 `--data` 없이) → `node <cli> app --detach` → `app --status` 에 그 폴더가 보이는지. 로그인 때 켜기는 묻고 `app --startup on`.

### A. `serve` 화면 iframe

`serve ... --allow-origin <대시보드 출처>` 후 `<iframe src="http://127.0.0.1:4317/">`(앱과 함께 쓰면 포트를 나눈다). 토큰을 쓰면 `?token=`(주소가 기록에 남는다고 알린다).

## 5. 터미널의 Claude 와 잇기

- **피드백 스킬이 터미널 Claude 에 보이게**: 플러그인(`claude plugin install docbench@docbench`)이면 어디서든 보인다. 아니면 터미널 Claude 가 **시작하는 폴더**의 `.claude/skills/docbench-feedback/` 또는 사용자 폴더(`%USERPROFILE%\.claude\skills\`)에 사본의 `integrations/claude-code/skills/docbench-feedback` 를 둔다. 이름은 `/docbench-feedback`(플러그인은 `/docbench:docbench-feedback` 도). 실제로 터미널에서 불러지는지 확인한다.
- **작업 폴더 찾기**: CLI 는 현재 폴더에서 위로 문서 폴더를 찾는다(기록 짝·`.docbench` 가 있는 곳 — 앱이 더한 폴더도). 터미널이 문서 폴더 밖에서 시작하면 그 시작 환경에 `DOCBENCH_ROOT=<문서 폴더>` 를 넣고, 시작부를 못 고치면 대시보드 `CLAUDE.md` 에 "CLI 는 `node <cli> --root <문서 폴더> …`" 한 줄을 남긴다(없으면 종료 코드 2).
- **"Claude에게 넘기기"를 어디로**:
  1. **T + 대시보드에 Claude 터미널 입력 API 가 있으면**: `onHandoff(req)` 에서 `req.prompt` 를 그 터미널에 보내고 `{ handled: true, message }`. 프롬프트는 `/docbench:docbench-feedback 문서 폴더 "<이름>" 의 Claude 차례 피드백 N건(<id>…)을 처리해 줘.` 한 줄 — 플러그인 이름이 붙어 있으니 스킬만 복사해 깐 터미널이면 `/docbench-feedback` 으로 바꿔 보낸다. 폴더 **이름**만 있으므로 터미널이 그 폴더에서 시작하지 않았으면 `root` 를 덧붙인다. Enter 가 필요하면 `\r`. 15초 안에 답한다(늦거나 `handled: false` 면 작업대가 Claude 작업 창으로). 그 API 는 이제 자동 입력 통로이므로 다른 사이트가 부를 수 없게(전용 헤더 검사 등) 되어 있는지 확인한다.
  2. **T 에서 `onHandoff` 를 주지 않으면**: 앱의 Claude 작업 창(아래)이 맡는다.
  3. **B·C**: 기록 폴더 `inbox/req-*.json` 을 남기고, 대시보드가 터미널에 입력을 밀어 넣을 수 있으면 그 API 를 부르는 작은 스크립트를 이 PC 의 설정 `workspaces["<문서 폴더>"].notify.command`(배열, 셸 없이 실행)에 건다. 알아 둘 것: 현재 폴더 = 문서 폴더(상대 경로는 거기 기준) · 환경 변수 = 서버 프로세스의 것(C 는 대시보드 환경, B 는 곁 프로세스 환경 — 대시보드 주소·인증 값은 곁 프로세스를 띄울 때 넘긴다) + `DOCBENCH_REQUEST`·`DOCBENCH_ROOT` · 한 번에 하나만 돌고 출력은 `inbox/req-*.json.log` · 터미널 API 가 Enter 를 붙이는지.
  4. 그대로: 사람이 터미널에서 `/docbench-feedback`(E 는 Claude 작업 창의 "터미널 Claude Code로 직접"이 요청함에 남기고 한 줄을 복사해 준다).
  5. 무인 처리(`claude -p` 를 명령으로): 받은 판 `docs/PORTING.md` §5. 피드백을 신뢰하는 사람만 다는 폴더에서만.
- **Claude 작업**(화면 아래 창 — 넘기기·"Claude 제안"이 이 길로): 구독 로그인을 그대로 쓰고 API 키는 쓰지 않는다(`--bare` 금지). DocBench 가 claude 를 **문서 폴더 밖**에서 `--restricted --safe-mode --permission-mode dontAsk --tools Read,Grep,Glob --add-dir <문서 폴더>` 로 띄워, 문서 폴더의 훅·CLAUDE.md 가 실행·지시가 되지 않게 한다(사본 `docs/SECURITY.md`).
  - T·E: 앱이 작업 공간마다 띄운다. B·C·A: 서버가 띄운다. `claude` 가 PATH 에 없으면 이 PC 의 설정에 `"assistant": { "command": "<claude 실행 파일 전체 경로>" }`(앱은 다시 켜야 읽는다 — `app --stop` → `app --detach`). `where.exe claude` 가 `.cmd`(npm 설치본)만 보여 주면 DocBench 가 옆의 `cli.js` 를 node 로 부르므로 그대로 둬도 된다 — 안 되면 실제 대상(exe, 또는 `node …js`)을 배열로. 작업 하나 상한 `timeoutSec`(기본 900).
  - **여러 사람이 붙는 서버면 켜지 않는다**: C 는 기본 끔(켜려면 `runs: true`), B·A 는 `serve --no-claude`. 꺼져 있으면 창 대신 예전 넘기기(요청함·알림 명령)만. 앱은 그 PC 사용자 하나의 것이라 해당 없다.
  - E 는 이 화면의 계정과 짝지은 엔진(`link --owner`)이나 사용자 이름이 같은 엔진만 저절로 고른다. 아니면 창에 "내 것 아님" — 사람이 한 번 고르거나 `link --owner` 로 잇는다. 예전 실행기(`docbench runner`)도 그대로 되지만 새로 붙일 때는 앱을 쓴다.
  - 확인은 실제 한 번(구독 사용량을 쓴다고 알린다, 작은 모델·낮은 노력으로) — 사용량 없이 흐름만 보려면 잠시 `assistant.command` 를 사본의 `test/fixtures/fake-claude.mjs`(`[node, <그 경로>]`)로 바꿔 보고(앱이면 다시 켜고) 되돌린다.
- 터미널 Claude 와 Claude 작업은 함께 써도 된다: 같은 피드백을 동시에 잡으면 판 비교로 한쪽만 반영되고, `docbench status` 가 맡겨 둔 작업의 피드백을 보여 준다(피드백 스킬이 그것을 건너뛴다).

## 6. 확인 — 실제로 돌리고 표로, 끝나면 정리

| # | 확인 | 방법 |
|---|---|---|
| 1 | 화면 | 탭·패널에서 문서가 열리고 **칸보다 긴 문서가 작업대 안에서 스크롤**된다. 접은 상태가 새로고침 뒤에도 남는다. 좁은 폭에서도 가로 넘침이 없다 |
| 2 | 탭 연동 (T) | 대시보드 테마를 바꾸면 탭이 따라온다 · 다른 패널에서 `navigate` 로 문서가 열린다 · 피드백을 달면 배지(`onTodo`)가 바뀐다 · `onEvent` 로그에 문서·피드백 본문이 없다 · 다른 탭으로 갔다 와도 상태가 남는다 |
| 3 | 바이트 보존 | 실제 문서(CP949·BOM·CRLF 가 있으면 그것) 한 섹션을 화면에서 고쳐 저장 → 손대지 않은 부분이 바이트 그대로(`git diff` 또는 저장 전후 비교). CP949 는 Node 의 `TextDecoder('euc-kr')` 가 확장 음절(똠·햏)을 못 읽으므로 사본의 iconv-lite 로 확인: `node -e "console.log(require('./vendor/docbench/node_modules/iconv-lite').decode(require('fs').readFileSync(process.argv[1]),'cp949'))" <파일>`. T·E 만 썼으면 저장 전후 해시(`Get-FileHash`)를 비교하고 손댄 섹션을 눈으로 |
| 4 | 밖에서 고침 | 편집기로 문서를 고치면 화면에 바뀐 글이 표시된다(초록·취소선, 배지에 마우스를 올리면 누가·언제) — 앱·B·C 1초 안팎, E 몇 초·창으로 돌아오면 바로. 화면에서 그 섹션을 편집하는 중이었으면 내 글이 지켜지고 차이를 보여 준다 |
| 5 | CLI 왕복 | 화면 피드백 → `docbench fb list --waiting assistant` 에 보임 → `fb reply <id> -m … --resolve` → 화면 카드가 바뀜 |
| 6 | Claude 가 고친 문서 | `docbench doc write … --section … --base …` 후 가만히 둔 화면이 새 글을 보여 준다 |
| 7 | 넘기기·Claude 작업 | T 에 `onHandoff` 를 걸었으면 넘기기 → 터미널에 한 줄이 들어가고 그 세션이 처리한다. Claude 작업: 창이 "연결됨" → 피드백 하나 넘기기 → 로그가 흐르고(읽은 파일·막힌 접근) 끝나면 문서에 바뀐 글·카드에 회신. "Claude 제안" → 카드에 제안 → 차이 → 적용. 끈 서버면 넘기기 → 요청함 파일(+ 고른 알림이 실제로 터미널에 닿는지) |
| 8 | 보안 | **T**: 열쇠 없이 `curl <앱>/api/app/info` → 401 · `<앱>/embed` 응답의 `Content-Security-Policy` 가 `frame-ancestors 'self' <허용한 출처>` 뿐 · 대시보드 페이지에 다른 Host(`-H "Host: evil.example"`)로 요청하면 거부, 응답에 `Cache-Control: no-store` · 열쇠가 대시보드 저장소·로그에 없다(찾을 때도 열쇠는 변수로 넘겨 화면에 찍지 않는다). **공통**: Claude 작업 로그에 "안전 실행" 줄이 있고, 돌 때 claude 명령줄에 `--restricted --safe-mode` 가 있는지(PowerShell `Get-CimInstance Win32_Process \| ? CommandLine -match 'restricted' \| select CommandLine`, macOS·Linux `ps -ef \| grep -- --restricted`) · 열린 포트가 127.0.0.1 에만 묶였는지(`netstat -ano \| findstr <포트>`, macOS·Linux 는 `ss -ltn`). B: 토큰 없이 곁 프로세스 직접 호출 401, 브라우저 요청에 토큰이 안 보임. C: DocBench 경로도 대시보드 인증을 탄다. 다른 Host 403, `X-DocBench` 없는 쓰기 403 |
| 9 | 대시보드 회귀 | 대시보드 자체 시험·빌드·린트 통과, 다른 화면 모양 그대로 |

대시보드에 브라우저 자동 시험이 있으면 1·2·4 를 하나 더한다. 없으면 사람이 할 단계를 번호로 적어 준다.

**정리**: 시험 전에 고칠 문서의 원본을 바이트 그대로 복사해 두고, 끝나면 되돌린다(`git checkout -- <파일>`, git 이 아니면 그 사본을 바이트 그대로 덮어쓰기 — `copy /b`·`cp`. `doc write --file` 은 UTF-8·UTF-16 입력만 받으므로 CP949 문서 되돌리기에는 쓰지 않는다). 되돌린 뒤 해시가 원본과 같은지 보고, 열려 있는 화면이 외부 편집으로 기록하면 `docbench log <문서> -m "시험 되돌림"`. 시험 피드백은 지우거나 "반영됨"으로 닫고, 요청함·터미널 시험 로그를 비운다. 시험용으로만 앱에 더한 폴더는 앱 화면에서 "목록에서 빼기"(기록은 남는다). 남긴 것과 지운 것을 보고에 적는다.

## 7. 기록·보고

- 대시보드 `CLAUDE.md` 에 짧게: 방식과 이유, 받은 위치·판·SHA(파일이면 SHA-256), 앱 켜기·끄기(`app --detach`·`--stop`·`--status`), 허용한 출처, 열쇠를 읽는 코드 위치, 문서 폴더, 갱신·되돌리기, CLI 부르는 법, 사본의 `integrations/claude-code/CLAUDE.md.snippet`(문서 폴더 경로에 맞게 고쳐서 — 그 글은 문서 폴더 기준으로 쓰여 있다).
- 사용자에게: 고른 방식과 근거, 물을 수 없어 가정한 것, 바꾼 파일, §6 표(`[실측]`/`[미확인]`), 사람이 할 일(폴더 열기·기록 보관함 고르기·권한 등), 이 PC 의 설정(`%LOCALAPPDATA%\docbench\config.json`)에 무엇을 적었는지(`app.allowOrigins`, 앱에 더한 폴더, `dataHome`, `assistant`) — 다른 PC 로 옮길 때 그 폴더(열쇠 포함)는 따라가지 않는다 —, 로그인 때 켜기를 등록했는지, 되돌리는 법. 열쇠 값은 적지 않는다.

## 8. 갱신·되돌리기

- **갱신**: T·E 는 §3 처럼 새 판의 파일을 같은 자리에 받아 지문 확인 → `node <cli> app --detach`(판이 다르면 끄고 새 판으로 켠다 — `host.js` 도 앱이 내주므로 따라온다). E 는 `docbench.html` 도 바꾼다. 저장소 사본은 새 판으로(`git -C vendor/docbench fetch --tags` → `checkout v<판>` 또는 새 ZIP·tgz) → `npm ci`. 어느 쪽이든 새 판 `docs/DECISIONS.md`·`CHANGELOG.md` 에서 바뀐 계약을 확인하고 §6 의 1·2·3·5·7 을 다시.
- **되돌리기**: 탭 코드·열쇠 읽는 코드·끼운 줄·프록시 경로·곁 프로세스 등록·정적 경로를 빼고 받은 사본을 지운다. 앱은 `app --startup off`·`--shortcut off`·`--stop`, 이 PC 의 설정 `app.allowOrigins` 에서 그 출처를 지운다. 예전 실행기는 `runner --stop` 과 `--startup off`. 기록 폴더(보관함·문서 폴더의 `.docbench/`)는 사람의 피드백·이력이므로 지우기 전에 반드시 묻는다.

## 문제 풀이

| 증상 | 원인 → 할 일 |
|---|---|
| 탭이 비고 "연결을 거부했습니다" (T) | 대시보드 출처가 허용 목록에 없다 → `app --status --json` 의 `allowOrigins` 와 주소창 출처(`localhost`/`127.0.0.1`, 포트)를 맞춘다 |
| 탭에 "이 주소는 열쇠가 있어야 열립니다" (T) | 넣은 열쇠가 앱의 것과 다르다 → 대시보드 프로세스가 같은 사용자·같은 설정 폴더(`DOCBENCH_HOME`)를 보는지, 열쇠를 캐시해 두지 않았는지 |
| `host.js` 를 못 받음 (T) | 앱이 꺼졌거나 포트가 바뀜 → `app --status`, 주소를 `app.json` 에서 매번 읽는지 |
| 탭에 "앱 화면에서 합친 뒤 다시 여세요" (T) | `root` 가 이미 더한 작업 공간을 품는다 → `app --open` → 폴더 추가 → 그 폴더 → 합치기 |
| 넘기기가 터미널로 안 가고 Claude 작업 창이 열림 (T) | `onHandoff` 가 15초 안에 `{ handled: true }` 를 못 돌려줌, 또는 오류 → 터미널 API 호출을 확인 |
| PUT·POST 가 응답 없이 멈춤 | 본문 파서가 먼저 읽음 → 처리기를 파서보다 앞에(§4 C) |
| 화면이 실시간으로 안 바뀜 | 프록시·압축이 SSE 를 모음 → 버퍼링·압축 끄기. 안 되면 `createRestAdapters({ live: 'poll' })` |
| 403 `HOST_NOT_ALLOWED` | 브라우저 주소의 호스트 이름 → `allowHosts`·`--allow-host`. 앱은 `localhost`·`127.0.0.1`·`::1` 로만 부른다(`app.json` 의 `url` 그대로) |
| 403 `CSRF` / 401 / 501 | 프록시가 `X-DocBench` 를 버림 / 토큰을 안 붙임 / 그 메서드 처리가 없음 |
| 작업대가 칸을 못 채우거나 긴 문서가 잘림 | 요소에 `display:block` 을 줬거나 부모 높이가 정해지지 않음 → §4 프런트 높이, T 는 탭 칸 높이 |
| 저장 때 `EPERM`·`EBUSY` | 편집기·백신·동기화 도구가 파일을 잡음 → 잠시 뒤 다시 |
| 문서가 읽기 전용 | 화면 머리 안내가 이유를 말한다(CP949 인데 iconv-lite 없음, 깨진 바이트 등). 사람이 동의하면 UTF-8 로 바꿔 저장 |
| 제안·넘기기 명령이 안 돎, `status` 에 "주의" | 명령을 문서 폴더 `config.json` 에 적음 → 이 PC 의 설정으로(§4 공통) |
| `claude 실행 파일을 찾지 못했습니다` | `assistant.command` 에 전체 경로(§5), 앱이면 다시 켠다 |
| "Claude Code 에 로그인하지 않았습니다" | 터미널에서 `claude` → `/login`(또는 `claude auth login`). 1분 안에 다시 확인한다 |
| Claude 작업 창이 연결 안내에서 넘어가지 않음 (E) | `node <cli> app --status` 에 그 문서 폴더가 있는지(없으면 `link` 가 안 됨), 화면의 기록 자리와 `docbench status` 의 "기록:" 이 같은지, "내 것 아님"이면 `link --owner <계정>`, 로그(`%LOCALAPPDATA%\docbench\logs\`) |
| "Claude Code 업데이트 필요" | `--restricted`·`--safe-mode` 가 없는 판 → `claude update`. 1분 안에 다시 확인한다 |
| 작업 "실패: 고친 글(text)이 비어 있습니다" | 작은 모델·낮은 노력에서 가끔(실측) → 피드백은 그대로 Claude 차례, 모델·노력을 올려 다시 |
| E 에서 "읽기만"만 보임 | 보안 문맥이 아님(`http://사내호스트`)이거나 엣지·크롬이 아님 → localhost·https 로, 또는 T·B |
