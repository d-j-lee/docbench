// 배포물이 코드와 어긋나지 않았는지 — npm run check 의 마지막 단계
//  1) release/docbench.html 이 지금 빌드(dist/docbench.html)와 같은가 (다르면 저장소의 단일 HTML 이 낡은 것)
//  2) Claude Code 플러그인 버전이 package.json 버전과 같은가 (스킬은 그 버전의 문서·계약을 가리킨다)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const fail = (msg) => { console.error(msg); process.exitCode = 1; };
const a = existsSync('release/docbench.html') ? readFileSync('release/docbench.html') : null;
if (!a || !a.equals(readFileSync('dist/docbench.html'))) fail('release/docbench.html 이 지금 빌드와 다릅니다. `npm run release` 로 갱신해 함께 커밋하세요.');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
const plugin = JSON.parse(readFileSync('integrations/claude-code/.claude-plugin/plugin.json', 'utf8')).version;
if (pkg !== plugin) fail(`플러그인 버전(${plugin})이 package.json(${pkg})과 다릅니다. integrations/claude-code/.claude-plugin/plugin.json 을 맞추세요.`);
if (!process.exitCode) console.log(`release/docbench.html = dist, 플러그인 버전 = ${pkg}`);
