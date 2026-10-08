// 서버 없는 단일 HTML 을 저장소에 싣는다 — 빌드 도구 없이 GitHub 에서 파일 하나로 받아 쓰게.
//   npm run release   (빌드 후 dist/docbench.html → release/docbench.html)
// npm run check 는 둘이 같은지 본다(scripts/check-release.mjs). 화면 코드를 고치면 이것도 다시 돌려 함께 커밋한다.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
mkdirSync('release', { recursive: true });
copyFileSync('dist/docbench.html', 'release/docbench.html');
// CLI 파일 하나: 단일 HTML 의 설치 안내가 이 저장소의 태그(v<판>) 주소로 받는다. 플러그인에도 같은 파일을 싣는다(터미널 Claude Code 가 바로 쓰게)
copyFileSync('dist/docbench.mjs', 'release/docbench.mjs');
mkdirSync('integrations/claude-code/cli', { recursive: true });
copyFileSync('dist/docbench.mjs', 'integrations/claude-code/cli/docbench.mjs');
console.log('release/docbench.html · release/docbench.mjs · integrations/claude-code/cli/docbench.mjs 갱신');
