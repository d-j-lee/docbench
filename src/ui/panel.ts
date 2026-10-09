/**
 * 검토 패널 — 사람이 실제로 검토하는 순서대로(D73):
 *   초안   읽으며 적은 메모. 고치고·지우고(되살리기)·합치고·★(급함)를 붙인다. 고른 것만 공통 지시와 함께 한 번에 보낸다.
 *   볼 것  Claude 가 돌려준 것 — 회차(보낸 묶음)별로 고침(차이·되돌리기)·제안(적용·거절)·질문(답하기)·답(확인).
 *          Claude 가 먼저 읽고 올린 선제안·읽기 정리도 여기. 내가 확인할 때까지 남는다.
 *   보냄   Claude 가 처리 중이거나 처리할 것(터미널 Claude 를 기다리는 것 포함). 아직 시작 전이면 초안으로 되가져온다.
 *   끝남   확인했거나 하지 않기로 한 것 — 다시 열면 초안으로.
 */
import type { Feedback, FeedbackPatch, PanelFilter, RunStatus } from '../types';
import { countTurns, sortFeedback, turnOf } from '../core/feedback';
import { getSectionText, KEY_SEP } from '../core/source';
import { lineDiff } from '../core/diff';
import { planRevert } from '../core/apply';
import { RUN_EFFORTS, RUN_MODELS } from '../core/runs';
import { h, relTime, icon } from './dom';
import { renderDiff, applyProposal } from './editor';
import type { App } from './app';

const LEGACY: Record<string, PanelFilter> = { active: 'review', owner: 'review', assistant: 'sent', closed: 'done' };
const FILTERS: PanelFilter[] = ['draft', 'review', 'sent', 'done'];

export class Panel {
  private app: App;
  private el: HTMLElement;
  private list!: HTMLElement;
  /** 보낼 초안(고른 것) — 새 초안은 저절로 고른다 */
  private sel = new Set<string>();
  private seen = new Set<string>();
  private editing = new Set<string>();
  private replying = new Set<string>();
  private diffOpen = new Set<string>();
  private expanded = new Set<string>();
  /** 키보드로 고른 카드 — 다시 그려도(목록이 바뀌어도) 같은 카드에 남게 id 로 */
  private cursorId: string | null = null;
  /** 고치던·답하던 글 — 목록이 다시 그려져도(다른 피드백이 들어와도) 잃지 않게. 키: edit:<id> · sugg:<id> · reply:<id> */
  private texts = new Map<string, string>();
  private noteKey = 'docbench:note';
  private note = '';

  constructor(app: App, el: HTMLElement) {
    this.app = app;
    this.el = el;
    this.noteKey = 'docbench:note:' + (app.manifest?.project.name || '');
    try { this.note = localStorage.getItem(this.noteKey) || ''; } catch { this.note = ''; }
    el.tabIndex = -1;
    el.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
  }

  private get t() { return this.app.t; }
  get filter(): PanelFilter {
    const f = this.app.state.panel?.filter as string | undefined;
    if (f && (FILTERS as string[]).includes(f)) return f as PanelFilter;
    if (f && LEGACY[f]) return LEGACY[f];
    return this.drafts().length ? 'draft' : this.rowsOf('review').length ? 'review' : 'draft';
  }
  private get scope(): 'doc' | 'all' { return this.app.state.panel?.scope === 'doc' ? 'doc' : 'all'; }
  private setPanel(p: { scope?: 'doc' | 'all'; filter?: PanelFilter }): void {
    this.app.state.panel = { ...(this.app.state.panel || {}), ...p };
    this.app.saveState();
    this.cursorId = null;
    this.render();
  }

  open(scope?: 'doc' | 'all', filter?: PanelFilter): void {
    this.setPanel({ ...(scope ? { scope } : {}), ...(filter ? { filter } : {}) });
    this.app.root.classList.add('panel-open');
  }

  /** 새 초안을 보낼 것으로 고른다 */
  select(id: string): void { this.sel.add(id); this.seen.add(id); }

