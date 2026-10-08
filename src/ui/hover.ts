/**
 * 마우스를 올리면 보이는 것들.
 *  - 본문의 피드백 표시(형광 문구)·섹션 옆 피드백 수 → 그 피드백 미리보기 (누가·언제·차례·내용·마지막 답)
 *  - 바뀐 글(더한 글·지운 글)·"바뀜" 표 → 누가·언제 바꿨는지
 *  - 피드백 패널의 카드 → 본문에서 그 피드백이 붙은 문구·섹션을 밝힌다
 */
import type { Feedback } from '../types';
import { turnOf } from '../core/feedback';
import { KEY_SEP } from '../core/source';
import { h, relTime } from './dom';
import type { App } from './app';

export class Hover {
  private app: App;
  private pop: HTMLElement;
  private showT: ReturnType<typeof setTimeout> | undefined;
  private hideT: ReturnType<typeof setTimeout> | undefined;
  private anchor: Element | null = null;
  private lit: Element[] = [];

  constructor(app: App) {
    this.app = app;
    this.pop = h('div', { class: 'db-pop', role: 'tooltip', hidden: true });
    this.pop.addEventListener('mouseenter', () => clearTimeout(this.hideT));
    this.pop.addEventListener('mouseleave', () => this.hideSoon());
    app.root.append(this.pop);
    const root = app.root;
    root.addEventListener('mouseover', (e) => this.over(e.target as Element));
    root.addEventListener('mouseout', (e) => this.out(e.target as Element, (e as MouseEvent).relatedTarget as Element | null));
    root.addEventListener('focusin', (e) => this.over(e.target as Element, true));
    root.addEventListener('focusout', (e) => this.out(e.target as Element, (e as FocusEvent).relatedTarget as Element | null));
    root.addEventListener('scroll', () => this.hide(), true);
  }

  private get t() { return this.app.t; }

  private target(el: Element | null): Element | null {
    return el?.closest?.('mark.db-fbq, .db-sec-badges .db-badge.assistant, .db-sec-badges .db-badge.owner, .db-sec-badges .db-badge.closed, .db-sec-badges .db-badge.chg, ins.db-chg-ins, del.db-chg-del, .db-card[data-id]') || null;
  }

  private over(el: Element, focus = false): void {
    const tg = this.target(el);
    if (!tg) return;
    if (tg.classList.contains('db-card')) { this.light((tg as HTMLElement).dataset.id!); return; }
    if (tg === this.anchor && !this.pop.hidden) { clearTimeout(this.hideT); return; }
    clearTimeout(this.showT);
    clearTimeout(this.hideT);
    this.showT = setTimeout(() => this.show(tg), focus ? 0 : 220);
  }
  private out(el: Element, to: Element | null): void {
    const tg = this.target(el);
    if (!tg) return;
    if (to && (tg.contains(to) || this.pop.contains(to))) return;
    if (tg.classList.contains('db-card')) { this.unlight(); return; }
    clearTimeout(this.showT);
    this.hideSoon();
  }
  private hideSoon(): void { clearTimeout(this.hideT); this.hideT = setTimeout(() => this.hide(), 140); }
  hide(): void { this.pop.hidden = true; this.anchor = null; }

  // ------------------------------------------------------------ 카드 → 본문 밝히기
  private light(id: string): void {
    this.unlight();
    const doc = this.app.doc;
    if (!doc) return;
    const marks = Array.from(this.app.els.main.querySelectorAll(`mark.db-fbq[data-fb="${CSS.escape(id)}"]`));
    const key = doc.sectionKeyOf(id);
    const sec = key ? doc.findSec(key) : null;
    for (const m of marks) m.classList.add('hl');
    if (sec) sec.el.classList.add('db-fb-hl');
    this.lit = [...marks, ...(sec ? [sec.el] : [])];
  }
  private unlight(): void { for (const e of this.lit) e.classList.remove('hl', 'db-fb-hl'); this.lit = []; }

  // ------------------------------------------------------------ 미리보기
  private show(tg: Element): void {
    const content = this.content(tg);
    if (!content) return;
    this.anchor = tg;
    this.pop.replaceChildren(content);
    this.pop.hidden = false;
    // 화면 안에 들어오게: 기본은 아래, 모자라면 위
    const r = tg.getBoundingClientRect();
    const box = this.app.root.getBoundingClientRect();
    const pw = Math.min(380, box.width - 16);
    this.pop.style.width = pw + 'px';
    const ph = this.pop.offsetHeight;
    let left = Math.min(Math.max(r.left - box.left, 8), box.width - pw - 8);
    let top = r.bottom - box.top + 6;
    if (top + ph > box.height - 8 && r.top - box.top - ph - 6 > 8) top = r.top - box.top - ph - 6;
    if (!isFinite(left)) left = 8;
    this.pop.style.left = left + 'px';
    this.pop.style.top = Math.max(8, top) + 'px';
  }

