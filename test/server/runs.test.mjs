/**
 * Claude 작업 (server/runs.mjs) — 가짜 claude(test/fixtures/fake-claude.mjs)로:
 *  - 안전 실행 인자(--restricted --safe-mode dontAsk, 읽기 도구만, 문서 폴더 밖에서 실행)
 *  - 결과 반영: 고침·제안·답·질문·보류, 이력·회신, 로그
 *  - 그 사이 사람이 고친 섹션은 덮지 않고 제안으로, 닫힌 피드백은 건너뜀
 *  - 취소·시간 초과·오류·옛 claude·다른 실행기 요청·잘못된 요청
 *  - CLI 실행기: --detach / --status / --stop, 요청 파일을 받아 처리
 * 실제 Claude Code 로 돌린 결과는 세션 기록(실측)에 남긴다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { startServer, Workspace, createDocBenchHandler } from '../../server/index.mjs';
import { tempWorkspace, rm, until, fakeClaude, pcFileFor, repo, sleep } from './helpers.mjs';

const run = promisify(execFile);
const doc = 'docs/운영-런북.md';
const key = '알림 서비스 운영 런북 › 배포 전 확인';

/** 이 시험 동안만 가짜 claude 동작을 바꾼다 */
function env(t, vars) {
  const old = {};
  for (const [k, v] of Object.entries(vars)) { old[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(old)) { if (v == null) delete process.env[k]; else process.env[k] = v; } });
}

async function boot(t, pc = {}) {
  const dir = await tempWorkspace(null, { assistant: { command: [process.execPath, fakeClaude], timeoutSec: 30, ...pc } });
  const s = await startServer({ root: dir, port: 0, pcConfigFile: pcFileFor(dir) });
  t.after(async () => { await s.close(); await rm(dir); });
  const base = `http://127.0.0.1:${s.port}/api`;
  const api = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { ...(method !== 'GET' ? { 'X-DocBench': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, data: text ? JSON.parse(text) : null };
  };
  const fb = async (o) => (await api('POST', '/feedback', { docId: doc, target: { kind: 'section', path: key.split(' › '), heading: '배포 전 확인' }, body: '롤백 시간 기준을 넣어 줘', waitingOn: 'assistant', ...o })).data;
  const done = async (id, ms = 8000) => until(async () => { const r = (await api('GET', '/runs')).data.items.find((x) => x.id === id); return r && !['queued', 'running'].includes(r.state) ? r : null; }, ms);
  const log = async (id) => (await api('GET', `/runs/${id}/log?from=0`)).data.lines;
  return { dir, s, api, fb, done, log };
}

test('넘기기: 안전 실행 인자 · 고침 반영(이력·회신) · 로그 · 사용량', async (t) => {
  const argsFile = path.join(os.tmpdir(), `docbench-args-${process.pid}-${Date.now()}.jsonl`);
  env(t, { FAKE_CLAUDE_RUN: 'edit', FAKE_CLAUDE_ARGS: argsFile });
  t.after(() => fs.rm(argsFile, { force: true }));
  const { dir, api, fb, done, log } = await boot(t);
  const st = await api('GET', '/runs/status');
  assert.equal(st.data.available, true, JSON.stringify(st.data));
  assert.equal(st.data.runner.kind, 'server');
  assert.equal(st.data.runner.claude.version, '9.9.9');
  assert.ok((await api('GET', '/session')).data.permissions.includes('assistant.run'));
  const f = await fb();
  const before = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data;
  const r = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id], model: 'sonnet', effort: 'high' });
  assert.equal(r.status, 202);
  const end = await done(r.data.id);
  assert.equal(end.state, 'done', end.error);
  assert.deepEqual([end.summary.edited, end.summary.failed], [1, 0]);
  assert.equal(end.usage.limit.utilization, 0.12);

  // 인자: 문서 폴더 밖에서, 설정·훅·CLAUDE.md 를 읽지 않고, 읽기 도구만, 묻지 않고 거부
  const calls = (await fs.readFile(argsFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l)).filter((c) => c.args.includes('-p'));
  const c = calls.at(-1);
  for (const flag of ['--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(c.args.includes(flag), flag);
  const arg = (k) => c.args[c.args.indexOf(k) + 1];
  assert.deepEqual([arg('--permission-mode'), arg('--tools'), arg('--add-dir'), arg('--model'), arg('--effort'), arg('--output-format')], ['dontAsk', 'Read,Grep,Glob', dir, 'sonnet', 'high', 'stream-json']);
  assert.ok(!path.resolve(c.cwd).startsWith(path.resolve(dir)), '문서 폴더 안에서 띄우지 않는다 (그 폴더의 .claude 훅·CLAUDE.md)');

  // 반영: 문서 섹션이 바뀌고, 이력에 Claude·피드백 id, 피드백은 회신과 함께 반영됨
  const after = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data;
  assert.notEqual(after.version, before.version);
  assert.match(after.md, /\(고침\) 한 줄 추가/);
  const ch = (await api('GET', '/changes')).data.items.at(-1);
  assert.deepEqual([ch.by.kind, ch.by.name, ch.feedbackIds, ch.sections], ['assistant', 'Claude', [f.id], [key]]);
  const g = (await api('GET', '/feedback')).data.items.find((x) => x.id === f.id);
  assert.deepEqual([g.status, g.thread.at(-1).author.kind, g.thread.at(-1).text], ['resolved', 'assistant', '한 줄을 덧붙였습니다.']);
  const ks = (await log(r.data.id)).map((l) => l.k);
  for (const k of ['start', 'safe', 'claude', 'text', 'read', 'denied', 'output', 'apply.edit', 'summary', 'done']) assert.ok(ks.includes(k), k + ' in ' + ks.join(','));
  const read = (await log(r.data.id)).find((l) => l.k === 'read');
  assert.equal(read.v.path, doc, '읽은 파일은 문서 폴더 기준 경로로');
});

