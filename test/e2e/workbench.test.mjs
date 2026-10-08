/**
 * 실제 브라우저(Chromium) + 실제 서버 + 임시 작업 폴더로 사람·AI 왕복을 확인한다.
 * 필요: npx playwright install chromium (한 번)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { startServer } from '../../server/index.mjs';
import { tempWorkspace, rm, until, fakeClaude, repo, pcFileFor } from '../server/helpers.mjs';

const run = promisify(execFile);
let dir, srv, browser, url;
const errors = [];
const fbFiles = async () => (await fs.readdir(path.join(dir, '.docbench/feedback'))).filter((f) => f.endsWith('.json'));
const readFb = async () => Promise.all((await fbFiles()).map(async (f) => JSON.parse(await fs.readFile(path.join(dir, '.docbench/feedback', f), 'utf8'))));
const cli = (...args) => run(process.execPath, [path.join(repo, 'bin/docbench.mjs'), ...args], { cwd: dir });

before(async () => {
  dir = await tempWorkspace(null, { assistant: { command: [process.execPath, fakeClaude], timeoutSec: 20 } });
  srv = await startServer({ root: dir, port: 0, pcConfigFile: pcFileFor(dir) });
  url = `http://127.0.0.1:${srv.port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await srv?.close(); await rm(dir); });

async function open(t, { width = 1360, height = 900, scheme = 'light', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  t.after(() => ctx.close());
  await page.goto(url + (hash ? '#' + encodeURIComponent(hash) : ''));
  await page.waitForSelector('.db-sec');
  return page;
}
const sec = (page, key) => page.locator(`.db-sec[data-key="${key}"]`);

test('접기 상태는 다시 열어도 남는다 (서버 보기 상태)', async (t) => {
  const key = '알림 서비스 질의응답 › 운영';
  let page = await open(t, { hash: 'docs/질의응답.md' });
  // 문서 설정 depth 2: h3 이하가 접혀 시작
  assert.equal(await sec(page, '알림 서비스 질의응답 › 구조 › 왜 큐를 하나만 쓰나요?').getAttribute('data-collapsed'), 'true');
  await sec(page, key).locator('> .db-sec-head .db-caret').click();
  assert.equal(await sec(page, key).getAttribute('data-collapsed'), 'true');
  await until(async () => {
    const files = await fs.readdir(path.join(dir, '.docbench/viewstate'));
    if (!files.length) return false;
    const vs = JSON.parse(await fs.readFile(path.join(dir, '.docbench/viewstate', files[0]), 'utf8'));
    return vs.docs?.['docs/질의응답.md']?.folds?.[key] === true;
  }, 5000);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.db-sec');
  assert.equal(await sec(page, key).getAttribute('data-collapsed'), 'true', '로컬 저장소를 지워도 서버 보기 상태로 복원');
});

test('접힌 섹션 통째로 피드백 → 파일 한 건, AI 차례', async (t) => {
  const page = await open(t, { hash: 'docs/질의응답.md' });
  const key = '알림 서비스 질의응답 › 구조 › 왜 큐를 하나만 쓰나요?';
  await sec(page, key).locator('> .db-sec-head').hover();
  await sec(page, key).locator('> .db-sec-head .db-act').first().click();
  const dlg = page.locator('dialog.db-dialog[open]');
  await dlg.locator('textarea').fill('하위 문답까지 한 번에 다듬어 줘');
  await dlg.locator('.db-btn.primary').click();
  await until(async () => (await readFb()).some((f) => f.body === '하위 문답까지 한 번에 다듬어 줘'));
  const f = (await readFb()).find((x) => x.body === '하위 문답까지 한 번에 다듬어 줘');
  assert.equal(f.waitingOn, 'assistant');
  assert.equal(f.wasCollapsed, true);
  assert.deepEqual(f.target.path, ['알림 서비스 질의응답', '구조', '왜 큐를 하나만 쓰나요?']);
  await page.locator(`.db-card[data-id="${f.id}"]`).waitFor();
});

test('문구 선택 피드백 → 인용 표시, 터미널(CLI) 회신이 화면에 바로', async (t) => {
  const page = await open(t, { hash: 'docs/설계-노트.md' });
  const p = sec(page, '알림 서비스 설계 노트 › 배경').locator('.db-sec-body p').first();
  await p.evaluate((el) => {
    const tn = el.firstChild; const i = tn.data.indexOf('중복 발송');
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + '중복 발송'.length);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.locator('.db-selbtn:not([hidden])').click();
  const dlg = page.locator('dialog.db-dialog[open]');
  await dlg.locator('textarea').fill('중복 발송 건수 근거?');
  await dlg.locator('.db-btn.primary').click();
  await page.locator('mark.db-fbq', { hasText: '중복 발송' }).waitFor();
  const f = (await readFb()).find((x) => x.body === '중복 발송 건수 근거?');
  assert.equal(f.selector.exact, '중복 발송');
  // 터미널의 Claude 가 CLI 로 되묻는다 → 화면 카드가 사람 차례로 바뀐다
  await cli('fb', 'reply', f.id, '-m', '장애 보고서 두 건이 근거입니다. 링크를 달까요?', '--ask');
  await page.locator(`.db-card[data-id="${f.id}"].t-owner`).waitFor({ timeout: 5000 });
  await page.locator(`.db-card[data-id="${f.id}"] .db-msg.assistant`, { hasText: '장애 보고서' }).waitFor();
});

test('섹션 편집 → 차이 미리보기 → 저장: 파일·이력·바뀐 섹션', async (t) => {
  const page = await open(t, { hash: 'docs/운영-런북.md' });
  const key = '알림 서비스 운영 런북 › 장애 대응 › 중복 발송';
  await sec(page, key).locator('> .db-sec-head').hover();
  await sec(page, key).locator('> .db-sec-head .db-act').nth(1).click();
  const area = page.locator('.db-editor textarea.db-ed-area');
  await area.waitFor();
  const v = await area.inputValue();
  assert.ok(v.startsWith('### 중복 발송'));
  await area.fill(v.replace('TODO: 멱등 키 확인 절차 정리', '멱등 키(요청 id)로 중복을 막는다.'));
  await page.locator('.db-editor .db-seg button').nth(2).click();
  await page.locator('.db-editor .db-diff .db-dl.add').first().waitFor();
  await page.locator('.db-editor textarea.db-ed-area').focus().catch(() => {});
  await page.locator('.db-editor .db-btn.primary').click();
  await until(async () => (await fs.readFile(path.join(dir, 'docs/운영-런북.md'), 'utf8')).includes('멱등 키(요청 id)'));
  const ch = (await fs.readFile(path.join(dir, '.docbench/changes.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual(ch.sections, [key]);
  assert.equal(ch.by.kind, 'human');
  await page.locator('.db-editor').waitFor({ state: 'detached' });
});

test('AI 제안(헤드리스 claude) → 차이 보고 적용 → 문서 반영·해결', async (t) => {
  const page = await open(t, { hash: 'docs/설계-노트.md' });
  const created = JSON.parse((await cli('fb', 'add', '--as', 'human:dj', '--doc', 'docs/설계-노트.md', '--section', '알림 서비스 설계 노트 › 구조 › 메모', '-m', '근거 한 줄 보강', '--json')).stdout);
  const card = page.locator(`.db-card[data-id="${created.id}"]`);
  await card.waitFor({ timeout: 5000 });
  await card.locator('.db-c-act .db-btn', { hasText: '제안' }).click();
  await card.locator('.db-prop .db-dl.add, .db-diff .db-dl.add').first().waitFor({ timeout: 15000 });
  await card.locator('.db-btn.primary', { hasText: '적용' }).click();
  await until(async () => (await fs.readFile(path.join(dir, 'docs/설계-노트.md'), 'utf8')).includes('(제안) 한 줄 추가'), 6000);
  await until(async () => (await readFb()).find((x) => x.id === created.id).status === 'resolved', 6000);
  const md = await fs.readFile(path.join(dir, 'docs/설계-노트.md'), 'utf8');
  assert.equal(md.split('(제안) 한 줄 추가').length, 2, '정확히 한 번, 그 섹션에만');
  assert.ok(md.indexOf('(제안) 한 줄 추가') < md.indexOf('## 위험'));
});

test('편집 중 다른 섹션이 바뀌면 최신본에 다시 적용, 같은 섹션이면 겹침 안내', async (t) => {
  const page = await open(t, { hash: 'docs/질의응답.md' });
  const key = '알림 서비스 질의응답 › 일정 › 언제 전환하나요?';
  await page.locator('.db-seg button').last().click(); // 전부 펼치기
  await sec(page, key).locator('> .db-sec-head').hover();
  await sec(page, key).locator('> .db-sec-head .db-act').nth(1).click();
  const area = page.locator('.db-editor textarea.db-ed-area');
  await area.fill((await area.inputValue()).replace('11월 중', '11월 둘째 주'));
  // 그 사이 터미널에서 다른 섹션을 고친다
  const other = path.join(dir, 'other.md');
  await fs.writeFile(other, '### 재시도는 몇 번 하나요?\n\n최대 5회, 지수 백오프에 상한 10분입니다 [실측]. 설정은 런북 참조.\n');
  const ver = async () => JSON.parse((await cli('doc', 'show', 'docs/질의응답.md', '--json')).stdout).version;
  await cli('doc', 'write', 'docs/질의응답.md', '--section', '알림 서비스 질의응답 › 구조 › 재시도는 몇 번 하나요?', '--file', other, '--base', await ver(), '-m', '런북 참조');
  await page.locator('.db-editor .db-btn.primary').click();
  await until(async () => { const s = await fs.readFile(path.join(dir, 'docs/질의응답.md'), 'utf8'); return s.includes('11월 둘째 주') && s.includes('런북 참조'); }, 6000);

  // 같은 섹션 충돌
  await sec(page, key).locator('> .db-sec-head').hover();
  await sec(page, key).locator('> .db-sec-head .db-act').nth(1).click();
  await area.fill((await area.inputValue()).replace('11월 둘째 주', '11월 셋째 주'));
  await fs.writeFile(other, '### 언제 전환하나요?\n\n시범 10/20~10/31, 전체 전환은 12월입니다.\n');
  await cli('doc', 'write', 'docs/질의응답.md', '--section', key, '--file', other, '--base', await ver());
  await page.locator('.db-editor .db-btn.primary').click();
  await page.locator('.db-editor .db-ed-msg:not([hidden])', { hasText: '같은 섹션' }).waitFor({ timeout: 5000 });
  const s = await fs.readFile(path.join(dir, 'docs/질의응답.md'), 'utf8');
  assert.ok(s.includes('12월') && !s.includes('셋째 주'), '말없이 덮어쓰지 않는다');
});

test('밖에서 고친 문서: 화면이 다시 읽고 바뀐 섹션 표시', async (t) => {
  const page = await open(t, { hash: 'README.md' });
  await fs.appendFile(path.join(dir, 'README.md'), '\n## 새 절\n\n에디터에서 추가.\n');
  await page.locator('.db-sec[data-key="예제 작업 폴더 › 새 절"]').waitFor({ timeout: 6000 });
  await page.locator('.db-sec[data-key="예제 작업 폴더 › 새 절"][data-changed="new"]').waitFor({ timeout: 3000 });
});

test('터미널의 Claude 가 CLI 로 고친 문서: 화면이 가만히 있어도 다시 읽는다', async (t) => {
  const page = await open(t, { hash: 'docs/운영-런북.md' });
  const cur = JSON.parse((await cli('doc', 'show', 'docs/운영-런북.md', '--json')).stdout);
  const next = path.join(dir, 'next.md');
  await fs.writeFile(next, cur.text.replace(/\n*$/, '\n\n## CLI 로 더한 절\n\nClaude 가 추가.\n'));
  await cli('doc', 'write', 'docs/운영-런북.md', '--file', next, '-m', 'CLI 추가');
  // CLI 는 새 판을 state.json 에 먼저 적으므로 '외부 편집'이 아니다 — 그래도 화면은 따라와야 한다
  await page.locator('.db-sec[data-key="알림 서비스 운영 런북 › CLI 로 더한 절"]').waitFor({ timeout: 6000 });
});

test('<doc-bench> 요소: 대시보드 패널 높이를 채우고 긴 문서는 안에서 스크롤 (시험 이식에서 발견)', async (t) => {
  const page = await open(t, { hash: 'docs/질의응답.md' });
  await page.evaluate(() => {
    window.docbench.destroy();
    document.body.innerHTML = '<div id="panel" style="height:510px;display:flex;flex-direction:column"><h2 style="margin:0">문서</h2><doc-bench api="/api" doc="docs/질의응답.md" style="flex:1;min-height:0"></doc-bench></div>';
  });
  await page.waitForSelector('doc-bench .db-sec');
  await page.locator('doc-bench .db-seg button').last().click();   // 전부 펼쳐 문서를 길게
  const m = await page.evaluate(() => {
    const el = document.querySelector('doc-bench');
    const main = el.querySelector('.db-main');
    main.scrollTop = 200;
    return { display: getComputedStyle(el).display, elH: el.getBoundingClientRect().height, panelBottom: document.getElementById('panel').getBoundingClientRect().bottom, elBottom: el.getBoundingClientRect().bottom, scrollable: main.scrollHeight > main.clientHeight, scrolled: main.scrollTop > 0 };
  });
  assert.equal(m.display, 'flex');
  assert.ok(Math.abs(m.elBottom - m.panelBottom) < 1, '패널 아래까지 채움 ' + JSON.stringify(m));
  assert.ok(m.scrollable && m.scrolled, '긴 문서는 작업대 안에서 스크롤 ' + JSON.stringify(m));
});

test('좁은 칸(380px)·어두운 테마: 가로 넘침 없음', async (t) => {
  for (const [width, scheme] of [[380, 'light'], [760, 'dark'], [1360, 'dark']]) {
    const page = await open(t, { width, scheme, hash: 'docs/설계-노트.md' });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(over, 0, `${width}px ${scheme}`);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.docbench')).backgroundColor);
    if (scheme === 'dark') assert.notEqual(bg, 'rgb(244, 246, 243)', '어두운 배경');
  }
});

test('대시보드 전역 CSS 가 작업대 안으로 새지 않는다', async (t) => {
  const ref = await open(t, { hash: 'docs/설계-노트.md' });
  const probe = (page) => page.evaluate(() => {
    const cs = (sel, props) => { const e = document.querySelector(sel); const c = getComputedStyle(e); return props.map((p) => c[p]); };
    return {
      head: cs('.db-dochead', ['display', 'paddingTop', 'backgroundColor']),
      h2: cs('.db-sec[data-level="2"] > .db-sec-head h2', ['fontSize', 'borderBottomWidth', 'letterSpacing', 'textTransform']),
      btn: cs('.db-toolbar .db-btn', ['borderRadius', 'backgroundColor', 'textTransform']),
      li: cs('.db-md li', ['cssFloat']),
    };
  });
  const want = await probe(ref);
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const hostile = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="assets/docbench.css">
    <style>
      * { letter-spacing: .2em; text-transform: uppercase; }
      header { display: flex; gap: 40px; padding: 30px; background: rgb(255, 0, 0); }
      h2 { font-size: 40px; border-bottom: 5px solid red; }
      .card h2, .card section h2 { letter-spacing: 1em; }
      button { border-radius: 0; background: rgb(255, 0, 0); }
      li { float: left; }
    </style></head>
    <body><div class="card" style="height:860px"><doc-bench api="/api" doc="docs/설계-노트.md"></doc-bench></div>
    <script src="assets/docbench.iife.js"></script></body></html>`;
  await page.route(url + 'host.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: hostile }));
  await page.goto(url + 'host.html');
  await page.waitForSelector('doc-bench .db-sec');
  assert.deepEqual(await probe(page), want);
});

test('브라우저 오류 없음', () => {
  assert.deepEqual(errors, []);
});
