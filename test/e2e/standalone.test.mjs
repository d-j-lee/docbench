/**
 * 서버 없는 단일 HTML(dist/docbench.html) — 실제 Chromium 에서.
 *  - file:// 로 열면 처음 화면(폴더 열기)이 뜨고 오류가 없다
 *  - 실제 File System Access 핸들(OPFS)로 연 폴더: 편집·초안·밖에서 고친 피드백이 서버와 같은 디스크 모양으로
 *  - 검토 회차(0.6.0): 그 자리에서 적기(초안) → 고른 초안을 한 번에 보내기(앱·터미널 한 줄·연습용 흉내) → 결과는 "볼 것"
 *  - 휴대폰·태블릿 너비에서 적는 칸·검토 패널·Claude 창을 누를 수 있다
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

async function newPage(t, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'], ...opts });
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
  for (const s of p.split('/').filter(Boolean)) d = await d.getDirectoryHandle(s);
  const out = []; for await (const k of d.keys()) out.push(k); return out;
}, [name, p]);
const sec = (page, key) => page.locator(`.db-sec[data-key="${key}"]`);

/** 섹션 옆 말풍선 → 그 자리의 적는 칸(.db-cmp) */
async function composer(page, key) {
  const head = sec(page, key).locator('> .db-sec-head');
  await head.hover();
  await head.locator('.db-act').first().click();
  const cmp = page.locator('.db-cmp');
  await cmp.waitFor();
  return cmp;
}
/** 적는 칸에 요청(chip = 자주 쓰는 말 단추, rewrite = "이렇게 바꿔" 글)을 쓰고 "초안에 두기" — 아무것도 보내지 않는다 */
async function jot(page, key, text, o = {}) {
  const cmp = await composer(page, key);
  if (o.rewrite != null) {
    await cmp.locator('.db-seg button', { hasText: '이렇게 바꿔' }).click();
    await cmp.locator('.db-cmp-ta.rw').fill(o.rewrite);
    if (text) await cmp.locator('.db-cmp-why').fill(text);
  } else if (o.chip) await cmp.locator('.db-cmp-quick .db-chip', { hasText: o.chip }).click();
  else await cmp.locator('.db-cmp-ta:not(.rw)').fill(text);
  await cmp.locator('.db-cmp-f .db-btn.primary', { hasText: '초안에 두기' }).click();
  await cmp.waitFor({ state: 'detached' });
}
/** 검토 패널의 탭 — 초안·볼 것은 위 띠의 알약으로 연다 */
const openTab = (page, which) => page.locator(which === 'draft' ? '.db-pill.draft' : '.db-pill.owner').click();
/** 초안 탭의 보내기 막대: 붙일 말·어디로·모델·노력을 고르고 고른 초안을 한 번에 보낸다. n = 단추의 개수 확인 */
async function sendDrafts(page, o = {}) {
  await openTab(page, 'draft');
  const bar = page.locator('.db-sendbar');
  await bar.waitFor();
  if (o.via) await bar.locator('select[aria-label="어디로"]').selectOption(o.via);
  if (o.note != null) await bar.locator('.db-note').fill(o.note);
  if (o.model || o.effort) {
    await bar.locator('details.db-adv > summary').click();
    if (o.model) await bar.locator('.db-adv .db-dock-opt select').nth(0).selectOption(o.model);
    if (o.effort) await bar.locator('.db-adv .db-dock-opt select').nth(1).selectOption(o.effort);
  }
  const go = bar.locator('.db-sendbtn');
  if (o.n != null) assert.equal((await go.innerText()).trim(), `${o.n}개 보내기`);
  await go.click();
}
/** 그 자리를 누르면 정말 그 요소가 눌리나 (덮개·알림·다른 칸에 가리지 않고, 화면 안에). 미끄러져 들어오는 칸(0.18s)을 기다려 2초까지 본다 */
const hittable = (loc) => until(() => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && !!at && (at === el || el.contains(at));
}), 2000).then(() => true, () => false);
/** 카드 아래 단추(이름이 정확히 같은 것 — 섹션 이름 단추와 헷갈리지 않게) */
const cardBtn = (card, label) => card.locator('.db-c-act button', { hasText: new RegExp(`^\\s*${label}\\s*$`) });
/** 떠 있는 알림을 사람이 × 로 닫는다 — 좁은 화면에서는 아래쪽 단추 자리에 뜬다(그 문제는 '알림이 … 가리지 않는다' 시험이 따로 본다) */
async function dismissToast(page) {
  const x = page.locator('.db-toast:not([hidden]) .db-toast-x');
  if (await x.count()) { await x.click(); await page.locator('.db-toast').waitFor({ state: 'hidden' }); }
}
/** 맨 위에서 그 자리를 덮은 것 (실패 메시지용) */
const coveredBy = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return at ? (at.closest('[class]')?.className || at.tagName) : 'nothing'; });

test('file:// 로 열면 시작하기 작업대가 바로 — 이름·폴더를 묻지 않는다, 오류 없음', async (t) => {
  const { page, errors } = await newPage(t, pathToFileURL(html).href + '?lang=ko');
  await page.waitForSelector('.db-sec');
  assert.equal(await page.locator('.db-docbench input[type="text"]:visible, .docbench input[type="text"]:visible').count(), 0, '처음에 이름 칸이 없다');
  assert.match(await page.locator('.db-ws').innerText(), /시작하기/);
  assert.equal(await page.evaluate(() => isSecureContext), true, 'file:// 은 보안 문맥 — 폴더 쓰기 가능');
  // 계정은 이 브라우저에 저절로 — 이름 없이
  const acct = JSON.parse(await page.evaluate(() => localStorage.getItem('docbench:account')));
  assert.match(acct.id, /^u-[0-9a-f]{10}$/);
  assert.equal(acct.name, undefined);
  // 연습용 문서에는 Claude 가 남긴 되물음이 "볼 것"으로 기다린다
  await page.locator('.db-explorer .db-nav, .db-nav', { hasText: '연습' }).first().click();
  await page.locator('.db-card.t-owner').first().waitFor();
  // 작업 공간 메뉴: 첫째가 폴더 열기
  await page.locator('.db-ws').click();
  const first = page.locator('.db-menu .db-menu-i').first();
  assert.match(await first.innerText(), /폴더 열기/);
  assert.ok(await first.evaluate((e) => e.classList.contains('primary')));
  await page.keyboard.press('Escape');
  await page.locator('.db-menu').waitFor({ state: 'detached' });
  // 나: 별명을 붙여도 계정 id 는 그대로 (예전 피드백이 계속 "내 것")
  await page.locator('.db-me').click();
  const dlg = page.locator('dialog.db-dialog[open]');
  assert.match(await dlg.innerText(), new RegExp(acct.id));
  await dlg.locator('input').fill('디제이');
  await dlg.locator('.db-btn.primary').click();
  await page.locator('.db-me', { hasText: '디제이' }).waitFor();
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('docbench:account'))), { id: acct.id, name: '디제이' });
  assert.equal(await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("img-src data: blob:")), true, '바깥 그림 주소로 새는 길을 막는다');
  assert.deepEqual(errors, []);
});