test('제안(한 건) · 제안만 방식 · 답·질문·보류', async (t) => {
  env(t, { FAKE_CLAUDE_RUN: 'edit' });
  const { api, fb, done, log } = await boot(t);
  const before = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data;
  const f1 = await fb({ waitingOn: 'owner' });
  const p = await api('POST', '/runs', { kind: 'propose', feedbackIds: [f1.id] });
  assert.equal((await done(p.data.id)).summary.proposed, 1);
  const g1 = (await api('GET', '/feedback')).data.items.find((x) => x.id === f1.id);
  assert.deepEqual([g1.proposal.state, g1.waitingOn, g1.proposal.path.join(' › ')], ['pending', 'owner', key]);
  assert.match(g1.proposal.after, /\(제안\) 한 줄 추가/, '제안 작업에는 Claude 가 제안으로 답한다');
  assert.equal((await api('GET', '/doc?id=' + encodeURIComponent(doc))).data.version, before.version, '제안은 문서를 고치지 않는다');

  const f2 = await fb();
  const r2 = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f2.id], mode: 'propose' });
  const e2 = await done(r2.data.id);
  assert.deepEqual([e2.summary.edited, e2.summary.proposed], [0, 1]);
  assert.equal((await api('GET', '/doc?id=' + encodeURIComponent(doc))).data.version, before.version);

  process.env.FAKE_CLAUDE_RUN = 'mixed';
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await fb({ body: '항목 ' + i, ...(i === 4 ? { target: { kind: 'doc' } } : {}) })).id);
  const r3 = await api('POST', '/runs', { kind: 'handoff', feedbackIds: ids });
  const e3 = await done(r3.data.id);
  // mixed: edit, propose(같은 섹션 → 이미 고쳤으면 그대로 제안), answer, ask, decline
  assert.deepEqual([e3.summary.edited, e3.summary.proposed, e3.summary.answered, e3.summary.asked, e3.summary.declined, e3.summary.failed], [1, 1, 1, 1, 1, 0]);
  const rows = (await api('GET', '/feedback')).data.items;
  const st = (id) => { const x = rows.find((y) => y.id === id); return x.status === 'open' ? x.waitingOn : x.status; };
  assert.deepEqual(ids.map(st), ['resolved', 'owner', 'resolved', 'owner', 'declined']);
});

