/**
 * 서버 없는 단일 HTML(dist/docbench.html) — 실제 Chromium 에서.
 *  - file:// 로 열면 처음 화면(폴더 열기)이 뜨고 오류가 없다
 *  - 실제 File System Access 핸들(OPFS)로 연 폴더: 편집·피드백·밖에서 고친 피드백이 서버와 같은 디스크 모양으로
 *  - 브라우저 CP949 역표가 iconv-lite cp949 와 모든 글자에서 같다
 * 폴더 고르기 창은 자동화할 수 없어 OPFS(같은 FileSystemDirectoryHandle API)를 쓴다.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import iconv from 'iconv-lite';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { repo, sample, until } from '../server/helpers.mjs';

let server, base, browser;
const html = path.join(repo, 'dist/docbench.html');

before(async () => {
  server = http.createServer(async (req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      if (u === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await fs.readFile(html));
      if (u === '/codec') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><script src="/dist/docbench.iife.js"></script>');
      if (u.startsWith('/dist/')) return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await fs.readFile(path.join(repo, u)));
    } catch { /* 404 */ }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  // 리눅스 Chromium 은 로캘이 UTF-8 이 아니면 한글 파일 이름을 OPFS 에 못 만든다(TypeMismatchError, 실측) — Windows·macOS 는 상관없음
  browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
});
after(async () => { await browser?.close(); server?.close(); });

async function newPage(t, url) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  t.after(() => ctx.close());
  await page.goto(url);
  return { page, errors };
}

/** 예제 작업 폴더를 OPFS 의 새 폴더에 바이트 그대로 복사 */
async function seed(page) {
  const files = [];
  const walk = async (dir, rel) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (e.name !== '.docbench' || r === '.docbench') await walk(path.join(dir, e.name), r); continue; }
      if (r.startsWith('.docbench/') && r !== '.docbench/config.json') continue;
      files.push([r, [...(await fs.readFile(path.join(dir, e.name)))]]);
    }
  };
  await walk(sample, '');
  files.push(['assets/logo.png', [137, 80, 78, 71]]);   // 문서가 없는 폴더 (왼쪽 나무에 흐리게)
  return page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    const name = 'ws-' + Math.random().toString(36).slice(2, 8);
    const ws = await root.getDirectoryHandle(name, { create: true });
    for (const [p, bytes] of files) {
      let d = ws;
      const segs = p.split('/');
      const fname = segs.pop();
      for (const s of segs) d = await d.getDirectoryHandle(s, { create: true });
      const w = await (await d.getFileHandle(fname, { create: true })).createWritable();
      await w.write(new Uint8Array(bytes)); await w.close();
    }
    return name;
  }, files);
}
const readOpfs = (page, name, p) => page.evaluate(async ([name, p]) => {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
  const segs = p.split('/'); const f = segs.pop();
  for (const s of segs) d = await d.getDirectoryHandle(s);
  return [...new Uint8Array(await (await (await d.getFileHandle(f)).getFile()).arrayBuffer())];
}, [name, p]).then((a) => Buffer.from(a));
const writeOpfs = (page, name, p, text) => page.evaluate(async ([name, p, text]) => {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
  const segs = p.split('/'); const f = segs.pop();
  for (const s of segs) d = await d.getDirectoryHandle(s, { create: true });
  const w = await (await d.getFileHandle(f, { create: true })).createWritable();
  await w.write(text); await w.close();
}, [name, p, text]);
const listOpfs = (page, name, p) => page.evaluate(async ([name, p]) => {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
  for (const s of p.split('/')) d = await d.getDirectoryHandle(s);
  const out = []; for await (const k of d.keys()) out.push(k); return out;
}, [name, p]);
const sec = (page, key) => page.locator(`.db-sec[data-key="${key}"]`);

