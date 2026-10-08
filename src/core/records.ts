/**
 * 기록 합치기 (D66) — 좁은 폴더로 쓰던 기록을 그 폴더를 품은 넓은 작업 공간의 기록으로 옮긴다.
 *
 * 작업 공간은 "넓게 한 번" 여는 것이 기본이다(큰 폴더도 펼친 곳만 읽는다). 그런데 하위 폴더를 먼저 따로 열어 썼다면
 * 같은 문서의 기록이 두 벌이 된다. 넓은 쪽을 열 때 하위 폴더의 기록을 합쳐 한 벌로 만든다:
 *
 *   하위 기록(src)의 문서 id 'a.md'  →  넓은 기록(dst)의 'docs/a.md'   (prefix = 'docs')
 *
 * 옮기는 것: 피드백(문서 id·지도 항목 id), 변경 이력(시각 순으로 섞어), 알던 판(state.json), 보기 상태(사람별), 본문 판(blobs),
 * 함께 쓰는 설정(config.json — 문서별 설정·모음). 옮기지 않는 것: Claude 작업(runs·runners)·요청함·잠금(지난 작업 기록은 하위 쪽에 남는다).
 * 같은 이름이 이미 넓은 쪽에 있으면 넓은 쪽을 남긴다(덮지 않는다). 하위 기록은 지우지 않는다 — 부르는 쪽이 표식에 mergedInto 를 적는다.
 *
 * 입출력은 부르는 쪽(브라우저 FsLike·서버 노드 fs)이 준다. 잠금은 부르는 쪽이 넓은 쪽 changes·state 잠금 안에서 부른다.
 */
import { completeChangeLines, jsonFile, parseJsonText } from './workspace';
import type { ChangeEntry } from '../types';

/** 합치기에 필요한 최소 파일 시스템 */
export interface RecordsFs {
  list(dir: string): Promise<{ name: string; kind: 'file' | 'directory' }[] | null>;
  read(path: string): Promise<{ bytes: Uint8Array } | null>;
  write(path: string, data: Uint8Array | string): Promise<void>;
}

export interface MergeResult { feedback: number; changes: number; blobs: number; views: number; state: number; config: boolean }

const utf8 = new TextDecoder();
const prefixed = (prefix: string, id: unknown): unknown => (typeof id === 'string' && id && prefix ? `${prefix}/${id}` : id);

async function readJson<T>(fs: RecordsFs, path: string): Promise<T | null> {
  const f = await fs.read(path).catch(() => null);
  if (!f) return null;
  try { return parseJsonText(utf8.decode(f.bytes)) as T; } catch { return null; }
}

/** 피드백 한 건의 문서 경로를 넓은 쪽 기준으로 */
export function rebaseFeedback(f: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...f, docId: prefixed(prefix, f.docId) };
  const t = f.target as Record<string, unknown> | undefined;
  if (t && t.kind === 'item' && typeof t.itemId === 'string') out.target = { ...t, itemId: prefixed(prefix, t.itemId) };
  return out;
}

/** 보기 상태(사람별)의 문서 키를 넓은 쪽 기준으로 */
export function rebaseViewState(v: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const docs = (v.docs && typeof v.docs === 'object' ? v.docs : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...v, docs: Object.fromEntries(Object.entries(docs).map(([k, x]) => [prefixed(prefix, k) as string, x])) };
  if (typeof v.last === 'string' && v.last !== 'map' && v.last !== 'changes') out.last = prefixed(prefix, v.last);
  // 고정·최근·펼친 폴더도 넓은 쪽 경로로 (탐색기 상태)
  for (const k of ['pins', 'recent', 'open'] as const) if (Array.isArray(v[k])) out[k] = (v[k] as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => prefixed(prefix, x) as string);
  delete out.groups;
  return out;
}

/** 이력 줄의 문서 경로를 넓은 쪽 기준으로 */
export const rebaseChange = (e: ChangeEntry, prefix: string): ChangeEntry => ({ ...e, docId: prefixed(prefix, e.docId) as string });

/**
 * src(하위 폴더의 기록) → dst(넓은 작업 공간의 기록), 문서 경로 앞에 prefix.
 * 두 번 불러도 같은 결과(이미 옮긴 피드백·판·이력 줄은 다시 넣지 않는다) — 도중에 끊겨도 다시 부르면 된다.
 */
