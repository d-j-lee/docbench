import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

test('CLI: init — 기록은 문서 폴더 밖(기본, 문서 폴더에 아무것도 안 만든다) · --inside 면 안 · 스킬 복사', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  await fs.rm(path.join(dir, '.docbench'), { recursive: true });
  const before = (await fs.readdir(dir)).sort();
  const r = JSON.parse((await db(dir, 'init', '.', '--json')).stdout);
  t.after(() => fs.rm(r.data, { recursive: true, force: true }));
  assert.equal(r.dataMode, 'outside');
  assert.equal(r.data, path.join(process.env.DOCBENCH_HOME, 'data', path.basename(dir)), '기록 보관함(이 PC 의 설정 폴더/data)/<문서 폴더 이름>');
  assert.deepEqual((await fs.readdir(dir)).sort(), before, '문서 폴더에는 아무것도 만들지 않는다');
  assert.ok(JSON.parse(await fs.readFile(path.join(r.data, 'config.json'), 'utf8')).notify.inbox);
  const marker = JSON.parse(await fs.readFile(path.join(r.data, 'docbench-data.json'), 'utf8'));
  assert.deepEqual([marker.docsName, marker.docsPath], [path.basename(dir), dir]);
  // 문서 폴더(또는 그 아래)에서 부르면 그 기록을 찾는다
  const st = JSON.parse((await db(path.join(dir, 'docs'), 'status', '--json')).stdout);
  assert.deepEqual([st.root, st.data, st.dataMode, st.docs], [dir, r.data, 'outside', 6]);
  // 기록 폴더 안에서 불러도 문서 폴더를 안다
  assert.equal(JSON.parse((await db(r.data, 'status', '--json')).stdout).root, dir);

  const dir2 = await tempWorkspace(); t.after(() => rm(dir2));
  await fs.rm(path.join(dir2, '.docbench'), { recursive: true });
  const r2 = JSON.parse((await db(dir2, 'init', '.', '--inside', '--claude', '--json')).stdout);
  assert.deepEqual([r2.dataMode, r2.data], ['inside', path.join(dir2, '.docbench')]);
  assert.ok(JSON.parse(await fs.readFile(path.join(dir2, '.docbench/config.json'), 'utf8')).notify.inbox);
  assert.ok((await fs.readFile(path.join(dir2, '.claude/skills/docbench-feedback/SKILL.md'), 'utf8')).includes('docbench'));
});

