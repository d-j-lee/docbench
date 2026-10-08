# 대시보드 탭 예 — 백엔드 언어와 상관없이

이 PC 에 켜 둔 DocBench 앱을 대시보드의 탭에 끼우는 가장 작은 예다(의존성 없음, Node 20+). 자세한 설명은 [docs/PORTING.md §2](../../docs/PORTING.md#2-앱-탭-권장).

- `server.mjs` — 대시보드 백엔드 흉내. 이 PC 의 설정 폴더에서 앱 주소(`app.json`)와 열쇠(`app-token`)를 읽어 페이지에 넣는다. 앱이 답하는지·이 출처를 허용했는지도 본다.
- `index.html` — 대시보드 페이지. 앱의 `host.js` 를 싣고 폴더마다 탭을 만들어 `DocBenchHost.mount(…)` 한다. 배지(`onTodo`), 테마(`setTheme`), 넘기기(`onHandoff` → 오른쪽 "터미널"), 이벤트(`onEvent`)를 보여 준다.

## 세 단계

저장소에서(받은 CLI 파일 하나로 해도 같다 — `node "%LOCALAPPDATA%\docbench\docbench.mjs" app …`):

```powershell
node bin\docbench.mjs app --detach                                  # 1) DocBench 앱 켜기 (이 PC 에 하나)
node bin\docbench.mjs app --allow-origin http://127.0.0.1:5190      # 2) 이 예의 출처 허용 (한 번)
node examples\dashboard-tab\server.mjs D:\work\docs D:\work\spec    # 3) 폴더 하나 = 탭 하나 → http://127.0.0.1:5190/
```

포트를 바꾸려면 `--port <번호>` — 그 출처를 2) 에서 허용한다. 끝나면 `node bin\docbench.mjs app --stop`.

- 탭으로 연 폴더는 앱의 작업 공간이 된다(`app --status` 에 보인다). 기록은 문서 폴더 밖 기록 보관함에 생기고 문서 폴더에는 아무것도 생기지 않는다. 앱 화면(`app --open`)의 "목록에서 빼기"로 뺀다(기록은 남는다).
- "넘기기를 이 대시보드 터미널로"를 끄면 `onHandoff` 가 `{ handled: false }` 를 돌려주고, 작업대가 앱의 Claude 작업 창을 연다.

## 다른 언어로 옮길 때

백엔드가 할 일은 `server.mjs` 의 `appState()` 하나다 — 파일 둘을 읽어 페이지에 넣는다(Python 예는 PORTING §2.2). 지킬 것:

- 열쇠가 든 페이지는 `127.0.0.1` 에만 열고 Host 헤더가 `localhost`·`127.0.0.1` 일 때만 내준다(DNS rebinding).
- `Cache-Control: no-store`, `Access-Control-Allow-Origin` 은 달지 않는다. 열쇠를 정적 파일·로그에 남기지 않는다.
- 주소·열쇠는 페이지를 그릴 때마다 읽는다(앱을 다시 켜 포트가 바뀌어도 따라가게).

백엔드가 Node 이고 DocBench API 를 대시보드 프로세스 안에 두고 싶으면 [../dashboard-embed](../dashboard-embed/)(방식 C).
