// README 의 화면 사진을 다시 찍는다 → docs/images/<말>-<장면>.png
//   npm run build && node scripts/screenshots.mjs          (Playwright Chromium — npx playwright install chromium 한 번)
// 장면: overview(작업 공간 개요 — 팀 규칙·점검·메타데이터) · review(문서 + 말풍선 + 검토 패널) · formats(YAML 키 섹션)
// ko 는 예제 작업 폴더(examples/sample-workspace)에 몇 가지를 더하고, en 은 아래의 영어 예제를 임시 폴더에 만든다.
// 어느 쪽도 저장소의 예제 폴더를 고치지 않는다(임시 폴더에 복사).
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../server/index.mjs';
import * as core from '../dist/core.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repo, 'docs/images');
const VIEW = { width: 1280, height: 800 };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const KEY_SEP = ' › ';

/** 장면마다 쓸 글 */
const L = {
  ko: {
    folder: '알림-서비스-문서',
    person: { user: 'haneul', name: '김하늘' },
    /** 오래전에 고친 것으로 둘 파일(검토 주기 점검이 보이게 — 실제로는 git 커밋 시각) */
    old: { 'policies/보존-정책.md': '2025-02-03' },
    files: {
      'docs/설계-노트.md': null, // 예제 그대로
      'docs/배포-계획.md': `---\nstatus: review\nowner: 김하늘\ntags: [배포, 알림]\nreview: ${day(9)}\n---\n# 배포 계획\n\n## 단계\n\n1. 스테이징에서 부하 시험\n2. 10% 카나리\n3. 전체 배포\n\n## 되돌리기\n\n카나리 오류율이 1% 를 넘으면 바로 되돌린다.\n`,
      'policies/보존-정책.md': `---\nstatus: approved\nowner: 보안팀\nreviewed: 2025-02-03\n---\n# 알림 기록 보존 정책\n\n발송 기록은 90일 보관한다.\n`,
      'config/app.yaml': '# 알림 서비스 설정\nserver:\n  port: 8080\n  tls:\n    enabled: true\nretry:\n  max: 5\n  backoff: exponential\nproviders:\n  - mail\n  - messenger\n  - sms\n',
      'notes/회의록 최종 (1).md': '# 회의록\n',
    },
    rules: {
      $schema: 'https://raw.githubusercontent.com/d-j-lee/docbench/main/docs/docbench.schema.json',
      ignore: ['notes/옛-회의록.md'],
      rules: [
        { kind: 'front-matter', name: '문서 앞머리', paths: ['docs/**', 'policies/**'], keys: ['owner', 'status'], values: { status: ['draft', 'review', 'approved'] }, hint: '담당(owner)과 상태(status)를 맨 위 앞머리에 — 개요에서 상태·담당별로 모입니다.' },
        { kind: 'naming', paths: ['**'], style: ['no-spaces', 'no-version-marks'], hint: '공백·판 표시(_v2·최종·(1)) 없이 — 판은 변경 이력이 맡습니다.' },
        { kind: 'review', name: '정책 검토 주기', paths: ['policies/**'], days: 180, level: 'risk' },
      ],
    },
    review: { doc: 'docs/설계-노트.md' },
    feedback: [
      { section: '배경', body: '재시도 폭주가 원인이라는 근거(장애 보고서 링크)를 붙여 주세요.', status: 'draft', category: 'fact' },
      { section: '목표와 비목표', body: '큐를 하나로 합칠 때 순서 보장이 필요한지 적어 주세요.', status: 'draft', category: 'gap', severity: 'high' },
      { section: '채널 공급자 장애', title: '완화 시점이 비었습니다', body: '공급자 장애의 완화 시점이 [작업 후 기입] 으로 남아 있습니다. 운영 런북의 기준과 맞출까요?', assistant: true, category: 'gap', severity: 'medium' },
    ],
    formats: 'config/app.yaml',
  },
  en: {
    folder: 'payments-docs',
    person: { user: 'hana', name: 'Hana Kim' },
    old: { 'policies/data-retention.md': '2025-01-20' },
    config: { title: 'Payments platform docs', subtitle: 'DocBench example workspace' },
    files: {
      'README.md': '# Payments platform docs\n\nDesign notes, runbooks and policies for the payments platform — what we decided, how we run it, and what we promise.\n\n| Folder | What lives here |\n|---|---|\n| `docs/` | Design notes, ADRs, runbooks |\n| `policies/` | Policies we review every six months |\n| `config/` | Service settings (proposals only for AI) |\n',
      'docs/design-notes.md': '---\nstatus: review\nowner: Hana\ntags: [payments, retries]\n---\n# Payments retry design\n\n> Status: in review · last measured 9/29–10/2 [measured]\n\n## Background\n\nRefunds and payouts retry on three separate paths, so a provider outage multiplies traffic.\nBoth incidents between 9/29 and 10/2 had the same cause: a retry storm [measured].\n\n## Decision\n\nOne queue for all outgoing calls, with a shared retry budget per provider.\n\n## Risks\n\n| Risk | Owner | Mitigation |\n|---|---|---|\n| Retry cap too low | [TBD] | Load test before rollout |\n| Ordering across providers | Platform | Idempotency keys |\n',
      'docs/runbook.md': '---\nstatus: approved\nowner: SRE\n---\n# Payments runbook\n\n## Before a deploy\n\n- [ ] Queue backlog is zero\n- [ ] Retry settings are production values\n',
      'docs/adr/0001-one-queue.md': '---\nstatus: approved\nowner: Platform\n---\n# ADR 1: One outgoing queue\n',
      'docs/rollout-plan.md': `---\nstatus: draft\nowner: Hana\ntags: [rollout]\nreview: ${day(12)}\n---\n# Rollout plan\n\n1. Load test on staging\n2. 10% canary\n3. Full rollout\n`,
      'policies/data-retention.md': '---\nstatus: approved\nowner: Security\nreviewed: 2025-01-20\n---\n# Payment record retention\n\nRecords are kept for 7 years.\n',
      'config/service.yaml': '# Payments service\nserver:\n  port: 8080\n  tls:\n    enabled: true\nretry:\n  budget: 50\n  backoff: exponential\nproviders:\n  - card\n  - bank\n',
      'data/latency.csv': 'day,p50_ms,p95_ms,errors\n2026-09-29,120,890,312\n2026-09-30,118,910,288\n2026-10-01,95,410,12\n2026-10-02,92,380,9\n',
      'notes/Meeting notes final (1).md': '# Meeting notes\n',
    },
    rules: {
      $schema: 'https://raw.githubusercontent.com/d-j-lee/docbench/main/docs/docbench.schema.json',
      rules: [
        { kind: 'front-matter', name: 'Front matter', paths: ['docs/**', 'policies/**'], keys: ['owner', 'status'], values: { status: ['draft', 'review', 'approved'] } },
        { kind: 'naming', paths: ['**'], style: ['no-spaces', 'no-version-marks'], hint: 'No spaces or version marks (_v2, final, (1)) — history lives in git.' },
        { kind: 'review', name: 'Policy review cycle', paths: ['policies/**'], days: 180, level: 'risk' },
        { kind: 'readme', paths: ['*'], minFiles: 3 },
      ],
    },
    review: { doc: 'docs/design-notes.md' },
    feedback: [
      { section: 'Background', body: 'Link the incident reports that show the retry storm.', status: 'draft', category: 'fact' },
      { section: 'Decision', body: 'Say whether ordering must hold across providers once we merge queues.', status: 'draft', category: 'gap', severity: 'high' },
      { section: 'Risks', title: 'Owner missing in the risk table', body: 'The "retry cap too low" risk still has [TBD] as owner. Match it to the runbook owner?', assistant: true, category: 'gap', severity: 'medium' },
    ],
    formats: 'config/service.yaml',
  },
};

