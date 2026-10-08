# 이식 가이드 — 웹 대시보드에 문서 작업대 붙이기

대상: Windows PC 에서 도는 **터미널 연동 웹 대시보드**(대시보드 자체도 Claude Code 로 관리)에 DocBench 를
"문서 보기·피드백·편집 도우미" 패널로 넣는 경우. 문서는 로컬 드라이브에 있다.

이 문서는 사람과 Claude Code 가 같이 읽도록 썼다. 가장 빠른 길은 대시보드를 관리하는 Claude Code 에 **`docbench-setup` 스킬**을 깔고 맡기는 것이다 —
대시보드의 언어·구조를 스스로 살펴 아래 방식 중 하나를 고르고, 붙이고, §7 확인까지 한다([맨 아래](#claude-code-에게-맡기기)).

## 1. 먼저 고를 것 — 어떻게 붙일까

| 방식 | 대시보드 쪽 일 | 장점 | 주의 |
|---|---|---|---|
| **A. iframe** | `<iframe src="http://127.0.0.1:4317/">` 한 줄 | 가장 빠름, 스타일 충돌 없음 | 출처가 달라 `--allow-origin` 필요, 대시보드와 상태 공유는 이벤트 없이 |
| **B. 웹 컴포넌트 + 프록시** | `<doc-bench api="/docbench/api">` + `/docbench/api` → 4317 프록시 | 대시보드 안에 자연스럽게, 이벤트로 연동 | 프록시 설정 한 번 |
| **C. 백엔드에 처리기 끼우기** (Node) | `app.use(handle)` 몇 줄 + 웹 컴포넌트 | 프로세스 하나, 같은 출처 | 대시보드 백엔드가 Node 일 때 |
| **D. 계약만 구현** | 대시보드 백엔드가 `docs/openapi.yaml` 구현 | 저장소를 DB·사내 문서 시스템으로 | 일이 가장 많음 |
| **E. 단일 HTML** | `release/docbench.html` 을 정적 파일로 내주고 `<iframe>` | 설치·서버 없음 | 몇 초 간격 확인, Claude 작업은 PC 마다 실행기(Node), 문서 폴더·기록 보관함을 사람이 고름(파일로 열면 매번), 엣지·크롬 + 보안 문맥(localhost·https·파일) |

**권장: 대시보드 백엔드가 Node 면 C, 아니면 B.** 둘 다 같은 출처라 CORS·토큰 고민이 줄고, 화면 이벤트(`docbench:doc:saved` 등)를 대시보드가 받아 터미널 패널과 엮을 수 있다.
Node 를 못 깔거나 프로세스를 늘리기 싫으면 E. 오늘 바로 써 보려면 A 또는 `docbench.html` 을 그냥 열기. 모두 같은 기록 폴더를 쓰므로 나중에 방식을 바꿔도 피드백은 이어진다.

## 2. 공통 준비 (Windows)

```powershell
# 1) 받기·빌드 (Node 20 이상)
git clone https://github.com/d-j-lee/docbench C:\tools\docbench
cd C:\tools\docbench
npm install          # 빌드까지 한다. iconv-lite(선택 의존성)도 같이 깔린다 — CP949/EUC-KR 문서 저장에 필요

# 2) 문서 폴더 준비 (+ Claude Code 스킬)
node bin\docbench.mjs init D:\work\docs --claude

# 3) 켜 보기
node bin\docbench.mjs serve D:\work\docs --port 4317
```

- **기록 폴더**(피드백·이력·작업 기록): `init` 은 기본으로 문서 폴더 **밖**에 만든다 — 기록 보관함(이 PC 의 설정 `dataHome`, 없으면 `%LOCALAPPDATA%\docbench\data`) 아래 `<문서 폴더 이름>\`. 문서 폴더에는 아무것도 생기지 않는다(같은 폴더에서 일하는 다른 프로그램·다른 Claude 세션이 헷갈리지 않게, D57). 다른 자리면 `--data <폴더>`, 팀이 git 으로 함께 쓰려면 `--inside`(문서 폴더 안 `.docbench\`). 예전 판이 만든 `.docbench\` 가 있는 폴더는 그대로 안을 쓴다. `docbench status` 가 기록 자리를 보여 준다.
- `--claude` 는 문서 폴더에 `.claude\skills\docbench-feedback\` 를 복사한다 — 터미널 Claude 가 그 문서 폴더에서 시작할 때만 쓸모 있다(아니면 플러그인으로 깐다).
- `config.json`(기록 폴더, 함께 쓰는 설정): 그룹·문서별 제목·신뢰 표시·깊이(예: [examples/sample-workspace/.docbench/config.json](../examples/sample-workspace/.docbench/config.json)).
- **이 PC 의 설정**(Windows `%LOCALAPPDATA%\docbench\config.json`, macOS `~/Library/Application Support/docbench/`, Linux `~/.config/docbench/` — 문서 폴더 밖, 로밍되지 않는 이 PC 자리. `DOCBENCH_HOME` 으로 옮김. `docbench status` 가 위치를 보여 준다): 실행 명령 `assistant`·`notify.command` 와 이름 `user`. **실행 명령·이름은 여기에만** — 문서 폴더 `config.json` 에 적으면 무시하고 `docbench status`·`serve` 가 경고한다. git·OneDrive·공유 폴더로 퍼지는 문서 폴더에 누가 명령을 넣어도 남의 PC 에서 돌지 않고, PC 마다 다른 경로가 공유 파일에 섞이지 않는다.

  ```json
  {
    "user": "김철수",
    "assistant": { "command": "C:/Users/me/.local/bin/claude.exe" },
    "dataHome": "C:/tools/docbench/docbench-기록",
    "workspaces": {
      "D:/work/docs": { "notify": { "command": ["node", "D:/dashboard/scripts/notify-terminal.mjs"] } },
      "D:/team/spec": { "data": "E:/records/spec" }
    }
  }
  ```

  맨 위 값이 이 PC 의 모든 작업 폴더 기본값, `workspaces["<문서 폴더 경로>"]` 가 그 폴더만 덮는다(`/`·`\\` 와 대소문자는 Windows 에서 같게 본다). `dataHome` 은 기록 보관함, `workspaces[…].data` 는 그 폴더의 기록 폴더(`docbench link <폴더> --data <기록 폴더>`·실행기가 적는다). 바꾸면 `serve` 를 다시 시작한다.
- 폴더가 git 저장소면 "커밋본 대비 변경"과 폴더 지도의 커밋 안 됨 표시가 자동으로 켜진다.
- 상시 실행은 작업 스케줄러(로그온 시 시작)나 대시보드의 프로세스 관리자에 `node C:\tools\docbench\bin\docbench.mjs serve D:\work\docs` 를 등록한다.
- `npm install` 이 막힌 PC: 방식 E 는 `release/docbench.html` 파일 하나면 된다. CLI·서버가 필요하면 인터넷이 되는 곳에서 `npm pack` 으로 만든 `docbench-<버전>.tgz`(빌드 포함)를 가져와 풀고, 그 폴더에서 `npm install --omit=dev --ignore-scripts`(iconv-lite 만 받는다. `--ignore-scripts` 가 없으면 다시 빌드하려다 실패).

## 3. 방식별 붙이기

### A. iframe

```powershell
node bin\docbench.mjs serve D:\work\docs --allow-origin http://localhost:3000
```

```html
<iframe src="http://127.0.0.1:4317/" style="width:100%;height:100%;border:0" title="문서 작업대"></iframe>
```

`--allow-origin` 에 준 출처만 화면을 iframe 으로 담을 수 있다(`frame-ancestors`). 토큰을 쓰면 `src="…/?token=<토큰>"`.

### B. 웹 컴포넌트 + 프록시

대시보드 프런트에:

```js
import 'docbench/style.css';               // 또는 <link rel="stylesheet" href=".../dist/docbench.css">
import { defineElement } from 'docbench';  // 또는 <script src=".../dist/docbench.iife.js"> → DocBench.defineElement()
defineElement();
```

```html
<doc-bench api="/docbench/api" theme="auto" style="height:100%"></doc-bench>
```

대시보드 개발 서버·리버스 프록시에서 `/docbench/api/*` → `http://127.0.0.1:4317/api/*` 로 넘긴다. Vite 예:

```js
// vite.config.js
server: { proxy: { '/docbench/api': { target: 'http://127.0.0.1:4317', rewrite: (p) => p.replace(/^\/docbench/, '') } } }
```

SSE(`/api/events`)가 지나가야 하므로 프록시 버퍼링을 끈다(nginx: `proxy_buffering off;`). 서버가 `X-Accel-Buffering: no` 를 보낸다.
**Host 헤더는 브라우저가 보낸 그대로 넘긴다** — `localhost`·`127.0.0.1` 은 기본 통과하고, 사내 호스트 이름으로 열면 `--allow-host <이름>`. 프록시가 Host 를 `127.0.0.1` 로 바꿔 쓰면 DNS rebinding 막기용 검사가 꺼진다.
토큰은 `DOCBENCH_TOKEN` 환경 변수로 serve 에 주고(명령줄은 프로세스 목록에 보인다) 프록시가 `Authorization` 을 붙인다. 쓰는 메서드는 GET·POST·PUT·PATCH·DELETE.

### C. Node 백엔드에 끼우기

```js
import { Workspace, createDocBenchHandler } from 'docbench/server';

const ws = await new Workspace('D:/work/docs').init();   // 기록은 문서 폴더 밖(기록 보관함/docs) — 다른 자리면 { dataDir: 'E:/records/docs' }
await ws.reconcileAll();                      // 꺼져 있던 동안 바뀐 파일을 이력에 남긴다
const docbench = createDocBenchHandler(ws, { base: '/docbench/api', ui: false /*, runs: true — Claude 작업(§6), 이 PC 사람 한 명이 쓸 때만 */ });

