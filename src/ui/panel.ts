/**
 * 피드백 패널 — 범위·차례 필터, 카드, 답글, AI 제안, 제안 적용.
 */
import type { Feedback, PanelFilter } from '../types';
import { countTurns, sectionKeyOf, sortFeedback, turnOf, type Turn } from '../core/feedback';
import { getSectionText, KEY_SEP } from '../core/source';
import { lineDiff } from '../core/diff';
import { h, relTime } from './dom';
import { renderDiff, applyProposal } from './editor';
import type { App } from './app';

export class Panel {
  private app: App;
  private el: HTMLElement;
  private list!: HTMLElement;
  private busy = new Map<string, AbortController>();
  private expanded = new Set<string>();
  private openProps = new Set<string>();
  private bulkArmed = false;

  constructor(app: App, el: HTMLElement) {
    this.app = app;
    this.el = el;
    this.render();
  }

  private get t() { return this.app.t; }
  private get scope() { return this.app.state.panel?.scope || 'doc'; }
  private get filter(): PanelFilter { return this.app.state.panel?.filter || 'active'; }
  private setPanel(p: { scope?: 'doc' | 'all'; filter?: PanelFilter }): void {
    this.app.state.panel = { ...(this.app.state.panel || {}), ...p };
    this.app.saveState();
    this.bulkArmed = false;
    this.render();
  }

  open(scope?: 'doc' | 'all', filter?: PanelFilter): void {
    this.setPanel({ scope, filter });
    this.app.root.classList.add('panel-open');
  }

