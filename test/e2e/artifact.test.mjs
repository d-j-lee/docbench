/**
 * claude.ai 아티팩트 어댑터 — 플랫폼 런타임(claude.use)을 흉내 낸 메모리 저장소로 왕복을 확인한다.
 * 흉내(test/fixtures/claude-mock.js)는 계약 0.2.73 의 모양을 따른다: 경로 문법 검사, 깊게 얼린 스냅샷,
 * 내 쓰기의 hasPendingWrites, sample.json 이 없는 옛 뷰어(capability_removed).
 * 검토 회차(0.6.0): 적어 둔 초안을 대화창의 Claude 에게 한 번에 보내고(comments.sendToClaude), Claude 가 저장소에 올린 제안을
 * "볼 것"에서 보고 적용한다.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { Workspace } from '../../server/workspace.mjs';
import { core } from '../../server/core.mjs';
import { repo, sample, until } from '../server/helpers.mjs';

let server, base, browser;
const mock = await fs.readFile(path.join(repo, 'test/fixtures/claude-mock.js'), 'utf8');

before(async () => {
  const ws = await new Workspace(sample).init();
  const manifest = await ws.manifest();
  const page = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/dist/docbench.css"><style>html,body{height:100%;margin:0}#app{height:100%}</style>
<div id="app"></div><script src="/dist/docbench.iife.js"></script>
<script>(async () => { const ad = await DocBench.createArtifactAdapters({ manifestUrl: '/manifest.json', inventoryUrl: '', docUrl: (id) => '/files/' + id, useTimeoutMs: 2000 });
DocBench.createDocBench(document.getElementById('app'), { adapters: ad, routing: 'hash', injectStyles: false }); })();</script>`;
  server = http.createServer(async (req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      if (u === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
      if (u === '/manifest.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(manifest));
      if (u.startsWith('/dist/')) return res.writeHead(200, { 'Content-Type': u.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(await fs.readFile(path.join(repo, u)));
      if (u.startsWith('/files/')) {
        const d = await ws.readDoc(u.slice(7)); // 원래 인코딩을 풀어 UTF-8 로 준다
        return res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }).end(d.md);
      }
    } catch { /* 아래 404 */ }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