test('그 사이 사람이 같은 섹션을 고치면 덮지 않고 제안으로 · 닫힌 피드백은 건너뜀', async (t) => {
  env(t, { FAKE_CLAUDE_RUN: 'slow', FAKE_CLAUDE_SLOW_MS: '1500' });
  const { api, fb, done, log } = await boot(t);
  const f1 = await fb();
  const f2 = await fb({ body: '두 번째' });
  const r = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f1.id, f2.id] });
  await until(async () => (await api('GET', '/runs')).data.items.find((x) => x.id === r.data.id)?.state === 'running');
  await sleep(300);
  // 사람이 같은 섹션을 고치고, 두 번째 피드백은 닫는다
  const d = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data;
  assert.equal((await api('PUT', '/doc?id=' + encodeURIComponent(doc), { md: d.md.replace('큐 적체 0 확인', '큐 적체 0 확인 (사람이 고침)'), baseVersion: d.version })).status, 200);
  const g2 = (await api('GET', '/feedback')).data.items.find((x) => x.id === f2.id);
  await api('PATCH', '/feedback/' + f2.id, { patch: { status: 'resolved' }, version: g2.version });
  const e = await done(r.data.id, 12000);
  assert.equal(e.state, 'done', e.error);
  assert.deepEqual([e.summary.edited, e.summary.proposed, e.summary.skipped], [0, 1, 1]);
  const now = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data;
  assert.match(now.md, /사람이 고침/, '사람의 글이 남는다');
  assert.doesNotMatch(now.md, /\(고침\) 한 줄 추가/);
  const g1 = (await api('GET', '/feedback')).data.items.find((x) => x.id === f1.id);
  assert.equal(g1.proposal.state, 'pending');
  assert.match(g1.thread.at(-1).text, /그 사이 이 섹션이 바뀌어/);
  assert.ok((await log(r.data.id)).some((l) => l.k === 'skip' && l.v.reason === 'changed'));
});

test('다른 섹션만 바뀌었으면 지금 판에 끼워 고친다', async (t) => {
  env(t, { FAKE_CLAUDE_RUN: 'slow', FAKE_CLAUDE_SLOW_MS: '1200' });
  const { api, fb, done } = await boot(t);
  const f1 = await fb();
  const r = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f1.id] });
  await until(async () => (await api('GET', '/runs')).data.items.find((x) => x.id === r.data.id)?.state === 'running');
  const d = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data;
  await api('PUT', '/doc?id=' + encodeURIComponent(doc), { md: d.md.replace('대시보드에서 채널별 적체를 본다', '대시보드에서 채널별 적체를 본다 (다른 섹션)'), baseVersion: d.version });
  const e = await done(r.data.id, 12000);
  assert.equal(e.summary.edited, 1);
  const now = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data.md;
  assert.match(now, /다른 섹션/);
  assert.match(now, /\(고침\) 한 줄 추가/);
});

test('취소 · 시간 초과 · claude 오류 · 결과 없음', async (t) => {
  env(t, { FAKE_CLAUDE_RUN: 'slow', FAKE_CLAUDE_SLOW_MS: '8000' });
  const { api, fb, done, log } = await boot(t, { timeoutSec: 2 });
  const f = await fb();
  const before = (await api('GET', '/doc?id=' + encodeURIComponent(doc))).data.version;
  const r = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id] });
  await until(async () => (await api('GET', '/runs')).data.items.find((x) => x.id === r.data.id)?.state === 'running');
  assert.equal((await api('POST', `/runs/${r.data.id}/cancel`)).status, 204);
  assert.equal((await done(r.data.id)).state, 'canceled');
  assert.ok((await log(r.data.id)).some((l) => l.k === 'canceled'));
  assert.equal((await api('GET', '/doc?id=' + encodeURIComponent(doc))).data.version, before);

  const r2 = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id] });
  const e2 = await done(r2.data.id, 8000);
  assert.deepEqual([e2.state, /시간 초과/.test(e2.error)], ['failed', true]);

  process.env.FAKE_CLAUDE_RUN = 'error';
  const e3 = await done((await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id] })).data.id);
  assert.deepEqual([e3.state, e3.error], ['failed', '사용량 한도에 닿았습니다']);
  process.env.FAKE_CLAUDE_RUN = 'none';
  const e4 = await done((await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id] })).data.id);
  assert.equal(e4.state, 'failed');
  const g = (await api('GET', '/feedback')).data.items.find((x) => x.id === f.id);
  assert.deepEqual([g.status, g.waitingOn], ['open', 'assistant'], '실패하면 피드백은 그대로 Claude 차례');
});

