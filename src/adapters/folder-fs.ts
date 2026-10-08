/**
 * 폴더 어댑터가 쓰는 최소 파일 시스템. 같은 어댑터를 세 가지 바탕에서 돌린다.
 *  - fsFromHandle: File System Access API(엣지·크롬) — 사용자가 고른 로컬 폴더를 읽고 쓴다
 *  - fsFromFiles:  <input webkitdirectory> 로 받은 파일 목록 — 다른 브라우저에서 읽기만
 *  - fsFromMemory: 메모리 — 테스트·미리보기
 * 경로는 작업 폴더 기준 '/' 구분 상대 경로. '' 는 뿌리.
 */

export interface FsEntry { name: string; kind: 'file' | 'directory' }
export interface FsStat { size: number; mtimeMs: number }
export interface FsFile extends FsStat { bytes: Uint8Array }

export interface FsLike {
  /** 화면에 보일 폴더 이름 */
  readonly name: string;
  readonly writable: boolean;
  /** 없는 폴더면 null */
  list(dir: string): Promise<FsEntry[] | null>;
  /** 없는 파일이면 null */
  read(path: string, maxBytes?: number): Promise<FsFile | null>;
  stat(path: string): Promise<FsStat | null>;
  /** 상위 폴더를 만들며 통째로 쓴다 */
  write(path: string, data: Uint8Array | string): Promise<void>;
  /**
   * 끝에 덧붙인다. File System Access API 에는 O_APPEND 가 없어 기존 내용을 복사한 임시 파일에 덧붙인 뒤 바꿔 끼운다 —
   * 그 사이 다른 프로세스가 덧붙인 줄은 사라질 수 있으므로 부르는 쪽이 잠금(lockKey.changes) 안에서 부른다.
   */
  append(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export class FsReadOnlyError extends Error {
  readonly code = 'READ_ONLY';
  readonly reason = 'folder';
  constructor() { super('이 폴더는 읽기 전용으로 열었습니다'); }
}

const enc = new TextEncoder();
const toBytes = (d: Uint8Array | string) => (typeof d === 'string' ? enc.encode(d) : d);
const split = (p: string) => p.split('/').filter(Boolean);
const isNotFound = (e: unknown) => (e as DOMException)?.name === 'NotFoundError' || (e as DOMException)?.name === 'TypeMismatchError';

// ---------------------------------------------------------------- File System Access API

export function fsFromHandle(root: FileSystemDirectoryHandle, opts: { writable?: boolean } = {}): FsLike {
  const writable = opts.writable !== false;
  async function dirOf(segs: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = root;
    for (const s of segs) {
      try { d = await d.getDirectoryHandle(s, { create }); } catch (e) { if (isNotFound(e)) return null; throw e; }
    }
    return d;
  }
  async function fileOf(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const segs = split(path);
    const name = segs.pop();
    if (!name) return null;
    const d = await dirOf(segs, create);
    if (!d) return null;
    try { return await d.getFileHandle(name, { create }); } catch (e) { if (isNotFound(e)) return null; throw e; }
  }
  const guard = () => { if (!writable) throw new FsReadOnlyError(); };
  return {
    name: root.name,
    writable,
    async list(dir) {
      const d = await dirOf(split(dir), false);
      if (!d) return null;
      const out: FsEntry[] = [];
      for await (const [name, h] of d.entries()) out.push({ name, kind: h.kind });
      return out;
    },
    async read(path, maxBytes) {
      const fh = await fileOf(path, false);
      if (!fh) return null;
      const f = await fh.getFile();
      const blob = maxBytes != null && f.size > maxBytes ? f.slice(0, maxBytes) : f;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), size: f.size, mtimeMs: f.lastModified };
    },
    async stat(path) {
      const fh = await fileOf(path, false);
      if (!fh) return null;
      const f = await fh.getFile();
      return { size: f.size, mtimeMs: f.lastModified };
    },
    async write(path, data) {
      guard();
      const fh = (await fileOf(path, true))!;
      // createWritable 은 임시(.crswap) 파일에 쓰고 close 때 바꿔 끼운다 — 중간에 끊겨도 반쯤 쓴 파일이 남지 않는다
      const w = await fh.createWritable();
      try { await w.write(toBytes(data) as BufferSource); await w.close(); } catch (e) { await w.abort().catch(() => undefined); throw e; }
    },
    async append(path, text) {
      guard();
      const fh = (await fileOf(path, true))!;
      const size = (await fh.getFile()).size;
      const w = await fh.createWritable({ keepExistingData: true });
      try { await w.seek(size); await w.write(enc.encode(text) as BufferSource); await w.close(); } catch (e) { await w.abort().catch(() => undefined); throw e; }
    },
    async remove(path) {
      guard();
      const segs = split(path);
      const name = segs.pop();
      const d = name ? await dirOf(segs, false) : null;
      if (!d || !name) return;
      try { await d.removeEntry(name); } catch (e) { if (!isNotFound(e)) throw e; }
    },
  };
}

