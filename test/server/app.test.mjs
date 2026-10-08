/**
 * DocBench 앱 (server/app.mjs, D67·D68) — 이 PC 에 하나 도는 서비스.
 *  - 열쇠·Host·CSRF·끼우기 허용 출처, 쿠키를 쓰지 않는다(포트를 가리지 않아 다른 로컬 서버로 새므로)
 *  - 작업 공간 더하기·안쪽 폴더는 범위로·품는 폴더는 기록 합치기·빼기, 폴더 둘러보기(이름만)
 *  - CLI link 로 이은 폴더를 몇 초 안에 맡고, 엔진이 kind 'app'·짝 계정(owners)으로 심장 박동
 *  - CLI: app --detach / --status / --stop
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startApp, workspaceId } from '../../server/app.mjs';
import { repo, tempWorkspace, rm, until } from './helpers.mjs';

const run = promisify(execFile);
const cli = path.join(repo, 'bin/docbench.mjs');

async function boot(t, o = {}) {
  const pcHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dbapp-pc-'));
  t.after(() => fs.rm(pcHome, { recursive: true, force: true }));
  const pcConfigFile = path.join(pcHome, 'config.json');
  if (o.pc) await fs.writeFile(pcConfigFile, JSON.stringify(o.pc));
  const app = await startApp({ port: 0, pcConfigFile, allowOrigins: o.allowOrigins });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { Authorization: 'Bearer ' + app.token, ...(method !== 'GET' ? { 'X-DocBench': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  return { app, base, call, pcConfigFile, pcHome };
}

test('앱: 열쇠·Host·CSRF — 화면 껍데기만 열쇠 없이, 쿠키는 쓰지 않는다', async (t) => {
  const { app, base, call } = await boot(t, { allowOrigins: ['http://localhost:5199'] });
  // 화면 껍데기: 비밀 없음, 끼울 수 없음
  const shell = await fetch(base + '/?t=' + app.token);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('set-cookie'), null, '쿠키를 남기지 않는다');
  assert.match(shell.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await shell.text();
  assert.ok(!html.includes(app.token), '껍데기에 열쇠를 싣지 않는다');
  assert.match(html, /name="docbench-mode" content="app"/);
  // API 는 열쇠가 있어야
  assert.equal((await fetch(base + '/api/app/info')).status, 401);
  assert.equal((await call('GET', '/api/app/info', null, { Authorization: 'Bearer ' + 'f'.repeat(48) })).status, 401);
  const info = await call('GET', '/api/app/info');
  assert.equal(info.status, 200);
  assert.ok(info.data.version);
  assert.deepEqual(info.data.workspaces, []);
  assert.deepEqual(info.data.allowOrigins, ['http://localhost:5199']);
  // Host 헤더(DNS rebinding) — fetch 는 Host 를 바꾸지 못해 http.request 로
  const rebound = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: app.port, path: '/api/app/info', headers: { Host: 'evil.example:' + app.port, Authorization: 'Bearer ' + app.token } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(rebound, 403);
  // 바꾸는 요청은 X-DocBench 헤더
  const r = await fetch(base + '/api/app/me', { method: 'PUT', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(r.status, 403);
  // 다리 스크립트는 열쇠 없이(대시보드가 싣는다)
  const host = await fetch(base + '/host.js');
  assert.equal(host.status, 200);
  assert.match(await host.text(), /DocBenchHost/);
  // 끼움: 열쇠가 있어야, 허용한 출처만 끼울 수 있다
  assert.equal((await fetch(base + '/embed?root=x')).status, 401);
  const emb = await fetch(base + '/embed?root=x&t=' + app.token);
  assert.equal(emb.status, 200);
  assert.match(emb.headers.get('content-security-policy'), /frame-ancestors 'self' http:\/\/localhost:5199/);
  assert.match(await emb.text(), /name="docbench-hosts" content="http:\/\/localhost:5199"/);
  // 표시 이름 — 이 PC 의 설정에
  const me = await call('PUT', '/api/app/me', { name: '디제이' });
  assert.equal(me.data.name, '디제이');
});

test('앱: 작업 공간 더하기 — 기록은 문서 폴더 밖, 안쪽 폴더는 범위로, 품는 폴더는 기록을 합친다, 빼기', async (t) => {
  const { call, pcConfigFile } = await boot(t);
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dbapp-ws-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const proj = path.join(parent, 'proj');
  await fs.mkdir(path.join(proj, 'docs'), { recursive: true });
  await fs.writeFile(path.join(proj, 'README.md'), '# 프로젝트\n\n## 목표\n\n본문\n');
  await fs.writeFile(path.join(proj, 'docs/설계.md'), '# 설계\n');
  await fs.writeFile(path.join(parent, '개요.md'), '# 개요\n');

  assert.equal((await call('POST', '/api/app/workspaces', { path: 'relative/path' })).status, 400);
  const a = await call('POST', '/api/app/workspaces', { path: proj });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.id, workspaceId(proj));
  assert.deepEqual(await fs.readdir(proj).then((l) => l.sort()), ['README.md', 'docs'], '문서 폴더에는 문서만');
  const pc = JSON.parse(await fs.readFile(pcConfigFile, 'utf8'));
  assert.ok(Object.values(pc.workspaces).some((w) => w.added), '이 PC 의 설정에 더한 표시');
  // 작업 공간 API — 매니페스트·나무·피드백
  const w = `/api/w/${a.data.id}`;
  const m = await call('GET', w + '/manifest');
  assert.equal(m.status, 200);
  assert.ok(m.data.docs['README.md']);
  const tree = await call('GET', w + '/tree?dir=docs');
  assert.deepEqual(tree.data.items.map((x) => [x.name, x.kind, !!x.doc]), [['설계.md', 'file', true]]);
  assert.equal((await call('GET', w + '/tree?dir=' + encodeURIComponent('../..'))).status, 404, '작업 공간 밖은 없는 것으로');
  const fb = await call('POST', w + '/feedback', { docId: 'docs/설계.md', target: { kind: 'doc' }, body: '하위 폴더에서 단 피드백' });
  assert.equal(fb.status, 201, JSON.stringify(fb.data));

  // 더한 작업 공간 안의 폴더 → 새로 만들지 않고 그 작업 공간 + 범위
  const inner = await call('POST', '/api/app/workspaces', { path: path.join(proj, 'docs') });
  assert.deepEqual([inner.data.id, inner.data.scope, inner.data.existing], [a.data.id, 'docs', true]);

  // 더한 작업 공간을 품는 폴더 → 먼저 묻고(needsMerge), merge 면 기록을 넓은 쪽으로
  const outer = await call('POST', '/api/app/workspaces', { path: parent });
  assert.deepEqual(outer.data.needsMerge.map((x) => x.rel), ['proj']);
  const merged = await call('POST', '/api/app/workspaces', { path: parent, merge: true });
  assert.equal(merged.status, 200, JSON.stringify(merged.data));
  assert.equal(merged.data.merged, 1);
  const list = (await call('GET', `/api/w/${merged.data.id}/feedback`)).data;
  const rows = Array.isArray(list) ? list : list.items;
  assert.deepEqual(rows.map((f) => f.docId), ['proj/docs/설계.md'], '경로를 넓은 폴더 기준으로');
  const info = (await call('GET', '/api/app/info')).data;
  assert.deepEqual(info.workspaces.map((x) => x.root), [parent], '합친 쪽은 목록에서 빠진다');
  assert.equal((await call('GET', w + '/manifest')).status, 404);

  // 빼기 — 기록은 남는다(지우지 않는다)
  assert.equal((await call('DELETE', `/api/app/workspaces/${merged.data.id}`)).status, 204);
  assert.deepEqual((await call('GET', '/api/app/info')).data.workspaces, []);
  assert.equal((await call('DELETE', `/api/app/workspaces/${merged.data.id}`)).status, 404);
});

test('앱: 폴더 둘러보기는 폴더 이름만 — 파일 내용·파일 이름은 주지 않는다, 큰 폴더 표시', async (t) => {
  const { call } = await boot(t);
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dbapp-br-'));
  t.after(() => fs.rm(d, { recursive: true, force: true }));
  await fs.mkdir(path.join(d, 'Windows')); await fs.mkdir(path.join(d, 'Program Files')); await fs.mkdir(path.join(d, 'node_modules'));
  await fs.writeFile(path.join(d, '비밀.md'), '# 비밀\n');
  const start = (await call('GET', '/api/app/browse')).data;
  assert.ok(start.dirs.some((x) => x.kind === 'home'));
  const b = (await call('GET', '/api/app/browse?path=' + encodeURIComponent(d))).data;
  assert.deepEqual(b.dirs.map((x) => x.name), ['Program Files', 'Windows'], '의존성 폴더는 빼고, 파일은 이름도 주지 않는다');
  assert.equal(b.docs, 1);
  assert.equal(b.big, true, '드라이브처럼 보이면 알린다');
  assert.ok(!JSON.stringify(b).includes('비밀'));
  assert.equal((await call('GET', '/api/app/browse?path=rel')).status, 400);
});

test('앱: CLI link 로 이은 폴더(기록은 밖)를 몇 초 안에 맡고, 엔진은 kind app·짝 계정으로 심장 박동', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  await fs.rm(path.join(dir, '.docbench'), { recursive: true, force: true });
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dbapp-home-')); t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.writeFile(path.join(home, 'docbench-home.json'), '{"protocol":1}');
  const data = path.join(home, path.basename(dir));
  await fs.mkdir(path.join(data, 'feedback'), { recursive: true });
  await fs.writeFile(path.join(data, 'docbench-data.json'), JSON.stringify({ protocol: 1, docsName: path.basename(dir), createdAt: '' }));
  const { app, call, pcHome } = await boot(t);
  const env = { ...process.env, DOCBENCH_HOME: pcHome, DOCBENCH_ACTOR: '' };
  // 계정 모양이 아니면 거부(문구에 끼어들지 못하게)
  await assert.rejects(run(process.execPath, [cli, 'link', dir, '--data', data, '--owner', 'u-1 && rm -rf ~'], { env }), (e) => /계정 id/.test(e.stderr));
  const l = JSON.parse((await run(process.execPath, [cli, 'link', dir, '--data', data, '--owner', 'u-0a1b2c3d4e', '--json'], { env })).stdout);
  assert.equal(l.owner, 'u-0a1b2c3d4e');
  await app.sync();
  const ws = (await call('GET', '/api/app/info')).data.workspaces;
  assert.deepEqual(ws.map((w) => [w.root, w.linked, w.added]), [[path.resolve(dir), true, false]]);
  const beatDir = path.join(data, 'runners');
  const beat = await until(async () => {
    for (const f of await fs.readdir(beatDir).catch(() => [])) {
      const b = JSON.parse(await fs.readFile(path.join(beatDir, f), 'utf8').catch(() => 'null'));
      if (b?.kind === 'app' && b.owners?.includes('u-0a1b2c3d4e')) return b;
    }
    return null;
  }, 20000, 200);
  assert.equal(beat.pid, process.pid);
  assert.deepEqual(await fs.readdir(dir).then((x) => x.includes('.docbench')), false, '문서 폴더에는 아무것도 생기지 않는다');
});

test('CLI: app --detach · --status · --stop (이 PC 에 하나)', async (t) => {
  const pcHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dbapp-cli-'));
  t.after(() => fs.rm(pcHome, { recursive: true, force: true }));
  const env = { ...process.env, DOCBENCH_HOME: pcHome, DOCBENCH_ACTOR: '' };
  const db = (...args) => run(process.execPath, [cli, ...args], { env, timeout: 40000 });
  await assert.rejects(db('app', '--status', '--json'), (e) => e.code === 1 && JSON.parse(e.stdout).running === false);
  const up = JSON.parse((await db('app', '--detach', '--port', '0', '--json')).stdout);
  t.after(() => { try { process.kill(up.pid); } catch { /* 이미 끝남 */ } });
  assert.equal(up.running, true);
  assert.match(up.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const again = JSON.parse((await db('app', '--detach', '--json')).stdout);
  assert.equal(again.pid, up.pid, '이미 켜져 있으면 그대로');
  const st = JSON.parse((await db('app', '--status', '--json')).stdout);
  assert.deepEqual([st.running, st.pid], [true, up.pid]);
  const token = (await fs.readFile(path.join(pcHome, 'app-token'), 'utf8')).trim();
  assert.equal((await fetch(up.url + 'api/app/info', { headers: { Authorization: 'Bearer ' + token } })).status, 200);
  assert.equal((await fetch(up.url + 'api/app/info')).status, 401);
  JSON.parse((await db('app', '--stop', '--json')).stdout);
  await until(async () => { try { process.kill(up.pid, 0); return false; } catch { return true; } }, 10000, 200);
  await assert.rejects(fs.stat(path.join(pcHome, 'app.json')), '꺼지면 기록 파일을 지운다');
});

