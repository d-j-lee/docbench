/**
 * 편집 도우미 — 섹션·문서 편집, 미리보기, 차이, 저장 충돌, 인코딩, 제안 적용.
 */
import { DocConflictError, DocReadOnlyError, type DocContent, type Feedback } from '../types';
import { diffSections, getSectionText, replaceSection, KEY_SEP } from '../core/source';
import { lineDiff, type DiffResult } from '../core/diff';
import { toLF, norm } from '../core/markdown';
import { renderMarkdown, decorate, type Section } from './render';
import { h } from './dom';
import type { T } from './i18n';
import type { DocView } from './docview';
import type { App } from './app';

export function renderDiff(d: DiffResult, t: T, label?: string): HTMLElement {
  const body = h('div', { class: 'db-diff-b' });
  for (const l of d.lines) {
    if (l.t === 'skip') { body.append(h('div', { class: 'db-dl skip', text: `… ${l.count} …` })); continue; }
    const row = h('div', { class: 'db-dl ' + l.t });
    const sign = l.t === 'add' ? '+ ' : l.t === 'del' ? '− ' : '  ';
    row.append(sign);
    if ((l.t === 'add' || l.t === 'del') && l.words) for (const w of l.words) row.append(w.changed ? h(l.t === 'add' ? 'ins' : 'del', { text: w.text }) : w.text);
    else row.append(l.text);
    body.append(row);
  }
  return h('div', { class: 'db-diff' },
    h('div', { class: 'db-diff-h' }, h('span', { class: 'add', text: '+' + d.added }), h('span', { class: 'del', text: '−' + d.removed }), label ? h('span', { class: 'db-hint', text: label }) : null),
    body);
}

interface EditorInit {
  text?: string;
  note?: string;
  feedback?: Feedback;
  onSaved?: (c: DocContent) => Promise<void> | void;
}

export class Editor {
  readonly view: DocView;
  readonly sec: Section | null;
  readonly key: string | null;
  readonly index: number | null;
  readonly el: HTMLElement;
  private area: HTMLTextAreaElement;
  private pane: HTMLElement;
  private msg: HTMLElement;
  private summary: HTMLInputElement;
  private saveBtn: HTMLButtonElement;
  private base: string;
  private baseVersion: string;
  private init: EditorInit;
  private mode: 'edit' | 'preview' | 'diff' = 'edit';
  private draftKey: string;
  /** 편집하는 동안 바깥에서 바뀐 최신 판 (닫을 때 화면에 반영) */
  private pendingFresh: DocContent | null = null;
  private saved = false;