test('휴대폰 너비(360): 위 띠가 한 줄, 그 자리의 적는 칸·검토 패널·Claude 창을 손가락으로 — 흉내 Claude 가 답글의 값으로 빈칸을 채우고, 그 밖의 요청은 고치지 않고 솔직히 답한다', async (t) => {
  // 주인 폰 실사용(0.5.0): 넘겼는데 아무 반응이 없었다 — 0.6.0 은 초안으로 모아 한 번에 보내고, 결과는 "볼 것"에 회차로 모인다
  const { page, errors } = await newPage(t, pathToFileURL(html).href + '?lang=ko', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.waitForSelector('.db-sec');
  const fits = () => page.evaluate(() => { const b = document.querySelector('.db-bar'); const p = document.querySelector('.db-toggle.panel').getBoundingClientRect(); return b.scrollWidth <= b.clientWidth && p.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  assert.equal(await fits(), true, '목록·초안·볼 것·패널 단추까지 한 줄에, 가로 넘침 없음');
  await page.locator('.db-toggle.nav').click();
  await page.locator('.db-rail .db-nav', { hasText: '연습' }).first().click();
  await page.locator('.db-sec', { hasText: '시범 운영' }).first().waitFor();
  const docId = '연습용 기획서.md', top = '연습용 기획서 — 사내 문서 검토 도우미';
  const md0 = await page.evaluate((id) => window.DocBenchStandalone.adapters.docs.load(id).then((d) => d.md), docId);

  // 1) 섹션 말풍선 → 좁은 화면에서는 아래쪽 판으로 뜨는 적는 칸 — 자주 쓰는 말 단추로 요청 → 초안(아직 보내지 않음)
  const cmp = await composer(page, `${top} › 목표`);
  assert.ok(await cmp.evaluate((e) => e.classList.contains('sheet')), '좁은 화면: 아래쪽 판');
  await cmp.locator('.db-cmp-quick .db-chip', { hasText: '표로' }).click();
  const keep = cmp.locator('.db-cmp-f .db-btn.primary', { hasText: '초안에 두기' });
  assert.equal(await hittable(keep), true, '초안에 두기 단추를 누를 수 있다 — 가린 것: ' + await coveredBy(keep));
  assert.equal(await fits(), true);
  await keep.click();
  await cmp.waitFor({ state: 'detached' });
  await page.locator('.db-toast', { hasText: '초안에 모았습니다' }).waitFor();

  // 2) 흉내 Claude 가 남긴 질문(볼 것)에 값을 답한다 → 이것도 초안
  await openTab(page, 'review');
  const q = page.locator('.db-card[data-id="welcome-1"]');
  await q.locator('button', { hasText: '답하기' }).click();
  await q.locator('.db-reply textarea').fill('11월 3~14일, 김민지');
  await q.locator('.db-reply button', { hasText: '초안에 두기' }).click();
  await page.locator('.db-toast', { hasText: '답을 초안에 두었습니다' }).waitFor();
  await until(async () => (await page.locator('.db-pill.draft .n').innerText()) === '2', 4000);

  // 3) 초안 2개를 붙일 말과 함께 한 번에 — 패널의 보내기 단추도 화면 안에서 눌린다
  await openTab(page, 'draft');
  assert.equal(await page.locator('.db-card.t-draft').count(), 2);
  assert.equal(await page.locator('.db-tabs .tab-sent .n').innerText(), '0', '적기만 했다 — 아직 아무것도 보내지 않았다');
  await dismissToast(page);
  assert.equal(await hittable(page.locator('.db-sendbtn')), true, '보내기 단추를 누를 수 있다 — 가린 것: ' + await coveredBy(page.locator('.db-sendbtn')));
  assert.equal(await fits(), true);
  await sendDrafts(page, { note: '연습이라 짧게', n: 2 });
  await page.locator('.db-toast', { hasText: '2개를 보냈습니다.' }).waitFor();
  const done = page.locator('.db-toast', { hasText: 'Claude 가 끝냈습니다' });
  await done.waitFor({ timeout: 10000 });
  assert.match(await done.innerText(), /고침 1/);
  assert.match(await done.innerText(), /답 1/);

  // 4) 결과는 볼 것의 한 회차(붙인 말과 함께): 값을 준 질문은 고침, "표로"는 흉내라 고치지 않고 솔직히 답
  await done.getByRole('button', { name: '볼 것 보기' }).click();
  const round = page.locator('.db-round', { hasText: '보낸 2개' });
  await round.waitFor();
  assert.match(await round.innerText(), /연습이라 짧게/);
  await page.locator('.db-card[data-id="welcome-1"].r-edit').waitFor();
  const ans = page.locator('.db-card.r-answer');
  await ans.waitFor();
  assert.match(await ans.innerText(), /흉내/);
  assert.equal(await fits(), true);
  await page.locator('.db-toggle.panel').click();

  // 5) 문서: 일정의 빈칸만 채워지고(바뀐 글 표시) 목표는 한 글자도 그대로
  await until(async () => (await page.locator('ins.db-chg-ins').allInnerTexts()).join('|').includes('김민지'), 8000);
  // 지운 글(<del>)은 표시일 뿐 문서 글자가 아니다 — 빼고 본다
  const sched = await page.locator('.db-sec', { hasText: '시범 운영' }).last().evaluate((e) => { const c = e.cloneNode(true); c.querySelectorAll('del').forEach((d) => d.remove()); return c.textContent; });
  assert.match(sched, /11월 3~14일/);
  assert.match(sched, /김민지/);
  assert.doesNotMatch(sched, /\[TODO\]/, '빈칸이 모두 채워짐');
  const md1 = await page.evaluate((id) => window.DocBenchStandalone.adapters.docs.load(id).then((d) => d.md), docId);
  const goals = (s) => s.slice(s.indexOf('## 목표'), s.indexOf('## 일정'));
  assert.equal(goals(md1), goals(md0), '고치라는 글이 없는 요청은 문서를 건드리지 않는다');
  assert.equal(md1.replace('| 11월 3~14일 |', '| [TODO] |').replace('| 김민지 |', '| [TODO] |'), md0, '바뀐 것은 빈칸 두 곳뿐');

  // 6) Claude 창: 흉내라고 밝히고, 로그 첫 줄은 시작, 채워지지 않은 자리표시가 없다 — 창의 단추도 화면 안에서 눌린다
  await page.locator('.db-claude').click();
  await page.locator('.db-dock-state', { hasText: '흉내' }).waitFor();
  await page.locator('.db-run[data-state="done"]').first().waitFor();
  const log = await page.locator('.db-runlog').innerText();
  assert.match(log.split('\n').find((l) => l.trim() && !/^\d\d:/.test(l)) || '', /시작/, '로그 첫 줄은 시작(자리표시가 먹지 않는다)');
  assert.doesNotMatch(log, /\{\w+\}/, '채워지지 않은 자리표시가 없다');
  assert.match(log, /고침 —/);
  assert.match(log, /답함 —/);
  assert.equal(await hittable(page.locator('.db-dock-x')), true, 'Claude 창을 닫을 수 있다 — 가린 것: ' + await coveredBy(page.locator('.db-dock-x')));
  assert.equal(await fits(), true);
  assert.deepEqual(errors, []);
});

test('태블릿 너비(820): 검토 패널은 문서 옆에(덮개 없음), 목록은 겹쳐 뜬다 — 적는 칸·보내기·결과·Claude 창이 가리지 않는다', async (t) => {
  const { page, errors } = await newPage(t, pathToFileURL(html).href + '?lang=ko', { viewport: { width: 820, height: 1100 }, hasTouch: true });
  await page.waitForSelector('.db-sec');
  // 목록은 겹쳐 뜬다 — 문서 칸을 줄이지 않고, 고르면 닫힌다
  await page.locator('.db-toggle.nav').click();
  await page.locator('.docbench.rail-open').waitFor();
  const nav = page.locator('.db-rail .db-nav', { hasText: '연습' }).first();
  assert.equal(await hittable(nav), true, '겹쳐 뜬 목록을 누를 수 있다 — 가린 것: ' + await coveredBy(nav));
  await nav.click();
  await page.locator('.db-sec', { hasText: '시범 운영' }).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.docbench.rail-open'));
  if (!(await page.locator('.docbench.panel-open').count())) await page.locator('.db-toggle.panel').click();
  const lay = await page.evaluate(() => {
    const m = document.querySelector('.db-main').getBoundingClientRect(), p = document.querySelector('.db-panel').getBoundingClientRect();
    return { mainR: m.right, mainW: m.width, panelL: p.left, panelR: p.right, panelW: p.width, scrim: getComputedStyle(document.querySelector('.db-scrim')).display, over: document.documentElement.scrollWidth - innerWidth };
  });
  assert.ok(lay.panelW > 200 && lay.panelL >= lay.mainR - 1 && lay.panelR <= 820 && lay.mainW >= 400, '패널은 문서 옆 ' + JSON.stringify(lay));
  assert.equal(lay.scrim, 'none', '패널을 열어도 문서를 덮지 않는다');
  assert.ok(lay.over <= 0, '가로 넘침 없음');

  // 패널을 연 채로 읽으며 적는다 — "이렇게 바꿔"로 바꿀 글을 직접
  const top = '연습용 기획서 — 사내 문서 검토 도우미';
  const cmp = await composer(page, `${top} › 배경`);
  await cmp.locator('.db-seg button', { hasText: '이렇게 바꿔' }).click();
  await cmp.locator('.db-cmp-ta.rw').fill('팀마다 의견이 메신저·메일·회의록으로 흩어진다.');
  const keep = cmp.locator('.db-cmp-f .db-btn.primary');
  assert.equal(await hittable(keep), true, '적는 칸의 단추를 누를 수 있다 — 가린 것: ' + await coveredBy(keep));
  await keep.click();
  await cmp.waitFor({ state: 'detached' });
  await openTab(page, 'draft');
  await dismissToast(page);
  assert.equal(await hittable(page.locator('.db-sendbtn')), true, '보내기 단추를 누를 수 있다 — 가린 것: ' + await coveredBy(page.locator('.db-sendbtn')));
  await sendDrafts(page, { n: 1 });
  const done = page.locator('.db-toast', { hasText: 'Claude 가 끝냈습니다' });
  await done.waitFor({ timeout: 10000 });
  await done.getByRole('button', { name: '볼 것 보기' }).click();
  const card = page.locator('.db-card.r-edit');
  await card.waitFor();
  assert.equal(await hittable(cardBtn(card, '확인')), true, '결과 카드의 단추를 누를 수 있다 — 가린 것: ' + await coveredBy(cardBtn(card, '확인')));
  // 바뀐 섹션(누가: Claude)은 패널 옆 문서 칸에 그대로 보인다
  const changed = sec(page, `${top} › 배경`);
  await changed.locator('.db-badge.chg', { hasText: 'Claude' }).waitFor({ timeout: 8000 });
  const para = changed.locator('.db-sec-body p', { hasText: '회의록으로 흩어진다' });
  await para.scrollIntoViewIfNeeded();
  assert.equal(await hittable(para), true, '패널이 바뀐 글을 가리지 않는다 — 가린 것: ' + await coveredBy(para));
  // Claude 창도 가리지 않는다
  await page.locator('.db-claude').click();
  const run = page.locator('.db-run[data-state="done"]').first();
  await run.waitFor();
  assert.equal(await hittable(run), true, 'Claude 창의 작업을 누를 수 있다 — 가린 것: ' + await coveredBy(run));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
});

test('알림이 바로 다음 단추를 가리지 않는다 — 휴대폰: 연달아 적을 때 "초안에 두기", 태블릿: 초안을 모은 뒤 "보내기"', async (t) => {
  // 적고 나면 "초안에 모았습니다" 알림이 화면 아래 가운데에 몇 초 뜬다. 좁은 화면에서는 그 자리가 다음에 누를 단추 자리다
  const problems = [];
  for (const [width, height, next] of [[360, 780, 'compose'], [820, 1100, 'send']]) {
    const { page, errors } = await newPage(t, pathToFileURL(html).href + '?lang=ko', { viewport: { width, height }, hasTouch: true, ...(width < 500 ? { isMobile: true } : {}) });
    await page.waitForSelector('.db-sec');
    await page.locator('.db-toggle.nav').click();
    await page.locator('.db-rail .db-nav', { hasText: '연습' }).first().click();
    await page.locator('.db-sec', { hasText: '시범 운영' }).first().waitFor();
    const top = '연습용 기획서 — 사내 문서 검토 도우미';
    await jot(page, `${top} › 배경`, '한 문장으로 줄여 줘');
    await page.locator('.db-toast', { hasText: '초안에 모았습니다' }).waitFor();
    let btn;
    if (next === 'compose') {
      const cmp = await composer(page, `${top} › 목표`);
      await cmp.locator('.db-cmp-ta:not(.rw)').fill('목표를 숫자로');
      btn = cmp.locator('.db-cmp-f .db-btn.primary');
    } else {
      await openTab(page, 'draft');
      btn = page.locator('.db-sendbtn');
    }
    await btn.waitFor();
    // 알림이 떠 있는 동안(몇 초) 그 단추와 겹치나 — 시간에 기대지 않게 사각형으로 본다
    const st = await btn.evaluate((el) => {
      const toast = el.closest('.docbench').querySelector('.db-toast');
      if (!toast || toast.hidden) return 'no-toast';
      const a = el.getBoundingClientRect(), b = toast.getBoundingClientRect();
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom ? 'covered' : 'clear';
    });
    assert.notEqual(st, 'no-toast', '알림이 아직 떠 있을 때 본다');
    if (st === 'covered') problems.push(`${width}px: "${(await page.locator('.db-toast .m').innerText()).trim()}" 알림이 ${next === 'compose' ? '적는 칸의 "초안에 두기"' : '패널의 "보내기"'} 단추를 가림`);
    assert.deepEqual(errors, []);
  }
  assert.deepEqual(problems, []);
});

test('읽다가 마음이 바뀌어도 — 적던 글은 잃지 않고(다른 곳에 적기·Esc 두 번), 패널이 다시 그려져도 고치던 글·초점이 남고, 합치기는 되돌리고, ★ 끄기는 지우고, 칸 숫자는 범위대로, 못 한 결과는 다시 보내고, 다른 문서의 읽기 정리는 끌고 가지 않는다', async (t) => {
  const { page, errors } = await newPage(t, pathToFileURL(html).href + '?lang=ko');
  await page.waitForSelector('.db-sec');
  await page.locator('.db-rail .db-nav', { hasText: '연습' }).first().click();
  await page.locator('.db-sec', { hasText: '시범 운영' }).first().waitFor();
  const top = '연습용 기획서 — 사내 문서 검토 도우미';
  const docId = '연습용 기획서.md';
  const rows = () => page.evaluate(() => new Promise((r) => { let u = null; u = window.DocBenchStandalone.adapters.feedback.subscribe((x) => { r(x.map((f) => ({ id: f.id, status: f.status, body: f.body, severity: f.severity, sec: f.target.path ? f.target.path.join(' › ') : '', result: f.result }))); setTimeout(() => u && u()); }); }));
  const draftsNow = async () => (await rows()).filter((f) => f.status === 'draft');

  // 1) 적다가 다른 섹션의 말풍선을 누르면 — 적던 글은 초안으로 남고 새 칸이 열린다
  let cmp = await composer(page, `${top} › 배경`);
  await cmp.locator('.db-cmp-ta:not(.rw)').fill('배경을 두 줄로');
  // 적는 칸은 글과 함께 움직인다(문서 칸 안) — 바로 아래 섹션은 칸에 가려 있으니 조금 아래 섹션으로
  cmp = await composer(page, `${top} › 위험 요소`);
  await page.locator('.db-toast', { hasText: '적던 글을 초안에 두었습니다' }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('.db-cmp').parentElement.classList.contains('db-main')), true);
  assert.deepEqual((await draftsNow()).map((f) => [f.sec, f.body]), [[`${top} › 배경`, '배경을 두 줄로']]);
  // 2) Esc 는 적은 글이 있으면 한 번은 경고만 — 두 번째에 버린다
  await cmp.locator('.db-cmp-ta:not(.rw)').fill('위험에 대안');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.db-cmp').count(), 1, '첫 Esc 로는 닫히지 않는다');
  assert.match(await cmp.locator('.db-cmp-f .db-hint').innerText(), /한 번 더 누르면 버립니다/);
  await page.keyboard.press('Escape');
  await page.locator('.db-cmp').waitFor({ state: 'detached' });
  assert.equal((await draftsNow()).length, 1, '버린 글은 초안이 되지 않는다');

  // 3) 초안 두 개 더 — ★ 를 붙였다 떼면 급함이 지워진다(null)
  await jot(page, `${top} › 목표`, '목표를 숫자로');
  await jot(page, `${top} › 위험 요소`, '대안도 적어 줘');
  await openTab(page, 'draft');
  const card = (body) => page.locator('.db-card.t-draft', { hasText: body });
  await card('대안도 적어 줘').locator('.db-star').click();
  await until(async () => (await draftsNow()).find((f) => f.body === '대안도 적어 줘').severity === 'high', 3000);
  await card('대안도 적어 줘').locator('.db-star').click();
  await until(async () => (await draftsNow()).find((f) => f.body === '대안도 적어 줘').severity === undefined, 3000);

  // 4) 고치던 글은 패널이 다시 그려져도(다른 피드백이 바뀌어도) 남고, 초점·커서도 그 칸에
  await cardBtn(card('목표를 숫자로'), '고치기').click();
  const ta = page.locator('.db-card.t-draft textarea[data-key^="edit:"]');
  await ta.fill('목표를 숫자로 — 분기별로');
  const other = (await draftsNow()).find((f) => f.body === '대안도 적어 줘');
  await page.evaluate((id) => window.DocBenchStandalone.adapters.feedback.update(id, { title: '바깥에서 고침' }), other.id);
  await page.locator('.db-card.t-draft', { hasText: '대안도 적어 줘' }).waitFor();
  await until(() => page.evaluate(() => document.querySelectorAll('.db-plist').length === 1), 2000);
  assert.equal(await ta.inputValue(), '목표를 숫자로 — 분기별로', '다시 그려도 쓰던 글 그대로');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.key?.startsWith('edit:')), true, '초점도 그 칸에');
  await page.keyboard.press('Control+Enter');
  await until(async () => (await draftsNow()).some((f) => f.body === '목표를 숫자로 — 분기별로'), 3000);

  // 5) 칸 숫자는 패널 범위대로 — "이 문서"로 바꾸면 다른 문서의 것은 세지 않는다
  await page.evaluate(() => window.DocBenchStandalone.adapters.feedback.create({ docId: 'DocBench 시작하기.md', target: { kind: 'doc' }, body: '다른 문서 메모', status: 'draft', waitingOn: 'owner', author: { kind: 'human' } }));
  const n = (tab) => page.locator(`.db-tabs button.tab-${tab} .n`).innerText();
  await until(async () => (await n('draft')) === '4', 3000);
  await page.locator('.db-ph-top .db-btn', { hasText: '모든 문서' }).click();
  await until(async () => (await n('draft')) === '3', 3000);
  await page.locator('.db-ph-top .db-btn', { hasText: '이 문서' }).click();

  // 6) 합치기 → 카드 하나, 알림 하나에서 "원래대로" → 둘로
  await page.locator('.db-dtools .db-btn', { hasText: '하나도 안 고름' }).click();
  await card('목표를 숫자로').locator('.db-pick').check();
  await card('대안도 적어 줘').locator('.db-pick').check();
  await page.locator('.db-dtools .db-btn', { hasText: '2개 합치기' }).click();
  await page.locator('.db-toast', { hasText: '2개를 하나로 합쳤습니다' }).waitFor();
  await until(async () => (await draftsNow()).filter((f) => f.sec.startsWith(top) || f.sec === '').length === 3, 3000);
  const merged = (await draftsNow()).find((f) => f.body.includes('목표를 숫자로') && f.body.includes('대안도 적어 줘'));
  assert.ok(merged, '본문에 둘 다');
  await page.locator('.db-toast .db-btn', { hasText: '원래대로' }).click();
  await until(async () => { const d = await draftsNow(); return d.some((f) => f.body === '목표를 숫자로 — 분기별로') && d.some((f) => f.body === '대안도 적어 줘'); }, 4000);

  // 7) 반영하지 못한 결과는 "볼 것"에 까닭과 함께 — 다시 보내면 처리된다
  const failedId = await page.evaluate(([docId, top]) => window.DocBenchStandalone.adapters.feedback.create({ docId, target: { kind: 'section', path: [top, '위험 요소'], heading: '위험 요소' }, body: '이렇게', suggestion: '원본은 지금 자리에 둔다.', author: { kind: 'human' }, status: 'open', waitingOn: 'owner', result: { kind: 'failed', at: new Date().toISOString(), run: 'run-x', problem: '섹션 제목이 빠졌습니다' } }).then((f) => f.id), [docId, top]);
  await openTab(page, 'review');
  const failed = page.locator(`.db-card[data-id="${failedId}"]`);
  await failed.locator('.db-ed-msg.warn', { hasText: '섹션 제목이 빠졌습니다' }).waitFor();
  await cardBtn(failed, '다시 보내기').click();
  await until(async () => { const f = (await rows()).find((x) => x.id === failedId); return f.result?.kind === 'edit'; }, 15000);

  // 8) 읽기 정리를 부탁하고 다른 문서로 옮겼다 — 끝나도 끌고 가지 않고, 알리고 "볼 것"에서 고른다
  await dismissToast(page);
  await page.locator('.db-review-btn').click();
  const dlg = page.locator('dialog.db-dialog[open]');
  await dlg.locator('.db-radio', { hasText: '읽기 정리' }).click();
  await dlg.locator('.db-btn.primary').click();
  await page.locator('.db-rail .db-nav', { hasText: '시작하기' }).first().click();
  await page.locator('.db-sec', { hasText: '폴더 열기' }).first().waitFor();
  await page.locator('.db-toast', { hasText: '읽기 정리가 왔습니다' }).waitFor({ timeout: 15000 });
  await openTab(page, 'review');
  const apply = page.locator('.db-round-view .db-btn', { hasText: '내 화면에 적용' });
  await apply.waitFor({ timeout: 15000 });
  assert.match(decodeURIComponent(await page.evaluate(() => location.hash)), /시작하기/, '다른 문서로 끌려가지 않았다');
  await apply.click();
  await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes('연습용')), 5000);
  await page.locator('.db-guide').waitFor();
  await page.locator('.db-round-view').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});

