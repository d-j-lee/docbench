/**
 * 대화상자 — 피드백 작성, 확인, 단축키 도움말. 네이티브 <dialog> 를 쓴다.
 */
import type { Severity, TextSelector, WaitingOn } from '../types';
import { KEY_SEP, parseKey } from '../core/source';
import { h } from './dom';
import type { Section } from './render';
import type { App } from './app';

export interface ComposeTarget {
  docId?: string;
  sec?: Section | null;
  selector?: TextSelector;
  item?: { id: string; label: string };
}

export class Dialogs {
  private app: App;
  private dlg: HTMLDialogElement;

  constructor(app: App) {
    this.app = app;
    this.dlg = h('dialog', { class: 'db-dialog' }) as HTMLDialogElement;
    app.root.append(this.dlg);
    this.dlg.addEventListener('click', (e) => { if (e.target === this.dlg) this.dlg.close('cancel'); });
  }
  isOpen(): boolean { return this.dlg.open; }
  private show(content: HTMLElement): void {
    this.dlg.replaceChildren(content);
    if (!this.dlg.open) { try { this.dlg.showModal(); } catch { this.dlg.setAttribute('open', ''); } }
  }
  close(): void { if (this.dlg.open) this.dlg.close(); }

  confirm(text: string, ok?: string): Promise<boolean> {
    const t = this.app.t;
    return new Promise((resolve) => {
      let done = false;
      const fin = (v: boolean) => { if (done) return; done = true; this.close(); resolve(v); };
      const yes = h('button', { class: 'db-btn primary', type: 'button', onclick: () => fin(true) }, ok || 'OK');
      this.show(h('div', { class: 'db-sheet' }, h('p', { style: 'margin:0', text }),
        h('div', { class: 'db-sheet-act' }, h('button', { class: 'db-btn', type: 'button', onclick: () => fin(false) }, t('compose.cancel')), yes)));
      this.dlg.addEventListener('close', () => fin(false), { once: true });
      yes.focus();
    });
  }

  help(): void {
    const t = this.app.t;
    const rows: [string, string][] = [['j', 'help.j'], ['k', 'help.k'], ['o', 'help.o'], ['e', 'help.e'], ['c', 'help.c'], ['/', 'help.slash'], ['f', 'help.f'], ['1 2 3 0', 'help.num'], ['?', 'help.q'], ['Esc', 'help.esc']];
    const grid = h('div', { class: 'db-keys' });
    for (const [k, l] of rows) grid.append(h('span', {}, ...k.split(' ').map((x) => h('kbd', { text: x }))), h('span', { text: t(l) }));
    this.show(h('div', { class: 'db-sheet' }, h('h3', { text: t('help.title') }), grid,
      h('div', { class: 'db-sheet-act' }, h('button', { class: 'db-btn', type: 'button', onclick: () => this.close() }, t('close')))));
  }

  compose(target: ComposeTarget): void {
    const app = this.app;
    const t = app.t;
    if (!app.can('feedback.create')) return;
    let kind: string | null = null;
    let sev: Severity | null = null;
    let to: WaitingOn = 'assistant';
    const sec = target.sec || null;
    const where = target.item ? t('view.map') + ' · ' + target.item.label
      : app.docTitle(target.docId!) + (sec ? ' · ' + sec.path.slice(-2).join(KEY_SEP) : ' · ' + t('fb.wholeDoc'));
    const tg = h('div', { class: 'db-target' }, h('span', { class: 'path', text: where }));
    if (sec && !target.selector) tg.append(sec.el.dataset.collapsed === 'true' ? t('compose.collapsed') : t('compose.section'));
    if (target.selector) tg.append(h('q', { text: '“' + target.selector.exact + '”' }));
    const chipRow = (opts: [string, string][], get: () => string | null, set: (v: string | null) => void) => {
      const row = h('div', { class: 'db-row' });
      const paint = () => { for (const b of Array.from(row.children)) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === get())); };
      for (const [v, label] of opts) row.append(h('button', { class: 'db-chip', type: 'button', 'data-v': v, 'aria-pressed': 'false', onclick: () => { set(get() === v ? null : v); paint(); } }, label));
      paint();
      return row;
    };
    const kinds = chipRow([['fix', t('compose.kind.fix')], ['ask', t('compose.kind.ask')], ['cut', t('compose.kind.cut')], ['add', t('compose.kind.add')], ['check', t('compose.kind.check')]], () => kind, (v) => { kind = v; });
    const sevs = chipRow([['high', t('fb.sev.high')], ['medium', t('fb.sev.medium')], ['low', t('fb.sev.low')]], () => sev, (v) => { sev = v as Severity | null; });
    const tos = chipRow([['assistant', t('compose.to.assistant')], ['owner', t('compose.to.owner')]], () => to, (v) => { to = (v as WaitingOn) || 'assistant'; });
    const ta = h('textarea', { placeholder: t('compose.placeholder'), 'aria-label': t('compose.placeholder') }) as HTMLTextAreaElement;
    const save = h('button', { class: 'db-btn primary', type: 'button', onclick: async () => {
      const body = ta.value.trim();
      if (!body && !kind) { ta.focus(); return; }
      const kindLabel = kind ? t('compose.kind.' + kind) : undefined;
      save.setAttribute('disabled', '');
      try {
        const fb = await app.ad.feedback.create({
          docId: target.item ? '' : target.docId!,
          target: target.item ? { kind: 'item', itemId: target.item.id, label: target.item.label } : sec ? { kind: 'section', heading: sec.title, ...parseKey(sec.key) } : { kind: 'doc' },
          selector: target.selector,
          body,
          kind: kindLabel,
          severity: sev || undefined,
          waitingOn: to,
          author: app.me,
          wasCollapsed: sec ? sec.el.dataset.collapsed === 'true' : undefined,
        });
        this.close();
        app.toast(t('fb.saved') + ' — ' + t('turn.' + to));
        app.emit({ type: 'feedback:created', feedback: fb });
      } catch (e) {
        save.removeAttribute('disabled');
        app.toast(t('fb.saveFail', { msg: (e as Error).message }));
      }
    } }, t('compose.save'));
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save.click(); } });
    this.show(h('div', { class: 'db-sheet' },
      h('h3', { text: t('compose.title') }), tg, kinds, ta,
      h('div', { class: 'db-row' }, h('span', { class: 'db-lbl', text: t('compose.sev') }), sevs),
      h('div', { class: 'db-row' }, h('span', { class: 'db-lbl', text: t('compose.to') }), tos),
      h('div', { class: 'db-sheet-act' }, h('button', { class: 'db-btn', type: 'button', onclick: () => this.close() }, t('compose.cancel')), save)));
    setTimeout(() => ta.focus(), 20);
  }
}
