# 이식 가이드 — 웹 대시보드에 문서 작업대 붙이기

대상: Windows PC 에서 도는 **로컬 웹 대시보드**(백엔드 언어는 제각각, 대시보드 자체도 Claude Code 로 관리)에 DocBench 를
"문서 보기·피드백·편집" 탭으로 넣는 경우. 문서는 로컬 드라이브에 있다.

이 문서는 사람과 Claude Code 가 같이 읽도록 썼다. 가장 빠른 길은 대시보드를 관리하는 Claude Code 에 **`docbench-setup` 스킬**을 깔고 맡기는 것이다 —
대시보드를 먼저 살피고, 방식을 골라 붙이고, §7 확인까지 한다([맨 아래](#claude-code-에게-맡기기)).

## 1. 먼저 고를 것 — 어떻게 붙일까

| 방식 | 대시보드 쪽 일 | 맞는 경우 | 주의 |
|---|---|---|---|
| **T. 앱 탭 (권장)** | 백엔드는 파일 둘(`app-token`·`app.json`)을 읽어 페이지에 넣기만. 프런트는 `host.js` 를 싣고 탭마다 `DocBenchHost.mount(el, { root, key })` | 백엔드 언어와 상관없이. 탭마다 다른 폴더 | PC 마다 DocBench 앱을 켜 둔다(Node 20.11+, CLI 파일 하나). 대시보드를 **앱이 도는 그 PC 의 브라우저**로 볼 때만 |
| C. Node 처리기 | `app.use(handle)` 몇 줄 + 웹 컴포넌트 | 백엔드가 Node 이고 프로세스를 하나로, 대시보드 인증을 DocBench API 에도 | 미들웨어 순서(§3 C) |
| B. 곁 프로세스 + 프록시 | `docbench serve` 를 띄우고 `/docbench/api` 프록시 + 웹 컴포넌트 | Node 가 아닌 백엔드에서 웹 컴포넌트를 대시보드 DOM 에 직접(같은 출처) | 프록시가 메서드·헤더·SSE 를 그대로 넘겨야 |
| E. 단일 HTML | `release/docbench.html` 을 같은 출처로 내주고 `<iframe>` | 서버 프로세스를 늘릴 수 없을 때 | 몇 초 간격 확인, 엣지·크롬 + 보안 문맥. Claude 작업은 결국 앱이 필요 |
| A. `serve` 화면 iframe | `<iframe src="http://127.0.0.1:4317/">` | 오늘 보기만 | 폴더 하나, 대시보드와 이벤트 없음 |
| D. 계약 구현 | 백엔드가 `docs/openapi.yaml` 구현 | 문서가 DB·사내 시스템에 있을 때 | 일이 가장 많음 |

**권장은 T.** 대시보드가 Python·Java·.NET·Node 무엇이든 백엔드가 고칠 것은 "열쇠 파일을 읽어 페이지에 넣기" 하나다.
VS Code 확장처럼 탭에 꽂히고, 테마·이동·할 일 수(탭 배지)·보내기(대시보드의 터미널로)를 주고받는다.
Claude 작업(백그라운드 처리)도 앱이 맡으므로 대시보드가 claude 를 띄울 일이 없다.

다른 방식을 고를 때: 대시보드를 다른 PC 에서 접속하는 서버로 돌린다(T 는 보는 사람 PC 의 앱에 붙는다 → B·C·D, Claude 작업은 끈다 — §6),
DocBench API 도 대시보드 인증을 타야 한다(C·B), 문서가 파일이 아니다(D). 모두 같은 기록 폴더 모양을 쓰므로 나중에 방식을 바꿔도 피드백은 이어진다.

## 2. 앱 탭 (권장)

```
대시보드 페이지 (예: http://localhost:3000)          DocBench 앱 (http://127.0.0.1:4317 — 이 PC 에 하나)
─────────────────────────────────────────          ────────────────────────────────────────────────
<script src="<앱>/host.js">                   ◀──  /host.js            (열쇠 없이)
DocBenchHost.mount(탭, { root, key })         ──▶  <iframe src="<앱>/embed?root=…&t=열쇠">   frame-ancestors: 허용한 출처만
onTodo · onHandoff · onEvent                  ◀─▶  postMessage          (앱 출처 ↔ 허용한 출처만, id·상태만)
백엔드: app-token·app.json 을 읽어 페이지에             작업 공간마다 Claude 작업 엔진 (읽기 도구만, 반영은 앱이)
```

### 2.1 이 PC 에 앱 켜기 (한 번)

CLI 는 파일 하나(`docbench.mjs` — 앱 화면까지 들어 있다)다. 판을 고정해 받는다: 태그 `v<판>` 의 `release/docbench.mjs`
(GitHub Release 첨부와 같은 파일), 플러그인을 깔았으면 그 안 `cli/docbench.mjs`, 저장소를 받았으면 `bin/docbench.mjs`.
두는 자리는 `%LOCALAPPDATA%\docbench\docbench.mjs` 를 권한다 — 단일 HTML 의 Claude 연결 안내가 두는 자리와 같고,
로그인 때 켜기·바로가기는 경로에 영문이 아닌 글자가 있으면 만들지 않는다.

```powershell
$dir = "$env:LOCALAPPDATA\docbench"; New-Item -ItemType Directory -Force $dir | Out-Null
$cli = "$dir\docbench.mjs"
Invoke-WebRequest -Uri https://raw.githubusercontent.com/d-j-lee/docbench/v0.5.0/release/docbench.mjs -OutFile $cli
Get-FileHash -Algorithm SHA256 $cli                    # 받은 판의 지문 — 기록해 두고 갱신 때 비교

node $cli app --detach                                 # 켜기. 이미 켜져 있으면 그대로, 판이 다르면 새 판으로 다시 켠다
node $cli app --allow-origin http://localhost:3000     # 대시보드 출처 허용 (주소창에 보이는 그대로, 여럿이면 쉼표)
node $cli app --startup on                             # 로그인 때 켜기 (Windows)
node $cli app --status                                 # 주소·작업 공간·Claude 상태 (--json 이면 허용 출처까지)
```

- `--port N`: 기본 4317. `--port` 없이 켰는데 4317 을 다른 프로그램이 쓰면 다음 번호로 켠다(10번까지) — 실제 주소는 `--status` 와 `app.json`. 그래서 대시보드는 주소를 `app.json` 에서 읽는다. `--port` 를 줬는데 쓰이고 있으면 켜지 않는다.
- `--allow-origin` 은 이 PC 의 설정 `app.allowOrigins` 에 **더한다**(쌓인다). 켜진 앱은 몇 초 안에 따른다. 빼는 명령은 없다 — 이 PC 의 설정 `config.json` 에서 지운다. `scheme://host[:port]` 모양만 받는다(경로 없이). `http://localhost:3000` 과 `http://127.0.0.1:3000` 은 다른 출처다.
- `--startup on|off`·`--shortcut on|off`(시작 메뉴 "DocBench" — 꺼져 있으면 켜고 연다)는 Windows 만. macOS·Linux 는 로그인 항목·systemd 에 `app --detach` 를 건다.
- `--open` 앱 화면을 연다(폴더 더하기·합치기·빼기, 표시 이름) — 열쇠 대신 2분 동안 한 번 쓰는 열기 코드를 실어 명령 줄·방문 기록에 열쇠가 남지 않는다. C:\·홈처럼 이 PC 의 DocBench 설정을 품는 폴더는 더하지 않는다(그 아래 폴더를 더한다). `--stop` 끈다. 로그는 이 PC 의 설정 폴더 `logs\app.log`.
- 앱의 사람은 이 PC 의 로그인(이 PC 의 설정 `user` 가 있으면 그것), 표시 이름은 화면 오른쪽 위 "나". Claude 작업 조건은 §6.

### 2.2 대시보드 백엔드 — 열쇠를 읽어 페이지에 넣기

이 PC 의 설정 폴더(Windows `%LOCALAPPDATA%\docbench\`, macOS `~/Library/Application Support/docbench/`, Linux `$XDG_CONFIG_HOME/docbench/` — 기본 `~/.config/docbench/`, 환경 변수 `DOCBENCH_HOME` 이 있으면 거기):

| 파일 | 내용 |
|---|---|
| `app-token` | 앱 열쇠(16진 한 줄). 앱을 처음 켤 때 만들고 그 뒤로 그대로다 |
| `app.json` | 켜져 있는 동안만: `{ "pid", "port", "url", "version", "startedAt" }`. 끄면 지운다 |

Python 예 — 다른 언어도 같은 일이다:

```python
import json, os, sys
from pathlib import Path

def docbench_dir() -> Path:
    if os.environ.get("DOCBENCH_HOME"):
        return Path(os.environ["DOCBENCH_HOME"])
    if sys.platform == "win32":
        return Path(os.environ["LOCALAPPDATA"]) / "docbench"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/docbench"
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "docbench"

def docbench_app():
    """(앱 주소, 열쇠) — 앱이 꺼져 있으면 (None, None). 페이지를 그릴 때마다 읽는다"""
    d = docbench_dir()
    try:
        url = json.loads((d / "app.json").read_text(encoding="utf-8"))["url"]
        return url, (d / "app-token").read_text(encoding="ascii").strip()
    except (OSError, ValueError, KeyError):
        return None, None
```

페이지를 그릴 때마다 읽는다(앱을 다시 켜 포트가 바뀌어도 따라가게). 앱이 정말 답하는지는 `GET <url>api/app/info`(헤더 `Authorization: Bearer <열쇠>`) — 응답의 `allowOrigins` 에 이 대시보드 출처가 있는지도 여기서 본다. Node 로 짠 전체 예: [examples/dashboard-tab](../examples/dashboard-tab/).

**열쇠 다루기** — 이 열쇠가 있으면 앱 API 로 이 PC 의 어느 폴더든 작업 공간으로 더해 그 안의 문서를 읽고 고칠 수 있다(이 사용자의 권한으로).

- 이 PC 의 브라우저에만 준다: 대시보드가 `127.0.0.1` 에만 열려 있고 **Host 헤더를 검사**할 때(`localhost`·`127.0.0.1` 만 — 다른 사이트가 자기 이름을 127.0.0.1 로 돌려 이 페이지를 읽는 DNS rebinding 을 막는다). 대시보드가 `0.0.0.0`·사내망에 열려 있으면 열쇠를 넣지 않는다.
- 열쇠가 든 응답에는 `Cache-Control: no-store`, `Access-Control-Allow-Origin` 은 달지 않는다. 정적 파일·빌드 산출물·로그·오류 보고에 남기지 않는다.
- 바꾸려면 앱을 끄고(`app --stop`) `app-token` 을 지운 뒤 다시 켠다. 대시보드는 다음 페이지에서 새 열쇠를 읽는다(열어 둔 앱 화면은 `app --open` 으로 다시).

### 2.3 탭에 끼우기

```html
<div id="docs-tab" style="height:100%"></div>
<script src="http://127.0.0.1:4317/host.js"></script>   <!-- 주소는 app.json 의 url 로 — 4317 을 박아 두지 않는다 -->
<script>
  const bench = DocBenchHost.mount(document.getElementById('docs-tab'), {
    root: 'D:\\work\\proj',            // 이 탭의 폴더 (전체 경로 — 백엔드가 넣으면 JSON 으로)
    key: '{{ docbench_key }}',         // 백엔드가 넣은 열쇠
    theme: 'dark',
    onTodo: (c) => setBadge('docs', c.owner),                 // 볼 것 수 (c.draft 초안 · c.assistant 보냄)
    // 셸 터미널이면 req.command(설치 없이 새 Claude Code), 켜진 Claude 대화면 req.prompt(플러그인)
    onHandoff: async (req) => { await terminal.send((req.command || req.prompt) + '\r'); return { handled: true, message: '터미널로 보냈습니다' }; },
  });
  // 대시보드 테마가 바뀌면 bench.setTheme('light') · 다른 패널에서 문서 열기 bench.navigate('docs/runbook.md') · 탭을 없앨 때 bench.destroy()
</script>
```

| 선택 | 뜻 |
|---|---|
| `root` | 이 탭이 보여 줄 폴더의 전체 경로(필수). 처음 열면 앱의 작업 공간이 된다(아래) |
| `key` | 앱 열쇠. iframe 주소의 `?t=` 로 실린다 |
| `scope` | `root` 안에서 더 좁혀 볼 하위 폴더(`/` 로 구분) |
| `theme` | `auto`·`light`·`dark`(기본 `auto`). 대시보드가 한 테마로 고정이면 그 값 |
| `lang` | `ko`·`en`(없으면 브라우저 말) |
| `view` | 처음 열 문서 — 작업 공간 기준 경로(`docs/runbook.md`) 또는 `map`·`changes`·`home` |
| `tokens` | 색·글꼴 `{ '--db-go': '#0050b3', '--db-font-body': '"사내 글꼴", sans-serif' }` — 이름은 `--db-` 로 시작, 값은 색·글꼴 모양 글자만(그 밖은 버린다). 목록은 `src/ui/styles.css` 맨 위 |
| `title` | iframe 제목(기본 `DocBench`) |
| `app` | 앱 주소(기본: `host.js` 를 받은 곳) |
| `onTodo(c)` | `{ owner, assistant, draft }` — 볼 것·보냄·초안 수(보이는 범위). 바뀔 때만 온다 |
| `onHandoff(req)` | 보내기를 대시보드가 맡는다. `req = { feedbackIds, docs, prompt, command? }` → `{ handled, message? }`. `handled: false`·오류·15초 안에 답이 없으면 작업대가 스스로(앱의 Claude 작업 창 · 터미널 안내) |
| `onEvent(ev)` | 아래 이벤트 전부 |

돌려주는 것: `{ iframe, setTheme(t), setTokens(tokens), navigate(view), destroy() }`.

| 이벤트 `ev.type` | 실리는 것 |
|---|---|
| `navigate` | `view`(문서 경로 또는 `map`·`changes`·`home`) |
| `todo` | `owner`, `assistant`, `draft` |
| `feedback:created` · `feedback:updated` | `id`, `docId`, `status`, `waitingOn` |
| `doc:saved` | `docId`, `version` |
| `assistant:requested` | `feedbackIds` |
| `error` | `message` |

**`root` 를 열면 생기는 일** (D66)

- 앱이 그 폴더를 작업 공간으로 더한다(이 PC 의 설정 `workspaces["<폴더>"].added`). 기록은 기록 보관함(`dataHome`, 기본 `<이 PC 의 설정 폴더>\data\<폴더 이름>`)에 — 문서 폴더에는 아무것도 생기지 않는다. 문서 폴더 안에 `.docbench` 가 이미 있으면 그것을 쓴다.
- 이미 더한 작업 공간 **안**의 폴더면 새로 만들지 않고 그 작업 공간을 범위만 좁혀 연다(기록 한 벌). 프로젝트 폴더들이 한 폴더 아래 있으면 앱 화면에서 그 위 폴더를 먼저 한 번 더해 두면 좋다. 이때 `view`·`navigate` 의 경로는 그 넓은 작업 공간 기준이다(`navigate` 이벤트의 `view` 를 그대로 쓰면 맞다).
- 이미 더한 작업 공간을 **품는** 폴더면 열지 않고 "앱 화면에서 합친 뒤 다시 여세요"를 보인다 — `docbench app --open` → 폴더 추가 → 그 폴더 → 합치기.
- 더한 폴더는 앱 화면의 작업 공간 메뉴에도 보이고, "목록에서 빼기"로 뺀다(기록은 남는다).

`host.js` 없이 `<iframe src="<앱>/embed?root=<폴더>&t=<열쇠>">` 만 넣어도 뜬다(허용한 출처에서). 이벤트·대시보드로 보내기는 없다.

대시보드가 CSP 를 보내면 `script-src` 와 `frame-src` 에 앱 출처(`http://127.0.0.1:4317`)를 더한다.

### 2.4 보내기를 대시보드 터미널로

둘 중 대시보드 터미널에 맞는 것 하나를 쓴다:

- `req.command` — **셸 한 줄**(설치 없음, D76): `Set-Location -LiteralPath '<기록 폴더>'; claude 'DocBench 요청 <id> 를 처리해 줘 (runs/<id>.prompt.md).'`(macOS·Linux 는 `cd '<…>' && claude '…'`). 기록 폴더에서 새 Claude Code 를 켜고, 결과 파일을 앱이 받아 반영한다. 플러그인이 필요 없다. 화면이 터미널 요청을 만들 수 있을 때만 온다.
- `req.prompt` — **이미 켜진 Claude Code 대화**에 넣을 한 줄: `/docbench:docbench-feedback 문서 폴더 "<폴더 이름>" 에서 보낸 피드백 N건(<id>, …)을 처리해 줘.`(먼저 검토면 "… 의 문서를 먼저 읽고 제안·질문을 올려 줘.") — 플러그인 `docbench` 가 깔려 있어야 한다(스킬만 복사해 깔았으면 `/docbench-feedback` 으로 바꿔 보낸다). 이 길로 처리되면 함께 만든 터미널 요청은 저절로 닫힌다.
- 프롬프트에는 폴더 **이름**만 있다. 터미널이 그 폴더에서 시작하지 않았으면 대시보드가 경로를 덧붙이거나(`` `${req.prompt} 문서 폴더: ${root}` ``) 터미널 환경에 `DOCBENCH_ROOT=<폴더>`. CLI 는 앱이 더한 폴더의 기록을 스스로 찾는다.
- Enter 가 필요한 터미널 API 면 `\r` 를 붙인다. 보냈으면 `{ handled: true, message }` — 그 글이 작업대에 뜬다. 15초 안에 답한다.
- `onHandoff` 를 주지 않거나 `handled: false` 면 작업대가 스스로 처리한다(앱의 Claude 작업, 없으면 터미널 한 줄 안내 — §6). 대시보드가 상황에 따라 고를 수 있다 — 예: 터미널이 닫혀 있으면 `false`.
- 그 터미널 API 는 이제 자동 입력 통로다 — 다른 사이트가 부를 수 없게(전용 헤더 검사 등) 되어 있는지 본다.

### 2.5 무엇이 막아 주나

- 앱은 `127.0.0.1` 에만 열리고 Host 헤더를 본다(`localhost`·`127.0.0.1`·`::1` 이 아니면 403).
- API 는 모두 열쇠가 있어야 한다(`Authorization: Bearer`, 실시간 연결은 `?token=`). 바꾸는 요청은 `X-DocBench: 1` 헤더도. 쿠키는 쓰지 않는다 — 쿠키는 포트를 가리지 않아 같은 PC 의 다른 로컬 서버로도 실려 간다(D70).
- 끼우기: `/embed` 는 `frame-ancestors 'self' <허용한 출처>` 라 허용하지 않은 페이지는 끼우지 못한다. 앱 화면(`/`)은 어디에도 끼울 수 없다.
- 메시지: `host.js` 는 앱 출처에서 온, 자기가 만든 iframe 의 메시지만 받고 앱 출처로만 보낸다. 작업대는 허용한 출처의 부모 창과만 주고받는다(처음 인사 `hello` 하나만 출처를 정하지 않고 보낸다 — 비밀 없음).
- 대시보드로 가는 것은 id·상태·개수뿐이다 — 문서·피드백 본문은 없다. 보내기의 `prompt`·`command` 도 폴더 이름(또는 기록 폴더 경로)과 id 한 줄 — 본문·붙인 말은 기록 폴더의 요청 파일에만 있다. 대시보드가 주는 `tokens` 는 `--db-*` 이름과 색·글꼴 값만 받는다.
- 폴더 둘러보기 API 는 폴더 이름만 준다. 파일 내용은 더한 작업 공간 안에서만.
- 남는 위험은 열쇠가 든 대시보드 페이지다 — §2.2 의 열쇠 다루기.
- `host.js` 는 앱에서 받는 것이 기본이다(앱 판과 늘 맞게). 여러 사람이 로그인해 쓰는 PC 에서는 다른 프로그램이 앱보다 먼저 포트를 잡을 수 있으므로 `host.js` 를 대시보드에 복사해 두고 `mount({ app: '<app.json 의 url>' })` 로 주소를 준다. 자세한 위협과 대응은 [SECURITY.md](SECURITY.md)의 "DocBench 앱"·"대시보드 탭".

`http://localhost`·`http://127.0.0.1` 대시보드로 확인했다. https 나 사내 호스트 이름으로 여는 대시보드는 브라우저가 로컬 주소로 가는 스크립트·iframe 을 막을 수 있다(혼합 콘텐츠·로컬 네트워크 접근 제한) — 확인하지 않았다. 그런 대시보드는 먼저 시험하고, 막히면 B·C.

## 3. 다른 방식

### 공통 준비 (A·B·C·D)

```powershell
# 1) 받기·빌드 (Node 20.11 이상)
git clone https://github.com/d-j-lee/docbench C:\tools\docbench
cd C:\tools\docbench
git checkout v0.5.0  # 판 고정
npm install          # 빌드까지 한다. iconv-lite(선택 의존성)도 같이 깔린다 — CP949/EUC-KR 문서 저장에 필요

# 2) 문서 폴더 준비 (+ Claude Code 스킬)
node bin\docbench.mjs init D:\work\docs --claude

# 3) 켜 보기
node bin\docbench.mjs serve D:\work\docs --port 4317
```

- **기록 폴더**(피드백·이력·작업 기록): `init` 은 기본으로 문서 폴더 **밖**에 만든다 — 기록 보관함(이 PC 의 설정 `dataHome`, 없으면 `%LOCALAPPDATA%\docbench\data`) 아래 `<문서 폴더 이름>\`. 문서 폴더에는 아무것도 생기지 않는다(같은 폴더에서 일하는 다른 프로그램·다른 Claude 세션이 헷갈리지 않게, D57). 다른 자리면 `--data <폴더>`, 팀이 git 으로 함께 쓰려면 `--inside`(문서 폴더 안 `.docbench\`). 예전 판이 만든 `.docbench\` 가 있는 폴더는 그대로 안을 쓴다. `docbench status` 가 기록 자리를 보여 준다.
- `--claude` 는 문서 폴더에 `.claude\skills\docbench-feedback\` 를 복사한다 — 터미널 Claude 가 그 문서 폴더에서 시작할 때만 쓸모 있다(아니면 플러그인으로 깐다).
- `config.json`(기록 폴더, 함께 쓰는 설정): 그룹·문서별 제목·신뢰 표시·깊이(예: [examples/sample-workspace/.docbench/config.json](../examples/sample-workspace/.docbench/config.json)).
- **이 PC 의 설정**(Windows `%LOCALAPPDATA%\docbench\config.json`, macOS `~/Library/Application Support/docbench/`, Linux `~/.config/docbench/` — 문서 폴더 밖, 로밍되지 않는 이 PC 자리. `DOCBENCH_HOME` 으로 옮김. `docbench status` 가 위치를 보여 준다): 실행 명령 `assistant`·`notify.command`, 이름 `user`·표시 이름 `name`, 기록 자리, 앱의 허용 출처. **실행 명령·이름은 여기에만** — 문서 폴더 `config.json` 에 적으면 무시하고 `docbench status`·`serve` 가 경고한다. git·OneDrive·공유 폴더로 퍼지는 문서 폴더에 누가 명령을 넣어도 남의 PC 에서 돌지 않고, PC 마다 다른 경로가 공유 파일에 섞이지 않는다.

  ```json
  {
    "user": "kimcs",
    "name": "김철수",
    "assistant": { "command": "C:/Users/me/.local/bin/claude.exe" },
    "dataHome": "C:/tools/docbench/docbench-기록",
    "app": { "allowOrigins": ["http://localhost:3000"] },
    "workspaces": {
      "D:/work/docs": { "notify": { "command": ["node", "D:/dashboard/scripts/notify-terminal.mjs"] } },
      "D:/team/spec": { "data": "E:/records/spec", "owners": ["u-0a1b2c3d4e"] }
    }
  }
  ```

  맨 위 값이 이 PC 의 모든 작업 폴더 기본값, `workspaces["<문서 폴더 경로>"]` 가 그 폴더만 덮는다(`/`·`\\` 와 대소문자는 Windows 에서 같게 본다). `dataHome` 은 기록 보관함, `workspaces[…].data` 는 그 폴더의 기록 폴더, `owners` 는 이 PC 의 앱·실행기에 그 폴더의 Claude 작업을 맡기는 단일 HTML 화면의 계정(`docbench link <폴더> --data <기록 폴더> --owner <계정>` 이 적는다), `added` 는 앱에 더한 표시(앱이 적는다). `app.allowOrigins` 는 `app --allow-origin` 이 적는다. 바꾸면 `serve` 를 다시 시작한다(앱은 몇 초 안에 따른다).
- 폴더가 git 저장소면 "커밋본 대비 변경"과 폴더 지도의 커밋 안 됨 표시가 자동으로 켜진다.
- 상시 실행은 작업 스케줄러(로그온 시 시작)나 대시보드의 프로세스 관리자에 `node C:\tools\docbench\bin\docbench.mjs serve D:\work\docs` 를 등록한다.
- `npm install` 이 막힌 PC: T 는 `release/docbench.mjs` 하나, E 는 `release/docbench.html` 하나면 된다. 서버를 프로세스에 끼우려면 인터넷이 되는 곳에서 `npm pack` 으로 만든 `docbench-<버전>.tgz`(빌드 포함)를 가져와 풀고, 그 폴더에서 `npm install --omit=dev --ignore-scripts`(iconv-lite 만 받는다. `--ignore-scripts` 가 없으면 다시 빌드하려다 실패).

### C. Node 백엔드에 끼우기

```js
import { Workspace, createDocBenchHandler } from 'docbench/server';

const ws = await new Workspace('D:/work/docs').init();   // 기록은 문서 폴더 밖(기록 보관함/docs) — 다른 자리면 { dataDir: 'E:/records/docs' }
await ws.reconcileAll();                      // 꺼져 있던 동안 바뀐 파일을 이력에 남긴다
const docbench = createDocBenchHandler(ws, { base: '/docbench/api', ui: false /*, runs: true — Claude 작업(§6), identity: 'pc' — 화면의 "나"에서 이 PC 의 표시 이름 바꾸기: 둘 다 이 PC 사람 한 명이 쓸 때만 */ });

app.use((req, res, next) => docbench(req, res) || next());   // Express
// Fastify: fastify.addHook('onRequest', (req, reply, done) => docbench(req.raw, reply.raw) ? reply.hijack() : done());
```

프런트는 B 와 같다(§4). 끌 때 `docbench.close()` (감시·SSE 정리). 실행해 볼 수 있는 예: [examples/dashboard-embed](../examples/dashboard-embed/).

- `package.json` 에 `file:` 의존성으로 넣지 말고 상대 경로로 import 한다(`await import(pathToFileURL(…/vendor/docbench/server/index.mjs).href)`) — `file:` 은 개발 도구까지 딸려 온다.
- `app.use('/docbench/api', …)` 처럼 경로를 붙여 걸지 않는다 — Express 가 `req.url` 에서 그 경로를 떼어 처리기가 못 알아본다. 위처럼 경로 없이 건다.
- **본문 파서·압축보다 앞에** 끼운다. 처리기는 요청 본문을 직접 읽으므로 `express.json()` 이 먼저 읽으면 PUT·POST 가 응답 없이 멈추고, 압축 미들웨어는 SSE 를 모아 화면이 실시간으로 안 바뀐다. 인증 미들웨어 뒤는 괜찮다.
- CommonJS 대시보드: `const { Workspace, createDocBenchHandler } = await import('docbench/server')` (DocBench 는 ESM).
- 브라우저 주소의 호스트 이름이 localhost 가 아니면 `allowHosts: ['그 이름']`.

### B. 곁 프로세스 + 프록시

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

### E. 단일 HTML (서버 없음)

```html
<!-- 대시보드가 release/docbench.html 을 같은 출처의 /docbench/ 로 내준다 -->
<iframe src="/docbench/?lang=ko" title="문서 작업대" style="border:0;width:100%;height:100%"></iframe>
```

- 열면 바로 작업대("시작하기" 연습 문서)가 뜬다. 이름도 폴더도 묻지 않는다 — 계정은 이 브라우저에 저절로 생기고(`u-` + 16진 10자리, 오른쪽 위 "나"에 보인다), 표시 이름도 "나"에서. 내 폴더는 왼쪽 위 작업 공간 메뉴의 **폴더 열기**로 연다. 드라이브·홈처럼 큰 폴더도 펼친 폴더만 읽어 바로 열린다.
- **기록 보관함**(문서 폴더 밖 빈 폴더 — 예: HTML 옆 `docbench-기록`)은 **처음 저장할 때**(피드백·편집) 한 번 고른다. 보기만 하면 아무것도 묻지도 만들지도 않는다. 보관함 아래에 문서 폴더 이름의 기록 폴더가 생기고 문서 폴더에는 아무것도 생기지 않는다. 서버·CLI·앱과 같은 보관함을 쓰게 하려면 이 PC 의 설정 `dataHome` 과 같은 폴더를 고른다. 문서 폴더 안 `.docbench` 가 이미 있으면 말없이 그것을 쓰고 밖으로 옮기기를 권한다.
- 대시보드 주소로 내주면 연 폴더와 고른 보관함을 기억한다(다음 폴더부터 보관함을 묻지 않는다. 브라우저가 "항상 허용"을 기억하지 않으면 "다시 열기" 한 번). 파일로 바로 열면 기억하지 않는다 — 창마다 한 번 고른다(같은 브라우저로 연 다른 로컬 HTML 이 꺼내 쓸 수 있어서).
- 같은 출처여야 한다(다른 출처 iframe 은 폴더 고르기가 막힌다). 그 경로에는 대시보드의 전역 CSP 대신 파일 안의 CSP(인라인 스크립트 허용·네트워크 차단)가 적용되게 한다.
- 주소창: `?pick` 기억한 폴더를 열지 않고 시작하기, `?lang=en`, `?name=표시 이름`.
- 터미널의 Claude Code 는 같은 폴더를 CLI 로 다룬다(§5). 화면은 몇 초 안에 따라온다. 대시보드 없이 파일을 바로 열어도 된다(`file://` 도 쓰기 가능).
- 터미널 Claude·앱이 그 기록을 찾으려면 문서 폴더 ↔ 기록 폴더 짝을 이 PC 의 설정에 한 번 적는다: Claude 작업 창의 연결 안내가 하고(§6), 손으로는 `docbench link "<문서 폴더>" --data "<보관함>\<문서 폴더 이름>" --owner <"나"의 계정>`.

### A. `serve` 화면 iframe

```powershell
node bin\docbench.mjs serve D:\work\docs --allow-origin http://localhost:3000
```

```html
<iframe src="http://127.0.0.1:4317/" style="width:100%;height:100%;border:0" title="문서 작업대"></iframe>
```

`--allow-origin` 에 준 출처만 화면을 iframe 으로 담을 수 있다(`frame-ancestors`). 토큰을 쓰면 `src="…/?token=<토큰>"`(주소가 기록에 남는다).

### D. 계약만 구현

`docs/openapi.yaml` 의 엔드포인트를 구현하면 `createRestAdapters({ base })` 가 그대로 붙는다. 꼭 지킬 것:
판 비교(`baseVersion` 다르면 409 + `current`), 피드백 `version` 비교, 피드백 고치기에서 `null` 은 그 값을 지움(빠진 키는 그대로 — `FeedbackPatch`), 줄바꿈은 LF 로 주고받기, 변경 알림(SSE 또는 폴링).
화면만 쓰고 어댑터를 직접 짜도 된다 — `src/types.ts` 의 `DocBenchAdapters` 를 채워 `createDocBench(el, { adapters })`.

## 4. 웹 컴포넌트로 엮기 (B·C)

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
- 대시보드의 전역 CSS(`header {…}`, `.card h2 {…}`, `button {…}` 등)는 작업대 안으로 새지 않는다 — 안쪽 요소를 브라우저 기본값으로 되돌린 뒤 작업대 규칙만 얹는다(e2e 로 확인). 예외는 **id 선택자**(`#app h2`)처럼 아주 강한 규칙뿐이니, 그런 대시보드면 작업대를 그 id 밖에 두거나 T 를 쓴다(iframe 이라 섞이지 않는다).
- 색·글꼴은 토큰으로 맞춘다: `doc-bench { --db-go: #0050b3; --db-font-body: "사내 글꼴", sans-serif; }` (전체 목록은 `src/ui/styles.css` 맨 위).
- 대시보드의 CSP 가 `style-src` 에 nonce 를 요구하면 CSS 파일을 `<link>` 로 넣고 `injectStyles: false`, 또는 `styleNonce` 를 넘긴다.

## 5. 터미널의 Claude Code 와 잇기

길은 둘이다 — 둘 다 결과는 사람의 "볼 것"으로 간다.

**설치 없이 (터미널 한 줄, D76)** — 화면의 보내기에서 "어디로 = 터미널 한 줄". 화면이 기록 폴더에 요청 파일(`runs/<id>.req.json`·`.prompt.md`·`.ctx.json`)과 Claude 자리 파일(`CLAUDE.md`·`.claude/settings.json`·`instructions.md`)을 쓰고 한 줄을 준다. 사람이 그 한 줄을 PowerShell(또는 셸)에 붙여 넣으면, 기록 폴더에서 켜진 Claude Code 가 요청 파일을 읽고 `runs/<id>.result.json` 하나를 쓴다. 열린 화면(단일 HTML) 또는 앱이 그것을 받아 반영한다.
- 왜 기록 폴더에서 켜나: Claude Code 는 **켠 폴더**를 기준으로 지시(그 폴더와 **위 폴더들**의 CLAUDE.md)·권한(그 폴더의 `.claude/settings.json` — 위 폴더 것은 물려받지 않음)·접근 범위·대화 기록(`claude -c`)·신뢰 창을 정한다. 문서 폴더에서 켜면 그 저장소의 지시·훅이 섞이고 문서 폴더에 파일이 생긴다(D57). 기록 폴더의 설정은 결과 파일만 묻지 않고 쓰게 하고, 기록·문서 폴더 직접 편집은 막고, 위 폴더의 CLAUDE.md 는 `claudeMdExcludes` 로 뺀다(관리자 CLAUDE.md 는 뺄 수 없다).
- 처음 한 번은 Claude Code 가 그 폴더를 믿을지 묻는다 — 설정의 허용(allow) 규칙은 믿은 뒤에야 쓰인다.
- 앱·서버가 기록 폴더의 절대 경로를 알면 한 줄에 `Set-Location` 이 들어 있다. 단일 HTML 은 경로를 몰라 "그 폴더에서 열기"를 안내한다(Windows: 탐색기 주소창에 `pwsh`). 앱·서버는 문서 폴더를 `additionalDirectories` 로 더해 Claude 가 읽게 하고, 단일 HTML 은 고칠 글을 요청 파일에 넣는다.

**플러그인으로 (켜 둔 Claude 대화)** — 대시보드 터미널의 Claude Code 에서 `/docbench-feedback`.

- T: `onHandoff` 가 받은 `prompt` 를 켜진 대화에 넣는다(§2.4). 셸이면 `command` 를. 넣지 않으면 앱의 Claude 작업으로(§6).
- "어디로 = 요청함"이면 기록 폴더 `inbox/req-*.json` 에 요청을 남긴다. 스킬이 `docbench inbox` 로 그것부터 읽고 끝나면 비운다.
- 대시보드 터미널의 현재 폴더가 문서 폴더가 아니면 터미널 환경에 `DOCBENCH_ROOT=D:\work\docs` 를 넣어 둔다(CLI 가 거기서 찾는다).
- 터미널을 자동으로 깨우려면(A·B·C) **이 PC 의 설정**(§3 공통 준비)의 `workspaces["<문서 폴더>"].notify.command` 에 명령을 적는다. 명령은 문서 폴더를 현재 폴더로, 서버 프로세스의 환경 변수를 물려받아 셸 없이 실행된다. 요청함으로 보낼 때 그 명령이
  `DOCBENCH_REQUEST`(요청 파일 경로)·`DOCBENCH_ROOT` 환경변수를 받고 실행된다(요청함으로 보낼 때). **대시보드가 이미 Claude 터미널을 띄워 두고 입력을 밀어 넣을 수 있으면**
  그 API 를 부르는 작은 스크립트를 거는 것이 가장 자연스럽다 — 떠 있는 세션이 `/docbench-feedback` 을 받는다.
- 단일 HTML(E)은 앱이 이어져 있으면 Claude 작업(§6), 아니면 터미널 한 줄. 명령을 실행하지는 않는다(페이지는 프로그램을 켜지 못한다).
- 대화하며 처리하고 싶으면 플러그인 길, 맡겨 두고 결과만 보려면 Claude 작업(§6), 설치 없이 지금 Claude Code 로는 터미널 한 줄. 같은 피드백을 동시에 잡아도 판 비교로 한쪽만 반영된다.

**무인 처리** — 이제는 §6 Claude 작업을 권한다(Claude 에게 읽기 도구만, 반영은 DocBench 가 판 비교로). 아래 `notify.command` 로 도구를 다 가진 `claude -p` 를 띄우는 길은 신뢰하는 사람만 피드백을 다는 폴더에서만 — 이 PC 의 설정에:

```json
"workspaces": { "D:/work/docs": { "notify": {
  "command": ["C:/Users/me/.local/bin/claude.exe", "-p",
    "docbench-feedback 스킬 순서대로 요청함(docbench inbox)의 보낸 피드백을 처리하라. 확실하지 않으면 고치지 말고 되물어라.",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Bash(docbench *)", "Bash(node *docbench.mjs *)", "Read",
    "--max-turns", "40", "--permission-prompts", "none", "--no-session-persistence"]
} } }
```

화면에 보일 안내는 함께 쓰는 문서 폴더 `config.json` 에: `"notify": { "message": "Claude 가 백그라운드에서 처리합니다. 결과는 이 화면에 뜹니다." }`.

명령은 한 번에 하나만 돈다. 출력은 기록 폴더 `inbox/req-*.json.log` 에 남으니, 무인 실행이 실패하면 거기서 원인을 본다. 실행 파일을 못 찾으면 화면에 그 이유가 바로 뜬다.
플래그는 Claude Code CLI 문서 기준이다(code.claude.com/docs/en/cli-reference). `-p` 에서 스킬이 자동으로 쓰이는지는 환경에서 한 번 확인한다 — 안 되면 프롬프트에 스킬 순서를 직접 적는다.
`--permission-prompts none` 은 v2.1.259 이상.

## 6. Claude 작업 (백그라운드 처리)

화면 아래 **"Claude 작업"** 창: 보낸 묶음(또는 Claude 검토)을 Claude 가 백그라운드에서 처리하고 진행 로그가 실시간으로 보인다. 모델·노력·방식(바로 고치기 / 제안만)은 검토 패널의 보내기 막대에서 고른다. 결과는 "볼 것"으로.
구독 로그인(Max·Team 등)을 그대로 쓴다 — API 키가 필요 없다.

| 방식 | 누가 claude 를 띄우나 | 할 일 |
|---|---|---|
| T (앱 탭) | DocBench 앱 — 작업 공간마다 엔진 하나 | 없음 — `claude` 가 PATH 에 있거나 이 PC 의 설정 `assistant.command`. `onHandoff` 로 대시보드가 보내기를 맡으면 그쪽이 먼저 |
| A·B (`docbench serve`) | serve 가 직접 | 없음 — `claude` 가 PATH 에 있으면 켜진다. 끄려면 `--no-claude` |
| C (처리기 끼우기) | 대시보드 서버 프로세스가 직접 | **기본 끔** — 이 PC 사람 한 명이 쓰는 대시보드면 `createDocBenchHandler(ws, { …, runs: true })` |
| E (단일 HTML) | 이 PC 의 **DocBench 앱**(이 폴더를 이어 둔 것). 예전 실행기(`docbench runner`)도 그대로 된다. 앱 없이는 터미널 한 줄(§5) | Claude 작업 창이 연결 안내를 준다: 문구를 Claude Code 에 붙여 넣으면 CLI 파일 하나 받기·지문 확인 → `link "<문서 폴더>" --data "<기록 폴더>" --owner <이 화면의 계정>`(기록을 안에 두면 `--data` 없이) → `app --detach` → `app --status` → 원하면 `app --startup on`. 연결되면 기다리던 일을 이어 간다(기록 자리를 아직 안 골랐으면 그것부터) |
| D (계약 구현) | 그 백엔드 | 선택 — `/runs*` 를 구현하면 창이 켜진다(`session.features.runs`). 없으면 창 없이 요청함(`notify`)으로 |

단일 HTML 은 **이 화면의 계정과 짝지은 엔진**(`link --owner`)이나 사용자 이름이 내 이름·계정과 같은 엔진만 저절로 고른다. 아니면 창이 "내 것 아님"으로 알리고, 내 PC 의 것이면 한 번 고르면 기억한다 — 폴더를 함께 쓰는 동료의 앱·실행기가 내 작업을 집어 가지 않게.

- **이 PC 사람 한 명이 쓰는 서버에서만 켠다.** 여러 사람이 붙는 공용 서버면 끈다 — 서버 PC 의 claude 가 그 계정으로 돈다. 앱은 이 PC 사용자 하나의 것이라 이 조건을 늘 만족한다.
- 실행: 문서 폴더 밖에서 `claude -p --restricted --safe-mode --permission-mode dontAsk --tools Read,Grep,Glob --add-dir <문서 폴더> …`. Claude 는 문서 폴더 안을 **읽기만** 하고 고친 글을 정해진 모양으로 돌려준다. 반영은 앱·서버·실행기가 판 비교로 한다(그 사이 사람이 고친 섹션은 덮지 않고 제안으로). 이유와 실측은 [SECURITY.md](SECURITY.md#ai-호출).
- 필요한 Claude Code: `claude --help` 에 `--restricted`·`--safe-mode` 가 있는 판(2.1.293 에서 확인). 없으면 실행하지 않고 "업데이트 필요"를 띄운다. `claude auth status` 가 로그인 안 됨이면 "로그인 필요"를 따로 알린다.
- 이 PC 의 설정(§3 공통 준비):

```json
"assistant": { "command": "C:/Users/me/.local/bin/claude.exe", "timeoutSec": 900, "model": "sonnet" }
```

  `command` 는 PATH 의 `claude` 면 빼도 된다(npm 설치본 `claude.cmd` 는 옆의 `cli.js` 를 node 로 부른다). `timeoutSec` 는 작업 하나의 상한(기본 900), `model` 은 화면에서 "기본"을 골랐을 때.
- 예전 실행기 명령: `docbench runner <폴더>`(앞에서, Ctrl+C 로 끔) · `--detach`(창 없이 뒤에서, 로그는 이 PC 의 설정 폴더 `logs/`) · `--status` · `--stop` · `--startup on|off`. 실행기 하나 = 폴더 하나. 새로 붙일 때는 앱을 쓴다.
- 문제를 살펴볼 때 `DOCBENCH_RUN_DEBUG=1` 로 켜면 Claude 의 결과를 기록 폴더 `runs/<id>.out.json` 에 그대로 남긴다.

**예전 "AI 제안"**(`POST /assistant/propose`, 섹션 하나 → 제안 하나)은 REST 계약을 위해 남아 있다. 화면은 Claude 작업이 있으면 그 길을 쓴다. 이 길도 이제 문서 폴더 밖에서 `--restricted --safe-mode` 로 띄운다(0.2.0 은 문서 폴더 안에서 띄워 그 폴더의 훅이 실행될 수 있었다 — SECURITY.md).

## 7. 확인 목록

| 확인 | 방법 |
|---|---|
| 앱 탭 | 대시보드 탭에 문서가 뜨고, 패널보다 긴 문서가 탭 안에서 스크롤된다. 대시보드 테마를 바꾸면 따라 바뀐다(`setTheme`). 초안을 적으면·결과가 오면 탭 배지(`onTodo`)가 바뀐다 |
| 탭 보내기 | 초안 둘을 적어도 대시보드는 부르지 않는다 → 보내기(어디로 = 대시보드 터미널) → `onHandoff` 가 한 번, 두 id 와 `command`·`prompt` 로 → 작업대에 `message`. `handled: false` 면 작업대가 스스로 |
| 탭 보안 | 허용하지 않은 출처에서 끼우면 iframe 이 막힌다(브라우저 콘솔에 `frame-ancestors`). 열쇠 없이 `curl <앱>/api/app/info` → 401. 대시보드 페이지에 다른 Host 로 요청하면 거부, 응답에 `Cache-Control: no-store`. 이벤트(`onEvent`)에 피드백 본문이 없다 |
| 서버·화면 | `http://127.0.0.1:4317/` 에서 문서가 열리고 접기 상태가 새로고침 뒤에도 남는다 |
| 인코딩 | 실제 업무 문서(CP949 의 똠·햏 같은 확장 음절, UTF-8 BOM, UTF-16, CRLF)를 한 섹션 고쳐 저장 → 다른 편집기에서 글자·줄바꿈이 그대로. 메모장에서 고친 문서도 한 번 |
| 외부 편집 | 편집기로 문서를 고치면 화면에 바뀐 글이 표시된다(앱·서버는 바로, 단일 HTML 은 몇 초·창으로 돌아오면 바로) |
| CLI 왕복 | 초안은 `fb list` 에 안 보임 → 보내면 `docbench fb list --waiting assistant` 에 보임 → `fb reply --resolve` → 화면 "볼 것"에 회신 → 확인하면 끝남 |
| Claude 가 고친 문서 | `docbench doc write …` 뒤 가만히 둔 화면이 새 글을 보여 준다 (앱·서버 바로, 단일 HTML 몇 초) |
| Claude 작업 | 창에 "연결됨" → 초안 둘 + 붙일 말로 보내기 → 로그가 흐르고 끝나면 문서에 바뀐 글(초록·취소선, 누가: Claude) · "볼 것"에 회차 → 바뀐 곳 → 하나 되돌리기(글이 바이트 그대로 돌아옴) → 하나 확인 |
| 제안만 · Claude 검토 | "제안만"으로 보내면 문서는 그대로·볼 것에 차이 → 적용. "Claude 검토"(제안·질문) → 볼 것에 작성자 Claude 카드, 읽기 정리 → 접기·안내(되돌리기) |
| 터미널 한 줄 | 앱을 끈 채 "어디로 = 터미널 한 줄" → 한 줄을 PowerShell 에 → 처음 한 번 폴더 신뢰 → Claude 가 결과 파일 → 화면 볼 것에 반영. 기록 폴더 밖(문서 폴더)에는 아무것도 생기지 않는다 |
| 도구 밖 수정 | 편집기·터미널에서 고친 뒤 화면으로 돌아오면 그 문서는 바로, 다른 문서는 목록에 "바뀜". 편집 중에 바뀌면 내 글이 지켜진다 |
| 보안 | 다른 PC 에서 4317 이 안 열린다(기본 127.0.0.1). 프록시 뒤라면 `--token` |
| 회귀 | `npm run check` |

## 8. 문제 풀이

- **탭이 비어 있거나 "연결을 거부했습니다"**: 대시보드 출처를 허용하지 않았다 — `docbench app --status --json` 의 `allowOrigins` 에 주소창의 출처가 그대로 있는지(`localhost` 와 `127.0.0.1`, 포트까지) 보고 `app --allow-origin <출처>`.
- **탭에 "이 주소는 열쇠가 있어야 열립니다"**: 대시보드가 읽은 열쇠가 앱의 것과 다르다 — 대시보드 프로세스와 앱이 같은 설정 폴더를 보는지(`DOCBENCH_HOME`, 서비스 계정으로 돈 대시보드는 다른 `%LOCALAPPDATA%`), `app-token` 을 새로 만든 뒤 페이지를 다시 그렸는지.
- **`host.js` 를 못 받음**: 앱이 꺼졌거나 포트가 바뀌었다 — `app --status`, 대시보드가 주소를 `app.json` 에서 읽는지.
- **탭에 "이 폴더 안에 이미 더한 작업 공간이 있습니다"**: 탭의 `root` 가 따로 더한 작업 공간을 품는다 — `docbench app --open` → 폴더 추가 → 그 폴더 → 합치기(§2.3).
- **`claude 실행 파일을 찾지 못했습니다`**: `where claude` 로 경로를 찾아 이 PC 의 설정 `assistant.command` 에 `.exe` 전체 경로.
- **"Claude Code 에 로그인하지 않았습니다"**: 터미널에서 `claude` → `/login`(또는 `claude auth login`). 1분 안에 다시 확인한다.
- **Claude 작업 창이 연결 안내에서 넘어가지 않음**(단일 HTML): `docbench app --status` 에 그 문서 폴더가 있는지(없으면 `link` 가 안 됐다), 있으면 앱과 화면이 같은 기록 폴더를 보는지(`docbench status` 의 "기록:" 과 화면 왼쪽 아래 "기록:"), 로그(`%LOCALAPPDATA%\docbench\logs\`). 예전 실행기를 쓰면 `docbench runner --status "<폴더>"`.
- **CLI 가 "이 문서 폴더의 기록을 찾지 못했습니다"**(종료 코드 2): 브라우저로만 쓰던 폴더라 기록 짝이 아직 없다 — `docbench link "<문서 폴더>" --data "<기록 보관함>\<문서 폴더 이름>"`(연결 안내도 이것을 한다).
- **"다른 문서 폴더의 기록입니다"**: 이름이 같은 다른 문서 폴더가 이미 보관함의 그 이름을 쓰고 있다 — `link … --data <다른 자리>` 로 따로 둔다.
- **"Claude Code 업데이트 필요"**: `claude update` — `--restricted`·`--safe-mode` 가 없는 판. 1분 안에 다시 확인한다.
- **작업이 "실패: 고친 글(text)이 비어 있습니다"**: 모델이 고친 글을 빼먹었다(작은 모델·낮은 노력에서 가끔 — 실측). 피드백은 보냄에 남아 있으니 모델·노력을 올려 다시 넘긴다.
- **제안·요청함 알림 명령이 안 돈다, `status` 에 "주의"**: 명령을 문서 폴더 `config.json` 에 적었다 → 이 PC 의 설정(`%LOCALAPPDATA%\docbench\config.json`)으로 옮긴다. `docbench status` 가 그 파일 위치를 보여 준다.
- **저장이 계속 409**: 다른 프로그램(동기화 도구 등)이 저장 직후 파일을 다시 쓰는지 본다. `changes.jsonl` 의 `by: external` 줄이 단서.
- **`EPERM`/`EBUSY`**: 편집기·백신·동기화 도구가 파일을 잡고 있다. 서버가 임시 파일 → 바꿔치기를 몇 번 재시도하고, 계속 막히면 그 파일에 직접 쓴다(원자성 대신 저장 성공을 택함 — 직전 판 본문은 기록 폴더 `blobs/` 에 있다). 그것도 막히면 오류.
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
/docbench-setup 이 대시보드에 문서 작업대를 탭으로 붙여 줘.
- 문서 폴더: <D:\work\docs / 프로젝트마다 그 프로젝트 폴더>
- 탭 위치: <프로젝트 화면의 "문서" 탭 / 사이드 패널 / …>
- 대시보드 테마를 따라가게, 탭 배지는 <볼 것 수 / 볼 것 + 초안>.
- 보내기: <작업대의 Claude 작업 창 / 대시보드 터미널에 셸 한 줄(command) / 켜진 Claude 대화에 prompt>.
```

스킬은 대시보드의 언어·주소·CSP·터미널 연동을 먼저 살펴 표로 보여 주고, 방식(기본은 T — 앱 탭)을 근거와 함께 고른 뒤 붙이고, §7 확인 목록을 실제로 돌려 `[실측]`/`[미확인]` 표로 보고한다.
대시보드가 git 저장소가 아니면 바꾸기 전에 되돌릴 방법(로컬 `git init` 또는 백업)을 묻는다.
