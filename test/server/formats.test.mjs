// 여러 형식(D87)·작업 공간 개요(D88) — 서버(Workspace·REST)와 CLI 가 같은 규칙으로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Workspace } from '../../server/workspace.mjs';
import { startServer } from '../../server/index.mjs';
import * as core from '../../dist/core.mjs';
import { tempWorkspace, rm, pcFileFor, repo } from './helpers.mjs';
import { sampleDocx, zipFiles } from '../fixtures/office.mjs';

const run = promisify(execFile);
const cli = path.join(repo, 'bin/docbench.mjs');
const db = (cwd, ...args) => run(process.execPath, [cli, ...args], { cwd, env: { ...process.env, DOCBENCH_ACTOR: '' } });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f4e0e50000000049454e44ae426082', 'hex');

/** 예제 작업 폴더 + 여러 형식 */
async function formatsWorkspace(t, patch) {
  const dir = await tempWorkspace(patch);
  t.after(() => rm(dir));
  await fs.mkdir(path.join(dir, 'config'), { recursive: true });
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dir, 'config/app.yaml'), '# 설정\nserver:\n  port: 8080\n  tls:\n    on: true\nretry:\n  max: 5\n');
  await fs.writeFile(path.join(dir, 'config/pkg.json'), '{\n  "name": "x",\n  "scripts": {\n    "test": "vitest"\n  }\n}\n');
  await fs.writeFile(path.join(dir, 'docs/계획.docx'), sampleDocx());
  await fs.writeFile(path.join(dir, 'docs/깨진.docx'), Buffer.from('PK\x03\x04 broken'));
  await fs.writeFile(path.join(dir, 'assets/a.png'), PNG);
  await fs.writeFile(path.join(dir, 'docs/notes.txt'), '그냥 글\n');
  return dir;
}

