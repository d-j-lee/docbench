/**
 * claude.ai 아티팩트 어댑터 — 플랫폼 런타임(claude.use)을 흉내 낸 메모리 저장소로 왕복을 확인한다.
 * 흉내(test/fixtures/claude-mock.js)는 계약 0.2.73 의 모양을 따른다: 경로 문법 검사, 깊게 얼린 스냅샷,
 * 내 쓰기의 hasPendingWrites, sample.json 이 없는 옛 뷰어(capability_removed).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { Workspace } from '../../server/workspace.mjs';
import { repo, sample } from '../server/helpers.mjs';

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

test('편집본 층·판 기록·피드백·제안·적용 (한글·슬래시 문서 id)', async (t) => {
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

  const key = '알림 서비스 운영 런북 › 장애 대응 › 중복 발송';
  const sec = page.locator(`.db-sec[data-key="${key}"]`);
  await sec.locator('> .db-sec-head').hover();
  await sec.locator('> .db-sec-head .db-act').first().click();
  await page.locator('dialog[open] textarea').fill('절차를 한 줄로');
  await page.locator('dialog[open] .db-btn.primary').click();
  const card = page.locator('.db-card').first();
  await card.waitFor();
  await card.locator('.db-btn', { hasText: '제안' }).click();
  await card.locator('.db-prop .db-dl.add').first().waitFor({ timeout: 5000 });
  await card.locator('.db-btn.primary', { hasText: '적용' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb') || '[]').some(([k, v]) => k.startsWith('feedback/') && v.status === 'resolved'));

  const db = await page.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('mockdb'))));
  const docKeys = Object.keys(db).filter((k) => k.startsWith('docs/'));
  assert.equal(docKeys.length, 1);
  assert.match(docKeys[0], /^docs\/@[A-Za-z0-9_-]+$/, '경로 문법에 안 맞는 id 는 @base64url 로');
  assert.equal(db[docKeys[0]].docId, id);
  assert.ok(db[docKeys[0]].md.includes('(모의 제안) 한 줄'));
  assert.ok(Object.keys(db).some((k) => /^revisions\/@[A-Za-z0-9_-]+~1$/.test(k)), '판 기록');
  assert.ok(Object.keys(db).some((k) => k.startsWith('changes/')), '변경 이력');
  const fb = Object.entries(db).find(([k]) => k.startsWith('feedback/'))[1];
  assert.equal(fb.proposal.state, 'applied');
  for (const m of fb.thread) if (m.author.kind === 'human') assert.deepEqual(Object.keys(m.author).sort(), ['id', 'kind'], '공유 데이터엔 사람 id 만');
  assert.equal(await page.locator('.db-editor .db-ed-msg:not([hidden])').count(), 0, '내 저장을 밖의 변경으로 오해하지 않는다');

  await page.reload();
  await page.waitForSelector('.db-sec');
  assert.ok((await page.content()).includes('(모의 제안) 한 줄'), '다시 열면 편집본');
  assert.deepEqual(errors, []);
});
