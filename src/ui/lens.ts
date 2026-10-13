/**
 * 골라 보기 — 중요도·종류·끝난 것(0.8, D85). 말풍선과 검토 패널(초안 칸 빼고)이 같은 조건을 따른다.
 * 보기 상태(state.lens)에 남아 다음에도 같다.
 */
import type { Feedback, FeedbackCategory, FeedbackLens } from '../types';
import { FEEDBACK_CATEGORIES, categoryOf, lensFilters, turnOf } from '../core/feedback';
import { h } from './dom';
import type { App } from './app';
import type { T } from './i18n';

type Cat = FeedbackCategory | 'none';
const ALL: Cat[] = [...FEEDBACK_CATEGORIES, 'none'];

/** 지금 거르는 조건을 짧게 — "높음만 · 충돌·중복". 거르지 않으면 "모두" */
export function lensSummary(t: T, lens?: FeedbackLens): string {
  if (!lensFilters(lens)) return t('lens.all');
  const parts: string[] = [];
  if (lens!.severity) parts.push(t('lens.sev.' + lens!.severity));
  const cats = lens!.cats || [];
  if (cats.length) parts.push(cats.length <= 3 ? cats.map((c) => t('cat.' + c)).join('·') : t('lens.cats') + ' ' + cats.length);
  return parts.join(' · ');
}

/** 종류 칩 — 카드·말풍선·골라 보기가 같은 모양 */
export function catChip(t: T, f: Pick<Feedback, 'category' | 'kind'>): HTMLElement | null {
  const c = categoryOf(f);
  return c ? h('span', { class: 'db-cat c-' + c, title: t('cat.' + c + '.hint'), text: t('cat.' + c) }) : null;
}

/** 종류를 눌렀을 때: 모두 → 그것만, 그다음부터는 넣고 빼기. 다 빠지면 모두 */
function toggleCat(cur: Cat[] | undefined, c: Cat): Cat[] | undefined {
  const s = new Set(cur || []);
  if (s.has(c)) s.delete(c); else s.add(c);
  return s.size ? ALL.filter((x) => s.has(x)) : undefined;
}

/** 칩 옆의 수 — 열린 문서가 있으면 그 문서, 아니면 패널 범위의 피드백(끝난 것은 그 칸을 켰을 때만) */
function counts(app: App, lens?: FeedbackLens): Map<Cat, number> {
  const doc = app.doc && app.view === app.doc.id ? app.doc.id : null;
  const rows = (doc ? app.fb.filter((f) => f.docId === doc) : app.scopedFb())
    .filter((f) => lens?.closed || (turnOf(f) !== 'resolved' && turnOf(f) !== 'declined'));
  const m = new Map<Cat, number>();
  for (const f of rows) { const c = categoryOf(f) || 'none'; m.set(c, (m.get(c) || 0) + 1); }
  return m;
}

/** 열린 골라 보기 창 — 같은 자리의 단추를 다시 누르면 닫고, 다른 자리면 옮겨 연다(바깥 누르기·Esc 듣기를 겹쳐 두지 않게).
 * 자리는 단추의 data-lens 로 가린다 — 패널은 다시 그리면 단추를 새로 만든다 */
let current: { close: () => void; key: string } | null = null;

