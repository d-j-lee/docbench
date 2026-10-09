/**
 * 그 자리에서 적기 — 피드백 하나마다 화면을 덮는 창 대신, 고른 문구·섹션 옆에 작은 입력 칸(D73).
 * 저장하면 **초안**: Claude 에게는 아무것도 가지 않는다. 읽다가 생각이 바뀌면 검토 패널에서 고치고 지우고 합친다.
 *  - 요청: 무엇을 어떻게 — 자주 쓰는 말은 단추(줄이기·근거·표로·접기 …)로 넣는다
 *  - 이렇게 바꿔: 바꿀 글을 직접 쓴다(문구면 그 문구, 섹션이면 섹션 본문) — 요청 문구를 고민하지 않아도 된다
 *  - ★ 급함: 보낼 때 먼저, "★만 보내기"로 골라 보낸다
 * 적던 글은 잃지 않는다: 다른 곳에 새로 적거나 화면을 옮기면 초안으로 남기고, Esc·닫기는 한 번 더 눌러야 버린다.
 */
import type { Feedback, TextSelector } from '../types';
import { KEY_SEP, parseKey, getSectionText } from '../core/source';
import { h, icon } from './dom';
import type { App } from './app';
import type { Section } from './render';

export interface ComposeTarget {
  docId?: string;
  sec?: Section | null;
  selector?: TextSelector;
  item?: { id: string; label: string };
  /** 문서 전체 */
  whole?: boolean;
}

/** 자주 쓰는 요청 — 누르면 입력 칸에 그 말을 넣는다 (ko·en 사전의 compose.q.*) */
const QUICK = ['shorter', 'clearer', 'evidence', 'table', 'fold', 'split', 'remove', 'check'] as const;

