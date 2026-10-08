/**
 * REST 어댑터 — docs/openapi.yaml 계약을 따르는 서버에 붙는다.
 * 기본 대상은 같은 저장소의 로컬 작업 폴더 서버(`docbench serve`)지만,
 * 사내 대시보드 백엔드가 같은 계약을 구현하면 그대로 쓸 수 있다.
 */
import { DocConflictError, DocReadOnlyError, FeedbackConflictError, type DocBenchAdapters, type DocEvent, type Feedback, type Person, type ProposeRequest, type RunLogLine, type RunsAvailability, type RunStatus, type TreeEntry, type ViewState } from '../types';
import { normalizeFeedback } from '../core/feedback';

export interface RestOptions {
  /** API 기준 경로. 기본 '/api' */
  base?: string;
  /** 매 요청에 붙일 헤더 (사내 SSO 토큰 등) */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** 이벤트 스트림·요청에 쿼리로 붙일 토큰 (EventSource 는 헤더를 못 단다) */
  token?: string;
  /** 실시간 반영 방식. 기본 'sse', 막혀 있으면 'poll' */
  live?: 'sse' | 'poll' | 'none';
  pollMs?: number;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
}

interface Session {
  me: Person;
  permissions: string[];
  assistant?: { name: string } | null;
  notify?: { label?: string } | null;
  features?: { base?: boolean; versions?: boolean; inventory?: boolean; changes?: boolean; runs?: boolean; tree?: boolean };
  /** 사람이 어디서 왔나 — 'pc' 면 화면의 "나"에서 표시 이름을 바꿀 수 있다(PUT /me) */
  identity?: 'pc' | 'host';
}

export class HttpError extends Error {
  constructor(public status: number, public body: any) { super(body?.message || body?.error || 'HTTP ' + status); }
}