test('형식마다 읽기: 구조 글은 글·섹션, 뽑은 글은 마크다운(읽기 전용), 그림은 바이트만, 깨진 파일은 까닭', async (t) => {
  const dir = await formatsWorkspace(t);
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  const y = await ws.readDoc('config/app.yaml');
  assert.equal(y.format, 'yaml');
  assert.ok(!y.readOnly);
  assert.deepEqual(core.sectionSources(y.md, y.id).map((s) => s.key), ['server', 'server › tls', 'retry']);
  const w = await ws.readDoc('docs/계획.docx');
  assert.equal(w.format, 'docx');
  assert.equal(w.readOnly, true);
  assert.equal(w.readOnlyReason, 'format');
  assert.match(w.md, /^# 배포 계획/m);
  assert.ok(w.binary.size > 0);
  const bad = await ws.readDoc('docs/깨진.docx');
  assert.ok(bad.deriveError, '깨진 오피스 파일은 까닭을 준다');
  assert.equal(bad.md, '');
  const img = await ws.readDoc('assets/a.png');
  assert.deepEqual([img.md, img.readOnlyReason, img.binary.mime], ['', 'format', 'image/png']);
  assert.ok((await ws.readBytes('assets/a.png')).equals(PNG));
  // 판은 파일 바이트의 해시 — 같은 파일이면 같은 판(뽑은 글도)
  assert.equal((await ws.readDoc('docs/계획.docx')).version, w.version);
});

test('쓰기: 뽑은 글·그림은 원본을 고치지 않는다(READ_ONLY format) · 구조 글 섹션은 바이트 그대로 · 큰 글은 앞부분만(too-large)', async (t) => {
  const dir = await formatsWorkspace(t);
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  const w = await ws.readDoc('docs/계획.docx');
  await assert.rejects(ws.writeDoc('docs/계획.docx', '# x\n', { baseVersion: w.version }), { code: 'READ_ONLY', reason: 'format' });
  await assert.rejects(ws.writeDoc('assets/a.png', 'x', {}), { code: 'READ_ONLY', reason: 'format' });
  const y = await ws.readDoc('config/app.yaml');
  const next = core.replaceSection(y.md, 'server › tls', '  tls:\n    on: false\n', y.id);
  const r = await ws.writeDoc(y.id, next, { baseVersion: y.version, summary: 'tls 끔' });
  assert.equal(await fs.readFile(path.join(dir, 'config/app.yaml'), 'utf8'), '# 설정\nserver:\n  port: 8080\n  tls:\n    on: false\nretry:\n  max: 5\n');
  const ch = (await ws.changes(10)).find((c) => c.toVersion === r.version);
  assert.deepEqual(ch.sections, ['server › tls'], '이력의 바뀐 섹션도 YAML 키로');
  // 5 MB 넘는 글: 앞부분만, 줄 경계에서 자르고, 고치지 않는다
  const big = '# 큰 글\n' + ('가나다라마바사 아자차카타파하\n'.repeat(260_000));
  await fs.writeFile(path.join(dir, 'docs/big.md'), big);
  const b = await ws.readDoc('docs/big.md');
  assert.equal(b.readOnlyReason, 'too-large');
  assert.ok(b.truncated.bytes <= core.TEXT_PREVIEW_BYTES && b.truncated.total === Buffer.byteLength(big));
  assert.ok(b.md.endsWith('\n'), '줄 중간에서 자르지 않는다');
  await assert.rejects(ws.writeDoc('docs/big.md', '# x\n', { baseVersion: b.version }), { code: 'READ_ONLY', reason: 'too-large' });
});

test('새 문서: 만들고 이력에 남김 · 있으면 충돌 · 폴더가 없거나 고칠 수 없는 형식이면 거부 · Claude 는 바로 고칠 수 있는 형식만', async (t) => {
  const dir = await formatsWorkspace(t);
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  const r = await ws.createDoc('docs/새.md', '# 새 문서\n\n## 할 일\n', { summary: '만듦' });
  assert.equal(await fs.readFile(path.join(dir, 'docs/새.md'), 'utf8'), '# 새 문서\n\n## 할 일\n');
  const ch = (await ws.changes(5)).find((c) => c.docId === 'docs/새.md');
  assert.deepEqual([ch.toVersion, ch.fromVersion, ch.sections], [r.version, undefined, ['새 문서', '새 문서 › 할 일']]);
  assert.ok((await ws.manifest()).docs['docs/새.md'], '목록에 바로');
  await assert.rejects(ws.createDoc('docs/새.md', 'x'), { code: 'CONFLICT' });
  await assert.rejects(ws.createDoc('없는폴더/a.md', 'x'), { code: 'BAD_REQUEST' });
  await assert.rejects(ws.createDoc('docs/a.docx', 'x'), { code: 'BAD_REQUEST' });
  await assert.rejects(ws.createDoc('../밖.md', 'x'), { code: 'BAD_REQUEST' });
  await assert.rejects(ws.createDoc('docs/.env', 'x'), { code: 'BAD_REQUEST' });
  await assert.rejects(ws.createDoc('docs/run.sh', 'x'), { code: 'BAD_REQUEST' }, '코드는 기본으로 문서가 아니다');
  // Claude 가 새 설정 파일(도구가 저절로 읽는다)을 만들지 않는다
  const claude = { kind: 'assistant', name: 'Claude' };
  await assert.rejects(ws.createDoc('config/docker-compose.override.yml', 'services: {}\n', { by: claude }), { code: 'READ_ONLY', reason: 'format' });
  await ws.createDoc('docs/정리.md', '# 정리\n', { by: claude });
});

test('REST: 세션 기능 · /raw(내려받기로만) · /overview · POST /doc', async (t) => {
  const dir = await formatsWorkspace(t);
  const s = await startServer({ root: dir, port: 0, pcConfigFile: pcFileFor(dir) });
  t.after(() => s.close());
  const base = `http://127.0.0.1:${s.port}/api`;
  const ses = await (await fetch(base + '/session')).json();
  assert.deepEqual([ses.features.raw, ses.features.overview, ses.features.create], [true, true, true]);
  const raw = await fetch(base + '/raw?id=' + encodeURIComponent('assets/a.png'));
  assert.equal(raw.status, 200);
  assert.ok(Buffer.from(await raw.arrayBuffer()).equals(PNG));
  assert.equal(raw.headers.get('content-type'), 'application/octet-stream', '서버는 형식을 붙이지 않는다(화면이 Blob 으로)');
  assert.match(raw.headers.get('content-disposition'), /^attachment;/);
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
  assert.match(raw.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await fetch(base + '/raw?id=' + encodeURIComponent('src/x.ts'))).status, 400, '문서가 아닌 파일은 내주지 않는다');
  assert.equal((await fetch(base + '/raw?id=' + encodeURIComponent('../../etc/passwd'))).status, 400);
  const ov = await (await fetch(base + '/overview')).json();
  assert.equal(ov.purpose.from, 'readme');
  assert.ok(ov.totals.docs >= 10);
  assert.ok(ov.groups.some((g) => g.group === 'office'));
  const post = (id, md) => fetch(base + '/doc?id=' + encodeURIComponent(id), { method: 'POST', headers: { 'X-DocBench': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ md, summary: 's' }) });
  const c = await post('docs/새-글.md', '# 새 글\n');
  assert.equal(c.status, 201);
  assert.equal((await c.json()).id, 'docs/새-글.md');
  const again = await post('docs/새-글.md', '# x\n');
  assert.equal(again.status, 409);
  assert.equal((await again.json()).current.md, '# 새 글\n');
  const noCsrf = await fetch(base + '/doc?id=x.md', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"md":"x"}' });
  assert.equal(noCsrf.status, 403);
});

