/**
 * 폴더 고르기·기억하기 (엣지·크롬). 고른 폴더 핸들은 이 페이지 출처의 IndexedDB 에 남겨 다음에 다시 연다.
 * 권한은 브라우저가 관리한다 — 다시 열 때 한 번 더 물을 수 있다(사용자 클릭이 필요).
 */

export const folderAccessSupported = (): boolean => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

/** 폴더 고르기 창을 띄운다. 사용자가 취소하면 null */
/** id 마다 브라우저가 지난번 자리에서 고르기 창을 연다 — 문서 폴더('docbench')·기록 보관함('docbench-home') 따로 */
export async function pickFolder(id = 'docbench'): Promise<FileSystemDirectoryHandle | null> {
  if (!folderAccessSupported()) throw new Error('이 브라우저는 폴더 열기를 지원하지 않습니다 (엣지·크롬 필요)');
  try { return await window.showDirectoryPicker!({ id, mode: 'readwrite' }); } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

/** 읽기·쓰기 권한이 있는지 보고, request 면 묻는다(사용자 클릭 안에서 불러야 한다) */
export async function ensurePermission(h: FileSystemHandle, mode: 'read' | 'readwrite' = 'readwrite', request = true): Promise<boolean> {
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode })) === 'granted') return true;
  if (!request || !h.requestPermission) return false;
  return (await h.requestPermission({ mode })) === 'granted';
}

const DB = 'docbench';
const STORE = 'folders';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally { d.close(); }
}

export async function rememberFolder(h: FileSystemDirectoryHandle, key = 'last'): Promise<void> {
  try { await tx('readwrite', (s) => s.put(h, key)); } catch { /* 저장소가 막힌 환경: 다음에 다시 고르면 된다 */ }
}
export async function recallFolder(key = 'last'): Promise<FileSystemDirectoryHandle | null> {
  try { return ((await tx('readonly', (s) => s.get(key))) as FileSystemDirectoryHandle | undefined) || null; } catch { return null; }
}
export async function forgetFolder(key = 'last'): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(key)); } catch { /* 무시 */ }
}