// ---------------------------------------------------------------- 파일 목록 (읽기만)

/** <input type=file webkitdirectory> 의 파일들. webkitRelativePath 첫 칸(고른 폴더 이름)을 뿌리로 본다 */
export function fsFromFiles(files: ArrayLike<File>): FsLike {
  const map = new Map<string, File>();
  let name = '';
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const segs = split(rel);
    if (segs.length > 1) { name ||= segs[0]; segs.shift(); }
    map.set(segs.join('/'), f);
  }
  const ro = async (): Promise<never> => { throw new FsReadOnlyError(); };
  return {
    name: name || 'folder',
    writable: false,
    async list(dir) { return listFrom(map.keys(), dir); },
    async read(path, maxBytes) {
      const f = map.get(path);
      if (!f) return null;
      const blob = maxBytes != null && f.size > maxBytes ? f.slice(0, maxBytes) : f;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), size: f.size, mtimeMs: f.lastModified };
    },
    async stat(path) { const f = map.get(path); return f ? { size: f.size, mtimeMs: f.lastModified } : null; },
    write: ro, append: ro, remove: ro,
  };
}

function listFrom(paths: Iterable<string>, dir: string): FsEntry[] | null {
  const pre = dir ? split(dir).join('/') + '/' : '';
  const seen = new Map<string, FsEntry['kind']>();
  let any = !pre;
  for (const p of paths) {
    if (!p.startsWith(pre)) continue;
    any = true;
    const rest = p.slice(pre.length).split('/');
    if (rest.length === 1) seen.set(rest[0], 'file');
    else if (!seen.has(rest[0])) seen.set(rest[0], 'directory');
  }
  return any ? [...seen].map(([name, kind]) => ({ name, kind })) : null;
}

// ---------------------------------------------------------------- 메모리

export interface MemoryFs extends FsLike {
  files: Map<string, { bytes: Uint8Array; mtimeMs: number }>;
  text(path: string): string | undefined;
}

export function fsFromMemory(init: Record<string, string | Uint8Array> = {}, name = 'memory', opts: { writable?: boolean } = {}): MemoryFs {
  const files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>();
  let clock = Date.now();
  const tick = () => (clock = Math.max(clock + 1, Date.now()));
  for (const [k, v] of Object.entries(init)) files.set(split(k).join('/'), { bytes: toBytes(v), mtimeMs: tick() });
  const writable = opts.writable !== false;
  const guard = () => { if (!writable) throw new FsReadOnlyError(); };
  return {
    name, writable, files,
    text: (p) => { const f = files.get(p); return f ? new TextDecoder().decode(f.bytes) : undefined; },
    async list(dir) { return listFrom(files.keys(), dir); },
    async read(path, maxBytes) {
      const f = files.get(path);
      if (!f) return null;
      return { bytes: maxBytes != null ? f.bytes.slice(0, maxBytes) : f.bytes.slice(), size: f.bytes.length, mtimeMs: f.mtimeMs };
    },
    async stat(path) { const f = files.get(path); return f ? { size: f.bytes.length, mtimeMs: f.mtimeMs } : null; },
    async write(path, data) { guard(); files.set(path, { bytes: toBytes(data).slice(), mtimeMs: tick() }); },
    async append(path, text) {
      guard();
      const prev = files.get(path)?.bytes || new Uint8Array();
      const add = enc.encode(text);
      const next = new Uint8Array(prev.length + add.length);
      next.set(prev); next.set(add, prev.length);
      files.set(path, { bytes: next, mtimeMs: tick() });
    },
    async remove(path) { guard(); files.delete(path); },
  };
}
