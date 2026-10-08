import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Workspace, locateData } from '../../server/workspace.mjs';
import os from 'node:os';
import { tempWorkspace, rm, pcFileFor } from './helpers.mjs';
import crypto from 'node:crypto';

test('작업 폴더: 문서 목록·매니페스트·그룹', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  assert.equal(ws.docs.size, 6);
  const m = await ws.manifest();
  assert.equal(m.schema, 2);
  assert.deepEqual(m.groups.map((g) => g.id), ['_bench', 'intro', 'core', 'qa', 'notes']);
  assert.equal(m.docs['docs/설계-노트.md'].trust, 'draft');
  assert.equal(m.docs['notes/옛-회의록.md'].title, '옛 회의록 (2019)');
});

test('경로 밖·대상 아닌 파일은 거부', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  for (const bad of ['../x.md', '/etc/passwd', 'C:/x.md', 'docs/../../x.md', 'data/지표.csv', '.docbench/config.json', 'a\0b.md']) {
    await assert.rejects(ws.readDoc(bad), { code: 'BAD_REQUEST' }, bad);
  }
});

test('심볼릭 링크로 작업 폴더 밖을 가리키면 거부', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const outside = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'outside-'));
  t.after(() => rm(outside));
  await fs.writeFile(path.join(outside, 'secret.md'), '# 비밀\n');
  await fs.symlink(path.join(outside, 'secret.md'), path.join(dir, 'docs/link.md'));
  const ws = await new Workspace(dir).init();
  await assert.rejects(ws.readDoc('docs/link.md'), { code: 'BAD_REQUEST' });
});

test('저장: 판이 다르면 충돌, 같으면 저장하고 이력·바뀐 섹션 기록', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir, { actor: { kind: 'assistant', name: 'Claude' } }).init();
  const d = await ws.readDoc('docs/운영-런북.md');
  await assert.rejects(ws.writeDoc(d.id, d.md + 'x', { baseVersion: '0000000000000000' }), (e) => e.code === 'CONFLICT' && e.current.version === d.version);
  const next = d.md.replace('TODO: 멱등 키 확인 절차 정리', '멱등 키는 요청 id 로 확인한다.');
  const r = await ws.writeDoc(d.id, next, { baseVersion: d.version, summary: '중복 발송 절차', feedbackIds: ['fb-1'] });
  assert.notEqual(r.version, d.version);
  const ch = await ws.changes();
  assert.equal(ch.length, 1);
  assert.deepEqual(ch[0].sections, ['알림 서비스 운영 런북 › 장애 대응 › 중복 발송']);
  assert.equal(ch[0].by.kind, 'assistant');
  assert.equal((await ws.docVersion(d.id, d.version)).md, d.md, '이전 판 본문 보관');
  assert.deepEqual(await ws.writeDoc(d.id, next, { baseVersion: r.version }).then((x) => !!x.unchanged), true);
});

test('BOM·CRLF·EUC-KR 문서는 저장 후에도 모양 유지', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  for (const id of ['notes/윈도우-메모.md', 'notes/옛-회의록.md']) {
    const before = await fs.readFile(path.join(dir, id));
    const d = await ws.readDoc(id);
    await ws.writeDoc(id, d.md + '\n추가\n', { baseVersion: d.version });
    const after = await fs.readFile(path.join(dir, id));
    assert.equal(after.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), before.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), id + ' BOM');
    const s = after.toString('latin1');
    assert.equal(s.split('\r\n').length - 1, s.split('\n').length - 1, id + ' 모든 줄이 CRLF');
    const again = await ws.readDoc(id);
    assert.equal(again.encoding, d.encoding);
    assert.ok(again.md.endsWith('추가\n'));
  }
});

