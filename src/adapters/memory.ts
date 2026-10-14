/**
 * 메모리 어댑터 — 데모·테스트·오프라인 미리보기용. persist 를 주면 브라우저 저장소에 남긴다.
 * 실제 운영 저장소를 붙이기 전에 화면을 시험할 때 쓴다.
 */
import { DocConflictError, type Assistant, type ChangeEntry, type DocBenchAdapters, type DocContent, type DocEvent, type Feedback, type Inventory, type InventoryItem, type Manifest, type Person, type ViewState } from '../types';
import { normalizeFeedback, newFeedbackId } from '../core/feedback';
import { diffSections, sectionSources } from '../core/source';
import { toLF, frontMatterData } from '../core/markdown';
import { formatOf, isMarkdownPath, editableFormat } from '../core/formats';
import { computeOverview, pickReadmes, relativeLinks } from '../core/overview';
import { parseRulesText, RULES_FILE } from '../core/rules';
import { titleFromText } from '../core/workspace';

export interface MemoryInit {
  manifest: Manifest;
  docs: Record<string, string>;
  base?: Record<string, string>;
  feedback?: Partial<Feedback>[];
  inventory?: Inventory;
  me?: Person;
  assistant?: Assistant;
  /** localStorage 키 접두어. 주면 새로고침해도 남는다 */
  persist?: string;
  /** 다른 사람·AI 가 고친 것처럼 흉내 낼 때 쓴다 (테스트) */
  onReady?: (api: MemoryControl) => void;
}

export interface MemoryControl {
  externalEdit(id: string, md: string, by?: Person): void;
  /** 누가 고쳤는지·왜(요약·피드백)를 남기며 쓴다 — 시작하기의 흉내 Claude 가 쓴다 */
  write(id: string, md: string, by: Person, summary?: string, feedbackIds?: string[]): void;
  feedback(): Feedback[];
}