test('file:// 로 열면 폴더 열기 화면, 오류 없음', async (t) => {
  const { page, errors } = await newPage(t, pathToFileURL(html).href + '?lang=ko');
  await page.locator('.db-start h1', { hasText: '문서 폴더 열기' }).waitFor();
  assert.ok(await page.locator('.db-start .db-btn.primary', { hasText: '폴더 열기' }).isVisible(), '쓰기 가능한 브라우저면 폴더 열기 버튼');
  assert.equal(await page.evaluate(() => isSecureContext), true, 'file:// 은 보안 문맥 — 폴더 쓰기 가능');
  await page.locator('.db-start-msg', { hasText: '기억하지 않습니다' }).waitFor();   // file:// 은 다른 로컬 HTML 과 출처를 나눠 써서
  // 이름 안내는 눈에 띄게 (사용자 피드백: 작은 회색 글씨라 안 보였다)
  assert.match(await page.locator('.db-start-note').innerText(), /Windows 로그인 이름/);
  assert.ok(await page.locator('.db-start-note').isVisible());
  await page.locator('.db-start input[type="text"]').fill('');
  await page.locator('.db-start .db-btn.primary', { hasText: '폴더 열기' }).click();
  await page.locator('.db-start-msg', { hasText: '이름을 먼저' }).waitFor();          // 이름 없이 열면 모두가 같은 사람이 된다
  assert.equal(await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("img-src data: blob:")), true, '바깥 그림 주소로 새는 길을 막는다');
  assert.deepEqual(errors, []);
});

test('OPFS 폴더: 섹션 편집·피드백·밖에서 고친 피드백·CP949·BOM/CRLF 가 서버와 같은 디스크 모양으로', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.locator('.db-start').waitFor();
  const name = await seed(page);
  await page.evaluate(async (n) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(n);
    await window.DocBenchStandalone.openHandle(document.getElementById('app'), d, 'dj');
  }, name);
  await page.waitForSelector('.db-sec');
  assert.ok(await listOpfs(page, name, '.docbench').then((l) => l.includes('.gitignore')), '.docbench/ 를 만든다 (CLI 가 작업 폴더로 알아봄)');

  // 섹션 편집 → 저장
  await page.evaluate(() => { location.hash = encodeURIComponent('docs/운영-런북.md'); });
  const key = '알림 서비스 운영 런북 › 장애 대응 › 중복 발송';
  await sec(page, key).waitFor();
  await sec(page, key).locator('> .db-sec-head').hover();
  await sec(page, key).locator('> .db-sec-head .db-act').nth(1).click();
  const area = page.locator('.db-editor textarea.db-ed-area');
  await area.fill((await area.inputValue()).replace('TODO: 멱등 키 확인 절차 정리', '멱등 키(요청 id)로 중복을 막는다.'));
  await page.locator('.db-editor .db-btn.primary').click();
  await until(async () => (await readOpfs(page, name, 'docs/운영-런북.md')).toString().includes('멱등 키(요청 id)'), 6000);
  // 이력 줄은 문서를 쓴 뒤 잠금 안에서 덧붙는다 — 그 줄이 생길 때까지
  let ch;
  await until(async () => { ch = (await readOpfs(page, name, '.docbench/changes.jsonl').catch(() => Buffer.from(''))).toString().trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((c) => c.docId === 'docs/운영-런북.md'); return !!ch; }, 6000);
  assert.deepEqual(ch.sections, [key]);
  assert.deepEqual([ch.by.kind, ch.by.name], ['human', 'dj']);
  assert.deepEqual(await listOpfs(page, name, '.docbench/locks').catch(() => []), [], '잠금 파일이 남지 않는다');

  // 섹션 피드백 → 파일 한 건
  const k2 = '알림 서비스 운영 런북 › 배포 전 확인';
  await page.locator('.db-editor').waitFor({ state: 'detached' });
  await sec(page, k2).locator('> .db-sec-head').hover();
  await sec(page, k2).locator('> .db-sec-head .db-act').first().click();
  const dlg = page.locator('dialog.db-dialog[open]');
  await dlg.locator('textarea').fill('롤백 시간 기준을 넣어 줘');
  await dlg.locator('.db-btn.primary').click();
  let fbName;
  await until(async () => (fbName = (await listOpfs(page, name, '.docbench/feedback')).find((f) => f.endsWith('.json'))), 5000);
  const f = JSON.parse((await readOpfs(page, name, '.docbench/feedback/' + fbName)).toString());
  assert.deepEqual([f.body, f.waitingOn, f.version, f.author.name], ['롤백 시간 기준을 넣어 줘', 'assistant', 1, 'dj']);

  // 터미널의 Claude 가 피드백 파일에 되물음을 남긴다 → 몇 초 안에 카드가 사람 차례로
  const replied = { ...f, version: 2, waitingOn: 'owner', updatedAt: new Date().toISOString(), thread: [...f.thread, { author: { kind: 'assistant', name: 'Claude' }, text: '몇 분이 기준인가요?', at: new Date().toISOString() }] };
  await writeOpfs(page, name, '.docbench/feedback/' + fbName, JSON.stringify(replied, null, 2) + '\n');
  await page.locator(`.db-card[data-id="${f.id}"].t-owner`).waitFor({ timeout: 8000 });

  // CP949 문서: 확장 음절을 넣어 저장 → 원래 바이트는 그대로, 새 글자도 CP949
  const cpId = 'notes/옛-회의록.md';
  const before = await readOpfs(page, name, cpId);
  await page.evaluate((id) => { location.hash = encodeURIComponent(id); }, cpId);
  await page.waitForFunction(() => decodeURIComponent(location.hash).includes('옛-회의록'));
  await page.locator('.db-btn.sm', { hasText: '문서 편집' }).click();
  const ed = page.locator('.db-editor textarea.db-ed-area');
  await ed.fill((await ed.inputValue()).replace(/\n*$/, '\n\n## 덧붙임\n\n똠양꿍 햏\n'));
  await page.locator('.db-editor .db-btn.primary').click();
  await until(async () => iconv.decode(await readOpfs(page, name, cpId), 'cp949').includes('똠양꿍'), 6000);
  await page.locator('.db-editor').waitFor({ state: 'detached' });   // 저장이 끝나기 전에 옮기면 "편집을 버릴까요?" 를 묻는다(정상)
  const after = await readOpfs(page, name, cpId);
  assert.ok(after.subarray(0, before.length - 2).equals(before.subarray(0, before.length - 2)), '앞부분 바이트 그대로');
  assert.ok(!after.toString('latin1').includes('?'), "'?' 로 바뀐 글자 없음");

  // UTF-8 BOM + CRLF 문서
  const winId = 'notes/윈도우-메모.md';
  await page.evaluate((id) => { location.hash = encodeURIComponent(id); }, winId);
  await page.waitForFunction(() => decodeURIComponent(location.hash).includes('윈도우-메모'));
  await page.locator('.db-btn.sm', { hasText: '문서 편집' }).click();
  const ed2 = page.locator('.db-editor textarea.db-ed-area');
  await ed2.fill((await ed2.inputValue()) + '\n추가 줄\n');
  await page.locator('.db-editor .db-btn.primary').click();
  await until(async () => (await readOpfs(page, name, winId)).toString().includes('추가 줄'), 6000);
  const w = await readOpfs(page, name, winId);
  assert.deepEqual([...w.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 유지');
  const s = w.toString('utf8');
  assert.equal(s.split('\r\n').length - 1, s.split('\n').length - 1, '모든 줄이 CRLF');

  assert.deepEqual(errors, []);
});