  focus(id: string): void {
    const f = this.app.fb.find((x) => x.id === id);
    if (!f) return;
    const t = turnOf(f);
    const filter: PanelFilter = t === 'owner' || t === 'assistant' ? (this.filter === 'closed' ? 'active' : this.filter === 'active' ? 'active' : t) : 'closed';
    this.open(this.scope === 'doc' && f.docId !== this.app.view ? 'all' : this.scope, filter);
    requestAnimationFrame(() => {
      const c = this.el.querySelector<HTMLElement>(`.db-card[data-id="${CSS.escape(id)}"]`);
      if (!c) return;
      c.classList.add('focus');
      c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => c.classList.remove('focus'), 1600);
    });
  }

  private rowsInScope(): Feedback[] {
    const v = this.app.view;
    if (this.scope === 'all' || !v) return this.app.scopedFb();
    if (v === 'map') return this.app.fb.filter((f) => f.target.kind === 'item');
    return this.app.fb.filter((f) => f.docId === v && f.target.kind !== 'item');
  }

  render(): void {
    const app = this.app;
    if (!app.manifest) return;
    const t = this.t;
    const scoped = this.rowsInScope();
    const c = countTurns(scoped);
    const tab = (f: PanelFilter, label: string, n: number) => h('button', { type: 'button', 'aria-pressed': String(this.filter === f), onclick: () => this.setPanel({ filter: f }) }, label, h('span', { class: 'n', text: n }));
    const head = h('div', { class: 'db-ph' },
      h('div', { class: 'db-ph-top' },
        h('h2', { text: t('fb.title') }),
        app.can('feedback.create') && app.view && app.view !== 'changes'
          ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => app.view === 'map' ? app.dialogs.compose({ item: { id: '', label: t('view.map') } }) : app.dialogs.compose({ docId: app.view! }) }, t('fb.newDoc'))
          : null),
      h('div', { class: 'db-tabs' },
        h('button', { type: 'button', 'aria-pressed': String(this.scope === 'doc'), onclick: () => this.setPanel({ scope: 'doc' }) }, t('fb.scope.doc')),
        h('button', { type: 'button', 'aria-pressed': String(this.scope === 'all'), onclick: () => this.setPanel({ scope: 'all' }) }, t('fb.scope.all'))),
      h('div', { class: 'db-tabs' },
        tab('active', t('fb.f.active'), c.owner + c.assistant),
        tab('owner', t('fb.f.owner'), c.owner),
        tab('assistant', t('fb.f.assistant'), c.assistant),
        tab('closed', t('fb.f.closed'), c.resolved + c.declined)));
    this.list = h('div', { class: 'db-plist' });
    const keep = this.el.querySelector('.db-plist')?.scrollTop || 0;
    this.el.replaceChildren(head, this.list);
    const want = (x: Turn) => this.filter === 'active' ? x === 'owner' || x === 'assistant' : this.filter === 'closed' ? x === 'resolved' || x === 'declined' : x === this.filter;
    let rows = scoped.filter((f) => want(turnOf(f)));
    rows = sortFeedback(rows, Object.keys(app.manifest.docs));
    if (this.scope === 'doc' && app.doc) {
      const order = new Map(app.doc.secs.map((s, i) => [s.key, i]));
      rows.sort((a, b) => (order.get(app.doc!.sectionKeyOf(a.id) || '') ?? 1e6) - (order.get(app.doc!.sectionKeyOf(b.id) || '') ?? 1e6));
    }
    if (!rows.length) {
      const msg = app.fbMode === 'pending' ? t('fb.loading') : this.scope === 'doc' && app.doc ? t('fb.empty.doc') : t('fb.empty');
      this.list.append(h('div', { class: 'db-empty', text: msg }));
      return;
    }
    if (this.filter === 'owner' && rows.length > 1 && app.can('feedback.update')) {
      const ownerRows = rows.filter((f) => f.status === 'open');
      const b = h('button', { class: 'db-btn sm', type: 'button', onclick: async () => {
        if (!this.bulkArmed) { this.bulkArmed = true; b.textContent = t('fb.bulk.confirm', { n: ownerRows.length }); setTimeout(() => { this.bulkArmed = false; b.textContent = t('fb.bulk', { n: ownerRows.length }); }, 4000); return; }
        this.bulkArmed = false;
        for (const f of ownerRows) await app.updateFeedback(f, { waitingOn: 'assistant', thread: [...f.thread, { author: app.me, text: t('fb.act.toAssistant'), at: new Date().toISOString() }] });
      } }, t('fb.bulk', { n: ownerRows.length }));
      this.list.append(h('div', { class: 'db-row' }, b));
    }
    let lastDoc = '';
    for (const f of rows) {
      if (this.scope === 'all' && f.docId !== lastDoc) {
        lastDoc = f.docId;
        this.list.append(h('div', { class: 'db-pgroup', text: f.target.kind === 'item' ? t('view.map') : app.docTitle(f.docId) }));
      }
      this.list.append(this.card(f));
    }
    this.list.scrollTop = keep;
  }

  private card(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const turn = turnOf(f);
    const c = h('article', { class: `db-card t-${turn}`, 'data-id': f.id });
    const who = f.author.kind === 'assistant' ? t('fb.by.assistant') : app.personLabel(f.author);
    c.append(h('div', { class: 'db-c-top' },
      f.severity ? h('span', { class: 'db-sev ' + f.severity, text: t('fb.sev.' + f.severity) }) : null,
      f.kind ? h('span', { text: f.kind }) : null,
      h('span', { text: who }),
      h('span', { text: relTime(f.updatedAt, t) }),
      h('span', { class: 'db-turnlbl ' + turn, text: t('turn.' + turn) })));
    if (f.title) c.append(h('div', { class: 'db-c-title', text: f.title }));
    const loc = f.target.kind === 'section' ? f.target.path.slice(-2).join(KEY_SEP) + (f.target.occurrence && f.target.occurrence > 1 ? ' #' + f.target.occurrence : '') : f.target.kind === 'item' ? (f.target.label || f.target.itemId) : t('fb.wholeDoc');
    c.append(h('button', { class: 'db-c-loc', type: 'button', title: t('fb.goto'), onclick: () => void this.jump(f) }, '↳ ' + (this.scope === 'all' && f.target.kind !== 'item' ? app.docTitle(f.docId) + ' · ' : '') + loc));
    if (f.selector?.exact) c.append(h('div', { class: 'db-c-quote', text: f.selector.exact }));
    if (f.body) {
      const long = f.body.length > 180 || f.body.split('\n').length > 4;
      const body = h('div', { class: 'db-c-body' + (long && !this.expanded.has(f.id) ? ' clamp' : ''), text: f.body });
      c.append(body);
      if (long) c.append(h('button', { class: 'db-more', type: 'button', onclick: () => { this.expanded.has(f.id) ? this.expanded.delete(f.id) : this.expanded.add(f.id); this.render(); } }, this.expanded.has(f.id) ? t('fb.less') : t('fb.more')));
    }
    if (f.thread.length) {
      const th = h('div', { class: 'db-thread' });
      const show = this.expanded.has(f.id + ':t') ? f.thread : f.thread.slice(-2);
      if (show.length < f.thread.length) th.append(h('button', { class: 'db-more', type: 'button', onclick: () => { this.expanded.add(f.id + ':t'); this.render(); } }, t('fb.earlier', { n: f.thread.length - show.length })));
      for (const m of show) th.append(h('div', { class: 'db-msg' + (m.author.kind === 'assistant' ? ' assistant' : '') }, h('span', { class: 'who', text: app.personLabel(m.author) + ' · ' + relTime(m.at, t) }), m.text));
      c.append(th);
    }
    if (f.proposal) c.append(this.proposal(f));
    // 동작
    const act = h('div', { class: 'db-c-act' });
    const now = () => new Date().toISOString();
    const msg = (text: string) => ({ author: app.me, text, at: now() });
    const run = app.dock?.activeFor(f.id);
    if (run) {
      // Claude 작업이 이 피드백을 다루는 중 — 결과는 회신·제안으로 붙는다
      act.append(h('span', { class: 'db-busy' }, h('span', { class: 'db-spin sm' }), ' ', t(run.state === 'queued' ? 'run.fb.queued' : 'run.fb.running')),
        h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => app.dock?.setOpen(true) }, t('run.open')),
        h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => void app.dock?.cancel(run.id) }, t('run.cancel')));
    } else if (this.busy.has(f.id)) {
      act.append(h('span', { class: 'db-busy' }, h('span', { class: 'db-spin sm' }), ' ', t('fb.act.proposing')), h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => this.busy.get(f.id)?.abort() }, t('edit.cancel')));
    } else if (f.status === 'open') {
      // 제안이 걸려 있으면 결정은 제안 상자의 적용·거절로 한다 (버튼 중복 방지)
      if (turn === 'owner' && app.can('feedback.update') && f.proposal?.state !== 'pending') {
        act.append(h('button', { class: 'db-btn sm primary', type: 'button', title: t('fb.act.toAssistant.hint'), onclick: () => void app.updateFeedback(f, { waitingOn: 'assistant', thread: [...f.thread, msg(t('fb.act.toAssistant'))] }) }, t('fb.act.toAssistant')));
        act.append(h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.updateFeedback(f, { status: 'declined', thread: [...f.thread, msg(t('fb.act.decline'))] }) }, t('fb.act.decline')));
      }
      if ((app.dock || app.can('assistant.propose')) && f.target.kind === 'section' && !(f.proposal && f.proposal.state === 'pending')) {
        act.append(h('button', { class: 'db-btn sm', type: 'button', title: t('fb.act.propose.hint'), onclick: () => void this.propose(f) }, t('fb.act.propose')));
      }
      if (app.can('feedback.update')) act.append(h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.updateFeedback(f, { status: 'resolved', thread: [...f.thread, msg(t('fb.act.resolve'))] }) }, t('fb.act.resolve')));
    } else if (app.can('feedback.update')) {
      act.append(h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.updateFeedback(f, { status: 'open', waitingOn: 'assistant', thread: [...f.thread, msg(t('fb.act.reopen'))] }) }, t('fb.act.reopen')));
    }
    if (app.can('feedback.update') && !this.busy.has(f.id) && !run) {
      act.append(h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => {
        if (c.querySelector('.db-reply')) return;
        const ta = h('textarea', { placeholder: t('fb.reply.placeholder'), 'aria-label': t('fb.act.reply') }) as HTMLTextAreaElement;
        const box = h('div', { class: 'db-reply' }, ta, h('div', { class: 'db-c-act' },
          h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => { const v = ta.value.trim(); if (v) void app.updateFeedback(f, { status: 'open', waitingOn: 'assistant', thread: [...f.thread, msg(v)] }); } }, t('fb.reply.send')),
          h('button', { class: 'db-btn sm', type: 'button', onclick: () => { const v = ta.value.trim(); if (v) void app.updateFeedback(f, { thread: [...f.thread, msg(v)] }); } }, t('fb.reply.sendOwner')),
          h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => box.remove() }, t('edit.cancel'))));
        c.append(box);
        ta.focus();
      } }, t('fb.act.reply')));
    }
    if (app.can('feedback.delete') && app.ad.feedback.remove && f.author.kind !== 'assistant' && (!f.author.id || !app.me.id || f.author.id === app.me.id)) {
      const del = h('button', { class: 'db-btn sm ghost danger', type: 'button', onclick: () => {
        if (del.dataset.armed) { void app.ad.feedback.remove!(f.id).catch((e: Error) => app.toast(t('fb.saveFail', { msg: e.message }))); return; }
        del.dataset.armed = '1'; del.textContent = t('fb.act.deleteConfirm');
        setTimeout(() => { delete del.dataset.armed; del.textContent = t('fb.act.delete'); }, 3000);
      } }, t('fb.act.delete'));
      act.append(del);
    }
    c.append(act);
    return c;
  }

  private proposal(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const p = f.proposal!;
    const open = this.openProps.has(f.id) || (p.state === 'pending' && f.status === 'open');
    const box = h('div', { class: 'db-prop' });
    const state = p.state === 'applied' ? t('fb.proposal.applied') : p.state === 'rejected' ? t('fb.proposal.rejected') : '';
    box.append(h('div', { class: 'db-prop-h' }, t('fb.proposal'), state ? h('span', { class: 'db-hint', text: '· ' + state }) : null,
      h('button', { class: 'db-more', type: 'button', style: 'margin-left:auto', onclick: () => { open ? this.openProps.delete(f.id) : this.openProps.add(f.id); if (open && p.state === 'pending') this.openProps.add(f.id + ':closed'); this.render(); } }, open ? t('fb.proposal.hide') : t('fb.proposal.show'))));
    if (open && !this.openProps.has(f.id + ':closed')) {
      box.append(renderDiff(lineDiff(p.before, p.after), t));
      if (p.rationale) box.append(h('div', { class: 'db-hint', text: p.rationale }));
      if (p.state === 'pending' && f.status === 'open' && app.can('doc.edit')) {
        box.append(h('div', { class: 'db-c-act' },
          h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => void applyProposal(app, f) }, t('fb.proposal.apply')),
          h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.updateFeedback(f, { proposal: { ...p, state: 'rejected' }, waitingOn: 'assistant', thread: [...f.thread, { author: app.me, text: t('fb.proposal.reject'), at: new Date().toISOString() }] }) }, t('fb.proposal.reject'))));
      }
    }
    return box;
  }

  private async propose(f: Feedback): Promise<void> {
    const app = this.app;
    // Claude 작업이 있으면 그 길로(모델·노력 선택, 진행 로그). 결과는 제안으로 이 카드에 붙는다
    if (app.dock) { await app.dock.propose(f); return; }
    const as = app.ad.assistant;
    if (!as || f.target.kind !== 'section') return;
    const ctl = new AbortController();
    this.busy.set(f.id, ctl);
    this.render();
    try {
      const doc = app.doc && app.doc.id === f.docId ? app.doc.content : await app.ad.docs.load(f.docId);
      // 화면에서 실제로 붙은 섹션(같은 이름 제목이면 그 순번)을 쓴다
      const key = (app.doc && app.doc.id === f.docId && app.doc.sectionKeyOf(f.id)) || sectionKeyOf(f)!;
      const path = key.split(KEY_SEP);
      const sectionText = getSectionText(doc.md, key);
      if (sectionText == null) throw new Error(app.t('doc.orphans', { n: 1 }));
      const out = await as.propose({ docId: f.docId, docTitle: app.docTitle(f.docId), feedback: f, sectionPath: path, sectionText }, { signal: ctl.signal });
      const at = new Date().toISOString();
      await app.updateFeedback(f, {
        waitingOn: 'owner',
        proposal: { path, before: sectionText, after: out.after, rationale: out.rationale, author: { kind: 'assistant', name: app.ai }, at, state: 'pending' },
        thread: [...f.thread, { author: { kind: 'assistant', name: app.ai }, text: out.rationale || app.t('fb.proposal'), at }],
      });
    } catch (e) {
      if (!ctl.signal.aborted) app.toast(app.t('fb.act.proposeFail', { msg: (e as Error).message }));
    } finally {
      this.busy.delete(f.id);
      this.render();
    }
  }

  private async jump(f: Feedback): Promise<void> {
    const app = this.app;
    if (f.target.kind === 'item') { await app.navigate('map'); (await import('./mapview')).revealItems(app, [f.target.itemId]); return; }
    if (app.view !== f.docId) await app.navigate(f.docId);
    const d = app.doc;
    if (!d) return;
    const key = d.sectionKeyOf(f.id) || (f.target.kind === 'section' ? f.target.path.join(KEY_SEP) : null);
    if (key) d.reveal(key);
    const mk = app.els.main.querySelector<HTMLElement>(`mark.db-fbq[data-fb="${CSS.escape(f.id)}"]`);
    if (mk) { mk.scrollIntoView({ block: 'center', behavior: 'smooth' }); mk.classList.add('db-flash'); setTimeout(() => mk.classList.remove('db-flash'), 1400); }
    if (app.root.getBoundingClientRect().width < 1100) app.root.classList.remove('panel-open');
  }
}