/** 골라 보기 창 — 바꾸면 바로 반영하고 창은 열어 둔다. 바깥·Esc·같은 단추로 닫는다 */
export function openLens(app: App, anchor: HTMLElement): void {
  const t = app.t;
  const key = anchor.dataset.lens || 'x';
  if (current) { const same = current.key === key; current.close(); if (same) return; }
  app.root.querySelector('.db-menu')?.remove();
  const r = anchor.getBoundingClientRect(), base = app.root.getBoundingClientRect();
  const box = h('div', { class: 'db-menu db-lens', role: 'dialog', 'aria-label': t('lens.title') });
  box.style.top = Math.round(r.bottom - base.top + 4) + 'px';
  const seg = (k: string, items: [string, string, boolean][], pick: (id: string) => void) => h('div', { class: 'db-seg', role: 'group' },
    ...items.map(([id, label, on]) => h('button', { type: 'button', 'data-k': k + '-' + id, 'aria-pressed': String(on), onclick: () => pick(id) }, label)));
  const paint = () => {
    // 다시 그려도 누르던 단추에 초점을 돌려준다(키보드로 이어서 고르게)
    const was = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.k : undefined;
    const lens = app.lens;
    const n = counts(app, lens);
    const cats = lens?.cats || [];
    box.replaceChildren(
      h('div', { class: 'db-lens-h' }, h('b', { text: t('lens.title') }), h('span', { class: 'db-grow' }),
        h('button', { class: 'db-btn ghost sm', type: 'button', 'data-k': 'reset', disabled: !lensFilters(lens), onclick: () => app.setLens({ severity: undefined, cats: undefined }) }, t('lens.reset'))),
      h('div', { class: 'db-lens-row' }, h('span', { class: 'db-lbl', text: t('lens.bubbles') }),
        seg('bub', [['off', t('lens.off'), !lens?.bubbles], ['on', t('lens.on'), !!lens?.bubbles]], (id) => app.setLens({ bubbles: id === 'on' }))),
      h('div', { class: 'db-lens-row' }, h('span', { class: 'db-lbl', text: t('lens.sev') }),
        seg('sev', [['all', t('lens.all'), !lens?.severity], ['medium', t('lens.sev.medium'), lens?.severity === 'medium'], ['high', t('lens.sev.high'), lens?.severity === 'high']],
          (id) => app.setLens({ severity: id === 'all' ? undefined : (id as 'medium' | 'high') }))),
      h('div', { class: 'db-lens-row col' }, h('span', { class: 'db-lbl', text: t('lens.cats') }),
        // 이름표 칩(.db-chips)의 "뺀 것" 모양(줄 긋기)이 옮지 않게 따로 된 상자
        h('div', { class: 'db-lens-cats' },
          h('button', { class: 'db-chip all', type: 'button', 'data-k': 'cat-all', 'aria-pressed': String(!cats.length), onclick: () => app.setLens({ cats: undefined }) }, t('lens.all')),
          ...ALL.map((c) => h('button', {
            class: 'db-chip db-cat-chip c-' + c + (n.get(c) ? '' : ' zero'), type: 'button', 'data-k': 'cat-' + c, 'aria-pressed': String(cats.includes(c)), title: t('cat.' + c + '.hint'),
            onclick: () => app.setLens({ cats: toggleCat(lens?.cats, c) }),
          }, h('i', { class: 'dot' }), t('cat.' + c), n.get(c) ? h('span', { class: 'n', text: n.get(c) }) : null)))),
      h('label', { class: 'db-lens-chk' },
        h('input', { type: 'checkbox', 'data-k': 'closed', checked: !!lens?.closed, onchange: (e: Event) => app.setLens({ closed: (e.target as HTMLInputElement).checked }) }),
        t('lens.closed')),
      h('p', { class: 'db-hint', text: t('lens.note') }));
    if (was) (box.querySelector(`[data-k="${was}"]`) as HTMLElement | null)?.focus();
  };
  const close = () => {
    box.remove();
    if (current?.close === close) current = null;
    for (const b of app.root.querySelectorAll(`[data-lens="${key}"]`)) b.setAttribute('aria-expanded', 'false');
    if (app.lensChanged === repaint) app.lensChanged = undefined;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
  };
  const repaint = () => { if (box.isConnected) paint(); };
  const outside = (e: Event) => { if (!box.contains(e.target as Node) && !(e.target as Element)?.closest?.(`[data-lens="${key}"]`)) close(); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); } };
  paint();
  app.lensChanged = repaint;
  current = { close, key };
  anchor.setAttribute('aria-expanded', 'true');
  app.root.append(box);
  // 폭을 잰 뒤 화면 안으로(휴대폰 너비에서 오른쪽이 잘리지 않게), 높이는 작업대 아래 끝까지(가로 휴대폰에서도 끝까지 닿게)
  box.style.left = Math.round(Math.max(8, Math.min(r.left - base.left, base.width - box.offsetWidth - 8))) + 'px';
  box.style.maxHeight = Math.max(160, Math.round(base.bottom - r.bottom - 12)) + 'px';
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', esc, true);
  (box.querySelector('.db-seg button') as HTMLElement | null)?.focus();
}
