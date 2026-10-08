/**
 * 폴더 지도 — 작업 폴더와 주변 파일을 트리로. 내용은 열지 않고 메타데이터만.
 */
import type { Inventory, InventoryItem } from '../types';
import { h, CARET, fmtBytes, fmtTime } from './dom';
import type { App } from './app';

interface Node { path: string; name: string; folder: boolean; kids: Node[]; item: InventoryItem | null; size: number; count: number }

let cache: { inv: Inventory; root: Node } | null = null;
let hl: string[] = [];

function build(inv: Inventory): Node {
  const nodes = new Map<string, Node>();
  const root: Node = { path: '', name: '', folder: true, kids: [], item: null, size: 0, count: 0 };
  nodes.set('', root);
  const get = (path: string): Node => {
    if (nodes.has(path)) return nodes.get(path)!;
    const segs = path.replace(/\/$/, '').split('/');
    const n: Node = { path, name: segs[segs.length - 1], folder: true, kids: [], item: null, size: 0, count: 0 };
    nodes.set(path, n);
    get(segs.length > 1 ? segs.slice(0, -1).join('/') + '/' : '').kids.push(n);
    return n;
  };
  for (const it of inv.items) {
    if (it.folder) { const n = get(it.parent + it.name + '/'); n.item = it; n.name = it.name; }
    else get(it.parent).kids.push({ path: it.parent + it.name + '#' + it.id, name: it.name, folder: false, kids: [], item: it, size: it.size || 0, count: 1 });
  }
  const sum = (n: Node) => {
    n.kids.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, 'ko'));
    n.kids.forEach(sum);
    if (n.folder) { n.size = n.kids.reduce((s, k) => s + k.size, 0); n.count = n.kids.reduce((s, k) => s + k.count, 0); }
  };
  sum(root);
  return root;
}

export async function loadInventory(app: App): Promise<Inventory | null> {
  if (!app.ad.docs.inventory) return null;
  try { return await app.ad.docs.inventory(); } catch { return null; }
}

export function renderMap(app: App, refreshOnly = false): void {
  const t = app.t;
  const page = app.els.page;
  if (refreshOnly && cache) { paintTree(app); return; }
  page.replaceChildren(h('p', { class: 'db-loading', text: t('doc.loading') }));
  void loadInventory(app).then((inv) => {
    if (app.view !== 'map') return;
    page.replaceChildren();
    page.append(h('header', { class: 'db-dochead' },
      h('div', { class: 'db-eyebrow' }, h('span', { class: 'db-trust tone-accent', text: t('map.title') })),
      h('h1', { class: 'db-doctitle', text: t('map.title') }),
      h('p', { class: 'db-docrole', text: t('map.role') }),
      inv ? h('div', { class: 'db-meta' }, inv.asof ? h('span', { text: fmtTime(inv.asof) }) : null, inv.source ? h('span', { text: inv.source }) : null) : null));
    if (!inv || !inv.items.length) { page.append(h('p', { class: 'db-empty', text: t('map.none') })); return; }
    cache = { inv, root: build(inv) };
    const ms = (app.state.map ||= {});
    ms.open ||= {};
    const flags = inv.flagLabels || {};
    // 요약 칸
    const cards = h('div', { class: 'db-cards' }, h('div', { class: 'db-stat' }, h('div', { class: 'v', text: inv.items.length }), h('div', { class: 'k', text: t('map.items') })));
    for (const [k, v] of Object.entries(flags)) {
      const n = inv.items.filter((i) => i.flags?.includes(k)).length;
      if (n) cards.append(h('div', { class: 'db-stat' }, h('div', { class: 'v', text: n }), h('div', { class: 'k', text: v.label })));
    }
    page.append(cards);
    if (inv.notes?.length) {
      page.append(h('h2', { class: 'db-doctitle', style: 'font-size:17px;margin-top:6px', text: t('map.notes') }), h('p', { class: 'db-hint', style: 'margin:0 0 4px', text: t('map.notes.hint') }));
      const notes = h('div', { class: 'db-notes' });
      for (const n of inv.notes) notes.append(h('div', { class: 'db-note' },
        h('span', { class: 'lv tone-' + (n.level === 'risk' || n.level === 'pii' ? 'bad' : n.level === 'action' ? 'warn' : 'neutral'), text: t('map.level.' + (n.level || 'tidy')) }),
        h('div', { class: 'nt' }, h('b', { text: n.title }), n.detail ? h('p', { text: n.detail }) : null),
        h('button', { class: 'db-btn sm', type: 'button', onclick: () => revealItems(app, n.ids) }, t('map.show'))));
      page.append(notes);
    }
    // 거르개
    const f = (ms.filters ||= {}) as { show?: string[]; only?: string | null; q?: string };
    f.show ||= [];
    const hidden = inv.hiddenFlags || [];
    const bar = h('div', { class: 'db-filters' }, h('span', { class: 'db-lbl', text: t('map.filter') }));
    for (const k of hidden) if (flags[k]) bar.append(h('button', { class: 'db-chip', type: 'button', 'aria-pressed': String(f.show!.includes(k)), onclick: () => { f.show = f.show!.includes(k) ? f.show!.filter((x) => x !== k) : [...f.show!, k]; app.saveState(); renderMap(app); } }, t('map.include', { label: flags[k].label })));
    for (const [k, v] of Object.entries(flags)) if (!hidden.includes(k)) bar.append(h('button', { class: 'db-chip', type: 'button', 'aria-pressed': String(f.only === k), onclick: () => { f.only = f.only === k ? null : k; app.saveState(); renderMap(app); } }, t('map.only', { label: v.label })));
    const q = h('input', { type: 'search', value: f.q || '', placeholder: t('map.search'), 'aria-label': t('map.search') }) as HTMLInputElement;
    let qt: ReturnType<typeof setTimeout>;
    q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { f.q = q.value; paintTree(app); }, 200); });
    bar.append(h('label', { class: 'db-find' }, q));
    page.append(bar, h('div', { class: 'db-tree' }));
    paintTree(app);
  });
}