test('잘못된 요청 · 다른 실행기 앞 요청은 집지 않는다', async (t) => {
  env(t, { FAKE_CLAUDE_RUN: 'edit' });
  const { dir, api, fb } = await boot(t);
  const f = await fb();
  assert.equal((await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id], model: '--dangerously-skip-permissions' })).status, 400);
  assert.equal((await api('POST', '/runs', { kind: 'handoff', feedbackIds: [] })).status, 400);
  assert.equal((await api('GET', '/runs/../x/log')).status, 404);
  const id = 'run-20261008-120000-zzzz';
  await fs.writeFile(path.join(dir, '.docbench/runs', id + '.req.json'), JSON.stringify({ id, at: new Date().toISOString(), runner: 'runner:someone@other-pc', kind: 'handoff', feedbackIds: [f.id] }));
  await sleep(2500);
  const it = (await api('GET', '/runs')).data.items.find((x) => x.id === id);
  assert.equal(it.state, 'queued', '남의 실행기 앞 요청은 그대로');
  await assert.rejects(fs.stat(path.join(dir, '.docbench/runs', id + '.json')));
});

test('안전 플래그가 없는 옛 Claude Code 는 실행하지 않는다', async (t) => {
  env(t, { FAKE_CLAUDE_OLD: '1' });
  const { api, fb } = await boot(t, { command: [process.execPath, fakeClaude, '--old'] });
  const st = (await api('GET', '/runs/status')).data;
  assert.deepEqual([st.available, st.reason], [false, 'old-claude']);
  assert.match(st.message, /--restricted/);
  const f = await fb();
  assert.equal((await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id] })).status, 503);
});

