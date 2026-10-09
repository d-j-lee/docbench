// @vitest-environment node
/**
 * 0.5 의 바탕 규칙 (src/core) — 기록 합치기(D66), 큰 폴더 알아보기·나무 항목(D64), 실행기 짝(D63·D67).
 * 화면·서버가 같이 쓰므로 여기서 한 번에 본다.
 */
import { describe, it, expect } from 'vitest';
import { mergeRecords, rebaseViewState } from '../../src/core/records';
import { looksBigRoot, toTreeEntries, mergeConfig, pcSettingsFor, isDocPath } from '../../src/core/workspace';
import { pickRunner, runnerIsMine } from '../../src/core/runs';
import { fsFromMemory } from '../../src/adapters/folder-fs';
import type { RunnerInfo } from '../../src/types';

const j = (o: unknown) => JSON.stringify(o, null, 2) + '\n';

describe('기록 합치기 (D66)', () => {
  const fb = (id: string, docId: string, body = 'x') => j({ id, version: 1, docId, target: { kind: 'doc' }, body, status: 'open', waitingOn: 'assistant', author: { kind: 'human', id: 'u-1' }, thread: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' });
  const line = (o: unknown) => JSON.stringify(o) + '\n';
  const src = () => fsFromMemory({
    'feedback/fb-a.json': fb('fb-a', 'a.md', '하위'),
    'feedback/fb-same.json': fb('fb-same', 'b.md', '하위 것'),
    'feedback/fb-item.json': j({ id: 'fb-item', version: 1, target: { kind: 'item', itemId: 'svc' }, body: 'm', status: 'open', thread: [] }),
    'changes.jsonl': line({ at: '2026-10-01T00:00:01Z', docId: 'a.md', toVersion: 'v1' }) + line({ at: '2026-10-01T00:00:03Z', docId: 'a.md', toVersion: 'v2' }),
    'state.json': j({ docs: { 'a.md': 'v2', 'b.md': 'w1' } }),
    'blobs/v2.md': '# a\n',
    'viewstate/u-1.json': j({ last: 'a.md', docs: { 'a.md': { lastSeen: 'v2' } }, pins: ['a.md', 'sub/'], recent: ['a.md'], open: ['sub'], groups: { x: true } }),
    'config.json': j({ docs: { 'a.md': { readOnly: true } }, groups: [{ label: '설계', match: ['design/*.md'] }] }),
  }, 'proj');
  const dst = () => fsFromMemory({
    'feedback/fb-same.json': fb('fb-same', 'proj/b.md', '넓은 쪽 것'),
    'changes.jsonl': line({ at: '2026-10-01T00:00:02Z', docId: 'top.md', toVersion: 't1' }),
    'state.json': j({ docs: { 'proj/b.md': 'w0' } }),
    'viewstate/u-1.json': j({ last: 'top.md', docs: { 'top.md': {} }, pins: ['top.md'] }),
    'config.json': j({ title: '넓은 쪽' }),
  }, 'work');
  const read = async (fs: ReturnType<typeof fsFromMemory>, p: string) => JSON.parse(new TextDecoder().decode((await fs.read(p))!.bytes));

  it('문서 경로를 넓은 쪽 기준으로 옮기고, 넓은 쪽에 있는 것은 덮지 않는다', async () => {
    const s = src(), d = dst();
    const r = await mergeRecords(s, d, 'proj');
    expect(r).toMatchObject({ feedback: 2, changes: 2, blobs: 1, state: 1, views: 1, config: true });
    expect((await read(d, 'feedback/fb-a.json')).docId).toBe('proj/a.md');
    expect((await read(d, 'feedback/fb-item.json')).target.itemId).toBe('proj/svc');
    expect((await read(d, 'feedback/fb-same.json')).body).toBe('넓은 쪽 것');
    const log = new TextDecoder().decode((await d.read('changes.jsonl'))!.bytes).trim().split('\n').map((l) => JSON.parse(l));
    expect(log.map((e) => e.docId)).toEqual(['proj/a.md', 'top.md', 'proj/a.md']);   // 시각 순
    expect((await read(d, 'state.json')).docs).toEqual({ 'proj/b.md': 'w0', 'proj/a.md': 'v2' });
    const v = await read(d, 'viewstate/u-1.json');
    expect(v.last).toBe('top.md');
    expect(v.pins).toEqual(['top.md', 'proj/a.md', 'proj/sub/']);
    expect(v.recent).toEqual(['proj/a.md']);
    expect(Object.keys(v.docs).sort()).toEqual(['proj/a.md', 'top.md']);
    const c = await read(d, 'config.json');
    expect(c.title).toBe('넓은 쪽');
    expect(c.docs).toEqual({ 'proj/a.md': { readOnly: true } });
    expect(c.groups[0].match).toEqual(['proj/design/*.md']);
    // 원본은 그대로(지우지 않는다)
    expect((await read(s, 'feedback/fb-a.json')).docId).toBe('a.md');
  });
  it('두 번 불러도 같은 결과 (도중에 끊겨도 다시 부르면 된다)', async () => {
    const s = src(), d = dst();
    await mergeRecords(s, d, 'proj');
    const r2 = await mergeRecords(s, d, 'proj/');
    expect([r2.feedback, r2.changes, r2.blobs, r2.state]).toEqual([0, 0, 0, 0]);
    expect(new TextDecoder().decode((await d.read('changes.jsonl'))!.bytes).trim().split('\n')).toHaveLength(3);
  });
  it('보기 상태: 접기 상태는 옮기지 않고, 지도·이력 보기는 경로가 아니다', () => {
    expect(rebaseViewState({ last: 'changes', groups: { a: 1 } }, 'p')).toEqual({ last: 'changes', docs: {} });
  });
});

describe('큰 폴더 알아보기·나무 항목 (D64)', () => {
  it('드라이브·홈·시스템 표식이면 큰 폴더', () => {
    expect(looksBigRoot('C:\\', [])).toBe(true);
    expect(looksBigRoot('D:', ['work'])).toBe(true);
    expect(looksBigRoot('', [])).toBe(true);
    expect(looksBigRoot('dj', ['AppData', 'NTUSER.DAT', 'Documents'])).toBe(true);
    expect(looksBigRoot('backup', ['$RECYCLE.BIN', 'photos'])).toBe(true);
    expect(looksBigRoot('dj', ['Applications', 'Library', 'Desktop'])).toBe(true);
    expect(looksBigRoot('proj', ['docs', 'src', 'README.md', 'Library'])).toBe(false);
  });
  it('나무 항목: 숨김·의존성 폴더·임시 파일은 빼고, 폴더 먼저·숫자는 크기순, 문서 표시', () => {
    const raw = [
      { name: 'node_modules', kind: 'directory' as const }, { name: '.git', kind: 'directory' as const }, { name: '.docbench', kind: 'directory' as const },
      { name: 'b', kind: 'directory' as const }, { name: 'a', kind: 'directory' as const },
      { name: '문서10.md', kind: 'file' as const, size: 3 }, { name: '문서2.md', kind: 'file' as const }, { name: 'logo.png', kind: 'file' as const },
      { name: '.env', kind: 'file' as const }, { name: '~$보고서.docx', kind: 'file' as const }, { name: 'draft.MD', kind: 'file' as const },
    ];
    const t = toTreeEntries(raw, 'docs/', { include: ['**/*.md'], exclude: [] }, true);
    expect(t.map((x) => x.path)).toEqual(['docs/a', 'docs/b', 'docs/draft.MD', 'docs/logo.png', 'docs/문서2.md', 'docs/문서10.md']);   // 탐색기 차례: 영문 → 한글
    expect(t.filter((x) => x.doc).map((x) => x.name)).toEqual(['draft.MD', '문서2.md', '문서10.md']);
    expect(t.find((x) => x.name === '문서10.md')!.size).toBe(3);
  });
});

describe('이름과 계정 (D63)', () => {
  it('표시 이름은 이 PC 의 설정에서만 — 문서 폴더 config.json 의 name 은 무시', () => {
    const pc = { workspaces: { 'D:\\proj': { owners: ['u-0a1b2c3d4e'] } }, name: '디제이', user: 'dj' };
    const s = pcSettingsFor(pc, ['d:\\proj'], true);
    expect(s.owners).toEqual(['u-0a1b2c3d4e']);
    expect(s.name).toBe('디제이');
    const c = mergeConfig({ name: '남이 적은 이름' } as never, 'proj', s);
    expect(c.name).toBe('디제이');
    expect(mergeConfig({ name: '남이 적은 이름' } as never, 'proj').name).toBe('');
  });
});

describe('실행기 고르기 (D63·D67)', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const r = (o: Partial<RunnerInfo>): RunnerInfo => ({ id: 'runner:x@h', kind: 'runner', user: 'x', host: 'h', pid: 1, version: 't', protocol: 2, startedAt: '2026-10-08T11:00:00Z', seenAt: '2026-10-08T11:59:55Z', claude: { ok: true }, ...o }) as RunnerInfo;
  it('화면의 계정과 짝지은(owners) 앱을 이름이 달라도 고른다', () => {
    const app = r({ id: 'app:dj-pc@h', kind: 'app', user: 'dj-pc', owners: ['u-0a1b2c3d4e'] });
    expect(runnerIsMine(app, { me: '디제이', meId: 'u-0a1b2c3d4e' })).toBe(true);
    expect(pickRunner([app], { me: '디제이', meId: 'u-0a1b2c3d4e', now })?.id).toBe('app:dj-pc@h');
    expect(pickRunner([app], { me: '디제이', meId: 'u-ffffffffff', now })).toBeNull();
  });
  it('내 것 중 이 PC 의 앱·실행기 먼저(서버보다), 쓸 수 있는 것 먼저', () => {
    const server = r({ id: 'server:dj@h', kind: 'server', user: 'dj' });
    const off = r({ id: 'app:dj@h2', kind: 'app', user: 'dj', claude: { ok: false } as never });
    const ok = r({ id: 'runner:dj@h3', kind: 'runner', user: 'dj', seenAt: '2026-10-08T11:59:50Z' });
    expect(pickRunner([server, off, ok], { meId: 'dj', now })?.id).toBe('runner:dj@h3');
  });
  it('꾸민 owners(모양이 아님)는 실행기로 치지 않는다', () => {
    expect(pickRunner([r({ id: 'app:x@h', kind: 'app', user: 'y', owners: [1 as never] })], { meId: 'x', now })).toBeNull();
    // 표시 이름(별명)이 동료의 로그인 이름과 같아도 고르지 않는다 — 계정으로만
    expect(pickRunner([r({ id: 'runner:kim@h', user: 'kim' })], { me: 'kim', meId: 'u-0a1b2c3d4e', now })).toBeNull();
  });
});

describe('문서가 될 수 있는 것 (D71)', () => {
  it('함께 쓰는 설정이 include 를 넓혀도 마크다운·숨김 아닌 곳만', () => {
    const wide = { include: ['**/*'], exclude: [] };
    expect(isDocPath('docs/a.md', wide)).toBe(true);
    expect(isDocPath('.git/hooks/post-checkout', wide)).toBe(false);
    expect(isDocPath('.git/notes.md', wide)).toBe(false);
    expect(isDocPath('package.json', wide)).toBe(false);
    expect(isDocPath('scripts/run.ps1', wide)).toBe(false);
    expect(isDocPath('node_modules/x/README.md', wide)).toBe(false);
    expect(isDocPath('.vscode/a.md', wide)).toBe(false);
    expect(isDocPath('dist/guide.MARKDOWN', wide)).toBe(true);
  });
});