/**
 * 이 PC 의 실행기를 페이지 안에서 흉내 낸다 (실제 실행기는 OPFS 를 볼 수 없다): 심장 박동을 쓰고, 요청 파일을 받으면
 * 상태·로그를 쓰고 문서·피드백을 바꾼다. 실제 실행기(server/runs.mjs)는 test/server/runs.test.mjs 가 본다.
 */
const simRunner = (page, name, user = 'dj') => page.evaluate(async ([name, user]) => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
  const dirOf = async (p) => { let d = root; for (const s of p.split('/')) d = await d.getDirectoryHandle(s, { create: true }); return d; };
  const write = async (p, text) => { const segs = p.split('/'); const f = segs.pop(); const w = await (await (await dirOf(segs.join('/'))).getFileHandle(f, { create: true })).createWritable(); await w.write(text); await w.close(); };
  const read = async (p) => { const segs = p.split('/'); const f = segs.pop(); return (await (await (await dirOf(segs.join('/'))).getFileHandle(f)).getFile()).text(); };
  const id = 'runner:' + user + '@sim';
  const beat = () => write('.docbench/runners/runner_' + user + '@sim.json', JSON.stringify({ id, kind: 'runner', user, host: 'sim', pid: 1, version: 'test', protocol: 1, startedAt: new Date().toISOString(), seenAt: new Date().toISOString(), claude: { ok: true, version: '2.1.293' }, models: ['opus', 'sonnet', 'haiku', 'fable'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }));
  await beat();
  const seen = new Set();
  window.__simReqs = [];
  window.__simBeat = setInterval(beat, 2000);
  window.__simLoop = setInterval(async () => {
    const runs = await dirOf('.docbench/runs');
    for await (const n of runs.keys()) {
      if (!n.endsWith('.req.json') || seen.has(n)) continue;
      seen.add(n);
      const req = JSON.parse(await read('.docbench/runs/' + n));
      window.__simReqs.push(req);
      const st = { ...req, state: 'running', startedAt: new Date().toISOString() };
      await write(`.docbench/runs/${req.id}.json`, JSON.stringify(st));
      const lines = [{ k: 'start', v: { kind: req.kind, model: req.model || '', effort: req.effort || '', mode: req.mode, n: req.feedbackIds.length } }, { k: 'claude', v: { version: '2.1.293', model: 'claude-' + (req.model || 'x') } }, { k: 'read', v: { path: 'docs/운영-런북.md' } }];
      await new Promise((r) => setTimeout(r, 700));
      for (const fid of req.feedbackIds) {
        const f = JSON.parse(await read('.docbench/feedback/' + fid + '.json'));
        const md = await read(f.docId);
        await write(f.docId, md.replace('- [ ] 공급자 상태 페이지 확인', '- [ ] 공급자 상태 페이지 확인 (5분마다)'));
        await write('.docbench/feedback/' + fid + '.json', JSON.stringify({ ...f, version: (f.version || 1) + 1, status: 'resolved', updatedAt: new Date().toISOString(), thread: [...f.thread, { author: { kind: 'assistant', name: 'Claude' }, text: '확인 주기를 넣었습니다.', at: new Date().toISOString() }] }));
        lines.push({ k: 'apply.edit', v: { fb: fid, doc: f.docId, section: '알림 서비스 운영 런북 › 배포 전 확인' }, ref: { feedbackId: fid, docId: f.docId } });
      }
      lines.push({ k: 'done', v: { ms: 700, edited: req.feedbackIds.length } });
      await write(`.docbench/runs/${req.id}.log.jsonl`, lines.map((l) => JSON.stringify({ at: new Date().toISOString(), ...l })).join('\n') + '\n');
      await write(`.docbench/runs/${req.id}.json`, JSON.stringify({ ...st, state: 'done', endedAt: new Date().toISOString(), summary: { edited: req.feedbackIds.length, proposed: 0, answered: 0, asked: 0, declined: 0, skipped: 0, failed: 0 } }));
    }
  }, 400);
}, [name, user]);

