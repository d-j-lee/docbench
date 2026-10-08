// 빌드: 브라우저 번들(ESM·IIFE) + DOM 없는 코어(서버·CLI용) + CSS + 타입
// 의존 라이브러리(marked·DOMPurify·diff)는 번들에 넣는다 — 사내 내부망·CSP 에서 CDN 없이 돈다.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
process.chdir(root);
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const banner = `/*! DocBench ${pkg.version} — bundles marked (MIT), DOMPurify (MPL-2.0 OR Apache-2.0), jsdiff (BSD-3-Clause). See THIRD_PARTY_NOTICES.md */`;
// 호스트 전역 CSS 보다 우선하도록 .docbench 를 세 번 겹친다 (토큰은 :where() 라 우선순위 0 그대로)
const scopeCss = (css) => css.replace(/\.docbench(?![\w-])/g, '.docbench.docbench.docbench');
const cssText = scopeCss(readFileSync('src/ui/styles.css', 'utf8'));
const cssPlugin = { name: 'docbench-css', setup(b) { b.onLoad({ filter: /styles\.css$/ }, () => ({ contents: cssText, loader: 'text' })); } };
const common = { plugins: [cssPlugin], bundle: true, target: ['es2021', 'chrome105', 'firefox110', 'safari16'], loader: { '.css': 'text' }, legalComments: 'none', banner: { js: banner }, sourcemap: true, logLevel: 'warning' };

await build({ ...common, entryPoints: ['src/index.ts'], format: 'esm', outfile: 'dist/docbench.js', minify: true });
await build({ ...common, entryPoints: ['src/iife.ts'], format: 'iife', globalName: 'DocBench', outfile: 'dist/docbench.iife.js', minify: true });
await build({ ...common, entryPoints: ['src/core/index.ts'], format: 'esm', platform: 'neutral', outfile: 'dist/core.mjs', minify: false, sourcemap: false, mainFields: ['module', 'main'] });
writeFileSync('dist/docbench.css', cssText);
// 서버·CLI(.mjs)가 core.mjs 를 import 할 때 TypeScript 가 번들 JS 대신 이 선언을 읽는다
writeFileSync('dist/core.d.mts', "export * from './types/core/index.js';\n");
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' });

for (const f of ['docbench.js', 'docbench.iife.js', 'core.mjs', 'docbench.css']) {
  const b = readFileSync('dist/' + f);
  console.log(f.padEnd(18), String(statSync('dist/' + f).size).padStart(8), 'B  sha256', createHash('sha256').update(b).digest('hex').slice(0, 12));
}