app.use((req, res, next) => docbench(req, res) || next());   // Express
// Fastify: fastify.addHook('onRequest', (req, reply, done) => docbench(req.raw, reply.raw) ? reply.hijack() : done());
```

프런트는 B 와 같다. 끌 때 `docbench.close()` (감시·SSE 정리).

- `package.json` 에 `file:` 의존성으로 넣지 말고 상대 경로로 import 한다(`await import(pathToFileURL(…/vendor/docbench/server/index.mjs).href)`) — `file:` 은 개발 도구까지 딸려 온다.
- `app.use('/docbench/api', …)` 처럼 경로를 붙여 걸지 않는다 — Express 가 `req.url` 에서 그 경로를 떼어 처리기가 못 알아본다. 위처럼 경로 없이 건다.
- **본문 파서·압축보다 앞에** 끼운다. 처리기는 요청 본문을 직접 읽으므로 `express.json()` 이 먼저 읽으면 PUT·POST 가 응답 없이 멈추고, 압축 미들웨어는 SSE 를 모아 화면이 실시간으로 안 바뀐다. 인증 미들웨어 뒤는 괜찮다.
- CommonJS 대시보드: `const { Workspace, createDocBenchHandler } = await import('docbench/server')` (DocBench 는 ESM).
- 브라우저 주소의 호스트 이름이 localhost 가 아니면 `allowHosts: ['그 이름']`.

### E. 단일 HTML (서버 없음)

```html
<!-- 대시보드가 release/docbench.html 을 같은 출처의 /docbench/ 로 내준다 -->
<iframe src="/docbench/?lang=ko" title="문서 작업대" style="border:0;width:100%;height:100%"></iframe>
```

- 사람이 처음 한 번 **폴더 열기**로 문서 폴더를, 이어서 **기록 보관함**(문서 폴더 밖 빈 폴더 — 예: HTML 옆 `docbench-기록`)을 고르고 권한을 허락한다. 보관함 아래에 문서 폴더 이름의 기록 폴더가 생기고 문서 폴더에는 아무것도 생기지 않는다. 팀이 git 으로 기록을 함께 쓰면 "문서 폴더 안에 두기"(`.docbench`). 예전 판의 안쪽 기록이 있으면 "보관함으로 옮기기"를 고를 수 있다.
- 대시보드 주소로 내주면 두 폴더를 기억해 다음부터 바로 열린다(브라우저가 "항상 허용"을 기억하지 않으면 "다시 열기" 한 번). 파일로 바로 열면 기억하지 않아 매번 두 폴더를 고른다(고르기 창은 지난 자리에서 열린다).
- 같은 출처여야 한다(다른 출처 iframe 은 폴더 고르기가 막힌다). 그 경로에는 대시보드의 전역 CSP 대신 파일 안의 CSP(인라인 스크립트 허용·네트워크 차단)가 적용되게 한다.
- 터미널의 Claude Code 는 같은 폴더를 CLI 로 다룬다(§5). 화면은 몇 초 안에 따라온다.
- 대시보드 없이 파일을 바로 열어도 된다(`file://` 도 쓰기 가능). 주소창 `?pick` = 기억한 폴더 대신 처음 화면, `?lang=en`, `?name=이름`.
- 터미널 Claude·실행기가 그 기록을 찾으려면 문서 폴더 ↔ 기록 폴더 짝을 이 PC 의 설정에 한 번 적는다: 실행기 설치 문구가 하고, 손으로는 `docbench link "<문서 폴더>" --data "<보관함>\<문서 폴더 이름>"`.