  constructor(view: DocView, sec: Section | null, init: EditorInit = {}) {
    this.view = view;
    this.sec = sec;
    this.key = sec ? sec.key : null;
    this.index = sec ? sec.index : null;
    this.init = init;
    const t = view.t;
    const md = view.content.md;
    this.base = sec ? (getSectionText(md, sec.key) ?? '') : md;
    this.baseVersion = view.content.version;
    this.draftKey = `docbench:draft:${view.app.manifest.project.name}:${view.id}:${this.key ?? '*'}`;
    this.area = h('textarea', { class: 'db-ed-area', spellcheck: 'false', 'aria-label': t('edit.title') }) as HTMLTextAreaElement;
    this.pane = h('div', { class: 'db-ed-preview', hidden: true });
    this.msg = h('div', { class: 'db-ed-msg', hidden: true });
    this.summary = h('input', { type: 'text', placeholder: t('edit.summary'), 'aria-label': t('edit.summary') }) as HTMLInputElement;
    this.saveBtn = h('button', { class: 'db-btn primary sm', type: 'button', onclick: () => void this.save() }, t('edit.save')) as HTMLButtonElement;
    const tabs = h('div', { class: 'db-seg', role: 'tablist' });
    for (const m of ['edit', 'preview', 'diff'] as const) tabs.append(h('button', { type: 'button', role: 'tab', 'data-m': m, 'aria-pressed': String(m === 'edit'), onclick: () => this.setMode(m) }, t('edit.tab.' + m)));
    const where = sec ? sec.path.slice(-2).join(KEY_SEP) : view.meta.title;
    this.el = h('div', { class: 'db-editor db-noindex' },
      h('div', { class: 'db-ed-top' }, tabs, h('span', { class: 'db-lbl', text: where })),
      this.area, this.pane, this.msg,
      h('div', { class: 'db-ed-foot' }, this.summary, h('button', { class: 'db-btn sm', type: 'button', onclick: () => void this.cancel() }, t('edit.cancel')), this.saveBtn));
    // 내용: 넘겨받은 글 > 저장 안 한 초안 > 원문
    let text = init.text ?? this.base;
    if (init.text == null) {
      try {
        const d = JSON.parse(localStorage.getItem(this.draftKey) || 'null');
        if (d && d.base === this.base && d.text !== this.base) { text = d.text; view.app.toast(t('edit.draftRestored')); }
      } catch { /* 초안 없음 */ }
    }
    this.area.value = text.replace(/\n+$/, '\n');
    if (init.note) this.note(init.note, 'warn');
    if (init.feedback) this.summary.value = init.feedback.title || init.feedback.body.slice(0, 60);
    this.area.addEventListener('input', () => { this.autosize(); this.saveDraft(); });
    this.el.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void this.save(); }
      if (e.key === 'Escape') { e.preventDefault(); void this.cancel(); }
    });
    // 놓을 자리
    if (sec) { sec.el.classList.add('editing'); sec.head.after(this.el); this.view.openTo(sec); }
    else view.article.prepend(this.el);
    this.autosize();
    this.focus();
    this.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  focus(): void { this.area.focus(); }
  dirty(): boolean { return toLF(this.area.value).replace(/\n+$/, '') !== this.base.replace(/\n+$/, ''); }
  private autosize(): void { this.area.style.height = 'auto'; this.area.style.height = Math.min(this.area.scrollHeight + 4, window.innerHeight * 0.7) + 'px'; }
  private saveDraft(): void {
    try {
      if (this.dirty()) localStorage.setItem(this.draftKey, JSON.stringify({ base: this.base, text: this.area.value, at: Date.now() }));
      else localStorage.removeItem(this.draftKey);
    } catch { /* 저장소 막힘 */ }
  }
  private note(text: string, tone: 'warn' | 'bad' | '' = '', extra?: HTMLElement): void {
    this.msg.className = 'db-ed-msg' + (tone ? ' ' + tone : '');
    this.msg.replaceChildren(text, extra || '');
    this.msg.hidden = !text && !extra;
  }
  /**
   * 편집하는 동안 문서가 바깥(에디터·Claude·다른 사람)에서 바뀌었다. 내 글은 지킨다.
   *  - 다른 섹션만 바뀌었으면: 저장하면 최신 판에 그대로 끼운다고 알린다
   *  - 이 섹션이 바뀌었으면: 그쪽 글과 내 글의 차이를 보여 주고, 그쪽 글로 바꿀지 내 글을 지킬지 고르게 한다
   */
  externalChanged(fresh: DocContent): void {
    const t = this.view.t;
    this.pendingFresh = fresh;
    const theirs = this.key != null ? getSectionText(fresh.md, this.key) : fresh.md;
    if (this.key != null && theirs != null && norm(theirs) === norm(this.base)) { this.note(t('edit.ext.other'), 'warn'); return; }
    const box = h('div', {},
      renderDiff(lineDiff(theirs ?? '', toLF(this.area.value)), t, t('edit.ext.diffLabel')),
      h('div', { class: 'db-row' },
        h('button', { class: 'db-btn sm', type: 'button', onclick: () => this.takeTheirs(fresh, theirs) }, t('edit.ext.theirs')),
        h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => this.note(t('edit.ext.kept'), 'warn') }, t('edit.ext.keep'))));
    this.note(theirs == null ? t('edit.ext.gone') : t('edit.ext.same'), 'bad', box);
  }

  /** 그쪽 글로 바꾸고 이어서 편집 — 내 글은 초안 저장소에 한 번 더 남겨 둔다 */
  private takeTheirs(fresh: DocContent, theirs: string | null): void {
    try { localStorage.setItem(this.draftKey + ':before-take', JSON.stringify({ text: this.area.value, at: Date.now() })); } catch { /* 저장소 막힘 */ }
    this.view.content = fresh;
    this.baseVersion = fresh.version;
    this.base = theirs ?? '';
    this.area.value = (theirs ?? '').replace(/\n+$/, '\n');
    this.autosize();
    this.pendingFresh = fresh;
    this.note(this.view.t('edit.ext.taken'), 'warn');
  }

  private setMode(m: 'edit' | 'preview' | 'diff'): void {
    this.mode = m;
    for (const b of Array.from(this.el.querySelectorAll('.db-ed-top .db-seg button'))) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.m === m));
    this.area.hidden = m !== 'edit';
    this.pane.hidden = m === 'edit';
    if (m === 'preview') {
      const art = renderMarkdown(this.area.value);
      art.className = 'db-md';
      decorate(art, this.view.app.rules);
      this.pane.replaceChildren(art);
    } else if (m === 'diff') this.pane.replaceChildren(renderDiff(lineDiff(this.base, toLF(this.area.value)), this.view.t));
    else this.focus();
  }

  async cancel(): Promise<void> {
    if (this.dirty() && !(await this.view.app.dialogs.confirm(this.view.t('edit.leave')))) return;
    this.close();
  }
  close(silent = false): void {
    try { localStorage.removeItem(this.draftKey); } catch { /* 무시 */ }
    this.el.remove();
    this.sec?.el.classList.remove('editing');
    if (!silent) {
      this.view.editorClosed();
      // 저장하지 않고 닫았는데 그 사이 바뀐 판이 있으면 이제 화면에 보여 준다(무엇이 바뀌었는지 표시와 함께)
      if (this.pendingFresh && !this.saved) void this.view.showFresh(this.pendingFresh);
    }
  }

  private compose(md: string): string | null {
    const text = toLF(this.area.value);
    if (this.key == null) return text;
    return replaceSection(md, this.key, text);
  }

  async save(convertTo?: 'utf-8', against?: DocContent): Promise<void> {
    const app = this.view.app;
    const t = this.view.t;
    if (!this.dirty() && !against) { app.toast(t('edit.nochange')); this.close(); return; }
    const baseDoc = against || this.view.content;
    const next = this.compose(baseDoc.md);
    if (next == null) { this.note(t('edit.conflict.overlap'), 'bad'); return; }
    this.saveBtn.disabled = true;
    this.saveBtn.textContent = t('edit.saving');
    try {
      const res = await app.ad.docs.save!(this.view.id, next, {
        baseVersion: against ? against.version : this.baseVersion,
        summary: this.summary.value.trim() || undefined,
        feedbackIds: this.init.feedback ? [this.init.feedback.id] : undefined,
        convertTo,
      });
      const fresh: DocContent = { ...baseDoc, md: next, version: res.version, updatedAt: res.updatedAt || new Date().toISOString(), updatedBy: app.me, readOnly: false, encoding: convertTo || baseDoc.encoding };
      this.saved = true;
      this.close();
      // 내 것 = 이 저장이 바꾼 섹션(바탕 판 → 저장한 글). 더 새 판에 끼워 저장했으면 그 사이 남의 변경은 표시된다
      const d = diffSections(baseDoc.md, next);
      this.view.rerender(fresh, this.index ?? undefined, against ? { mine: new Set([...d.changed, ...d.added, ...d.removed]) } : true);
      this.view.markSeen(res.version);
      app.saveState();
      app.toast(t('edit.saved'));
      app.emit({ type: 'doc:saved', docId: this.view.id, version: res.version });
      if (this.init.onSaved) await this.init.onSaved(fresh);
    } catch (e) {
      this.saveBtn.disabled = false;
      this.saveBtn.textContent = t('edit.save');
      if (e instanceof DocConflictError || (e as { code?: string }).code === 'CONFLICT') return this.onConflict((e as DocConflictError).current);
      if (e instanceof DocReadOnlyError || (e as { code?: string }).code === 'READ_ONLY') {
        const enc = (this.view.content.encoding || '').toUpperCase();
        const reason = (e as DocReadOnlyError).reason;
        // 인코딩 문제는 사람이 동의하면 UTF-8 로 바꿔 저장할 수 있다 (이유마다 안내가 다르다)
        if (['encoding', 'unrepresentable', 'invalid-utf8'].includes(reason) && (await app.dialogs.confirm(t('edit.encoding.' + reason, { enc }), t('edit.encoding.ok')))) return this.save('utf-8', against);
        this.note((e as Error).message, 'bad');
        return;
      }
      this.note(t('err.generic', { msg: (e as Error).message }), 'bad');
    }
  }

  private onConflict(current: DocContent): void {
    const t = this.view.t;
    const who = current.updatedBy?.name ? ` (${current.updatedBy.name})` : '';
    if (this.key != null) {
      const theirs = getSectionText(current.md, this.key);
      if (theirs != null && theirs.replace(/\n+$/, '') === this.base.replace(/\n+$/, '')) {
        // 내 섹션은 그대로 — 최신본에 다시 적용
        this.note(t('edit.conflict', { who }), 'warn');
        void this.save(undefined, current);
        return;
      }
    }
    const theirs = this.key != null ? getSectionText(current.md, this.key) ?? '' : current.md;
    const box = h('div', {},
      renderDiff(lineDiff(theirs, toLF(this.area.value)), t),
      h('div', { class: 'db-row' },
        h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => void this.save(undefined, current) }, t('edit.conflict.mine')),
        h('button', { class: 'db-btn sm', type: 'button', onclick: () => { this.close(); this.view.rerender(current); } }, t('edit.conflict.theirs'))));
    this.note(t('edit.conflict.overlap') + who, 'bad', box);
  }
}

