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
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ko-KR' });
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
