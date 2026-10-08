/**
 * claude.ai 아티팩트 어댑터 (런타임 계약 0.2.73 기준으로 검토).
 *
 * - 기준본: 아티팩트와 함께 게시한 파일 (manifest·docs/*.md·inventory)
 * - 편집본: db 의 docs/{key} (게시 파일 위에 덮어쓰는 층). key = 문서 id, 경로 문법에 안 맞으면 '@'+base64url
 * - 판 기록: revisions/{key}~{n} (최근 KEEP 개), 변경 이력: changes/* (최근 MAX_CHANGES 개)
 * - 피드백: feedback/{id}, 보기 상태: data/users/{uid}/viewstate (본인만)
 * - AI 제안: sample, 내려받기: downloads, Claude 부르기: comments.sendToClaude (편집자만, 클릭에서)
 *
 * 필요한 선언: capabilities {db:{}, user:{}, comments:{}, sample:{}, downloads:true}
 * Claude 세션도 같은 경로를 ArtifactData 도구로 읽고 쓴다 — docs/claude-artifact.md.
 *
 * db 규칙(계약): 본문은 순수 JSON·256 KiB 이하, 받은 스냅샷은 얼어 있다(고치려면 복제),
 * 쓰기는 마지막 쓴 쪽이 이긴다(트랜잭션 없음) — 저장은 짧은 임대(acquire)로 서로 기다린다.
 */
import { DocConflictError, DocReadOnlyError, FeedbackConflictError, type DocBenchAdapters, type DocContent, type DocEvent, type Feedback, type Inventory, type Manifest, type Person } from '../types';
import { normalizeFeedback, newFeedbackId } from '../core/feedback';
import { diffSections } from '../core/source';
import { toLF } from '../core/markdown';
import { buildProposePrompt, checkProposal } from '../core/prompt';

type Any = any; // 플랫폼 네임스페이스는 런타임 계약(.d.ts)으로만 보장된다

export interface ArtifactOptions {
  manifestUrl?: string;
  inventoryUrl?: string;
  docUrl?: (id: string) => string;
  /** 기준본 이름. 예: "처음 올린 원본" */
  baseLabel?: string;
  /** 'Claude에게 보내기'가 막혔을 때 클립보드에 넣을 문구 */
  fallbackRequest?: (s: { count: number; docs: string[] }) => string;
  /** 플랫폼 응답을 기다릴 최대 시간(ms). 응답 없는 틀에서는 이 시간 뒤 기능 없이 연다. 기본 4000 */
  useTimeoutMs?: number;
}

/** 판 기록은 문서마다 최근 몇 개만 남긴다 (컬렉션 25,000 문서 상한) */
const KEEP_REVISIONS = 30;
const MAX_CHANGES = 600;
const MAX_BODY = 250 * 1024;

/** db 경로 한 칸 문법: 영숫자와 _ - . ~ : @ + 만, 200바이트 이하. 안 맞는 id 는 '@'+base64url */
const SEG_RE = /^[A-Za-z0-9_\-.~:+][A-Za-z0-9_\-.~:@+]{0,179}$/;
const b64u = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const artifactDocKey = (id: string): string => (SEG_RE.test(id) && id !== '.' && id !== '..' ? id : '@' + b64u(id));

const clone = <T>(v: T): T => (v == null ? v : (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))));
/** undefined 는 빼고(새 문서) / null 로(병합 갱신에서 지우기) */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const plainForUpdate = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (x === undefined ? null : x)));
const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;

