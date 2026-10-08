// @ts-check
/**
 * 작업 폴더 — 로컬 드라이브의 문서 폴더 하나를 DocBench 저장소로 쓴다.
 *
 * 문서 폴더(*.md, 정본)와 기록 폴더는 따로다(D57). 기록 폴더는 locateData 가 찾는다 —
 * 기본은 문서 폴더 밖(기록 보관함/<문서 폴더 이름>), 예전 판·팀 공유는 문서 폴더 안 .docbench/. 모양은 같다:
 *
 *   <기록 폴더>/
 *       config.json           그룹·제목·규칙 (선택, 함께 씀 — 실행 명령·이름은 여기서 읽지 않는다)
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
import { gitInfo, gitShowHead, gitStatus } from './git.mjs';
import { core } from './core.mjs';

// 규약(설정 기본값·glob·매니페스트·이력 모양)은 브라우저 폴더 어댑터와 같은 src/core/workspace.ts
const CI = process.platform === 'win32';
/** @param {string} rel @param {string[] | undefined} pats */
const matchAny = (rel, pats) => core.matchAny(rel, pats, CI);

export class ConflictError extends Error {
  /** @param {any} current */
  constructor(current) { super('conflict'); this.code = 'CONFLICT'; this.current = current; }
}
export class NotFoundError extends Error { constructor(what) { super('not found: ' + what); this.code = 'NOT_FOUND'; } }
export class BadRequestError extends Error { constructor(msg) { super(msg); this.code = 'BAD_REQUEST'; } }

const safeName = core.safeName;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 기록 보관함 기본 자리 — 이 PC 의 설정 폴더 아래 data/ @param {string} pcConfigFile */
export const defaultDataHome = (pcConfigFile) => path.join(path.dirname(pcConfigFile), 'data');
/** @param {string} a @param {string} b */
const samePath = (a, b) => { const n = (x) => path.resolve(x).replace(/[\\/]+$/, ''); return CI ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b); };

export class DataLocationError extends Error {
  /** @param {string} msg @param {string} code */
  constructor(msg, code = 'DATA_LOCATION') { super(msg); this.code = code; }
}

/**
 * 이 문서 폴더의 기록 폴더를 찾는다 (D58, D61). 순서:
 *   1. 준 것(--data · DOCBENCH_DATA · new Workspace(root, { dataDir }))
 *   2. 문서 폴더 안 .docbench/ — 예전 판·팀 공유 (브라우저도 안쪽이 있으면 그것을 먼저 본다 — 둘이 갈라지지 않게)
 *   3. 이 PC 의 설정 workspaces[<문서 폴더>].data — init·실행기·link 가 적는 짝. 그 폴더가 없으면(드라이브가 안 붙었거나 옮김)
 *      만들지 않고 멈춘다 — 빈 기록을 새로 만들면 사람의 기록이 사라진 것처럼 보인다
 *   4. 기록 보관함(이 PC 의 설정 dataHome, 없으면 <PC 설정 폴더>/data) 아래 '<문서 폴더 이름>', '<이름> (2)' … 중
 *      표식이 이 문서 폴더를 가리키는 것(docsPath, 없으면 문서 표본이 겹치는 것)
 * 없으면 create 일 때만 보관함의 빈 이름 자리를 돌려준다(만들기는 init·serve). CLI 의 다른 명령은 create 없이 — 몰래 새 기록을 만들지 않는다.
 * @param {string} root @param {{ pcConfigFile: string, dataDir?: string, create?: boolean, docs?: string[] }} o docs = 문서 표본(없으면 훑는다)
 * @returns {Promise<{ dir: string, mode: 'inside' | 'outside', source: 'option' | 'pc' | 'inside' | 'home' | 'new', claimed?: boolean } | null>}
 */