test('CLI: 브라우저가 기록 보관함에 만든 기록 — link 로 잇고, 다른 문서 폴더의 기록은 거부', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  await fs.rm(path.join(dir, '.docbench'), { recursive: true });
  // 브라우저처럼: 보관함 표식 + <문서 폴더 이름>/ 에 경로 없는 표식
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dbhome-')); t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.writeFile(path.join(home, 'docbench-home.json'), '{"protocol":1}');
  const data = path.join(home, path.basename(dir));
  await fs.mkdir(path.join(data, 'feedback'), { recursive: true });
  await fs.writeFile(path.join(data, 'docbench-data.json'), JSON.stringify({ protocol: 1, docsName: path.basename(dir), createdAt: '' }));
  // 아직 잇지 않았으면 문서 폴더에서 찾지 못한다(종료 2) — 아무것도 만들지 않는다
  await assert.rejects(db(dir, 'fb', 'list'), (e) => e.code === 2 && /link/.test(e.stderr));
  const pcHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dbpc-')); t.after(() => fs.rm(pcHome, { recursive: true, force: true }));
  const env = { ...process.env, DOCBENCH_HOME: pcHome, DOCBENCH_ACTOR: '' };
  const l = await run(process.execPath, [cli, 'link', dir, '--data', data, '--json'], { env });
  assert.equal(JSON.parse(l.stdout).dataHome, home, '보관함 표식이 있으면 dataHome 도');
  const pc = JSON.parse(await fs.readFile(path.join(pcHome, 'config.json'), 'utf8'));
  assert.equal(pc.dataHome, home);
  assert.equal(Object.values(pc.workspaces)[0].data, data);
  assert.equal(JSON.parse(await fs.readFile(path.join(data, 'docbench-data.json'), 'utf8')).docsPath, dir);
  const st = JSON.parse((await run(process.execPath, [cli, 'status', '--json'], { cwd: dir, env })).stdout);
  assert.deepEqual([st.data, st.dataMode], [data, 'outside']);
  // 같은 이름의 다른 문서 폴더 — 보관함의 그 이름 기록은 이미 다른 폴더의 것
  const other = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dbother-')), path.basename(dir));
  t.after(() => fs.rm(path.dirname(other), { recursive: true, force: true }));
  await fs.mkdir(other);
  // 같은 이름의 다른 문서 폴더는 보관함에서 '이름 (2)' 로 따로 — 섞이지 않는다
  const io = JSON.parse((await run(process.execPath, [cli, 'init', other, '--json'], { env })).stdout);
  assert.equal(io.data, path.join(home, path.basename(dir) + ' (2)'));
  await assert.rejects(run(process.execPath, [cli, 'link', other, '--data', data], { env }), (e) => /다른 문서 폴더/.test(e.stderr));
  // 기록 폴더 안에서 부르면 그 문서 폴더로 — 단 그 문서 폴더의 기록이 정말 여기일 때만(아무 데나 놓은 표식은 무시)
  assert.equal(JSON.parse((await run(process.execPath, [cli, 'status', '--json'], { cwd: data, env })).stdout).root, dir);
  const planted = await fs.mkdtemp(path.join(os.tmpdir(), 'dbplant-')); t.after(() => fs.rm(planted, { recursive: true, force: true }));
  await fs.writeFile(path.join(planted, 'docbench-data.json'), JSON.stringify({ protocol: 1, docsName: 'x', docsPath: dir }));
  await assert.rejects(run(process.execPath, [cli, 'status', '--json'], { cwd: planted, env }), (e) => e.code === 2);
  // 짝의 기록 폴더가 없어지면(드라이브가 빠짐) 새로 만들지 않고 멈춘다
  await fs.rename(data, data + '.away');
  await assert.rejects(run(process.execPath, [cli, 'fb', 'list'], { cwd: dir, env }), (e) => e.code === 2 && /기록 폴더가 없습니다/.test(e.stderr));
  await assert.rejects(fs.stat(data), '빈 기록을 몰래 만들지 않는다');
  await fs.rename(data + '.away', data);
  // 문서 폴더 안을 기록 폴더로 주면 거부(문서로 훑힌다)
  await assert.rejects(run(process.execPath, [cli, 'link', dir, '--data', path.join(dir, 'records')], { env }), (e) => /문서 폴더 밖/.test(e.stderr));
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

test('CLI: 홈 폴더는 위로 찾아낸 작업 폴더로 치지 않는다 (홈에 .docbench 가 있어도 종료 2)', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'docbench-fakehome-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, '.docbench'), { recursive: true });
  await fs.writeFile(path.join(home, 'diary.md'), '# 일기\n');
  const app = path.join(home, 'projects', 'app');
  await fs.mkdir(app, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.DOCBENCH_ROOT;
  const r = await run(process.execPath, [path.join(repo, 'bin/docbench.mjs'), 'status'], { cwd: app, env }).then(() => 0, (e) => e.code);
  assert.equal(r, 2);
  assert.deepEqual(await fs.readdir(path.join(home, '.docbench')), [], '홈의 .docbench 에 아무것도 만들지 않는다');
});

test('CLI: 이름이 같은 다른 문서 폴더는 보관함의 기록을 가져가지 않는다(문서 표본) · 빈 폴더가 표본을 지우지 않는다', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsame-')); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'H'), pc = path.join(base, 'pc');
  await fs.mkdir(path.join(home, 'd'), { recursive: true });
  await fs.mkdir(pc);
  await fs.writeFile(path.join(home, 'docbench-home.json'), '{"protocol":1}');
  await fs.writeFile(path.join(pc, 'config.json'), JSON.stringify({ dataHome: home }));
  // 브라우저가 만든 기록: 경로는 없고 문서 표본만
  await fs.writeFile(path.join(home, 'd', 'docbench-data.json'), JSON.stringify({ protocol: 1, docsName: 'd', createdAt: '', docs: ['README.md', 'guide/a.md', 'guide/b.md'] }));
  const mk = async (p, files) => { for (const f of files) { await fs.mkdir(path.dirname(path.join(p, f)), { recursive: true }); await fs.writeFile(path.join(p, f), '# x\n'); } };
  const other = path.join(base, 'other', 'd'); await mk(other, ['README.md', 'api/y.md', 'api/z.md']);
  const empty = path.join(base, 'empty', 'd'); await fs.mkdir(empty, { recursive: true });
  const real = path.join(base, 'real', 'd'); await mk(real, ['README.md', 'guide/a.md', 'guide/b.md', 'guide/c.md']);
  const env = { ...process.env, DOCBENCH_HOME: pc, DOCBENCH_ACTOR: '' };
  const init = async (p) => JSON.parse((await run(process.execPath, [cli, 'init', p, '--json'], { env })).stdout).data;
  assert.equal(await init(other), path.join(home, 'd (2)'), 'README 하나만 같으면 다른 폴더');
  assert.equal(await init(empty), path.join(home, 'd (3)'), '빈 폴더는 표본이 있는 기록과 다르다');
  const m0 = JSON.parse(await fs.readFile(path.join(home, 'd', 'docbench-data.json'), 'utf8'));
  assert.deepEqual([m0.docsPath, m0.docs.length], [undefined, 3], '남의 기록은 손대지 않는다');
  assert.equal(await init(real), path.join(home, 'd'), '진짜 폴더는 제 기록으로');
  assert.equal(JSON.parse(await fs.readFile(path.join(home, 'd', 'docbench-data.json'), 'utf8')).docsPath, real);
  // README 하나로 시작한 폴더(표본이 README 뿐)에 문서가 늘어도 제 기록
  await fs.mkdir(path.join(home, 'n'));
  await fs.writeFile(path.join(home, 'n', 'docbench-data.json'), JSON.stringify({ protocol: 1, docsName: 'n', createdAt: '', docs: ['README.md'] }));
  const n = path.join(base, 'grow', 'n'); await mk(n, ['README.md', 'plan.md']);
  assert.equal(await init(n), path.join(home, 'n'));
});
