# Claude Code 플러그인 `docbench`

| 스킬 | 언제 |
|---|---|
| `docbench-setup` | DocBench 를 웹 대시보드(백엔드 언어 무관)·로컬 문서 폴더에 붙이거나 갱신할 때. 살피기 → 방식 고르기 → 받기·연결 → 실제 확인 → 기록 |
| `docbench-feedback` | 사람이 화면에서 단 피드백 중 AI 차례인 것을 `docbench` CLI 로 처리할 때(터미널에서 대화하며). 맡겨 두고 결과만 볼 때는 화면의 Claude 작업 |

```powershell
claude plugin marketplace add d-j-lee/docbench      # GitHub (git 필요)
claude plugin install docbench@docbench
```

- GitHub 이 막힌 PC: 저장소 ZIP 을 풀고 `claude plugin marketplace add C:\tools\docbench`, 또는 `skills\` 아래 두 폴더를 `%USERPROFILE%\.claude\skills\` 로 복사.
- 갱신: `claude plugin marketplace update docbench` → `claude plugin update docbench@docbench`. 플러그인 버전은 DocBench 버전과 같다.
- claude.ai 계정에 저장한 스킬은 그 계정으로 로그인한 Claude Code 에만 내려온다. 회사 계정으로 쓰는 PC 에는 위 방법으로 깐다.
- `cli/docbench.mjs` — `docbench` CLI 파일 하나(`release/docbench.mjs` 와 같은 것, `npm run release` 가 복사). 스킬은 `node "${CLAUDE_PLUGIN_ROOT}/cli/docbench.mjs"` 로 부르므로 플러그인만 깔면 CLI 를 따로 받지 않아도 된다(Node 20.11+ 필요).
- `CLAUDE.md.snippet` — 대시보드·문서 폴더의 CLAUDE.md 에 붙여 넣을 몇 줄.
