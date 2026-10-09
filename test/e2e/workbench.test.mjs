/**
 * 실제 브라우저(Chromium) + 실제 서버 + 임시 작업 폴더로 사람·AI 왕복을 확인한다.
 * 검토 회차(0.6.0): 그 자리에서 적기(초안) → 고른 초안을 붙일 말과 함께 한 번에 보내기(서버 엔진·터미널 한 줄) →
 * 결과는 "볼 것"(고침·제안·질문) → 되돌리기·적용·확인. Claude 는 test/fixtures/fake-claude.mjs 가 대신한다.
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
const reqFiles = async () => (await fs.readdir(path.join(dir, '.docbench/runs')).catch(() => [])).filter((n) => n.endsWith('.req.json')).sort();
/** 문서 도구 막대의 깊이(목차·전부…) — 검토 패널의 보내기 막대에도 .db-seg 가 있다 */
const depth = (root) => root.locator('.db-toolbar .db-seg button');

/** 섹션 옆 말풍선 → 그 자리의 적는 칸(.db-cmp) */
async function composer(page, key) {
  const head = sec(page, key).locator('> .db-sec-head');
  await head.hover();
  await head.locator('.db-act').first().click();
  const cmp = page.locator('.db-cmp');
  await cmp.waitFor();
  return cmp;
}
/** 적어 두기: 요청을 쓰고 Ctrl+Enter(초안에 두기) → 디스크의 그 초안 */
async function jot(page, key, text) {
  const cmp = await composer(page, key);
  const ta = cmp.locator('.db-cmp-ta:not(.rw)');
  await ta.fill(text);
  await ta.press('Control+Enter');
  await cmp.waitFor({ state: 'detached' });
  let f;
  await until(async () => (f = (await readFb()).find((x) => x.body === text)), 5000);
  return f;
}
/** 카드 아래 단추(이름이 정확히 같은 것 — 섹션 이름 단추와 헷갈리지 않게) */
const cardBtn = (card, label) => card.locator('.db-c-act button', { hasText: new RegExp(`^\\s*${label}\\s*$`) });
/**
 * 초안 탭의 보내기 막대: ids 만 고르고(다른 시험이 남긴 초안은 빼고) 반영 방식·어디로·붙일 말·모델을 정해 한 번에 보낸다
 */
async function sendDrafts(page, { ids, mode, via, note, model } = {}) {
  await page.locator('.db-pill.draft').click();
  const bar = page.locator('.db-sendbar');
  await bar.waitFor();
  if (ids) {
    await page.locator('.db-dtools button', { hasText: '하나도 안 고름' }).click();
    for (const id of ids) await page.locator(`.db-card[data-id="${id}"] .db-pick`).check();
  }
  if (mode) await bar.locator('.db-seg button', { hasText: mode === 'propose' ? '제안만' : '바로 고치기' }).click();
  if (via) await bar.locator('select[aria-label="어디로"]').selectOption(via);
  if (note != null) await bar.locator('.db-note').fill(note);
  if (model) {
    await bar.locator('details.db-adv > summary').click();
    await bar.locator('.db-adv .db-dock-opt select').nth(0).selectOption(model);
  }
  const go = bar.locator('.db-sendbtn');
  if (ids) assert.equal((await go.innerText()).trim(), `${ids.length}개 보내기`);
  await go.click();
}

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

test('접힌 섹션 통째로 적기 → 초안 파일 한 건 — 보내기 전에는 Claude 에게 아무것도 가지 않는다', async (t) => {
  const page = await open(t, { hash: 'docs/질의응답.md' });
  const key = '알림 서비스 질의응답 › 구조 › 왜 큐를 하나만 쓰나요?';
  const reqs0 = await reqFiles();
  const f = await jot(page, key, '하위 문답까지 한 번에 다듬어 줘');
  assert.deepEqual([f.status, f.waitingOn], ['draft', 'owner']);
  assert.equal(f.wasCollapsed, true);
  assert.deepEqual(f.target.path, ['알림 서비스 질의응답', '구조', '왜 큐를 하나만 쓰나요?']);
  await page.locator(`.db-card[data-id="${f.id}"].t-draft`).waitFor();
  assert.deepEqual(await reqFiles(), reqs0, '초안은 요청을 만들지 않는다');
  assert.equal(await page.locator('.db-pill.draft .n').innerText(), '1');
});