export function createMemoryAdapters(init: MemoryInit): DocBenchAdapters & { control: MemoryControl } {
  const key = init.persist;
  const load = <T>(k: string, d: T): T => { if (!key) return d; try { const v = localStorage.getItem(key + ':' + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k: string, v: unknown) => { if (!key) return; try { localStorage.setItem(key + ':' + k, JSON.stringify(v)); } catch { /* 무시 */ } };
  const me: Person = init.me || { kind: 'human', id: 'me', name: '나' };
  const docs: Record<string, { md: string; version: number; updatedAt?: string; updatedBy?: Person }> = load('docs', Object.fromEntries(Object.entries(init.docs).map(([k, v]) => [k, { md: toLF(v), version: 1 }])));
  const hist: Record<string, Record<number, string>> = load('hist', Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, { [v.version]: v.md }])));
  let changes: ChangeEntry[] = load('changes', []);
  let rows: Feedback[] = load('feedback', (init.feedback || []).map((r, i) => normalizeFeedback({ ...r, order: r.order ?? i }, r.id || newFeedbackId())));
  let view: ViewState | null = load('view', null);
  let standing: string = load('standing', '');
  const fbSubs = new Set<(r: Feedback[]) => void>();
  const docSubs = new Set<(e: DocEvent) => void>();
  const emitFb = () => { save('feedback', rows); const snap = rows.map((r) => ({ ...r })); fbSubs.forEach((cb) => cb(snap)); };
  const emitDoc = (e: DocEvent) => docSubs.forEach((cb) => cb(e));
  const content = (id: string): DocContent => {
    const d = docs[id];
    if (!d) throw new Error('not found: ' + id);
    return { id, md: d.md, version: String(d.version), updatedAt: d.updatedAt, updatedBy: d.updatedBy };
  };
  const write = (id: string, md: string, by: Person, summary?: string, feedbackIds?: string[]) => {
    const prev = docs[id];
    const v = prev.version + 1;
    const ds = diffSections(prev.md, md, id);
    docs[id] = { md, version: v, updatedAt: new Date().toISOString(), updatedBy: by };
    (hist[id] ||= {})[v] = md;
    changes.push({ at: docs[id].updatedAt!, docId: id, by, summary, fromVersion: String(prev.version), toVersion: String(v), feedbackIds, sections: [...ds.changed, ...ds.added] });
    save('docs', docs); save('hist', hist); save('changes', changes);
    return v;
  };
  const control: MemoryControl = {
    externalEdit(id, md, by = { kind: 'assistant', name: 'AI' }) { write(id, toLF(md), by, 'external edit'); emitDoc({ type: 'doc', id }); emitDoc({ type: 'changes' }); },
    write(id, md, by, summary, feedbackIds) { write(id, toLF(md), by, summary, feedbackIds); emitDoc({ type: 'doc', id }); emitDoc({ type: 'changes' }); },
    feedback: () => rows,
  };
  init.onReady?.(control);
  return {
    control,
    docs: {
      manifest: async () => init.manifest,
      load: async (id) => content(id),
      loadVersion: async (id, v) => { const md = hist[id]?.[Number(v)]; return md == null ? null : { id, md, version: v }; },
      loadBase: init.base ? async (id) => (init.base![id] != null ? { md: toLF(init.base![id]), label: '기준본' } : null) : undefined,
      save: async (id, md, o) => {
        const cur = docs[id];
        if (String(cur.version) !== o.baseVersion) throw new DocConflictError(content(id));
        const v = write(id, toLF(md), me, o.summary, o.feedbackIds);
        emitDoc({ type: 'changes' });
        return { version: String(v), updatedAt: docs[id].updatedAt };
      },
      changes: async () => changes.slice(),
      inventory: init.inventory ? async () => init.inventory! : undefined,
      subscribe: (cb) => { docSubs.add(cb); return () => docSubs.delete(cb); },
      // 개요(D88) — 메모리의 문서만으로: 폴더·크기·앞머리·README·링크
      overview: async (o) => {
        const items: InventoryItem[] = [];
        const dirs = new Set<string>();
        const enc = new TextEncoder();
        for (const [id, d] of Object.entries(docs)) {
          const parts = id.split('/');
          for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
          items.push({ id, parent: parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '', name: parts[parts.length - 1], folder: false, kind: (id.split('.').pop() || '').toLowerCase(), size: enc.encode(d.md).length, modified: d.updatedAt || new Date().toISOString(), docId: id });
        }
        for (const p of dirs) items.push({ id: p + '/', parent: p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '', name: p.split('/').pop()!, folder: true });
        const readmes: Record<string, { id: string; text: string }> = {};
        for (const [dir, id] of Object.entries(pickReadmes(items, o?.scope))) readmes[dir] = { id, text: docs[id]?.md ?? '' };
        const meta: Record<string, Record<string, string | string[]>> = {};
        // 글이 다 있으니 앞머리가 없는 문서도 {}(읽음) — 팀 규칙이 "앞머리 없음"으로 본다
        for (const [id, d] of Object.entries(docs)) if (isMarkdownPath(id) || !formatOf(id)) meta[id] = frontMatterData(d.md);
        const links = Object.entries(docs).filter(([id]) => isMarkdownPath(id) || !formatOf(id)).map(([id, d]) => ({ from: id, to: relativeLinks(d.md, id) }));
        // 팀 규칙(D90) — 문서로 실려 온 docbench.json
        const rules = docs[RULES_FILE] ? { file: RULES_FILE, ...parseRulesText(docs[RULES_FILE].md) } : undefined;
        return computeOverview({ root: init.manifest.rootName || init.manifest.project.name, items, complete: true, isDoc: (p) => p in docs, meta, readmes, links, config: { purpose: init.manifest.purpose }, ...(rules ? { rules } : {}), ...(o?.scope ? { base: o.scope } : {}) });
      },
      // 새 문서 — 메모리에만(시작하기에서 README 만들기를 해 볼 수 있게)
      create: async (id, md, o) => {
        if (docs[id]) throw new DocConflictError(content(id));
        const f = formatOf(id);
        if (f && !editableFormat(f)) throw new Error('이 형식은 만들 수 없습니다: ' + id);
        const text = toLF(md);
        docs[id] = { md: text, version: 1, updatedAt: new Date().toISOString(), updatedBy: me };
        (hist[id] ||= {})[1] = text;
        changes.push({ at: docs[id].updatedAt!, docId: id, by: me, summary: o?.summary, toVersion: '1', sections: sectionSources(text, id).map((s) => s.key) });
        init.manifest.docs[id] = { title: titleFromText(text, id), source: { path: id } };
        // 목록에도 — 맨 위 폴더의 묶음(buildManifest 의 dir: 묶음)에
        const top = id.includes('/') ? id.split('/')[0] : '';
        const g = init.manifest.groups.find((x) => x.id === 'dir:' + (top || '.'));
        if (g) g.docs.push(id); else init.manifest.groups.push({ id: 'dir:' + (top || '.'), label: top || '문서', docs: [id] });
        save('docs', docs); save('hist', hist); save('changes', changes);
        emitDoc({ type: 'manifest' }); emitDoc({ type: 'changes' });
        return { version: '1', updatedAt: docs[id].updatedAt };
      },
    },
    feedback: {
      subscribe(cb) { fbSubs.add(cb); queueMicrotask(() => cb(rows.map((r) => ({ ...r })))); return () => fbSubs.delete(cb); },
      async create(input) {
        const now = new Date().toISOString();
        const f = normalizeFeedback({ ...input, author: input.author || me, createdAt: now, updatedAt: now, version: 1 }, newFeedbackId());
        rows = [...rows, f];
        emitFb();
        return f;
      },
      async update(id, patch) {
        const i = rows.findIndex((r) => r.id === id);
        if (i < 0) throw new Error('not found');
        // null 은 지우기 — 서버·폴더와 같이 정규화를 거친다
        const f = normalizeFeedback({ ...rows[i], ...patch, id, version: (rows[i].version || 1) + 1, updatedAt: new Date().toISOString() } as never, id);
        rows = rows.map((r, j) => (j === i ? f : r));
        emitFb();
        return f;
      },
      async remove(id) { rows = rows.filter((r) => r.id !== id); emitFb(); },
      mode: () => (key ? 'local' : 'local'),
    },
    viewState: { load: async () => view, save: async (s) => { view = s; save('view', s); } },
    instructions: { load: async () => standing, save: async (t) => { standing = String(t || '').slice(0, 4000); save('standing', standing); } },
    identity: { me: async () => me, can: () => true },
    assistant: init.assistant,
    notifier: {
      async send(s) { return { delivered: false, message: `${s.count}건을 보냄으로 표시했습니다 (데모 — 실제로 보내지 않음)` }; },
    },
  };
}