test('편집본 층·판 기록·초안·대화창으로 보내기·제안·적용 (한글·슬래시 문서 id)', async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  t.after(() => ctx.close());
  await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const id = 'docs/운영-런북.md';
  await page.goto(base + '#' + encodeURIComponent(id));
  await page.evaluate(() => localStorage.removeItem('mockdb'));
  await page.reload();
  await page.waitForSelector('.db-sec');
  const db = async () => page.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('mockdb') || '[]')));
  const fbRow = async () => Object.entries(await db()).find(([k]) => k.startsWith('feedback/'));

  // 섹션에 적어 두기 → 공유 저장소에 초안 한 건(아직 아무에게도 가지 않는다)
  const key = '알림 서비스 운영 런북 › 장애 대응 › 중복 발송';
  const head = page.locator(`.db-sec[data-key="${key}"] > .db-sec-head`);
  await head.hover();
  await head.locator('.db-act').first().click();
  await page.locator('.db-cmp .db-cmp-ta:not(.rw)').fill('절차를 한 줄로');
  await page.locator('.db-cmp .db-cmp-f .db-btn.primary', { hasText: '초안에 두기' }).click();
  let row;
  await until(async () => (row = await fbRow()), 5000);
  const [fbKey, draft] = row;
  assert.deepEqual([draft.status, draft.waitingOn, draft.body], ['draft', 'owner', '절차를 한 줄로']);
  assert.deepEqual(Object.keys(draft.author).sort(), ['id', 'kind'], '공유 데이터엔 사람 id 만');
  assert.deepEqual(await page.evaluate(() => window.__sent), [], '적기만 해서는 대화창에 보내지 않는다');

  // 보내기(어디로 = 대화창의 Claude) → 한 번에 한 요청, 피드백은 보냄으로
  await page.locator('.db-pill.draft').click();
  const bar = page.locator('.db-sendbar');
  assert.equal(await bar.locator('select[aria-label="어디로"]').count(), 0, '보낼 곳은 대화창 하나');
  await bar.locator('.db-sendbtn', { hasText: '1개 보내기' }).click();
  await page.locator('.db-toast', { hasText: '보냈습니다. 결과는 "볼 것"에 올라옵니다.' }).waitFor();
  const sent = await page.evaluate(() => window.__sent);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^DocBench 검토 — 보낸 피드백 1건/);
  await until(async () => (await fbRow())[1].waitingOn === 'assistant', 5000);

  // 대화창의 Claude 가 저장소에 제안을 올린다(아티팩트 데이터에 직접 — 문서는 그대로) → "볼 것"의 제안 카드
  const md0 = await fs.readFile(path.join(sample, id), 'utf8');
  const before = core.getSectionText(md0, key);
  await page.evaluate(async ([ref, before, keyPath]) => {
    const dbh = await window.claude.use('db');
    const doc = dbh.doc(ref);
    const cur = (await doc.get()).data();
    const at = new Date().toISOString();
    const claude = { kind: 'assistant', name: 'Claude' };
    await doc.update({ version: cur.version + 1, status: 'open', waitingOn: 'owner', updatedAt: at, result: { kind: 'propose', at, run: 'chat' },
      proposal: { path: keyPath, before, after: before.replace(/\n*$/, '') + '\n\n(모의 제안) 한 줄\n', rationale: '한 줄로 줄였습니다', author: claude, at, state: 'pending' },
      thread: [...cur.thread, { author: claude, text: '이렇게 바꾸면 어떨까요?', at }] });
  }, [fbKey, before, key.split(' › ')]);
  await page.locator('.db-pill.owner .n', { hasText: '1' }).waitFor();
  await page.locator('.db-pill.owner').click();
  const card = page.locator('.db-card.r-propose');
  await card.locator('.db-prop .db-dl.add', { hasText: '(모의 제안) 한 줄' }).waitFor({ timeout: 5000 });
  await card.locator('.db-c-act .db-btn.primary', { hasText: '적용' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb') || '[]').some(([k, v]) => k.startsWith('feedback/') && v.status === 'resolved'));

  const all = await db();
  const docKeys = Object.keys(all).filter((k) => k.startsWith('docs/'));
  assert.equal(docKeys.length, 1);
  assert.match(docKeys[0], /^docs\/@[A-Za-z0-9_-]+$/, '경로 문법에 안 맞는 id 는 @base64url 로');
  assert.equal(all[docKeys[0]].docId, id);
  assert.ok(all[docKeys[0]].md.includes('(모의 제안) 한 줄'));
  assert.equal(all[docKeys[0]].md.split('(모의 제안) 한 줄').length, 2, '그 섹션에 한 번');
  assert.ok(Object.keys(all).some((k) => /^revisions\/@[A-Za-z0-9_-]+~1$/.test(k)), '판 기록');
  assert.ok(Object.keys(all).some((k) => k.startsWith('changes/')), '변경 이력');
  const fb = all[fbKey];
  assert.equal(fb.proposal.state, 'applied');
  for (const m of fb.thread) if (m.author.kind === 'human') assert.deepEqual(Object.keys(m.author).sort(), ['id', 'kind'], '공유 데이터엔 사람 id 만');
  assert.equal(await page.locator('.db-editor .db-ed-msg:not([hidden])').count(), 0, '내 저장을 밖의 변경으로 오해하지 않는다');

  await page.reload();
  await page.waitForSelector('.db-sec');
  assert.ok((await page.content()).includes('(모의 제안) 한 줄'), '다시 열면 편집본');
  assert.deepEqual(errors, []);
});