test('예전 판의 이름이 있으면 그 이름이 계정 — 예전 피드백이 계속 내 것', async (t) => {
  const { page } = await newPage(t, base + '?pick&lang=ko');
  await page.waitForSelector('.db-sec');
  await page.evaluate(() => { localStorage.removeItem('docbench:account'); localStorage.setItem('docbench:standalone:name', 'dj'); });
  await page.reload();
  await page.waitForSelector('.db-sec');
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('docbench:account'))), { id: 'dj', name: 'dj' });
  assert.match(await page.locator('.db-me').innerText(), /dj/);
});

test('OPFS 폴더: 섹션 편집·초안·밖에서 고친 피드백(볼 것)·CP949·BOM/CRLF 가 서버와 같은 디스크 모양으로', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.waitForSelector('.db-sec');
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

  // 섹션에 적기 → 초안 파일 한 건(아직 아무에게도 가지 않는다 — 요청 파일 없음)
  const k2 = '알림 서비스 운영 런북 › 배포 전 확인';
  await page.locator('.db-editor').waitFor({ state: 'detached' });
  await jot(page, k2, '롤백 시간 기준을 넣어 줘');
  let fbName;
  await until(async () => (fbName = (await listOpfs(page, name, '.docbench/feedback')).find((f) => f.endsWith('.json'))), 5000);
  const f = JSON.parse((await readOpfs(page, name, '.docbench/feedback/' + fbName)).toString());
  assert.deepEqual([f.body, f.status, f.waitingOn, f.version, f.author.name], ['롤백 시간 기준을 넣어 줘', 'draft', 'owner', 1, 'dj']);
  assert.deepEqual((await listOpfs(page, name, '.docbench/runs').catch(() => [])).filter((n) => n.endsWith('.req.json')), [], '초안은 보내지 않는다');
  await page.locator(`.db-card[data-id="${f.id}"].t-draft`).waitFor();

  // 보낸 뒤 터미널의 Claude 가 피드백 파일에 되물음을 남긴다(CLI fb reply --ask 와 같은 모양) → 몇 초 안에 "볼 것"의 질문 카드로
  const at = new Date().toISOString();
  const replied = { ...f, version: 2, status: 'open', waitingOn: 'owner', result: { kind: 'ask', at, run: 'cli' }, updatedAt: at, thread: [...f.thread, { author: { kind: 'assistant', name: 'Claude' }, text: '몇 분이 기준인가요?', at }] };
  await writeOpfs(page, name, '.docbench/feedback/' + fbName, JSON.stringify(replied, null, 2) + '\n');
  await until(async () => (await page.locator('.db-pill.owner .n').innerText()) === '1', 8000);
  await openTab(page, 'review');
  await page.locator(`.db-card[data-id="${f.id}"].r-ask .db-msg.assistant`, { hasText: '몇 분이 기준인가요?' }).waitFor();

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
 * 이 PC 의 DocBench 앱(또는 예전 실행기)을 페이지 안에서 흉내 낸다 (실제 앱은 OPFS 를 볼 수 없다): 심장 박동(프로토콜 2)을 쓰고, 요청 파일을 받으면
 * 상태·로그를 쓰고 문서를 고친 뒤 피드백을 "볼 것"(open·owner + result)으로 돌린다 — 엔진은 끝내지 않는다(사람이 확인).
 * 실제 엔진(server/runs.mjs)은 test/server/runs.test.mjs 가 본다.
 */
const simRunner = (page, name, o = {}) => page.evaluate(async ([name, o]) => {
  const user = o.user || 'dj', kind = o.kind || 'runner';
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
  const dirOf = async (p) => { let d = root; for (const s of p.split('/')) d = await d.getDirectoryHandle(s, { create: true }); return d; };
  const write = async (p, text) => { const segs = p.split('/'); const f = segs.pop(); const w = await (await (await dirOf(segs.join('/'))).getFileHandle(f, { create: true })).createWritable(); await w.write(text); await w.close(); };
  const read = async (p) => { const segs = p.split('/'); const f = segs.pop(); return (await (await (await dirOf(segs.join('/'))).getFileHandle(f)).getFile()).text(); };
  const id = kind + ':' + user + '@sim';
  const beat = () => write('.docbench/runners/' + kind + '_' + user + '@sim.json', JSON.stringify({ id, kind, user, ...(o.owners ? { owners: o.owners } : {}), host: 'sim', pid: 1, version: 'test', protocol: 2, startedAt: new Date().toISOString(), seenAt: new Date().toISOString(), claude: { ok: true, version: '2.1.293' }, models: ['opus', 'sonnet', 'haiku', 'fable'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }));
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
        const at = new Date().toISOString();
        await write('.docbench/feedback/' + fid + '.json', JSON.stringify({ ...f, version: (f.version || 1) + 1, status: 'open', waitingOn: 'owner', result: { kind: 'edit', at, run: req.id }, updatedAt: at, thread: [...f.thread, { author: { kind: 'assistant', name: 'Claude' }, text: '확인 주기를 넣었습니다.', at }] }));
        lines.push({ k: 'apply.edit', v: { fb: fid, doc: f.docId, section: '알림 서비스 운영 런북 › 배포 전 확인' }, ref: { feedbackId: fid, docId: f.docId } });
      }
      lines.push({ k: 'done', v: { ms: 700, edited: req.feedbackIds.length } });
      await write(`.docbench/runs/${req.id}.log.jsonl`, lines.map((l) => JSON.stringify({ at: new Date().toISOString(), ...l })).join('\n') + '\n');
      await write(`.docbench/runs/${req.id}.json`, JSON.stringify({ ...st, state: 'done', endedAt: new Date().toISOString(), summary: { edited: req.feedbackIds.length, proposed: 0, answered: 0, asked: 0, declined: 0, skipped: 0, failed: 0 } }));
    }
  }, 400);
}, [name, o]);
const stopSim = (page) => page.evaluate(() => { clearInterval(window.__simLoop); clearInterval(window.__simBeat); }).catch(() => undefined);
const openOpfs = (page, name, user) => page.evaluate(async ([n, u]) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(n); await window.DocBenchStandalone.openHandle(document.getElementById('app'), d, u); }, [name, user]);