### D. 계약만 구현

`docs/openapi.yaml` 의 엔드포인트를 구현하면 `createRestAdapters({ base })` 가 그대로 붙는다. 꼭 지킬 것:
판 비교(`baseVersion` 다르면 409 + `current`), 피드백 `version` 비교, 줄바꿈은 LF 로 주고받기, 변경 알림(SSE 또는 폴링).
화면만 쓰고 어댑터를 직접 짜도 된다 — `src/types.ts` 의 `DocBenchAdapters` 를 채워 `createDocBench(el, { adapters })`.

## 4. 대시보드와 엮기

```js
const el = document.querySelector('doc-bench');
el.addEventListener('docbench:doc:saved', (e) => { /* e.detail.docId, version — 대시보드 알림·빌드 트리거 */ });
el.addEventListener('docbench:assistant:requested', (e) => { /* 터미널 패널을 앞으로 */ });
el.navigate('docs/runbook.md');                    // 다른 패널에서 문서 열기
el.setAttribute('theme', 'dark');                  // 대시보드 테마 따라가기
```

- 단축키는 작업대에 초점이 있을 때만 먹는다(대시보드 입력과 안 부딪힘). 전역으로 쓰려면 `el.options = { shortcuts: 'global' }` 를 연결 전에.
- 화면 크기는 끼워진 **패널 폭**을 따른다(컨테이너 쿼리). 높이는 부모가 정한다: 세로 flex 부모 안에서 `style="flex:1;min-height:0"`, 또는 높이가 정해진 부모 안에서 `height:100%`(부모가 내용 따라 늘어나는 칸이면 `contain:size` 를 더한다). 요소의 `display` 는 정하지 않는다(요소가 flex 로 둔다 — `block` 을 주면 높이를 못 채우고 긴 문서가 안에서 스크롤되지 않는다). 최소 높이 420px.
- 테마는 대시보드가 한 테마로 고정이면 그 값(`theme="light"`), OS 를 따라가는 대시보드만 `auto`. IIFE 는 스타일을 스스로 넣으므로 CSS `<link>` 는 `injectStyles: false` 일 때만.
- 대시보드의 전역 CSS(`header {…}`, `.card h2 {…}`, `button {…}` 등)는 작업대 안으로 새지 않는다 — 안쪽 요소를 브라우저 기본값으로 되돌린 뒤 작업대 규칙만 얹는다(e2e 로 확인). 예외는 **id 선택자**(`#app h2`)처럼 아주 강한 규칙뿐이니, 그런 대시보드면 작업대를 그 id 밖에 두거나 방식 A 를 쓴다.
- 색·글꼴은 토큰으로 맞춘다: `doc-bench { --db-go: #0050b3; --db-font-body: "사내 글꼴", sans-serif; }` (전체 목록은 `src/ui/styles.css` 맨 위).
- 대시보드의 CSP 가 `style-src` 에 nonce 를 요구하면 CSS 파일을 `<link>` 로 넣고 `injectStyles: false`, 또는 `styleNonce` 를 넘긴다.