test('Claude 가 먼저 남긴 의견(대화의 Claude·옛 판 사전 리뷰): 위 막대 "볼 것"은 이 문서에 없으면 모든 문서로, 반영해 한 번이면 초안으로', async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  t.after(() => ctx.close());
  await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const id = 'docs/운영-런북.md';
  const other = 'docs/설계-노트.md';
  const path = ['알림 서비스 운영 런북', '장애 대응', '중복 발송'];
  const at = '2026-10-08T07:30:00Z';
  // 옛 판(0.1) 사전 리뷰 모양 그대로 — 결과 꼬리표 없음, 작성 Claude, 내 차례. 보기 상태는 "이 문서"만
  const row = { author: { kind: 'assistant', name: 'Claude' }, body: '멱등 키 확인 절차를 단계로 나누자.', createdAt: at, updatedAt: at, docId: id, kind: '명료성', order: 0,
    selector: { exact: '멱등' }, severity: 'medium', status: 'open', target: { kind: 'section', path, heading: path[2] }, thread: [], title: '절차를 단계로', version: 2, waitingOn: 'owner' };
  await page.goto(base + '#' + encodeURIComponent(other));
  await page.evaluate(([row]) => { localStorage.clear(); window.__seed([['feedback/pr-01', row], ['data/users/u_mockuser0000000000000/viewstate', { v: 1, updatedAt: Date.now(), docs: {}, panel: { scope: 'doc', filter: 'owner' } }]]); }, [row]);
  await page.reload();
  await page.waitForSelector('.db-sec');
  await page.locator('.db-pill.owner .n', { hasText: '1' }).waitFor();
  await page.locator('.db-pill.owner').click();
  const card = page.locator('.db-card[data-id="pr-01"]');
  await card.waitFor({ timeout: 5000 });
  assert.match(await page.locator('.db-panel .db-ph-top').innerText(), /모든 문서/, '이 문서에 없으니 모든 문서로 열었다');
  assert.match(await page.locator('.db-round-h').first().innerText(), /Claude 가 먼저 남긴 것 1/);
  assert.equal(await card.locator('.db-rkind').innerText(), 'Claude 의견');
  assert.deepEqual(await card.locator('.db-c-act button').allInnerTexts(), ['반영해', '답하기', '닫기']);
  assert.equal(await page.locator('.db-round', { hasText: 'Claude 가 먼저 남긴 것' }).locator('button', { hasText: '모두 확인' }).count(), 0, '먼저 남긴 의견은 한꺼번에 닫지 않는다');

  await card.locator('button', { hasText: '반영해' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb') || '[]').some(([k, v]) => k === 'feedback/pr-01' && v.status === 'draft'));
  const all = Object.fromEntries(await page.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '[]')));
  const fb = all['feedback/pr-01'];
  assert.equal(fb.drafter, 'u_mockuser0000000000000');
  assert.deepEqual(fb.thread.map((m) => [m.author.kind, m.text]), [['human', '반영해 주세요.']]);
  assert.deepEqual(Object.keys(fb.thread[0].author).sort(), ['id', 'kind'], '공유 데이터엔 사람 id 만');
  assert.deepEqual(await page.evaluate(() => window.__sent), [], '반영해는 초안에 둘 뿐 — 보내지 않는다');
  await page.locator('.db-pill.draft .n', { hasText: '1' }).waitFor();

  // 초안 탭에서 한 번에 보내면 대화로 한 요청
  await page.locator('.db-pill.draft').click();
  await page.locator('.db-sendbar .db-sendbtn', { hasText: '1개 보내기' }).click();
  await until(async () => (await page.evaluate(() => window.__sent)).length === 1, 5000);
  assert.match((await page.evaluate(() => window.__sent))[0].text, /^DocBench 검토 — 보낸 피드백 1건 \(알림 서비스 운영 런북\)/);
  assert.deepEqual(errors, []);
});