test('기존 제안 길(POST /assistant/propose)도 문서 폴더 밖에서 --restricted --safe-mode 로', async (t) => {
  const argsFile = path.join(os.tmpdir(), `docbench-args2-${process.pid}-${Date.now()}.jsonl`);
  env(t, { FAKE_CLAUDE_ARGS: argsFile, FAKE_CLAUDE_OLD: null });
  t.after(() => fs.rm(argsFile, { force: true }));
  const { dir, api, fb } = await boot(t, { command: [process.execPath, fakeClaude, '--propose-path'] });
  const f = await fb();
  const r = await api('POST', '/assistant/propose', { feedbackId: f.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const c = (await fs.readFile(argsFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.args.includes('-p')).at(-1);
  assert.ok(c.args.includes('--restricted') && c.args.includes('--safe-mode'));
  assert.ok(!path.resolve(c.cwd).startsWith(path.resolve(dir)));
});

test('CLI 실행기: --detach 로 켜고, 요청 파일을 받아 처리하고, --stop 으로 끈다', async (t) => {
  const dir = await tempWorkspace();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'docbench-runner-home-'));
  t.after(async () => { await run(process.execPath, [path.join(repo, 'bin/docbench.mjs'), 'runner', '--stop', dir], { env: { ...process.env, DOCBENCH_HOME: home } }).catch(() => undefined); await rm(dir); await fs.rm(home, { recursive: true, force: true }); });
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ assistant: { command: [process.execPath, fakeClaude] } }));
  const cli = (...a) => run(process.execPath, [path.join(repo, 'bin/docbench.mjs'), ...a], { env: { ...process.env, DOCBENCH_HOME: home, FAKE_CLAUDE_RUN: 'edit' } });
  const f = JSON.parse((await cli('--root', dir, 'fb', 'add', '--doc', doc, '--section', key, '-m', '롤백 기준', '--to', 'assistant', '--json')).stdout);
  // 재부팅 전에 남은 이 PC 의 기록 — 그 pid 를 지금은 다른 프로그램이 쓴다. "이미 켜짐"으로 막히거나 그 프로그램을 끝내면 안 된다
  const victim = (await import('node:child_process')).spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  t.after(() => { try { victim.kill(); } catch { /* 끝남 */ } });
  const { localEngineFile, engineId } = await import('../../server/runs.mjs');
  const fakeWs = { pcConfigFile: path.join(home, 'config.json'), config: {} };
  await fs.mkdir(path.join(home, 'engines'), { recursive: true });
  await fs.writeFile(localEngineFile(fakeWs, dir, 'runner'), JSON.stringify({ pid: victim.pid, id: engineId(fakeWs, 'runner'), kind: 'runner', root: dir, startedAt: '2001-01-01T00:00:00.000Z' }));
  const up = await cli('runner', dir, '--detach');
  assert.match(up.stdout, /실행기를 켰습니다/);
  const status = JSON.parse((await cli('runner', '--status', dir, '--json')).stdout);
  assert.equal(status.length, 1);
  const r = status[0];
  assert.deepEqual([r.kind, r.claude.ok, r.claude.version], ['runner', true, '9.9.9']);
  // 화면이 하는 것처럼 요청 파일을 남긴다
  const id = 'run-20261008-130000-cli1';
  await fs.writeFile(path.join(dir, '.docbench/runs', id + '.req.json'), JSON.stringify({ id, at: new Date().toISOString(), runner: r.id, kind: 'handoff', feedbackIds: [f.id], model: 'haiku' }));
  const end = await until(async () => { const s = JSON.parse(await fs.readFile(path.join(dir, '.docbench/runs', id + '.json'), 'utf8').catch(() => 'null')); return s && s.state === 'done' ? s : null; }, 15000);
  assert.equal(end.summary.edited, 1);
  const shown = JSON.parse((await cli('--root', dir, 'fb', 'show', f.id, '--json')).stdout);
  assert.equal(shown.feedback.status, 'resolved');
  const again = await cli('runner', dir, '--detach');
  assert.match(again.stdout, /이미 켜져 있습니다/);
  // status 는 맡겨 둔 작업의 피드백을 보여 준다(터미널 Claude 가 같은 피드백을 동시에 잡지 않게) — 꺼진 엔진 앞 요청은 빼고
  const busy = 'run-20261008-130500-act1', stale = 'run-20261008-130600-old1';
  await fs.writeFile(path.join(dir, '.docbench/runs', busy + '.json'), JSON.stringify({ id: busy, at: new Date().toISOString(), runner: r.id, kind: 'handoff', feedbackIds: [f.id], state: 'running' }));
  await fs.writeFile(path.join(dir, '.docbench/runs', busy + '.req.json'), JSON.stringify({ id: busy, at: new Date().toISOString(), runner: r.id, kind: 'handoff', feedbackIds: [f.id] }));
  await fs.writeFile(path.join(dir, '.docbench/runs', stale + '.req.json'), JSON.stringify({ id: stale, at: new Date().toISOString(), runner: 'runner:someone@gone-pc', kind: 'handoff', feedbackIds: [f.id] }));
  const st = JSON.parse((await cli('--root', dir, 'status', '--json')).stdout);
  assert.deepEqual(st.activeRuns, [{ id: busy, state: 'running', feedbackIds: [f.id] }]);
  assert.match((await cli('--root', dir, 'status')).stdout, new RegExp(`실행 중 ${busy}: 피드백 ${f.id}`));
  // fb list --status 는 값을 받는다 (runner --status 와 같은 이름)
  assert.ok(JSON.parse((await cli('--root', dir, 'fb', 'list', '--status', 'all', '--json')).stdout).length >= 1);
  // 꾸민 심장 박동: 이 PC 이름·남의 pid 를 적어 둬도 --stop 은 그 프로세스를 끝내지 않는다 (이 PC 가 적어 둔 pid 만)
  const forge = (name, o) => fs.writeFile(path.join(dir, '.docbench/runners', name), JSON.stringify({ ...r, ...o, pid: victim.pid }));
  await forge('runner_evil.json', { id: 'runner:evil@' + r.host, seenAt: new Date().toISOString() });
  await forge('runner_future.json', { seenAt: '2999-01-01T00:00:00.000Z' });
  const down = await cli('runner', '--stop', dir);
  assert.match(down.stdout, /껐습니다/);
  assert.equal(victim.exitCode, null, '남의 프로세스는 그대로');
  assert.doesNotThrow(() => process.kill(victim.pid, 0));
  // 남은 끄기 요청 파일이 없다 — 다음 실행기가 켜자마자 꺼지지 않게
  assert.ok(!(await fs.readdir(path.join(dir, '.docbench/runners'))).some((n) => n.endsWith('.stop')));
  const left = JSON.parse((await cli('runner', '--status', dir, '--json').catch((e) => e)).stdout);
  assert.ok(!left.some((x) => x.id === r.id), '내 실행기는 꺼졌다 (꾸민 남의 심장 박동만 남음)');
  // 로그는 이 PC 의 설정 폴더에
  assert.ok((await fs.readdir(path.join(home, 'logs'))).some((n) => n.startsWith('runner-')));
});