test('Claude 작업(단일 HTML): 실행기 없으면 설치 안내(주소·지문) → 실행기가 켜지면 모델·노력 골라 넘기기 → 요청 파일 → 진행·결과 → 바뀐 글 표시', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.locator('.db-start').waitFor();
  const name = await seed(page);
  const fb = { id: 'fb-20261008-090000-e2e1', version: 1, docId: 'docs/운영-런북.md', target: { kind: 'section', path: ['알림 서비스 운영 런북', '배포 전 확인'], heading: '배포 전 확인' }, selector: { exact: '공급자 상태 페이지 확인' }, body: '확인 주기를 적어 줘', status: 'open', waitingOn: 'assistant', author: { kind: 'human', id: 'dj', name: 'dj' }, thread: [], createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
  await writeOpfs(page, name, '.docbench/feedback/' + fb.id + '.json', JSON.stringify(fb));
  await page.evaluate(async (n) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(n); await window.DocBenchStandalone.openHandle(document.getElementById('app'), d, 'dj'); }, name);
  await page.evaluate(() => { location.hash = encodeURIComponent('docs/운영-런북.md'); });
  await page.locator(`.db-card[data-id="${fb.id}"]`).waitFor();

  // 피드백 미리보기·카드 → 본문 밝히기
  await page.locator('mark.db-fbq').first().hover();
  await page.locator('.db-pop:not([hidden])', { hasText: '확인 주기를 적어 줘' }).waitFor();
  await page.locator(`.db-card[data-id="${fb.id}"]`).hover();
  await page.locator('mark.db-fbq.hl').first().waitFor();

  // 넘기기 → 실행기가 없으니 설치 안내: 이 판의 CLI 주소와 지문
  await page.locator('.db-send').click();
  await page.locator('.db-dock .db-dock-card.compose').waitFor();
  const setup = page.locator('.db-dock .db-dock-card.setup');
  await setup.waitFor();
  const prompt = await setup.locator('textarea').inputValue();
  const sha = createHash('sha256').update(await fs.readFile(path.join(repo, 'dist/docbench.mjs'))).digest('hex');
  const ver = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')).version;
  assert.ok(prompt.includes(sha), '설치 안내에 CLI 지문');
  assert.ok(prompt.includes(`/v${ver}/release/docbench.mjs`), '설치 안내에 이 판의 CLI 주소');
  assert.ok(prompt.includes(`"${name}"`), '폴더 이름');
  await setup.locator('.db-btn.primary', { hasText: '설치 문구 복사' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt);
  assert.equal(await page.locator('.db-dock .compose .db-btn.primary').isDisabled(), true, '실행기 없이는 시작 못 함');

  // 실행기가 켜지면: 연결됨 → 모델·노력 고르고 시작 → 요청 파일
  await simRunner(page, name);
  await page.locator('.db-dock-state.ok').waitFor({ timeout: 12000 });
  await page.locator('.db-dock-opt select').nth(0).selectOption('opus');
  await page.locator('.db-dock-opt select').nth(1).selectOption('high');
  await page.locator('.db-dock .compose .db-btn.primary').click();
  const req = await until(() => page.evaluate(() => window.__simReqs[0]), 6000);
  assert.deepEqual([req.kind, req.model, req.effort, req.mode, req.runner, req.feedbackIds], ['handoff', 'opus', 'high', 'auto', 'runner:dj@sim', [fb.id]]);
  assert.equal(req.by.name, 'dj');

  // 진행·결과: 작업 목록·로그·알림, 피드백 회신, 문서에 바뀐 글
  await page.locator('.db-run[data-state="done"]').waitFor({ timeout: 12000 });
  await page.locator('.db-runlog .db-ll.good', { hasText: '고침 —' }).first().waitFor();
  await page.locator('.db-toast', { hasText: 'Claude 작업 끝' }).waitFor({ timeout: 8000 });
  await page.locator(`.db-card[data-id="${fb.id}"].t-resolved`).waitFor({ timeout: 8000 }).catch(async () => {
    await page.locator('.db-tabs button', { hasText: '끝난 것' }).click();
    await page.locator(`.db-card[data-id="${fb.id}"].t-resolved`).waitFor({ timeout: 4000 });
  });
  await page.locator('ins.db-chg-ins', { hasText: '5분마다' }).waitFor({ timeout: 10000 });
  await page.locator('.db-banner:not([hidden])').waitFor();
  assert.ok(await page.locator('.db-sec[data-changed] .db-badge.chg').count() >= 1);
  // 로그 줄의 "보기" → 그 문서
  await page.locator('.db-runlog .db-ll.link .db-btn').first().click();

  // 왼쪽: 도구와 문서가 나뉘고, 폴더 보기에서 문서가 없는 폴더도 보인다 → 누르면 폴더 지도
  assert.equal(await page.locator('.db-tools .db-tool').count(), 3);
  await page.locator('.db-railview button', { hasText: '폴더' }).click();
  await page.locator('.db-dir.empty', { hasText: 'assets' }).click();
  await page.locator('.db-doctitle', { hasText: '폴더 지도' }).waitFor();
  await page.evaluate(() => { clearInterval(window.__simLoop); clearInterval(window.__simBeat); });
  assert.deepEqual(errors, []);
});

