/**
 * 폴더 어댑터 — 서버 없이 브라우저가 로컬 문서 폴더를 직접 다룬다(엣지·크롬의 File System Access API).
 *
 *   const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
 *   const adapters = await createFolderAdapters(fsFromHandle(dir), { userName: '김철수' });
 *   createDocBench(el, { adapters });
 *
 * 디스크 모양은 서버·CLI 와 같다(src/core/workspace.ts) — 그래서 터미널의 Claude Code 가 `docbench fb …` 로
 * 같은 피드백을 이어받는다. 판(바이트 해시)·이력·잠금 파일 이름까지 같다.
 *
 * 서버와 다른 점 (브라우저라서):
 *  - 감시 대신 몇 초마다 확인한다(탭이 보일 때만).
 *  - 잠금 파일을 O_EXCL 로 못 만든다 → "없으면 쓰고 되읽어 내 것인지 확인" 후, 쓰기 직전에 판을 한 번 더 비교한다.
 *  - AI 제안(헤드리스 claude)·git 커밋본 비교는 없다. "넘기기"는 요청함 파일만 남긴다.
 */
import {
  DocConflictError, DocReadOnlyError, FeedbackConflictError,
  type ChangeEntry, type DocBenchAdapters, type DocContent, type DocEvent, type Feedback, type Inventory, type InventoryItem, type Manifest, type Person, type TreeEntry, type ViewState,
} from '../types';
import { normalizeFeedback, newFeedbackId } from '../core/feedback';
import { diffSections } from '../core/source';
import { decodeBytes, encodeText, createBrowserCp949, EncodingReadOnlyError, type Decoded, type LegacyCodec } from '../core/textcodec';
import {
  mergeConfig, isDocPath, walkable, buildManifest, parseChanges, lastChangeIs, changeLine, jsonFile, normalizeDocId, canonDocId,
  validFeedbackId, safeName, lockKey, requestFileName, titleFromText, parseJsonText, completeChangeLines, mergeGitignore, folderTally,
  DOT_GITIGNORE, LOCK_STALE_MS, INVENTORY_FLAG_LABELS, DATA_MARKER, newDataMarker, parseDataMarker, dataFolderName, docsSample, nextDocsSample, type WorkspaceConfig,
  looksBigRoot, toTreeEntries, SCAN_LIMITS, TREE_MAX,
} from '../core/workspace';
import { FsReadOnlyError, subFs, type FsEntry, type FsLike, type FsStat } from './folder-fs';
import { cleanRunEntry, completeJsonLines, liveRunners, makeRunRequest, pickRunner, runnerAlive, runFiles, validRunId } from '../core/runs';
import type { RunsAdapter, RunStatus, RunnerInfo, RunLogLine } from '../types';

/** 기록 폴더를 붙일 때 (처음 쓸 때 고르거나, 기억한 자리를 조용히) */
export interface DataAttach {
  fs: FsLike;
  mode: 'inside' | 'outside';
  /** 밖에 둘 때: 기록 보관함 폴더 이름과 그 안의 기록 폴더 이름 (설치 안내·화면 표시용) */
  home?: string;
  name?: string;
}

export interface FolderOptions {
  /**
   * 이 화면을 쓰는 사람 — id 는 계정(작성자·보기 상태·실행기 짝을 잇는 열쇠), name 은 표시 이름(별명, 없어도 된다).
   * 단일 HTML 은 이 브라우저에 계정을 자동으로 만든다(D63) — 처음에 이름을 묻지 않는다.
   */
  user?: { id: string; name?: string };
  /** (예전) 피드백 작성자 이름 — user 가 없으면 이것을 계정·이름으로 */
  userName?: string;
  /** 표시 이름을 바꿨을 때 (부르는 쪽이 기억한다) */
  onUserChange?: (u: { id: string; name?: string }) => void;
  /**
   * 기록 폴더가 아직 없을 때(data: null) 처음 쓰는 순간 부른다(D65) — 사람에게 자리를 묻고 붙일 것을 돌려준다.
   * null 이면 쓰지 않는다(RecordsNeededError). 보기 상태처럼 사람이 누르지 않은 쓰기에는 부르지 않는다.
   */
  requestData?: () => Promise<DataAttach | null>;
  /** 열 때 문서를 찾는 한도 (기본 SCAN_LIMITS) */
  scanLimits?: { visits: number; ms: number };
  /** CP949 코덱. 기본: 브라우저 내장 euc-kr 디코더로 만든 역표 (null = CP949 문서는 읽기 전용) */
  legacy?: LegacyCodec | null;
  /** 바뀜 확인 주기(ms). 기본 2500 */
  pollMs?: number;
  /** 파일 이름 대소문자 무시. 기본: Windows 면 켬 */
  caseInsensitive?: boolean;
  locale?: 'ko' | 'en';
  /** 실행기 설치 안내에 넣을 CLI 주소·지문 (단일 HTML 빌드가 넣는다) */
  runnerSetup?: { version: string; cliUrl: string; sha256: string };
  /**
   * 기록 폴더 (D57). 주지 않으면 문서 폴더 안 .docbench. 밖에 둘 때는 기록 보관함 아래 <문서 폴더 이름>/ —
   * subFs(fsFromHandle(보관함), dataFolderName(문서 폴더 이름)). 문서 폴더 안이나 문서 폴더를 품는 자리는 부르는 쪽이 막는다.
   * null = 아직 없음 — 읽기·둘러보기는 그대로 되고, 처음 쓸 때 requestData 로 묻는다(D65).
   */
  data?: FsLike | null;
  /** 기록 보관함의 폴더 이름과 그 안의 기록 폴더 이름 (밖에 둘 때 — 설치 안내·화면 표시용) */
  dataHome?: string;
  dataName?: string;
}

export type FolderAdapters = DocBenchAdapters & { workspace: FolderWorkspace; close(): void };

/** 문서 폴더 안에 기록을 둘 때의 자리 (예전 판·팀 공유) */
export const INSIDE_DIR = '.docbench';
/** 기록 폴더 안의 자리 (기록 폴더 기준 — 안이든 밖이든 같은 모양, src/core/workspace.ts) */
const P = {
  config: 'config.json', changes: 'changes.jsonl', state: 'state.json', gitignore: '.gitignore', marker: DATA_MARKER,
  fb: 'feedback', blobs: 'blobs', viewstate: 'viewstate', inbox: 'inbox', locks: 'locks',
  runs: 'runs', runners: 'runners',
};
const utf8 = new TextDecoder();
/** 몇 번에 한 번 다시 훑어도 되는 작은 폴더 (들른 항목 수) */
const SMALL_VISITS = 5000;
/** manifest 한 번에 새로 읽을 제목 수 */
const TITLE_BUDGET = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

class FolderError extends Error { constructor(public code: string, msg: string) { super(msg); } }

/** 기록 폴더를 고르지 않아 쓰지 않았다 (사람이 "취소"를 눌렀다) */
export class RecordsNeededError extends Error {
  readonly code = 'NO_RECORDS';
  constructor(locale?: 'ko' | 'en') {
    super(locale === 'en' ? 'No records folder was chosen, so nothing was saved — saving again asks again.' : '기록 폴더를 고르지 않아 저장하지 않았습니다 — 다시 저장하면 다시 묻습니다.');
  }
}

