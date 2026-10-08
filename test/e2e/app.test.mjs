/**
 * DocBench 앱(server/app.mjs)의 화면 — 실제 Chromium 에서.
 *  - 열쇠 없이 열면 여는 방법을 알려 주고, 처음 연 주소(?t=)의 열쇠는 이 출처에 기억하고 주소에서 지운다(쿠키 없음)
 *  - 더한 작업 공간을 열고, 밖에서 생긴 피드백이 실시간으로(SSE, 열쇠는 주소의 token)
 *  - 대시보드 탭: host.js 로 끼우면 테마·이동·할 일 수·넘기기가 postMessage 로 오간다(허용한 출처만)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { startApp } from '../../server/app.mjs';
import { tempWorkspace, rm, until } from '../server/helpers.mjs';

let browser, app, base, hostSrv, hostOrigin, pcHome, dir;
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + app.token, ...(method !== 'GET' ? { 'X-DocBench': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
};

before(async () => {
  // 대시보드 흉내 — 다른 출처(포트)에서 host.js 로 끼운다
  hostSrv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/') return res.writeHead(404).end();
    const root = u.searchParams.get('root');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>대시보드</title>
<style>html,body{margin:0;height:100%} #tab{height:100vh}</style><div id="tab"></div>
<script src="${base}/host.js"></script>
<script>
  window.__events = []; window.__todo = null; window.__handoff = null;
  window.bench = DocBenchHost.mount(document.getElementById('tab'), {
    root: ${JSON.stringify(root)}, key: ${JSON.stringify(app.token)}, theme: 'dark', lang: 'ko',
    onTodo: (c) => { window.__todo = c; },
    onEvent: (ev) => window.__events.push(ev),
    onHandoff: async (req) => { window.__handoff = req; return { handled: true, message: '대시보드 터미널로 보냈습니다' }; },
  });
</script>`);
  });
  await new Promise((r) => hostSrv.listen(0, '127.0.0.1', r));
  hostOrigin = `http://127.0.0.1:${hostSrv.address().port}`;
  pcHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dbapp-e2e-'));
  app = await startApp({ port: 0, pcConfigFile: path.join(pcHome, 'config.json'), allowOrigins: [hostOrigin] });
  base = `http://127.0.0.1:${app.port}`;
  browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  dir = await tempWorkspace();
  await fs.rm(path.join(dir, '.docbench'), { recursive: true, force: true });
});
after(async () => { await browser?.close(); await app?.close(); hostSrv?.close(); if (dir) await rm(dir); if (pcHome) await fs.rm(pcHome, { recursive: true, force: true }); });

async function newPage(t) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) errors.push(m.text()); });
  t.after(() => ctx.close());
  return { page, errors };
}

test('앱 화면: 열쇠 없이는 여는 방법 → 처음 연 주소의 열쇠를 기억(주소에서 지움) → 작업 공간·실시간 피드백', async (t) => {
  const { page, errors } = await newPage(t);
  await page.goto(base + '/?lang=ko');
  await page.locator('.db-locked h1', { hasText: 'DocBench 앱 열기' }).waitFor();
  assert.match(await page.locator('.db-locked pre').innerText(), /app --open/);

  await page.goto(app.openUrl + '&lang=ko');
  await page.waitForSelector('.db-sec');
  assert.ok(!page.url().includes(app.token), '주소에서 열쇠를 지운다');
  assert.equal(await page.evaluate(() => localStorage.getItem('docbench:app:key')), app.token);
  assert.deepEqual((await page.context().cookies()).map((c) => c.name), [], '쿠키 없음');
  await page.locator('.db-toast', { hasText: '아직 작업 공간이 없습니다' }).waitFor();

  // 폴더를 더하고(대시보드·CLI 와 같은 API) 다시 열면 그 작업 공간 — 열쇠는 기억한 것으로
  const added = await call('POST', '/api/app/workspaces', { path: dir });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  await page.goto(base + '/?lang=ko');
  await page.locator('.db-ws', { hasText: path.basename(dir) }).waitFor();
  await page.waitForSelector('.db-sec');
  // 밖(터미널의 Claude·동료)에서 생긴 피드백이 실시간으로
  const docId = await page.evaluate(() => decodeURIComponent(location.hash.slice(1)));
  const fb = await call('POST', `/api/w/${added.data.id}/feedback`, { docId, target: { kind: 'doc' }, body: '밖에서 단 피드백' });
  assert.equal(fb.status, 201);
  await page.locator(`.db-card[data-id="${fb.data.id}"]`).waitFor({ timeout: 8000 });
  // 메뉴: 폴더 추가 · 목록에서 빼기 · 시작하기
  await page.locator('.db-ws').click();
  const items = await page.locator('.db-menu .db-menu-i .l').allInnerTexts();
  assert.deepEqual(items, ['폴더 추가…', '목록에서 빼기', '시작하기 보기']);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});

test('대시보드 탭: host.js 로 끼우면 어두운 테마·할 일 수·이동·넘기기가 오간다, 허용 안 한 출처는 못 끼운다', async (t) => {
  const { page, errors } = await newPage(t);
  // Claude 차례 피드백 하나
  const id = (await call('POST', '/api/app/workspaces', { path: dir })).data.id;
  const f = (await call('POST', `/api/w/${id}/feedback`, { docId: 'README.md', target: { kind: 'doc' }, body: '요약을 더해 줘', waitingOn: 'assistant' })).data;
  await page.goto(`${hostOrigin}/?root=${encodeURIComponent(dir)}`);
  const frame = page.frameLocator('iframe[title="DocBench"]');
  await frame.locator('.db-sec').first().waitFor();
  assert.equal(await frame.locator('#app').getAttribute('data-theme'), 'dark');
  const todo = await until(() => page.evaluate(() => window.__todo), 8000);
  assert.ok(todo.assistant >= 1, '할 일 수(Claude 차례)를 탭 배지로');
  // 대시보드 → 테마 바꾸기·이동
  await page.evaluate(() => window.bench.setTheme('light'));
  await until(async () => (await frame.locator('#app').getAttribute('data-theme')) === 'light', 4000);
  await page.evaluate(() => window.bench.navigate('docs/설계-노트.md'));
  await frame.locator('.db-doctitle', { hasText: '설계' }).waitFor();
  assert.ok((await page.evaluate(() => window.__events)).some((e) => e.type === 'navigate' && e.view === 'docs/설계-노트.md'));
  // 넘기기 → 대시보드가 맡는다(자기 터미널로) — 이벤트에는 피드백 본문이 실리지 않는다
  await frame.locator('.db-send').click();
  const h = await until(() => page.evaluate(() => window.__handoff), 6000);
  assert.ok(h.feedbackIds.includes(f.id));
  assert.match(h.prompt, /docbench-feedback/);
  await frame.locator('.db-toast', { hasText: '대시보드 터미널로 보냈습니다' }).waitFor();
  assert.ok(!JSON.stringify(await page.evaluate(() => window.__events)).includes('요약을 더해 줘'), '이벤트에 본문 없음');
  assert.deepEqual(errors, []);

  // 허용 안 한 출처: 앱 화면 자체는 끼울 수 없다(frame-ancestors 'none'), embed 는 목록에 있는 출처만
  const r = await fetch(`${base}/embed?root=x&t=${app.token}`);
  assert.ok(!r.headers.get('content-security-policy').includes('http://evil.example'));
});