test('개요: README 없는 폴더·비밀 이름·사본·깨진 링크 — 내용(비밀)은 열지 않는다', async (t) => {
  const dir = await formatsWorkspace(t);
  await fs.writeFile(path.join(dir, '.env'), 'TOKEN=sekret-value\n');
  await fs.writeFile(path.join(dir, 'docs/설계-노트_v2.md'), '# 사본\n');
  await fs.appendFile(path.join(dir, 'docs/운영-런북.md'), '\n[없는 곳](../없음.md)\n');
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  const ov = await ws.overview();
  const code = (c) => ov.checks.find((x) => x.code === c);
  assert.deepEqual(code('secrets').paths, ['.env']);
  assert.ok(code('version-copies').paths.includes('docs/설계-노트_v2.md'));
  assert.deepEqual(code('broken-links').paths, ['docs/운영-런북.md']);
  assert.ok(!JSON.stringify(ov).includes('sekret-value'), '비밀 파일 내용은 읽지 않는다');
  assert.ok(ov.ai.length === 0 || ov.ai.every((a) => a.path));
});

test('CLI: 형식 — doc list/sections, Claude 는 설정 파일을 바로 고치지 않고(제안), 뽑은 글은 고치지 않는다 · doc new · overview', async (t) => {
  const dir = await formatsWorkspace(t);
  const list = JSON.parse((await db(dir, 'doc', 'list', '--json')).stdout);
  assert.equal(list.find((d) => d.id === 'config/app.yaml').format, 'yaml');
  const secs = JSON.parse((await db(dir, 'doc', 'sections', 'config/app.yaml', '--json')).stdout);
  assert.deepEqual(secs.map((s) => [s.key, s.line]), [['server', 1], ['server › tls', 4], ['retry', 6]]);
  // Claude(기본 작성자)는 YAML 을 바로 쓰지 못한다 — 종료 4, 제안으로 안내
  const y = JSON.parse((await db(dir, 'doc', 'show', 'config/app.yaml', '--json')).stdout);
  await fs.writeFile(path.join(dir, 'tls.txt'), '  tls:\n    on: false\n');
  await assert.rejects(db(dir, 'doc', 'write', 'config/app.yaml', '--section', 'server › tls', '--base', y.version, '--file', 'tls.txt'), (e) => e.code === 4 && /fb propose/.test(e.stderr));
  // 사람(--as human)은 쓸 수 있다
  await db(dir, 'doc', 'write', 'config/app.yaml', '--section', 'server › tls', '--base', y.version, '--file', 'tls.txt', '--as', 'human:dj');
  assert.match(await fs.readFile(path.join(dir, 'config/app.yaml'), 'utf8'), /on: false/);
  // 문서 전체 피드백에 문서 전체 제안 (섹션이 없는 형식도) — JSON 이 깨지면 거부
  const fb = JSON.parse((await db(dir, 'fb', 'add', '--doc', 'config/pkg.json', '-m', '이름을 바꿔 줘', '--as', 'human:dj', '--json')).stdout);
  await fs.writeFile(path.join(dir, 'bad.json'), '{ "name": "y", }');
  await assert.rejects(db(dir, 'fb', 'propose', fb.id, '--file', 'bad.json'), (e) => /JSON/.test(e.stderr));
  await fs.writeFile(path.join(dir, 'good.json'), '{\n  "name": "y",\n  "scripts": {\n    "test": "vitest"\n  }\n}\n');
  const p = JSON.parse((await db(dir, 'fb', 'propose', fb.id, '--file', 'good.json', '-m', '이름', '--json')).stdout);
  assert.deepEqual([p.proposal.path, p.waitingOn], [[], 'owner']);
  // 뽑은 글은 고치지 않는다
  const w = JSON.parse((await db(dir, 'doc', 'show', 'docs/계획.docx', '--json')).stdout);
  assert.equal(w.readOnlyReason, 'format');
  await assert.rejects(db(dir, 'doc', 'write', 'docs/계획.docx', '--base', w.version, '--file', 'tls.txt', '--as', 'human:dj'), (e) => e.code === 4);
  // 새 문서 — 이미 있으면 3
  await fs.writeFile(path.join(dir, 'new.md'), '# 새\n');
  const made = JSON.parse((await db(dir, 'doc', 'new', 'docs/새.md', '--file', 'new.md', '--json')).stdout);
  assert.equal(made.id, 'docs/새.md');
  await assert.rejects(db(dir, 'doc', 'new', 'docs/새.md', '--file', 'new.md'), (e) => e.code === 3);
  // 개요 — 사람이 읽는 글과 JSON
  const text = (await db(dir, 'overview')).stdout;
  assert.match(text, /^작업 공간: /);
  assert.match(text, /목적: /);
  assert.match(text, /점검/);
  const o = JSON.parse((await db(dir, 'overview', '--json')).stdout);
  assert.ok(o.folders.some((f) => f.path === 'docs'));
});