test('문서 전체에 적기(여러 줄) · 제목부터 본문까지 고른 문구 — 인용에 단추 글자가 섞이지 않고 문서에서 다시 찾는다', async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  t.after(() => ctx.close());
  await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '#' + encodeURIComponent('docs/운영-런북.md'));
  await page.evaluate(() => localStorage.removeItem('mockdb'));
  await page.reload();
  await page.waitForSelector('.db-sec');
  const rows = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '[]'))).filter(([k]) => k.startsWith('feedback/')).map(([, v]) => v);

  // 문서 전체에 — 여러 문단의 방향 지시도 줄바꿈 그대로 초안 한 건
  const body = '전체를 한 장으로 압축\n\n- 지난 경과는 지운다\n- 빈칸은 확인해 채운다';
  await page.locator('button', { hasText: '문서 전체에' }).click();
  const cmp = page.locator('.db-cmp');
  assert.match(await cmp.locator('.db-cmp-where').innerText(), /알림 서비스 운영 런북 · 문서 전체/);
  await cmp.locator('.db-cmp-ta:not(.rw)').fill(body);
  await cmp.locator('.db-btn.primary', { hasText: '초안에 두기' }).click();
  let whole;
  await until(async () => (whole = (await rows()).find((f) => f.target?.kind === 'doc')), 5000);
  assert.deepEqual([whole.docId, whole.body, whole.status], ['docs/운영-런북.md', body, 'draft']);
  await page.locator('.db-pill.draft').click();
  assert.match(await page.locator('.db-panel .db-card.t-draft').first().innerText(), /문서 전체/);

  // 제목(### 발송 누락)부터 본문 앞부분까지 — 제목 옆 단추(적기·편집)는 인용에 들어가지 않는다
  const key = '알림 서비스 운영 런북 › 장애 대응 › 발송 누락';
  await page.locator(`.db-sec[data-key="${key}"] > .db-sec-head`).hover();
  await page.evaluate((key) => {
    const sec = document.querySelector(`.db-sec[data-key="${key}"]`);
    const h = sec.querySelector(':scope > .db-sec-head h3').firstChild;
    const p = sec.querySelector(':scope > .db-sec-body p').firstChild;
    getSelection().setBaseAndExtent(h, 0, p, '재처리 명령은'.length);
    sec.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, key);
  assert.ok((await page.evaluate(() => getSelection().toString())).length > '발송 누락 재처리 명령은'.length, '화면의 선택 글에는 단추 글자까지 들어 있다');
  await page.locator('.db-selbtn:not([hidden])').click();
  assert.equal(await cmp.locator('.db-cmp-q').innerText(), '발송 누락 재처리 명령은');
  await cmp.locator('.db-cmp-ta:not(.rw)').fill('여기 확인');
  await cmp.locator('.db-btn.primary', { hasText: '초안에 두기' }).click();
  let q;
  await until(async () => (q = (await rows()).find((f) => f.body === '여기 확인')), 5000);
  assert.deepEqual(q.target.path, ['알림 서비스 운영 런북', '장애 대응', '발송 누락']);
  assert.equal(q.selector.exact, '발송 누락 재처리 명령은');
  assert.ok(q.selector.suffix.startsWith(' 아래와 같다'), '뒤 문맥으로 다시 찾는다(앞은 섹션의 처음)');
  await page.locator('mark.db-fbq.draft', { hasText: '재처리 명령은' }).waitFor();
  assert.deepEqual(errors, []);
});

test('길게 고르기 — 문서 위(제목 줄)부터 끝까지 끌어 고르면 단추가 그대로 나오고, 인용 없이 문서 전체에 적는다', async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  t.after(() => ctx.close());
  await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // 인용 한도(500자)를 넘는 문서 — 편집본 층으로 넣는다(아티팩트 db docs/@base64url)
  const id = 'docs/운영-런북.md';
  const md = '# 알림 서비스 운영 런북\n\n' + Array.from({ length: 8 }, (_, i) => `## 절 ${i + 1}\n\n${'큐 적체를 줄이려면 채널별 작업자를 늘리고 재시도 간격을 늘린다. '.repeat(3)}\n`).join('\n');
  const key = '@' + Buffer.from(id).toString('base64url');
  await page.goto(base + '#' + encodeURIComponent(id));
  await page.evaluate(([key, row]) => { localStorage.removeItem('mockdb'); window.__seed([[`docs/${key}`, row]]); }, [key, { docId: id, md, version: 3, updatedAt: new Date().toISOString(), updatedBy: { kind: 'human' } }]);
  await page.reload();
  await page.waitForSelector('.db-sec[data-key="알림 서비스 운영 런북 › 절 8"]');
  const rows = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '[]'))).filter(([k]) => k.startsWith('feedback/')).map(([, v]) => v);

  // 마지막 절 끝에서 문서 머리(본문 밖)의 제목까지 거슬러 끌어 고른다 — 화면은 맨 위, 범위의 아래 끝은 화면 밖
  await page.evaluate(() => {
    const art = document.querySelector('.db-md');
    const head = document.querySelector('.db-dochead h1') || document.querySelector('.db-dochead');
    const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) last = n;
    const first = document.createTreeWalker(head, NodeFilter.SHOW_TEXT).nextNode();
    getSelection().setBaseAndExtent(last, last.length, first, 0);
    art.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const btn = page.locator('.db-selbtn:not([hidden])');
  await btn.waitFor();
  const box = await btn.boundingBox();
  assert.ok(box.y >= 0 && box.y < 900, `단추가 고르기를 끝낸 곳(화면 안)에 있다 (y=${Math.round(box.y)})`);
  await btn.click();
  const cmp = page.locator('.db-cmp');
  assert.match(await cmp.locator('.db-cmp-where').innerText(), /알림 서비스 운영 런북 · 문서 전체/);
  assert.equal(await cmp.locator('.db-cmp-q').count(), 0, '긴 범위는 인용으로 남기지 않는다');
  await cmp.locator('.db-cmp-ta:not(.rw)').fill('전체 방향');
  await cmp.locator('.db-btn.primary', { hasText: '초안에 두기' }).click();
  let f;
  await until(async () => (f = (await rows()).find((x) => x.body === '전체 방향')), 5000);
  assert.deepEqual([f.docId, f.target, f.selector, f.status], [id, { kind: 'doc' }, undefined, 'draft']);
  assert.deepEqual(errors, []);
});