test('이름이 다른 실행기는 저절로 고르지 않는다 — 내 것이면 고르고, 이름을 맞추자고 한다', async (t) => {
  const { page } = await newPage(t, base + '?pick&lang=ko');
  await page.locator('.db-start').waitFor();
  const name = await seed(page);
  await page.evaluate(async (n) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(n); await window.DocBenchStandalone.openHandle(document.getElementById('app'), d, '김철수'); }, name);
  await page.waitForSelector('.db-sec');
  await simRunner(page, name, 'kimcs');
  await page.locator('.db-claude').click();
  // 동료의 실행기일 수 있다 — 알리기만 하고 맡기지 않는다
  const notMine = page.locator('.db-dock-card.setup', { hasText: '내 이름과 다릅니다' });
  await notMine.waitFor({ timeout: 12000 });
  assert.match(await page.locator('.db-dock-state').innerText(), /내 실행기 아님/);
  await notMine.getByRole('button', { name: '내 실행기로 쓰기' }).click();
  await page.locator('.db-dock-state.ok').waitFor({ timeout: 8000 });
  const hint = page.locator('.db-dock-card.hint', { hasText: 'kimcs' });
  await hint.waitFor({ timeout: 12000 });
  await Promise.all([page.waitForNavigation(), hint.locator('.db-btn.primary').click()]);
  assert.equal(await page.evaluate(() => localStorage.getItem('docbench:standalone:name')), 'kimcs');
  await page.evaluate(() => { clearInterval(window.__simLoop); clearInterval(window.__simBeat); }).catch(() => undefined);
});