## 5. 터미널의 Claude Code 와 잇기

기본 흐름(권장): 사람이 화면에서 피드백 → **"Claude에게 넘기기"** → 대시보드 터미널의 Claude Code 에서 `/docbench-feedback`.

- 넘기기는 기록 폴더 `inbox/req-*.json` 에 요청을 남긴다. 스킬이 `docbench inbox` 로 그것부터 읽고 끝나면 비운다.
- 대시보드 터미널의 현재 폴더가 문서 폴더가 아니면 터미널 환경에 `DOCBENCH_ROOT=D:\work\docs` 를 넣어 둔다(CLI 가 거기서 찾는다).
- 터미널을 자동으로 깨우려면 **이 PC 의 설정**(§2)의 `workspaces["<문서 폴더>"].notify.command` 에 명령을 적는다(서버 방식 A·B·C). 명령은 문서 폴더를 현재 폴더로, 서버 프로세스의 환경 변수를 물려받아 셸 없이 실행된다. 넘기기 때 그 명령이
  `DOCBENCH_REQUEST`(요청 파일 경로)·`DOCBENCH_ROOT` 환경변수를 받고 실행된다. **대시보드가 이미 Claude 터미널을 띄워 두고 입력을 밀어 넣을 수 있으면**
  그 API 를 부르는 작은 스크립트를 거는 것이 가장 자연스럽다 — 떠 있는 세션이 `/docbench-feedback` 을 받는다.