function paintTree(app: App): void {
  const box = app.els.page.querySelector('.db-tree');
  if (!box || !cache) return;
  const { inv, root } = cache;
  const t = app.t;
  const ms = app.state.map!;
  const f = (ms.filters || {}) as { show?: string[]; only?: string | null; q?: string };
  const hidden = (inv.hiddenFlags || []).filter((k) => !(f.show || []).includes(k));
  const flags = inv.flagLabels || {};
  const filtering = !!(f.only || f.q);
  const defOpen = new Set(inv.open || []);
  const isOpen = (n: Node) => filtering || hl.length ? true : n.path in (ms.open || {}) ? !!ms.open![n.path] : defOpen.has(n.path) || n.path.split('/').length <= 2;
  const visible = (n: Node) => !(n.item?.flags || []).some((x) => hidden.includes(x));
  const match = (n: Node) => (!f.only || (n.item?.flags || []).includes(f.only)) && (!f.q || n.name.toLowerCase().includes(f.q.toLowerCase()));
  const sub = (n: Node): boolean => visible(n) && (match(n) || n.kids.some(sub));
  const hlSub = (n: Node): boolean => (n.item && hl.includes(n.item.id)) || n.kids.some(hlSub);
  const counts = new Map<string, number>();
  for (const x of app.fb) if (x.target.kind === 'item' && x.status === 'open') counts.set(x.target.itemId, (counts.get(x.target.itemId) || 0) + 1);
  box.replaceChildren();
  const walk = (n: Node, d: number) => {
    if (!visible(n) || (filtering && !sub(n))) return;
    const it = n.item;
    const open = n.folder && (isOpen(n) || (hl.length > 0 && hlSub(n)));
    const car = h('button', { class: 'db-tcar' + (n.folder && n.kids.length ? '' : ' ph'), type: 'button', 'aria-expanded': String(open), 'aria-label': 'toggle', html: CARET });
    const fl = h('span', { class: 'db-dots' });
    for (const k of it?.flags || []) if (flags[k]) fl.append(h('span', { class: 'db-flag tone-' + (flags[k].tone || 'neutral'), text: flags[k].label }));
    const cnt = it ? counts.get(it.id) || 0 : 0;
    const name = it?.docId ? h('button', { class: 'nm', type: 'button', title: n.name, onclick: () => void app.navigate(it.docId!) }, n.name.trim()) : h('span', { class: 'nm', title: n.name, text: n.name.trim() });
    const row = h('div', { class: 'db-trow' + (it && hl.includes(it.id) ? ' hl' : ''), style: `--d:${d}`, 'data-open': String(open) },
      h('div', { class: 'db-tname' }, car, h('span', { class: 'db-kind' + (n.folder ? ' dir' : ''), text: n.folder ? 'dir' : it?.kind || '' }), name, fl),
      h('span', { class: 'db-tmeta' },
        cnt ? h('span', { class: 'db-badge owner', text: cnt }) : null,
        h('span', { text: n.folder ? `${n.count} · ${fmtBytes(n.size)}` : fmtBytes(it?.size) }),
        h('span', { class: 'd', text: it?.modified ? fmtTime(it.modified).slice(0, 10) : '' }),
        it?.url ? h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer', title: 'open' }, '↗') : null,
        app.can('feedback.create') ? h('button', { class: 'db-btn sm ghost', type: 'button', title: t('map.feedback'), onclick: () => app.dialogs.compose({ item: { id: it ? it.id : n.path, label: (n.path || n.name).replace(/#.*$/, '') } }) }, t('doc.feedback')) : null),
      it?.note && !n.folder ? h('div', { class: 'db-tnote', text: it.note }) : null);
    if (n.folder && n.kids.length && !filtering) {
      const tg = () => { (ms.open ||= {})[n.path] = !open; hl = []; app.saveState(); paintTree(app); };
      car.addEventListener('click', tg);
      if (!it?.docId) name.addEventListener('click', tg);
    }
    box.append(row);
    if (open) for (const k of n.kids) walk(k, d + 1);
  };
  for (const k of root.kids) walk(k, 0);
  if (!box.childNodes.length) box.append(h('div', { class: 'db-empty', text: t('map.empty') }));
}

export function revealItems(app: App, ids: string[]): void {
  hl = ids.slice();
  const ms = (app.state.map ||= {});
  const f = (ms.filters ||= {}) as { show?: string[]; only?: string | null; q?: string };
  f.only = null; f.q = '';
  if (cache) {
    const hidden = cache.inv.hiddenFlags || [];
    for (const it of cache.inv.items) if (ids.includes(it.id)) for (const fl of it.flags || []) if (hidden.includes(fl) && !(f.show ||= []).includes(fl)) f.show.push(fl);
  }
  app.saveState();
  if (app.view !== 'map') { void app.navigate('map').then(() => setTimeout(scroll, 300)); return; }
  renderMap(app);
  setTimeout(scroll, 300);
  function scroll() { app.els.page.querySelector('.db-trow.hl')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
