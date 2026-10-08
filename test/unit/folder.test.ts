// @vitest-environment node
/**
 * 폴더 어댑터(서버 없는 단일 HTML 의 저장소).
 *  1) 메모리 폴더: 저장·충돌·외부 편집·피드백·요청함·읽기 전용
 *  2) 실제 디스크 + CLI: 브라우저 어댑터가 쓴 것을 CLI 가 읽고, CLI 가 쓴 것을 어댑터가 읽는다(같은 디스크 모양)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { createFolderAdapters, lockFileName, type FolderAdapters } from '../../src/adapters/folder';
import { fsFromMemory, subFs, type FsLike } from '../../src/adapters/folder-fs';
import { DocConflictError, DocReadOnlyError, FeedbackConflictError, type DocEvent } from '../../src/types';
import type { LegacyCodec } from '../../src/core/textcodec';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = promisify(execFile);
const cp949: LegacyCodec = {
  decode: (b) => iconv.decode(Buffer.from(b), 'cp949'),
  encode: (s) => { const o = iconv.encode(s, 'cp949'); return iconv.decode(o, 'cp949') === s ? new Uint8Array(o) : null; },
};
const opened: FolderAdapters[] = [];
const open = async (fs: FsLike, o = {}) => { const a = await createFolderAdapters(fs, { legacy: cp949, pollMs: 40, userName: 'dj', ...o }); opened.push(a); return a; };
afterEach(() => { opened.splice(0).forEach((a) => a.close()); });

const DOC = '# 런북\r\n\r\n## 배포\r\n\r\n확인한다\r\n\r\n## 장애\r\n\r\n큐를 본다\r\n';

describe('메모리 폴더', () => {
  it('처음 열면 .docbench/ 를 만들고 문서를 찾는다', async () => {
    const fs = fsFromMemory({ 'docs/런북.md': DOC, 'node_modules/x/README.md': '# 아님', '.hidden/a.md': '# 아님', 'a.txt': 'x' }, '문서');
    const a = await open(fs);
    expect(fs.text('.docbench/.gitignore')).toContain('locks/');
    const m = await a.docs.manifest();
    expect(Object.keys(m.docs)).toEqual(['docs/런북.md']);
    expect(m.docs['docs/런북.md'].title).toBe('런북');
    expect(m.project.name).toBe('문서');
  });

  it('저장: 판이 다르면 충돌, CRLF·BOM 유지, 이력·바뀐 섹션·잠금 정리', async () => {
    const fs = fsFromMemory({ 'r.md': new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(DOC)]) });
    const a = await open(fs);
    const d = await a.docs.load('r.md');
    await expect(a.docs.save!('r.md', d.md, { baseVersion: 'deadbeefdeadbeef' })).rejects.toBeInstanceOf(DocConflictError);
    const r = await a.docs.save!('r.md', d.md.replace('큐를 본다', '큐 적체를 본다'), { baseVersion: d.version, summary: '구체화', feedbackIds: ['fb-1'] });
    const bytes = fs.files.get('r.md')!.bytes;
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(Buffer.from(bytes.slice(3)).toString()).toBe(DOC.replace('큐를 본다', '큐 적체를 본다'));
    expect(r.version).toBe(createHash('sha256').update(bytes).digest('hex').slice(0, 16));
    const ch = await a.docs.changes!();
    expect(ch.at(-1)).toMatchObject({ docId: 'r.md', summary: '구체화', feedbackIds: ['fb-1'], sections: ['런북 › 장애'], by: { kind: 'human', name: 'dj' } });
    expect(fs.text(`.docbench/blobs/${r.version}.md`)).toContain('큐 적체를 본다');
    expect(JSON.parse(fs.text('.docbench/state.json')!).docs['r.md']).toBe(r.version);
    expect([...fs.files.keys()].filter((k) => k.startsWith('.docbench/locks/'))).toEqual([]);
  });

  it('밖에서 고친 문서는 외부 편집으로 기록되고 doc 이벤트가 온다', async () => {
    const fs = fsFromMemory({ 'r.md': DOC });
    const a = await open(fs);
    await a.docs.load('r.md');
    const events: DocEvent[] = [];
    const off = a.docs.subscribe!((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 60));
    await fs.write('r.md', DOC + '\r\n## 새 절\r\n\r\n추가\r\n');
    await expect.poll(() => events.some((e) => e.type === 'doc' && e.id === 'r.md'), { timeout: 2000 }).toBe(true);
    off();
    const ch = await a.docs.changes!();
    expect(ch.at(-1)).toMatchObject({ docId: 'r.md', by: { kind: 'external' }, sections: ['런북 › 새 절'] });
  });

  it('피드백: 파일 하나 = 한 건, 판 충돌, 지우기', async () => {
    const fs = fsFromMemory({ 'r.md': DOC });
    const a = await open(fs);
    const f = await a.feedback.create({ docId: 'r.md', target: { kind: 'section', path: ['런북', '배포'], heading: '배포' }, body: '근거 보강' });
    const disk = JSON.parse(fs.text(`.docbench/feedback/${f.id}.json`)!);
    expect(disk).toMatchObject({ id: f.id, version: 1, waitingOn: 'assistant', author: { kind: 'human', name: 'dj' } });
    const g = await a.feedback.update(f.id, { status: 'resolved' }, { version: 1 });
    expect(g.version).toBe(2);
    await expect(a.feedback.update(f.id, { body: 'x' }, { version: 1 })).rejects.toBeInstanceOf(FeedbackConflictError);
    await a.feedback.remove!(f.id);
    expect(fs.files.has(`.docbench/feedback/${f.id}.json`)).toBe(false);
  });

  it('넘기기: 요청함에 남기고 queued (AI 를 깨우지는 않는다)', async () => {
    const fs = fsFromMemory({ 'r.md': DOC });
    const a = await open(fs);
    const r = await a.notifier!.send({ count: 1, docs: ['런북'], feedbackIds: ['fb-1'] });
    expect(r).toMatchObject({ delivered: false, queued: true });
    const req = [...fs.files.keys()].find((k) => k.startsWith('.docbench/inbox/req-'))!;
    expect(JSON.parse(fs.text(req)!)).toMatchObject({ count: 1, feedbackIds: ['fb-1'] });
  });

  it('읽기 전용 폴더: 보기만, 아무것도 쓰지 않는다', async () => {
    const fs = fsFromMemory({ 'r.md': DOC }, 'ro', { writable: false });
    const a = await open(fs);
    const d = await a.docs.load('r.md');
    expect([d.readOnly, d.readOnlyReason]).toEqual([true, 'folder']);
    expect(await a.identity!.can('doc.edit')).toBe(false);
    expect(await a.identity!.can('feedback.create')).toBe(false);
    expect(a.notifier).toBeUndefined();
    await expect(a.docs.save!('r.md', d.md + 'x', { baseVersion: d.version })).rejects.toBeInstanceOf(DocReadOnlyError);
    expect([...fs.files.keys()]).toEqual(['r.md']);
  });

  it('작업 폴더 밖·대상 아닌 경로는 거부', async () => {
    const a = await open(fsFromMemory({ 'r.md': DOC, 'x.txt': 'x' }));
    await expect(a.docs.load('../r.md')).rejects.toThrow(/밖/);
    await expect(a.docs.load('C:/r.md')).rejects.toThrow(/밖/);
    await expect(a.docs.load('x.txt')).rejects.toThrow(/대상 문서가 아님/);
  });

  it('이력 덧붙이기는 한 줄로 선다 — 동시에 41번 저장해도 41줄 (독립 검토 재현)', async () => {
    const fs = fsFromMemory({ 'r.md': DOC });
    const a = await open(fs);
    await Promise.all(Array.from({ length: 41 }, (_, i) => a.workspace.appendChange({ at: new Date().toISOString(), docId: 'r.md', summary: 'n' + i })));
    const lines = fs.text('.docbench/changes.jsonl')!.trim().split('\n');
    expect(lines.length).toBe(41);
  });

  it('BOM 붙은 config.json 을 서버와 같게 읽고, 폴더의 실행 명령은 무시', async () => {
    const fs = fsFromMemory({
      'a.md': '# a', 'private.md': '# p',
      '.docbench/config.json': '\ufeff' + JSON.stringify({ title: '팀 문서', exclude: ['private.md'], assistant: { command: 'evil' } }),
    });
    const a = await open(fs);
    const m = await a.docs.manifest();
    expect([m.project.name, Object.keys(m.docs)]).toEqual(['팀 문서', ['a.md']]);
    expect(a.workspace.config.assistant).toBeNull();
    expect(a.workspace.config.warnings?.length).toBe(1);
  });

  it('처음 여는 큰 폴더도 빨리 연다 — 문서를 읽지 않고, 연 문서부터 판을 적는다 (D64)', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 300; i++) files[`d/${i}.md`] = `# 문서 ${i}\n\n본문\n`;
    const fs = fsFromMemory(files);
    let reads = 0;
    const read = fs.read.bind(fs);
    fs.read = async (p, max) => { if (p.endsWith('.md') && max == null) reads++; return read(p, max); };
    const t0 = Date.now();
    const a = await open(fs);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(reads).toBe(0);
    expect(JSON.parse(fs.text('.docbench/state.json') || '{"docs":{}}').docs).toEqual({});
    const d = await a.docs.load('d/7.md');
    expect(JSON.parse(fs.text('.docbench/state.json')!).docs).toEqual({ 'd/7.md': d.version });
  });

  it('보고 있는 문서(focus)를 매번 확인하고, 내 저장은 바깥 변경으로 다시 알리지 않는다', async () => {
    const fs = fsFromMemory({ 'r.md': DOC, 's.md': '# s\n' });
    const a = await open(fs);
    const events: DocEvent[] = [];
    const off = a.docs.subscribe!((e) => events.push(e));
    a.docs.focus!('r.md');
    await a.docs.load('s.md');                          // 화면 밖 읽기(빈칸 세기 등)는 focus 를 옮기지 않는다
    expect(a.workspace.watching).toBe('r.md');
    const d = await a.docs.load('r.md');
    await a.docs.save!('r.md', d.md + '\n추가\n', { baseVersion: d.version });
    await new Promise((r) => setTimeout(r, 300));
    expect(events.filter((e) => e.type === 'doc' && e.id === 'r.md')).toEqual([]);
    // 반쯤 쓴 이력 줄은 완성될 때 한 번
    const line = JSON.stringify({ at: 'x', docId: 's.md', toVersion: 'bbbbbbbbbbbbbbbb' }) + '\n';
    await fs.append('.docbench/changes.jsonl', line.slice(0, 15));
    await new Promise((r) => setTimeout(r, 200));
    expect(events.some((e) => e.type === 'doc' && e.id === 's.md')).toBe(false);
    await fs.append('.docbench/changes.jsonl', line.slice(15));
    await expect.poll(() => events.filter((e) => e.type === 'doc' && e.id === 's.md').length, { timeout: 2000 }).toBe(1);
    off();
  });

  it('남이 내가 예전에 쓴 바이트로 되돌린 것도 알린다 (내 저장 표시는 한 번 보면 지운다)', async () => {
    const fs = fsFromMemory({ 'r.md': DOC });
    const a = await open(fs);
    const events: DocEvent[] = [];
    const off = a.docs.subscribe!((e) => events.push(e));
    a.docs.focus!('r.md');
    const d0 = await a.docs.load('r.md');
    const r1 = await a.docs.save!('r.md', d0.md + '\n둘\n', { baseVersion: d0.version });
    await a.docs.save!('r.md', d0.md + '\n셋\n', { baseVersion: r1.version });
    await new Promise((r) => setTimeout(r, 200));
    events.length = 0;
    // CLI 가 '둘' 판으로 되돌린다(같은 바이트) — 이력 줄이 붙는다
    await fs.write('r.md', new TextEncoder().encode((d0.md + '\n둘\n').replace(/\n/g, '\r\n')));
    await fs.append('.docbench/changes.jsonl', JSON.stringify({ at: 'x', docId: 'r.md', toVersion: r1.version }) + '\n');
    await expect.poll(() => events.some((e) => e.type === 'doc' && e.id === 'r.md'), { timeout: 2000 }).toBe(true);
    off();
  });

  it('잠금 파일 이름이 서버·CLI 와 같다 (sha1 앞 16자)', async () => {
    for (const key of ['doc:docs/런북.md', 'fb:fb-1', 'state']) {
      expect(await lockFileName(key)).toBe(createHash('sha1').update(key).digest('hex').slice(0, 16) + '.lock');
    }
  });
});

// ---------------------------------------------------------------- 실제 디스크 + CLI

/** 시험용: node:fs 위의 FsLike (브라우저 대신) */
function fsFromNode(root: string): FsLike {
  const abs = (p: string) => path.join(root, ...p.split('/').filter(Boolean));
  const st = async (p: string) => fsp.stat(abs(p)).then((s) => (s.isFile() ? s : null), () => null);
  return {
    name: path.basename(root), writable: true,
    async list(dir) { try { return (await fsp.readdir(abs(dir), { withFileTypes: true })).map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' as const : 'file' as const })); } catch { return null; } },
    async read(p, max) { const s = await st(p); if (!s) return null; const b = await fsp.readFile(abs(p)); return { bytes: new Uint8Array(max != null ? b.subarray(0, max) : b), size: s.size, mtimeMs: s.mtimeMs }; },
    async stat(p) { const s = await st(p); return s ? { size: s.size, mtimeMs: s.mtimeMs } : null; },
    async write(p, d) { await fsp.mkdir(path.dirname(abs(p)), { recursive: true }); await fsp.writeFile(abs(p), d); },
    async append(p, t) { await fsp.mkdir(path.dirname(abs(p)), { recursive: true }); await fsp.appendFile(abs(p), t); },
    async remove(p) { await fsp.rm(abs(p), { force: true }); },
  };
}

describe('기록을 문서 폴더 밖에 둘 때 (D57)', () => {
  it('메모리: 문서 폴더에는 아무것도 안 생기고, 기록은 기록 폴더에 같은 모양으로', async () => {
    const docs = fsFromMemory({ 'docs/런북.md': DOC }, '문서');
    const home = fsFromMemory({}, '기록함');
    const a = await open(docs, { data: subFs(home, '문서'), dataHome: '기록함' });
    const f = await a.feedback.create({ docId: 'docs/런북.md', target: { kind: 'doc' }, body: '확인' });
    const d = await a.docs.load('docs/런북.md');
    await a.docs.save!('docs/런북.md', d.md.replace('확인한다', '두 번 확인한다'), { baseVersion: d.version, summary: '강조' });
    expect([...docs.files.keys()]).toEqual(['docs/런북.md']);
    const keys = [...home.files.keys()];
    expect(keys).toContain(`문서/feedback/${f.id}.json`);
    expect(keys).toContain('문서/changes.jsonl');
    expect(keys).toContain('문서/docbench-data.json');
    expect(keys.some((k) => k.startsWith('문서/.gitignore'))).toBe(false);
    expect(JSON.parse(home.text('문서/docbench-data.json')!)).toMatchObject({ protocol: 1, docsName: '문서' });
    expect((await a.docs.manifest()).project.storage).toBe('기록함/문서');
    expect(a.runs?.setup).toBeUndefined();
    // Claude 작업도 기록 폴더로: 실행기 심장 박동을 읽고 요청을 남긴다
    await home.write('문서/runners/runner_dj@pc.json', JSON.stringify({ id: 'runner:dj@pc', kind: 'runner', user: 'dj', host: 'pc', pid: 1, version: 't', protocol: 1, startedAt: '', seenAt: new Date().toISOString(), claude: { ok: true }, models: [], efforts: [] }));
    expect((await a.runs!.status()).available).toBe(true);
    const r = await a.runs!.start({ kind: 'handoff', feedbackIds: [f.id] });
    expect(home.files.has(`문서/runs/${r.id}.req.json`)).toBe(true);
    expect([...docs.files.keys()]).toEqual(['docs/런북.md']);
  });
  it('실제 디스크: 브라우저가 보관함에 만든 기록을 CLI 가 link 로 이어받는다', async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'docbench-out-'));
    try {
      const dir = path.join(base, '문서');
      const homeDir = path.join(base, '기록함');
      const pcHome = path.join(base, 'pc');
      await fsp.cp(path.join(repo, 'examples/sample-workspace'), dir, { recursive: true, filter: (s) => !/[\\/]\.docbench([\\/]|$)/.test(s) });
      await fsp.mkdir(homeDir, { recursive: true });
      await fsp.writeFile(path.join(homeDir, 'docbench-home.json'), '{"protocol":1}');
      const env = { ...process.env, DOCBENCH_HOME: pcHome, DOCBENCH_ACTOR: '' };
      const cli = async (...args: string[]) => (await run(process.execPath, [path.join(repo, 'bin/docbench.mjs'), ...args, '--json'], { cwd: dir, env })).stdout;
      const a = await open(fsFromNode(dir), { legacy: cp949, data: subFs(fsFromNode(homeDir), '문서'), dataHome: '기록함' });
      const f = await a.feedback.create({ docId: 'docs/운영-런북.md', target: { kind: 'doc' }, body: '연락처 빈칸을 알려 줘' });
      await expect(cli('fb', 'list')).rejects.toMatchObject({ code: 2 });
      await cli('link', dir, '--data', path.join(homeDir, '문서'));
      expect(JSON.parse(await cli('fb', 'list', '--waiting', 'assistant')).map((x: { id: string }) => x.id)).toContain(f.id);
      await cli('fb', 'reply', f.id, '-m', '두 군데입니다', '--resolve');
      const rows = await new Promise<import('../../src/types').Feedback[]>((r) => { const off = a.feedback.subscribe((x) => { off(); r(x); }); });
      expect(rows.find((x) => x.id === f.id)).toMatchObject({ status: 'resolved' });
      expect((await fsp.readdir(dir)).includes('.docbench')).toBe(false);
      expect(JSON.parse(await fsp.readFile(path.join(pcHome, 'config.json'), 'utf8')).dataHome).toBe(homeDir);
    } finally { await fsp.rm(base, { recursive: true, force: true }); }
  });
});