test('Claude 작업(단일 HTML): 연결 없으면 보낼 곳은 터미널 한 줄뿐·창에는 설치 안내(주소·지문·계정 짝) → 앱이 켜지면 어디로=앱, 붙일 말·모델·노력과 함께 초안을 보냄 → 요청 파일 → 진행·결과는 볼 것 → 바뀐 글 표시', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.waitForSelector('.db-sec');
  const name = await seed(page);
  const fb = { id: 'fb-20261008-090000-e2e1', version: 1, docId: 'docs/운영-런북.md', target: { kind: 'section', path: ['알림 서비스 운영 런북', '배포 전 확인'], heading: '배포 전 확인' }, selector: { exact: '공급자 상태 페이지 확인' }, body: '확인 주기를 적어 줘', status: 'draft', waitingOn: 'owner', author: { kind: 'human', id: 'dj', name: 'dj' }, thread: [], createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
  await writeOpfs(page, name, '.docbench/feedback/' + fb.id + '.json', JSON.stringify(fb));
  await openOpfs(page, name, 'dj');
  await page.evaluate(() => { location.hash = encodeURIComponent('docs/운영-런북.md'); });
  await page.locator(`.db-card[data-id="${fb.id}"].t-draft`).waitFor();

  // 초안 미리보기·카드 → 본문 밝히기
  await page.locator('mark.db-fbq').first().hover();
  await page.locator('.db-pop:not([hidden])', { hasText: '확인 주기를 적어 줘' }).waitFor();
  await page.locator(`.db-card[data-id="${fb.id}"]`).hover();
  await page.locator('mark.db-fbq.hl').first().waitFor();

  // 연결이 없으면: 보낼 곳은 터미널 한 줄(설치 없음)뿐 — 앱을 고를 수 없다
  const bar = page.locator('.db-sendbar');
  assert.equal(await bar.locator('select[aria-label="어디로"]').count(), 0, '보낼 곳이 하나뿐');
  assert.match(await bar.innerText(), /터미널 한 줄 \(설치 없음\)/);
  // Claude 창에는 설치 안내: 이 판의 CLI 주소와 지문, 이 화면의 계정과 짝짓기
  await page.locator('.db-claude').click();
  const setup = page.locator('.db-dock .db-dock-card.setup');
  await setup.waitFor();
  const prompt = await setup.locator('textarea').inputValue();
  const sha = createHash('sha256').update(await fs.readFile(path.join(repo, 'dist/docbench.mjs'))).digest('hex');
  const ver = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')).version;
  assert.ok(prompt.includes(sha), '설치 안내에 CLI 지문');
  assert.ok(prompt.includes(`/v${ver}/release/docbench.mjs`), '설치 안내에 이 판의 CLI 주소');
  assert.ok(prompt.includes(`"${name}"`), '폴더 이름');
  assert.match(prompt, /link "<문서 폴더>" --owner dj/, '이 화면의 계정과 짝');
  assert.match(prompt, /app --detach/);
  assert.match(prompt, /claude auth status/);
  await setup.locator('.db-btn.primary', { hasText: '설치 문구 복사' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt);
  assert.match(await setup.innerText(), /터미널 한 줄/, '앱 없이도 된다고 알린다');

  // 앱이 켜지면(이 화면의 계정과 짝지어진): 연결됨 → 어디로=앱(첫째)·터미널 → 붙일 말·모델·노력과 함께 보내기 → 요청 파일
  await simRunner(page, name, { kind: 'app', user: 'dj-pc', owners: ['dj'] });
  await page.locator('.db-dock-state.ok', { hasText: 'DocBench 앱' }).waitFor({ timeout: 12000 });
  const via = bar.locator('select[aria-label="어디로"]');
  await via.waitFor();
  assert.deepEqual(await via.locator('option').evaluateAll((os) => os.map((o) => o.value)), ['app', 'terminal']);
  assert.equal(await via.inputValue(), 'app', '연결된 앱이 먼저');
  await sendDrafts(page, { note: '운영자가 읽는 문서', model: 'opus', effort: 'high', n: 1 });
  const req = await until(() => page.evaluate(() => window.__simReqs[0]), 6000);
  assert.deepEqual([req.kind, req.model, req.effort, req.mode, req.runner, req.feedbackIds, req.note], ['handoff', 'opus', 'high', 'auto', 'app:dj-pc@sim', [fb.id], '운영자가 읽는 문서']);
  assert.equal(req.by.name, 'dj');
  assert.equal(JSON.parse((await readOpfs(page, name, '.docbench/feedback/' + fb.id + '.json')).toString()).waitingOn, 'assistant', '보낸 초안은 보냄으로');

  // 진행·결과: 작업 목록·로그·알림 → 결과는 "볼 것"(회차·붙인 말), 문서에 바뀐 글
  await page.locator('.db-run[data-state="done"]').waitFor({ timeout: 12000 });
  await page.locator('.db-runlog .db-ll.good', { hasText: '고침 —' }).first().waitFor();
  const done = page.locator('.db-toast', { hasText: 'Claude 가 끝냈습니다' });
  await done.waitFor({ timeout: 8000 });
  await done.getByRole('button', { name: '볼 것 보기' }).click();
  const card = page.locator(`.db-card[data-id="${fb.id}"].r-edit`);
  await card.waitFor({ timeout: 8000 });
  assert.match(await card.locator('.db-msg.assistant').innerText(), /확인 주기를 넣었습니다/);
  assert.match(await page.locator('.db-round', { hasText: '보낸 1개' }).innerText(), /운영자가 읽는 문서/, '회차 머리에 붙인 말');
  await page.locator('ins.db-chg-ins', { hasText: '5분마다' }).waitFor({ timeout: 10000 });
  await page.locator('.db-banner:not([hidden])').waitFor();
  assert.ok(await page.locator('.db-sec[data-changed] .db-badge.chg').count() >= 1);
  // 확인 → 끝남
  await cardBtn(card, '확인').click();
  await until(async () => JSON.parse((await readOpfs(page, name, '.docbench/feedback/' + fb.id + '.json')).toString()).status === 'resolved', 6000);
  // 로그 줄의 "보기" → 그 문서
  await page.locator('.db-runlog .db-ll.link .db-btn').first().click();

  // 왼쪽: 도구와 탐색기 — 문서가 없는 폴더도 펼치면 그 안의 파일이 보인다(문서가 아니라 흐리게)
  assert.equal(await page.locator('.db-tools .db-tool').count(), 3);
  if (await page.locator('.db-railview').count()) await page.locator('.db-railview button', { hasText: '폴더' }).click();
  await page.locator('.db-explorer .db-dir', { hasText: 'assets' }).click();
  await page.locator('.db-explorer .db-file', { hasText: 'logo.png' }).waitFor();
  await stopSim(page);
  assert.deepEqual(errors, []);
});

test('짝짓지 않은 연결은 저절로 고르지 않는다 — 내 것이면 고르고, 이 브라우저가 기억한다', async (t) => {
  const { page } = await newPage(t, base + '?pick&lang=ko');
  await page.waitForSelector('.db-sec');
  const name = await seed(page);
  await openOpfs(page, name, '김철수');
  await page.waitForSelector('.db-sec');
  await simRunner(page, name, { user: 'kimcs' });
  await page.locator('.db-claude, .db-tool[data-tool="claude"]').first().click();
  // 동료의 것일 수 있다 — 알리기만 하고 맡기지 않는다
  const notMine = page.locator('.db-dock-card.setup', { hasText: '내 것인지' });
  await notMine.waitFor({ timeout: 12000 });
  assert.match(await page.locator('.db-dock-state').innerText(), /내 것인지 확인 필요/);
  await notMine.getByRole('button', { name: '내 실행기로 쓰기' }).click();
  await page.locator('.db-dock-state.ok').waitFor({ timeout: 8000 });
  // 다시 열어도 고른 것을 쓴다
  await page.reload();
  await page.waitForSelector('.db-sec');
  await openOpfs(page, name, '김철수');
  await simRunner(page, name, { user: 'kimcs' });
  // 창은 열린 채로 기억된다(보기 상태) — 닫혀 있으면 연다
  if (await page.locator('.db-dock').isHidden()) await page.locator('.db-claude, .db-tool[data-tool="claude"]').first().click();
  await page.locator('.db-dock-state.ok').waitFor({ timeout: 12000 });
  await stopSim(page);
});

test('큰 폴더(드라이브·홈)를 열면 맨 위만 — 펼친 폴더만 읽고, 기록 폴더도 만들지 않는다', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.waitForSelector('.db-sec');
  const name = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const n = 'big-' + Math.random().toString(36).slice(2, 8);
    const d = await root.getDirectoryHandle(n, { create: true });
    const put = async (p, text) => { let x = d; const segs = p.split('/'); const f = segs.pop(); for (const s of segs) x = await x.getDirectoryHandle(s, { create: true }); const w = await (await x.getFileHandle(f, { create: true })).createWritable(); await w.write(text); await w.close(); };
    await put('Windows/System32/drivers.txt', 'x');
    await put('Program Files/App/readme.md', '# 앱 설명\n');
    await put('Users/dj/notes/회의.md', '# 주간 회의\n\n## 결정\n\n본문\n');
    await put('Users/dj/notes/메모.md', '# 메모\n');
    await put('맨위.md', '# 맨 위 문서\n');
    for (let i = 0; i < 60; i++) await put(`data/f${i}.bin`, 'x');
    return n;
  });
  const t0 = Date.now();
  await page.evaluate(async (n) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(n);
    await window.DocBenchStandalone.openWith(document.getElementById('app'), d, async () => { throw new Error('묻지 않아야 한다'); });
  }, name);
  assert.ok(Date.now() - t0 < 5000);
  await page.locator('.db-index-note', { hasText: '맨 위만' }).waitFor();
  const docsOf = () => page.evaluate(async () => Object.keys((await window.DocBenchStandalone.adapters.docs.manifest()).docs).sort());
  assert.deepEqual(await docsOf(), ['맨위.md'], '깊은 문서는 아직 읽지 않는다');
  // 탐색기: 폴더 → 펼치면 그 폴더만 읽는다
  await page.locator('.db-explorer .db-dir', { hasText: 'Users' }).click();
  await page.locator('.db-explorer .db-dir', { hasText: 'dj' }).click();
  await page.locator('.db-explorer .db-dir', { hasText: 'notes' }).click();
  await page.locator('.db-explorer .db-nav', { hasText: '회의' }).click();
  await page.locator('.db-doctitle', { hasText: '주간 회의' }).waitFor();
  // 탐색기 밖에서 파일을 만들면 창으로 돌아올 때 펼친 폴더를 다시 읽는다(큰 폴더는 감시하지 않는다)
  await page.evaluate(async (n) => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(n); for (const s of ['Users', 'dj', 'notes']) d = await d.getDirectoryHandle(s); const w = await (await d.getFileHandle('새 메모.md', { create: true })).createWritable(); await w.write('# 새 메모\n'); await w.close(); }, name);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.db-explorer .db-nav', { hasText: '새 메모' }).waitFor({ timeout: 5000 });
  // 다른 파일이 많은 폴더는 접어 둔다
  await page.locator('.db-explorer .db-dir', { hasText: 'data' }).click();
  await page.locator('.db-tree-more').waitFor();
  assert.ok(await page.locator('.db-explorer .db-file').count() <= 40);
  // 보기만 했다 — 문서 폴더에도 기록도 아무것도 생기지 않는다
  assert.deepEqual((await listOpfs(page, name, '')).sort(), ['Program Files', 'Users', 'Windows', 'data', '맨위.md'].sort());
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