export async function mergeRecords(src: RecordsFs, dst: RecordsFs, prefix: string): Promise<MergeResult> {
  prefix = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const r: MergeResult = { feedback: 0, changes: 0, blobs: 0, views: 0, state: 0, config: false };

  // 피드백 — 파일 하나 = 한 건. id 는 그대로(무작위라 겹치지 않는다), 넓은 쪽에 같은 id 가 있으면 넓은 쪽을 둔다
  for (const e of (await src.list('feedback')) || []) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
    if (await dst.read(`feedback/${e.name}`)) continue;
    const f = await readJson<Record<string, unknown>>(src, `feedback/${e.name}`);
    if (!f || typeof f !== 'object') continue;
    await dst.write(`feedback/${e.name}`, jsonFile(rebaseFeedback(f, prefix)));
    r.feedback++;
  }

  // 본문 판 — 이름이 내용의 해시라 없을 때만 복사
  for (const e of (await src.list('blobs')) || []) {
    if (e.kind !== 'file' || await dst.read(`blobs/${e.name}`)) continue;
    const f = await src.read(`blobs/${e.name}`);
    if (f) { await dst.write(`blobs/${e.name}`, f.bytes); r.blobs++; }
  }

  // 변경 이력 — 두 쪽 줄을 시각 순으로 섞는다. 이미 옮긴 줄(같은 시각·문서·판)은 다시 넣지 않는다
  const srcLog = await src.read('changes.jsonl');
  if (srcLog) {
    const dstLog = await dst.read('changes.jsonl');
    const mine = dstLog ? completeChangeLines(withNewline(dstLog.bytes)).entries : [];
    const key = (e: ChangeEntry) => `${e.at}\u0000${e.docId}\u0000${e.toVersion || ''}\u0000${(e as { type?: string }).type || ''}`;
    const seen = new Set(mine.map(key));
    const add = completeChangeLines(withNewline(srcLog.bytes)).entries.map((e) => rebaseChange(e, prefix)).filter((e) => !seen.has(key(e)));
    if (add.length) {
      const all = [...mine, ...add].map((e, i) => ({ e, i })).sort((a, b) => (String(a.e.at || '') < String(b.e.at || '') ? -1 : String(a.e.at || '') > String(b.e.at || '') ? 1 : a.i - b.i)).map((x) => x.e);
      await dst.write('changes.jsonl', all.map((e) => JSON.stringify(e)).join('\n') + '\n');
      r.changes = add.length;
    }
  }

  // 알던 판 — 넓은 쪽에 없는 문서만
  const ss = await readJson<{ docs?: Record<string, string> }>(src, 'state.json');
  if (ss?.docs && Object.keys(ss.docs).length) {
    const ds = (await readJson<{ docs?: Record<string, string> }>(dst, 'state.json')) || {};
    const docs = { ...(ds.docs || {}) };
    for (const [k, v] of Object.entries(ss.docs)) { const nk = prefixed(prefix, k) as string; if (!(nk in docs)) { docs[nk] = v; r.state++; } }
    if (r.state) await dst.write('state.json', jsonFile({ ...ds, docs }));
  }

  // 보기 상태 — 사람마다 파일 하나. 넓은 쪽에 그 사람 파일이 있으면 문서 키만 보탠다(넓은 쪽 값이 먼저)
  for (const e of (await src.list('viewstate')) || []) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
    const v = await readJson<Record<string, unknown>>(src, `viewstate/${e.name}`);
    if (!v || typeof v !== 'object') continue;
    const moved = rebaseViewState(v, prefix);
    const have = await readJson<Record<string, unknown>>(dst, `viewstate/${e.name}`);
    const next = have && typeof have === 'object'
      ? { ...moved, ...have, docs: { ...(moved.docs as object), ...((have.docs as object) || {}) }, pins: union(have.pins, moved.pins), recent: union(have.recent, moved.recent).slice(0, 20), open: union(have.open, moved.open).slice(-400) }
      : moved;
    await dst.write(`viewstate/${e.name}`, jsonFile(next));
    r.views++;
  }

  // 함께 쓰는 설정 — 문서별 설정·모음(glob 앞에 prefix)을 보탠다. 넓은 쪽 값이 먼저
  const sc = await readJson<Record<string, unknown>>(src, 'config.json');
  if (sc && typeof sc === 'object') {
    const dc = (await readJson<Record<string, unknown>>(dst, 'config.json')) || {};
    const sDocs = (sc.docs && typeof sc.docs === 'object' ? sc.docs : {}) as Record<string, unknown>;
    const dDocs = (dc.docs && typeof dc.docs === 'object' ? dc.docs : {}) as Record<string, unknown>;
    const docs = { ...Object.fromEntries(Object.entries(sDocs).map(([k, v]) => [prefixed(prefix, k) as string, v])), ...dDocs };
    const sGroups = Array.isArray(sc.groups) ? (sc.groups as Record<string, unknown>[]) : [];
    const dGroups = Array.isArray(dc.groups) ? (dc.groups as Record<string, unknown>[]) : [];
    const labels = new Set(dGroups.map((g) => g?.label));
    const groups = [...dGroups, ...sGroups.filter((g) => g && !labels.has(g.label)).map((g) => ({ ...g, match: Array.isArray(g.match) ? (g.match as unknown[]).map((m) => (typeof m === 'string' && prefix ? `${prefix}/${m.replace(/^\/+/, '')}` : m)) : g.match }))];
    if (Object.keys(sDocs).length || sGroups.length) {
      await dst.write('config.json', jsonFile({ ...dc, ...(Object.keys(docs).length ? { docs } : {}), ...(groups.length ? { groups } : {}) }));
      r.config = true;
    }
  }
  return r;
}

/** 두 목록을 겹치지 않게 (앞 목록 먼저) */
const union = (a: unknown, b: unknown): string[] => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter((x): x is string => typeof x === 'string'))];

/** 마지막 줄에 줄바꿈이 없으면 붙여 완성된 줄로 읽게 */
function withNewline(b: Uint8Array): Uint8Array {
  if (!b.length || b[b.length - 1] === 0x0a) return b;
  const out = new Uint8Array(b.length + 1);
  out.set(b); out[b.length] = 0x0a;
  return out;
}