/** 판 = 바이트 sha256 앞 16자 (서버와 같다). 보안 문맥이 아니라 subtle 이 없으면 순수 JS 로 */
export async function versionOf(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return hex(await subtle.digest('SHA-256', bytes as BufferSource)).slice(0, 16);
  return sha256Hex(bytes).slice(0, 16);
}

/** 잠금 파일 이름 — 서버·CLI 와 같다 */
export async function lockFileName(key: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  // 서버·CLI 와 같은 이름: sha1(key) 앞 16자. 쓰기는 보안 문맥(= subtle 있음)에서만 하므로 대체 경로가 필요 없다
  if (!subtle) throw new FolderError('UNSUPPORTED', 'crypto.subtle 이 없는 환경에서는 쓸 수 없습니다');
  return hex(await subtle.digest('SHA-1', new TextEncoder().encode(key))).slice(0, 16) + '.lock';
}

const guessWindows = () => {
  const nav = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  return /win/i.test(nav?.userAgentData?.platform || nav?.platform || '');
};

interface DocInfo extends FsStat { title?: string; titleMtime?: number }
type Raw = Decoded & { bytes: Uint8Array; st: FsStat; version: string };

export class FolderWorkspace {
  config: WorkspaceConfig;
  docs = new Map<string, DocInfo>();
  /** 폴더 나무 (상대 경로 → 문서가 아닌 파일 수) */
  folders: Record<string, { files: number }> = { '': { files: 0 } };
  private folderSig = '';
  readonly ci: boolean;
  readonly legacy: LegacyCodec | null;
  private chains = new Map<string, Promise<unknown>>();
  /** 이 탭이 쓴 (문서, 판) — 이력 감시가 내 저장을 다시 알리지 않게. 그 줄을 한 번 보면 지운다(남이 같은 바이트로 되돌린 것은 알리게) */
  readonly ownWrites = new Set<string>();
  /** 화면이 지금 보고 있는 문서 — 매 확인마다 본다(나머지는 몇 번에 한 번 전체 훑기) */
  watching: string | null = null;
  /** 문서마다 마지막으로 디스크와 맞춰 본 시각 (화면의 "확인 n초 전") */
  readonly checked = new Map<string, number>();

  /** 기록 폴더 — 안(.docbench)이든 밖이든 같은 모양. null = 아직 없음(처음 쓸 때 묻는다) */
  data: FsLike | null;
  dataMode: 'inside' | 'outside' | 'none';
  private dataNames: { home?: string; name?: string } = {};
  private user: { id: string; name?: string };
  /** 문서 목록을 얼마나 찾았나 (manifest.index) */
  index: { complete: boolean; reason?: 'big-root' | 'many' } = { complete: true };

  constructor(public fs: FsLike, private o: FolderOptions = {}) {
    this.ci = o.caseInsensitive ?? guessWindows();
    this.legacy = o.legacy === undefined ? createBrowserCp949() : o.legacy;
    this.config = mergeConfig({}, fs.name);
    this.data = o.data === undefined ? subFs(fs, INSIDE_DIR) : o.data;
    this.dataMode = o.data === undefined ? 'inside' : o.data ? 'outside' : 'none';
    this.dataNames = { home: o.dataHome, name: o.dataName };
    this.user = o.user ? { ...o.user } : o.userName ? { id: safeName(o.userName), name: o.userName } : { id: 'me' };
  }

  /** 문서 폴더에 쓸 수 있고, 기록 폴더가 있으면 거기에도 쓸 수 있다 (기록이 아직 없으면 처음 쓸 때 묻는다) */
  get writable(): boolean { return this.fs.writable && (!this.data || this.data.writable); }
  /** 기록 폴더가 붙어 있다 */
  get hasData(): boolean { return !!this.data; }
  /** 화면에 보일 기록 자리 — '기획 문서/.docbench' 또는 '기록 보관함/기획 문서' (없으면 '') */
  get dataLabel(): string {
    if (!this.data) return '';
    return this.dataMode === 'inside' ? `${this.fs.name}/${INSIDE_DIR}` : this.dataNames.home ? `${this.dataNames.home}/${this.dataNames.name || dataFolderName(this.fs.name)}` : this.data.name;
  }
  get dataHomeName(): string | undefined { return this.dataMode === 'outside' ? this.dataNames.home : undefined; }
  get dataFolderName(): string | undefined { return this.dataMode === 'outside' ? this.dataNames.name || dataFolderName(this.fs.name) : undefined; }
  get userName(): string { return this.user.name || ''; }
  get me(): Person { return { kind: 'human', id: this.user.id, ...(this.user.name ? { name: this.user.name } : {}) }; }
  setUserName(name: string): Person {
    this.user = { ...this.user, name: name.trim().slice(0, 60) || undefined };
    this.o.onUserChange?.({ ...this.user });
    return this.me;
  }

  async init(): Promise<this> {
    await this.loadConfig();
    await this.scan();
    if (this.data) await this.prepareData();
    return this;
  }

  /** 붙은 기록 폴더 준비: 안이면 .gitignore, 밖이면 어느 문서 폴더의 기록인지 표식 */
  private async prepareData(): Promise<void> {
    if (!this.data || !this.writable) return;
    if (this.dataMode === 'inside') {
      // 서버 init 과 같이 .docbench/ 를 만든다 — CLI 는 이 폴더가 있어야 작업 폴더로 알아본다.
      // 예전 판이 만든 .gitignore 에도 빠진 줄을 덧붙인다(사람이 더한 줄은 그대로)
      const gi = await this.readText(P.gitignore).catch(() => null);
      const next = gi == null ? DOT_GITIGNORE : mergeGitignore(gi);
      if (next != null) await this.data.write(P.gitignore, next);
      return;
    }
    // 밖에 둔 기록: 어느 문서 폴더의 기록인지 표식(브라우저는 경로를 모른다 — 앱·CLI 가 docsPath 를 채운다).
    // 문서 표본은 문서가 늘고 줄어도 따라가게 연 때마다 고친다(이름이 같은 다른 문서 폴더를 가려내는 데 쓴다)
    const m = parseDataMarker(await this.readJson<unknown>(P.marker, null));
    if (!m) await this.writeJson(P.marker, newDataMarker(this.fs.name, undefined, docsSample(this.docs.keys())));
    else {
      if (m.docsName !== this.fs.name) this.markerMismatch = m.docsName;
      const docs = nextDocsSample(m.docs, this.docs.keys());
      if (!m.migrating && JSON.stringify(m.docs || []) !== JSON.stringify(docs)) await this.writeJson(P.marker, { ...m, docs });
    }
  }

  /** 기록 폴더가 붙으면 (어댑터가 화면에 피드백·목록을 다시 읽게 알린다) */
  onDataAttached: (() => void) | null = null;

  /** 기록 폴더를 붙인다 (처음 쓸 때 고른 자리) — 설정을 다시 읽고, 아는 문서를 맞춰 본다 */
  async attachData(a: DataAttach): Promise<void> {
    this.data = a.fs;
    this.dataMode = a.mode;
    this.dataNames = { home: a.home, name: a.name };
    await this.loadConfig();
    await this.prepareData();
    await this.reconcileAll().catch(() => 0);
    this.onDataAttached?.();
  }

