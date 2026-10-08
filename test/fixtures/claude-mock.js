// claude.use() 흉내 — 계약 0.2.73 의 모양만 따라 한 메모리 저장소. 스냅샷 data() 는 깊게 얼린다(얼린 값 변경 버그 잡기)
(() => {
  const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const store = new Map(JSON.parse(localStorage.getItem('mockdb') || '[]'));
  const persist = () => localStorage.setItem('mockdb', JSON.stringify([...store]));
  const subs = new Set();
  const notify = (pending) => { for (const s of subs) s(pending); };
  const seg = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  const check = (p, even) => { const parts = p.split('/'); if (!parts.every((x) => seg.test(x)) || (parts.length % 2 === 0) !== even) throw new TypeError('bad path ' + p); };
  const snapDoc = (path, pending) => { const v = store.get(path); return { id: path.split('/').pop(), exists: v !== undefined, data: () => (v === undefined ? undefined : deepFreeze(JSON.parse(JSON.stringify(v)))), metadata: { fromCache: false, hasPendingWrites: !!pending } }; };
  const log = (window.__dblog = []);
  const docRef = (path) => { check(path, true); return {
    id: path.split('/').pop(), path,
    get: async () => snapDoc(path),
    set: async (d) => { if (JSON.stringify(d).includes('undefined')) throw { code: 'invalid_argument' }; log.push(['set', path]); store.set(path, JSON.parse(JSON.stringify(d))); persist(); notify(true); notify(false); },
    update: async (d) => { if (!store.has(path)) throw { code: 'invalid_argument' }; log.push(['update', path]); const cur = store.get(path); const merge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v); else a[k] = v; } }; merge(cur, JSON.parse(JSON.stringify(d))); persist(); notify(true); notify(false); },
    delete: async () => { store.delete(path); persist(); notify(false); },
    acquire: async () => ({ acquired: true, version: 1 }),
    onSnapshot: (next) => { const f = (p) => next(snapDoc(path, p)); subs.add(f); setTimeout(() => f(false)); return () => subs.delete(f); },
  }; };
  const query = (col, ord, lim) => ({
    orderBy: (f, dir) => query(col, [f, dir], lim),
    limit: (n) => query(col, ord, n),
    get: async () => qsnap(col, ord, lim, false),
    onSnapshot: (next) => { const f = (p) => next(qsnap(col, ord, lim, p)); subs.add(f); setTimeout(() => f(false)); return () => subs.delete(f); },
  });
  const qsnap = (col, ord, lim, pending) => {
    let ds = [...store.keys()].filter((k) => k.startsWith(col + '/') && k.split('/').length === col.split('/').length + 1).map((k) => snapDoc(k, pending));
    if (ord) ds.sort((a, b) => String(a.data()[ord[0]]).localeCompare(String(b.data()[ord[0]])) * (ord[1] === 'desc' ? -1 : 1));
    if (lim) ds = ds.slice(0, lim);
    return { docs: ds, size: ds.length, empty: !ds.length, metadata: { fromCache: false, hasPendingWrites: !!pending } };
  };
  const collection = (col) => { check(col, false); return { ...query(col), doc: (id) => docRef(col + '/' + id), add: async (d) => { const id = 'a' + Math.random().toString(36).slice(2, 10); await docRef(col + '/' + id).set(d); return docRef(col + '/' + id); } }; };
  const db = { doc: docRef, collection };
  const user = { id: async () => 'u_mockuser0000000000000', me: async () => ({ id: 'u_mockuser0000000000000', name: '' }), can: async () => true, isOwner: () => true, canEdit: () => true };
  const sample = async (input) => ({ text: JSON.stringify({ after: (/--- SECTION START ---\n([\s\S]*)\n--- SECTION END ---/.exec(input) || [, ''])[1].replace(/\n*$/, '') + '\n\n(모의 제안) 한 줄\n', rationale: '모의 제안입니다' }), truncated: false });
  sample.json = async () => { throw { code: 'capability_removed', message: 'old viewer' }; };   // 옛 뷰어 경로를 일부러 탄다
  const sent = (window.__sent = []);
  const comments = { canSendToClaude: async () => 'available', anchorFor: async () => ({ kind: 'element' }), sendToClaude: async (x) => { sent.push(x); return { threadId: 't1', commentId: 'c1' }; } };
  const downloads = { save: async () => ({ status: 'saved' }) };
  const caps = { db, user, sample, comments, downloads };
  window.claude = { use: async (n) => caps[n] ?? null };
  window.__seed = (rows) => { for (const [p, v] of rows) store.set(p, v); persist(); };
})();