// ---------------------------------------------------------------- 독립 검토에서 나온 것 (D53~D56)
const myServerId = () => `server:${os.userInfo().username}@${os.hostname()}`;

test('꾸민 상태 파일: 안의 id 로 폴더 밖에 쓰지 않는다 (복구는 파일 이름의 id 로)', async (t) => {
  const dir = await tempWorkspace(null, { assistant: { command: [process.execPath, fakeClaude] } });
  const tag = 'escape-' + process.pid + '-' + Date.now();
  const target = path.join(path.dirname(dir), tag + '.json');
  t.after(async () => { await fs.rm(target, { force: true }); });
  const id = 'run-20261008-120000-evil';
  await fs.mkdir(path.join(dir, '.docbench/runs'), { recursive: true });
  await fs.writeFile(path.join(dir, '.docbench/runs', id + '.json'), JSON.stringify({ id: '../../' + tag, runner: myServerId(), state: 'running', assistant: { command: ['cmd.exe', '/c', 'calc'] } }));
  const s = await startServer({ root: dir, port: 0, pcConfigFile: pcFileFor(dir) });
  t.after(async () => { await s.close(); await rm(dir); });
  await fetch(`http://127.0.0.1:${s.port}/api/runs/status`); // 엔진이 켜지고(복구까지) 답한다
  await assert.rejects(fs.stat(target), '폴더 밖에 아무것도 쓰지 않는다');
  const st = JSON.parse(await fs.readFile(path.join(dir, '.docbench/runs', id + '.json'), 'utf8'));
  assert.deepEqual([st.id, st.state, 'assistant' in st], [id, 'failed', false]);
  const listed = (await (await fetch(`http://127.0.0.1:${s.port}/api/runs`)).json()).items.find((x) => x.id === id);
  assert.equal(listed.id, id);
});

test('읽다 실패한 요청(동기화 중)은 다시 읽어 처리한다 · 엔진이 꺼지면 하던 작업은 취소됨', async (t) => {
  env(t, { FAKE_CLAUDE_RUN: 'edit' });
  const { dir, s, api, fb, done } = await boot(t);
  const f = await fb();
  const id = 'run-20261008-121000-late';
  const file = path.join(dir, '.docbench/runs', id + '.req.json');
  await fs.writeFile(file, '{"id": "' + id + '", "runner": ');
  await sleep(3500); // 두 번 넘게 훑는 동안 깨진 채
  await fs.writeFile(file, JSON.stringify({ id, at: new Date().toISOString(), runner: myServerId(), kind: 'handoff', feedbackIds: [f.id] }));
  assert.equal((await done(id, 10000)).state, 'done');

  process.env.FAKE_CLAUDE_RUN = 'slow';
  process.env.FAKE_CLAUDE_SLOW_MS = '8000';
  const f2 = await fb();
  const r = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f2.id] });
  await until(async () => (await api('GET', '/runs')).data.items.find((x) => x.id === r.data.id)?.state === 'running');
  await s.close();
  const st = JSON.parse(await fs.readFile(path.join(dir, '.docbench/runs', r.data.id + '.json'), 'utf8'));
  assert.equal(st.state, 'canceled');
});

test('상태 쓰기는 작업마다 차례대로 — 꺼질 때 적은 상태(취소됨)를 늦게 끝난 진행 쓰기가 덮지 않는다', async (t) => {
  // CI(Linux)에서 재현: 진행 표시 쓰기가 끝나기 전에 엔진이 꺼지며 "취소됨"을 적으면, 먼저 시작한 쓰기가 나중에 끝나 "실행 중"으로 되돌렸다
  const dir = await tempWorkspace();
  t.after(() => rm(dir));
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  const { RunEngine } = await import('../../server/runs.mjs');
  const e = new RunEngine(ws, { kind: 'server' });
  await fs.mkdir(e.dir, { recursive: true });
  const id = 'run-20261008-220000-seal';
  const read = async () => JSON.parse(await fs.readFile(path.join(e.dir, id + '.json'), 'utf8')).state;
  const a = e.writeStatus({ id, state: 'running', progress: { phase: 'claude' } });
  const b = e.writeStatus({ id, state: 'canceled' }, { seal: true });
  const c = e.writeStatus({ id, state: 'running', progress: { phase: 'claude' } });
  await Promise.all([a, b, c]);
  assert.equal(await read(), 'canceled');
  await e.writeStatus({ id, state: 'done' });
  assert.equal(await read(), 'canceled', '봉한 뒤의 쓰기는 버린다');
});