- 단일 HTML(E)의 넘기기는 이 PC 의 실행기가 켜져 있으면 Claude 작업으로(§6), 없으면 요청함 파일만 남긴다(명령 실행 없음 — 작업 창의 "터미널 Claude Code 로 직접"이 붙여 넣을 한 줄을 복사해 준다).
- 대화하며 처리하고 싶으면 이 길(터미널), 맡겨 두고 결과만 보려면 Claude 작업(§6). 둘이 같은 피드백을 동시에 잡아도 판 비교로 한쪽만 반영된다.

**무인 처리** — 이제는 §6 Claude 작업을 권한다(Claude 에게 읽기 도구만, 반영은 서버가 판 비교로). 아래 `notify.command` 로 도구를 다 가진 `claude -p` 를 띄우는 길은 신뢰하는 사람만 피드백을 다는 폴더에서만 — 이 PC 의 설정에:

```json
"workspaces": { "D:/work/docs": { "notify": {
  "command": ["C:/Users/me/.local/bin/claude.exe", "-p",
    "docbench-feedback 스킬 순서대로 넘기기 요청(docbench inbox)을 처리하라. 확실하지 않으면 고치지 말고 되물어라.",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Bash(docbench *)", "Bash(node *docbench.mjs *)", "Read",
    "--max-turns", "40", "--permission-prompts", "none", "--no-session-persistence"]
} } }
```

화면에 보일 안내는 함께 쓰는 문서 폴더 `config.json` 에: `"notify": { "message": "Claude 가 백그라운드에서 처리합니다. 결과는 이 화면에 뜹니다." }`.

