/**
 * 말풍선 — 피드백을 문서 안 그 자리에(0.8, D85).
 *  - 고른 문구가 있으면 그 문단·항목·표 바로 아래, 섹션 피드백은 섹션 머리 바로 아래(접혀도 보인다), 문서 전체는 문서 맨 위
 *  - 본문 글자가 아니다(db-noindex) — 찾기·인용·바뀐 글 표시가 이 글을 세지 않는다
 *  - 누르면 검토 패널의 그 카드로(할 일은 카드에서 — 단추를 두 곳에 두지 않는다)
 */
import type { Feedback } from '../types';
import { lensMatch, turnOf } from '../core/feedback';
import { $$, h, relTime } from './dom';
import { catChip } from './lens';
import type { App } from './app';

/** 말풍선을 둘 글 덩어리 — 가장 가까운 것 */
const BLOCK = 'li, p, blockquote, pre, table, dl, details, h1, h2, h3, h4, h5, h6';

/** 말풍선으로 보일 피드백 — 골라 보기를 따르고, 끝난 것은 그 칸을 켰을 때만 */
export function bubbleRows(app: App, docId: string): Feedback[] {
  const lens = app.lens;
  return app.fb
    .filter((f) => f.docId === docId && f.target.kind !== 'item' && lensMatch(f, lens) && (lens?.closed || (f.status !== 'resolved' && f.status !== 'declined')))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function bubble(app: App, f: Feedback): HTMLElement {
  const t = app.t;
  const turn = turnOf(f);
  const who = f.author.kind === 'assistant' ? t('fb.by.assistant') : app.personLabel(f.author);
  // 상대의 마지막 말(내 피드백이면 Claude 의 답, Claude 의 의견이면 내 답)
  const last = [...f.thread].reverse().find((m) => m.author.kind !== f.author.kind);
  const el = h('div', { class: 'db-bub t-' + turn, 'data-id': f.id, role: 'button', tabindex: '0', title: t('bub.open') },
    h('div', { class: 'db-bub-top' },
      catChip(t, f),
      f.severity ? h('span', { class: 'db-sev ' + f.severity, text: t('fb.sev.' + f.severity) }) : null,
      h('span', { class: 'db-turnlbl ' + turn, text: t('turn.' + turn) }),
      h('span', { class: 'db-grow' }),
      h('span', { class: 'db-hint', text: who + ' · ' + relTime(f.updatedAt, t) })),
    f.title ? h('div', { class: 'db-bub-title', text: f.title }) : null,
    f.body ? h('div', { class: 'db-bub-body', text: f.body }) : null,
    // "이렇게 바꿔"로 바꿀 글만 적은 초안 — 본문이 비어도 무엇을 바꾸는지 보이게
    f.suggestion != null ? h('div', { class: 'db-bub-sugg', text: '→ ' + f.suggestion }) : null,
    last ? h('div', { class: 'db-bub-last' + (last.author.kind === 'assistant' ? ' assistant' : '') }, h('b', { text: app.personLabel(last.author) + ': ' }), last.text) : null,
    f.proposal?.state === 'pending' ? h('div', { class: 'db-bub-prop', text: t('bub.proposal') }) : null);
  const open = () => app.panel.focus(f.id);
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return el;
}

/**
 * 문서에 말풍선을 놓는다(있던 것은 걷고). sectionEl = 피드백이 가리키는 섹션 요소(못 찾으면 null — 패널의 "붙일 곳 없음"으로).
 * 표시(mark)를 먼저 감싼 뒤에 부른다 — 문구 자리는 표시로 찾는다. 놓은 수를 돌려준다
 */
export function placeBubbles(app: App, article: HTMLElement, docId: string, sectionEl: (f: Feedback) => HTMLElement | null): number {
  clearBubbles(article);
  if (!app.lens?.bubbles) return 0;
  type Mode = 'after' | 'before' | 'append' | 'prepend';
  const groups = new Map<Element, Map<Mode, Feedback[]>>();
  const put = (ref: Element, mode: Mode, f: Feedback) => {
    const g = groups.get(ref) || new Map<Mode, Feedback[]>();
    groups.set(ref, g);
    g.set(mode, [...(g.get(mode) || []), f]);
  };
  let n = 0;
  for (const f of bubbleRows(app, docId)) {
    const mark = article.querySelector<HTMLElement>(`mark.db-fbq[data-fb="${CSS.escape(f.id)}"]`);
    if (mark && !mark.closest('.db-sec-head')) {
      const blk = mark.closest(BLOCK);
      if (blk?.tagName === 'LI') {
        // 항목 안에서 그 줄 바로 아래 — 하위 목록이 있으면 그 앞
        const sub = Array.from(blk.children).find((c) => c.tagName === 'UL' || c.tagName === 'OL');
        if (sub) put(sub, 'before', f); else put(blk, 'append', f);
        n++;
        continue;
      }
      if (blk) { put(blk.closest('.db-tw') || blk, 'after', f); n++; continue; }
    }
    const sec = mark?.closest('.db-sec') || (f.target.kind === 'section' ? sectionEl(f) : null);
    const head = sec?.querySelector(':scope > .db-sec-head');
    if (head) { put(head, 'after', f); n++; }
    else if (f.target.kind === 'doc') { put(article, 'prepend', f); n++; }
  }
  for (const [ref, g] of groups) {
    for (const [mode, rows] of g) {
      const box = h('div', { class: 'db-bubs db-noindex', contenteditable: 'false' }, ...rows.map((f) => bubble(app, f)));
      if (mode === 'after') ref.after(box);
      else if (mode === 'before') ref.before(box);
      else if (mode === 'append') ref.append(box);
      else ref.prepend(box);
    }
  }
  return n;
}

export function clearBubbles(article: HTMLElement): void { for (const b of $$('.db-bubs', article)) b.remove(); }