export async function locateData(root, o) {
  root = path.resolve(root);
  const inside = path.join(root, '.docbench');
  const real = await fs.realpath(root).catch(() => root);
  const mode = (/** @type {string} */ d) => (samePath(d, inside) ? 'inside' : 'outside');
  if (o.dataDir) {
    const d = path.resolve(o.dataDir);
    if (!o.create && !(await isDir(d))) return null;
    return { dir: d, mode: mode(d), source: 'option' };
  }
  if (await isDir(inside)) return { dir: inside, mode: 'inside', source: 'inside' };
  const pc = core.pcDataFor(await readJson(o.pcConfigFile, {}), [root, real], CI);
  /** 이 폴더의 기록이 합쳐진 곳 (D66) — 찾지 못하면 그렇다고 알린다 @type {string | null} */
  let mergedTo = null;
  if (pc.data) {
    const d = path.resolve(path.dirname(o.pcConfigFile), pc.data);
    if (!(await isDir(d))) throw new DataLocationError(`이 문서 폴더의 기록 폴더가 없습니다: ${d}\n드라이브가 붙어 있는지 보세요. 다른 자리로 옮겼으면: docbench link "${root}" --data <기록 폴더>`, 'DATA_MISSING');
    // 짝 지은 기록이 넓은 작업 공간으로 합쳐졌으면(브라우저가 합침 — 이 PC 의 설정은 못 고친다) 더 쓰지 않는다
    const m = core.parseDataMarker(await readJson(path.join(d, core.DATA_MARKER)));
    if (!m?.mergedInto) return { dir: d, mode: mode(d), source: 'pc' };
    mergedTo = m.mergedInto.to;
  }
  const home = pc.dataHome ? path.resolve(path.dirname(o.pcConfigFile), pc.dataHome) : defaultDataHome(o.pcConfigFile);
  let docs = o.docs;
  /** @type {string | null} */
  let free = null;
  for (const name of core.dataFolderCandidates(path.basename(root))) {
    const cand = path.join(home, name);
    const raw = await readJson(path.join(cand, core.DATA_MARKER));
    const marker = core.parseDataMarker(raw);
    if (!marker) {
      // 표식 없는 자리: 비어 있으면 새 기록 자리로 쓸 수 있다(다른 파일이 있으면 건너뛴다)
      if (!free && !(await fs.readdir(cand).catch(() => [])).length) free = cand;
      continue;
    }
    // 더 넓은 작업 공간의 기록으로 합쳐진 기록은 더 쓰지 않는다(D66) — 만들 때는 새로 시작하고, 찾기만 할 때는 어디로 갔는지 알린다
    if (marker.mergedInto) {
      if (marker.docsPath ? samePath(marker.docsPath, root) || samePath(marker.docsPath, real) : core.sameDocsFolder(marker, (docs ??= await quickDocList(root)))) mergedTo ??= marker.mergedInto.to;
      continue;
    }
    if (marker.docsPath) {
      if (samePath(marker.docsPath, root) || samePath(marker.docsPath, real)) return { dir: cand, mode: 'outside', source: 'home', claimed: true };
      continue;
    }
    // 브라우저가 만든 기록(경로 없음): 문서 표본이 겹치면 이 폴더의 것
    docs ??= await quickDocList(root);
    if (core.sameDocsFolder(marker, docs)) return { dir: cand, mode: 'outside', source: 'home', claimed: false };
  }
  if (!o.create) {
    if (mergedTo) throw new DataLocationError(`이 문서 폴더의 기록은 넓은 작업 공간 "${mergedTo}" 의 기록으로 합쳐졌습니다 — 그 넓은 폴더에서 쓰세요. 여기서 새로 시작하려면: docbench init "${root}"`, 'DATA_MERGED');
    return null;
  }
  if (!free) throw new DataLocationError(`기록 보관함(${home})에 "${path.basename(root)}" 이름의 자리가 모두 다른 문서 폴더의 것입니다. 기록 자리를 정해 주세요: docbench init "${root}" --data <기록 폴더>`, 'DATA_CONFLICT');
  return { dir: free, mode: 'outside', source: 'new' };
}
/**
 * 이 PC 의 설정에 문서 폴더 ↔ 기록 폴더 짝을 적는다(같으면 그대로). 보관함을 주면 dataHome 이 비었을 때만 그것으로.
 * 읽지 못하는 설정 파일은 덮어쓰지 않는다.
 * @param {string} pcConfigFile @param {string} root @param {string | null} dataDir null = 짝 지우기 @param {{ dataHome?: string }} [o]
 * @returns {Promise<boolean>} 바꿨는지
 */