명령은 한 번에 하나만 돈다. 출력은 기록 폴더 `inbox/req-*.json.log` 에 남으니, 무인 실행이 실패하면 거기서 원인을 본다. 실행 파일을 못 찾으면 화면에 그 이유가 바로 뜬다.
플래그는 Claude Code CLI 문서 기준이다(code.claude.com/docs/en/cli-reference). `-p` 에서 스킬이 자동으로 쓰이는지는 환경에서 한 번 확인한다 — 안 되면 프롬프트에 스킬 순서를 직접 적는다.
`--permission-prompts none` 은 v2.1.259 이상.

## 6. Claude 작업 켜기 (백그라운드 처리 · Claude 제안)

화면 아래 **"Claude 작업"** 창: 피드백을 넘기면(또는 카드의 "Claude 제안") Claude 가 백그라운드에서 처리하고 진행 로그가 실시간으로 보인다. 모델·노력·방식(Claude 판단 / 제안만)을 고른다.
구독 로그인(Max·Team 등)을 그대로 쓴다 — API 키가 필요 없다.

| 방식 | 누가 claude 를 띄우나 | 할 일 |
|---|---|---|
| A·B (`docbench serve`) | serve 가 직접 | 없음 — `claude` 가 PATH 에 있으면 켜진다(다른 곳이면 이 PC 의 설정 `assistant.command`). 끄려면 `--no-claude` |
| C (처리기 끼우기) | 대시보드 서버 프로세스가 직접 | **기본 끔** — 이 PC 사람 한 명이 쓰는 대시보드면 `createDocBenchHandler(ws, { …, runs: true })` |
| E (단일 HTML) | 이 PC 의 **실행기**(`docbench runner`) | 한 번 켜 둔다 — 화면의 Claude 작업 창이 Claude Code 에 붙여 넣을 설치 문구를 준다(CLI 파일 하나를 받아 지문 확인 → `runner <문서 폴더> --data <기록 폴더> --detach`(기록 짝을 이 PC 의 설정에 적는다) → 원하면 `--startup on`) |

단일 HTML 은 **화면 이름과 같은 사용자의 실행기만** 저절로 고른다(실행기의 사용자 = 이 PC 의 설정 `user`, 없으면 Windows 로그인 이름). 이름이 다르면 창이 "내 실행기 아님"으로 알리고, 내 것이면 한 번 고르면 기억한다 — 폴더를 함께 쓰는 동료의 실행기가 내 작업을 집어 가지 않게.
| D (계약 구현) | 그 백엔드 | 선택 — `/runs*` 를 구현하면 창이 켜진다(`session.features.runs`). 없으면 창 없이 예전 "넘기기"·"AI 제안" |