test('브라우저 CP949 역표 = iconv-lite cp949 (BMP 전체·2바이트 전체)', async (t) => {
  const { page } = await newPage(t, base + 'codec');
  await page.waitForFunction(() => !!window.DocBench);
  // 쓰기: U+0080..U+FFFF 글자마다 바이트(없으면 null)
  const expected = [];
  for (let cp = 0x80; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) { expected.push(null); continue; }
    const ch = String.fromCharCode(cp);
    const b = iconv.encode(ch, 'cp949');
    expected.push(iconv.decode(b, 'cp949') === ch ? b.toString('hex') : null);
  }
  const got = await page.evaluate(() => {
    const c = window.DocBench.createBrowserCp949();
    const out = [];
    for (let cp = 0x80; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) { out.push(null); continue; }
      const b = c.encode(String.fromCharCode(cp));
      out.push(b ? Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') : null);
    }
    return out;
  });
  const diff = [];
  for (let i = 0; i < expected.length; i++) if (expected[i] !== got[i]) diff.push(`U+${(i + 0x80).toString(16)} iconv=${expected[i]} browser=${got[i]}`);
  assert.deepEqual(diff.slice(0, 20), [], `다른 글자 ${diff.length}개`);
  assert.ok(expected.filter(Boolean).length > 17000, '한글 11172자 + 한자·기호');

  // 읽기: 2바이트 쌍 전부
  const pairs = [];
  for (let lead = 0x81; lead <= 0xfe; lead++) for (let trail = 0x41; trail <= 0xfe; trail++) pairs.push([lead, trail]);
  const dec = await page.evaluate((pairs) => { const c = window.DocBench.createBrowserCp949(); return pairs.map(([a, b]) => c.decode(new Uint8Array([a, b]))); }, pairs);
  const ddiff = [];
  pairs.forEach(([a, b], i) => { const exp = iconv.decode(Buffer.from([a, b]), 'cp949'); if (exp.length === 1 && exp !== '�' && exp !== dec[i]) ddiff.push(`${a.toString(16)}${b.toString(16)} iconv=${exp} browser=${dec[i]}`); });
  assert.deepEqual(ddiff.slice(0, 20), [], `다르게 읽는 쌍 ${ddiff.length}개`);
});