export async function setPcMapping(pcConfigFile, root, dataDir, o = {}) {
  const text = await fs.readFile(pcConfigFile, 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  /** @type {any} */
  let c = {};
  if (text != null) { try { c = core.parseJsonText(text) || {}; } catch { throw new DataLocationError(`이 PC 의 설정 파일을 읽지 못해 고치지 않았습니다(JSON 확인): ${pcConfigFile}`); } }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new DataLocationError(`이 PC 의 설정 파일 모양이 이상해 고치지 않았습니다: ${pcConfigFile}`);
  c.workspaces = c.workspaces && typeof c.workspaces === 'object' && !Array.isArray(c.workspaces) ? c.workspaces : {};
  const key = Object.keys(c.workspaces).find((k) => samePath(k, root)) || root;
  const cur = c.workspaces[key] && typeof c.workspaces[key] === 'object' ? c.workspaces[key] : {};
  let changed = false;
  if (dataDir == null) { if ('data' in cur) { delete cur.data; changed = true; } }
  else if (!(typeof cur.data === 'string' && samePath(path.resolve(path.dirname(pcConfigFile), cur.data), dataDir))) { cur.data = dataDir; changed = true; }
  if (changed) { if (Object.keys(cur).length) c.workspaces[key] = cur; else delete c.workspaces[key]; }
  if (o.dataHome && !c.dataHome) { c.dataHome = o.dataHome; changed = true; }
  if (!changed) return false;
  await fs.mkdir(path.dirname(pcConfigFile), { recursive: true });
  await writeJson(pcConfigFile, c);
  return true;
}

/** @param {string} p */
async function isDir(p) { const st = await fs.stat(p).catch(() => null); return !!st?.isDirectory(); }

/**
 * 이 PC 의 설정 맨 위 값 하나를 바꾼다(표시 이름 name 등). 읽지 못하는 설정 파일은 덮어쓰지 않는다. value 가 '' 면 지운다.
 * @param {string} pcConfigFile @param {string} key @param {unknown} value
 */
export async function setPcValue(pcConfigFile, key, value) {
  const text = await fs.readFile(pcConfigFile, 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  /** @type {any} */
  let c = {};
  if (text != null) { try { c = core.parseJsonText(text) || {}; } catch { throw new DataLocationError(`이 PC 의 설정 파일을 읽지 못해 고치지 않았습니다(JSON 확인): ${pcConfigFile}`); } }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new DataLocationError(`이 PC 의 설정 파일 모양이 이상해 고치지 않았습니다: ${pcConfigFile}`);
  if (value === '' || value == null) delete c[key]; else c[key] = value;
  await fs.mkdir(path.dirname(pcConfigFile), { recursive: true });
  await writeJson(pcConfigFile, c);
}

/**
 * 이 PC 의 설정 workspaces[<문서 폴더>] 의 값을 고친다 (짝 지은 계정 owners·앱에 더한 표시 added 등). 같은 키는 경로 비교로 찾는다.
 * @param {string} pcConfigFile @param {string} root @param {(cur: any) => any} fn 지금 값 → 새 값(빈 객체면 지운다)
 */
export async function updatePcWorkspace(pcConfigFile, root, fn) {
  const text = await fs.readFile(pcConfigFile, 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  /** @type {any} */
  let c = {};
  if (text != null) { try { c = core.parseJsonText(text) || {}; } catch { throw new DataLocationError(`이 PC 의 설정 파일을 읽지 못해 고치지 않았습니다(JSON 확인): ${pcConfigFile}`); } }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new DataLocationError(`이 PC 의 설정 파일 모양이 이상해 고치지 않았습니다: ${pcConfigFile}`);
  c.workspaces = c.workspaces && typeof c.workspaces === 'object' && !Array.isArray(c.workspaces) ? c.workspaces : {};
  const key = Object.keys(c.workspaces).find((k) => samePath(k, root)) || path.resolve(root);
  const cur = c.workspaces[key] && typeof c.workspaces[key] === 'object' ? c.workspaces[key] : {};
  const next = fn({ ...cur });
  if (JSON.stringify(next) === JSON.stringify(cur)) return false;
  if (next && Object.keys(next).length) c.workspaces[key] = next; else delete c.workspaces[key];
  await fs.mkdir(path.dirname(pcConfigFile), { recursive: true });
  await writeJson(pcConfigFile, c);
  return true;
}
export { samePath, isInside };

/** 문서 표본용으로 문서 폴더의 .md 를 가볍게 훑는다(기본 규칙: 숨김·node_modules 등 제외) @param {string} root */
export async function quickDocList(root, limit = 400) {
  /** @type {string[]} */
  const out = [];
  const walk = async (/** @type {string} */ dir, /** @type {string} */ rel, depth = 0) => {
    if (depth > 8 || out.length >= limit) return;
    const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      if (out.length >= limit) return;
      if (e.isSymbolicLink()) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (core.walkable(e.name)) await walk(path.join(dir, e.name), r, depth + 1); }
      else if (/\.(md|markdown)$/i.test(e.name)) out.push(r);
    }
  };
  await walk(root, '');
  return out;
}

/**
 * 밖에 둔 기록 폴더를 이 문서 폴더의 것으로 확인한다: 문서 폴더 안·문서 폴더를 품는 자리는 거부, 다른 문서 폴더를 가리키는
 * 표식(docsPath, 또는 문서 표본이 겹치지 않음)이면 거부, 표식 없는 폴더는 비어 있어야 한다(예전 .docbench 를 옮겨 놓은 것은 된다).
 * claim 이면 표식을 만들거나 docsPath·문서 표본을 채운다 — init·link·serve·실행기만. 읽기만 하는 CLI 명령은 표식을 바꾸지 않는다.
 * @param {string} dir @param {string} root @param {{ claim?: boolean, docs?: string[], force?: boolean }} [o] force = 문서 목록이 달라도 잇는다(link --force)
 */
export async function claimDataDir(dir, root, o = {}) {
  root = path.resolve(root);
  if (isInside(dir, root) || samePath(dir, root)) throw new DataLocationError(`기록 폴더는 문서 폴더 밖이어야 합니다(안에 두려면 ${path.join(root, '.docbench')}): ${dir}`);
  if (isInside(root, dir)) throw new DataLocationError(`기록 폴더가 문서 폴더를 품고 있습니다 — 따로 된 폴더를 고르세요: ${dir}`);
  const file = path.join(dir, core.DATA_MARKER);
  const raw = await readJson(file);
  const marker = core.parseDataMarker(raw);
  if (raw != null && !marker) throw new DataLocationError(`기록 폴더의 표식(${file})을 읽지 못했습니다`);
  const real = await fs.realpath(root).catch(() => root);
  if (marker?.docsPath && !samePath(marker.docsPath, root) && !samePath(marker.docsPath, real)) {
    throw new DataLocationError(`이 기록 폴더는 다른 문서 폴더(${marker.docsPath})의 것입니다: ${dir}`, 'DATA_CONFLICT');
  }
  const docs = o.docs || await quickDocList(root);
  if (marker && !marker.docsPath && !o.force && !core.sameDocsFolder(marker, docs)) {
    throw new DataLocationError(`이 기록 폴더는 이름이 같은 다른 문서 폴더("${marker.docsName}")의 것으로 보입니다(문서 목록이 다릅니다): ${dir}\n맞다면 docbench link "${root}" --data "${dir}" --force`, 'DATA_CONFLICT');
  }
  if (!marker) {
    const ents = await fs.readdir(dir).catch(() => []);
    if (ents.some((n) => !['feedback', 'blobs', 'viewstate', 'inbox', 'locks', 'runs', 'runners', '.gitignore'].includes(n) && !/^(config|state)\.json$|^changes\.jsonl$/.test(n))) {
      throw new DataLocationError(`기록 폴더로 쓰려는 곳에 다른 파일이 있습니다 — 빈 폴더를 고르세요: ${dir}`);
    }
  }
  if (!o.claim) return;
  const next = { ...(marker || core.newDataMarker(path.basename(root))), docsName: marker?.docsName || path.basename(root), docsPath: root, docs: core.nextDocsSample(marker?.docs, docs) };
  delete next.migrating;
  if (!marker || marker.docsPath !== root || JSON.stringify(marker.docs || []) !== JSON.stringify(next.docs)) {
    await fs.mkdir(dir, { recursive: true });
    await writeJson(file, next);
  }
}

/**
 * 이 PC 의 설정 파일 — 문서 폴더 밖이라 git·OneDrive·공유 폴더로 퍼지지 않는다. 운영체제의 앱 설정 자리:
 *   Windows %LOCALAPPDATA%\docbench\config.json (로밍되지 않는 이 PC 자리 — 명령에 이 PC 의 경로가 들어간다)
 *   macOS   ~/Library/Application Support/docbench/config.json · Linux $XDG_CONFIG_HOME(~/.config)/docbench/config.json
 *   DOCBENCH_HOME 이 있으면 그 아래 config.json
 * 홈의 .docbench 폴더에 두지 않는다 — CLI 가 위로 .docbench 를 찾다 홈 폴더를 작업 폴더로 오인했다(독립 검토 재현).
 */
export function defaultPcConfigFile() {
  if (process.env.DOCBENCH_HOME) return path.join(process.env.DOCBENCH_HOME, 'config.json');
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'docbench', 'config.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'docbench', 'config.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'docbench', 'config.json');
}
/** 경로 접두 비교 — 드라이브 루트(D:\)처럼 이미 구분자로 끝나는 뿌리도 맞게 @param {string} child @param {string} root */
function isInside(child, root) {
  const r = root.endsWith(path.sep) ? root : root + path.sep;
  return process.platform === 'win32' ? child.toLowerCase().startsWith(r.toLowerCase()) : child.startsWith(r);
}