test('외부 편집 감지: 에디터가 직접 고치면 external 로 기록', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  await ws.reconcileAll();
  // 안 연 문서는 따라가지 않는다(D64) — 판을 적지 않고, 바뀌어도 이력에 남지 않는다
  assert.deepEqual((await ws.known()).docs, {});
  await ws.readDoc('docs/질의응답.md');
  assert.deepEqual(Object.keys((await ws.known()).docs), ['docs/질의응답.md'], '연 문서부터 판을 적는다');
  const f = path.join(dir, 'docs/질의응답.md');
  await fs.appendFile(f, '\n## 추가 질문\n\n답.\n');
  assert.equal(await ws.reconcile('docs/질의응답.md'), true);
  assert.equal(await ws.reconcile('docs/질의응답.md'), false, '두 번 기록하지 않음');
  const ch = await ws.changes();
  assert.equal(ch.at(-1).by.kind, 'external');
  assert.deepEqual(ch.at(-1).sections, ['알림 서비스 질의응답 › 추가 질문']);
  await ws.appendChange({ type: 'note', at: new Date().toISOString(), docId: 'docs/질의응답.md', toVersion: ch.at(-1).toVersion, by: { kind: 'assistant', name: 'Claude' }, summary: '질문 추가' });
  const merged = (await ws.changes()).at(-1);
  assert.equal(merged.summary, '질문 추가');
  assert.equal(merged.by.kind, 'assistant', '요약을 단 쪽이 작성자로');
});

test('피드백: 만들기·고치기(판 충돌)·지우기, 파일 하나 = 한 건', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir, { actor: { kind: 'human', name: 'dj' } }).init();
  const f = await ws.createFeedback({ docId: 'docs/설계-노트.md', target: { kind: 'section', path: ['알림 서비스 설계 노트', '위험', '메모'], heading: '메모' }, body: '수치' });
  assert.equal(f.waitingOn, 'assistant'); assert.equal(f.version, 1);
  assert.ok((await fs.readdir(path.join(dir, '.docbench/feedback'))).includes(f.id + '.json'));
  const g = await ws.updateFeedback(f.id, { status: 'resolved' }, 1);
  assert.equal(g.version, 2);
  await assert.rejects(ws.updateFeedback(f.id, { status: 'open' }, 1), { code: 'CONFLICT' });
  await assert.rejects(ws.createFeedback({ docId: '../x.md', body: '' }), { code: 'BAD_REQUEST' });
  await assert.rejects(ws.getFeedback('../../etc'), { code: 'BAD_REQUEST' });
  await ws.deleteFeedback(f.id);
  assert.equal((await ws.listFeedback()).length, 0);
});

test('폴더 지도: 문서 아닌 파일도 보이고 문서 표시', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  const inv = await ws.inventory();
  const csv = inv.items.find((i) => i.id === 'data/지표.csv');
  assert.ok(csv && !csv.docId);
  assert.ok(inv.items.find((i) => i.id === 'docs/설계-노트.md').flags.includes('doc'));
  assert.ok(!inv.items.some((i) => i.id.startsWith('.docbench')));
});

test('설정: 실행 명령·이름은 문서 폴더 밖 PC 설정에서만 — 폴더 config.json 의 것은 무시(경고), BOM 도 읽는다', async (t) => {
  const dir = await tempWorkspace((c) => ({ ...c, user: '공유된이름', assistant: { command: ['evil'] }, notify: { inbox: true, command: ['evil'], message: '공유 안내' } }));
  t.after(() => rm(dir));
  const pcFile = pcFileFor(dir);
  let ws = await new Workspace(dir, { pcConfigFile: pcFile }).init();
  assert.equal(ws.config.assistant, null, '공유 설정의 assistant 는 쓰지 않는다');
  assert.equal(ws.config.notify.command, null);
  assert.notEqual(ws.me.name, '공유된이름', '공유 설정의 user 로 모두가 한 사람이 되지 않는다');
  assert.equal(ws.config.notify.message, '공유 안내', '명령이 아닌 값은 그대로');
  assert.equal(ws.config.warnings.length, 3);
  // PC 설정: 맨 위 기본값 + 폴더별(경로는 '/'·끝 '/' 무시). 메모장·PowerShell 5.1 의 BOM
  const key = dir.replace(/\\/g, '/') + '/';
  await fs.writeFile(pcFile, '\ufeff' + JSON.stringify({ user: '김철수', assistant: { command: 'claude' }, workspaces: { [key]: { notify: { command: ['node', 'x.mjs'] } } } }));
  ws = await new Workspace(dir, { pcConfigFile: pcFile }).init();
  assert.deepEqual(ws.config.assistant, { command: 'claude' });
  assert.deepEqual(ws.config.notify.command, ['node', 'x.mjs']);
  assert.equal(ws.me.name, '김철수');
  const other = await new Workspace(path.join(dir, 'docs'), { pcConfigFile: pcFile }).init().catch(() => null);
  if (other) assert.equal(other.config.notify.command, null, '다른 폴더에는 폴더별 값이 안 간다');
  // 폴더 config.json 의 BOM
  const raw = JSON.parse(await fs.readFile(path.join(dir, '.docbench/config.json'), 'utf8'));
  await fs.writeFile(path.join(dir, '.docbench/config.json'), '\ufeff' + JSON.stringify({ ...raw, title: 'BOM 제목' }));
  ws = await new Workspace(dir, { pcConfigFile: pcFile }).init();
  assert.equal(ws.config.title, 'BOM 제목');
});

