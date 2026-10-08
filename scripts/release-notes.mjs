// CHANGELOG.md 에서 한 판의 절을 꺼내 GitHub Release 본문으로 — CI(.github/workflows/ci.yml)가 부른다.
//   node scripts/release-notes.mjs [판] [첨부 폴더]
//     판을 비우면 package.json 의 version, 첨부 폴더를 비우면 release/ (지난 판을 뒤늦게 낼 때는 그 커밋에서 꺼낸 파일 폴더)
// 그 판의 절이 없으면 실패한다(릴리스하지 않는다). 본문 끝에 첨부 파일의 SHA-256 을 붙인다.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const assets = path.resolve(process.argv[3] || 'release');
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const version = process.argv[2] || JSON.parse(readFileSync('package.json', 'utf8')).version;
const lines = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n?/g, '\n').split('\n');
const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
if (end < 0) end = lines.length;
const body = start < 0 ? '' : lines.slice(start + 1, end).join('\n').trim();
if (!body) { console.error(`CHANGELOG.md 에 ${version} 절(## ${version} — 날짜)이 없습니다.`); process.exit(1); }
const files = ['docbench.html', 'docbench.mjs'].filter((f) => existsSync(path.join(assets, f)));
const sha = (f) => createHash('sha256').update(readFileSync(path.join(assets, f))).digest('hex');
process.stdout.write(`${body}
${files.includes('docbench.html') ? `
**쓰는 법**: \`docbench.html\` 을 받아 엣지·크롬으로 엽니다. 서버·설치가 필요 없습니다.${files.includes('docbench.mjs') ? ' Claude 작업 실행기(선택)는 화면의 안내를 따르면 이 태그의 `docbench.mjs` 를 받아 지문을 확인한 뒤 씁니다.' : ''}
` : ''}${files.length ? `
SHA-256
${files.map((f) => `- ${f} \`${sha(f)}\``).join('\n')}
` : ''}`);