  private asking: Promise<void> | null = null;
  /** 쓰기 전에: 기록 폴더가 없으면 사람에게 묻는다(한 번에 하나) — 고르지 않으면 RecordsNeededError */
  async ensureData(): Promise<FsLike> {
    if (this.data) return this.data;
    if (!this.o.requestData) throw new RecordsNeededError(this.o.locale);
    this.asking ||= (async () => {
      try {
        const a = await this.o.requestData!();
        if (a) await this.attachData(a);
      } finally { this.asking = null; }
    })();
    await this.asking;
    if (!this.data) throw new RecordsNeededError(this.o.locale);
    return this.data;
  }

  async loadConfig(): Promise<void> {
    // 서버와 같은 규칙. 브라우저는 PC 설정을 읽지 않는다 — 명령은 실행하지 않고, 사람은 이 브라우저의 계정으로
    this.config = mergeConfig(this.data ? await this.readJson(P.config, {}) : {}, this.fs.name);
  }

  /** 기록 폴더의 표식이 다른 이름의 문서 폴더를 가리킨다(같은 기록 폴더를 다른 문서 폴더에 고름) — 화면이 알린다 */
  markerMismatch: string | null = null;

  // ------------------------------------------------------------ 작은 파일 도우미 (기록 폴더)
  async readText(path: string): Promise<string | null> {
    if (!this.data) return null;
    const f = await this.data.read(path);
    return f ? utf8.decode(f.bytes) : null;
  }
  async readJson<T>(path: string, fallback: T): Promise<T> {
    try { const t = await this.readText(path); return t == null ? fallback : (parseJsonText(t) as T); } catch { return fallback; }
  }
  async writeJson(path: string, obj: unknown): Promise<void> { await (await this.ensureData()).write(path, jsonFile(obj)); }

  // ------------------------------------------------------------ 줄 세우기
  /**
   * 같은 대상 쓰기를 한 줄로. 탭 안은 약속 사슬, 서버·CLI 와는 같은 이름의 잠금 파일.
   * 브라우저는 O_EXCL 이 없어서 "비어 있으면 내 표식을 쓰고 잠깐 뒤 되읽어 그대로인지" 확인한다.
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) || Promise.resolve();
    let release = () => undefined as void;
    const mine = new Promise<void>((r) => { release = r; });
    const tail = prev.then(() => mine);
    this.chains.set(key, tail);
    await prev;
    let file: string | null = null;
    const data = this.data;
    try {
      if (this.writable && data) {
        file = `${P.locks}/${await lockFileName(key)}`;
        const token = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const started = Date.now();
        for (;;) {
          const st = await data.stat(file);
          if (st && Date.now() - st.mtimeMs <= LOCK_STALE_MS) {
            // 죽은 잠금이 치워질 때(15초)보다 조금 더 기다린다
            if (Date.now() - started > LOCK_STALE_MS + 3000) throw new FolderError('BUSY', '다른 프로그램이 같은 문서를 쓰고 있습니다. 잠시 뒤 다시 시도하세요.');
            await sleep(30 + Math.random() * 40);
            continue;
          }
          await data.write(file, token);
          await sleep(25);
          if ((await this.readText(file)) === token) break;
        }
      }
      return await fn();
    } finally {
      if (file && data) await data.remove(file).catch(() => undefined);
      release();
      if (this.chains.get(key) === tail) this.chains.delete(key);
    }
  }

  // ------------------------------------------------------------ 훑기
  /** 나무에서 찾은 문서 — 한도에 닿아 다 훑지 못한 큰 폴더에서도 목록에 남긴다 */
  private fromTree = new Set<string>();
  /** 마지막 훑기에서 들른 항목 수 (작은 폴더만 몇 번에 한 번 다시 훑는다) */
  private lastVisits = 0;