describe('실제 디스크: 브라우저 어댑터 ↔ CLI 가 같은 폴더를 이어받는다', () => {
  it('피드백·회신·섹션 쓰기·판이 서로 맞는다', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'docbench-folder-'));
    try {
      await fsp.cp(path.join(repo, 'examples/sample-workspace'), dir, { recursive: true, filter: (s) => !/[\\/]\.docbench[\\/](?!config\.json)/.test(s) });
      const cli = async (...args: string[]) => (await run(process.execPath, [path.join(repo, 'bin/docbench.mjs'), ...args, '--json'], { cwd: dir })).stdout;
      const a = await open(fsFromNode(dir), { legacy: cp949 });

      // 어댑터가 단 피드백을 CLI 가 본다
      const f = await a.feedback.create({ docId: 'docs/운영-런북.md', target: { kind: 'section', path: ['알림 서비스 운영 런북', '배포 전 확인'], heading: '배포 전 확인' }, body: '롤백 시간 기준을 넣어 줘' });
      const waiting = JSON.parse(await cli('fb', 'list', '--waiting', 'assistant'));
      expect(waiting.map((x: { id: string }) => x.id)).toContain(f.id);

      // CLI 가 섹션을 고치고 회신 → 어댑터가 새 판·이력·회신을 읽는다
      const shown = JSON.parse(await cli('fb', 'show', f.id));
      const d0 = await a.docs.load('docs/운영-런북.md');
      expect(shown.doc?.version ?? shown.version).toBe(d0.version);
      const next = path.join(dir, 'next.md');
      await fsp.writeFile(next, '## 배포 전 확인\n\n- [ ] 롤백은 10분 안에 끝나야 한다\n');
      await cli('doc', 'write', 'docs/운영-런북.md', '--section', '알림 서비스 운영 런북 › 배포 전 확인', '--file', next, '--base', d0.version, '-m', '롤백 기준', '--fb', f.id);
      await cli('fb', 'reply', f.id, '-m', '기준을 넣었습니다', '--resolve');
      const d1 = await a.docs.load('docs/운영-런북.md');
      expect(d1.md).toContain('롤백은 10분 안에');
      expect((await a.docs.changes!()).at(-1)).toMatchObject({ docId: 'docs/운영-런북.md', summary: '롤백 기준', feedbackIds: [f.id], by: { kind: 'assistant' } });
      const rows = await new Promise<import('../../src/types').Feedback[]>((r) => { const off = a.feedback.subscribe((x) => { off(); r(x); }); });
      expect(rows.find((x) => x.id === f.id)).toMatchObject({ status: 'resolved', version: 2 });

      // 어댑터가 저장한 판을 CLI 가 같은 판으로 본다. CP949 문서도 바이트 그대로
      const cpId = 'notes/옛-회의록.md';
      const before = await fsp.readFile(path.join(dir, cpId));
      const c0 = await a.docs.load(cpId);
      expect([c0.encoding, c0.readOnly]).toEqual(['euc-kr', undefined]);
      const s = await a.docs.save!(cpId, c0.md.replace(/\n*$/, '\n\n## 덧붙임\n\n똠양꿍\n'), { baseVersion: c0.version });
      const after = await fsp.readFile(path.join(dir, cpId));
      expect(after.subarray(0, before.length - 2).equals(before.subarray(0, before.length - 2))).toBe(true);
      expect(iconv.decode(after, 'cp949')).toContain('똠양꿍');
      expect(JSON.parse(await cli('doc', 'show', cpId)).version).toBe(s.version);
    } finally { await fsp.rm(dir, { recursive: true, force: true }); }
  });
});