  private content(tg: Element): HTMLElement | null {
    const app = this.app;
    if (tg.matches('mark.db-fbq')) {
      const f = app.fb.find((x) => x.id === (tg as HTMLElement).dataset.fb);
      return f ? this.fbCard(f, true) : null;
    }
    const sec = tg.closest('.db-sec') as HTMLElement | null;
    if (tg.matches('.db-badge.chg, ins.db-chg-ins, del.db-chg-del')) {
      const key = sec?.dataset.key;
      const info = key ? app.doc?.changeInfo(key) : null;
      if (!info) return null;
      const box = h('div', { class: 'db-pop-b' }, h('div', { class: 'db-pop-h' }, h('b', { text: info.kind === 'new' ? this.t('doc.newBadge') : this.t('doc.changedBadge') })));
      if (tg.matches('del.db-chg-del')) box.append(h('div', { class: 'db-pop-q del', text: (tg as HTMLElement).dataset.full || tg.textContent || '' }));
      for (const c of info.by.slice(0, 4)) box.append(h('div', { class: 'db-pop-who' }, h('b', { text: c.who }), ' · ', c.when, c.summary ? h('div', { class: 'db-hint', text: c.summary }) : null));
      if (!info.by.length) box.append(h('div', { class: 'db-hint', text: this.t('doc.change.unknown') }));
      box.append(h('div', { class: 'db-hint', text: this.t('doc.change.tip') }));
      return box;
    }
    // 섹션 옆 피드백 수
    const key = sec?.dataset.key;
    if (!key || !app.doc) return null;
    const collapsed = sec?.dataset.collapsed === 'true';
    const cls = ['assistant', 'owner', 'closed'].find((c) => tg.classList.contains(c));
    const rows = app.fb.filter((f) => {
      const k = app.doc!.sectionKeyOf(f.id);
      if (!k || f.docId !== app.doc!.id) return false;
      if (!(k === key || (collapsed && k.startsWith(key + KEY_SEP)))) return false;
      const t = turnOf(f);
      return cls === 'closed' ? t === 'resolved' || t === 'declined' : t === cls;
    });
    if (!rows.length) return null;
    const box = h('div', { class: 'db-pop-b' });
    for (const f of rows.slice(0, 4)) box.append(this.fbCard(f, false));
    if (rows.length > 4) box.append(h('div', { class: 'db-hint', text: this.t('fb.earlier', { n: rows.length - 4 }) }));
    box.append(h('div', { class: 'db-hint', text: this.t('pop.click') }));
    return box;
  }

  private fbCard(f: Feedback, single: boolean): HTMLElement {
    const app = this.app;
    const t = this.t;
    const turn = turnOf(f);
    const who = f.author.kind === 'assistant' ? t('fb.by.assistant') : f.author.name || t('fb.by.me');
    const last = f.thread[f.thread.length - 1];
    const run = app.dock?.activeFor(f.id);
    const card = h('div', { class: 'db-pop-fb t-' + turn },
      h('div', { class: 'db-pop-h' },
        h('span', { class: 'db-turnlbl ' + turn, text: run ? t('run.busy') : t('turn.' + turn) }),
        h('span', { text: who }), h('span', { class: 'db-hint', text: relTime(f.updatedAt, t) }),
        f.severity ? h('span', { class: 'db-sev ' + f.severity, text: t('fb.sev.' + f.severity) }) : null),
      f.title ? h('div', { class: 'db-c-title', text: f.title }) : null,
      h('div', { class: 'db-pop-body', text: f.body || f.kind || '' }));
    if (last) card.append(h('div', { class: 'db-pop-last' + (last.author.kind === 'assistant' ? ' assistant' : '') }, h('b', { text: (last.author.kind === 'assistant' ? last.author.name || app.ai : last.author.name || t('fb.by.me')) + ': ' }), last.text));
    if (f.proposal?.state === 'pending') card.append(h('div', { class: 'db-pop-prop', text: t('pop.proposal') }));
    if (single) card.append(h('div', { class: 'db-hint', text: t('pop.click') }));
    return card;
  }
}