export function createRestAdapters(o: RestOptions = {}): DocBenchAdapters & { ready: Promise<Session> } {
  const base = (o.base || '/api').replace(/\/$/, '');
  const f = o.fetch || ((...a: Parameters<typeof fetch>) => fetch(...a));
  // 토큰은 헤더로 보낸다. 헤더를 못 다는 EventSource 만 쿼리에 싣는다
  const qs = (p: Record<string, string | undefined>, withToken = false) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v != null) u.set(k, v);
    if (withToken && o.token) u.set('token', o.token);
    const s = u.toString();
    return s ? '?' + s : '';
  };
  const auth = (): Record<string, string> => (o.token ? { Authorization: 'Bearer ' + o.token } : {});
  async function call<T>(method: string, path: string, body?: unknown, q: Record<string, string | undefined> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...auth(), ...(o.headers ? await o.headers() : {}) };
    if (method !== 'GET') headers['X-DocBench'] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await f(base + path + qs(q), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: o.credentials || 'same-origin' });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new HttpError(r.status, data);
    return data as T;
  }

  // ---------------------------------------------------------------- 이벤트
  type Listener = (e: DocEvent) => void;
  const listeners = new Set<Listener>();
  let es: EventSource | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let mode: 'live' | 'poll' | 'local' = 'poll';
  const fire = (e: DocEvent) => listeners.forEach((l) => l(e));
  /** 다시 이어졌거나 폴링 중일 때: 놓친 것을 따라잡는다 (마지막 변경 이력과 비교) */
  let lastChange = '';
  async function catchUp(force = false) {
    fire({ type: 'feedback' });
    try {
      const r = await call<{ items: { at: string; docId: string; toVersion?: string }[] }>('GET', '/changes', undefined, { limit: '20' });
      const items = r.items || [];
      const tip = items.length ? items[items.length - 1].at + '|' + items[items.length - 1].toVersion : '';
      if (force || (lastChange && tip !== lastChange)) {
        const seen = new Set<string>();
        for (const c of items.slice().reverse()) {
          if (lastChange && !force && c.at + '|' + c.toVersion === lastChange) break;
          if (!seen.has(c.docId)) { seen.add(c.docId); fire({ type: 'doc', id: c.docId }); }
        }
        fire({ type: 'changes' });
        if (force) fire({ type: 'manifest' });
      }
      lastChange = tip;
    } catch { /* 다음 차례에 */ }
  }
  function startEvents() {
    if (es || poll || o.live === 'none') return;
    if (o.live !== 'poll' && typeof EventSource !== 'undefined') {
      es = new EventSource(base + '/events' + qs({}, true));
      mode = 'live';
      let opened = false;
      es.onopen = () => { if (opened) void catchUp(true); opened = true; };   // 서버 재시작 뒤 다시 이어지면 전부 다시 읽는다
      for (const t of ['doc', 'manifest', 'feedback', 'changes', 'request', 'runs', 'runner'] as const) es.addEventListener(t, (ev) => {
        let d: any = {};
        try { d = JSON.parse((ev as MessageEvent).data || '{}'); } catch { /* 빈 이벤트 */ }
        fire({ type: t, id: d.id });
      });
      es.onerror = () => { if (es && es.readyState === EventSource.CLOSED) { es = null; mode = 'poll'; startPoll(); } };
    } else startPoll();
  }
  function startPoll() {
    if (poll) return;
    mode = 'poll';
    void catchUp();
    poll = setInterval(() => void catchUp(), o.pollMs || 8000);
  }
  function stopEvents() {
    if (listeners.size) return;
    es?.close(); es = null;
    if (poll) clearInterval(poll); poll = null;
  }
  const on = (l: Listener) => { listeners.add(l); startEvents(); return () => { listeners.delete(l); stopEvents(); }; };

  const ready = call<Session>('GET', '/session');
  const mapDocErr = (e: unknown): never => {
    if (e instanceof HttpError) {
      if (e.status === 409 && e.body?.current) throw new DocConflictError(e.body.current);
      if (e.status === 422 || e.body?.error === 'READ_ONLY') throw new DocReadOnlyError(e.body?.reason || 'read-only', e.body?.message);
    }
    throw e;
  };

  return {
    ready,
    docs: {
      manifest: () => call('GET', '/manifest'),
      load: (id) => call('GET', '/doc', undefined, { id }),
      loadVersion: async (id, v) => { try { return await call('GET', '/doc/version', undefined, { id, v }); } catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; } },
      loadBase: async (id) => { try { return await call('GET', '/doc/base', undefined, { id }); } catch (e) { if (e instanceof HttpError && (e.status === 404 || e.status === 501)) return null; throw e; } },
      save: (id, md, opts) => call<{ version: string; updatedAt?: string }>('PUT', '/doc', { md, ...opts }, { id }).catch(mapDocErr),
      changes: (limit) => call<{ items: any[] }>('GET', '/changes', undefined, { limit: limit ? String(limit) : undefined }).then((r) => r.items),
      inventory: async () => { try { return await call('GET', '/inventory'); } catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; } },
      subscribe: (cb) => on((e) => { if (e.type !== 'feedback') cb(e); }),
      // 서버는 파일을 바로 감시한다 — "확인 n초 전" 대신 실시간
      refresh: async (id) => { await call('GET', '/doc', undefined, { id }); return false; },
      tree: async (dir) => { try { return (await call<{ items: TreeEntry[] }>('GET', '/tree', undefined, { dir })).items; } catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; } },
    },
    runs: {
      status: () => call<RunsAvailability>('GET', '/runs/status'),
      start: (input) => call<RunStatus>('POST', '/runs', input),
      cancel: (id) => call<void>('POST', '/runs/' + encodeURIComponent(id) + '/cancel'),
      list: (limit) => call<{ items: RunStatus[] }>('GET', '/runs', undefined, { limit: limit ? String(limit) : undefined }).then((r) => r.items),
      log: (id, from) => call<{ lines: RunLogLine[]; next: number }>('GET', '/runs/' + encodeURIComponent(id) + '/log', undefined, { from: String(from || 0) }),
    },
    feedback: {
      subscribe(cb, onErr) {
        let alive = true;
        const pull = () => call<{ items: Feedback[] }>('GET', '/feedback').then((r) => { if (alive) cb(r.items.map((x) => normalizeFeedback(x as any, x.id))); }).catch((e) => onErr?.(e));
        void pull();
        const off = on((e) => { if (e.type === 'feedback') void pull(); });
        return () => { alive = false; off(); };
      },
      create: (input) => call<Feedback>('POST', '/feedback', input),
      update: (id, patch, opts) => call<Feedback>('PATCH', '/feedback/' + encodeURIComponent(id), { patch, version: opts?.version }).catch((e) => {
        if (e instanceof HttpError && e.status === 409 && e.body?.current) throw new FeedbackConflictError(e.body.current);
        throw e;
      }),
      remove: (id) => call<void>('DELETE', '/feedback/' + encodeURIComponent(id)),
      mode: () => mode,
    },
    viewState: {
      load: () => call<ViewState | null>('GET', '/viewstate').catch(() => null),
      save: (s) => call<void>('PUT', '/viewstate', s),
    },
    identity: {
      me: async () => (await ready).me,
      can: async (a) => (await ready).permissions.includes(a),
      setName: async (name) => call<Person>('PUT', '/me', { name }),
    },
    assistant: {
      name: 'AI',
      available: async () => !!(await ready).assistant,
      propose: async (req: ProposeRequest, { signal }) => {
        const r = await f(base + '/assistant/propose', {
          method: 'POST', signal, credentials: o.credentials || 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-DocBench': '1', ...auth(), ...(o.headers ? await o.headers() : {}) },
          body: JSON.stringify({ docId: req.docId, feedbackId: req.feedback.id, sectionPath: req.sectionPath }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new HttpError(r.status, data);
        return data;
      },
    },
    notifier: {
      send: (s) => call('POST', '/notify', s),
    },
    platform: {
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
}

/** 세션 정보로 쓸 수 없는 어댑터를 걷어낸다 (서버가 AI·알림을 끄면 버튼도 숨김) */
export async function trimBySession(ad: DocBenchAdapters & { ready: Promise<Session> }, assistantName?: string): Promise<DocBenchAdapters> {
  const s = await ad.ready;
  const out: DocBenchAdapters = { ...ad };
  if (!s.assistant) delete out.assistant;
  else out.assistant = { ...ad.assistant!, name: assistantName || s.assistant.name };
  if (!s.notify) delete out.notifier;
  if (!s.features?.runs) delete out.runs;
  if (s.features && s.features.base === false) out.docs = { ...out.docs, loadBase: undefined };
  // 나무(펼친 폴더만 읽기)를 모르는 예전 서버·다른 백엔드면 빼고 예전 목록으로
  if (!s.features?.tree) out.docs = { ...out.docs, tree: undefined };
  // 사람을 호스트가 정하는 백엔드(대시보드 로그인)는 이름을 바꾸지 않는다
  if (s.identity === 'pc') out.identity = { ...ad.identity!, source: 'pc' };
  else out.identity = { me: ad.identity!.me, can: ad.identity!.can, source: 'host' };
  return out;
}