test('대시보드에 끼우는 처리기는 Claude 작업 기본 끔 (runs: true 로 켬), 사람은 대시보드가 정한다', async (t) => {
  const dir = await tempWorkspace(null, { assistant: { command: [process.execPath, fakeClaude] } });
  const ws = await new Workspace(dir, { pcConfigFile: pcFileFor(dir) }).init();
  const handler = createDocBenchHandler(ws, { base: '/docbench/api', ui: false });
  const server = http.createServer((req, res) => { if (!handler(req, res)) res.writeHead(404).end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  t.after(async () => { await handler.close(); await new Promise((r) => { server.close(() => r(undefined)); server.closeAllConnections?.(); }); await rm(dir); });
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/docbench/api`;
  const sess = await (await fetch(base + '/session')).json();
  assert.equal(sess.features.runs, false);
  assert.ok(!sess.permissions.includes('assistant.run'));
  assert.equal((await fetch(base + '/runs/status')).status, 404);
  // 사람도 대시보드가 정한다 — 웹에서 이 PC 의 설정(표시 이름)을 고치지 않는다
  assert.equal(sess.identity, 'host');
  assert.equal((await fetch(base + '/me', { method: 'PUT', headers: { 'X-DocBench': '1', 'Content-Type': 'application/json' }, body: '{"name":"x"}' })).status, 403);
  await assert.rejects(fs.stat(path.join(dir, '.docbench/runners')).then((st) => { if (st.isDirectory()) return fs.readdir(path.join(dir, '.docbench/runners')).then((n) => { if (!n.length) throw new Error('empty'); }); }));
});

test('기록을 문서 폴더 밖에 두면(기본) Claude 작업도 그 기록으로 — 문서 폴더에는 문서 말고 아무것도 생기지 않는다', async (t) => {
  env(t, { FAKE_CLAUDE_RUN: 'edit' });
  const dir = await tempWorkspace(null, { assistant: { command: [process.execPath, fakeClaude], timeoutSec: 30 } });
  await fs.rm(path.join(dir, '.docbench'), { recursive: true });
  const listAll = async (d, pre = '') => (await Promise.all((await fs.readdir(d, { withFileTypes: true })).map((e) => (e.isDirectory() ? listAll(path.join(d, e.name), pre + e.name + '/') : [pre + e.name])))).flat().sort();
  const before = await listAll(dir);
  const s = await startServer({ root: dir, port: 0, pcConfigFile: pcFileFor(dir) });
  t.after(async () => { await s.close(); await fs.rm(s.ws.dir, { recursive: true, force: true }); await rm(dir); });
  assert.equal(s.ws.dataMode, 'outside');
  assert.ok(!s.ws.dir.startsWith(dir + path.sep));
  const base = `http://127.0.0.1:${s.port}/api`;
  const api = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { ...(method !== 'GET' ? { 'X-DocBench': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); const tx = await r.text(); return { status: r.status, data: tx ? JSON.parse(tx) : null }; };
  assert.equal((await api('GET', '/session')).data.workspace.data.mode, 'outside');
  const f = (await api('POST', '/feedback', { docId: doc, target: { kind: 'section', path: key.split(' › '), heading: '배포 전 확인' }, body: '롤백 기준', waitingOn: 'assistant' })).data;
  const r = await api('POST', '/runs', { kind: 'handoff', feedbackIds: [f.id] });
  const end = await until(async () => { const x = (await api('GET', '/runs')).data.items.find((y) => y.id === r.data.id); return x && x.state === 'done' ? x : null; }, 8000);
  assert.equal(end.summary.edited, 1);
  assert.ok(existsSync(path.join(s.ws.dir, 'runs', r.data.id + '.json')), '작업 파일은 기록 폴더에');
  assert.deepEqual(await listAll(dir), before, '문서 폴더의 파일 목록은 그대로(문서 내용만 바뀜)');
});