  /**
   * 문서를 찾는다 — **한도 안에서만**(D64): 들른 항목 수·시간(SCAN_LIMITS), 문서 수(maxDocs). 얕은 곳부터(너비 우선)라 한도에 닿으면
   * 깊은 곳이 빠진다(펼치면 tree 가 더한다). 드라이브·홈 맨 위처럼 큰 폴더는 맨 위만 본다.
   * 예전에는 하위 12단계까지 전부 훑고 문서를 모두 읽어 드라이브를 열면 멈췄다(주인 실사용).
   */
  async scan(): Promise<boolean> {
    const lim = this.o.scanLimits || SCAN_LIMITS;
    const found = new Map<string, DocInfo>();
    const tally = folderTally();
    const top = (await this.fs.list('').catch(() => null)) || [];
    const big = looksBigRoot(this.fs.name, top.map((e) => e.name));
    const started = Date.now();
    let visits = 0;
    let capped = false;
    const queue: { dir: string; depth: number; ents?: FsEntry[] }[] = [{ dir: '', depth: 0, ents: top }];
    outer: while (queue.length) {
      const { dir, depth, ents: pre } = queue.shift()!;
      const ents = pre || (await this.fs.list(dir).catch(() => null)) || [];
      for (const e of ents) {
        visits++;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.kind === 'directory') {
          if (!walkable(e.name)) continue;
          tally.dir(rel);
          if (!big && depth < 12) queue.push({ dir: rel, depth: depth + 1 });
          continue;
        }
        const isDoc = isDocPath(rel, this.config, this.ci);
        tally.file(rel, isDoc);
        if (!isDoc) continue;
        if (found.size >= this.config.maxDocs) { capped = true; break outer; }
        const st = await this.fs.stat(rel).catch(() => null);
        if (!st) continue;
        const prev = this.docs.get(rel);
        found.set(rel, { ...st, title: prev?.titleMtime === st.mtimeMs ? prev.title : undefined, titleMtime: prev?.titleMtime });
      }
      if (visits > lim.visits || Date.now() - started > lim.ms) { capped = queue.length > 0; break; }
    }
    // 한도에 닿았으면 나무에서 찾은 문서를 남긴다(다 훑었으면 디스크가 정답)
    if (capped || big) for (const id of this.fromTree) { const prev = this.docs.get(id); if (prev && !found.has(id)) found.set(id, prev); }
    this.index = big ? { complete: false, reason: 'big-root' } : capped ? { complete: false, reason: 'many' } : { complete: true };
    this.lastVisits = visits;
    const folders = tally.result();
    const sig = Object.keys(folders).sort().join('|');
    const changed = found.size !== this.docs.size || [...found.keys()].some((k) => !this.docs.has(k)) || sig !== this.folderSig;
    this.docs = found;
    this.folders = folders;
    this.folderSig = sig;
    return changed;
  }

  /**
   * 폴더 하나의 항목 — 탐색기처럼 펼친 폴더만 읽는다. 여기서 본 문서는 문서 목록에도 더한다(큰 폴더에서 열고 피드백할 수 있게).
   * 숨김·의존성·시스템 폴더는 뺀다. 한 폴더에 TREE_MAX 개까지.
   */
  async tree(dir: string): Promise<TreeEntry[] | null> {
    const d = dir ? normalizeDocId(dir) : '';
    if (d === null) return null;
    const ents = await this.fs.list(d).catch(() => null);
    if (!ents) return null;
    const items = toTreeEntries(ents, d, this.config, this.ci).slice(0, TREE_MAX);
    // 이 폴더에서 사라진 문서는 목록에서도 뺀다(큰 폴더는 다시 훑지 않으므로 여기서)
    const here = new Set(items.map((x) => x.path));
    const parent = (id: string) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');
    for (const id of [...this.docs.keys()]) if (parent(id) === d && !here.has(id)) { this.docs.delete(id); this.fromTree.delete(id); }
    for (const it of items) {
      if (!it.doc || this.docs.has(it.path)) continue;
      this.docs.set(it.path, { size: 0, mtimeMs: 0 });
      this.fromTree.add(it.path);
    }
    return items;
  }

  // ------------------------------------------------------------ 문서
  canonId(id: string): string { return typeof id === 'string' ? canonDocId(id, this.docs.keys()) : id; }

  resolve(id: string): string {
    const norm = normalizeDocId(id);
    if (!norm) throw new FolderError('BAD_REQUEST', '작업 폴더 밖 경로');
    if (!isDocPath(norm, this.config, this.ci)) throw new FolderError('BAD_REQUEST', '대상 문서가 아님: ' + norm);
    return norm;
  }

  async readRaw(id: string): Promise<Raw> {
    const p = this.resolve(id);
    const f = await this.fs.read(p);
    if (!f) throw new FolderError('NOT_FOUND', 'not found: ' + id);
    return { bytes: f.bytes, st: { size: f.size, mtimeMs: f.mtimeMs }, ...decodeBytes(f.bytes, this.legacy), version: await versionOf(f.bytes) };
  }

  async readDoc(id: string): Promise<DocContent & { eol: string; bom: boolean; mixedEol?: boolean; size: number }> {
    id = this.canonId(id);
    const r = await this.readRaw(id);
    await this.storeBlob(r.version, r.text);
    // 연 문서부터 따라간다(D64) — 처음 열면 판을 적어 두어, 그 뒤 바깥 편집을 이력에 남긴다. 알던 판은 덮지 않는다(바뀐 것을 잃지 않게)
    await this.trackFirst(id, r.version);
    const cfgRO = !!this.config.readOnly || !!this.config.docs?.[id]?.readOnly;
    return {
      id, md: r.text, version: r.version, encoding: r.encoding, eol: r.eol, bom: r.bom, mixedEol: r.mixed || undefined,
      updatedAt: new Date(r.st.mtimeMs).toISOString(), size: r.st.size,
      readOnly: !r.writable || cfgRO || !this.writable || undefined,
      readOnlyReason: !r.writable ? r.readOnlyReason : cfgRO ? 'config' : !this.writable ? 'folder' : undefined,
    };
  }

  async writeDoc(id: string, md: string, o: { baseVersion?: string; summary?: string; feedbackIds?: string[]; convertTo?: 'utf-8'; by?: Person; force?: boolean } = {}): Promise<{ version: string; updatedAt?: string; unchanged?: boolean }> {
    id = this.canonId(id);
    if (this.config.readOnly || this.config.docs?.[id]?.readOnly) throw new DocReadOnlyError('config', '읽기 전용 문서');
    if (!this.writable) throw new DocReadOnlyError('folder', new FsReadOnlyError().message);
    if (typeof md !== 'string') throw new FolderError('BAD_REQUEST', 'md 가 필요합니다');
    // 이력·판·잠금은 기록 폴더에 — 아직 없으면 지금 묻는다(D65)
    await this.ensureData();
    return this.withLock(lockKey.doc(id), () => this.writeDocLocked(id, md, o));
  }

  private async writeDocLocked(id: string, md: string, o: { baseVersion?: string; summary?: string; feedbackIds?: string[]; convertTo?: 'utf-8'; by?: Person; force?: boolean }) {
    // 그 사이 누가 파일을 직접 고쳤다면 그 변경을 먼저 이력에 남긴다
    await this.reconcile(id);
    const cur = await this.readRaw(id);
    const conflict = (c: Raw) => new DocConflictError({ id, md: c.text, version: c.version, updatedAt: new Date(c.st.mtimeMs).toISOString() });
    if (!cur.writable && o.convertTo !== 'utf-8') throw new DocReadOnlyError(cur.readOnlyReason || 'encoding', new EncodingReadOnlyError(cur.encoding, cur.readOnlyReason || 'encoding').message);
    if (!o.force && o.baseVersion && o.baseVersion !== cur.version) throw conflict(cur);
    const text = md.replace(/\r\n?/g, '\n');
    let bytes: Uint8Array;
    try { bytes = encodeText(text, cur, o.convertTo, this.legacy); } catch (e) {
      if (e instanceof EncodingReadOnlyError) throw new DocReadOnlyError(e.reason, e.message);
      throw e;
    }
    const version = await versionOf(bytes);
    if (version === cur.version) return { version, updatedAt: new Date(cur.st.mtimeMs).toISOString(), unchanged: true };
    await this.storeBlob(cur.version, cur.text);
    await this.storeBlob(version, text);
    const updatedAt = new Date().toISOString();
    const ds = diffSections(cur.text, text);
    // 문서 쓰기와 그 이력 줄은 한 덩어리 — 이력 잠금을 먼저 잡고 쓴다(못 잡으면 문서도 쓰지 않는다). 잠금 순서: 문서 → 이력 → 상태
    await this.withLock(lockKey.changes, async () => {
      // 감시가 이 쓰기를 '외부 편집'으로 오해하지 않게 먼저 새 판을 알려 둔다
      await this.setKnown(id, version);
      try {
        // 잠금이 완전하지 않으니 쓰기 직전에 한 번 더 — 그 사이 누가 고쳤으면 덮지 않는다
        const now = await this.fs.read(this.resolve(id));
        if (!now || (await versionOf(now.bytes)) !== cur.version) { await this.setKnown(id, cur.version); throw conflict(await this.readRaw(id)); }
        this.noteOwnWrite(id, version);
        await this.fs.write(this.resolve(id), bytes);
      } catch (e) {
        if (!(e instanceof DocConflictError)) await this.setKnown(id, cur.version);
        throw e;
      }
      await this.data!.append(P.changes, changeLine({ at: updatedAt, docId: id, by: o.by || this.me, summary: o.summary || undefined, fromVersion: cur.version, toVersion: version, feedbackIds: o.feedbackIds?.length ? o.feedbackIds : undefined, sections: [...ds.changed, ...ds.added], removed: ds.removed.length ? ds.removed : undefined }));
    });
    const st = await this.fs.stat(this.resolve(id)).catch(() => null);
    if (st) this.docs.set(id, { ...st });
    return { version, updatedAt };
  }

  async docVersion(id: string, v: string): Promise<{ id: string; md: string; version: string } | null> {
    id = this.canonId(id);
    this.resolve(id);
    if (!/^[0-9a-f]{16}$/.test(v)) return null;
    const md = await this.readText(`${P.blobs}/${v}.md`).catch(() => null);
    return md == null ? null : { id, md, version: v };
  }

  async storeBlob(version: string, text: string): Promise<void> {
    const data = this.data;
    if (!this.writable || !data) return;
    const f = `${P.blobs}/${version}.md`;
    if (await data.stat(f)) return;
    await data.write(f, text);
  }

  // ------------------------------------------------------------ 외부 편집 감지
  async known(): Promise<{ docs: Record<string, string> }> {
    const s = await this.readJson<{ docs?: Record<string, string> }>(P.state, { docs: {} });
    return { ...s, docs: s?.docs || {} };
  }
  /** 처음 연 문서의 판을 적는다 (이미 알던 문서는 그대로 — 바뀌었으면 reconcile 이 이력으로 남긴다) */
  async trackFirst(id: string, v: string): Promise<void> {
    if (!this.writable || !this.data) return;
    if ((await this.known()).docs[id]) return;
    await this.withLock(lockKey.state, async () => {
      const s = await this.known();
      if (s.docs[id]) return;
      s.docs[id] = v;
      await this.writeJson(P.state, s);
    });
  }

  async setKnown(id: string, v: string): Promise<void> {
    if (!this.writable || !this.data) return;
    await this.withLock(lockKey.state, async () => {
      const s = await this.known();
      s.docs[id] = v;
      await this.writeJson(P.state, s);
    });
  }

  /** 마지막으로 알던 판과 지금 파일이 다르면 '외부 편집' 기록을 남긴다. 바뀌었으면 true */
  async reconcile(id: string): Promise<boolean> {
    if (!this.writable || !this.data) return false;
    let r: Raw;
    try { r = await this.readRaw(id); } catch { return false; }
    const prev = (await this.known()).docs[id];
    await this.storeBlob(r.version, r.text);
    if (prev === r.version) return false;
    await this.setKnown(id, r.version);
    if (!prev) return false;
    if (lastChangeIs(await this.changes(200), id, r.version)) return true;
    const old = await this.docVersion(id, prev);
    const ds = old ? diffSections(old.md, r.text) : null;
    await this.appendChange({ at: new Date(r.st.mtimeMs).toISOString(), docId: id, by: { kind: 'external' }, fromVersion: prev, toVersion: r.version, sections: ds ? [...ds.changed, ...ds.added] : undefined, removed: ds?.removed.length ? ds.removed : undefined });
    return true;
  }
  /**
   * 열 때 한 번: **알던 문서만** 디스크와 맞춰 본다(바뀌었으면 외부 편집으로 기록). 처음 보는 문서는 읽지 않는다 —
   * 열거나 피드백할 때 판을 적는다(D64). 예전에는 문서를 모두 읽어 해시해 큰 폴더(드라이브)를 열면 멈췄다(주인 실사용).
   */
  async reconcileAll(): Promise<number> {
    if (!this.writable || !this.data) return 0;
    const known = (await this.known()).docs;
    // 목록 밖(큰 폴더의 깊은 곳)이라도 따라가던 문서가 디스크에 있으면 맞춰 본다(서버와 같게)
    for (const id of Object.keys(known)) {
      if (this.docs.has(id) || this.docs.has(this.canonId(id))) continue;
      if (normalizeDocId(id) !== id || !isDocPath(id, this.config, this.ci)) continue;   // 기록 파일은 남이 꾸밀 수 있다
      const st = await this.fs.stat(id).catch(() => null);
      if (st) { this.docs.set(id, st); this.fromTree.add(id); }
    }
    const ids = Object.keys(known).filter((id) => this.docs.has(id) || this.docs.has(this.canonId(id)));
    let n = 0;
    for (let i = 0; i < ids.length; i += 8) {
      const res = await Promise.all(ids.slice(i, i + 8).map(async (id) => {
        let r: Raw;
        try { r = await this.readRaw(id); } catch { return false; }
        return known[id] !== r.version ? this.reconcile(id) : false;
      }));
      n += res.filter(Boolean).length;
    }
    return n;
  }

  // ------------------------------------------------------------ 변경 이력
  async changes(limit = 300): Promise<ChangeEntry[]> {
    const text = await this.readText(P.changes).catch(() => null);
    return text ? parseChanges(text, limit) : [];
  }
  noteOwnWrite(id: string, v: string): void {
    this.ownWrites.add(id + '\0' + v);
    if (this.ownWrites.size > 500) this.ownWrites.delete(this.ownWrites.values().next().value!);
  }

  /** 브라우저에는 O_APPEND 가 없어 파일을 바꿔 끼운다 — 탭 안·서버·CLI 와 같은 잠금 안에서 덧붙여야 줄이 사라지지 않는다 */
  async appendChange(entry: ChangeEntry): Promise<void> {
    const data = await this.ensureData();
    await this.withLock(lockKey.changes, () => data.append(P.changes, changeLine(entry)));
  }

  // ------------------------------------------------------------ 매니페스트
  async titleOf(id: string): Promise<string> {
    const d = this.docs.get(id);
    if (!d) return titleFromText('', id);
    if (d.title && d.titleMtime === d.mtimeMs) return d.title;
    let title = titleFromText('', id);
    try {
      const f = await this.fs.read(id, 8192);
      if (f) {
        let head = f.bytes;
        // 8 KB 에서 자르면 UTF-8 글자 중간이 끊길 수 있다 → 끝의 1~3바이트를 덜어 내며 UTF-8 로 먼저 읽어 본다
        if (f.size > head.length) {
          for (let k = 0; k < 4; k++) {
            try { new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, head.length - k)); head = head.subarray(0, head.length - k); break; } catch { /* 한 바이트 더 */ }
          }
        }
        title = titleFromText(decodeBytes(head, this.legacy).text, id);
      }
    } catch { /* 이름으로 */ }
    d.title = title; d.titleMtime = d.mtimeMs;
    return title;
  }

  async manifest(): Promise<Manifest> {
    const info = new Map<string, { title: string; size: number; mtimeMs: number }>();
    // 제목(첫 # 줄)은 앞 8 KB 를 읽어야 한다 — 문서가 많으면 한 번에 TITLE_BUDGET 개만 새로 읽고 나머지는 파일 이름(다음에 채운다)
    let budget = TITLE_BUDGET;
    for (const [id, d] of this.docs) {
      const cached = d.title && d.titleMtime === d.mtimeMs;
      const title = cached || budget-- > 0 ? await this.titleOf(id) : titleFromText('', id);
      info.set(id, { title, size: d.size, mtimeMs: d.mtimeMs });
    }
    const m = buildManifest(this.config, [...this.docs.keys()], (id) => info.get(id), this.fs.name, this.ci, { folders: this.folders, rootName: this.fs.name });
    // 기록 폴더의 표식이 다른 이름의 문서 폴더를 가리키면(같은 이름의 다른 폴더 등) 화면 아래 기록 자리 옆에 알린다
    const mm = this.markerMismatch;
    const en = this.o.locale === 'en';
    m.project.storage = this.data ? this.dataLabel + (mm ? (en ? ` — marked as records of "${mm}"` : ` — "${mm}" 의 기록으로 표시됨`) : '') : (en ? 'not chosen yet — asked when you first save' : '아직 없음 — 처음 저장할 때 고릅니다');
    m.index = { ...this.index, docs: this.docs.size };
    return m;
  }

  // ------------------------------------------------------------ 피드백
  fbPath(id: string): string {
    if (!validFeedbackId(id)) throw new FolderError('BAD_REQUEST', '잘못된 피드백 id');
    return `${P.fb}/${id}.json`;
  }
  async listFeedback(): Promise<Feedback[]> {
    if (!this.data) return [];
    const names = (await this.data.list(P.fb)) || [];
    const out: Feedback[] = [];
    for (const n of names) {
      if (n.kind !== 'file' || !n.name.endsWith('.json')) continue;
      const raw = await this.readJson<Record<string, unknown> | null>(`${P.fb}/${n.name}`, null);
      if (raw) out.push(normalizeFeedback(raw as never, n.name.slice(0, -5)));
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getFeedback(id: string): Promise<Feedback> {
    const raw = await this.readJson<Record<string, unknown> | null>(this.fbPath(id), null);
    if (!raw) throw new FolderError('NOT_FOUND', 'not found: ' + id);
    return normalizeFeedback(raw as never, id);
  }
  async createFeedback(input: Record<string, unknown>): Promise<Feedback> {
    if (!this.writable) throw new FsReadOnlyError();
    await this.ensureData();
    const id = newFeedbackId();
    const now = new Date().toISOString();
    const f = normalizeFeedback({ ...input, author: input.author || this.me, version: 1, createdAt: now, updatedAt: now } as never, id);
    if (f.docId) { f.docId = this.canonId(f.docId); this.resolve(f.docId); }
    await this.writeJson(this.fbPath(id), f);
    return f;
  }
  async updateFeedback(id: string, patch: Partial<Feedback>, version?: number): Promise<Feedback> {
    if (!this.writable) throw new FsReadOnlyError();
    this.fbPath(id);
    await this.ensureData();
    return this.withLock(lockKey.feedback(id), async () => {
      const cur = await this.getFeedback(id);
      if (version != null && cur.version != null && version !== cur.version) throw new FeedbackConflictError(cur);
      const { id: _i, createdAt: _c, version: _v, ...rest } = patch || {};
      const next = normalizeFeedback({ ...cur, ...rest, version: (cur.version || 1) + 1, updatedAt: new Date().toISOString() } as never, id);
      // 잠금이 최선 노력이라 쓰기 직전에 다시 본다 — 그 사이 CLI 가 회신했으면 덮지 않는다
      const again = await this.getFeedback(id);
      if (again.version !== cur.version) throw new FeedbackConflictError(again);
      await this.writeJson(this.fbPath(id), next);
      return next;
    });
  }
  async deleteFeedback(id: string): Promise<void> { if (!this.writable) throw new FsReadOnlyError(); await (await this.ensureData()).remove(this.fbPath(id)); }

  // ------------------------------------------------------------ 보기 상태·요청함
  viewStatePath(): string { return `${P.viewstate}/${safeName(this.me.id || 'me')}.json`; }
  async viewState(): Promise<ViewState | null> { return this.readJson<ViewState | null>(this.viewStatePath(), null); }
  /** 보기 상태는 사람이 누른 쓰기가 아니다 — 기록 폴더가 아직 없으면 묻지 않고 건너뛴다(화면은 브라우저에 따로 둔다) */
  async saveViewState(s: ViewState): Promise<void> { if (this.writable && this.data) await this.writeJson(this.viewStatePath(), s); }
  async addRequest(req: Record<string, unknown>): Promise<string> {
    const f = `${P.inbox}/${requestFileName()}`;
    await this.writeJson(f, { at: new Date().toISOString(), ...req });
    return f;
  }

  // ------------------------------------------------------------ Claude 작업 (실행기와 파일로 주고받는다)
  async listRunners(): Promise<RunnerInfo[]> {
    const out: RunnerInfo[] = [];
    if (!this.data) return out;
    for (const n of (await this.data.list(P.runners).catch(() => null)) || []) {
      if (n.kind !== 'file' || !n.name.endsWith('.json')) continue;
      const r = await this.readJson<RunnerInfo | null>(`${P.runners}/${n.name}`, null);
      if (r && typeof r === 'object' && typeof r.id === 'string') out.push(r);
    }
    return out;
  }
  async listRuns(limit = 30): Promise<RunStatus[]> {
    if (!this.data) return [];
    const names = ((await this.data.list(P.runs).catch(() => null)) || []).map((n) => n.name);
    const ids = [...new Set(names.map((n) => n.replace(/\.(req\.json|json|log\.jsonl|cancel)$/, '')).filter(validRunId))].sort().reverse().slice(0, limit);
    const out: RunStatus[] = [];
    for (const id of ids) {
      const f = runFiles(id);
      // 폴더를 함께 쓰는 누구나 쓸 수 있는 파일 — id 는 파일 이름에서, 필드는 모양을 확인해서
      const st = cleanRunEntry(await this.readJson<unknown>(`${P.runs}/${f.status}`, null), id);
      if (st) { out.push(st); continue; }
      const req = cleanRunEntry(await this.readJson<unknown>(`${P.runs}/${f.req}`, null), id, 'queued');
      if (req) out.push(req);
    }
    return out;
  }
  async runLog(id: string, from = 0): Promise<{ lines: RunLogLine[]; next: number }> {
    if (!validRunId(id)) throw new FolderError('BAD_REQUEST', '잘못된 작업 id');
    const f = this.data ? await this.data.read(`${P.runs}/${runFiles(id).log}`).catch(() => null) : null;
    if (!f) return { lines: [], next: 0 };
    if (from > f.bytes.length) from = 0;
    const { items, consumed } = completeJsonLines<RunLogLine>(f.bytes.subarray(from));
    return { lines: items, next: from + consumed };
  }

  // ------------------------------------------------------------ 폴더 지도
  async inventory(): Promise<Inventory> {
    const items: InventoryItem[] = [];
    const max = this.config.maxInventory;
    const walk = async (dir: string, parent: string, depth: number): Promise<void> => {
      if (depth > 10 || items.length >= max) return;
      const ents = ((await this.fs.list(dir).catch(() => null)) || []).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of ents) {
        if (items.length >= max) break;
        const rel = parent + e.name;
        if (e.kind === 'directory') {
          if (!walkable(e.name)) continue;
          items.push({ id: rel + '/', parent, name: e.name, folder: true });
          await walk(rel, rel + '/', depth + 1);
        } else {
          const st = await this.fs.stat(rel).catch(() => null);
          const isDoc = this.docs.has(rel);
          const ext = e.name.includes('.') ? e.name.split('.').pop()!.toLowerCase() : '';
          items.push({ id: rel, parent, name: e.name, folder: false, kind: ext || 'file', size: st?.size, modified: st ? new Date(st.mtimeMs).toISOString() : undefined, flags: isDoc ? ['doc'] : [], docId: isDoc ? rel : undefined });
        }
      }
    };
    await walk('', '', 0);
    return { asof: new Date().toISOString(), source: this.fs.name + (items.length >= max ? ` (처음 ${max}개)` : ''), items, flagLabels: INVENTORY_FLAG_LABELS, open: [] };
  }

  // ------------------------------------------------------------ 바뀜 확인 (감시 대신)
  /**
   * 몇 초마다(탭이 보일 때만) 확인한다. 확인은 한 번에 하나만 돈다.
   *  - 이력 파일에 새로 붙은 완성된 줄의 문서에 doc 이벤트 — CLI 가 고친 문서도 화면이 다시 읽는다(이 탭이 쓴 판은 빼고)
   *  - 피드백 폴더가 바뀌었으면 feedback, 설정이 바뀌었으면 manifest
   *  - 문서 파일이 바뀌었으면(에디터·AI 의 직접 편집) 외부 편집으로 기록하고 doc
   * 화면이 보고 있는 문서(focus)는 매번, 전체 문서는 네 번에 한 번 본다.
   */
  private recordsTick: (emit: (ev: DocEvent) => void, n: number) => Promise<void> = async () => undefined;
  private docsTick: (emit: (ev: DocEvent) => void, n: number) => Promise<void> = async () => undefined;

  watch(emit: (ev: DocEvent) => void, pollMs = 2500): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let tickN = 0;
    let changesOffset = -1;
    let fbSig = '';
    let cfgSig = '';
    let runSig = '';
    let runnerSig = '';
    const sigOf = (st: FsStat | null) => (st ? `${st.size}:${st.mtimeMs}` : '');
    const tick = async () => {
      tickN++;
      await this.recordsTick(emit, tickN);
      await this.docsTick(emit, tickN);
    };
    // 기록 폴더(설정·이력·작업·피드백) — 아직 없으면 건너뛴다. 붙으면 그때부터 본다
    this.recordsTick = async (emit2, n) => {
      const data = this.data;
      if (!data) return;
      // 서명은 파일이 없을 때도 같은 값('none')이어야 한다 — 빈 값과 비교하면 매번 바뀐 것으로 보인다
      const cfgNowSig = 'cfg:' + sigOf(await data.stat(P.config).catch(() => null));
      if (cfgSig && cfgNowSig !== cfgSig) { await this.loadConfig(); await this.scan(); emit2({ type: 'manifest' }); }
      cfgSig = cfgNowSig;

      const ch = await data.stat(P.changes).catch(() => null);
      const size = ch?.size ?? 0;
      if (changesOffset < 0 || size < changesOffset) {
        // 처음이거나 파일이 줄었다(되돌림) — 지난 줄을 다시 알리지 않고 지금 끝부터 본다
        if (changesOffset >= 0) emit2({ type: 'changes' });
        changesOffset = size;
      } else if (size > changesOffset) {
        const f = await data.read(P.changes).catch(() => null);
        if (f) {
          const { entries, consumed } = completeChangeLines(f.bytes.subarray(changesOffset));
          changesOffset += consumed;
          const ids = new Set<string>();
          for (const e of entries) {
            if (!e.docId) continue;
            const k = e.docId + '\0' + e.toVersion;
            if (e.toVersion && this.ownWrites.has(k)) { this.ownWrites.delete(k); continue; }
            ids.add(e.docId);
          }
          ids.forEach((id) => emit2({ type: 'doc', id }));
          if (consumed) emit2({ type: 'changes' });
        }
      }

      // Claude 작업: 요청·상태·로그 파일 묶음이 바뀌면 runs, 실행기가 켜지고 꺼지면 runner
      const rn = ((await data.list(P.runs).catch(() => null)) || []).filter((x) => x.kind === 'file').map((x) => x.name).sort();
      const rsts = await Promise.all(rn.filter((x) => !x.endsWith('.req.json')).map((x) => data.stat(`${P.runs}/${x}`).catch(() => null)));
      const runSigNow = rn.join('|') + '#' + rsts.map(sigOf).join('|');
      if (runSig && runSigNow !== runSig) emit2({ type: 'runs' });
      runSig = runSigNow;
      if (n % 2 === 1) {
        const alive = (await this.listRunners()).filter((r) => runnerAlive(r)).map((r) => r.id + ':' + r.claude?.ok).sort().join('|') || 'none';
        if (runnerSig && alive !== runnerSig) emit2({ type: 'runner' });
        runnerSig = alive;
      }

      const names = ((await data.list(P.fb).catch(() => null)) || []).filter((x) => x.name.endsWith('.json')).map((x) => x.name).sort();
      const sts = await Promise.all(names.map((x) => data.stat(`${P.fb}/${x}`).catch(() => null)));
      const sig = names.map((x, i) => x + '@' + sigOf(sts[i])).join('|') || 'none';
      if (fbSig && sig !== fbSig) emit2({ type: 'feedback' });
      fbSig = sig;
    };
    // 문서 — 보고 있는 문서는 매번. 네 번에 한 번: 작은 폴더(다 훑었고 항목이 적음)는 다시 훑고, 큰 폴더는 아는 문서만 크기·시각을 본다(D64)
    this.docsTick = async (emit2, n) => {
      if (n % 4 === 1) {
        const small = this.index.complete && this.lastVisits <= SMALL_VISITS;
        const before = new Map([...this.docs].map(([k, v]) => [k, v.mtimeMs + ':' + v.size]));
        if (small) {
          if (await this.scan()) emit2({ type: 'manifest' });
        } else {
          const ids = [...new Set([...Object.keys((await this.known()).docs), ...(this.watching ? [this.watching] : [])])].filter((id) => this.docs.has(id)).slice(0, 400);
          for (const id of ids) { const st = await this.fs.stat(id).catch(() => null); if (st) this.docs.set(id, { ...this.docs.get(id)!, ...st }); }
        }
        const now = Date.now();
        for (const id of this.docs.keys()) if (small || before.get(id) !== undefined) this.checked.set(id, now);
        for (const [id, d] of this.docs) { const b = before.get(id); if (b && b !== '0:0' && b !== d.mtimeMs + ':' + d.size) await this.onDocTouched(id, emit2); }
      } else if (this.watching) {
        const id = this.watching;
        const d = this.docs.get(id);
        const st = await this.fs.stat(id).catch(() => null);
        if (st) this.checked.set(id, Date.now());
        if (d && st && (st.mtimeMs !== d.mtimeMs || st.size !== d.size)) {
          this.docs.set(id, { ...d, ...st });
          // 나무에서 막 찾은 문서(크기·시각을 아직 모름)는 처음 본 것 — 바뀐 것으로 치지 않는다
          if (d.mtimeMs || d.size) await this.onDocTouched(id, emit2);
        }
      }
    };
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    // 확인은 한 번에 하나 — 탭이 다시 보일 때 바로 확인하되, 이미 돌고 있으면 새 고리를 만들지 않는다
    const loop = async () => {
      if (stopped || running) return;
      if (timer) { clearTimeout(timer); timer = null; }
      running = true;
      try { if (visible()) await tick(); } catch { /* 다음 차례 */ } finally { running = false; }
      if (!stopped) timer = setTimeout(() => { timer = null; void loop(); }, pollMs);
    };
    const onVis = () => { if (visible()) void loop(); };
    // 다른 창(에디터·터미널)에서 고치고 돌아오면 바로 확인한다 — 창을 나란히 두면 visibilitychange 가 오지 않는다
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    if (typeof window !== 'undefined') window.addEventListener('focus', onVis);
    void loop();
    return () => {
      stopped = true; if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onVis);
    };
  }

  /**
   * 파일이 바뀐 문서: 따라가는 문서(연 적 있는)면 외부 편집으로 기록하고 알린다. 기록 폴더가 아직 없거나(D65)
   * 안 연 문서면 기록 없이 알리기만 한다 — 보고 있는 문서는 그래도 새로 읽힌다.
   */
  private async onDocTouched(id: string, emit: (ev: DocEvent) => void): Promise<void> {
    if (!this.writable || !this.data || !(await this.known()).docs[id]) { emit({ type: 'doc', id }); return; }
    if (await this.reconcile(id)) { emit({ type: 'doc', id }); emit({ type: 'changes' }); }
  }
}

