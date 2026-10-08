// @ts-check
/**
 * 작업 폴더 — 로컬 드라이브의 문서 폴더 하나를 DocBench 저장소로 쓴다.
 *
 *   <작업 폴더>/
 *     *.md                    문서 (정본은 언제나 이 파일들)
 *     .docbench/
 *       config.json           그룹·제목·규칙·AI 연결 (선택)
 *       feedback/<id>.json    피드백 한 건 = 파일 하나 (사람·AI 가 같이 읽고 쓴다)
 *       changes.jsonl         변경 이력 (한 줄 = 한 번 저장)
 *       blobs/<version>.md    본 적 있는 판의 본문 (바뀐 섹션 계산용, 커밋하지 않음)
 *       state.json            마지막으로 알던 문서 판 (외부 편집 감지용, 커밋하지 않음)
 *       viewstate/<user>.json 접기·깊이 등 보기 상태 (커밋하지 않음)
 *       inbox/                "AI에게 넘기기" 요청 (커밋하지 않음)
 *
 * 서버와 CLI 가 같은 클래스를 쓴다. 서버가 꺼져 있어도 CLI 만으로 일관되게 기록된다.
 */
import { promises as fs, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { decode, encode, hashBytes, atomicWrite, readJson, writeJson, canEncodeLegacy, EncodingReadOnlyError } from './textio.mjs';
import crypto from 'node:crypto';
import { matchAny } from './glob.mjs';
import { gitInfo, gitShowHead, gitStatus } from './git.mjs';
import { core } from './core.mjs';

export class ConflictError extends Error {
  /** @param {any} current */
  constructor(current) { super('conflict'); this.code = 'CONFLICT'; this.current = current; }
}
export class NotFoundError extends Error { constructor(what) { super('not found: ' + what); this.code = 'NOT_FOUND'; } }
export class BadRequestError extends Error { constructor(msg) { super(msg); this.code = 'BAD_REQUEST'; } }

/** 파일 이름에 쓸 수 있게: 모든 문자 체계의 글자·숫자는 남긴다 (김철수 → 김철수) @param {string} s */
const safeName = (s) => String(s).normalize('NFC').replace(/[^\p{L}\p{N}_.@-]/gu, '_').slice(0, 80) || 'me';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 경로 접두 비교 — 드라이브 루트(D:\)처럼 이미 구분자로 끝나는 뿌리도 맞게 @param {string} child @param {string} root */
function isInside(child, root) {
  const r = root.endsWith(path.sep) ? root : root + path.sep;
  return process.platform === 'win32' ? child.toLowerCase().startsWith(r.toLowerCase()) : child.startsWith(r);
}

const DEFAULT_CONFIG = {
  title: '',
  subtitle: '',
  include: ['**/*.md', '**/*.markdown'],
  exclude: ['node_modules/**', '.git/**', '.docbench/**', '**/.*/**', '.claude/**'],
  groups: /** @type {any[]} */ ([]),
  docs: /** @type {Record<string, any>} */ ({}),
  trust: undefined,
  milestones: undefined,
  render: undefined,
  assistantName: 'Claude',
  assistant: /** @type {any} */ (null),
  /** inbox: .docbench/inbox 에 요청 파일 · command: 넘기기 때 실행할 명령(배열) · message: 화면에 보일 안내 */
  notify: /** @type {{ inbox?: boolean, command?: string[] | null, message?: string | null }} */ ({ inbox: true, command: null, message: null }),
  readOnly: false,
  user: '',
  maxDocs: 2000,
  maxInventory: 4000,
  inventory: { flags: true },
};

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.docbench', '.svn', '.hg', '__pycache__', '.venv', 'dist', 'build', '.idea', '.vscode']);

export class Workspace {
  /** @param {string} root @param {{ actor?: any }} [opts] */
  constructor(root, opts = {}) {
    this.root = path.resolve(root);
    this.dir = path.join(this.root, '.docbench');
    this.actor = opts.actor;
    /** @type {typeof DEFAULT_CONFIG} */
    this.config = { ...DEFAULT_CONFIG };
    /** @type {Map<string, { abs: string, size: number, mtimeMs: number, title?: string, titleMtime?: number }>} */
    this.docs = new Map();
    /** @type {{ prefix: string } | null | undefined} */
    this.git = undefined;
    this.legacyWritable = false;
    /** @type {string | undefined} */
    this.realRoot = undefined;
    /** @type {Map<string, Promise<unknown>>} */
    this.chains = new Map();
  }

  // ------------------------------------------------------------ 시작
  async init() {
    const st = await fs.stat(this.root).catch(() => null);
    if (!st || !st.isDirectory()) throw new Error('작업 폴더가 없습니다: ' + this.root);
    await this.loadConfig();
    for (const d of ['feedback', 'blobs', 'viewstate', 'inbox']) await fs.mkdir(path.join(this.dir, d), { recursive: true });
    const gi = path.join(this.dir, '.gitignore');
    if (!(await fs.stat(gi).catch(() => null))) await fs.writeFile(gi, 'blobs/\nviewstate/\ninbox/\nlocks/\nstate.json\n*.tmp\n');
    this.legacyWritable = await canEncodeLegacy();
    this.git = await gitInfo(this.root).catch(() => null);
    await this.scan();
    return this;
  }

  async loadConfig() {
    const c = await readJson(path.join(this.dir, 'config.json'), {});
    this.config = { ...DEFAULT_CONFIG, ...c, notify: { ...DEFAULT_CONFIG.notify, ...(c?.notify || {}) } };
    if (!this.config.title) this.config.title = path.basename(this.root);
  }

  get userId() { return safeName(this.config.user || os.userInfo().username || 'me'); }
  get me() { return { kind: 'human', id: this.userId, name: this.config.user || os.userInfo().username }; }

  // ------------------------------------------------------------ 경로
  /** @param {string} p */
  rel(p) { return path.relative(this.root, p).split(path.sep).join('/'); }

  /** 문서 id → 절대 경로. 작업 폴더 밖이거나 대상 확장자가 아니면 거부 @param {string} id */
  resolve(id) {
    if (typeof id !== 'string' || !id || id.includes('\0') || path.isAbsolute(id) || /^[a-zA-Z]:/.test(id)) throw new BadRequestError('잘못된 문서 경로');
    const norm = path.posix.normalize(id.replace(/\\/g, '/'));
    if (norm.startsWith('../') || norm === '..' || norm.startsWith('/')) throw new BadRequestError('작업 폴더 밖 경로');
    const abs = path.resolve(this.root, norm);
    if (!isInside(abs, this.root)) throw new BadRequestError('작업 폴더 밖 경로');
    if (!this.isDoc(norm)) throw new BadRequestError('대상 문서가 아님: ' + norm);
    return abs;
  }

  /** @param {string} rel */
  isDoc(rel) { return matchAny(rel, this.config.include) && !matchAny(rel, this.config.exclude); }

  // ------------------------------------------------------------ 훑기
  async scan() {
    const found = new Map();
    const walk = async (dir, depth) => {
      if (depth > 12 || found.size >= this.config.maxDocs) return;
      let ents = [];
      try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(abs, depth + 1); continue; }
        const rel = this.rel(abs);
        if (!this.isDoc(rel)) continue;
        const st = await fs.stat(abs).catch(() => null);
        if (!st) continue;
        const prev = this.docs.get(rel);
        found.set(rel, { abs, size: st.size, mtimeMs: st.mtimeMs, title: prev?.titleMtime === st.mtimeMs ? prev.title : undefined, titleMtime: prev?.titleMtime });
      }
    };
    await walk(this.root, 0);
    const changed = found.size !== this.docs.size || [...found.keys()].some((k) => !this.docs.has(k));
    this.docs = found;
    return changed;
  }

  // ------------------------------------------------------------ 문서
  /**
   * 대소문자만 다른 id(Windows 는 같은 파일)를 디스크에 있는 이름으로 맞춘다 — 이력·피드백이 둘로 갈라지지 않게
   * @param {string} id
   */
  canonId(id) {
    if (typeof id !== 'string') return id;
    const norm = id.replace(/\\/g, '/').replace(/^\.\//, '');
    if (this.docs.has(norm)) return norm;
    const low = norm.toLowerCase();
    for (const k of this.docs.keys()) if (k.toLowerCase() === low) return k;
    return norm;
  }

  /**
   * 같은 대상(문서·피드백)에 대한 쓰기를 한 줄로 세운다. 프로세스 안은 약속 사슬, 서버·CLI 사이는 잠금 파일(O_EXCL).
   * @template T @param {string} key @param {() => Promise<T>} fn @returns {Promise<T>}
   */
  async withLock(key, fn) {
    const prev = this.chains.get(key) || Promise.resolve();
    let release = () => undefined;
    const mine = new Promise((r) => { release = () => r(undefined); });
    const tail = prev.then(() => mine);
    this.chains.set(key, tail);
    await prev;
    const lockFile = path.join(this.dir, 'locks', crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + '.lock');
    let fh = null;
    try {
      await fs.mkdir(path.dirname(lockFile), { recursive: true });
      for (let i = 0; ; i++) {
        try { fh = await fs.open(lockFile, 'wx'); break; } catch (e) {
          if (/** @type {any} */ (e).code !== 'EEXIST') throw e;
          const st = await fs.stat(lockFile).catch(() => null);
          if (st && Date.now() - st.mtimeMs > 15000) { await fs.rm(lockFile, { force: true }); continue; } // 죽은 잠금
          if (i > 100) throw Object.assign(new Error('다른 프로세스가 같은 문서를 쓰고 있습니다. 잠시 뒤 다시 시도하세요.'), { code: 'BUSY' });
          await sleep(30 + Math.random() * 40);
        }
      }
      await fh.writeFile(String(process.pid));
      return await fn();
    } finally {
      if (fh) { await fh.close().catch(() => undefined); await fs.rm(lockFile, { force: true }).catch(() => undefined); }
      release();
      if (this.chains.get(key) === tail) this.chains.delete(key);
    }
  }

  /** @param {string} id */
  async readRaw(id) {
    const abs = this.resolve(id);
    // 심볼릭 링크·정션으로 작업 폴더 밖을 가리키면 거부
    const real = await fs.realpath(abs).catch((e) => { if (e.code === 'ENOENT') throw new NotFoundError(id); throw e; });
    this.realRoot ??= await fs.realpath(this.root);
    if (!isInside(real, this.realRoot)) throw new BadRequestError('작업 폴더 밖 경로');
    const buf = await fs.readFile(abs).catch((e) => { if (e.code === 'ENOENT') throw new NotFoundError(id); throw e; });
    const st = await fs.stat(abs);
    return { abs, buf, st, ...decode(buf), version: hashBytes(buf) };
  }

  /** @param {string} id */
  async readDoc(id) {
    id = this.canonId(id);
    const r = await this.readRaw(id);
    await this.storeBlob(r.version, r.text);
    const over = this.config.docs?.[id] || {};
    const cfgRO = !!this.config.readOnly || !!over.readOnly;
    return {
      id, md: r.text, version: r.version, encoding: r.encoding, eol: r.eol, bom: r.bom, mixedEol: r.mixed || undefined,
      updatedAt: new Date(r.st.mtimeMs).toISOString(), size: r.st.size,
      readOnly: !r.writable || cfgRO || undefined,
      readOnlyReason: !r.writable ? r.readOnlyReason : cfgRO ? 'config' : undefined,
    };
  }

  /**
   * @param {string} id @param {string} md LF 텍스트
   * @param {{ baseVersion?: string, summary?: string, feedbackIds?: string[], convertTo?: 'utf-8', by?: any, force?: boolean }} o
   */
  async writeDoc(id, md, o = {}) {
    id = this.canonId(id);
    if (this.config.readOnly || this.config.docs?.[id]?.readOnly) throw Object.assign(new Error('읽기 전용 문서'), { code: 'READ_ONLY', reason: 'config' });
    if (typeof md !== 'string') throw new BadRequestError('md 가 필요합니다');
    return this.withLock('doc:' + id.toLowerCase(), () => this.writeDocLocked(id, md, o));
  }

  /** @param {string} id @param {string} md @param {any} o */
  async writeDocLocked(id, md, o) {
    // 그 사이 누가 파일을 직접 고쳤다면 그 변경을 먼저 이력에 남긴다
    await this.reconcile(id);
    const cur = await this.readRaw(id);
    if (!cur.writable && o.convertTo !== 'utf-8') throw new EncodingReadOnlyError(cur.encoding, cur.readOnlyReason || 'encoding');
    if (!o.force && o.baseVersion && o.baseVersion !== cur.version) {
      throw new ConflictError({ id, md: cur.text, version: cur.version, updatedAt: new Date(cur.st.mtimeMs).toISOString() });
    }
    const text = md.replace(/\r\n?/g, '\n');
    const buf = await encode(text, cur, o.convertTo);
    const version = hashBytes(buf);
    if (version === cur.version) return { version, updatedAt: new Date(cur.st.mtimeMs).toISOString(), unchanged: true };
    await this.storeBlob(cur.version, cur.text);
    await this.storeBlob(version, text);
    // 감시자가 이 쓰기를 '외부 편집'으로 오해하지 않게 먼저 새 판을 알려 둔다
    await this.setKnown(id, version);
    try { await atomicWrite(cur.abs, buf); } catch (e) { await this.setKnown(id, cur.version); throw e; }
    const updatedAt = new Date().toISOString();
    const ds = core.diffSections(cur.text, text);
    await this.appendChange({ at: updatedAt, docId: id, by: o.by || this.actor || this.me, summary: o.summary || undefined, fromVersion: cur.version, toVersion: version, feedbackIds: o.feedbackIds?.length ? o.feedbackIds : undefined, sections: [...ds.changed, ...ds.added] });
    const st = await fs.stat(cur.abs).catch(() => null);
    if (st) this.docs.set(id, { abs: cur.abs, size: st.size, mtimeMs: st.mtimeMs });
    return { version, updatedAt };
  }

  /** @param {string} id @param {string} v */
  async docVersion(id, v) {
    id = this.canonId(id);
    this.resolve(id);
    if (!/^[0-9a-f]{16}$/.test(v)) return null;
    try { return { id, md: await fs.readFile(path.join(this.dir, 'blobs', v + '.md'), 'utf8'), version: v }; } catch { return null; }
  }

  /** git HEAD 판 @param {string} id */
  async docBase(id) {
    id = this.canonId(id);
    this.resolve(id);
    if (!this.git) return null;
    const buf = await gitShowHead(this.root, this.git.prefix, id);
    if (!buf) return null;
    return { md: decode(buf).text, label: '커밋(HEAD)' };
  }

  /** @param {string} version @param {string} text */
  async storeBlob(version, text) {
    const f = path.join(this.dir, 'blobs', version + '.md');
    if (await fs.stat(f).catch(() => null)) return;
    await atomicWrite(f, text);
  }

  // ------------------------------------------------------------ 외부 편집 감지
  async known() { return (await readJson(path.join(this.dir, 'state.json'), { docs: {} })) || { docs: {} }; }
  /** @param {string} id @param {string} v */
  async setKnown(id, v) {
    await this.withLock('state', async () => {
      const s = await this.known();
      s.docs[id] = v;
      await writeJson(path.join(this.dir, 'state.json'), s);
    });
  }

  /**
   * 마지막으로 알던 판과 지금 파일이 다르면 '외부 편집' 기록을 남긴다(에디터·AI 가 직접 고친 경우).
   * @param {string} id @returns {Promise<boolean>} 바뀌었으면 true
   */
  async reconcile(id) {
    let r;
    try { r = await this.readRaw(id); } catch { return false; }
    const prev = (await this.known()).docs[id];
    await this.storeBlob(r.version, r.text);
    if (prev === r.version) return false;
    await this.setKnown(id, r.version);
    if (!prev) return false;
    if (await this.hasChangeTo(id, r.version)) return true;
    const old = await this.docVersion(id, prev);
    const ds = old ? core.diffSections(old.md, r.text) : null;
    await this.appendChange({ at: new Date(r.st.mtimeMs).toISOString(), docId: id, by: { kind: 'external' }, fromVersion: prev, toVersion: r.version, sections: ds ? [...ds.changed, ...ds.added] : undefined });
    return true;
  }
  async reconcileAll() {
    let n = 0;
    for (const id of this.docs.keys()) if (await this.reconcile(id)) n++;
    return n;
  }

  // ------------------------------------------------------------ 변경 이력
  get changesFile() { return path.join(this.dir, 'changes.jsonl'); }
  /** @param {any} entry */
  async appendChange(entry) {
    const clean = JSON.parse(JSON.stringify(entry));
    await fs.appendFile(this.changesFile, JSON.stringify(clean) + '\n');
  }
  /** @param {number} [limit] */
  async changes(limit = 300) {
    let text = '';
    try { text = await fs.readFile(this.changesFile, 'utf8'); } catch { return []; }
    const lines = text.split('\n').filter(Boolean).slice(-Math.max(limit * 2, 400));
    /** @type {any[]} */
    const out = [];
    for (const l of lines) { try { out.push(JSON.parse(l)); } catch { /* 깨진 줄 건너뜀 */ } }
    // note 줄(요약 덧붙이기)은 같은 판의 변경에 합친다
    const merged = [];
    for (const e of out) {
      if (e.type === 'note') {
        const tgt = [...merged].reverse().find((m) => m.docId === e.docId && (!e.toVersion || m.toVersion === e.toVersion));
        if (tgt) { tgt.summary = e.summary || tgt.summary; tgt.feedbackIds = [...new Set([...(tgt.feedbackIds || []), ...(e.feedbackIds || [])])]; if (e.by && tgt.by?.kind === 'external') tgt.by = e.by; continue; }
        merged.push({ ...e, type: undefined });
      } else merged.push(e);
    }
    return merged.slice(-limit);
  }
  /** @param {string} id @param {string} v */
  async hasChangeTo(id, v) {
    // 가장 최근 기록만 본다 — 예전 판으로 되돌린 외부 편집도 새 기록으로 남게
    const list = await this.changes(200);
    const last = list.filter((c) => c.docId === id).at(-1);
    return !!last && last.toVersion === v;
  }

  // ------------------------------------------------------------ 매니페스트
  /** @param {string} id */
  async titleOf(id) {
    const d = this.docs.get(id);
    if (!d) return path.posix.basename(id);
    if (d.title && d.titleMtime === d.mtimeMs) return d.title;
    let title = path.posix.basename(id).replace(/\.(md|markdown)$/i, '');
    try {
      const fh = await fs.open(d.abs, 'r');
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(8192), 0, 8192, 0);
      await fh.close();
      // 8 KB 에서 자르면 UTF-8 글자 중간이 끊길 수 있다 → 끝의 1~3바이트를 덜어 내며 UTF-8 로 먼저 읽어 본다
      let head = buffer.subarray(0, bytesRead);
      if (bytesRead === 8192) {
        for (let k = 0; k < 4; k++) {
          try { new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, head.length - k)); head = head.subarray(0, head.length - k); break; } catch { /* 한 바이트 더 */ }
        }
      }
      const text = decode(head).text;
      const m = text.match(/^#\s+(.+)$/m);
      if (m) title = core.headingPlain(m[1]).slice(0, 80);
    } catch { /* 이름으로 */ }
    d.title = title; d.titleMtime = d.mtimeMs;
    return title;
  }

  async manifest() {
    const c = this.config;
    const ids = [...this.docs.keys()].sort((a, b) => {
      const ra = /(^|\/)readme\.md$/i.test(a) ? 0 : 1, rb = /(^|\/)readme\.md$/i.test(b) ? 0 : 1;
      const da = a.split('/').length, db = b.split('/').length;
      return da - db || ra - rb || a.localeCompare(b, 'ko');
    });
    const groups = [];
    const taken = new Set();
    for (const g of c.groups || []) {
      const docs = ids.filter((id) => !taken.has(id) && matchAny(id, g.match || []));
      docs.forEach((d) => taken.add(d));
      groups.push({ id: g.id || g.label, label: g.label, note: g.note, docs, collapsed: g.collapsed });
    }
    const rest = ids.filter((id) => !taken.has(id));
    const byDir = new Map();
    for (const id of rest) {
      const top = id.includes('/') ? id.split('/')[0] : '';
      if (!byDir.has(top)) byDir.set(top, []);
      byDir.get(top).push(id);
    }
    for (const [dir, docs] of [...byDir.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0], 'ko')))) {
      groups.push({ id: 'dir:' + (dir || '.'), label: dir || '문서', docs });
    }
    groups.unshift({ id: '_bench', label: '작업대', docs: [], views: ['map', 'changes'] });
    /** @type {Record<string, any>} */
    const docs = {};
    for (const id of ids) {
      const d = this.docs.get(id);
      const over = c.docs?.[id] || {};
      docs[id] = {
        title: over.title || (await this.titleOf(id)),
        role: over.role, audience: over.audience, trust: over.trust, depth: over.depth, notice: over.notice,
        readOnly: c.readOnly || over.readOnly || undefined,
        source: { path: id, size: d?.size, modified: d ? new Date(d.mtimeMs).toISOString() : undefined },
      };
    }
    return {
      schema: 2,
      project: { name: c.title, subtitle: c.subtitle || this.root, links: c.links },
      milestones: c.milestones,
      trust: c.trust,
      groups,
      docs,
      render: c.render,
      assistantName: c.assistantName,
    };
  }

  // ------------------------------------------------------------ 피드백
  get fbDir() { return path.join(this.dir, 'feedback'); }
  /** @param {string} id */
  fbFile(id) {
    if (!/^[\w.-]{1,120}$/.test(id)) throw new BadRequestError('잘못된 피드백 id');
    return path.join(this.fbDir, id + '.json');
  }
  async listFeedback() {
    let names = [];
    try { names = await fs.readdir(this.fbDir); } catch { return []; }
    const out = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const raw = await readJson(path.join(this.fbDir, n));
      if (raw) out.push(core.normalizeFeedback(raw, n.slice(0, -5)));
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /** @param {string} id */
  async getFeedback(id) {
    const raw = await readJson(this.fbFile(id));
    if (!raw) throw new NotFoundError(id);
    return core.normalizeFeedback(raw, id);
  }
  /** @param {any} input @param {any} [by] */
  async createFeedback(input, by) {
    if (!input || typeof input !== 'object') throw new BadRequestError('본문이 필요합니다');
    const id = core.newFeedbackId();
    const now = new Date().toISOString();
    const f = core.normalizeFeedback({ ...input, author: input.author || by || this.actor || this.me, version: 1, createdAt: now, updatedAt: now }, id);
    if (f.docId) { f.docId = this.canonId(f.docId); this.resolve(f.docId); }
    await writeJson(this.fbFile(id), f);
    return f;
  }
  /** @param {string} id @param {any} patch @param {number} [version] */
  async updateFeedback(id, patch, version) {
    this.fbFile(id);
    return this.withLock('fb:' + id, () => this.updateFeedbackLocked(id, patch, version));
  }
  /** @param {string} id @param {any} patch @param {number} [version] */
  async updateFeedbackLocked(id, patch, version) {
    const cur = await this.getFeedback(id);
    if (version != null && cur.version != null && version !== cur.version) throw new ConflictError(cur);
    const { id: _i, createdAt: _c, version: _v, ...rest } = patch || {};
    const next = core.normalizeFeedback({ ...cur, ...rest, version: (cur.version || 1) + 1, updatedAt: new Date().toISOString() }, id);
    await writeJson(this.fbFile(id), next);
    return next;
  }
  /** @param {string} id */
  async deleteFeedback(id) { await fs.rm(this.fbFile(id), { force: true }); }

  // ------------------------------------------------------------ 보기 상태·요청함
  /** @param {string} [user] */
  async viewState(user = this.userId) { return readJson(path.join(this.dir, 'viewstate', safeName(user) + '.json')); }
  /** @param {any} s @param {string} [user] */
  async saveViewState(s, user = this.userId) { await writeJson(path.join(this.dir, 'viewstate', safeName(user) + '.json'), s); }
  /** @param {any} req */
  async addRequest(req) {
    const f = path.join(this.dir, 'inbox', `req-${Date.now()}.json`);
    await writeJson(f, { at: new Date().toISOString(), ...req });
    return f;
  }

  // ------------------------------------------------------------ 폴더 지도
  async inventory() {
    const items = [];
    const max = this.config.maxInventory;
    const status = this.git && this.config.inventory?.flags !== false ? await gitStatus(this.root, this.git.prefix) : new Map();
    const walk = async (dir, parent, depth) => {
      if (depth > 10 || items.length >= max) return;
      let ents = [];
      try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      ents.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of ents) {
        if (items.length >= max) break;
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        const rel = parent + e.name;
        if (e.isDirectory()) {
          if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          const st = await fs.stat(abs).catch(() => null);
          items.push({ id: rel + '/', parent, name: e.name, folder: true, modified: st ? new Date(st.mtimeMs).toISOString() : undefined });
          await walk(abs, rel + '/', depth + 1);
        } else if (e.isFile()) {
          const st = await fs.stat(abs).catch(() => null);
          const flags = [];
          const isDoc = this.docs.has(rel);
          if (isDoc) flags.push('doc');
          const gs = status.get(rel);
          if (gs) flags.push(gs);
          const ext = path.extname(e.name).slice(1).toLowerCase();
          items.push({ id: rel, parent, name: e.name, folder: false, kind: ext || 'file', size: st?.size, modified: st ? new Date(st.mtimeMs).toISOString() : undefined, flags, docId: isDoc ? rel : undefined });
        }
      }
    };
    await walk(this.root, '', 0);
    return {
      asof: new Date().toISOString(),
      source: this.root + (items.length >= max ? ` (처음 ${max}개)` : ''),
      items,
      flagLabels: { doc: { label: '문서', tone: 'good' }, modified: { label: '커밋 안 됨', tone: 'warn' }, untracked: { label: '새 파일', tone: 'info' }, added: { label: '추가됨', tone: 'info' } },
      open: [],
    };
  }

  // ------------------------------------------------------------ 감시
  /**
   * 파일이 바뀌면 이벤트를 낸다. Windows·macOS 는 재귀 감시, 안 되면 3초 폴링.
   * @param {(ev: { type: string, id?: string }) => void} emit
   */
  watch(emit) {
    /** @type {Map<string, NodeJS.Timeout>} */
    const timers = new Map();
    const later = (key, fn, ms = 250) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms)); };
    const onPath = (rel) => {
      if (!rel) return;
      rel = rel.split(path.sep).join('/');
      if (rel.startsWith('.docbench/feedback/')) return later('fb', () => emit({ type: 'feedback' }), 150);
      if (rel === '.docbench/changes.jsonl') return later('changes', () => emit({ type: 'changes' }), 200);
      if (rel === '.docbench/config.json') return later('config', async () => { await this.loadConfig(); await this.scan(); emit({ type: 'manifest' }); });
      if (rel.startsWith('.docbench/') || rel.split('/').some((s) => IGNORE_DIRS.has(s))) return;
      if (!this.isDoc(rel)) return;
      later('doc:' + rel, async () => {
        const listChanged = await this.scan();
        if (listChanged) emit({ type: 'manifest' });
        if (this.docs.has(rel) && (await this.reconcile(rel))) { emit({ type: 'doc', id: rel }); emit({ type: 'changes' }); }
      });
    };
    const self = this;
    let watcher = null;
    let poll = null;
    try {
      // 파일 이름 없이 오는 알림(Windows 버퍼 넘침 등)은 전체를 한 번 훑는다
      watcher = fsWatch(this.root, { recursive: true }, (_ev, file) => (file ? onPath(String(file)) : later('poll', () => void self.pollOnce(emit), 300)));
      watcher.on('error', () => { watcher?.close(); watcher = null; startPoll(); });
    } catch { startPoll(); }
    function startPoll() { if (!poll) poll = setInterval(() => void self.pollOnce(emit), 3000); }
    // 안전망: 네트워크 드라이브처럼 알림이 안 오는 곳을 위해 30초마다 한 번 훑는다
    const safety = setInterval(() => { if (!poll) void self.pollOnce(emit); }, 30000);
    return () => { watcher?.close(); if (poll) clearInterval(poll); clearInterval(safety); timers.forEach(clearTimeout); };
  }
  /** @param {(ev: {type: string, id?: string}) => void} emit */
  async pollOnce(emit) {
    const before = new Map([...this.docs].map(([k, v]) => [k, v.mtimeMs]));
    const listChanged = await this.scan();
    if (listChanged) emit({ type: 'manifest' });
    for (const [id, d] of this.docs) if (before.get(id) !== d.mtimeMs && (await this.reconcile(id))) { emit({ type: 'doc', id }); emit({ type: 'changes' }); }
  }
}

export { EncodingReadOnlyError };