async function use(name: string, timeoutMs: number): Promise<Any | null> {
  const c = (globalThis as Any).claude;
  if (!c || typeof c.use !== 'function') return null;
  try {
    return await Promise.race([c.use(name), new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
  } catch { return null; }
}

export async function createArtifactAdapters(o: ArtifactOptions = {}): Promise<DocBenchAdapters> {
  const t = o.useTimeoutMs ?? 4000;
  const [db, user, comments, sample, downloads] = await Promise.all(['db', 'user', 'comments', 'sample', 'downloads'].map((n) => use(n, t)));
  const uid: string | null = user ? await Promise.resolve(user.id()).catch(() => null) : null;
  // 공유 데이터에는 id 만 남긴다(이름은 보는 사람마다 다르고 바뀐다)
  const me: Person = uid ? { kind: 'human', id: uid } : { kind: 'human' };
  const canWrite: boolean | null = user ? await Promise.resolve(user.can('data.write')).catch(() => null) : null;
  const holder = (uid || 'anon') + ':' + Math.random().toString(36).slice(2, 10);
  const docUrl = o.docUrl || ((id: string) => `docs/${id}.md`);
  const baseCache = new Map<string, string>();
  const fetchText = async (url: string) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); };
  const baseMd = async (id: string) => { if (!baseCache.has(id)) baseCache.set(id, toLF(await fetchText(docUrl(id)))); return baseCache.get(id)!; };
  const docRef = (id: string) => db.doc('docs/' + artifactDocKey(id));
  const revRef = (id: string, v: number | string) => db.doc(`revisions/${artifactDocKey(id)}~${v}`);
  /** 저장층 본문 → 문서. 읽기 실패는 그대로 던진다(실패를 '편집본 없음'으로 보면 남의 편집을 덮는다) */
  const fromSnap = async (id: string, s: Any): Promise<DocContent> => {
    const ov = s && s.exists ? s.data() : null;
    if (ov && typeof ov.md === 'string') return { id, md: toLF(ov.md), version: String(ov.version || 1), updatedAt: ov.updatedAt, updatedBy: clone(ov.updatedBy) };
    return { id, md: await baseMd(id), version: '0' };
  };
  const content = async (id: string): Promise<DocContent> => {
    if (!db) return { id, md: await baseMd(id), version: '0' };
    return fromSnap(id, await docRef(id).get());
  };

  // ---------------------------------------------------------------- 변경 알림
  const docSubs = new Set<(e: DocEvent) => void>();
  let docUnsub: (() => void) | null = null;
  const seenVer = new Map<string, number>();
  const startDocWatch = () => {
    if (!db || docUnsub) return;
    let first = true;
    let firstC = true;
    let u1: () => void = () => undefined;
    let u2: () => void = () => undefined;
    const onErr = (e: Any) => {
      docUnsub?.();
      docUnsub = null;
      // 다리가 끊긴 구독은 새로 걸어야 살아난다
      if (e?.code === 'unavailable' && docSubs.size) setTimeout(startDocWatch, 1000 + Math.random() * 2000);
    };
    u1 = db.collection('docs').onSnapshot((snap: Any) => {
      for (const d of snap.docs) {
        const b = d.data();
        if (!b || typeof b.md !== 'string') continue;   // 임대만 걸린 빈 문서
        const id = typeof b.docId === 'string' ? b.docId : d.id;
        const v = Number(b.version || 0);
        const prev = seenVer.get(id);
        seenVer.set(id, v);
        // 내 쓰기(확정 전)는 알리지 않는다 — 편집기가 '밖에서 바뀜'으로 오해한다
        if (!first && prev !== v && !d.metadata?.hasPendingWrites) docSubs.forEach((cb) => cb({ type: 'doc', id }));
      }
      if (!snap.metadata?.fromCache) first = false;
    }, onErr);
    u2 = db.collection('changes').orderBy('at', 'desc').limit(1).onSnapshot((snap: Any) => {
      if (!firstC) docSubs.forEach((cb) => cb({ type: 'changes' }));
      if (!snap.metadata?.fromCache) firstC = false;
    }, onErr);
    docUnsub = () => { u1(); u2(); };
  };

  const ad: DocBenchAdapters = {
    docs: {
      manifest: async () => JSON.parse(await fetchText(o.manifestUrl || 'data/manifest.json')) as Manifest,
      load: async (id) => {
        try { return await content(id); }
        catch (e) {
          // 저장층을 못 읽으면 기준본이라도 보여 주되 편집은 막는다
          if (!db) throw e;
          return { id, md: await baseMd(id), version: '0', readOnly: true, readOnlyReason: 'storage' };
        }
      },
      loadVersion: async (id, v) => {
        if (v === '0') return { id, md: await baseMd(id), version: '0' };
        if (!db) return null;
        const s = await revRef(id, v).get();
        return s.exists ? { id, md: toLF(s.data().md), version: v } : null;
      },
      loadBase: async (id) => ({ md: await baseMd(id), label: o.baseLabel || '원본' }),
      save: db && canWrite !== false ? async (id, md, opts) => {
        const ref = docRef(id);
        const lease = await ref.acquire({ holder, ttlMs: 10000 }).catch(() => ({ acquired: true }));
        const cur = await fromSnap(id, await ref.get());
        if (!lease.acquired || cur.version !== opts.baseVersion) throw new DocConflictError(cur);
        const v = Number(cur.version) + 1;
        const at = new Date().toISOString();
        const body = plain({ docId: id, md, version: v, updatedAt: at, updatedBy: me });
        if (bytes(body) > MAX_BODY) throw new DocReadOnlyError('size', '문서가 아티팩트 저장 한도(256 KiB)를 넘습니다');
        // 판 기록이 실패해도(용량 등) 본문 저장은 막지 않는다
        await revRef(id, v).set(plain({ docId: id, version: v, md, at, by: me, summary: opts.summary || null })).catch(() => undefined);
        await ref.set(body);
        seenVer.set(id, v);
        const ds = diffSections(cur.md, md);
        await db.collection('changes').add(plain({ at, docId: id, by: me, summary: opts.summary || null, fromVersion: cur.version, toVersion: String(v), feedbackIds: opts.feedbackIds || [], sections: [...ds.changed, ...ds.added] })).catch(() => undefined);
        if (v > KEEP_REVISIONS) void revRef(id, v - KEEP_REVISIONS).delete().catch(() => undefined);
        return { version: String(v), updatedAt: at };
      } : undefined,
      changes: async (limit) => {
        if (!db) return [];
        const n = Math.min(Math.max(limit ?? 300, 1), 1000);
        const s = await db.collection('changes').orderBy('at', 'desc').limit(Math.max(n, 1000)).get();
        // 오래된 이력은 정리한다 (조용히, 실패해도 그만)
        s.docs.slice(MAX_CHANGES).forEach((d: Any) => void db.collection('changes').doc(d.id).delete().catch(() => undefined));
        return s.docs.slice(0, n).map((d: Any) => ({ id: d.id, ...clone(d.data()) })).reverse();
      },
      inventory: o.inventoryUrl === '' ? undefined : async () => { try { return JSON.parse(await fetchText(o.inventoryUrl || 'data/inventory.json')) as Inventory; } catch { return null; } },
      subscribe: (cb) => {
        docSubs.add(cb);
        startDocWatch();
        return () => { docSubs.delete(cb); if (!docSubs.size && docUnsub) { docUnsub(); docUnsub = null; } };
      },
    },
    feedback: {
      subscribe(cb, onErr) {
        if (!db) {
          const rows = (() => { try { return JSON.parse(localStorage.getItem('docbench:fb') || '[]'); } catch { return []; } })();
          queueMicrotask(() => cb(rows.map((r: Any) => normalizeFeedback(r, r.id))));
          return () => undefined;
        }
        return db.collection('feedback').onSnapshot(
          (snap: Any) => cb(snap.docs.map((d: Any) => normalizeFeedback(clone(d.data()), d.id))),
          (e: Any) => onErr?.(new Error(e?.code || 'db error')),
        );
      },
      async create(input) {
        if (!db) throw new Error('storage unavailable');
        const id = newFeedbackId();
        const now = new Date().toISOString();
        const author = input.author && input.author.kind === 'human' ? me : (input.author || me);
        const row = plain({ ...input, author, status: input.status || 'open', waitingOn: input.waitingOn || 'assistant', thread: input.thread || [], version: 1, createdAt: now, updatedAt: now });
        await db.collection('feedback').doc(id).set(row);
        return normalizeFeedback(row, id);
      },
      async update(id, patch, opts) {
        if (!db) throw new Error('storage unavailable');
        const ref = db.collection('feedback').doc(id);
        const cur = await ref.get();
        if (!cur.exists) throw new Error('feedback not found: ' + id);
        const curRow = normalizeFeedback(clone(cur.data()), id);
        if (opts?.version != null && curRow.version != null && opts.version !== curRow.version) throw new FeedbackConflictError(curRow);
        // 사람 이름은 공유 데이터에 남기지 않는다
        const p: Any = { ...patch };
        if (Array.isArray(p.thread)) p.thread = p.thread.map((m: Any) => (m?.author?.kind === 'human' ? { ...m, author: me } : m));
        await ref.update(plainForUpdate({ ...p, version: (curRow.version || 1) + 1 }));
        return normalizeFeedback(clone((await ref.get()).data()), id) as Feedback;
      },
      async remove(id) { if (db) await db.collection('feedback').doc(id).delete(); },
      mode: () => (db ? 'live' : 'local'),
    },
    viewState: db && uid ? {
      load: async () => { const s = await db.doc(`data/users/${uid}/viewstate`).get(); return s.exists ? clone(s.data()) : null; },
      save: async (st) => { if (bytes(st) < MAX_BODY) await db.doc(`data/users/${uid}/viewstate`).set(plain(st)); },
    } : undefined,
    identity: {
      me: async () => me,
      can: (a) => {
        if (a === 'assistant.propose') return !!sample;
        if (a.startsWith('feedback') || a === 'doc.edit') return !!db && canWrite !== false;
        return true;
      },
    },
    platform: {
      copy: async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } },
      download: downloads ? async (filename, text) => { try { const r = await downloads.save({ filename, data: text }); return r?.status === 'saved'; } catch { return false; } } : undefined,
    },
  };

  if (sample) {
    ad.assistant = {
      name: 'Claude',
      propose: async (req, { signal }) => {
        const opts = { signal, modelTier: 'complex' as const, cache: false };
        const input = buildProposePrompt(req);
        let out: unknown;
        try { out = await sample.json(input, opts); }
        catch (e: Any) {
          // 오래된 뷰어에는 json 이 없다 → 글로 받아 JSON 만 떼어 낸다
          if (e?.code !== 'capability_removed') throw Object.assign(new Error(e?.message || e?.code || 'sample error'), { code: e?.code });
          const r = await sample(input, opts);
          const text = String(r?.text || '');
          out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        }
        return checkProposal(req, out);
      },
    };
  }

  ad.notifier = {
    label: 'Claude에게 넘기기',
    async send(s) {
      const text = o.fallbackRequest ? o.fallbackRequest(s) : `피드백 반영 — 작업대 Claude 차례 ${s.count}건 (${s.docs.join(', ')})`;
      if (comments && typeof comments.canSendToClaude === 'function') {
        try {
          if ((await comments.canSendToClaude()) === 'available') {
            const anchor = await comments.anchorFor(document.querySelector('.db-bar') || document.body);
            await comments.sendToClaude({ anchor, text });
            return { delivered: true };
          }
        } catch (e: Any) {
          // 이 코드들만 '아무것도 안 올라갔다'가 보장된다. 그 밖엔 중복 요청을 막으려고 복사 대신 확인을 권한다
          const nothingPosted = ['claude_unavailable', 'consent_required', 'forbidden', 'invalid', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error'];
          if (e?.code && !nothingPosted.includes(e.code)) return { delivered: false, message: '전송 여부를 확인하지 못했습니다. 댓글 패널을 확인한 뒤 필요하면 다시 보내 주세요.' };
        }
      }
      const ok = await ad.platform!.copy!(text);
      return { delivered: false, message: ok ? '요청 문구를 복사했습니다. 이 대화 채팅에 붙여 넣으면 Claude가 처리합니다.' : '채팅에 "피드백 반영"이라고 보내 주세요.' };
    },
  };
  return ad;
}

export type { Feedback };