  focus(id: string): void {
    const f = this.app.fb.find((x) => x.id === id);
    if (!f) return;
    const t = turnOf(f);
    this.open(this.scope === 'doc' && f.docId !== this.app.view ? 'all' : undefined, t === 'draft' ? 'draft' : t === 'owner' ? 'review' : t === 'assistant' ? 'sent' : 'done');
    requestAnimationFrame(() => {
      const c = this.el.querySelector<HTMLElement>(`.db-card[data-id="${CSS.escape(id)}"]`);
      if (!c) return;
      c.classList.add('focus');
      c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => c.classList.remove('focus'), 1600);
    });
  }

  // ------------------------------------------------------------ 모으기
  drafts(): Feedback[] { return this.app.scopedFb().filter((f) => f.status === 'draft'); }
  /** 패널 범위(이 문서만 / 전체) 안인가 */
  private inScope(f: Feedback): boolean {
    const v = this.app.view;
    return this.scope === 'all' || !v || (v === 'map' ? f.target.kind === 'item' : f.docId === v && f.target.kind !== 'item');
  }
  /** 볼 것에 남은 읽기 정리 — 범위가 "이 문서"면 이 문서 것만 */
  private viewRounds(): RunStatus[] {
    const v = this.app.view;
    return this.app.pendingReadingPlans().filter((r) => this.scope === 'all' || !v || r.view!.some((p) => p.docId === v));
  }
  private rowsOf(filter: PanelFilter): Feedback[] {
    const all = this.app.scopedFb();
    const inScope = (f: Feedback) => this.inScope(f);
    const want = (f: Feedback) => {
      const x = turnOf(f);
      return filter === 'draft' ? x === 'draft' : filter === 'review' ? x === 'owner' : filter === 'sent' ? x === 'assistant' : x === 'resolved' || x === 'declined';
    };
    const rows = sortFeedback(all.filter((f) => want(f) && inScope(f)), Object.keys(this.app.manifest.docs));
    const d = this.app.doc;
    if (d) {
      const order = new Map(d.secs.map((s, i) => [s.key, i]));
      const pos = (f: Feedback) => (f.docId === d.id ? order.get(d.sectionKeyOf(f.id) || '') ?? 1e6 : 1e6);
      rows.sort((a, b) => (a.docId === b.docId ? pos(a) - pos(b) : 0));
    }
    return rows;
  }

  // ------------------------------------------------------------ 그리기
  render(): void {
    const app = this.app;
    if (!app.manifest) return;
    const t = this.t;
    // 처음 보는 초안은 저절로 고른다(보낼 것)
    const drafts = this.drafts();
    for (const f of drafts) if (!this.seen.has(f.id)) { this.seen.add(f.id); this.sel.add(f.id); }
    for (const id of [...this.sel]) if (!drafts.some((f) => f.id === id)) this.sel.delete(id);
    // 칸의 숫자도 패널 범위대로 — "이 문서만"인데 전체 숫자가 보이면 빈 칸을 눌러 보게 된다
    const c = countTurns(app.scopedFb().filter((f) => this.inScope(f)));
    const views = this.viewRounds();
    const filter = this.filter;
    const tab = (f: PanelFilter, label: string, n: number) => h('button', { type: 'button', role: 'tab', 'aria-pressed': String(filter === f), class: 'tab-' + f, onclick: () => this.setPanel({ filter: f }) }, label, h('span', { class: 'n', text: n }));
    const head = h('div', { class: 'db-ph' },
      h('div', { class: 'db-ph-top' },
        h('h2', { text: t('panel.title') }),
        h('button', { class: 'db-btn sm ghost', type: 'button', 'aria-pressed': String(this.scope === 'doc'), title: t('panel.scope.hint'), onclick: () => this.setPanel({ scope: this.scope === 'doc' ? 'all' : 'doc' }) }, this.scope === 'doc' ? t('panel.scope.doc') : t('panel.scope.all')),
        app.canReview() ? h('button', { class: 'db-btn sm', type: 'button', title: t('review.ask.hint'), onclick: (e: Event) => app.reviewMenu(e.currentTarget as HTMLElement), html: icon('spark') + ' ' + t('review.ask') }) : null),
      h('div', { class: 'db-tabs', role: 'tablist' },
        tab('draft', t('panel.f.draft'), c.draft),
        tab('review', t('panel.f.review'), c.owner + views.length),
        tab('sent', t('panel.f.sent'), c.assistant),
        tab('done', t('panel.f.done'), c.resolved + c.declined)));
    this.list = h('div', { class: 'db-plist' });
    const keep = this.el.querySelector('.db-plist')?.scrollTop || 0;
    // 쓰던 칸의 초점·커서 — 다시 그린 뒤 같은 칸(data-key)에 돌려준다
    const act = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
    const focusKey = act && this.el.contains(act) ? act.dataset?.key : undefined;
    const caret = focusKey && 'selectionStart' in act! ? [act!.selectionStart, act!.selectionEnd] as const : null;
    const parts: HTMLElement[] = [head, this.list];
    const rows = this.rowsOf(filter);
    if (filter === 'draft') {
      if (rows.length) this.list.append(this.draftTools(rows));
      parts.push(this.sendBar(rows));
    }
    this.el.replaceChildren(...parts);
    if (!rows.length && !(filter === 'review' && views.length)) this.list.append(h('div', { class: 'db-empty' }, h('p', { text: app.fbMode === 'pending' ? t('fb.loading') : t('panel.empty.' + filter) }), filter === 'draft' ? h('p', { class: 'db-hint', text: t('panel.empty.draft.how') }) : null));
    else if (filter === 'review') this.renderReview(rows, views);
    else {
      let lastDoc = '';
      for (const f of rows) {
        if (this.scope === 'all' && f.docId !== lastDoc) { lastDoc = f.docId; this.list.append(h('div', { class: 'db-pgroup', text: f.target.kind === 'item' ? t('view.map') : app.docTitle(f.docId) })); }
        this.list.append(filter === 'draft' ? this.draftCard(f) : filter === 'sent' ? this.sentCard(f) : this.doneCard(f));
      }
    }
    this.list.scrollTop = keep;
    if (this.cursorId) this.el.querySelector(`.db-card[data-id="${CSS.escape(this.cursorId)}"]`)?.classList.add('kbd');
    if (focusKey) {
      const back = this.el.querySelector<HTMLTextAreaElement>(`[data-key="${CSS.escape(focusKey)}"]`);
      if (back) { back.focus({ preventScroll: true }); if (caret && caret[0] != null) { try { back.setSelectionRange(caret[0], caret[1] ?? caret[0]); } catch { /* 입력 칸 종류 */ } } }
    }
  }

  /** 쓰던 글 칸 — 다시 그려도 글과 초점이 남는다 */
  private textBox(key: string, initial: string, attrs: Record<string, unknown>): HTMLTextAreaElement {
    const ta = h('textarea', { ...attrs, 'data-key': key }) as HTMLTextAreaElement;
    ta.value = this.texts.has(key) ? this.texts.get(key)! : initial;
    ta.addEventListener('input', () => this.texts.set(key, ta.value));
    return ta;
  }
  private dropTexts(id: string): void { for (const k of ['edit:', 'sugg:', 'reply:']) this.texts.delete(k + id); }

  // ------------------------------------------------------------ 초안
  private draftTools(rows: Feedback[]): HTMLElement {
    const t = this.t;
    const n = rows.filter((f) => this.sel.has(f.id)).length;
    const pick = (fn: (f: Feedback) => boolean) => { this.sel.clear(); for (const f of rows) if (fn(f)) this.sel.add(f.id); this.render(); };
    const chosen = rows.filter((f) => this.sel.has(f.id));
    return h('div', { class: 'db-dtools' },
      h('span', { class: 'db-hint', text: t('draft.chosen', { n, all: rows.length }) }),
      h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => pick(() => true) }, t('draft.pick.all')),
      rows.some((f) => f.severity === 'high') ? h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => pick((f) => f.severity === 'high') }, t('draft.pick.urgent')) : null,
      h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => pick(() => false) }, t('draft.pick.none')),
      // 합치기는 나머지를 지운다 — 지울 수 없는 곳(권한·저장소)에서는 단추를 두지 않는다
      chosen.length >= 2 && this.app.can('feedback.delete') && this.app.ad.feedback.remove ? h('button', { class: 'db-btn sm', type: 'button', title: t('draft.merge.hint'), onclick: () => void this.merge(chosen) }, t('draft.merge', { n: chosen.length })) : null);
  }

  private loc(f: Feedback): string {
    const t = this.t;
    // 맨 위 제목(문서 제목과 같은 H1)은 빼고 — 카드마다 문서 제목이 되풀이되지 않게
    const path = f.target.kind === 'section' && f.target.path.length > 1 && f.target.path[0] === this.app.docTitle(f.docId) ? f.target.path.slice(1) : f.target.kind === 'section' ? f.target.path : [];
    const sec = f.target.kind === 'section' ? path.slice(-2).join(KEY_SEP) + (f.target.occurrence && f.target.occurrence > 1 ? ' #' + f.target.occurrence : '') : f.target.kind === 'item' ? (f.target.label || f.target.itemId) : t('fb.wholeDoc');
    // 전체 보기에서는 묶음 제목이 문서 이름이다 — 문서 이름을 두 번 쓰지 않는다
    return sec;
  }

  private head(f: Feedback, extra?: (HTMLElement | null)[]): HTMLElement {
    const app = this.app;
    const t = this.t;
    const who = f.author.kind === 'assistant' ? t('fb.by.assistant') : app.personLabel(f.author);
    return h('div', { class: 'db-c-top' },
      ...(extra || []),
      h('button', { class: 'db-c-loc', type: 'button', title: t('fb.goto'), onclick: () => void this.jump(f) }, '↳ ' + this.loc(f)),
      h('span', { class: 'db-grow' }),
      h('span', { class: 'db-hint', text: who + ' · ' + relTime(f.updatedAt, t) }));
  }

  private draftCard(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const c = h('article', { class: 'db-card t-draft' + (this.sel.has(f.id) ? ' picked' : ''), 'data-id': f.id });
    const box = h('input', { type: 'checkbox', class: 'db-pick', 'aria-label': t('draft.pick'), checked: this.sel.has(f.id) }) as HTMLInputElement;
    box.addEventListener('change', () => { if (box.checked) this.sel.add(f.id); else this.sel.delete(f.id); this.render(); });
    const star = h('button', { class: 'db-star', type: 'button', 'aria-pressed': String(f.severity === 'high'), title: t('fb.urgent.hint'), html: '★', onclick: () => void app.updateFeedback(f, { severity: f.severity === 'high' ? null : 'high' }) });
    c.append(this.head(f, [box, star]));
    if (f.selector?.exact) c.append(h('div', { class: 'db-c-quote', text: f.selector.exact }));
    const reply = this.pendingReply(f);
    if (this.editing.has(f.id)) c.append(this.editor(f));
    else {
      if (reply) {
        // Claude 의 질문·결과에 답해 다시 보낼 초안 — 원래 요청은 접어 두고 내 답을 보인다
        const lastAi = [...f.thread].reverse().find((m) => m.author.kind === 'assistant') || (f.author.kind === 'assistant' ? { author: f.author, text: f.body } : null);
        if (lastAi) c.append(h('div', { class: 'db-msg assistant clamp' }, h('span', { class: 'who', text: app.personLabel(lastAi.author) }), lastAi.text));
        c.append(h('div', { class: 'db-c-body editable', title: t('draft.edit.hint'), onclick: () => this.startEdit(f) }, h('span', { class: 'db-hint', text: t('draft.reply') + ' ' }), reply.text));
      } else {
        // 되돌린 고침 — 무엇을 했다가 되돌렸는지 보이고, 요청을 다듬어 다시 보낸다
        if (f.result?.reverted) {
          const lastAi = [...f.thread].reverse().find((m) => m.author.kind === 'assistant');
          c.append(h('div', { class: 'db-hint', text: t('draft.reverted') }));
          if (lastAi) c.append(h('div', { class: 'db-msg assistant clamp' }, h('span', { class: 'who', text: app.personLabel(lastAi.author) }), lastAi.text));
        }
        if (f.body) c.append(h('div', { class: 'db-c-body editable', title: t('draft.edit.hint'), onclick: () => this.startEdit(f), text: f.body }));
      }
      if (f.suggestion != null) c.append(h('div', { class: 'db-c-sugg editable', onclick: () => this.startEdit(f) }, h('span', { class: 'db-hint', text: t('draft.suggestion') }), h('pre', { text: f.suggestion })));
    }
    c.append(h('div', { class: 'db-c-act' },
      this.editing.has(f.id) ? null : h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => this.startEdit(f), html: icon('edit') + ' ' + t('draft.edit') }),
      h('button', { class: 'db-btn sm ghost', type: 'button', title: t('draft.sendOne.hint'), onclick: () => void app.sendDrafts([f.id]) }, t('draft.sendOne')),
      h('span', { class: 'db-grow' }),
      app.can('feedback.delete') && app.ad.feedback.remove ? h('button', { class: 'db-btn sm ghost danger', type: 'button', onclick: () => void this.remove([f]) }, t('fb.act.delete')) : null));
    return c;
  }

  /** 초안에 붙은 내 답(Claude 의 말 — 회신이나 Claude 가 올린 제안·질문 — 뒤에 내가 쓴 것) */
  private pendingReply(f: Feedback) {
    const i = f.thread.length - 1;
    if (i < 0 || f.thread[i].author.kind !== 'human') return null;
    return f.author.kind === 'assistant' || f.thread.slice(0, i).some((m) => m.author.kind === 'assistant') ? f.thread[i] : null;
  }

  private startEdit(f: Feedback): void { this.editing.add(f.id); this.render(); this.el.querySelector<HTMLTextAreaElement>(`.db-card[data-id="${CSS.escape(f.id)}"] textarea`)?.focus(); }

  private editor(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const reply = this.pendingReply(f);
    const ta = this.textBox('edit:' + f.id, reply ? reply.text : f.body, { rows: 3, 'aria-label': t('draft.edit') });
    const sg = f.suggestion != null ? this.textBox('sugg:' + f.id, f.suggestion, { rows: 4, class: 'mono', 'aria-label': t('draft.suggestion') }) : null;
    const done = () => { this.editing.delete(f.id); this.dropTexts(f.id); this.render(); };
    const save = async () => {
      const v = ta.value.trim();
      const patch: FeedbackPatch = reply
        ? { thread: [...f.thread.slice(0, -1), { ...reply, text: v, at: new Date().toISOString() }] }
        : { body: v };
      if (sg) patch.suggestion = sg.value.replace(/\r\n?/g, '\n');
      if (!v && !sg) { ta.focus(); return; }
      if (await app.updateFeedback(f, patch)) done();
    };
    // Esc: 바꾼 것이 없으면 닫고, 있으면 한 번 더 눌러야 버린다
    let armed = 0;
    const changed = () => ta.value !== (reply ? reply.text : f.body) || (!!sg && sg.value !== f.suggestion);
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void save(); }
      if (e.key === 'Escape') { e.stopPropagation(); if (!changed() || Date.now() - armed < 4000) done(); else { armed = Date.now(); app.toast(t('compose.discard')); } }
    };
    ta.addEventListener('keydown', keys); sg?.addEventListener('keydown', keys);
    return h('div', { class: 'db-reply' }, ta, sg ? h('div', { class: 'db-hint', text: t('draft.suggestion') }) : null, sg,
      h('div', { class: 'db-c-act' },
        h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => void save() }, t('compose.update')),
        h('button', { class: 'db-btn sm ghost', type: 'button', onclick: done }, t('edit.cancel'))));
  }

  /** 지우기 — 바로 지우고 알림에서 되살린다(다시 만든다). quiet = 알림은 부른 쪽이(합치기) */
  private async remove(rows: Feedback[], quiet = false): Promise<{ removed: Feedback[]; error?: string }> {
    const app = this.app;
    const t = this.t;
    const removed: Feedback[] = [];
    for (const f of rows) {
      try { await app.ad.feedback.remove!(f.id); removed.push({ ...f }); this.dropTexts(f.id); this.editing.delete(f.id); } catch (e) {
        const error = (e as Error).message;
        // 하나라도 못 지우면 거기서 멈춘다 — 지운 것은 되살릴 수 있게 알림에 남긴다
        if (!quiet) app.toast(t('fb.saveFail', { msg: error }), removed.length ? { sticky: true, action: t('draft.undo'), onAction: () => void this.restore(removed) } : {});
        return { removed, error };
      }
    }
    if (!quiet) app.toast(t(rows.length > 1 ? 'draft.removedN' : 'draft.removed', { n: rows.length }), { action: t('draft.undo'), onAction: () => void this.restore(removed) });
    return { removed };
  }
  /** 지운 초안을 되살린다(새 id 로 다시 만든다) */
  private async restore(kept: Feedback[]): Promise<void> {
    for (const f of kept) {
      const { id: _i, version: _v, createdAt: _c, updatedAt: _u, ...rest } = f;
      void _i; void _v; void _c; void _u;
      try { const nf = await this.app.ad.feedback.create(rest); this.app.noteFeedback(nf); this.select(nf.id); } catch { /* 하나라도 */ }
    }
    this.render();
  }

  /** 같은 곳을 가리키는가(섹션 경로·지도 항목·문서 전체) */
  private static sameTarget(a: Feedback, b: Feedback): boolean {
    if (a.target.kind !== b.target.kind) return false;
    if (a.target.kind === 'section' && b.target.kind === 'section') return a.target.path.join(KEY_SEP) === b.target.path.join(KEY_SEP) && (a.target.occurrence || 1) === (b.target.occurrence || 1);
    if (a.target.kind === 'item' && b.target.kind === 'item') return a.target.itemId === b.target.itemId;
    return true;
  }

  /**
   * 고른 초안 합치기 — 같은 곳이면 그곳, 같은 문서의 여러 섹션이면 문서 전체로. 다른 문서·지도의 다른 항목은 합치지 않는다.
   * 답장 초안은 내 답까지 본문에 넣는다. 알림 하나에서 통째로 되돌린다
   */
  private async merge(rows: Feedback[]): Promise<void> {
    const app = this.app;
    const t = this.t;
    if (new Set(rows.map((f) => f.docId)).size > 1) { app.toast(t('draft.merge.docs')); return; }
    const first = rows[0];
    const same = rows.every((f) => Panel.sameTarget(f, first));
    if (!same && rows.some((f) => f.target.kind === 'item')) { app.toast(t('draft.merge.items')); return; }
    const said = (f: Feedback) => { const r = this.pendingReply(f); return r ? `${f.body ? f.body + ' — ' : ''}${t('draft.reply')} ${r.text}` : f.body; };
    const line = (f: Feedback) => `- ${same ? '' : this.loc(f) + ': '}${f.selector?.exact ? `“${f.selector.exact}” — ` : ''}${said(f)}${f.suggestion != null ? ` → ${f.suggestion}` : ''}`.trim();
    const body = rows.map(line).join('\n');
    const firstReply = this.pendingReply(first);
    const undoFirst: FeedbackPatch = { body: first.body, suggestion: first.suggestion ?? null, selector: first.selector ?? null, target: first.target, severity: first.severity ?? null, thread: first.thread };
    const ok = await app.updateFeedback(first, {
      body, suggestion: null,
      selector: same && rows.every((f) => f.selector?.exact === first.selector?.exact) ? first.selector ?? null : null,
      target: same ? first.target : { kind: 'doc' },
      severity: rows.some((f) => f.severity === 'high') ? 'high' : first.severity ?? null,
      // 첫 초안의 답은 본문으로 옮겼다 — 같은 말이 두 번 가지 않게
      ...(firstReply ? { thread: first.thread.slice(0, -1) } : {}),
    });
    if (!ok) return;
    const undo = async () => {
      const cur = app.fb.find((x) => x.id === first.id);
      if (cur) await app.updateFeedback(cur, undoFirst);
      if (gone.removed.length) await this.restore(gone.removed);
    };
    const gone = await this.remove(rows.slice(1), true);
    if (gone.error) {
      // 나머지를 지우지 못했다 — 합친 것을 되돌려 같은 요청이 두 번 가지 않게
      await undo();
      app.toast(t('fb.saveFail', { msg: gone.error }), { sticky: true });
      return;
    }
    this.sel.clear(); this.sel.add(first.id);
    this.render();
    app.toast(t('draft.merged', { n: rows.length }), { action: t('view.undo'), onAction: () => void undo() });
  }

  /** 보내기 막대 — 고른 초안 · 공통 지시 · 반영 방식 · 어디로(앱·터미널) · 고급 */
  private sendBar(rows: Feedback[]): HTMLElement {
    const app = this.app;
    const t = this.t;
    const chosen = rows.filter((f) => this.sel.has(f.id));
    const s = (app.state.runs ||= {});
    const conn = app.connection();
    // 보낼 곳 이름: 서버(serve)는 앱이 아니다 · 대화형 Claude(아티팩트)는 그 이름으로
    const viaLabel = (o: string) => (o === 'app' && conn.runner?.kind === 'server' ? t('send.via.server') : o === 'notify' && app.ad.notifier?.label ? app.ad.notifier.label : t('send.via.' + o));
    const note = h('textarea', { class: 'db-note', rows: 2, placeholder: t('send.note.ph'), 'aria-label': t('send.note'), 'data-key': 'note' }) as HTMLTextAreaElement;
    note.value = this.note;
    note.addEventListener('input', () => { this.note = note.value; try { localStorage.setItem(this.noteKey, note.value); } catch { /* 이 창에만 */ } });
    const seg = h('div', { class: 'db-seg sm', role: 'radiogroup', 'aria-label': t('send.mode') },
      ...(['auto', 'propose'] as const).map((m) => h('button', { type: 'button', role: 'radio', 'aria-pressed': String((s.mode || 'auto') === m), title: t('send.mode.' + m + '.hint'), onclick: () => { s.mode = m; app.saveState(); this.render(); } }, t('send.mode.' + m))));
    const via = conn.options.length > 1
      ? (() => { const e = h('select', { 'aria-label': t('send.via'), onchange: (ev: Event) => { s.via = (ev.target as HTMLSelectElement).value as typeof s.via; app.saveState(); this.render(); } }) as HTMLSelectElement; for (const o of conn.options) e.append(h('option', { value: o, text: viaLabel(o), selected: o === conn.current })); return e; })()
      : h('span', { class: 'db-hint', text: conn.current ? viaLabel(conn.current) : t('send.via.none') });
    const models: [string, string][] = [['', t('run.model.default')], ...((conn.runner?.models?.length ? conn.runner.models : RUN_MODELS).map((m) => [m, m[0].toUpperCase() + m.slice(1)] as [string, string]))];
    const efforts: [string, string][] = [['', t('run.effort.default')], ...((conn.runner?.efforts?.length ? conn.runner.efforts : RUN_EFFORTS).map((e) => [e, t('run.effort.' + e)] as [string, string]))];
    const sel = (label: string, value: string, opts: [string, string][], on: (v: string) => void) => h('label', { class: 'db-dock-opt' }, h('span', { text: label }),
      (() => { const e = h('select', { onchange: (ev: Event) => on((ev.target as HTMLSelectElement).value) }) as HTMLSelectElement; for (const [v, l] of opts) e.append(h('option', { value: v, text: l, selected: v === value })); return e; })());
    const adv = h('details', { class: 'db-adv' }, h('summary', { text: t('send.more') }),
      h('div', { class: 'db-row wrap' },
        sel(t('run.model'), s.model || '', models, (v) => { s.model = v; app.saveState(); }),
        sel(t('run.effort'), s.effort || '', efforts, (v) => { s.effort = v as typeof s.effort; app.saveState(); }),
        conn.current === 'terminal' ? h('label', { class: 'db-check' }, (() => { const c = h('input', { type: 'checkbox', checked: !!s.resume }) as HTMLInputElement; c.addEventListener('change', () => { s.resume = c.checked; app.saveState(); }); return c; })(), h('span', { text: t('send.resume') })) : null),
      app.ad.instructions ? h('button', { class: 'db-btn sm ghost', type: 'button', title: t('standing.hint'), onclick: () => void app.editStanding() }, t('standing.edit')) : null);
    const go = h('button', { class: 'db-btn primary db-sendbtn', type: 'button', disabled: !chosen.length || !conn.current, onclick: () => void app.sendDrafts(chosen.map((f) => f.id), { note: this.note, fromBar: true }) }, t('send.go', { n: chosen.length }));
    return h('div', { class: 'db-sendbar' },
      note,
      h('div', { class: 'db-row wrap' }, seg, h('span', { class: 'db-grow' }), via),
      adv,
      h('div', { class: 'db-row' }, h('span', { class: 'db-hint', text: !conn.current ? t('send.via.none.hint') : t('send.mode.' + (s.mode || 'auto') + '.short') }), h('span', { class: 'db-grow' }), go),
      // 매번 같은 말을 적고 있다면 — 늘 지킬 지시로
      app.ad.instructions && !this.note.trim() ? h('div', { class: 'db-hint db-standing-tip' }, t('standing.tip') + ' ', h('button', { class: 'db-link', type: 'button', onclick: () => void app.editStanding() }, t('standing.edit'))) : null);
  }

  /** 보낸 뒤 공통 지시를 비운다(다음 묶음은 새로) — 보낸 것은 회차 머리에 남는다 */
  clearNote(): void { this.note = ''; try { localStorage.removeItem(this.noteKey); } catch { /* 이 창에만 */ } }
  get noteText(): string { return this.note; }

  // ------------------------------------------------------------ 볼 것 (회차별)
  private renderReview(rows: Feedback[], views: RunStatus[] = []): void {
    const app = this.app;
    const groups = new Map<string, Feedback[]>();
    for (const f of rows) { const k = f.result?.run || ''; (groups.get(k) || groups.set(k, []).get(k)!).push(f); }
    // 읽기 정리만 돌려준 작업(피드백 없음)도 회차로 — 적용하거나 치울 때까지
    for (const r of views) if (!groups.has(r.id)) groups.set(r.id, []);
    const latest = (run: string, fs: Feedback[]) => fs.reduce((m, f) => (f.result?.at || f.updatedAt) > m ? (f.result?.at || f.updatedAt) : m, app.dock?.runFor(run)?.endedAt || '');
    const order = [...groups.entries()].sort((a, b) => latest(b[0], b[1]).localeCompare(latest(a[0], a[1])));
    const pendingViews = new Set(views.map((r) => r.id));
    for (const [run, fs] of order) {
      this.list.append(this.roundHead(run, fs, app.dock?.runFor(run), pendingViews.has(run)));
      // 전체 보기에서 여러 문서에 걸친 회차는 문서별로 묶는다
      let lastDoc = '';
      const multi = this.scope === 'all' && new Set(fs.map((f) => f.docId)).size > 1;
      for (const f of fs) {
        if (multi && f.docId !== lastDoc) { lastDoc = f.docId; this.list.append(h('div', { class: 'db-pgroup sub', text: f.target.kind === 'item' ? this.t('view.map') : app.docTitle(f.docId) })); }
        this.list.append(this.reviewCard(f));
      }
    }
  }

  private roundHead(runId: string, fs: Feedback[], run?: RunStatus, viewPending = false): HTMLElement {
    const app = this.app;
    const t = this.t;
    const edits = fs.filter((f) => f.result?.kind === 'edit' && f.result.change && !f.result.reverted);
    const when = run?.endedAt || fs[0]?.result?.at || '';
    const kind = !runId ? t('round.other') : run?.kind === 'review' ? (run.goal === 'view' ? t('round.view') : t('round.review')) : t('round.sent', { n: run?.feedbackIds.length || fs.length });
    const box = h('div', { class: 'db-round' },
      h('div', { class: 'db-round-h' }, h('b', { text: kind }), when ? h('span', { class: 'db-hint', text: relTime(when, t) }) : null),
      run?.note ? h('div', { class: 'db-round-note' }, h('span', { class: 'db-hint', text: t('round.note') + ' ' }), run.note) : null,
      run?.overview ? h('div', { class: 'db-round-ov' }, h('span', { class: 'ic', html: icon('spark') }), run.overview) : null);
    // 읽기 정리: 적용하거나 치우기 전까지 — 적용한 뒤에도 문서별로 다시 적용할 수 있게 남는다(피드백이 있는 회차)
    const plans = (run?.view || []).filter((p) => !!app.manifest.docs[p.docId]);
    if (plans.length && (viewPending || fs.length)) {
      for (const p of plans) {
        box.append(h('div', { class: 'db-round-view' },
          h('div', {}, h('b', { text: app.docTitle(p.docId) + ' — ' + t('round.view.what', { fold: p.fold.length, focus: p.focus?.length || 0 }) })),
          p.guide ? h('div', { class: 'db-hint', text: p.guide }) : null,
          h('div', { class: 'db-row' }, h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => void app.applyReadingPlan(p, { run: runId }) }, t('round.view.apply')))));
      }
      if (viewPending && !fs.length) box.append(h('div', { class: 'db-row' }, h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => app.dismissReadingPlan(runId) }, t('round.view.dismiss'))));
    }
    const okable = fs.filter((f) => this.kindOf(f) !== 'failed');
    if (runId && fs.length) box.append(h('div', { class: 'db-row wrap' },
      okable.length ? h('button', { class: 'db-btn sm', type: 'button', title: t('round.ok.hint'), onclick: () => void this.confirmAll(okable) }, t('round.ok', { n: okable.length })) : null,
      edits.length ? h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => void this.revertAll(edits) }, t('round.revert', { n: edits.length })) : null,
      h('button', { class: 'db-btn sm ghost', type: 'button', title: t('round.copy.hint'), onclick: () => void this.copySummary(fs, run), html: icon('copy') + ' ' + t('round.copy') })));
    return box;
  }

  private kindOf(f: Feedback): string {
    const r = f.result;
    if (!r) return f.author.kind === 'assistant' ? (f.proposal?.state === 'pending' ? 'suggest' : 'question') : 'mine';
    if (r.kind === 'review') return f.proposal?.state === 'pending' ? 'suggest' : 'question';
    if (r.kind === 'edit' && r.reverted) return 'reverted';
    return r.kind;
  }

  private reviewCard(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const k = this.kindOf(f);
    const c = h('article', { class: `db-card t-owner r-${k}`, 'data-id': f.id });
    c.append(this.head(f, [h('span', { class: 'db-rkind ' + k, text: t('result.' + k) })]));
    if (f.title) c.append(h('div', { class: 'db-c-title', text: f.title }));
    const aiMsg = [...f.thread].reverse().find((m) => m.author.kind === 'assistant');
    const mine = f.author.kind !== 'assistant';
    if (mine) {
      // 내 요청은 짧게(펼칠 수 있게) — 볼 것은 Claude 가 한 일
      const req = (f.selector?.exact ? `“${f.selector.exact}” ` : '') + (f.body || '') + (f.suggestion != null ? ` → ${f.suggestion}` : '');
      if (req.trim()) c.append(h('div', { class: 'db-c-req' + (this.expanded.has(f.id) ? '' : ' clamp'), title: t('result.mine'), onclick: () => { this.expanded.has(f.id) ? this.expanded.delete(f.id) : this.expanded.add(f.id); this.render(); } }, h('span', { class: 'db-hint', text: t('result.mine') + ' ' }), req));
      if (aiMsg) c.append(h('div', { class: 'db-msg assistant' }, h('span', { class: 'who', text: app.personLabel(aiMsg.author) }), aiMsg.text));
    } else {
      if (f.selector?.exact) c.append(h('div', { class: 'db-c-quote', text: f.selector.exact }));
      c.append(h('div', { class: 'db-msg assistant' }, h('span', { class: 'who', text: app.personLabel(f.author) }), f.body));
      for (const m of f.thread.filter((m) => m.author.kind !== 'assistant' || m.text !== f.body).slice(-2)) c.append(h('div', { class: 'db-msg' + (m.author.kind === 'assistant' ? ' assistant' : '') }, h('span', { class: 'who', text: app.personLabel(m.author) }), m.text));
    }
    // 차이: 제안은 바로, 고침은 눌러서(판 두 개를 읽는다)
    if (f.proposal && f.proposal.state === 'pending') c.append(this.proposalBox(f));
    else if (k === 'edit' && this.diffOpen.has(f.id)) { const slot = h('div', { class: 'db-diffslot' }, h('span', { class: 'db-hint', text: t('doc.loading') })); c.append(slot); void this.fillEditDiff(f, slot); }
    const act = h('div', { class: 'db-c-act' });
    const btn = (label: string, fn: () => void, cls = 'db-btn sm', title?: string) => act.append(h('button', { class: cls, type: 'button', ...(title ? { title } : {}), onclick: fn }, label));
    if (this.replying.has(f.id)) c.append(this.replyBox(f));
    else if (k === 'edit') {
      btn(this.diffOpen.has(f.id) ? t('result.diff.hide') : t('result.diff'), () => { this.diffOpen.has(f.id) ? this.diffOpen.delete(f.id) : this.diffOpen.add(f.id); this.render(); }, 'db-btn sm ghost');
      btn(t('result.revert'), () => void this.revert(f), 'db-btn sm ghost', t('result.revert.hint'));
      btn(t('result.again'), () => this.startReply(f), 'db-btn sm ghost');
      btn(t('result.ok'), () => void this.confirm(f), 'db-btn sm primary');
    } else if (k === 'propose' || k === 'suggest') {
      if (f.proposal?.state === 'pending' && app.can('doc.edit')) btn(t('fb.proposal.apply'), () => void applyProposal(app, f), 'db-btn sm primary');
      btn(t('result.reply'), () => this.startReply(f), 'db-btn sm ghost');
      btn(t('fb.proposal.reject'), () => void this.reject(f), 'db-btn sm ghost');
    } else if (k === 'ask' || k === 'question') {
      btn(t('result.reply'), () => this.startReply(f), 'db-btn sm primary');
      btn(t('result.close'), () => void this.confirm(f), 'db-btn sm ghost');
    } else if (k === 'failed') {
      // 반영하지 못한 것 — 까닭을 보이고 다시 보내거나 다듬어 보낸다
      c.insertBefore(h('div', { class: 'db-ed-msg warn', text: t('result.failed.why', { why: f.result?.problem || '' }) }), c.children[1] || null);
      btn(t('result.resend'), () => void this.resend(f), 'db-btn sm primary');
      btn(t('result.toDraft'), () => void this.toDraft(f), 'db-btn sm ghost');
      btn(t('result.close'), () => void this.confirm(f), 'db-btn sm ghost');
    } else if (k === 'mine' || k === 'reverted') {
      btn(t('result.toDraft'), () => void this.toDraft(f), 'db-btn sm primary');
      btn(t('result.close'), () => void this.confirm(f), 'db-btn sm ghost');
    } else {
      btn(t('result.again'), () => this.startReply(f), 'db-btn sm ghost');
      btn(t('result.ok'), () => void this.confirm(f), 'db-btn sm primary');
    }
    if (!this.replying.has(f.id)) c.append(act);
    return c;
  }

  private proposalBox(f: Feedback): HTMLElement {
    const p = f.proposal!;
    return h('div', { class: 'db-prop' }, renderDiff(lineDiff(p.before, p.after), this.t), p.rationale && p.rationale !== f.body ? h('div', { class: 'db-hint', text: p.rationale }) : null);
  }

  private async fillEditDiff(f: Feedback, slot: HTMLElement): Promise<void> {
    const app = this.app;
    const ch = f.result?.change;
    if (!ch || !app.ad.docs.loadVersion) { slot.replaceChildren(h('span', { class: 'db-hint', text: this.t('result.diff.none') })); return; }
    try {
      const [a, b] = await Promise.all([app.ad.docs.loadVersion(ch.docId, ch.from), app.ad.docs.loadVersion(ch.docId, ch.to)]);
      if (!a || !b) throw new Error('version');
      const before = ch.section ? getSectionText(a.md, ch.section) ?? a.md : a.md;
      const after = ch.section ? getSectionText(b.md, ch.section) ?? b.md : b.md;
      slot.replaceChildren(renderDiff(lineDiff(before, after), this.t));
    } catch { slot.replaceChildren(h('span', { class: 'db-hint', text: this.t('result.diff.none') })); }
  }

  private startReply(f: Feedback): void { this.replying.add(f.id); this.render(); this.el.querySelector<HTMLTextAreaElement>(`.db-card[data-id="${CSS.escape(f.id)}"] .db-reply textarea`)?.focus(); }

  /** 답하기·다시 요청 — 내 말을 붙여 초안으로(다음에 함께 보낸다). "바로 보내기"는 이것 하나만 */
  private replyBox(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const ta = this.textBox('reply:' + f.id, '', { rows: 3, placeholder: t('result.reply.ph'), 'aria-label': t('result.reply') });
    const cancel = () => { this.replying.delete(f.id); this.dropTexts(f.id); this.render(); };
    const save = async (now: boolean) => {
      const v = ta.value.trim();
      if (!v) { ta.focus(); return; }
      const ok = await app.updateFeedback(f, { status: 'draft', waitingOn: 'owner', drafter: app.me.id || null, proposal: f.proposal?.state === 'pending' ? { ...f.proposal, state: 'rejected' } : f.proposal ?? null, thread: [...f.thread, { author: app.me, text: v, at: new Date().toISOString() }] });
      if (!ok) return;
      this.replying.delete(f.id);
      this.dropTexts(f.id);
      this.select(f.id);
      if (now) await app.sendDrafts([f.id]);
      else { app.toast(t('result.reply.saved'), { action: t('fb.draft.see'), onAction: () => this.open(undefined, 'draft') }); this.render(); }
    };
    let armed = 0;
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void save(e.shiftKey); }
      if (e.key === 'Escape') { e.stopPropagation(); if (!ta.value.trim() || Date.now() - armed < 4000) cancel(); else { armed = Date.now(); app.toast(t('compose.discard')); } }
    });
    return h('div', { class: 'db-reply' }, ta, h('div', { class: 'db-c-act' },
      h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => void save(false) }, t('result.reply.draft')),
      h('button', { class: 'db-btn sm', type: 'button', onclick: () => void save(true) }, t('result.reply.now')),
      h('button', { class: 'db-btn sm ghost', type: 'button', onclick: cancel }, t('edit.cancel'))));
  }

  private async confirm(f: Feedback): Promise<boolean> {
    const k = this.kindOf(f);
    const ok = await this.app.updateFeedback(f, { status: k === 'decline' ? 'declined' : 'resolved' });
    // 고침을 확인했으면 문서의 "바뀐 곳" 표시에서도 그 섹션을 뺀다
    const ch = f.result?.change;
    if (ok && k === 'edit' && ch && this.app.doc?.id === ch.docId) this.app.doc.ackSections(ch.section ? [ch.section] : '*');
    return ok;
  }
  private async confirmAll(all: Feedback[]): Promise<void> {
    // 못 한 것은 "모두 확인"으로 닫지 않는다 — 다시 보낼지·초안으로 가져갈지는 하나씩 고른다
    const fs = all.filter((f) => this.kindOf(f) !== 'failed');
    const pending = fs.filter((f) => f.proposal?.state === 'pending');
    if (pending.length && !(await this.app.dialogs.confirm(this.t('round.ok.pending', { n: pending.length }), this.t('round.ok.go')))) return;
    let n = 0;
    for (const f of fs) if (await this.confirm(f)) n++;
    this.app.toast(this.t('round.ok.done', { n }));
  }
  private async reject(f: Feedback): Promise<void> {
    const app = this.app;
    await app.updateFeedback(f, { status: 'resolved', ...(f.proposal ? { proposal: { ...f.proposal, state: 'rejected' as const } } : {}), thread: [...f.thread, { author: app.me, text: this.t('fb.proposal.reject'), at: new Date().toISOString() }] });
  }
  /** 초안으로 — 내 초안이 된다(함께 쓰는 기록이면 남에게는 보이지 않는다). 못 한 결과의 꼬리표는 지운다 */
  private async toDraft(f: Feedback): Promise<void> {
    if (await this.app.updateFeedback(f, { status: 'draft', waitingOn: 'owner', drafter: this.app.me.id || null, ...(f.result?.kind === 'failed' ? { result: null } : {}) })) { this.select(f.id); this.app.toast(this.t('result.toDraft.done')); }
  }
  /** 그대로 다시 보내기 — 초안을 거쳐 한 건 묶음으로(지금 고른 보낼 곳·방식으로) */
  private async resend(f: Feedback): Promise<void> {
    const app = this.app;
    if (!(await app.updateFeedback(f, { status: 'draft', waitingOn: 'owner', drafter: app.me.id || null, result: null }))) return;
    await app.sendDrafts([f.id]);
  }

  /**
   * 되돌리기 — Claude 가 쓴 그대로일 때만(그 뒤 또 바뀌었으면 차이를 보이고 사람이 고친다). 되돌리면 피드백은 초안으로(다시 다듬어 보낸다)
   */
  async revert(f: Feedback, quiet = false): Promise<boolean> {
    const app = this.app;
    const t = this.t;
    const ch = f.result?.change;
    if (!ch || !app.ad.docs.loadVersion || !app.ad.docs.save) { app.toast(t('result.revert.none')); return false; }
    try {
      const [from, to, cur] = await Promise.all([app.ad.docs.loadVersion(ch.docId, ch.from), app.ad.docs.loadVersion(ch.docId, ch.to), app.ad.docs.load(ch.docId)]);
      if (!from || !to) { app.toast(t('result.revert.none')); return false; }
      const plan = planRevert(cur.md, from.md, to.md, ch.section);
      if ('problem' in plan) {
        app.toast(t('result.revert.changed'), { sticky: true, action: t('result.diff'), onAction: () => { this.diffOpen.add(f.id); void this.jump(f); this.render(); } });
        return false;
      }
      const res = await app.ad.docs.save(ch.docId, plan.md, { baseVersion: cur.version, summary: t('result.revert.summary'), feedbackIds: [f.id] });
      await app.doc?.ownSave(ch.docId, { ...cur, md: plan.md, version: res.version, updatedAt: res.updatedAt, updatedBy: app.me });
      // 초안으로(내 것) — 되돌렸다는 표시는 결과 꼬리표에. 대화에 "되돌렸습니다"를 넣지 않는다(내 답으로 오해해 그대로 보내지 않게)
      await app.updateFeedback(app.fb.find((x) => x.id === f.id) || f, { status: 'draft', waitingOn: 'owner', drafter: app.me.id || null, result: { ...f.result!, reverted: new Date().toISOString() } });
      this.select(f.id);
      if (!quiet) app.toast(t('result.revert.done'), { action: t('fb.draft.see'), onAction: () => this.open(undefined, 'draft') });
      return true;
    } catch (e) {
      app.toast(t('err.generic', { msg: (e as Error).message }));
      return false;
    }
  }
  private async revertAll(edits: Feedback[]): Promise<void> {
    if (!(await this.app.dialogs.confirm(this.t('round.revert.ask', { n: edits.length }), this.t('result.revert')))) return;
    let n = 0;
    for (const f of [...edits].sort((a, b) => (b.result?.at || '').localeCompare(a.result?.at || ''))) if (await this.revert(f, true)) n++;
    this.app.toast(this.t('round.revert.done', { n, all: edits.length }));
  }

  /** 회차 결과를 사람이 읽는 글로 — 팀 공유·커밋 메시지에 그대로 */
  private async copySummary(fs: Feedback[], run?: RunStatus): Promise<void> {
    const app = this.app;
    const t = this.t;
    const L: string[] = [t('round.copy.title', { when: app.when(run?.endedAt || new Date().toISOString()) })];
    if (run?.note) L.push(t('round.note') + ' ' + run.note);
    if (run?.overview) L.push(run.overview);
    L.push('');
    for (const f of fs) {
      const ai = [...f.thread].reverse().find((m) => m.author.kind === 'assistant')?.text || (f.author.kind === 'assistant' ? f.body : '');
      L.push(`- [${t('result.' + this.kindOf(f))}] ${app.docTitle(f.docId)} › ${this.loc(f)}${f.author.kind !== 'assistant' && f.body ? ` — ${f.body.replace(/\s+/g, ' ').slice(0, 120)}` : ''}${ai ? `\n  ${ai.replace(/\s+/g, ' ')}` : ''}`);
    }
    const ok = await app.copy(L.join('\n'));
    app.toast(ok ? t('round.copy.done') : t('run.setup.copyFail'));
  }

  // ------------------------------------------------------------ 보냄 · 끝남
  private sentCard(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const run = app.dock?.activeFor(f.id);
    const c = h('article', { class: 'db-card t-assistant', 'data-id': f.id });
    c.append(this.head(f));
    if (f.selector?.exact) c.append(h('div', { class: 'db-c-quote', text: f.selector.exact }));
    if (f.body) c.append(h('div', { class: 'db-c-body clamp', text: f.body }));
    const terminal = run && app.dock?.isTerminal(run);
    // 맡긴 작업이 멈췄거나 취소됐으면 그 까닭 — "처리 중인지 잊혔는지" 모르게 두지 않는다
    const last = run ? undefined : app.dock?.lastFor(f.id);
    if (last && (last.state === 'failed' || last.state === 'canceled')) {
      c.append(h('div', { class: 'db-ed-msg warn', text: last.state === 'canceled' ? t('sent.canceled') : t('sent.failed', { msg: last.error || '' }) }));
    }
    c.append(h('div', { class: 'db-c-act' },
      run ? h('span', { class: 'db-busy' }, terminal ? h('span', { class: 'ic', html: icon('clock') }) : h('span', { class: 'db-spin sm' }), ' ', t(terminal ? 'sent.terminal' : run.state === 'queued' ? 'run.fb.queued' : 'run.fb.running')) : h('span', { class: 'db-hint', text: t('sent.idle') }),
      h('span', { class: 'db-grow' }),
      terminal ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => app.dock?.showTerminal(run!) }, t('sent.terminal.show')) : null,
      run && !terminal ? h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => app.dock?.setOpen(true) }, t('run.open')) : null,
      !run && last && (last.state === 'failed' || last.state === 'canceled') ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void this.resend(f) }, t('result.resend')) : null,
      !run || terminal ? h('button', { class: 'db-btn sm ghost', type: 'button', title: t('sent.back.hint'), onclick: () => void this.toDraft(f) }, t('sent.back')) : null));
    return c;
  }

  private doneCard(f: Feedback): HTMLElement {
    const app = this.app;
    const t = this.t;
    const c = h('article', { class: 'db-card t-' + turnOf(f), 'data-id': f.id });
    c.append(this.head(f, [h('span', { class: 'db-turnlbl ' + turnOf(f), text: t('turn.' + turnOf(f)) })]));
    if (f.title) c.append(h('div', { class: 'db-c-title', text: f.title }));
    if (f.body) c.append(h('div', { class: 'db-c-body clamp', text: f.body }));
    const ai = [...f.thread].reverse().find((m) => m.author.kind === 'assistant');
    if (ai && ai.text !== f.body) c.append(h('div', { class: 'db-msg assistant clamp' }, h('span', { class: 'who', text: app.personLabel(ai.author) }), ai.text));
    if (app.can('feedback.update')) c.append(h('div', { class: 'db-c-act' }, h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => void this.toDraft(f) }, t('result.toDraft'))));
    return c;
  }

  // ------------------------------------------------------------ 이동·키
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
    if (getComputedStyle(app.els.panel).position === 'absolute') app.root.classList.remove('panel-open');
  }

  /** 키보드만으로: j·k 다음·이전, x 고르기, s ★, e 고치기, a 확인·적용, u 되돌리기, r 답하기 */
  private onKey(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('textarea, input, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const cards = [...this.el.querySelectorAll<HTMLElement>('.db-card')];
    if (!cards.length) return;
    const at = this.cursorId ? cards.findIndex((c) => c.dataset.id === this.cursorId) : -1;
    const move = (d: number) => {
      const i = Math.max(0, Math.min(cards.length - 1, (at < 0 ? (d > 0 ? -1 : cards.length) : at) + d));
      this.cursorId = cards[i].dataset.id || null;
      cards.forEach((c, j) => c.classList.toggle('kbd', j === i));
      cards[i].scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
    const card = at >= 0 ? cards[at] : undefined;
    const f = card && this.app.fb.find((x) => x.id === card.dataset.id);
    if (!f) return;
    const k = this.kindOf(f);
    // 칸마다 그 칸의 일만: 초안 x·s·e, 볼 것 a·u·r
    const filter = this.filter;
    if (e.key === 'x' && filter === 'draft') { this.sel.has(f.id) ? this.sel.delete(f.id) : this.sel.add(f.id); this.render(); }
    else if (e.key === 's' && filter === 'draft') void this.app.updateFeedback(f, { severity: f.severity === 'high' ? null : 'high' });
    else if (e.key === 'e' && filter === 'draft') { e.preventDefault(); this.startEdit(f); }
    else if (e.key === 'a' && filter === 'review') void (f.proposal?.state === 'pending' ? (this.app.can('doc.edit') ? applyProposal(this.app, f) : undefined) : k === 'failed' ? this.resend(f) : this.confirm(f));
    else if (e.key === 'u' && filter === 'review' && k === 'edit') void this.revert(f);
    else if (e.key === 'r' && filter === 'review') { e.preventDefault(); this.startReply(f); }
    else return;
    e.preventDefault();
  }
}