test('기록 폴더는 처음 저장할 때 한 번 — 문서 폴더에는 아무것도 안 생기고, 다음 폴더는 묻지 않고, 안쪽 기록은 옮기고, 하위 폴더 기록은 합친다', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.waitForSelector('.db-sec');
  const home = 'home-' + Math.random().toString(36).slice(2, 8);
  const ls = (p) => page.evaluate(async (p) => { let d = await navigator.storage.getDirectory(); for (const s of p.split('/').filter(Boolean)) d = await d.getDirectoryHandle(s); const out = []; for await (const k of d.keys()) out.push(k); return out.sort(); }, p);
  const mkFolder = (p, files) => page.evaluate(async ([p, files]) => {
    let d = await navigator.storage.getDirectory();
    for (const s of p.split('/')) d = await d.getDirectoryHandle(s, { create: true });
    for (const [f, text] of Object.entries(files)) {
      let x = d; const segs = f.split('/'); const fn = segs.pop();
      for (const s of segs) x = await x.getDirectoryHandle(s, { create: true });
      const w = await (await x.getFileHandle(fn, { create: true })).createWritable(); await w.write(text); await w.close();
    }
  }, [p, files]);
  const openAt = (p, pick) => page.evaluate(async ([p, home, pick]) => {
    let d = await navigator.storage.getDirectory();
    for (const s of p.split('/')) d = await d.getDirectoryHandle(s);
    const hh = await (await navigator.storage.getDirectory()).getDirectoryHandle(home, { create: true });
    window.__open = window.DocBenchStandalone.openWith(document.getElementById('app'), d, pick ? async () => hh : async () => { throw new Error('묻지 않아야 한다'); });
    await window.__open;
  }, [p, home, pick]);
  const store = () => page.evaluate(() => document.querySelector('.db-rail-store')?.textContent || '');

  // 1) 처음 여는 폴더: 보기만 할 때는 아무것도 묻지도 만들지도 않는다
  const a = 'a-' + Math.random().toString(36).slice(2, 6);
  await mkFolder(a, { '메모.md': '# 메모\n\n## 할 일\n\n본문\n' });
  await openAt(a, true);
  await page.locator('.db-sec').first().waitFor();
  assert.deepEqual(await ls(a), ['메모.md']);
  assert.deepEqual(await ls(home), []);
  // 처음 적어 두는 순간(초안도 기록이다) 기록 자리를 묻는다 → 보관함 고르기
  const k = '메모 › 할 일';
  const cmp = await composer(page, k);
  const ta = cmp.locator('.db-cmp-ta:not(.rw)');
  await ta.fill('마감일을 적어 줘');
  const keep = cmp.locator('.db-cmp-f .db-btn.primary', { hasText: '초안에 두기' });
  await keep.click();
  const ask = page.locator('dialog.db-dialog[open] .db-ask', { hasText: '기록을 어디에 둘까요?' });
  await ask.waitFor();
  // 취소하면 쓰던 칸으로 돌아온다(글이 그대로) — 저장하지 않았다고 알린다
  await ask.getByRole('button', { name: '취소' }).click();
  await page.locator('.db-toast', { hasText: '기록 폴더를 고르지 않아' }).waitFor();
  assert.equal(await ta.inputValue(), '마감일을 적어 줘');
  assert.deepEqual(await ls(home), []);
  await keep.click();
  await ask.waitFor();
  await ask.getByRole('button', { name: '기록 보관함 고르기…' }).click();
  await cmp.waitFor({ state: 'detached' });
  await until(async () => (await ls(home)).includes(a) && (await ls(`${home}/${a}`)).includes('feedback'), 6000);
  assert.deepEqual(await ls(a), ['메모.md'], '문서 폴더에는 문서만');
  assert.deepEqual(await ls(home), ['docbench-home.json', a].sort());
  const saved = (await ls(`${home}/${a}/feedback`)).filter((f) => f.endsWith('.json'));
  assert.equal(saved.length, 1, '고른 뒤 그 초안이 저장된다');
  const draft = JSON.parse((await readOpfs(page, home, `${a}/feedback/${saved[0]}`)).toString());
  assert.deepEqual([draft.body, draft.status, draft.waitingOn], ['마감일을 적어 줘', 'draft', 'owner']);
  await until(async () => (await store()).includes(`${home}/${a}`), 4000);

  // 2) 다음 문서 폴더: 기억한 보관함으로 묻지 않고
  const b = 'b-' + Math.random().toString(36).slice(2, 6);
  await mkFolder(b, { '노트.md': '# 노트\n' });
  await openAt(b, false);
  await page.waitForFunction((n) => document.title.startsWith(n), b);
  const fid = await page.evaluate(async () => (await window.DocBenchStandalone.adapters.feedback.create({ docId: '노트.md', target: { kind: 'doc' }, body: '확인' })).id);
  assert.ok((await ls(`${home}/${b}/feedback`)).includes(fid + '.json'));
  assert.deepEqual(await ls(b), ['노트.md']);

  // 3) 예전 판처럼 안쪽 .docbench 가 있으면 그대로 쓰고, 옮기자고 한다 → 옮기면 안쪽은 지운다
  const name = await seed(page);
  await openAt(name, false);
  await page.waitForSelector('.db-sec');
  const toast = page.locator('.db-toast', { hasText: '문서 폴더 안(.docbench)' });
  await toast.waitFor();
  await toast.getByRole('button', { name: '기록 보관함으로 옮기기' }).click();
  await until(async () => !(await ls(name)).includes('.docbench'), 8000);
  assert.ok((await ls(home)).includes(name));
  assert.ok((await ls(`${home}/${name}`)).includes('config.json'), '설정도 옮긴다');
  assert.ok((await ls(`${home}/${name}`)).includes('docbench-data.json'));
  await until(async () => (await store()).includes(`${home}/${name}`), 6000);

  // 4) 이름이 같은 다른 문서 폴더('기획')는 따로: '기획', '기획 (2)' — 다시 열면 제 기록으로
  const pa = 'pa-' + Math.random().toString(36).slice(2, 6), pb = 'pb-' + Math.random().toString(36).slice(2, 6);
  await mkFolder(`${pa}/기획`, { '가.md': '# 가\n', '나.md': '# 나\n', '다.md': '# 다\n' });
  await mkFolder(`${pb}/기획`, { '라.md': '# 라\n', '마.md': '# 마\n', '바.md': '# 바\n' });
  const openSub = async (p) => { await openAt(p, false); await until(async () => /기록: /.test(await store()), 4000); return store(); };
  assert.match(await openSub(`${pa}/기획`), new RegExp(`${home}/기획$`));
  assert.match(await openSub(`${pb}/기획`), new RegExp(`${home}/기획 \\(2\\)$`));
  assert.match(await openSub(`${pa}/기획`), new RegExp(`${home}/기획$`), '다시 열면 제 기록');

  // 5) 하위 폴더를 따로 쓰던 기록 → 넓은 폴더를 열면 합치자고 한다
  const w = 'w-' + Math.random().toString(36).slice(2, 6);
  await mkFolder(`${w}/proj`, { '설계.md': '# 설계\n', '일정.md': '# 일정\n' });
  await mkFolder(w, { '개요.md': '# 개요\n' });
  await openAt(`${w}/proj`, false);
  const pf = await page.evaluate(async () => (await window.DocBenchStandalone.adapters.feedback.create({ docId: '설계.md', target: { kind: 'doc' }, body: '하위 폴더에서 단 피드백' })).id);
  await openAt(w, false);
  const mq = page.locator('dialog.db-dialog[open] .db-ask', { hasText: '"proj" 폴더의 기록을 합칠까요?' });
  await mq.waitFor({ timeout: 8000 });
  await mq.getByRole('button', { name: '합치기' }).click();
  await page.locator('.db-toast', { hasText: '합쳤습니다' }).waitFor();
  const rowsOf = () => page.evaluate(() => new Promise((res) => { let off = null; off = window.DocBenchStandalone.adapters.feedback.subscribe((rows) => { res(rows); setTimeout(() => off?.(), 0); }); }));
  let merged;
  await until(async () => (merged = (await rowsOf()).find((f) => f.id === pf)), 6000);
  assert.equal(merged.docId, 'proj/설계.md', '경로를 넓은 폴더 기준으로');
  const marker = JSON.parse((await readOpfs(page, home, 'proj/docbench-data.json')).toString());
  assert.equal(marker.mergedInto.to, w);
  // 하위 폴더를 다시 따로 열면: 새로 시작하고, 기록이 어디로 갔는지 알려 준다
  await openAt(`${w}/proj`, false);
  await page.locator('.db-toast', { hasText: `"${w}" 작업 공간에 합쳐졌습니다` }).waitFor();
  assert.deepEqual(errors, []);
});

