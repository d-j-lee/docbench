/**
 * DocBench 앱(server/app.mjs)의 화면 — 실제 Chromium 에서.
 *  - 열쇠 없이 열면 여는 방법을 알려 주고, 처음 연 주소(?t=)의 열쇠는 이 출처에 기억하고 주소에서 지운다(쿠키 없음)
 *  - 더한 작업 공간을 열고, 밖에서 생긴 피드백이 실시간으로(SSE, 열쇠는 주소의 token)
 *  - 대시보드 탭: host.js 로 끼우면 테마·이동·할 일 수·보내기(어디로 = 대시보드 터미널)가 postMessage 로 오간다(허용한 출처만)
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

/** 섹션 옆 말풍선 → 그 자리의 적는 칸에 요청을 쓰고 "초안에 두기" (root = 페이지 또는 끼운 화면의 frameLocator) */
async function jot(root, key, text) {
  const head = root.locator(`.db-sec[data-key="${key}"] > .db-sec-head`);
  await head.hover();
  await head.locator('.db-act').first().click();
  const cmp = root.locator('.db-cmp');
  await cmp.locator('.db-cmp-ta:not(.rw)').fill(text);
  await cmp.locator('.db-cmp-f .db-btn.primary', { hasText: '초안에 두기' }).click();
  await cmp.waitFor({ state: 'detached' });
}
/** 초안 탭의 보내기 막대 — 붙일 말을 적고 고른 초안을 한 번에. 어디로(via)를 돌려준다 */
async function sendDrafts(root, { note, n } = {}) {
  await root.locator('.db-pill.draft').click();
  const bar = root.locator('.db-sendbar');
  await bar.waitFor();
  const via = await bar.locator('select[aria-label="어디로"]').inputValue();
  if (note != null) await bar.locator('.db-note').fill(note);
  const go = bar.locator('.db-sendbtn');
  if (n != null) assert.equal((await go.innerText()).trim(), `${n}개 보내기`);
  await go.click();
  return via;
}

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

  // docbench app --open 은 한 번 쓰는 열기 코드로 연다 — 열쇠가 명령 줄·주소·기록에 남지 않는다
  const link = app.openLink();
  await page.goto(link + '&lang=ko');
  await page.waitForSelector('.db-sec');
  assert.ok(!page.url().includes('c='), '주소에서 코드를 지운다');
  assert.equal(await page.evaluate(() => localStorage.getItem('docbench:app:key')), app.token);
  assert.deepEqual((await page.context().cookies()).map((c) => c.name), [], '쿠키 없음');
  // 아무 사이트가 틀린 열쇠(?t=)로 열어도 기억한 열쇠를 지우지 않는다(로그아웃시키지 못한다)
  await page.goto(base + '/?t=' + 'a'.repeat(48) + '&lang=ko');
  await page.waitForSelector('.db-sec');
  assert.equal(await page.evaluate(() => localStorage.getItem('docbench:app:key')), app.token);
  // 맞는 ?t= 는 받아들이고 주소에서 지운다(손으로 여는 길)
  await page.goto(app.openUrl + '&lang=ko');
  await page.waitForSelector('.db-sec');
  assert.ok(!page.url().includes(app.token));
  await page.locator('.db-toast', { hasText: '아직 작업 공간이 없습니다' }).waitFor();

  // 폴더를 더하고(대시보드·CLI 와 같은 API) 다시 열면 그 작업 공간 — 열쇠는 기억한 것으로
  const added = await call('POST', '/api/app/workspaces', { path: dir });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  await page.goto(base + '/?lang=ko');
  await page.locator('.db-ws', { hasText: path.basename(dir) }).waitFor();
  await page.waitForSelector('.db-sec');
  // 밖(터미널의 Claude·동료)에서 생긴 피드백이 실시간으로 — 사람이 API 로 단 것은 보낸 것(보냄 탭)
  const docId = await page.evaluate(() => decodeURIComponent(location.hash.slice(1)));
  await page.locator('.db-tabs .tab-sent').click();
  const fb = await call('POST', `/api/w/${added.data.id}/feedback`, { docId, target: { kind: 'doc' }, body: '밖에서 단 피드백' });
  assert.equal(fb.status, 201);
  await page.locator(`.db-card[data-id="${fb.data.id}"].t-assistant`).waitFor({ timeout: 8000 });
  // 메뉴: 폴더 추가 · 목록에서 빼기 · 시작하기
  await page.locator('.db-ws').click();
  const items = await page.locator('.db-menu .db-menu-i .l').allInnerTexts();
  assert.deepEqual(items, ['폴더 추가…', '목록에서 빼기', '시작하기 보기']);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});