const IGNORE_DIRS = core.IGNORE_DIRS;

export class Workspace {
  /**
   * @param {string} root 문서 폴더
   * @param {{ actor?: any, pcConfigFile?: string, dataDir?: string, create?: boolean }} [opts] pcConfigFile = 이 PC 의 설정 파일(기본: 사용자 폴더),
   *   dataDir = 기록 폴더(주지 않으면 init 이 locateData 로 찾는다),
   *   create = 기록이 없으면 만든다(기본 켬 — 서버·init). 끄면(CLI 의 다른 명령) 찾기만 하고 표식도 바꾸지 않는다
   */
  constructor(root, opts = {}) {
    this.root = path.resolve(root);
    /** 기록 폴더 — init 이 정한다 */
    this.dir = opts.dataDir ? path.resolve(opts.dataDir) : path.join(this.root, '.docbench');
    this.dataOption = opts.dataDir;
    this.create = opts.create !== false;
    /** @type {'inside' | 'outside'} */
    this.dataMode = 'inside';
    this.actor = opts.actor;
    /** @type {import('../dist/core.mjs').WorkspaceConfig} */
    this.config = core.mergeConfig({}, path.basename(this.root));
    /** @type {Map<string, { abs: string, size: number, mtimeMs: number, title?: string, titleMtime?: number }>} */
    this.docs = new Map();
    /** @type {{ prefix: string } | null | undefined} */
    this.git = undefined;
    this.legacyWritable = false;
    /** @type {string | undefined} */
    this.realRoot = undefined;
    /** @type {Map<string, Promise<unknown>>} */
    this.chains = new Map();
    /** 이 프로세스가 쓴 (문서, 판) — 이력 감시가 내 저장을 다시 알리지 않게. 그 줄을 한 번 보면 지운다 @type {Set<string>} */
    this.ownWrites = new Set();
    this.pcConfigFile = opts.pcConfigFile || defaultPcConfigFile();
    /** 폴더 나무 (상대 경로 → 문서가 아닌 파일 수) @type {Record<string, { files: number }>} */
    this.folders = { '': { files: 0 } };
    this.folderSig = '';
    /** 문서 목록을 얼마나 찾았나 (D64) @type {{ complete: boolean, reason?: 'big-root' | 'many' }} */
    this.index = { complete: true };
    /** 마지막 훑기에서 들른 항목 수 — 작은 폴더만 감시·다시 훑기를 통째로 한다 */
    this.lastVisits = 0;
    /** 나무(tree)에서 찾은 문서 — 한도에 닿은 큰 폴더에서도 목록에 남긴다 @type {Set<string>} */
    this.fromTree = new Set();
  }

  /** 작은 폴더(다 훑었고 항목이 적다) — 재귀 감시·통째로 다시 훑기를 해도 되는 크기 */
  get small() { return this.index.complete && this.lastVisits <= 5000; }

  // ------------------------------------------------------------ 시작
  async init() {
    const st = await fs.stat(this.root).catch(() => null);
    if (!st || !st.isDirectory()) throw new Error('작업 폴더가 없습니다: ' + this.root);
    const loc = await locateData(this.root, { pcConfigFile: this.pcConfigFile, dataDir: this.dataOption, create: this.create });
    if (!loc) throw new DataLocationError(`이 문서 폴더의 기록을 찾지 못했습니다: ${this.root}`, 'NO_DATA');
    this.dir = loc.dir;
    this.dataMode = loc.mode;
    /** @type {string[]} */
    this.dataWarnings = [];
    if (loc.mode === 'outside') {
      await claimDataDir(this.dir, this.root, { claim: this.create });
      // 만든·찾은 기록은 짝을 이 PC 의 설정에 적어 둔다 — 보관함(dataHome)이 바뀌어도 이 폴더의 기록을 잃지 않게
      if (this.create && loc.source !== 'pc') await setPcMapping(this.pcConfigFile, this.root, this.dir).catch((e) => this.dataWarnings.push(String(e.message || e)));
    } else {
      const pc = core.pcDataFor(await readJson(this.pcConfigFile, {}), [this.root], CI);
      if (pc.data) this.dataWarnings.push(`이 PC 의 설정에 이 폴더의 기록 짝(${pc.data})이 있지만 문서 폴더 안 .docbench 를 씁니다(안쪽이 먼저). 밖을 쓰려면 안쪽을 옮기거나 지우세요.`);
    }
    await this.loadConfig();
    for (const d of ['feedback', 'blobs', 'viewstate', 'inbox']) await fs.mkdir(path.join(this.dir, d), { recursive: true });
    if (loc.mode === 'inside') {
      // 예전 판이 만든 .gitignore 에도 빠진 줄을 덧붙인다(사람이 더한 줄은 그대로). 밖에 둔 기록은 git 과 상관없다
      const gi = path.join(this.dir, '.gitignore');
      const giText = await fs.readFile(gi, 'utf8').catch(() => null);
      const giNext = giText == null ? core.DOT_GITIGNORE : core.mergeGitignore(giText);
      if (giNext != null) await fs.writeFile(gi, giNext);
    }
    this.legacyWritable = await canEncodeLegacy();
    this.git = await gitInfo(this.root).catch(() => null);
    await this.scan();
    return this;
  }

