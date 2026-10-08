// 배포물이 코드와 어긋나지 않았는지 — npm run check 의 마지막 단계
//  1) release/docbench.html · release/docbench.mjs · 플러그인의 cli/docbench.mjs 가 지금 빌드(dist/)와 같은가 (다르면 저장소의 배포물이 낡은 것)
//  2) Claude Code 플러그인 버전이 package.json 버전과 같은가 (스킬은 그 버전의 문서·계약을 가리킨다)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const fail = (msg) => { console.error(msg); process.exitCode = 1; };
for (const [rel, dist] of [['release/docbench.html', 'dist/docbench.html'], ['release/docbench.mjs', 'dist/docbench.mjs'], ['integrations/claude-code/cli/docbench.mjs', 'dist/docbench.mjs']]) {
  const a = existsSync(rel) ? readFileSync(rel) : null;
  if (!a || !a.equals(readFileSync(dist))) fail(`${rel} 이 지금 빌드와 다릅니다. \`npm run release\` 로 갱신해 함께 커밋하세요.`);
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
const plugin = JSON.parse(readFileSync('integrations/claude-code/.claude-plugin/plugin.json', 'utf8')).version;
if (pkg !== plugin) fail(`플러그인 버전(${plugin})이 package.json(${pkg})과 다릅니다. integrations/claude-code/.claude-plugin/plugin.json 을 맞추세요.`);
if (!process.exitCode) console.log(`release/docbench.html · docbench.mjs · 플러그인 cli = dist, 플러그인 버전 = ${pkg}`);
