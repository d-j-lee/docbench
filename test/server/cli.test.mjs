import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { repo, tempWorkspace, rm } from './helpers.mjs';

const run = promisify(execFile);
const cli = path.join(repo, 'bin/docbench.mjs');
const db = (cwd, ...args) => run(process.execPath, [cli, ...args], { cwd, env: { ...process.env, DOCBENCH_ACTOR: '' } });

test('CLI: 사람이 남긴 피드백을 AI 가 처리하는 한 바퀴', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const sec = '윈도우에서 만든 메모 › 할 일';
  const add = await db(dir, 'fb', 'add', '--as', 'human:dj', '--doc', 'notes/윈도우-메모.md', '--section', sec, '-m', '저장 확인 항목 추가', '--json');
  const f = JSON.parse(add.stdout);
  assert.equal(f.waitingOn, 'assistant');
  const list = JSON.parse((await db(dir, 'fb', 'list', '--waiting', 'assistant', '--json')).stdout);
  assert.deepEqual(list.map((x) => x.id), [f.id]);
  const show = JSON.parse((await db(dir, 'fb', 'show', f.id, '--json')).stdout);
  assert.equal(show.doc.eol, 'crlf'); assert.equal(show.doc.bom, true);
  assert.ok(show.sectionText.startsWith('## 할 일\n'));
  const file = path.join(dir, 'new.md');
  await fs.writeFile(file, show.sectionText.replace(/\n*$/, '\n- 저장 확인\n'));
  const w = await db(dir, 'doc', 'write', 'notes/윈도우-메모.md', '--section', sec, '--file', file, '--base', show.doc.version, '-m', '항목 추가', '--fb', f.id);
  assert.match(w.stdout, /저장/);
  const bytes = await fs.readFile(path.join(dir, 'notes/윈도우-메모.md'));
  assert.ok(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  assert.ok(bytes.toString('utf8').includes('- 저장 확인\r\n'));
  await db(dir, 'fb', 'reply', f.id, '-m', '추가했습니다', '--resolve');
  const st = JSON.parse((await db(dir, 'status', '--json')).stdout);
  assert.equal(st.feedback.resolved, 1);
  const g = JSON.parse((await db(dir, 'fb', 'show', f.id, '--json')).stdout).feedback;
  assert.equal(g.thread.at(-1).author.kind, 'assistant');
});

test('CLI: 판이 바뀌었으면 쓰기 거부(종료 코드 3)', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  await assert.rejects(db(dir, 'doc', 'write', 'README.md', '--file', path.join(dir, 'README.md'), '--base', 'ffffffffffffffff'), (e) => e.code === 3);
});

test('CLI: 제안 올리기 → 사람 차례', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const f = JSON.parse((await db(dir, 'fb', 'add', '--as', 'human:dj', '--doc', 'docs/설계-노트.md', '--section', '알림 서비스 설계 노트 › 배경', '-m', '한 줄 요약', '--json')).stdout);
  const file = path.join(dir, 'p.md');
  await fs.writeFile(file, '## 배경\n\n요약: 재시도 폭주가 원인.\n');
  const g = JSON.parse((await db(dir, 'fb', 'propose', f.id, '--file', file, '-m', '요약 한 줄', '--json')).stdout);
  assert.equal(g.waitingOn, 'owner');
  assert.equal(g.proposal.state, 'pending');
  assert.ok(g.proposal.before.startsWith('## 배경'));
});

test('CLI: init 과 Claude Code 스킬 복사', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  await fs.rm(path.join(dir, '.docbench'), { recursive: true });
  await db(dir, 'init', '.', '--claude');
  assert.ok(JSON.parse(await fs.readFile(path.join(dir, '.docbench/config.json'), 'utf8')).notify.inbox);
  assert.ok((await fs.readFile(path.join(dir, '.claude/skills/docbench-feedback/SKILL.md'), 'utf8')).includes('docbench'));
});

test('CLI: 작업 폴더 밖이면 만들지 않고 멈춘다(종료 2), DOCBENCH_ROOT 를 따른다', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const outside = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'nows-')); t.after(() => rm(outside));
  await assert.rejects(db(outside, 'fb', 'list'), (e) => e.code === 2);
  assert.equal((await fs.readdir(outside)).length, 0, '.docbench 를 몰래 만들지 않는다');
  const r = await run(process.execPath, [cli, 'status', '--json'], { cwd: outside, env: { ...process.env, DOCBENCH_ROOT: dir } });
  assert.equal(JSON.parse(r.stdout).docs, 6);
});

test('CLI: 섹션 쓰기 안전장치 — 판 필수, 제목 줄 유지, 하위 섹션 보존, BOM 입력', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const id = 'docs/설계-노트.md';
  const key = '알림 서비스 설계 노트 › 구조';
  const v = JSON.parse((await db(dir, 'doc', 'show', id, '--json')).stdout).version;
  const file = path.join(dir, 'in.md');
  await fs.writeFile(file, '## 구조\n\n짧게\n');
  await assert.rejects(db(dir, 'doc', 'write', id, '--section', key, '--file', file), (e) => e.code === 1 && /--base/.test(e.stderr));
  await assert.rejects(db(dir, 'doc', 'write', id, '--section', key, '--file', file, '--base', v), (e) => /하위 섹션이 사라집니다/.test(e.stderr));
  await fs.writeFile(file, '본문만\n');
  await assert.rejects(db(dir, 'doc', 'write', id, '--section', '알림 서비스 설계 노트 › 배경', '--file', file, '--base', v), (e) => /첫 줄이 제목이 아닙니다/.test(e.stderr));
  // 메모장·PowerShell 이 붙이는 BOM 은 벗겨서 받는다
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('## 배경\r\n\r\n한 줄 요약.\r\n')]));
  await db(dir, 'doc', 'write', id, '--section', '알림 서비스 설계 노트 › 배경', '--file', file, '--base', v);
  const secs = JSON.parse((await db(dir, 'doc', 'sections', id, '--json')).stdout).map((s) => s.key);
  assert.ok(secs.includes('알림 서비스 설계 노트 › 배경'));
  assert.ok(!(await fs.readFile(path.join(dir, id), 'utf8')).includes('\ufeff'));
});

test('CLI: 넘기기 요청함 보기·비우기, 불린 플래그가 뒤 인자를 삼키지 않는다', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  await fs.mkdir(path.join(dir, '.docbench/inbox'), { recursive: true });
  await fs.writeFile(path.join(dir, '.docbench/inbox/req-1.json'), JSON.stringify({ at: 'now', count: 2, docs: ['README.md'], feedbackIds: ['a', 'b'] }));
  assert.equal(JSON.parse((await db(dir, 'inbox', '--json')).stdout).length, 1);
  await db(dir, 'inbox', '--clear');
  assert.equal(JSON.parse((await db(dir, 'inbox', '--json')).stdout).length, 0);
  const file = path.join(dir, 'x.md');
  await fs.writeFile(file, '# 예제 작업 폴더\n\n바뀜\n');
  const r = await run(process.execPath, [cli, 'doc', 'write', '--file', file, '--json', 'README.md'], { cwd: dir });
  assert.ok(JSON.parse(r.stdout).version);
});