test('대시보드 탭: host.js 로 끼우면 어두운 테마·할 일 수·이동이 오가고, 모은 초안은 한 번에 대시보드 터미널로(본문 없이), 허용 안 한 출처는 못 끼운다', async (t) => {
  const { page, errors } = await newPage(t);
  // 보낸(Claude 가 처리할) 피드백 하나
  const id = (await call('POST', '/api/app/workspaces', { path: dir })).data.id;
  const f = (await call('POST', `/api/w/${id}/feedback`, { docId: 'README.md', target: { kind: 'doc' }, body: '요약을 더해 줘', waitingOn: 'assistant' })).data;
  await page.goto(`${hostOrigin}/?root=${encodeURIComponent(dir)}`);
  const frame = page.frameLocator('iframe[title="DocBench"]');
  await frame.locator('.db-sec').first().waitFor();
  assert.equal(await frame.locator('#app').getAttribute('data-theme'), 'dark');
  const todo = await until(() => page.evaluate(() => window.__todo), 8000);
  assert.ok(todo.assistant >= 1, '할 일 수(보낸 것)를 탭 배지로');
  // 대시보드 → 테마 바꾸기·이동
  await page.evaluate(() => window.bench.setTheme('light'));
  await until(async () => (await frame.locator('#app').getAttribute('data-theme')) === 'light', 4000);
  await page.evaluate(() => window.bench.navigate('docs/설계-노트.md'));
  await frame.locator('.db-doctitle', { hasText: '설계' }).waitFor();
  assert.ok((await page.evaluate(() => window.__events)).some((e) => e.type === 'navigate' && e.view === 'docs/설계-노트.md'));

  // 적어 두기는 초안일 뿐 — 하나마다 대시보드 터미널을 부르지 않는다(D72·D73)
  await jot(frame, '알림 서비스 설계 노트 › 배경', '용어를 맞춰 줘');
  await jot(frame, '알림 서비스 설계 노트 › 위험', '위험 순서를 바꿔 줘');
  await until(async () => (await frame.locator('.db-pill.draft .n').innerText()) === '2', 6000);
  assert.ok(!(await page.evaluate(() => window.__handoff)), '적기만 해서는 대시보드 터미널을 부르지 않는다');
  const drafts = (await call('GET', `/api/w/${id}/feedback`)).data.items.filter((x) => x.status === 'draft');
  assert.deepEqual(drafts.map((x) => x.body).sort(), ['용어를 맞춰 줘', '위험 순서를 바꿔 줘'].sort());

  // 보내기(어디로 = 대시보드 터미널) → 대시보드가 맡는다(자기 터미널로) — 넘기는 것은 id·문서·칠 한 줄뿐
  assert.equal(await sendDrafts(frame, { note: '용어집 기준으로', n: 2 }), 'host');
  const h = await until(() => page.evaluate(() => window.__handoff), 6000);
  assert.deepEqual([...h.feedbackIds].sort(), drafts.map((x) => x.id).sort());
  assert.ok(!h.feedbackIds.includes(f.id), '이미 보낸 것은 다시 보내지 않는다');
  assert.deepEqual(h.docs, ['docs/설계-노트.md']);
  // 둘 다 준다 — 셸 한 줄(command: 기록 폴더로 가서 새 Claude Code, 설치 없음)과 켜진 Claude 대화에 넣을 한 줄(prompt: 플러그인)
  const run = /DocBench 요청 (run-[\w-]+) /.exec(h.command || '')?.[1];
  assert.ok(run && h.command.includes(`runs/${run}.prompt.md`) && /^(Set-Location -LiteralPath |cd )'/.test(h.command), '셸 한 줄: 기록 폴더의 요청 파일을 처리하라는 claude 명령 ' + h.command);
  assert.match(h.prompt, /^\/docbench:docbench-feedback .*보낸 피드백 2건\(/);
  await frame.locator('.db-toast', { hasText: '대시보드 터미널로 보냈습니다' }).waitFor();
  const rows = (await call('GET', `/api/w/${id}/feedback`)).data.items.filter((x) => drafts.some((d) => d.id === x.id));
  assert.deepEqual(rows.map((x) => [x.status, x.waitingOn]), [['open', 'assistant'], ['open', 'assistant']], '보낸 초안은 보냄으로');
  assert.ok(!/요약을 더해 줘|용어를 맞춰 줘|위험 순서를 바꿔 줘|용어집 기준으로/.test(JSON.stringify(await page.evaluate(() => window.__events))), '이벤트에 본문·붙인 말 없음');
  assert.ok(!/용어를 맞춰 줘|위험 순서를 바꿔 줘|용어집 기준으로/.test(JSON.stringify(h)), '대시보드로 넘기는 것에 본문·붙인 말 없음');
  assert.deepEqual(errors, []);

  // 허용 안 한 출처: 앱 화면 자체는 끼울 수 없다(frame-ancestors 'none'), embed 는 목록에 있는 출처만
  const r = await fetch(`${base}/embed?root=x&t=${app.token}`);
  assert.ok(!r.headers.get('content-security-policy').includes('http://evil.example'));
});