test('기록 보관함: 예전 안쪽 기록은 옮기고, 다음 문서 폴더는 묻지 않고 보관함에 — 문서 폴더에는 아무것도 생기지 않는다', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.locator('.db-start').waitFor();
  const name = await seed(page);   // 예제처럼 .docbench/config.json 이 안에 있다
  const home = 'home-' + Math.random().toString(36).slice(2, 8);
  const ls = (p) => page.evaluate(async (p) => { let d = await navigator.storage.getDirectory(); for (const s of p.split('/').filter(Boolean)) d = await d.getDirectoryHandle(s); const out = []; for await (const k of d.keys()) out.push(k); return out.sort(); }, p);
  await page.evaluate(async ([n, h]) => {
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle(n);
    const hh = await root.getDirectoryHandle(h, { create: true });
    window.__start = window.DocBenchStandalone.startWith(document.getElementById('app'), d, '김철수', async () => hh);
  }, [name, home]);
  const step = page.locator('.db-start-data');
  await step.waitFor();
  assert.match(await step.innerText(), /예전 기록/);
  await step.getByRole('button', { name: '기록 보관함으로 옮기기' }).click();
  await page.waitForSelector('.db-sec');
  assert.ok(!(await ls(name)).includes('.docbench'), '안쪽 기록은 옮긴 뒤 지운다');
  assert.deepEqual(await ls(home), ['docbench-home.json', name]);
  assert.ok((await ls(home + '/' + name)).includes('config.json'), '설정도 옮긴다');
  assert.ok((await ls(home + '/' + name)).includes('docbench-data.json'));
  assert.match(await page.locator('.db-rail-store').innerText(), new RegExp(`기록: ${home}/${name}`));
  // 화면에서 단 피드백은 보관함 아래로
  const fid = await page.evaluate(async () => (await window.DocBenchStandalone.adapters.feedback.create({ docId: 'docs/운영-런북.md', target: { kind: 'doc' }, body: '확인' })).id);
  assert.ok((await ls(home + '/' + name + '/feedback')).includes(fid + '.json'));
  assert.ok(!(await ls(name)).includes('.docbench'));

  // 같은 브라우저에서 다른 문서 폴더: 기억한 보관함으로 묻지 않고 연다
  const name2 = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const n = 'ws2-' + Math.random().toString(36).slice(2, 8);
    const d = await root.getDirectoryHandle(n, { create: true });
    const w = await (await d.getFileHandle('메모.md', { create: true })).createWritable(); await w.write('# 메모\n\n본문\n'); await w.close();
    return n;
  });
  await page.evaluate(async (n) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(n);
    window.__start2 = window.DocBenchStandalone.startWith(document.getElementById('app'), d, '김철수', async () => { throw new Error('묻지 않아야 한다'); });
  }, name2);
  await page.waitForFunction((n) => document.title.startsWith(n), name2);
  await page.waitForSelector('.db-sec');
  assert.deepEqual(await ls(name2), ['메모.md'], '문서 폴더에는 문서만');
  assert.deepEqual((await ls(home)).sort(), ['docbench-home.json', name, name2].sort());

  // 이름이 같은 다른 문서 폴더(다른 곳의 '기획') — 문서 목록이 달라 보관함에서 '기획 (2)' 로 따로, 다시 열면 각자 제 기록으로
  const mk = (parent, files) => page.evaluate(async ([parent, files]) => {
    const root = await navigator.storage.getDirectory();
    const d = await (await root.getDirectoryHandle(parent, { create: true })).getDirectoryHandle('기획', { create: true });
    for (const f of files) { const w = await (await d.getFileHandle(f, { create: true })).createWritable(); await w.write('# ' + f + '\n\n본문\n'); await w.close(); }
  }, [parent, files]);
  const pa = 'pa-' + Math.random().toString(36).slice(2, 6), pb = 'pb-' + Math.random().toString(36).slice(2, 6);
  await mk(pa, ['가.md', '나.md', '다.md']);
  await mk(pb, ['라.md', '마.md', '바.md']);
  const openSub = async (parent) => {
    await page.evaluate(async (parent) => {
      const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(parent)).getDirectoryHandle('기획');
      window.__s = window.DocBenchStandalone.startWith(document.getElementById('app'), d, '김철수', async () => { throw new Error('묻지 않아야 한다'); });
    }, parent);
    await page.waitForFunction(() => /기록: /.test(document.querySelector('.db-rail-store')?.textContent || '') && window.DocBenchStandalone.adapters);
    return page.evaluate(() => document.querySelector('.db-rail-store').textContent);
  };
  assert.match(await openSub(pa), new RegExp(`${home}/기획$`));
  assert.match(await openSub(pb), new RegExp(`${home}/기획 \\(2\\)$`));
  assert.match(await openSub(pa), new RegExp(`${home}/기획$`), '다시 열면 제 기록');
  assert.deepEqual(errors, []);
});