test('바닥 규칙(D71)은 그대로 — include 를 넓혀도 숨김·모르는 형식은 문서가 아니다 · 코드는 넓히면 문서(제안만)', async (t) => {
  const dir = await formatsWorkspace(t, (c) => ({ ...c, include: ['**/*'] }));
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/main.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(dir, '.git/hooks'), { recursive: true });
  await fs.writeFile(path.join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\n');
  await fs.writeFile(path.join(dir, 'tool.exe'), 'MZ');
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  assert.ok(ws.docs.has('src/main.ts'));
  assert.ok(!ws.docs.has('.git/hooks/pre-commit') && !ws.docs.has('tool.exe'));
  assert.deepEqual(core.claudeChanges(core.formatFor('src/main.ts')), ['propose']);
});

test('뽑기: ZIP 이 아닌 것·암호 걸린 오피스 — 서버가 멈추지 않고 까닭을 준다', async (t) => {
  const dir = await formatsWorkspace(t);
  await fs.writeFile(path.join(dir, 'docs/암호.docx'), Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(512)]));
  await fs.writeFile(path.join(dir, 'docs/빈.xlsx'), zipFiles({ 'x.txt': 'x' }));
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  assert.equal((await ws.readDoc('docs/암호.docx')).deriveError, 'not-zip');
  const empty = await ws.readDoc('docs/빈.xlsx');
  assert.ok(empty.deriveError || empty.md === '', '시트가 없는 Excel');
});