test('말풍선·골라 보기(D85): 피드백이 그 자리에 뜨고, 중요도·종류 거르기를 말풍선과 패널이 함께 따른다 · 적는 칸에서 종류를 고른다', async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  t.after(() => ctx.close());
  await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const id = 'docs/운영-런북.md';
  const top = '알림 서비스 운영 런북';
  const at = '2026-10-08T07:30:00Z';
  const row = (o) => ({ author: { kind: 'assistant', name: 'Claude' }, body: '본문', createdAt: at, updatedAt: at, docId: id, status: 'open', waitingOn: 'owner', thread: [], version: 1, ...o });
  const seed = [
    // 문구(목록 줄) — 그 줄 바로 아래. 예전 꼬리표 "불일치" → 충돌로 짐작
    ['feedback/c-1', row({ kind: '불일치', severity: 'high', title: '횟수가 다름', selector: { exact: '최대 5회' }, target: { kind: 'section', path: [top, '배포 전 확인'], heading: '배포 전 확인' } })],
    // 섹션 — 섹션 머리 아래
    ['feedback/c-2', row({ category: 'typo', severity: 'low', title: '맞춤법', target: { kind: 'section', path: [top, '장애 대응'], heading: '장애 대응' } })],
    // 문서 전체 — 맨 위
    ['feedback/c-3', row({ category: 'direction', title: '방향', target: { kind: 'doc' } })],
    // 끝난 것 — 기본은 말풍선이 없다
    ['feedback/c-4', row({ category: 'typo', status: 'resolved', title: '끝남', target: { kind: 'doc' } })],
  ];
  await page.goto(base + '#' + encodeURIComponent(id));
  await page.evaluate(([seed]) => { localStorage.clear(); window.__seed(seed); }, [seed]);
  await page.reload();
  await page.waitForSelector('.db-sec');
  assert.equal(await page.locator('.db-bub').count(), 0, '처음에는 지금처럼(패널·밑줄)');

  await page.locator('.db-doctitle').click();   // 단축키는 작업대 안에 초점이 있을 때(scoped)
  await page.keyboard.press('b');
  await page.locator('.db-bub').first().waitFor();
  assert.deepEqual((await page.locator('.db-bub').evaluateAll((bs) => bs.map((b) => b.dataset.id))).sort(), ['c-1', 'c-2', 'c-3']);
  // 자리: 문구가 든 줄 안(목록 항목 끝), 섹션 머리 바로 뒤, 문서 맨 위
  const where = await page.evaluate(() => {
    const bub = (id) => document.querySelector(`.db-bub[data-id="${id}"]`).parentElement;
    const b1 = bub('c-1'), b2 = bub('c-2'), b3 = bub('c-3');
    return {
      c1: b1.parentElement.tagName === 'LI' && !!b1.parentElement.querySelector('mark.db-fbq[data-fb="c-1"]'),
      c2: b2.previousElementSibling?.classList.contains('db-sec-head') && b2.previousElementSibling.textContent.includes('장애 대응'),
      c3: b3.parentElement.classList.contains('db-md') && b3 === b3.parentElement.firstElementChild,
    };
  });
  assert.deepEqual(where, { c1: true, c2: true, c3: true });
  assert.deepEqual(await page.locator('.db-bub[data-id="c-1"] .db-cat').allInnerTexts(), ['충돌']);
  // 말풍선 글은 문서 글자가 아니다 — 찾기에 걸리지 않는다
  await page.locator('.db-find input').fill('횟수가 다름');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('mark.db-hit').count(), 0, '말풍선 글은 찾기에 걸리지 않는다');
  await page.locator('.db-find input').fill('');

  // 골라 보기: 높음만 → 말풍선 c-1 하나, 패널 볼 것도 1건(띠와 함께)
  await page.locator('.db-toolbar .db-lens-btn').click();
  await page.locator('.db-lens button', { hasText: '높음만' }).click();
  await page.keyboard.press('Escape');
  await until(async () => (await page.locator('.db-bub').count()) === 1, 3000);
  assert.match(await page.locator('.db-toolbar .db-lens-btn').innerText(), /높음만/);
  await page.locator('.db-pill.owner').click();
  assert.match(await page.locator('.db-lens-bar').innerText(), /높음만 · 3건 중 1건/);
  assert.equal(await page.locator('.db-panel .db-card').count(), 1);
  // 가려진 피드백의 섹션 수를 누르면 — 빈 칸을 여는 대신 가려졌다고 알리고 모두 보기를 권한다
  await page.locator(`.db-sec[data-key="${top} › 장애 대응"] > .db-sec-head .db-badge.owner`).click();
  await page.locator('.db-toast', { hasText: '골라 보기에 가려진' }).waitFor();
  // 종류 + 끝난 것: 오탈자만 · 끝난 것도 → 말풍선 c-2·c-4 (중요도는 모두로)
  await page.locator('.db-panel .db-lens-bar button', { hasText: '모두 보기' }).click();
  await page.locator('.db-toolbar .db-lens-btn').click();
  await page.locator('.db-lens .db-cat-chip.c-typo').click();
  await page.locator('.db-lens input[type=checkbox]').check();
  await page.keyboard.press('Escape');
  await until(async () => (await page.locator('.db-bub').count()) === 2, 3000);
  assert.deepEqual((await page.locator('.db-bub').evaluateAll((bs) => bs.map((b) => b.dataset.id))).sort(), ['c-2', 'c-4']);
  // 보기 상태에 남는다(다시 열어도 같다)
  await page.reload();
  await page.waitForSelector('.db-sec');
  await until(async () => (await page.locator('.db-bub').count()) === 2, 5000);

  // 골라 보기 창은 키보드로 — Enter 가 섹션 접기로 새지 않고, 다시 그려도 초점이 그 단추에 남는다
  await page.locator('.db-toolbar .db-lens-btn').click();
  await page.locator('.db-lens [data-k="bub-off"]').focus();
  await page.keyboard.press('Enter');
  await until(async () => (await page.locator('.db-bub').count()) === 0, 3000);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.k), 'bub-off');
  await page.locator('.db-lens [data-k="bub-on"]').focus();
  await page.keyboard.press('Enter');
  await until(async () => (await page.locator('.db-bub').count()) === 2, 3000);
  assert.equal(await page.locator('.db-toolbar .db-lens-btn').getAttribute('aria-expanded'), 'true');
  await page.locator('.db-toolbar .db-lens-btn').click();   // 같은 단추로 닫는다
  assert.equal(await page.locator('.db-lens').count(), 0);
  // 말풍선을 누르면 패널의 그 카드
  await page.locator('.db-bub[data-id="c-2"]').click();
  await page.locator('.db-panel .db-card[data-id="c-2"]').waitFor();

  // 적는 칸에서 종류 고르기 → 초안에 category
  await page.locator('.db-toolbar button', { hasText: '문서 전체에' }).click();
  await page.locator('.db-cmp .db-cmp-cat').selectOption('duplicate');
  await page.locator('.db-cmp .db-cmp-ta:not(.rw)').fill('같은 말이 두 번');
  await page.locator('.db-cmp .db-btn.primary', { hasText: '초안에 두기' }).click();
  let d;
  await until(async () => (d = (await page.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '[]'))).map(([, v]) => v).find((v) => v.body === '같은 말이 두 번')), 5000);
  assert.deepEqual([d.category, d.status], ['duplicate', 'draft']);
  assert.deepEqual(errors, []);
});