async function workspaceFor(lang) {
  // 화면에 보이는 이름이 임시 폴더 이름이 되지 않게 — 임시 폴더 안에 예제 이름의 폴더
  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'docbench-shots-')), L[lang].folder);
  await fs.mkdir(dir, { recursive: true });
  if (lang === 'ko') await fs.cp(path.join(repo, 'examples/sample-workspace'), dir, { recursive: true, filter: (s) => !/[\\/]\.docbench[\\/](blobs|inbox|viewstate|feedback|runs|state\.json|changes\.jsonl)/.test(s) });
  for (const [p, body] of Object.entries(L[lang].files)) {
    if (body == null) continue;
    await fs.mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await fs.writeFile(path.join(dir, p), body);
  }
  await fs.writeFile(path.join(dir, 'docbench.json'), JSON.stringify(L[lang].rules, null, 2) + '\n');
  if (L[lang].config) { await fs.mkdir(path.join(dir, '.docbench'), { recursive: true }); await fs.writeFile(path.join(dir, '.docbench/config.json'), JSON.stringify(L[lang].config, null, 2)); }
  for (const [p, date] of Object.entries(L[lang].old || {})) { const t = new Date(date + 'T09:00:00Z'); await fs.utimes(path.join(dir, p), t, t); }
  // 이 PC 의 설정(문서 폴더 밖) — 화면의 "나"
  await fs.writeFile(dir + '.pc.json', JSON.stringify({ workspaces: { [dir]: L[lang].person } }, null, 2));
  return dir;
}