test('앱: 팀 기록(.docbench)을 쓰는 안쪽 작업 공간은 합치지 않고 따로, 짝 계정은 넓은 쪽으로 옮긴다, 오류 코드', async (t) => {
  const { call, pcConfigFile } = await boot(t);
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dbapp-keep-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  for (const n of ['team', 'mine']) { await fs.mkdir(path.join(parent, n)); await fs.writeFile(path.join(parent, n, 'README.md'), `# ${n}\n`); }
  await fs.mkdir(path.join(parent, 'team', '.docbench'));
  const team = (await call('POST', '/api/app/workspaces', { path: path.join(parent, 'team') })).data;
  const mine = (await call('POST', '/api/app/workspaces', { path: path.join(parent, 'mine') })).data;
  // 단일 HTML 의 계정이 mine 에 짝지어져 있다
  const pc = JSON.parse(await fs.readFile(pcConfigFile, 'utf8'));
  const key = Object.keys(pc.workspaces).find((k) => k.endsWith('mine'));
  pc.workspaces[key].owners = ['u-0a1b2c3d4e'];
  await fs.writeFile(pcConfigFile, JSON.stringify(pc));
  const ask = await call('POST', '/api/app/workspaces', { path: parent });
  assert.deepEqual(ask.data.needsMerge.map((x) => x.rel), ['mine']);
  assert.deepEqual(ask.data.kept.map((x) => x.rel), ['team']);
  const r = await call('POST', '/api/app/workspaces', { path: parent, merge: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.kept.map((x) => x.rel), ['team']);
  const ids = (await call('GET', '/api/app/info')).data.workspaces.map((w) => w.id).sort();
  assert.deepEqual(ids, [r.data.id, team.id].sort(), '팀 기록 쪽은 그대로, 합친 쪽은 빠진다');
  assert.ok(!ids.includes(mine.id));
  const after = JSON.parse(await fs.readFile(pcConfigFile, 'utf8'));
  const outerKey = Object.keys(after.workspaces).find((k) => path.resolve(k) === path.resolve(parent));
  assert.deepEqual(after.workspaces[outerKey].owners, ['u-0a1b2c3d4e'], '짝 계정을 넓은 쪽으로');
  assert.equal(after.workspaces[key]?.owners, undefined);
  // 오류: 없는 폴더 404, 1 MB 넘는 본문 413(연결을 끊지 않고 답한다)
  const nf = await call('POST', '/api/app/workspaces', { path: path.join(parent, 'nope') });
  assert.deepEqual([nf.status, nf.data.error], [404, 'NOT_FOUND']);
  const big = await call('POST', '/api/app/workspaces', { path: 'x'.repeat(1100 * 1024) });
  assert.deepEqual([big.status, big.data.error], [413, 'TOO_LARGE']);
  // 작업 공간 화면의 "나" — 앱은 이 PC 사람 한 명의 도구라 이름을 바꿀 수 있고, 켜 둔 다른 작업 공간도 따른다
  const me = await call('PUT', `/api/w/${team.id}/me`, { name: '디제이' });
  assert.deepEqual([me.status, me.data.name], [200, '디제이']);
});