  async loadConfig() {
    // 함께 쓰는 config.json + 이 PC 의 설정(문서 폴더 밖) — 실행 명령·이름은 PC 설정에서만(core.mergeConfig)
    this.realRoot ??= await fs.realpath(this.root).catch(() => this.root);
    const pc = core.pcSettingsFor(await readJson(this.pcConfigFile, {}), [this.root, this.realRoot], CI);
    this.config = core.mergeConfig(await readJson(path.join(this.dir, 'config.json'), {}), path.basename(this.root), pc);
  }

  get userId() { return safeName(this.config.user || os.userInfo().username || 'me'); }
  /** 나 — 계정은 이 PC 의 설정 user(없으면 로그인 이름), 표시 이름은 name(화면의 "나"에서 바꾼다) */
  get me() { return { kind: 'human', id: this.userId, name: this.config.name || this.config.user || os.userInfo().username }; }

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
  isDoc(rel) { return core.docFloor(rel) && matchAny(rel, this.config.include) && !matchAny(rel, this.config.exclude); }

  // ------------------------------------------------------------ 훑기
  /**
   * 문서를 찾는다 — **한도 안에서만**(D64, 브라우저 폴더 어댑터와 같은 규칙): 들른 항목 수·시간(core.SCAN_LIMITS), 문서 수(maxDocs).
   * 얕은 곳부터(너비 우선)라 한도에 닿으면 깊은 곳이 빠진다(펼치면 tree 가 더한다). 드라이브·홈 맨 위처럼 큰 폴더는 맨 위만.
   * 예전에는 하위 12단계까지 전부 훑어 드라이브를 열면 멈췄다(주인 실사용).
   * @param {{ visits: number, ms: number }} [lim]
   */
  async scan(lim = core.SCAN_LIMITS) {
    const found = new Map();
    const tally = core.folderTally();
    /** @type {import('node:fs').Dirent[]} */
    let top = [];
    try { top = await fs.readdir(this.root, { withFileTypes: true }); } catch { /* 빈 목록 */ }
    const big = core.looksBigRoot(path.basename(this.root) || this.root, top.map((e) => e.name));
    const started = Date.now();
    let visits = 0;
    let capped = false;
    /** @type {{ abs: string, depth: number, ents?: import('node:fs').Dirent[] }[]} */
    const queue = [{ abs: this.root, depth: 0, ents: top }];
    outer: while (queue.length) {
      const { abs: dir, depth, ents: pre } = /** @type {any} */ (queue.shift());
      let ents = pre;
      if (!ents) { try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { ents = []; } }
      for (const e of ents) {
        visits++;
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!core.walkable(e.name)) continue;
          tally.dir(this.rel(abs));
          if (!big && depth < 12) queue.push({ abs, depth: depth + 1 });
          continue;
        }
        const rel = this.rel(abs);
        const isDoc = this.isDoc(rel);
        if (e.isFile()) tally.file(rel, isDoc);
        if (!isDoc) continue;
        if (found.size >= this.config.maxDocs) { capped = true; break outer; }
        const st = await fs.stat(abs).catch(() => null);
        if (!st) continue;
        const prev = this.docs.get(rel);
        found.set(rel, { abs, size: st.size, mtimeMs: st.mtimeMs, title: prev?.titleMtime === st.mtimeMs ? prev.title : undefined, titleMtime: prev?.titleMtime });
      }
      if (visits > lim.visits || Date.now() - started > lim.ms) { capped = queue.length > 0; break; }
    }
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
   * 폴더 하나의 항목 (탐색기 — 펼친 폴더만 읽는다). 여기서 본 문서는 문서 목록에도 더한다. 숨김·의존성·시스템 폴더와
   * 심볼릭 링크·정션은 뺀다(작업 폴더 밖으로 나가지 않게). 없는 폴더·작업 폴더 밖이면 null.
   * @param {string} dir 작업 폴더 기준 '/' 경로 ('' = 맨 위)
   */
  async tree(dir) {
    const d = dir ? core.normalizeDocId(dir) : '';
    if (d === null) return null;
    const abs = d ? path.resolve(this.root, d) : this.root;
    if (d && !isInside(abs, this.root)) return null;
    // 경로 중간의 링크·정션으로 작업 폴더 밖을 가리키면 거부
    const real = await fs.realpath(abs).catch(() => null);
    this.realRoot ??= await fs.realpath(this.root).catch(() => this.root);
    if (!real || (d && !isInside(real, this.realRoot) && !samePath(real, this.realRoot))) return null;
    let ents;
    try { ents = await fs.readdir(abs, { withFileTypes: true }); } catch { return null; }
    const raw = ents.filter((e) => !e.isSymbolicLink() && (e.isDirectory() || e.isFile())).map((e) => ({ name: e.name, kind: /** @type {'file' | 'directory'} */ (e.isDirectory() ? 'directory' : 'file') }));
    const items = core.toTreeEntries(raw, d, this.config, CI).slice(0, core.TREE_MAX);
    // 이 폴더에서 사라진 문서는 목록에서도 뺀다(큰 폴더는 다시 훑지 않으므로 여기서)
    const here = new Set(items.map((x) => x.path));
    for (const id of [...this.docs.keys()]) if (path.posix.dirname(id) === (d || '.') && !here.has(id)) { this.docs.delete(id); this.fromTree.delete(id); }
    for (const it of items) {
      if (!it.doc) continue;
      const a = path.join(abs, it.name);
      const st = await fs.stat(a).catch(() => null);
      if (!st) continue;
      it.size = st.size;
      it.modified = new Date(st.mtimeMs).toISOString();
      if (!this.docs.has(it.path)) { this.docs.set(it.path, { abs: a, size: st.size, mtimeMs: st.mtimeMs }); this.fromTree.add(it.path); }
    }
    return items;
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
      const started = Date.now();
      for (;;) {
        try { fh = await fs.open(lockFile, 'wx'); break; } catch (e) {
          if (/** @type {any} */ (e).code !== 'EEXIST') throw e;
          const st = await fs.stat(lockFile).catch(() => null);
          if (st && Date.now() - st.mtimeMs > core.LOCK_STALE_MS) { await fs.rm(lockFile, { force: true }); continue; } // 죽은 잠금
          // 죽은 잠금이 치워질 때(15초)보다 조금 더 기다린다 — 남은 잠금 하나로 쓰기가 실패하지 않게
          if (Date.now() - started > core.LOCK_STALE_MS + 3000) throw Object.assign(new Error('다른 프로세스가 같은 문서를 쓰고 있습니다. 잠시 뒤 다시 시도하세요.'), { code: 'BUSY' });
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
    // 연 문서부터 따라간다(D64) — 처음 열면 판을 적어 두어 그 뒤 바깥 편집을 이력에 남긴다. 알던 판은 덮지 않는다
    if (!(await this.known()).docs?.[id]) await this.withLock(core.lockKey.state, async () => {
      const s = await this.known();
      if (s.docs?.[id]) return;
      (s.docs ||= {})[id] = r.version;
      await writeJson(path.join(this.dir, 'state.json'), s);
    });
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
    return this.withLock(core.lockKey.doc(id), () => this.writeDocLocked(id, md, o));
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
    const updatedAt = new Date().toISOString();
    const ds = core.diffSections(cur.text, text);
    // 문서 쓰기와 그 이력 줄은 한 덩어리 — 이력 잠금을 먼저 잡고 쓴다. 잠금을 못 잡으면 문서도 쓰지 않는다
    // (나중에 잡다 실패하면 문서는 바뀌었는데 이력이 없고 '실패'로 보고됐다 — 독립 검토 재현). 잠금 순서: 문서 → 이력 → 상태
    await this.withLock(core.lockKey.changes, async () => {
      // 감시자가 이 쓰기를 '외부 편집'으로 오해하지 않게 먼저 새 판을 알려 둔다
      await this.setKnown(id, version);
      try {
        // 잠금은 브라우저(단일 HTML)와는 최선 노력이다 — 쓰기 직전에 한 번 더 판을 본다. 그 사이 바뀌었으면 덮지 않는다
        const now = await fs.readFile(cur.abs).catch(() => null);
        if (!now || hashBytes(now) !== cur.version) {
          await this.setKnown(id, cur.version);
          const fresh = await this.readRaw(id);
          throw new ConflictError({ id, md: fresh.text, version: fresh.version, updatedAt: new Date(fresh.st.mtimeMs).toISOString() });
        }
        this.noteOwnWrite(id, version);
        await atomicWrite(cur.abs, buf);
      } catch (e) { if (!(e instanceof ConflictError)) await this.setKnown(id, cur.version); throw e; }
      await fs.appendFile(this.changesFile, core.changeLine({ at: updatedAt, docId: id, by: o.by || this.actor || this.me, summary: o.summary || undefined, fromVersion: cur.version, toVersion: version, feedbackIds: o.feedbackIds?.length ? o.feedbackIds : undefined, sections: [...ds.changed, ...ds.added], removed: ds.removed.length ? ds.removed : undefined }));
    });
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
    await this.withLock(core.lockKey.state, async () => {
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
    await this.appendChange({ at: new Date(r.st.mtimeMs).toISOString(), docId: id, by: { kind: 'external' }, fromVersion: prev, toVersion: r.version, sections: ds ? [...ds.changed, ...ds.added] : undefined, removed: ds?.removed.length ? ds.removed : undefined });
    return true;
  }
  /**
   * 열 때 한 번: **알던 문서만**(state.json) 디스크와 맞춰 본다(D64). 처음 보는 문서는 읽지 않는다 — 열거나 피드백할 때 판을 적는다.
   * 예전에는 모든 문서를 읽어 해시해 큰 폴더를 열면 오래 걸렸다.
   */
  async reconcileAll() {
    let n = 0;
    const known = Object.keys((await this.known()).docs || {});
    for (const id of known) {
      if (!this.docs.has(id)) {
        // 목록 밖(큰 폴더의 깊은 곳)이라도 디스크에 있으면 맞춰 본다
        const abs = (() => { try { return this.resolve(id); } catch { return null; } })();
        const st = abs ? await fs.stat(abs).catch(() => null) : null;
        if (!st || !abs) continue;
        this.docs.set(id, { abs, size: st.size, mtimeMs: st.mtimeMs });
        this.fromTree.add(id);
      }
      if (await this.reconcile(id)) n++;
    }
    return n;
  }

  // ------------------------------------------------------------ 변경 이력
  get changesFile() { return path.join(this.dir, 'changes.jsonl'); }
  /** @param {any} entry */
  /** @param {string} id @param {string} v */
  noteOwnWrite(id, v) {
    this.ownWrites.add(id + '\0' + v);
    if (this.ownWrites.size > 500) this.ownWrites.delete(this.ownWrites.values().next().value);
  }

  /** @param {any} entry */
  async appendChange(entry) {
    // 브라우저(단일 HTML)는 덧붙이기를 파일 바꿔 끼우기로 한다 — 같은 잠금 안에서 덧붙여야 줄이 사라지지 않는다
    await this.withLock(core.lockKey.changes, () => fs.appendFile(this.changesFile, core.changeLine(entry)));
  }
  /** @param {number} [limit] */
  async changes(limit = 300) {
    let text = '';
    try { text = await fs.readFile(this.changesFile, 'utf8'); } catch { return []; }
    return core.parseChanges(text, limit);
  }
  /** @param {string} id @param {string} v */
  async hasChangeTo(id, v) {
    return core.lastChangeIs(await this.changes(200), id, v);
  }

  // ------------------------------------------------------------ 매니페스트
  /** @param {string} id */
  async titleOf(id) {
    const d = this.docs.get(id);
    if (!d) return path.posix.basename(id);
    if (d.title && d.titleMtime === d.mtimeMs) return d.title;
    let title = core.titleFromText('', id);
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
      title = core.titleFromText(decode(head).text, id);
    } catch { /* 이름으로 */ }
    d.title = title; d.titleMtime = d.mtimeMs;
    return title;
  }

  async manifest() {
    /** @type {Map<string, { title: string, size?: number, mtimeMs?: number }>} */
    const info = new Map();
    // 제목(첫 # 줄)은 앞 8 KB 를 읽어야 한다 — 한 번에 300개만 새로 읽고 나머지는 파일 이름(다음에 채운다)
    let budget = 300;
    for (const [id, d] of this.docs) {
      const cached = d.title && d.titleMtime === d.mtimeMs;
      info.set(id, { title: cached || budget-- > 0 ? await this.titleOf(id) : core.titleFromText('', id), size: d.size, mtimeMs: d.mtimeMs });
    }
    const m = core.buildManifest(this.config, [...this.docs.keys()], (id) => info.get(id), this.root, CI, { folders: this.folders, rootName: path.basename(this.root) || this.root });
    m.project.storage = this.dataMode === 'inside' ? path.basename(this.root) + '/.docbench' : this.dir;
    m.index = { ...this.index, docs: this.docs.size };
    return m;
  }

  // ------------------------------------------------------------ 피드백
  get fbDir() { return path.join(this.dir, 'feedback'); }
  /** @param {string} id */
  fbFile(id) {
    if (!core.validFeedbackId(id)) throw new BadRequestError('잘못된 피드백 id');
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
    return this.withLock(core.lockKey.feedback(id), () => this.updateFeedbackLocked(id, patch, version));
  }
  /** @param {string} id @param {any} patch @param {number} [version] */
  async updateFeedbackLocked(id, patch, version) {
    const cur = await this.getFeedback(id);
    if (version != null && cur.version != null && version !== cur.version) throw new ConflictError(cur);
    const { id: _i, createdAt: _c, version: _v, ...rest } = patch || {};
    const next = core.normalizeFeedback({ ...cur, ...rest, version: (cur.version || 1) + 1, updatedAt: new Date().toISOString() }, id);
    // 쓰기 직전에 다시 — 브라우저와의 잠금은 최선 노력이라 그 사이 다른 쪽이 고쳤으면 덮지 않는다
    const again = await this.getFeedback(id);
    if (again.version !== cur.version) throw new ConflictError(again);
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
    const f = path.join(this.dir, 'inbox', core.requestFileName());
    await writeJson(f, { at: new Date().toISOString(), ...req });
    return f;
  }

  // ------------------------------------------------------------ 폴더 지도
  async inventory() {
    const items = [];
    const max = this.config.maxInventory;
    const status = this.git && this.config.inventory?.flags !== false ? await gitStatus(this.root, this.git.prefix) : new Map();
    // 큰 폴더(드라이브 맨 위 등)는 두 단계까지만
    const maxDepth = this.index.reason === 'big-root' ? 1 : 10;
    const walk = async (dir, parent, depth) => {
      if (depth > maxDepth || items.length >= max) return;
      let ents = [];
      try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      ents.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of ents) {
        if (items.length >= max) break;
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        const rel = parent + e.name;
        if (e.isDirectory()) {
          if (!core.walkable(e.name)) continue;
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
      flagLabels: core.INVENTORY_FLAG_LABELS,
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
    // 기록 폴더 안의 경로(기록 폴더 기준)
    const onData = (rel) => {
      rel = rel.split(path.sep).join('/');
      if (rel.startsWith('feedback/')) return later('fb', () => emit({ type: 'feedback' }), 150);
      if (rel === 'changes.jsonl') return later('changes', () => void announceChanges(), 200);
      if (rel === 'config.json') return later('config', async () => { await this.loadConfig(); await this.scan(); emit({ type: 'manifest' }); });
    };
    const insideData = this.dataMode === 'inside';
    const onPath = (rel) => {
      if (!rel) return;
      rel = rel.split(path.sep).join('/');
      if (rel.startsWith('.docbench/')) { if (insideData) onData(rel.slice('.docbench/'.length)); return; }
      if (rel.split('/').some((s) => IGNORE_DIRS.has(s))) return;
      if (!this.isDoc(rel)) return;
      later('doc:' + rel, async () => {
        const listChanged = await this.scan();
        if (listChanged) emit({ type: 'manifest' });
        if (this.docs.has(rel)) await this.touched(rel, emit);
      });
    };
    const self = this;
    // 이력에 새로 붙은 줄의 문서를 알린다 — CLI 는 새 판을 state.json 에 먼저 적어 '외부 편집'이 아니므로
    // 이것이 없으면 터미널의 Claude 가 고친 문서를 화면이 다시 읽지 않는다(e2e 로 재현)
    // 위치는 완성된 줄(마지막 줄바꿈)까지만 옮긴다 — 반쯤 쓴 줄은 다음에. 파일이 줄면(되돌림) 거기서부터 다시.
    // 한 번에 하나만 돈다(겹치면 위치가 두 번 옮겨져 줄을 건너뛰었다 — 독립 검토 재현). 돌고 있으면 끝난 뒤 한 번 더
    let changesOffset = -1;
    let announcing = null;
    let announceAgain = false;
    const announceChanges = async () => {
      if (announcing) { announceAgain = true; return announcing; }
      announcing = (async () => {
        do { announceAgain = false; await announceOnce(); } while (announceAgain);
      })().finally(() => { announcing = null; });
      return announcing;
    };
    const announceOnce = async () => {
      const st = await fs.stat(this.changesFile).catch(() => null);
      const size = st?.size ?? 0;
      if (changesOffset < 0 || size < changesOffset) { changesOffset = size; emit({ type: 'changes' }); return; }
      if (size > changesOffset) {
        const fh = await fs.open(this.changesFile, 'r').catch(() => null);
        if (fh) {
          try {
            const { buffer, bytesRead } = await fh.read(Buffer.alloc(size - changesOffset), 0, size - changesOffset, changesOffset);
            const { entries, consumed } = core.completeChangeLines(buffer.subarray(0, bytesRead));
            changesOffset += consumed;
            const ids = new Set();
            // 이 프로세스가 쓴 (문서, 판)은 이미 알렸다(PUT 응답 뒤 handler 가 doc 이벤트를 낸다). 한 번 보면 지운다 —
            // 나중에 남이 같은 바이트로 되돌린 것은 다시 알려야 하므로
            for (const e of entries) {
              if (!e?.docId) continue;
              const k = e.docId + '\0' + e.toVersion;
              if (e.toVersion && this.ownWrites.has(k)) { this.ownWrites.delete(k); continue; }
              ids.add(e.docId);
            }
            for (const id of ids) emit({ type: 'doc', id });
          } finally { await fh.close(); }
        }
      }
      emit({ type: 'changes' });
    };
    void fs.stat(this.changesFile).then((st) => { if (changesOffset < 0) changesOffset = st.size; }, () => { if (changesOffset < 0) changesOffset = 0; });
    // 폴링 때(감시가 안 되는 드라이브·알림 넘침) 피드백 폴더도 본다 — 이름·크기·시각 묶음이 바뀌면 알림
    let fbSig = '';
    const pollAll = async () => {
      await self.pollOnce(emit);
      const st = await fs.stat(this.changesFile).catch(() => null);
      if ((st?.size ?? 0) !== changesOffset) await announceChanges();
      const names = (await fs.readdir(this.fbDir).catch(() => [])).filter((n) => n.endsWith('.json')).sort();
      const sts = await Promise.all(names.map((n) => fs.stat(path.join(this.fbDir, n)).catch(() => null)));
      const sig = names.map((n, i) => `${n}@${sts[i]?.size}:${sts[i]?.mtimeMs}`).join('|') || 'none';
      if (fbSig && sig !== fbSig) emit({ type: 'feedback' });
      fbSig = sig;
    };
    let watcher = null;
    let dataWatcher = null;
    let poll = null;
    if (this.small) {
      try {
        // 파일 이름 없이 오는 알림(Windows 버퍼 넘침 등)은 전체를 한 번 훑는다
        watcher = fsWatch(this.root, { recursive: true }, (_ev, file) => (file ? onPath(String(file)) : later('poll', () => void pollAll(), 300)));
        watcher.on('error', () => { watcher?.close(); watcher = null; startPoll(); });
      } catch { startPoll(); }
    } else {
      // 큰 폴더(드라이브 등)는 통째로 감시하지 않는다(D64) — 아는 문서·안쪽 기록만 몇 초마다 본다
      startPoll();
      if (insideData) {
        try {
          dataWatcher = fsWatch(this.dir, { recursive: true }, (_ev, file) => (file ? onData(String(file)) : later('poll', () => void pollAll(), 300)));
          dataWatcher.on('error', () => { dataWatcher?.close(); dataWatcher = null; });
        } catch { /* 폴링 */ }
      }
    }
    if (!insideData) {
      // 기록 폴더가 문서 폴더 밖이면 따로 감시한다
      try {
        dataWatcher = fsWatch(this.dir, { recursive: true }, (_ev, file) => (file ? onData(String(file)) : later('poll', () => void pollAll(), 300)));
        dataWatcher.on('error', () => { dataWatcher?.close(); dataWatcher = null; startPoll(); });
      } catch { startPoll(); }
    }
    function startPoll() { if (!poll) poll = setInterval(() => void pollAll(), 3000); }
    // 안전망: 네트워크 드라이브처럼 알림이 안 오는 곳을 위해 30초마다 한 번 훑는다
    const safety = setInterval(() => { if (!poll) void pollAll(); }, 30000);
    return () => { watcher?.close(); dataWatcher?.close(); if (poll) clearInterval(poll); clearInterval(safety); timers.forEach(clearTimeout); };
  }
  /** @param {(ev: {type: string, id?: string}) => void} emit */
  async pollOnce(emit) {
    const before = new Map([...this.docs].map(([k, v]) => [k, v.mtimeMs]));
    if (this.small) {
      const listChanged = await this.scan();
      if (listChanged) emit({ type: 'manifest' });
    } else {
      // 큰 폴더: 다시 훑지 않고 아는 문서(state.json)의 크기·시각만 본다
      const known = Object.keys((await this.known()).docs || {}).filter((id) => this.docs.has(id)).slice(0, 400);
      for (const id of known) { const d = this.docs.get(id); const st = await fs.stat(d.abs).catch(() => null); if (st) this.docs.set(id, { ...d, size: st.size, mtimeMs: st.mtimeMs }); }
    }
    for (const [id, d] of this.docs) if (before.has(id) && before.get(id) !== d.mtimeMs) await this.touched(id, emit);
  }
  /**
   * 파일이 바뀐 문서: 따라가는 문서(연 적 있는 — state.json)면 외부 편집으로 기록하고 알린다.
   * 아직 안 연 문서는 기록 없이 알리기만 한다(D64 — 열지 않은 문서로 기록 폴더를 채우지 않는다).
   * @param {string} id @param {(ev: {type: string, id?: string}) => void} emit
   */
  async touched(id, emit) {
    if (!(await this.known()).docs?.[id]) { emit({ type: 'doc', id }); return; }
    if (await this.reconcile(id)) { emit({ type: 'doc', id }); emit({ type: 'changes' }); }
  }
}

export { EncodingReadOnlyError };
