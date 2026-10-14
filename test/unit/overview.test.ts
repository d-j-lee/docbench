// @vitest-environment node
/**
 * 작업 공간 개요(D88) — 구성·폴더 역할·목적·메타데이터·AI 협업 파일·점검. 메타데이터와 앞부분 글만으로 계산한다.
 */
import { describe, it, expect } from 'vitest';
import { computeOverview, readmeSummary, relativeLinks, looksSecret, looksTemp, versionFamily, pickReadmes } from '../../src/core/overview';
import { isDocPath, DEFAULT_CONFIG } from '../../src/core/workspace';
import type { InventoryItem } from '../../src/types';

const NOW = Date.UTC(2026, 9, 14);
const day = 864e5;
const at = (daysAgo: number) => new Date(NOW - daysAgo * day).toISOString();
const file = (id: string, size = 100, daysAgo = 1, flags: string[] = []): InventoryItem => ({ id, parent: id.includes('/') ? id.slice(0, id.lastIndexOf('/') + 1) : '', name: id.split('/').pop()!, folder: false, size, modified: at(daysAgo), flags });
const dir = (p: string): InventoryItem => ({ id: p + '/', parent: p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '', name: p.split('/').pop()!, folder: true });

const items: InventoryItem[] = [
  file('README.md', 900, 2), file('CLAUDE.md', 300, 3), file('.env', 40), file('.DS_Store', 6000),
  dir('docs'), file('docs/README.md', 500), file('docs/설계.md', 2000, 400), file('docs/설계_v2.md', 2100), file('docs/회의록(1).md', 50),
  file('docs/a.md', 10), file('docs/b.md', 10), file('docs/c.md', 10), file('docs/d.md', 10), file('docs/e.md', 10),
  dir('data'), file('data/지표.csv', 5000), file('data/덤프.sql', 80 * 1024 * 1024, 30, ['untracked']), file('data/계획.docx', 30000), file('data/~$계획.docx', 162),
  dir('src'), ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => file(`src/${n}.ts`, 300, 1, n === 'a' ? ['modified'] : [])), dir('src/empty'),
  dir('notes'), file('notes/설계.md', 30), file('notes/bold.md', 30), file('notes/prev-plan.md', 30),
  dir('skills'), dir('skills/review'), file('skills/review/SKILL.md', 300),
  dir('keys'), file('keys/deploy.pem', 1700),
];

describe('작업 공간 개요', () => {
  const ov = computeOverview({
    root: '작업', items, complete: true, git: true, now: NOW,
    isDoc: (p) => isDocPath(p, DEFAULT_CONFIG),
    readmes: { '': { id: 'README.md', text: '---\ntitle: 작업\n---\n# 작업\n\n![badge](x.svg)\n\n이 작업 공간은 **0.9 판** [배포](docs/a.md)를 준비한다.\n둘째 줄.\n\n## 다음\n' }, docs: { id: 'docs/README.md', text: '# 문서\n\n설계·회의 문서를 둔다.\n' } },
    config: { folders: { data: { role: '원천 데이터 — 고치지 않는다' } } },
    meta: { 'docs/설계.md': { status: 'Review', owner: '김철수', tags: ['api', '보안'], review: '2026-09-01' }, 'docs/a.md': { status: 'done', owners: ['김철수', '이영희'], tags: 'api, 운영' } },
    links: [{ from: 'README.md', to: ['docs/a.md', 'docs/없음.md', 'docs/'] }, { from: 'docs/a.md', to: ['docs/b.md', 'docs/c.md'] }, { from: 'docs/b.md', to: ['docs/a.md'] }, { from: 'docs/c.md', to: [] }, { from: 'docs/d.md', to: [] }],
  });
  const check = (code: string) => ov.checks.find((c) => c.code === code);

  it('목적은 README 의 첫 문단(배지·강조·링크 표시를 떼고), 폴더 역할은 설정 → 그 폴더 README', () => {
    expect(ov.purpose).toEqual({ text: '이 작업 공간은 0.9 판 배포를 준비한다. 둘째 줄.', from: 'readme', docId: 'README.md' });
    const f = Object.fromEntries(ov.folders.map((x) => [x.path, x]));
    expect(f.data).toMatchObject({ role: '원천 데이터 — 고치지 않는다', roleFrom: 'config' });
    expect(f.docs).toMatchObject({ role: '설계·회의 문서를 둔다.', roleFrom: 'readme', readme: 'docs/README.md', files: 9 });
    expect(ov.folders.at(-1)!.path).toBe('');
  });
  it('구성·합계·최근·큰 파일', () => {
    expect(ov.totals.files).toBe(items.filter((i) => !i.folder).length);
    expect(ov.totals.dirs).toBe(8);
    // 코드: .ts 8 + .sql 1
    expect(ov.groups.find((g) => g.group === 'code')?.files).toBe(9);
    expect(ov.large[0]).toMatchObject({ path: 'data/덤프.sql', doc: true });
    expect(ov.totals.recent7).toBeGreaterThan(10);
  });
  it('앞머리 메타데이터: 상태(소문자)·담당·꼬리표, 지난 검토일', () => {
    expect(ov.meta.status).toEqual({ review: 1, done: 1 });
    expect(ov.meta.owners).toEqual({ 김철수: 2, 이영희: 1 });
    expect(ov.meta.tags).toEqual({ api: 2, 보안: 1, 운영: 1 });
    expect(ov.meta.due).toEqual([{ docId: 'docs/설계.md', field: 'review', date: '2026-09-01' }]);
  });
  it('AI 협업 파일', () => {
    expect(ov.ai).toEqual([{ path: 'CLAUDE.md', kind: 'claude' }, { path: 'skills/review/SKILL.md', kind: 'skill' }]);
  });
  it('점검: 비밀·큰 파일(git)·사본·임시·빈 폴더·README 없는 큰 폴더·같은 이름·오래된·깨진 링크·고아·커밋 안 함', () => {
    expect(check('secrets')?.paths).toEqual(['.env', 'keys/deploy.pem']);
    expect(check('secrets')?.level).toBe('risk');
    expect(check('huge-files')).toMatchObject({ level: 'action', paths: ['data/덤프.sql'] });
    expect(check('no-readme')).toBeUndefined();
    expect(check('review-due')?.paths).toEqual(['docs/설계.md']);
    expect(check('version-copies')?.paths.sort()).toEqual(['docs/설계.md', 'docs/설계_v2.md', 'docs/회의록(1).md'].sort());
    expect(check('temp-files')?.paths.sort()).toEqual(['.DS_Store', 'data/~$계획.docx']);
    expect(check('empty-folders')?.paths).toEqual(['src/empty']);
    expect(check('folder-no-readme')?.paths).toEqual(['src/']);
    expect(check('same-name')?.paths.sort()).toEqual(['docs/설계.md', 'notes/설계.md']);
    expect(check('stale-docs')?.paths).toEqual(['docs/설계.md']);
    expect(check('broken-links')?.paths).toEqual(['README.md']);
    expect(check('orphan-docs')?.paths).toEqual(['docs/d.md']);
    expect(check('git-uncommitted')?.n).toBe(2);
    // 주의 → 할 일 → 정리 → 참고 차례
    const lv = ov.checks.map((c) => c.level);
    expect(lv.indexOf('risk')).toBeLessThan(lv.indexOf('action'));
    expect(lv.lastIndexOf('tidy')).toBeLessThan(lv.indexOf('info'));
  });
  it('README 가 없으면 할 일, 일부만 훑었으면 빈 폴더·깨진 링크는 세지 않는다', () => {
    const o2 = computeOverview({ root: 'x', items: [file('a.md'), dir('e')], complete: false, isDoc: () => true, links: [{ from: 'a.md', to: ['nope.md'] }], now: NOW });
    expect(o2.checks.map((c) => c.code)).toEqual(['no-readme']);
  });
});