test('터미널 한 줄(설치 없음): 요청·맥락·Claude 자리는 기록 폴더에만 → 결과 파일을 받아 볼 것으로 → 되돌리면 원래 바이트 그대로', async (t) => {
  const { page, errors } = await newPage(t, base + '?pick&lang=ko');
  await page.waitForSelector('.db-sec');
  const a = 'proj-' + Math.random().toString(36).slice(2, 6), home = 'home-' + Math.random().toString(36).slice(2, 6);
  const orig = '# 런북\r\n\r\n## 배포\r\n\r\n배포 전에 확인한다. 배포 후에도 확인한다. 그리고 다시 확인한다.\r\n\r\n## 롤백\r\n\r\n[TODO]\r\n';
  await page.evaluate((a) => navigator.storage.getDirectory().then((r) => r.getDirectoryHandle(a, { create: true })), a);
  await writeOpfs(page, a, '런북.md', orig);
  await page.evaluate(async ([a, home]) => {
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle(a), hh = await root.getDirectoryHandle(home, { create: true });
    await window.DocBenchStandalone.openWith(document.getElementById('app'), d, async () => hh);
  }, [a, home]);
  await page.waitForSelector('.db-sec');
  const ls = (p) => listOpfs(page, home, p).then((x) => x.sort()).catch(() => []);

  // 적어 두기 → 처음이라 기록 자리를 고른다 → 초안
  const cmp = await composer(page, '런북 › 배포');
  await cmp.locator('.db-cmp-quick .db-chip', { hasText: '줄이기' }).click();
  await cmp.locator('.db-cmp-f .db-btn.primary').click();
  await page.locator('dialog[open] .db-ask').getByRole('button', { name: '기록 보관함 고르기…' }).click();
  await cmp.waitFor({ state: 'detached' });
  const fid = (await ls(`${a}/feedback`)).find((n) => n.endsWith('.json')).replace(/\.json$/, '');

  // 앱이 없으면 보낼 곳은 터미널 한 줄 — 보내면 칠 한 줄이 뜬다(이 브라우저는 기록 폴더의 경로를 모른다 → 그 폴더에서 열라고 안내)
  await sendDrafts(page, { note: '짧게, 존댓말은 그대로', n: 1 });
  const term = page.locator('dialog[open] .db-term');
  await term.waitFor();
  const cmd = (await term.locator('.db-cmdbox').innerText()).trim();
  const id = /요청 (run-[\w-]+) /.exec(cmd)?.[1];
  assert.ok(id, cmd);
  assert.match(cmd, /^claude '/, '경로를 모르면 cd 없이 claude 만');
  assert.ok(cmd.includes(`runs/${id}.prompt.md`));
  assert.ok((await term.innerText()).includes(`기록 폴더 "${home}/${a}"`), "어느 기록 폴더에서 열지");
  // 경로를 모르는 브라우저: 기록 폴더 위치를 한 번 알려 주면 버튼 하나(Claude Code deep link) — 끝 폴더가 기록 폴더가 아니면 받지 않는다(문서 폴더에서 켜는 실수 방지)
  const where = term.locator('input[aria-label^="기록 폴더 위치"]');
  await where.fill('/home/dj/문서');
  await term.getByRole('button', { name: '이 경로로' }).click();
  await term.locator('.db-hint.warn', { hasText: '전체 경로가 아닙니다' }).waitFor();
  assert.equal(await term.locator('a.db-term-open').count(), 0);
  await where.fill(`/home/dj/${home}/${a}`);
  await term.getByRole('button', { name: '이 경로로' }).click();
  const deep = await term.locator('a.db-term-open').getAttribute('href');
  assert.ok(deep.startsWith('claude-cli://open?cwd=' + encodeURIComponent(`/home/dj/${home}/${a}`) + '&q=') && decodeURIComponent(deep).includes(id), deep);
  await term.locator('details > summary', { hasText: '열리지 않으면' }).click();
  assert.match(await term.locator('.db-cmdbox').innerText(), new RegExp(`^cd '/home/dj/${home}/${a}' && claude '`), '경로를 알면 칠 줄도 그 자리로');

  // 요청·맥락·지시와 Claude 자리(CLAUDE.md·권한)는 기록 폴더에만 — 문서 폴더에는 문서만
  const runs = await ls(`${a}/runs`);
  for (const f of [`${id}.req.json`, `${id}.prompt.md`, `${id}.ctx.json`]) assert.ok(runs.includes(f), f + ' ' + runs);
  assert.deepEqual(await listOpfs(page, a, ''), ['런북.md']);
  const req = JSON.parse((await readOpfs(page, home, `${a}/runs/${id}.req.json`)).toString());
  assert.deepEqual([req.kind, req.feedbackIds, req.note], ['handoff', [fid], '짧게, 존댓말은 그대로']);
  assert.match(req.runner, /^terminal:/);
  const promptMd = (await readOpfs(page, home, `${a}/runs/${id}.prompt.md`)).toString();
  assert.ok(promptMd.includes(`runs/${id}.result.json`) && promptMd.includes('더 짧고 간결하게') && promptMd.includes('짧게, 존댓말은 그대로'), '요청 파일에 결과 자리·요청·붙인 말');
  assert.ok((await readOpfs(page, home, `${a}/CLAUDE.md`)).toString().startsWith('<!-- docbench:room 1 -->'));
  const perm = JSON.parse((await readOpfs(page, home, `${a}/.claude/settings.json`)).toString()).permissions;
  assert.deepEqual(perm.allow, ['Edit(/runs/*.result.json)'], 'Claude 는 결과 파일만 쓴다');
  assert.ok(perm.deny.includes('Edit(/feedback/**)'));
  await term.getByRole('button', { name: '닫기' }).click();
  // 다시 열어도(목록에서) 같은 안내 — 화면이 아는 기록 자리로 붙인다(문서 폴더 이름으로 짐작하지 않는다)
  const listed = await page.evaluate(async (id) => (await window.DocBenchStandalone.adapters.runs.list(20)).find((r) => r.id === id)?.terminal, id);
  assert.deepEqual([listed.roomName, listed.command.sh], [`${home}/${a}`, cmd]);
  assert.match(listed.resume.sh, /^claude -c '/);
  // 보낸 것은 "보냄" — 터미널의 Claude 를 기다린다
  await page.locator('.db-tabs .tab-sent').click();
  await page.locator(`.db-card[data-id="${fid}"].t-assistant`, { hasText: '터미널의 Claude 를 기다리는 중' }).waitFor();

  // 터미널의 Claude 가 결과 파일만 남긴다 → 이 화면이 몇 초 안에 받아 반영 → 볼 것
  await writeOpfs(page, home, `${a}/runs/${id}.result.json`, JSON.stringify({ items: [{ feedbackId: fid, action: 'edit', text: '## 배포\n\n배포 전후로 확인한다.\n\n', message: '세 문장을 한 문장으로 줄였습니다.' }], summary: '배포 섹션을 줄였습니다.' }));
  await until(async () => (await page.locator('.db-pill.owner .n').innerText()) === '1', 15000);
  await openTab(page, 'review');
  const card = page.locator(`.db-card[data-id="${fid}"].r-edit`);
  await card.waitFor();
  assert.match(await card.innerText(), /한 문장으로 줄였습니다/);
  const after = (await readOpfs(page, a, '런북.md')).toString();
  assert.equal(after, '# 런북\r\n\r\n## 배포\r\n\r\n배포 전후로 확인한다.\r\n\r\n## 롤백\r\n\r\n[TODO]\r\n', '그 섹션만, 줄바꿈(CRLF)은 문서 그대로');
  const fb = JSON.parse((await readOpfs(page, home, `${a}/feedback/${fid}.json`)).toString());
  assert.deepEqual([fb.status, fb.waitingOn, fb.result.kind, fb.result.run], ['open', 'owner', 'edit', id]);
  assert.ok(fb.result.change?.from && fb.result.change?.to, '되돌릴 판을 적어 둔다');
  assert.ok((await ls(`${a}/runs`)).includes(`${id}.json`), '상태 파일');

  // 바뀐 곳 → 되돌리기: 고치기 전 바이트 그대로, 요청은 초안으로
  await cardBtn(card, '바뀐 곳').click();
  await card.locator('.db-diffslot .db-dl.add', { hasText: '배포 전후로 확인한다.' }).waitFor();
  await cardBtn(card, '되돌리기').click();
  await page.locator('.db-toast', { hasText: '요청은 초안으로 돌아왔습니다' }).waitFor();
  await until(async () => (await readOpfs(page, a, '런북.md')).equals(Buffer.from(orig)), 6000);
  const back = JSON.parse((await readOpfs(page, home, `${a}/feedback/${fid}.json`)).toString());
  assert.equal(back.status, 'draft');
  assert.ok(back.result.reverted);
  assert.deepEqual(await listOpfs(page, a, ''), ['런북.md'], '문서 폴더에는 끝까지 문서만');
  assert.deepEqual(errors, []);
});
