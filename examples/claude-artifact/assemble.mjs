// claude.ai 아티팩트용 한 장짜리 페이지 만들기 — DocBench CSS·IIFE 를 인라인하고 부트 스크립트를 붙인다.
//   node examples/claude-artifact/assemble.mjs <출력 index.html> [제목]
// 같은 폴더에 data/manifest.json(스키마 2), docs/<id>.md, (선택) data/inventory.json 을 두고
// Artifact 도구로 index.html 과 함께 게시한다(files). 선언: {db:{}, user:{}, comments:{}, sample:{}, downloads:true}
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
const [out, title = '문서 작업대'] = process.argv.slice(2);
if (!out) { console.error('사용법: node assemble.mjs <출력 index.html> [제목]'); process.exit(1); }
const css = readFileSync(path.join(dist, 'docbench.css'), 'utf8');
const js = readFileSync(path.join(dist, 'docbench.iife.js'), 'utf8').replace(/\/\/# sourceMappingURL=\S+\s*$/, '');
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error('번들에 닫는 태그 문자열이 있다');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 아티팩트 게시는 doctype·head·body 를 스스로 씌운다 — 여기서는 본문만 쓴다
const page = `<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root { --page: #f4f6f3; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #0f1412; color-scheme: dark; } }
:root[data-theme="dark"] { --page: #0f1412; color-scheme: dark; }
html, body { height: 100%; }
body { background: var(--page); overflow: hidden; }
#app { height: 100%; }
#app > .boot { display: grid; place-content: center; height: 100%; padding-inline: 16px; font: 500 14px/1.6 "IBM Plex Sans KR", system-ui, sans-serif; opacity: .75; }
${css}
</style>
<div id="app"><div class="boot">작업대를 여는 중…</div></div>
<script>
${js}
</script>
<script>
(async function () {
  var el = document.getElementById('app');
  var adapters = await DocBench.createArtifactAdapters({ baseLabel: '원본' });
  window.docbench = DocBench.createDocBench(el, { adapters: adapters, routing: 'hash', shortcuts: 'global', injectStyles: false });
})().catch(function (e) { document.getElementById('app').textContent = '작업대를 열지 못했습니다: ' + ((e && e.message) || e); });
</script>
`;
writeFileSync(out, page);
console.log(out, Buffer.byteLength(page), 'bytes');