/** 피드백의 수정 제안을 문서에 적용한다. 섹션이 그대로면 바로 저장, 바뀌었으면 편집기로 */
export async function applyProposal(app: App, f: Feedback): Promise<void> {
  const p = f.proposal;
  if (!p) return;
  if (app.view !== f.docId) await app.navigate(f.docId);
  const view = app.doc;
  if (!view || view.id !== f.docId) return;
  const key = p.path.join(KEY_SEP);
  const resolve = async () => {
    await app.updateFeedback(f, {
      status: 'resolved',
      proposal: { ...p, state: 'applied' },
      thread: [...f.thread, { author: app.me, text: app.t('fb.proposal.appliedMsg'), at: new Date().toISOString() }],
    }, app.t('fb.proposal.appliedMsg'));
  };
  // 문서 전체 제안(path 가 비었음 — Claude 가 문서를 통째로 고친 글)이면 문서 전체를 견준다
  const whole = !p.path.length;
  const cur = whole ? view.content.md : getSectionText(view.content.md, key);
  const sec = whole ? null : view.findSec(key);
  if (cur != null && cur.replace(/\n+$/, '') === p.before.replace(/\n+$/, '')) {
    const next = whole ? p.after : replaceSection(view.content.md, key, p.after)!;
    try {
      const res = await app.ad.docs.save!(f.docId, next, { baseVersion: view.content.version, summary: f.title || f.body.slice(0, 60), feedbackIds: [f.id] });
      view.rerender({ ...view.content, md: next, version: res.version, updatedAt: res.updatedAt, updatedBy: app.me }, sec?.index, true);
      view.markSeen(res.version);
      app.saveState();
      app.emit({ type: 'doc:saved', docId: f.docId, version: res.version });
      await resolve();
      return;
    } catch (e) {
      if (!(e instanceof DocConflictError) && (e as { code?: string }).code !== 'CONFLICT') { app.toast(app.t('err.generic', { msg: (e as Error).message })); return; }
      const fresh = (e as DocConflictError).current;
      view.rerender(fresh);
    }
  }
  if (whole) { view.openEditor(null, { text: p.after, note: app.t('edit.proposalStale'), feedback: f, onSaved: resolve }); return; }
  const target = view.findSec(key);
  if (!target) { app.toast(app.t('doc.orphans', { n: 1 })); return; }
  view.openEditor(target, { text: p.after, note: app.t('edit.proposalStale'), feedback: f, onSaved: resolve });
}