describe('기록은 처음 쓸 때 (D65) · 펼친 폴더만 (D64)', () => {
  const docsFs = () => fsFromMemory({ 'a.md': '# A\n\n## 절\n\n본문\n', 'sub/b.md': '# B\n' }, '문서');
  const fbIn = (docId = 'a.md') => ({ docId, target: { kind: 'doc' as const }, body: '확인' });

  it('기록 없이 열면 읽기·둘러보기만 하고 아무것도 쓰지 않는다 — 처음 쓸 때 한 번 묻는다(동시에 둘이어도 한 번)', async () => {
    const docs = docsFs();
    const data = fsFromMemory({}, '기록');
    let asked = 0;
    const a = await open(docs, { data: null, requestData: async () => { asked++; await new Promise((r) => setTimeout(r, 30)); return { fs: data, mode: 'outside' as const, home: '보관함', name: '문서' }; } });
    await a.docs.load('a.md');
    expect((await a.docs.tree!('sub'))!.map((x) => x.path)).toEqual(['sub/b.md']);
    expect([...docs.files.keys()].sort()).toEqual(['a.md', 'sub/b.md']);
    expect([...data.files.keys()]).toEqual([]);
    expect(asked).toBe(0);
    const [f1, f2] = await Promise.all([a.feedback.create(fbIn()), a.feedback.create(fbIn('sub/b.md'))]);
    expect(asked).toBe(1);
    expect([...data.files.keys()].filter((k) => k.startsWith('feedback/')).sort()).toEqual([`feedback/${f1.id}.json`, `feedback/${f2.id}.json`].sort());
    expect([...docs.files.keys()].sort()).toEqual(['a.md', 'sub/b.md']);   // 문서 폴더에는 문서만
    expect(a.workspace.dataLabel).toContain('보관함');
  });

  it('고르지 않으면(취소) 저장하지 않고 이유를 알린다 — 다음에 다시 묻는다', async () => {
    const docs = docsFs();
    let asked = 0;
    const a = await open(docs, { data: null, requestData: async () => { asked++; return null; } });
    await expect(a.feedback.create(fbIn())).rejects.toMatchObject({ code: 'NO_RECORDS' });
    await expect(a.feedback.create(fbIn())).rejects.toMatchObject({ code: 'NO_RECORDS' });
    expect(asked).toBe(2);
    expect([...docs.files.keys()].sort()).toEqual(['a.md', 'sub/b.md']);
  });

  it('기록이 아직 없어도 보고 있는 문서를 밖에서 고치면 다시 읽힌다(이력 없이)', async () => {
    const docs = docsFs();
    const a = await open(docs, { data: null, requestData: async () => null });
    await a.docs.load('a.md');
    a.docs.focus?.('a.md');
    const events: DocEvent[] = [];
    const off = a.docs.subscribe!((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 60));
    await docs.write('a.md', '# A\n\n## 절\n\n고친 본문\n');
    await expect.poll(() => events.some((e) => e.type === 'doc' && e.id === 'a.md'), { timeout: 2000 }).toBe(true);
    off();
    expect([...docs.files.keys()].sort()).toEqual(['a.md', 'sub/b.md']);
  });

  it('큰 폴더(드라이브·홈)는 맨 위만 훑고, 펼친 폴더의 문서가 목록에 더해진다', async () => {
    const fs = fsFromMemory({ 'Windows/x.txt': 'x', 'Program Files/app/readme.md': '# 앱\n', 'Users/dj/notes/회의.md': '# 주간 회의\n', '맨위.md': '# 맨 위\n' }, 'D');
    const a = await open(fs);
    const m = await a.docs.manifest();
    expect(Object.keys(m.docs)).toEqual(['맨위.md']);
    expect(m.index).toMatchObject({ complete: false, reason: 'big-root' });
    expect((await a.docs.tree!('')).map((x) => x.name)).toEqual(['Program Files', 'Users', 'Windows', '맨위.md']);
    expect(await a.docs.tree!('../x')).toBeNull();
    const t = await a.docs.tree!('Users/dj/notes');
    expect(t!.map((x) => [x.path, !!x.doc])).toEqual([['Users/dj/notes/회의.md', true]]);
    expect(Object.keys((await a.docs.manifest()).docs).sort()).toEqual(['Users/dj/notes/회의.md', '맨위.md']);
    expect((await a.docs.load('Users/dj/notes/회의.md')).md).toContain('주간 회의');
  });
});
