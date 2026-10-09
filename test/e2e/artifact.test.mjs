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