async function shoot(lang, browser) {
  const dir = await workspaceFor(lang);
  const s = await startServer({ root: dir, port: 0, pcConfigFile: dir + '.pc.json' });
  try {
    const api = `http://127.0.0.1:${s.port}/api`;
    const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DocBench': '1' }, body: JSON.stringify(b) }).then((r) => r.json());
    // 피드백: 사람의 초안 둘 + Claude 가 먼저 남긴 의견 하나
    const docId = L[lang].review.doc;
    const doc = await (await fetch(api + '/doc?id=' + encodeURIComponent(docId))).json();
    // 섹션 경로 — 원문 규칙(core.sectionSources) 그대로, 같은 이름 제목(#2)은 빼고
    const paths = core.sectionSources(doc.md, docId).map((x) => x.key).filter((k) => !/ #\d+$/.test(k)).map((k) => k.split(KEY_SEP));
    for (const f of L[lang].feedback) {
      const pathArr = paths.find((x) => x[x.length - 1] === f.section);
      if (!pathArr) throw new Error('섹션 없음: ' + f.section);
      await post('/feedback', {
        docId, target: { kind: 'section', path: pathArr, heading: pathArr[pathArr.length - 1] }, body: f.body, ...(f.title ? { title: f.title } : {}),
        category: f.category, ...(f.severity ? { severity: f.severity } : {}),
        ...(f.assistant ? { author: { kind: 'assistant', name: 'Claude' }, status: 'open', waitingOn: 'owner' } : { status: f.status, waitingOn: 'owner' }),
      });
    }
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: 'light', locale: lang === 'ko' ? 'ko-KR' : 'en-US' });
    const page = await ctx.newPage();
    const base = `http://127.0.0.1:${s.port}/?lang=${lang}`;
    const save = (name) => page.screenshot({ path: path.join(outDir, `${lang}-${name}.png`) });

    // 1) 형식 — YAML 은 키마다 섹션, Claude 는 제안만 (검토 패널을 열기 전에)
    await page.goto(base + '#' + encodeURIComponent(L[lang].formats));
    await page.waitForSelector('.db-sec');
    await page.waitForTimeout(300);
    await save('formats');

    // 2) 개요 — 팀 규칙 줄과 점검
    await page.goto(base + '#overview');
    await page.locator('.db-ov-rules').waitFor();
    await page.locator('.db-ov-check').first().waitFor();
    await page.waitForTimeout(300);
    await save('overview');

    // 3) 검토 — 문서 + 말풍선 + 검토 패널(초안)
    await page.goto(base + '#' + encodeURIComponent(docId));
    await page.waitForSelector('.db-sec');
    if ((await page.locator('.db-bub-btn[aria-pressed="true"]').count()) === 0) await page.locator('.db-bub-btn').click();
    await page.locator('.db-pill.draft').click();
    await page.locator('.db-panel .db-card').first().waitFor();
    await page.waitForTimeout(400);
    await save('review');
    await ctx.close();
  } finally {
    await s.close();
    await fs.rm(path.dirname(dir), { recursive: true, force: true });
  }
}

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const lang of process.argv[2] ? [process.argv[2]] : ['ko', 'en']) { await shoot(lang, browser); console.log('찍음:', lang); }
} finally {
  await browser.close();
}