- **이 PC 사람 한 명이 쓰는 서버에서만 켠다.** 여러 사람이 붙는 공용 서버면 끈다 — 서버 PC 의 claude 가 그 계정으로 돈다.
- 실행: 문서 폴더 밖에서 `claude -p --restricted --safe-mode --permission-mode dontAsk --tools Read,Grep,Glob --add-dir <문서 폴더> …`. Claude 는 문서 폴더 안을 **읽기만** 하고 고친 글을 정해진 모양으로 돌려준다. 반영은 서버·실행기가 판 비교로 한다(그 사이 사람이 고친 섹션은 덮지 않고 제안으로). 이유와 실측은 [SECURITY.md](SECURITY.md#ai-호출).
- 필요한 Claude Code: `claude --help` 에 `--restricted`·`--safe-mode` 가 있는 판(2.1.293 에서 확인). 없으면 실행하지 않고 "업데이트 필요"를 띄운다.
- 이 PC 의 설정(§2):

```json
"assistant": { "command": "C:/Users/me/.local/bin/claude.exe", "timeoutSec": 900, "model": "sonnet" }
```

  `command` 는 PATH 의 `claude` 면 빼도 된다(npm 설치본 `claude.cmd` 는 옆의 `cli.js` 를 node 로 부른다). `timeoutSec` 는 작업 하나의 상한(기본 900), `model` 은 화면에서 "기본"을 골랐을 때.
- 실행기 명령: `docbench runner <폴더>`(앞에서, Ctrl+C 로 끔) · `--detach`(창 없이 뒤에서, 로그는 이 PC 의 설정 폴더 `logs/`) · `--status` · `--stop` · `--startup on|off`(Windows 로그인 때 자동). 실행기 하나 = 폴더 하나.
- 문제를 살펴볼 때 `DOCBENCH_RUN_DEBUG=1` 로 켜면 Claude 의 결과를 기록 폴더 `runs/<id>.out.json` 에 그대로 남긴다.

**예전 "AI 제안"**(`POST /assistant/propose`, 섹션 하나 → 제안 하나)은 REST 계약을 위해 남아 있다. 화면은 Claude 작업이 있으면 그 길을 쓴다. 이 길도 이제 문서 폴더 밖에서 `--restricted --safe-mode` 로 띄운다(0.2.0 은 문서 폴더 안에서 띄워 그 폴더의 훅이 실행될 수 있었다 — SECURITY.md).

## 7. 확인 목록

| 확인 | 방법 |
|---|---|
| 서버·화면 | `http://127.0.0.1:4317/` 에서 문서가 열리고 접기 상태가 새로고침 뒤에도 남는다 |
| 인코딩 | 실제 업무 문서(CP949 의 똠·햏 같은 확장 음절, UTF-8 BOM, UTF-16, CRLF)를 한 섹션 고쳐 저장 → 다른 편집기에서 글자·줄바꿈이 그대로. 메모장에서 고친 문서도 한 번 |
| 외부 편집 | 편집기로 문서를 고치면 화면에 바뀐 글이 표시된다(서버는 바로, 단일 HTML 은 몇 초·창으로 돌아오면 바로) |
| CLI 왕복 | 화면 피드백 → `docbench fb list --waiting assistant` 에 보임 → `fb reply --resolve` → 화면 카드가 반영됨 |
| Claude 가 고친 문서 | `docbench doc write …` 뒤 가만히 둔 화면이 새 글을 보여 준다 (서버 바로, 단일 HTML 몇 초) |
| Claude 작업 | 피드백 → "Claude에게 넘기기" → 창에 "연결됨" → 모델·노력 골라 시작 → 로그가 흐르고 끝나면 문서에 바뀐 글(초록·취소선, 누가: Claude)과 카드 회신 |
| Claude 제안 | 섹션 피드백 카드의 "Claude 제안" → 작업 창에 진행 → 카드에 제안 → 차이 → 적용 |
| 도구 밖 수정 | 편집기·터미널에서 고친 뒤 화면으로 돌아오면 그 문서는 바로, 다른 문서는 목록에 "바뀜". 편집 중에 바뀌면 내 글이 지켜진다 |
| 보안 | 다른 PC 에서 4317 이 안 열린다(기본 127.0.0.1). 프록시 뒤라면 `--token` |
| 회귀 | `npm run check` |

## 8. 문제 풀이

- **`claude 실행 파일을 찾지 못했습니다`**: `where claude` 로 경로를 찾아 이 PC 의 설정 `assistant.command` 에 `.exe` 전체 경로.
- **Claude 작업 창이 "실행기 꺼짐"**(단일 HTML): `docbench runner --status "<폴더>"` 로 확인, `--detach` 로 켠다. 켰는데도 꺼짐이면 실행기와 화면이 같은 기록 폴더를 보는지(실행기는 기록 폴더 `runners/` 에 4초마다 적는다 — `docbench status` 의 "기록:" 과 화면 왼쪽 아래 "기록:" 을 맞춰 본다), 로그(`%LOCALAPPDATA%\docbench\logs\`)를 본다.
- **CLI 가 "이 문서 폴더의 기록을 찾지 못했습니다"**(종료 코드 2): 브라우저로만 쓰던 폴더라 기록 짝이 아직 없다 — `docbench link "<문서 폴더>" --data "<기록 보관함>\<문서 폴더 이름>"`(실행기 설치 문구도 이것을 한다).
- **"다른 문서 폴더의 기록입니다"**: 이름이 같은 다른 문서 폴더가 이미 보관함의 그 이름을 쓰고 있다 — `link … --data <다른 자리>` 로 따로 둔다.
- **"Claude Code 업데이트 필요"**: `claude update` — `--restricted`·`--safe-mode` 가 없는 판. 1분 안에 다시 확인한다.
- **작업이 "실패: 고친 글(text)이 비어 있습니다"**: 모델이 고친 글을 빼먹었다(작은 모델·낮은 노력에서 가끔 — 실측). 피드백은 Claude 차례로 남아 있으니 모델·노력을 올려 다시 넘긴다.
- **제안·넘기기 명령이 안 돈다, `status` 에 "주의"**: 명령을 문서 폴더 `config.json` 에 적었다 → 이 PC 의 설정(`%LOCALAPPDATA%\docbench\config.json`)으로 옮긴다. `docbench status` 가 그 파일 위치를 보여 준다.
- **저장이 계속 409**: 다른 프로그램(동기화 도구 등)이 저장 직후 파일을 다시 쓰는지 본다. `changes.jsonl` 의 `by: external` 줄이 단서.
- **`EPERM`/`EBUSY`**: 편집기·백신·동기화 도구가 파일을 잡고 있다. 서버가 임시 파일 → 바꿔치기를 몇 번 재시도하고, 계속 막히면 그 파일에 직접 쓴다(원자성 대신 저장 성공을 택함 — 직전 판 본문은 `.docbench/blobs/` 에 있다). 그것도 막히면 오류.
- **화면이 실시간으로 안 바뀜**: 프록시가 SSE 를 버퍼링한다. 안 되면 `createRestAdapters({ live: 'poll' })`.
- **한글이 깨져 보임 / 읽기 전용**: 지원은 UTF-8(BOM 유무)·UTF-16LE(BOM)·CP949(EUC-KR). 문서 머리의 안내가 이유를 말한다(깨진 바이트가 섞인 UTF-8, `iconv-lite` 없음 등).

## Claude Code 에게 맡기기

**1) 스킬 깔기** — 대시보드를 관리하는 PC 의 터미널에서 한 번(git 필요):

```powershell
claude plugin marketplace add d-j-lee/docbench
claude plugin install docbench@docbench
```

GitHub 에 못 나가면 저장소 ZIP 을 풀어 `claude plugin marketplace add C:\tools\docbench` (로컬 폴더), 또는
`integrations\claude-code\skills\` 아래 두 폴더를 `%USERPROFILE%\.claude\skills\` 로 복사한다. 갱신은 `claude plugin marketplace update docbench` → `claude plugin update docbench@docbench`.
claude.ai 계정에 저장한 스킬은 **그 계정으로 로그인한** Claude Code 에만 내려온다 — 회사 계정으로 쓰는 PC 에는 위 방법으로 깐다.

**2) 맡기기** — 대시보드 폴더에서 연 Claude Code 에(`< >` 만 채운다):

```
/docbench-setup 이 대시보드에 문서 작업대를 붙여 줘.
- 문서 폴더: <D:\work\docs>
- 패널 위치: <사이드 패널 / 새 탭 / …>
- 대시보드 테마를 따라가게, 저장 이벤트는 <대시보드 알림>으로.
- 넘기기: <요청함만 / 대시보드의 Claude 터미널에 /docbench-feedback 입력>.
```

스킬은 대시보드의 언어·미들웨어·프록시·CSP·터미널 연동을 먼저 살펴 표로 보여 주고, 방식(C·B·E…)을 근거와 함께 고른 뒤 붙이고, §7 확인 목록을 실제로 돌려 `[실측]`/`[미확인]` 표로 보고한다.
대시보드가 git 저장소가 아니면 바꾸기 전에 되돌릴 방법(로컬 `git init` 또는 백업)을 묻는다.
