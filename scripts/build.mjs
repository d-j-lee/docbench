// 빌드: 브라우저 번들(ESM·IIFE) + DOM 없는 코어(서버·CLI용) + CSS + 타입 + 서버 없는 단일 HTML
// 의존 라이브러리(marked·DOMPurify·diff)는 번들에 넣는다 — 사내 내부망·CSP 에서 CDN 없이 돈다.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// URL.pathname 은 Windows 에서 /C:/… 가 되어 chdir 이 깨진다 — 파일 경로로 바꾼다
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const banner = `/*! DocBench ${pkg.version} (MIT) — bundles marked (MIT), DOMPurify (MPL-2.0 OR Apache-2.0), jsdiff (BSD-3-Clause). See THIRD_PARTY_NOTICES.md */`;
// 호스트 전역 CSS 보다 우선하도록 .docbench 를 세 번 겹친다 (토큰은 :where() 라 우선순위 0 그대로)
const scopeCss = (css) => css.replace(/\.docbench(?![\w-])/g, '.docbench.docbench.docbench');
const cssText = scopeCss(readFileSync('src/ui/styles.css', 'utf8'));
const cssPlugin = { name: 'docbench-css', setup(b) { b.onLoad({ filter: /styles\.css$/ }, () => ({ contents: cssText, loader: 'text' })); } };
const common = {
  plugins: [cssPlugin], bundle: true, target: ['es2021', 'chrome105', 'firefox110', 'safari16'], loader: { '.css': 'text' },
  legalComments: 'none', banner: { js: banner }, sourcemap: true, logLevel: 'warning',
  define: { __DOCBENCH_VERSION__: JSON.stringify(pkg.version) },
};

await build({ ...common, entryPoints: ['src/index.ts'], format: 'esm', outfile: 'dist/docbench.js', minify: true });
await build({ ...common, entryPoints: ['src/iife.ts'], format: 'iife', globalName: 'DocBench', outfile: 'dist/docbench.iife.js', minify: true });
await build({ ...common, entryPoints: ['src/core/index.ts'], format: 'esm', platform: 'neutral', outfile: 'dist/core.mjs', minify: false, sourcemap: false, mainFields: ['module', 'main'],
  banner: { js: `/*! DocBench core ${pkg.version} (MIT) — bundles marked (MIT), jsdiff (BSD-3-Clause). See THIRD_PARTY_NOTICES.md */` } });
writeFileSync('dist/docbench.css', cssText);

// CLI 파일 하나 (release/docbench.mjs) — 단일 HTML 의 실행기(docbench runner)·터미널 Claude Code 가 쓴다.
// 서버·코어·iconv-lite 를 함께 묶어 Node 만 있으면 돈다(설치·빌드 없이). 단일 HTML 의 설치 안내가 이 파일의 주소·지문을 담는다
let iconvOk = true;
try { (await import('node:module')).createRequire(import.meta.url).resolve('iconv-lite'); } catch { iconvOk = false; console.warn('주의: iconv-lite 가 없어 CLI 묶음에서 CP949 쓰기가 빠집니다 (npm install 로 선택 의존성을 까세요)'); }
await build({
  entryPoints: ['scripts/cli-bundle-entry.mjs'], bundle: true, platform: 'node', format: 'esm', target: ['node20'], outfile: 'dist/docbench.mjs',
  minify: false, legalComments: 'none', logLevel: 'error', external: iconvOk ? [] : ['iconv-lite'],
  define: { __DOCBENCH_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `#!/usr/bin/env node\n/*! DocBench CLI ${pkg.version} (MIT) — one file: docbench runner · fb · doc · status. Bundles iconv-lite (MIT) and marked (MIT), jsdiff (BSD-3-Clause). https://github.com/d-j-lee/docbench */\nimport { createRequire as __docbenchCreateRequire } from 'node:module'; const require = __docbenchCreateRequire(import.meta.url);` },
});
const cliSha = createHash('sha256').update(readFileSync('dist/docbench.mjs')).digest('hex');
const cliUrl = `https://raw.githubusercontent.com/d-j-lee/docbench/v${pkg.version}/release/docbench.mjs`;

// 서버 없는 단일 HTML — 파일 하나를 엣지·크롬으로 열고 문서 폴더를 고른다(src/standalone.ts)
const standalone = await build({ ...common, entryPoints: ['src/standalone.ts'], format: 'iife', write: false, minify: true, sourcemap: false,
  define: { ...common.define, __DOCBENCH_CLI_URL__: JSON.stringify(cliUrl), __DOCBENCH_CLI_SHA256__: JSON.stringify(cliSha) } });
// 인라인 <script> 안에서 문자열 '</script' 가 태그를 닫지 않게
const inlineJs = standalone.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1');
// '<!--' 와 '<script' 가 함께 있으면 HTML 파서가 스크립트 안에서 다른 상태로 넘어갈 수 있다 — 생기면 멈춘다
if (/<!--/.test(inlineJs) && /<script/i.test(inlineJs)) throw new Error('인라인 스크립트에 <!-- 와 <script 가 함께 있다');
if (/<\/style/i.test(cssText)) throw new Error('CSS 에 </style 문자열이 있다');
const page = readFileSync('src/standalone.html', 'utf8')
  .replace('__VERSION__', pkg.version)
  .replace('/*__CSS__*/', () => cssText)
  .replace('/*__JS__*/', () => inlineJs);
writeFileSync('dist/docbench.html', page);

// 서버·CLI(.mjs)가 core.mjs 를 import 할 때 TypeScript 가 번들 JS 대신 이 선언을 읽는다
writeFileSync('dist/core.d.mts', "export * from './types/core/index.js';\n");
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' });

for (const f of ['docbench.js', 'docbench.iife.js', 'core.mjs', 'docbench.css', 'docbench.html', 'docbench.mjs']) {
  const b = readFileSync('dist/' + f);
  console.log(f.padEnd(18), String(statSync('dist/' + f).size).padStart(8), 'B  sha256', createHash('sha256').update(b).digest('hex').slice(0, 12));
}