test('문구 선택 → 적는 칸(인용) → 초안 표시 → 터미널 한 줄로 보냄 → 터미널(CLI) 회신이 볼 것에 바로', async (t) => {
  const page = await open(t, { hash: 'docs/설계-노트.md' });
  const p = sec(page, '알림 서비스 설계 노트 › 배경').locator('.db-sec-body p').first();
  await p.evaluate((el) => {
    const tn = el.firstChild; const i = tn.data.indexOf('중복 발송');
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + '중복 발송'.length);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.locator('.db-selbtn:not([hidden])').click();
  const cmp = page.locator('.db-cmp');
  await cmp.waitFor();
  assert.equal(await cmp.locator('.db-cmp-q').innerText(), '중복 발송');
  await cmp.locator('.db-cmp-ta:not(.rw)').fill('중복 발송 건수 근거?');
  await cmp.locator('.db-cmp-ta:not(.rw)').press('Control+Enter');
  await page.locator('mark.db-fbq.draft', { hasText: '중복 발송' }).waitFor();
  let f;
  await until(async () => (f = (await readFb()).find((x) => x.body === '중복 발송 건수 근거?')));
  assert.deepEqual([f.selector.exact, f.status], ['중복 발송', 'draft']);
  // 초안은 아직 사람의 메모 — 터미널의 Claude 가 CLI 로 회신할 수 없다
  await assert.rejects(cli('fb', 'reply', f.id, '-m', '미리 답'), (e) => /초안은 아직 보내지 않은/.test(e.stderr));

  // 터미널 한 줄로 보낸다 — 서버는 기록 폴더의 경로를 알아 그 자리로 옮겨 켜는 한 줄을 준다
  await sendDrafts(page, { ids: [f.id], via: 'terminal' });
  const term = page.locator('dialog[open] .db-term');
  await term.waitFor();
  const cmd = await term.locator('.db-cmdbox').innerText();
  const id = /요청 (run-[\w-]+) /.exec(cmd)?.[1];
  assert.ok(id && cmd.includes(path.join(dir, '.docbench')), cmd);
  for (const x of ['.req.json', '.prompt.md', '.ctx.json']) await fs.access(path.join(dir, '.docbench/runs', id + x));
  assert.match(JSON.parse(await fs.readFile(path.join(dir, '.docbench/runs', id + '.req.json'), 'utf8')).runner, /^terminal:/);
  await term.getByRole('button', { name: '닫기' }).click();
  assert.equal((await readFb()).find((x) => x.id === f.id).waitingOn, 'assistant', '보냄');

  // 터미널의 Claude 가 CLI 로 되묻는다 → 화면 카드가 "볼 것"의 질문으로
  await cli('fb', 'reply', f.id, '-m', '장애 보고서 두 건이 근거입니다. 링크를 달까요?', '--ask');
  await page.locator('.db-pill.owner').click();
  await page.locator(`.db-card[data-id="${f.id}"].r-ask .db-msg.assistant`, { hasText: '장애 보고서' }).waitFor({ timeout: 5000 });
  const g = (await readFb()).find((x) => x.id === f.id);
  assert.deepEqual([g.status, g.waitingOn, g.result.kind], ['open', 'owner', 'ask'], '끝내는 것은 사람 — 볼 것에 남는다');
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

test('제안만으로 보내기(헤드리스 claude) → 볼 것의 제안 차이 → 적용 → 그 섹션에 한 번 반영·끝남', async (t) => {
  const page = await open(t, { hash: 'docs/설계-노트.md' });
  const file = path.join(dir, 'docs/설계-노트.md');
  const f = await jot(page, '알림 서비스 설계 노트 › 구조 › 메모', '근거 한 줄 보강');
  await sendDrafts(page, { ids: [f.id], mode: 'propose', via: 'app' });
  const done = page.locator('.db-toast', { hasText: 'Claude 가 끝냈습니다' });
  await done.waitFor({ timeout: 15000 });
  assert.match(await done.innerText(), /제안 1/);
  await done.getByRole('button', { name: '볼 것 보기' }).click();
  const card = page.locator(`.db-card[data-id="${f.id}"].r-propose`);
  await card.locator('.db-prop .db-dl.add', { hasText: '(제안) 한 줄 추가' }).first().waitFor({ timeout: 8000 });
  assert.ok(!(await fs.readFile(file, 'utf8')).includes('(제안) 한 줄 추가'), '제안만 — 문서는 그대로');
  await cardBtn(card, '적용').click();
  await until(async () => (await fs.readFile(file, 'utf8')).includes('(제안) 한 줄 추가'), 6000);
  await until(async () => { const g = (await readFb()).find((x) => x.id === f.id); return g.status === 'resolved' && g.proposal?.state === 'applied'; }, 6000);
  const md = await fs.readFile(file, 'utf8');
  assert.equal(md.split('(제안) 한 줄 추가').length, 2, '정확히 한 번, 그 섹션에만');
  assert.ok(md.indexOf('(제안) 한 줄 추가') < md.indexOf('## 위험'));
});

test('검토 회차(서버 엔진): 초안이 모여도 보내지 않는다 → 붙일 말·모델과 함께 한 번에 → 볼 것(고침·바뀐 곳, 누가: Claude) → 되돌리면 그 섹션 글만 돌아오고 초안으로 → 확인하면 끝남', async (t) => {
  const page = await open(t, { hash: 'docs/운영-런북.md' });
  const file = path.join(dir, 'docs/운영-런북.md');
  const kA = '알림 서비스 운영 런북 › 연락처', kB = '알림 서비스 운영 런북 › 배포 전 확인';
  const reqs0 = await reqFiles();
  // 1) 읽으며 적는다 — 초안만 쌓이고 아무 요청도 생기지 않는다
  const a = await jot(page, kA, '연락처 형식을 맞춰 줘');
  const b = await jot(page, kB, '확인 순서를 정리해 줘');
  assert.deepEqual([a.status, b.status, a.waitingOn, b.waitingOn], ['draft', 'draft', 'owner', 'owner']);
  assert.deepEqual(await reqFiles(), reqs0, '적기만 해서는 아무것도 가지 않는다');
  assert.equal(await page.locator('.db-tabs .tab-sent .n').innerText(), '0');
  const orig = await fs.readFile(file, 'utf8');

  // 2) 고른 둘을 붙일 말·모델과 함께 한 번에 — 요청 하나
  await sendDrafts(page, { ids: [a.id, b.id], mode: 'auto', via: 'app', note: '표 모양은 그대로', model: 'haiku' });
  await page.locator('.db-toast', { hasText: '2개를 보냈습니다.' }).waitFor();
  const reqName = await until(async () => (await reqFiles()).find((n) => !reqs0.includes(n)), 5000);
  const req = JSON.parse(await fs.readFile(path.join(dir, '.docbench/runs', reqName), 'utf8'));
  assert.deepEqual([req.kind, req.mode, req.model, req.note, [...req.feedbackIds].sort()], ['handoff', 'auto', 'haiku', '표 모양은 그대로', [a.id, b.id].sort()]);

  // 3) 끝나면 결과는 "볼 것" — 한 회차(보낸 2개·붙인 말), 둘 다 고침. 엔진은 끝내지 않는다(사람이 확인)
  const done = page.locator('.db-toast', { hasText: 'Claude 가 끝냈습니다' });
  await done.waitFor({ timeout: 15000 });
  assert.match(await done.innerText(), /고침 2/);
  await done.getByRole('button', { name: '볼 것 보기' }).click();
  assert.match(await page.locator('.db-round', { hasText: '보낸 2개' }).innerText(), /표 모양은 그대로/);
  const cardA = page.locator(`.db-card[data-id="${a.id}"].r-edit`), cardB = page.locator(`.db-card[data-id="${b.id}"].r-edit`);
  await cardA.waitFor();
  await cardB.waitFor();
  for (const x of [a, b]) {
    const g = (await readFb()).find((y) => y.id === x.id);
    assert.deepEqual([g.status, g.waitingOn, g.result.kind, g.result.run], ['open', 'owner', 'edit', req.id]);
    assert.ok(g.result.change?.from && g.result.change?.to, '되돌릴 판을 적어 둔다');
  }
  const mid = await fs.readFile(file, 'utf8');
  assert.equal(mid.split('(고침) 한 줄 추가').length, 3, '두 섹션에 하나씩');
  // 문서에 바뀐 글(누가: Claude)
  await page.locator('ins.db-chg-ins', { hasText: '한 줄 추가' }).first().waitFor({ timeout: 8000 });
  await page.locator(`.db-sec[data-key="${kA}"] .db-badge.chg`, { hasText: 'Claude' }).waitFor({ timeout: 6000 });
  await page.locator('.db-banner:not([hidden])', { hasText: 'Claude' }).waitFor();
  // Claude 창: 서버 엔진·진행 로그
  await page.locator('.db-claude').click();
  await page.locator('.db-dock-state.ok', { hasText: '서버' }).waitFor({ timeout: 8000 });
  await page.locator('.db-run[data-state="done"]').first().waitFor();
  await page.locator('.db-runlog .db-ll.good', { hasText: '고침 —' }).first().waitFor();

  // 4) 바뀐 곳 → 되돌리기(A): 그 섹션만 고치기 전 글로, 요청은 초안으로 — B 는 그대로
  await cardBtn(cardA, '바뀐 곳').click();
  await cardA.locator('.db-diffslot .db-dl.add', { hasText: '(고침) 한 줄 추가' }).waitFor();
  await cardBtn(cardA, '되돌리기').click();
  await page.locator('.db-toast', { hasText: '요청은 초안으로 돌아왔습니다' }).waitFor();
  let after;
  await until(async () => (after = await fs.readFile(file, 'utf8')).split('(고침) 한 줄 추가').length === 2, 6000);
  const { core } = await import('../../server/core.mjs');
  assert.equal(core.getSectionText(after, kA), core.getSectionText(orig, kA), 'A 는 고치기 전 글 그대로');
  assert.equal(core.getSectionText(after, kB), core.getSectionText(mid, kB), 'B 는 Claude 가 고친 그대로');
  assert.equal(after.replace(core.getSectionText(mid, kB), core.getSectionText(orig, kB)), orig, '되돌린 곳 말고는 한 글자도 그대로');
  const ga = (await readFb()).find((x) => x.id === a.id);
  assert.equal(ga.status, 'draft');
  assert.ok(ga.result.reverted);
  const ch = (await fs.readFile(path.join(dir, '.docbench/changes.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual([ch.by.kind, ch.sections, ch.feedbackIds], ['human', [kA], [a.id]], '되돌림도 이력에 — 사람이, 그 섹션');

  // 5) 확인(B) → 끝남
  await cardBtn(cardB, '확인').click();
  await until(async () => (await readFb()).find((x) => x.id === b.id).status === 'resolved', 6000);
  await page.locator('.db-tabs .tab-done').click();
  await page.locator(`.db-card[data-id="${b.id}"].t-resolved`).waitFor();
  const st = await (await fetch(url + 'api/runs/status')).json();
  assert.equal(st.runner.kind, 'server');
});

test('Claude 검토(서버 엔진): 먼저 읽고 제안·질문을 볼 것에 → 제안 적용·질문 닫기 / 읽기 정리는 내 화면 접기만(문서 그대로)', async (t) => {
  const page = await open(t, { hash: 'docs/설계-노트.md' });
  const file = path.join(dir, 'docs/설계-노트.md');
  const before = await fs.readFile(file, 'utf8');
  await page.locator('.db-review-btn').click();
  const dlg = page.locator('dialog[open]', { has: page.locator('.db-radios') });
  await dlg.waitFor();
  await dlg.locator('.db-sheet-act .db-btn.primary', { hasText: '부탁하기' }).click();
  const done = page.locator('.db-toast', { hasText: 'Claude 검토 끝' });
  await done.waitFor({ timeout: 15000 });
  await done.getByRole('button', { name: '볼 것 보기' }).click();
  assert.equal(await fs.readFile(file, 'utf8'), before, '검토는 문서를 바꾸지 않는다');
  const sugg = page.locator('.db-card.r-suggest', { hasText: '한 줄 요약 더하기' });
  const ques = page.locator('.db-card.r-question', { hasText: '기준이 무엇인가요?' });
  await sugg.waitFor();
  await ques.waitFor();
  assert.match(await page.locator('.db-round', { hasText: 'Claude 검토' }).innerText(), /먼저 읽었습니다/, '회차 머리에 총평');
  await sugg.locator('.db-prop .db-dl.add', { hasText: '(선제안) 요약 한 줄' }).waitFor();
  await cardBtn(sugg, '적용').click();
  await until(async () => (await fs.readFile(file, 'utf8')).includes('(선제안) 요약 한 줄'), 6000);
  await cardBtn(ques, '닫기').click();
  await until(async () => { const rows = (await readFb()).filter((f) => f.author.kind === 'assistant' && f.docId === 'docs/설계-노트.md'); return rows.length === 2 && rows.every((f) => f.status === 'resolved'); }, 6000);

  // 읽기 정리: 문서는 그대로, 내 화면만 — 마지막 섹션 먼저, 나머지는 접고 안내 한 줄
  const md = await fs.readFile(file, 'utf8');
  await page.locator('.db-review-btn').click();
  await dlg.waitFor();
  await dlg.locator('input[value="view"]').check();
  await dlg.locator('.db-sheet-act .db-btn.primary').click();
  await page.locator('.db-toast', { hasText: '읽기 정리를 적용했습니다' }).waitFor({ timeout: 15000 });
  await page.locator('.db-guide:not([hidden])', { hasText: '일정 부터 읽으세요.' }).waitFor();
  assert.equal(await sec(page, '알림 서비스 설계 노트 › 배경').getAttribute('data-collapsed'), 'true');
  assert.equal(await sec(page, '알림 서비스 설계 노트 › 일정').getAttribute('data-collapsed'), 'false');
  assert.equal(await fs.readFile(file, 'utf8'), md, '읽기 정리는 문서를 바꾸지 않는다');
  // 되돌리기 → 접기 전으로
  await page.locator('.db-toast').getByRole('button', { name: '원래대로' }).click();
  await until(async () => (await sec(page, '알림 서비스 설계 노트 › 배경').getAttribute('data-collapsed')) === 'false', 4000);
});

test('편집 중 다른 섹션이 바뀌면 최신본에 다시 적용, 같은 섹션이면 겹침 안내', async (t) => {
  const page = await open(t, { hash: 'docs/질의응답.md' });
  const key = '알림 서비스 질의응답 › 일정 › 언제 전환하나요?';
  await depth(page).last().click(); // 전부 펼치기
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
  await depth(page.locator('doc-bench')).last().click();   // 전부 펼쳐 문서를 길게
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