test('예전 판의 .docbench/.gitignore 에 빠진 줄을 덧붙인다 (사람이 더한 줄은 그대로)', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  await fs.writeFile(path.join(dir, '.docbench/.gitignore'), 'blobs/\nviewstate/\nmy-notes/\n');
  await new Workspace(dir).init();
  const gi = await fs.readFile(path.join(dir, '.docbench/.gitignore'), 'utf8');
  for (const l of ['blobs/', 'my-notes/', 'locks/', 'state.json', 'inbox/']) assert.ok(gi.split('\n').includes(l), l);
  assert.equal(gi.split('\n').filter((l) => l === 'blobs/').length, 1);
});

test('이력 잠금이 남아 있으면 문서도 쓰지 않는다 — 문서만 바뀌고 이력이 사라지지 않게', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  const d = await ws.readDoc('README.md');
  // 다른 프로세스가 이력 잠금을 쥐고 있다가 1초 뒤 놓는다
  const lockFile = path.join(dir, '.docbench/locks', crypto.createHash('sha1').update('changes').digest('hex').slice(0, 16) + '.lock');
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  await fs.writeFile(lockFile, '99999');
  const before = await fs.readFile(path.join(dir, 'README.md'));
  const p = ws.writeDoc('README.md', d.md + '\n추가\n', { baseVersion: d.version, summary: '잠금 뒤' });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok((await fs.readFile(path.join(dir, 'README.md'))).equals(before), '잠금을 기다리는 동안 문서는 그대로');
  await fs.rm(lockFile);
  await p;
  const last = (await ws.changes()).at(-1);
  assert.equal(last.summary, '잠금 뒤');
  assert.ok((await fs.readFile(path.join(dir, 'README.md'), 'utf8')).includes('추가'));
});

test('이력: 지운 섹션도 남는다', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  const d = await ws.readDoc('docs/운영-런북.md');
  const next = d.md.replace(/## 장애 대응[\s\S]*$/, '');
  await ws.writeDoc(d.id, next, { baseVersion: d.version });
  const last = (await ws.changes()).at(-1);
  assert.ok(last.removed?.includes('알림 서비스 운영 런북 › 장애 대응'), JSON.stringify(last));
});

test('기록 찾기: 넓은 작업 공간으로 합쳐진 기록은 더 쓰지 않는다 — 찾기만 하면 어디로 갔는지, 만들 때는 새로 (D66)', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dbmerged-')); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const docs = path.join(base, 'work', 'proj'); await fs.mkdir(docs, { recursive: true });
  await fs.writeFile(path.join(docs, 'a.md'), '# a\n');
  const home = path.join(base, 'home'); await fs.mkdir(path.join(home, 'proj'), { recursive: true });
  const pcConfigFile = path.join(base, 'pc', 'config.json'); await fs.mkdir(path.dirname(pcConfigFile), { recursive: true });
  await fs.writeFile(pcConfigFile, JSON.stringify({ dataHome: home }));
  const marker = { protocol: 1, docsName: 'proj', docsPath: docs, createdAt: '', mergedInto: { to: 'work', prefix: 'proj', at: '' } };
  await fs.writeFile(path.join(home, 'proj', 'docbench-data.json'), JSON.stringify(marker));
  await assert.rejects(locateData(docs, { pcConfigFile, create: false }), (e) => e.code === 'DATA_MERGED' && /"work"/.test(e.message));
  const fresh = await locateData(docs, { pcConfigFile, create: true });
  assert.equal(fresh.dir, path.join(home, 'proj (2)'));
  // 이 PC 의 설정에 짝이 적혀 있어도(브라우저가 합침 — 설정은 못 고친다) 합쳐진 기록이면 쓰지 않는다
  await fs.writeFile(pcConfigFile, JSON.stringify({ dataHome: home, workspaces: { [docs]: { data: path.join(home, 'proj') } } }));
  await assert.rejects(locateData(docs, { pcConfigFile, create: false }), (e) => e.code === 'DATA_MERGED');
});
