# Claude Code 플러그인 `docbench`

| 스킬 | 언제 |
|---|---|
| `docbench-setup` | DocBench 를 웹 대시보드·로컬 문서 폴더에 붙이거나 갱신할 때. 기본은 이 PC 의 DocBench 앱을 켜고 `host.js` 로 대시보드 탭에 끼우는 길(백엔드 언어 무관). 살피기 → 방식 고르기 → 받기·연결 → 실제 확인 → 기록 |
| `docbench-feedback` | 사람이 화면에서 모아 보낸 피드백을 `docbench` CLI 로 처리할 때(터미널에서 대화하며) — 결과는 사람의 "볼 것"으로. "먼저 검토해 줘"면 제안·질문을 먼저 올린다. 대시보드 탭의 보내기가 켜진 Claude 대화에 넣는 `/docbench:docbench-feedback …` 한 줄도 이 스킬이다. 맡겨 두고 결과만 볼 때는 화면의 Claude 작업, 아무것도 깔지 않으려면 화면의 "터미널 한 줄" |

```powershell
claude plugin marketplace add d-j-lee/docbench      # GitHub (git 필요)
claude plugin install docbench@docbench
```

- GitHub 이 막힌 PC: 저장소 ZIP 을 풀고 `claude plugin marketplace add C:\tools\docbench`, 또는 `skills\` 아래 두 폴더를 `%USERPROFILE%\.claude\skills\` 로 복사(이때 명령은 `/docbench-feedback` — 탭이 넣는 `/docbench:` 붙은 줄은 대시보드가 바꿔 보낸다).
- 갱신: `claude plugin marketplace update docbench` → `claude plugin update docbench@docbench`. 플러그인 버전은 DocBench 버전과 같다.
- claude.ai 계정에 저장한 스킬은 그 계정으로 로그인한 Claude Code 에만 내려온다. 회사 계정으로 쓰는 PC 에는 위 방법으로 깐다.
- `cli/docbench.mjs` — `docbench` CLI 파일 하나(`release/docbench.mjs` 와 같은 것, `npm run release` 가 복사). DocBench 앱(`app`)·피드백 처리(`fb`·`doc`·`status`)·예전 실행기(`runner`)가 다 들어 있다. 스킬은 `node "${CLAUDE_PLUGIN_ROOT}/cli/docbench.mjs"` 로 부르므로 플러그인만 깔면 CLI 를 따로 받지 않아도 된다(Node 20.11+). 앱을 상시로 켤 때는 이 파일을 `%LOCALAPPDATA%\docbench\docbench.mjs`(macOS `~/Library/Application Support/docbench/`, Linux `~/.config/docbench/`)로 복사해 쓴다 — 플러그인 경로는 갱신 때 바뀔 수 있고, 로그인 때 켜기·바로가기는 경로에 영문이 아닌 글자가 있으면 만들지 않는다.
- 단일 HTML 화면의 Claude 연결 안내도 같은 자리에 같은 파일을 받아 앱을 켜고 `docbench link --owner <계정>` 으로 그 폴더를 잇는다.
- `CLAUDE.md.snippet` — 대시보드·문서 폴더의 CLAUDE.md 에 붙여 넣을 몇 줄.
- **플러그인 없이**: 화면의 보내기에서 "어디로 = 터미널 한 줄"을 고르면 기록 폴더에서 Claude Code 를 여는 단추(deep link)와 같은 일을 하는 한 줄이 나온다. 켜 둔 Claude 에는 "다음"이라고만 하면 된다. 그 폴더의 `CLAUDE.md`·`.claude/settings.json` 은 DocBench 가 쓰므로 이 플러그인도, 이 스킬도 필요 없다(D76).