/**
 * 폴더 → 작업대 어댑터. fs 는 fsFromHandle(고른 폴더) · fsFromFiles(읽기만) · fsFromMemory(시험).
 */
export async function createFolderAdapters(fs: FsLike, o: FolderOptions = {}): Promise<FolderAdapters> {
  const ws = await new FolderWorkspace(fs, o).init();
  await ws.reconcileAll();
  const en = o.locale === 'en';

  type Listener = (e: DocEvent) => void;
  const listeners = new Set<Listener>();
  let stop: (() => void) | null = null;
  const fire = (e: DocEvent) => listeners.forEach((l) => l(e));
  const on = (l: Listener) => {
    listeners.add(l);
    stop ||= ws.watch(fire, o.pollMs);
    return () => { listeners.delete(l); if (!listeners.size && stop) { stop(); stop = null; } };
  };

  ws.onDataAttached = () => { fire({ type: 'feedback' }); fire({ type: 'manifest' }); fire({ type: 'runner' }); fire({ type: 'changes' }); };
  const notifyOn = ws.writable && ws.config.notify?.inbox !== false;
  let chosenRunner: string | null = null;
  const runsStatus = async () => {
    const list = liveRunners(await ws.listRunners());
    const r = pickRunner(list, { me: ws.userName, meId: ws.me.id, chosen: chosenRunner });
    const others = list.filter((x) => x.id !== r?.id);
    if (!ws.writable) return { available: false, reason: 'read-only' as const, others };
    // 짝짓지 않은(계정·이름이 다른) 앱·실행기만 켜져 있으면 저절로 맡기지 않는다 — 내 PC 의 것이면 사람이 고른다(D54·D63)
    if (!r) return { available: false, reason: (others.some((x) => x.kind !== 'server') ? 'not-mine' : 'no-runner') as 'not-mine' | 'no-runner', others };
    if (!r.claude?.ok) return { available: false, reason: (r.claude?.reason || 'no-claude') as 'no-claude' | 'old-claude', message: r.claude?.problem, runner: r, others };
    return { available: true, runner: r, others };
  };
  const runs: RunsAdapter = {
    status: runsStatus,
    async start(input) {
      await ws.ensureData();
      const st = await runsStatus();
      if (!st.available || !st.runner) throw new FolderError('UNAVAILABLE', st.message || '실행기가 꺼져 있습니다');
      const req = makeRunRequest(input, { runner: st.runner.id, by: ws.me });
      await ws.writeJson(`${P.runs}/${runFiles(req.id).req}`, req);
      fire({ type: 'runs', id: req.id });
      return { ...req, state: 'queued' };
    },
    async cancel(id) {
      if (!validRunId(id)) throw new FolderError('BAD_REQUEST', '잘못된 작업 id');
      await (await ws.ensureData()).write(`${P.runs}/${runFiles(id).cancel}`, new Date().toISOString());
      fire({ type: 'runs', id });
    },
    list: (limit) => ws.listRuns(limit),
    log: (id, from) => ws.runLog(id, from),
    choose(id) { chosenRunner = id || null; },
    prepare: async () => { await ws.ensureData(); },
  };
  // 연결 안내의 재료 — 기록 자리는 처음 쓸 때 정해질 수 있어 그때그때 만든다
  if (o.runnerSetup) {
    const rs = o.runnerSetup;
    Object.defineProperty(runs, 'setup', {
      enumerable: true,
      get: () => ({ ...rs, folderName: fs.name, owner: ws.me.id, ...(ws.hasData ? {} : { noData: true }), ...(ws.dataMode === 'outside' && ws.dataHomeName ? { dataHome: ws.dataHomeName, dataName: ws.dataFolderName } : {}) }),
    });
  }
  const adapters: FolderAdapters = {
    workspace: ws,
    close: () => { listeners.clear(); stop?.(); stop = null; },
    docs: {
      // 다시 훑기는 확인 고리(watch)가 맡는다 — 목록을 부를 때마다 훑으면 큰 폴더에서 매번 몇 초씩 걸린다
      manifest: () => ws.manifest(),
      tree: (dir) => ws.tree(dir),
      load: (id) => ws.readDoc(id),
      focus: (id) => { ws.watching = id ? ws.canonId(id) : null; },
      checkedAt: (id) => ws.checked.get(ws.canonId(id)),
      refresh: async (id) => { const c = ws.canonId(id); const changed = await ws.reconcile(c); ws.checked.set(c, Date.now()); if (changed) { fire({ type: 'doc', id: c }); fire({ type: 'changes' }); } return changed; },
      loadVersion: (id, v) => ws.docVersion(id, v),
      save: async (id, md, opts) => {
        const r = await ws.writeDoc(id, md, { baseVersion: opts.baseVersion, summary: opts.summary, feedbackIds: opts.feedbackIds, convertTo: opts.convertTo });
        fire({ type: 'changes' });
        return r;
      },
      changes: (limit) => ws.changes(limit),
      inventory: () => ws.inventory(),
      subscribe: (cb) => on((e) => { if (e.type !== 'feedback') cb(e); }),
    },
    feedback: {
      subscribe(cb, onErr) {
        let alive = true;
        const pull = () => ws.listFeedback().then((rows) => { if (alive) cb(rows); }).catch((e) => onErr?.(e));
        void pull();
        const off = on((e) => { if (e.type === 'feedback') void pull(); });
        return () => { alive = false; off(); };
      },
      create: async (input) => { const f = await ws.createFeedback(input as never); fire({ type: 'feedback' }); return f; },
      update: async (id, patch, opts) => { const f = await ws.updateFeedback(id, patch, opts?.version); fire({ type: 'feedback' }); return f; },
      remove: async (id) => { await ws.deleteFeedback(id); fire({ type: 'feedback' }); },
      mode: () => 'poll',
    },
    viewState: { load: () => ws.viewState(), save: (s) => ws.saveViewState(s) },
    identity: {
      source: 'browser',
      me: async () => ws.me,
      setName: async (name) => ws.setUserName(name),
      can: (a) => {
        if (!ws.writable) return false;
        if (a === 'doc.edit') return !ws.config.readOnly;
        if (a === 'assistant.propose') return false;
        if (a === 'assistant.notify') return notifyOn;
        if (a === 'assistant.run') return !ws.config.readOnly;
        return true;
      },
    },
    notifier: notifyOn ? {
      label: (ws.config.assistantName || 'Claude') + (en ? '' : '에게 넘기기'),
      async send(s) {
        await ws.addRequest({ count: s.count, docs: s.docs, feedbackIds: s.feedbackIds });
        return { delivered: false, queued: true, message: ws.config.notify?.message || undefined };
      },
    } : undefined,
    runs: ws.writable ? runs : undefined,
    platform: {
      async copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } },
      async download(filename, text, mime = 'text/markdown') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return true;
      },
    },
  };
  return adapters;
}

// ---------------------------------------------------------------- 순수 JS SHA-256 (crypto.subtle 이 없는 읽기 전용 환경용)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(data: Uint8Array): string {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(padded.length - 4, bits >>> 0);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}