describe('이름·글 규칙', () => {
  it('비밀로 보이는 이름 (예시 .env 는 아님, Keynote .key 는 크면 아님)', () => {
    for (const n of ['.env', '.env.production', 'id_rsa', 'server.pem', 'cert.p12', 'credentials.json', 'service-account-prod.json', 'secrets.yaml']) expect(looksSecret(n)).toBe(true);
    for (const n of ['.env.example', 'id_rsa.pub', 'keynote.md', 'secret-sauce.md']) expect(looksSecret(n)).toBe(false);
    expect(looksSecret('발표.key', 2_000_000)).toBe(false);
    expect(looksSecret('tls.key', 1700)).toBe(true);
  });
  it('임시 파일', () => {
    for (const n of ['~$보고서.docx', 'Thumbs.db', 'desktop.ini', 'a.tmp', 'x.crdownload', '.~lock.a.odt#']) expect(looksTemp(n)).toBe(true);
    expect(looksTemp('tmp.md')).toBe(false);
  });
  it('판 표시: 구분자 뒤의 영어 낱말만, 한국어는 붙여 써도', () => {
    expect(versionFamily('설계_v2.md')).toEqual({ base: '설계.md', marked: true });
    expect(versionFamily('보고서최종본.docx')).toEqual({ base: '보고서.docx', marked: true });
    expect(versionFamily('plan (최종)(1).pptx')).toEqual({ base: 'plan.pptx', marked: true });
    expect(versionFamily('bold.md').marked).toBe(false);
    expect(versionFamily('prev.md').marked).toBe(false);
    expect(versionFamily('copyright.md').marked).toBe(false);
  });
  it('README 요약: 앞머리 description 먼저, 표·목록·코드 블록은 건너뛰고 200자', () => {
    expect(readmeSummary('---\ndescription: 배포 문서 모음\n---\n# x\n\n본문\n')).toBe('배포 문서 모음');
    expect(readmeSummary('# x\n\n| a | b |\n|---|---|\n\n```\ncode\n```\n\n- 목록\n\n진짜 첫 문단.\n')).toBe('진짜 첫 문단.');
    expect(readmeSummary('# x\n\n' + '가'.repeat(300)).length).toBe(200);
  });
  it('상대 링크: 바깥 주소·앵커·코드 안은 빼고 ../·%·#·? 를 푼다', () => {
    const md = '[a](./b.md#x) [c](../root.md) ![i](img/p%20q.png "t") [w](https://x.y) [m](mailto:a@b) [h](#top)\n`[n](no.md)`\n```\n[n](no2.md)\n```\n[ref]: <../ref.md>\n[root](../../맨위.md) [up](../../../밖.md)';
    expect(relativeLinks(md, 'docs/sub/a.md').sort()).toEqual(['docs/root.md', 'docs/ref.md', 'docs/sub/b.md', 'docs/sub/img/p q.png', '맨위.md'].sort());
  });
  it('README 고르기: 맨 위·맨 위 폴더마다 하나, .md 먼저', () => {
    expect(pickReadmes([file('README.txt'), file('README.md'), file('docs/readme.rst'), file('docs/a/README.md'), dir('docs')])).toEqual({ '': 'README.md', docs: 'docs/readme.rst' });
  });
});