export class Composer {
  private app: App;
  private el: HTMLElement | null = null;
  /** 아직 아무것도 적지 않았나(고치던 초안이면 처음 그대로인가) — 바깥을 누르면 그런 칸만 닫는다 */
  private pristine: () => boolean = () => true;
  /** 적던 글을 조용히 초안으로 남긴다 — 다른 곳에 새로 적거나 화면을 옮길 때 */
  private keep: () => Promise<void> = async () => {};
  /** 닫기 전 경고를 띄운 때 — 그 뒤 몇 초 안에 한 번 더 누르면 버린다 */
  private armed = 0;
  private warn: (() => void) | null = null;
  /** 칸을 열기 전 초점 — 닫으면 돌려준다 */
  private back: HTMLElement | null = null;
  /** 저장 중 — 단추·Ctrl+Enter·다른 곳에 적기·화면 옮기기가 겹쳐 같은 초안이 둘 생기지 않게 */
  private saving: Promise<void> | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.el) return;
    // 칸 안에 초점이 있을 때(또는 아무 데도 없을 때)만 — 패널의 고치던 칸·메뉴·대화 상자·대시보드의 Esc 는 그쪽 것
    const tgt = e.target as Node | null;
    const nowhere = !tgt || tgt === document.body || tgt === document.documentElement;
    if (!(tgt && this.el.contains(tgt)) && !(nowhere && !document.querySelector('dialog[open]'))) return;
    e.stopPropagation();
    this.requestClose();
  };
  private onDown = (e: Event) => {
    const el = this.el;
    if (!el || el.contains(e.target as Node) || (e.target as Element)?.closest?.('.db-selbtn, .db-act, .db-toast, dialog')) return;
    if (this.pristine()) this.close();
  };

  constructor(app: App) { this.app = app; }

  get isOpen(): boolean { return !!this.el; }

  /** 버리고 닫는다 */
  close(): void {
    this.el?.remove();
    this.el = null;
    this.armed = 0;
    this.warn = null;
    this.keep = async () => {};
    this.pristine = () => true;
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onDown, true);
    const b = this.back;
    this.back = null;
    if (b && b.isConnected && this.app.root.contains(b) && !document.querySelector('dialog[open]')) { try { b.focus({ preventScroll: true }); } catch { /* 초점 못 받는 요소 */ } }
  }

  /** Esc·닫기 — 적던 글이 있으면 한 번은 경고만(몇 초 안에 한 번 더 누르면 버린다) */
  requestClose(): void {
    if (!this.el) return;
    if (this.pristine() || (this.armed && Date.now() - this.armed < 4000)) { this.close(); return; }
    this.armed = Date.now();
    this.warn?.();
  }

  /** 적던 글을 초안으로 남기고 닫는다 — 화면을 옮기거나 다른 곳에 새로 적을 때. 빈 칸이면 그냥 닫는다 */
  async flush(): Promise<void> {
    if (this.saving) { await this.saving; return; }
    if (!this.el) return;
    if (this.pristine()) { this.close(); return; }
    const keep = this.keep;
    await keep();
  }

  /** 새 초안 또는 기존 초안 고치기. anchor = 칸을 붙일 자리(고른 글의 사각형 또는 요소) */
  open(target: ComposeTarget, anchor?: DOMRect | HTMLElement | null, existing?: Feedback): void {
    const app = this.app;
    const t = app.t;
    if (!app.can('feedback.create')) return;
    // 다른 곳에 새로 적으려 할 때 적던 글은 초안으로 남긴다(버리지 않는다)
    if (this.el || this.saving) { void this.flush().then(() => { if (!this.el) this.open(target, anchor, existing); }); return; }
    const sec = target.sec || null;
    const where = target.item ? t('view.map') + ' · ' + target.item.label
      : target.whole || !sec ? app.docTitle(target.docId!) + ' · ' + t('fb.wholeDoc')
        : sec.path.slice(-2).join(KEY_SEP);
    let mode: 'ask' | 'rewrite' = existing?.suggestion != null ? 'rewrite' : 'ask';
    let urgent = existing?.severity === 'high';
    const canRewrite = !target.item && !!sec;
    const ta = h('textarea', { class: 'db-cmp-ta', rows: 3, placeholder: t('compose.placeholder'), 'aria-label': t('compose.placeholder') }) as HTMLTextAreaElement;
    ta.value = existing?.body || '';
    // 바꿀 글: 문구면 그 문구, 섹션이면 섹션 본문(제목 줄 빼고)
    const original = target.selector?.exact ?? (sec && target.docId && app.doc?.id === target.docId ? (getSectionText(app.doc.content.md, sec.key) || '').split('\n').slice(1).join('\n').replace(/^\n+|\n+$/g, '') : '');
    const rw = h('textarea', { class: 'db-cmp-ta rw', rows: 4, 'aria-label': t('compose.rewrite') }) as HTMLTextAreaElement;
    rw.value = existing?.suggestion ?? original;
    const why = h('input', { class: 'db-cmp-why', type: 'text', placeholder: t('compose.rewrite.why') }) as HTMLInputElement;
    if (existing?.suggestion != null) why.value = existing.body;
    const quick = h('div', { class: 'db-cmp-quick' }, ...QUICK.map((q) => h('button', { class: 'db-chip', type: 'button', onclick: () => {
      const s = t('compose.q.' + q + '.text');
      ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, ' ') + s : s;
      ta.focus();
    } }, t('compose.q.' + q))));
    const askBox = h('div', { class: 'db-cmp-ask' }, quick, ta);
    const rwBox = h('div', { class: 'db-cmp-rw' }, h('div', { class: 'db-hint', text: target.selector ? t('compose.rewrite.quote') : t('compose.rewrite.section') }), rw, why);
    const tabs = h('div', { class: 'db-seg sm', role: 'tablist' });
    const star = h('button', { class: 'db-star', type: 'button', 'aria-pressed': String(urgent), title: t('fb.urgent.hint'), html: '★' }) as HTMLButtonElement;
    star.addEventListener('click', () => { urgent = !urgent; star.setAttribute('aria-pressed', String(urgent)); });
    const paint = () => {
      tabs.replaceChildren(h('button', { type: 'button', role: 'tab', 'aria-pressed': String(mode === 'ask'), onclick: () => { mode = 'ask'; paint(); ta.focus(); } }, t('compose.mode.ask')));
      if (canRewrite) tabs.append(h('button', { type: 'button', role: 'tab', 'aria-pressed': String(mode === 'rewrite'), onclick: () => { mode = 'rewrite'; paint(); rw.focus(); } }, t('compose.mode.rewrite')));
      tabs.hidden = !canRewrite;
      askBox.hidden = mode !== 'ask';
      rwBox.hidden = mode !== 'rewrite';
    };
    paint();
    /**
     * quiet = 다른 곳으로 옮기며 남기기 — 경고·포커스 없이. 두 칸(요청·바꿀 글)에 적은 것을 모두 남긴다.
     * 직접 저장은 지금 칸을 따른다: 요청 칸이면 바꿀 글은 보내지 않고, 바꿀 글 칸이면 요청 칸에 적은 말도 이유로 붙인다
     */
    const save = (sendNow: boolean, quiet = false): Promise<void> => {
      if (this.saving) return this.saving;
      const p = doSave(sendNow, quiet).finally(() => { if (this.saving === p) this.saving = null; });
      this.saving = p;
      return p;
    };
    const doSave = async (sendNow: boolean, quiet: boolean) => {
      const rwText = rw.value.replace(/\r\n?/g, '\n');
      const asRewrite = canRewrite && rwText.trim() !== original.trim() && (mode === 'rewrite' || quiet);
      const req = ta.value.trim(), w = why.value.trim();
      const body = mode === 'ask' && !asRewrite ? req : [w, req].filter(Boolean).join('\n');
      const suggestion = asRewrite ? rwText : undefined;
      if (!body && !asRewrite) {
        if (quiet) { this.close(); return; }
        (mode === 'ask' ? ta : rw).focus();
        return;
      }
      saveBtn.setAttribute('disabled', '');
      try {
        let f: Feedback;
        if (existing) {
          // null = 지운다(요청으로 바꾸면 바꿀 글을, ★ 를 끄면 급함을)
          const ok = await app.updateFeedback(existing, { body, suggestion: suggestion ?? null, severity: urgent ? 'high' : existing.severity === 'high' ? null : existing.severity ?? null });
          if (!ok) { saveBtn.removeAttribute('disabled'); return; }
          f = app.fb.find((x) => x.id === existing.id) || existing;
        } else {
          f = await app.ad.feedback.create({
            docId: target.item ? '' : target.docId!,
            target: target.item ? { kind: 'item', itemId: target.item.id, label: target.item.label } : sec && !target.whole ? { kind: 'section', heading: sec.title, ...parseKey(sec.key) } : { kind: 'doc' },
            selector: target.selector,
            body,
            ...(suggestion != null ? { suggestion } : {}),
            severity: urgent ? 'high' : undefined,
            status: 'draft',
            waitingOn: 'owner',
            author: app.me,
            wasCollapsed: sec ? sec.el.dataset.collapsed === 'true' : undefined,
          });
          app.noteFeedback(f);
          app.emit({ type: 'feedback:created', feedback: f });
          app.panel.select(f.id);
        }
        this.close();
        if (sendNow) await app.sendDrafts([f.id]);
        else app.toast(t(quiet ? 'fb.draft.kept' : existing ? 'fb.draft.updated' : 'fb.draft.saved'), { action: t('fb.draft.see'), onAction: () => app.panel.open(undefined, 'draft') });
      } catch (e) {
        saveBtn.removeAttribute('disabled');
        app.toast(t('fb.saveFail', { msg: (e as Error).message }));
      }
    };
    const saveBtn = h('button', { class: 'db-btn sm primary', type: 'button', title: t('compose.save.hint'), onclick: () => void save(false) }, existing ? t('compose.update') : t('compose.save')) as HTMLButtonElement;
    const sendBtn = existing ? null : h('button', { class: 'db-btn sm', type: 'button', title: t('compose.sendNow.hint'), onclick: () => void save(true) }, t('compose.sendNow'));
    // 칸 어디에 초점이 있든(단추·★ 포함) Ctrl+Enter = 초안에 두기, Ctrl+Shift+Enter = 바로 보내기
    const keys = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void save(e.shiftKey && !existing); } };
    const note = h('span', { class: 'db-hint', text: t('compose.draftNote') });
    const el = h('div', { class: 'db-cmp', role: 'dialog', 'aria-label': t('compose.title') },
      h('div', { class: 'db-cmp-h' },
        h('span', { class: 'db-cmp-where', title: where }, h('span', { class: 'ic', html: icon('chat') }), where),
        star,
        h('button', { class: 'db-btn ghost sm db-cmp-x', type: 'button', 'aria-label': t('close'), onclick: () => this.requestClose(), html: icon('close') })),
      target.selector ? h('q', { class: 'db-cmp-q', text: target.selector.exact }) : null,
      tabs, askBox, rwBox,
      h('div', { class: 'db-cmp-f' },
        note,
        h('span', { class: 'db-grow' }),
        sendBtn, saveBtn));
    el.addEventListener('keydown', keys);
    this.el = el;
    const initial = { ta: ta.value, rw: rw.value, why: why.value, urgent };
    this.pristine = () => ta.value.trim() === initial.ta.trim() && rw.value === initial.rw && why.value.trim() === initial.why.trim() && urgent === initial.urgent;
    this.keep = () => save(false, true);
    this.warn = () => { note.textContent = t('compose.discard'); note.classList.add('warn'); (mode === 'rewrite' ? rw : ta).focus(); };
    el.addEventListener('input', () => { if (this.armed) { this.armed = 0; note.textContent = t('compose.draftNote'); note.classList.remove('warn'); } });
    const act = document.activeElement;
    this.back = act instanceof HTMLElement && act !== document.body ? act : null;
    this.place(anchor);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onDown, true);
    setTimeout(() => (mode === 'rewrite' ? rw : ta).focus(), 20);
  }

  /**
   * 붙일 자리 아래(보이는 곳에 자리가 없으면 위). 좁은 화면은 아래쪽 판처럼.
   * 넓은 화면은 문서 칸 안에 둔다 — 더 읽으려고 내리면 칸도 글과 함께 올라가, 그 아래 섹션(다음에 적을 곳)을 가리지 않는다
   */
  private place(anchor?: DOMRect | HTMLElement | null): void {
    const el = this.el!;
    const app = this.app;
    const root = app.root.getBoundingClientRect();
    const main = app.els.main;
    if (root.width <= 560 || !anchor || !main) { el.classList.add('sheet'); app.root.append(el); return; }
    main.append(el);
    const m = main.getBoundingClientRect();
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const w = Math.min(420, m.width - 24);
    el.style.width = w + 'px';
    el.style.left = Math.max(12, Math.min(r.left - m.left, m.width - w - 12)) + 'px';
    const h0 = el.offsetHeight || 300;
    const below = r.bottom - m.top + 8;
    const above = r.top - m.top - h0 - 8;
    // 화면 안에서 아래에 들어가면 아래, 아니면 위에 들어가면 위, 둘 다 아니면 아래(보이게 내린다)
    const y = below + h0 <= m.height || above < 0 ? below : above;
    el.style.top = (y + main.scrollTop) + 'px';
    el.scrollIntoView({ block: 'nearest' });
  }
}
