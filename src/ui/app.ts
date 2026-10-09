/**
 * 작업대 본체 — 골격·데이터·이동·상단 바·레일·단축키.
 */
import type { Action, AskOptions, DocBenchAdapters, DocBenchEvent, DocBenchOptions, DocEvent, Feedback, FeedbackPatch, Manifest, Person, ReadingPlan, RunnerInfo, RunStartInput, RunStatus, SendVia, Unsubscribe, ViewState } from '../types';
import { normalizeFeedback, countTurns, turnOf, isMyDraft } from '../core/feedback';
import { compileRules, countPlaceholders, type Compiled } from './render';
import { h, $, fmtTime, debounce, icon } from './dom';
import { makeT, type T } from './i18n';
import { DocView } from './docview';
import { Panel } from './panel';
import { Dialogs } from './dialogs';
import { renderMap, revealItems } from './mapview';
import { renderChanges } from './changes';
import { RunDock } from './runs';
import { Hover } from './hover';
import { Explorer } from './explorer';
import { Composer } from './composer';
import { terminalHandoffPrompt, RUN_MAX_DOCS } from '../core/runs';
import { KEY_SEP } from '../core/source';
import cssText from './styles.css';

const STYLE_ID = 'docbench-styles';

export class App {
  readonly root: HTMLElement;
  readonly opts: DocBenchOptions;
  readonly ad: DocBenchAdapters;
  t: T;
  ai = 'AI';
  manifest!: Manifest;
  rules!: Compiled;
  state: ViewState = { v: 1, updatedAt: 0, docs: {} };
  fb: Feedback[] = [];
  fbMode: 'pending' | 'live' | 'poll' | 'local' | 'error' = 'pending';
  me: Person = { kind: 'human' };
  perms = new Set<Action>();
  view: string | null = null;
  doc: DocView | null = null;
  todo: Record<string, number> = {};
  changedDocs = new Set<string>();
  els!: { bar: HTMLElement; rail: HTMLElement; main: HTMLElement; page: HTMLElement; panel: HTMLElement; toast: HTMLElement; selbtn: HTMLButtonElement };
  panel!: Panel;
  dialogs!: Dialogs;
  /** Claude 작업 창 (어댑터에 runs 가 있을 때만) */
  dock: RunDock | null = null;
  /** 그 자리에서 적기 */
  composer!: Composer;
  hover!: Hover;
  /** 탐색기 (어댑터에 docs.tree 가 있을 때만 — 펼친 폴더만 읽는다) */
  explorer: Explorer | null = null;
  /** 보이는 범위 (DocBenchOptions.scope) — '' = 작업 공간 전부 */
  scope = '';
  private lastTodo = '';
  private unsubs: Unsubscribe[] = [];
  private stateKey = 'docbench:view';
  private toastT: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(root: HTMLElement, opts: DocBenchOptions) {
    this.root = root;
    this.opts = opts;
    this.ad = opts.adapters;
    this.scope = (opts.scope || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    this.t = makeT(opts.locale || 'ko', { ai: this.ai });
    if (opts.injectStyles !== false) injectStyles(opts.styleNonce);
    this.buildShell();
    this.composer = new Composer(this);
  }

  // ------------------------------------------------------------ 시작·정리
  async start(): Promise<void> {
    try {
      this.manifest = await this.ad.docs.manifest();
    } catch (e) {
      // 열쇠가 없거나 틀린 주소 — 시스템 말(UNAUTHORIZED) 대신 어떻게 여는지
      const unauth = (e as { status?: number })?.status === 401 || /UNAUTHORIZED/.test(String((e as Error)?.message));
      this.els.page.replaceChildren(h('p', { class: 'db-notice tone-bad', text: unauth ? this.t('doc.needKey') : this.t('doc.loadFail', { msg: (e as Error).message }) }));
      this.emit({ type: 'error', message: 'manifest', error: e });
      return;
    }
    this.ai = this.manifest.assistantName || this.ad.assistant?.name || 'AI';
    this.t = makeT(this.opts.locale || 'ko', { ai: this.ai });
    this.rules = compileRules(this.manifest.render);
    this.stateKey = 'docbench:view:' + this.manifest.project.name;
    if (this.ad.docs.tree) this.explorer = new Explorer(this);
    this.loadLocalState();
    await this.loadIdentity();
    if (this.dock && !this.can('assistant.run')) { this.dock.el.remove(); this.dock = null; }
    this.buildPanel();
    this.renderBar();
    this.renderRail();
    this.subscribe();
    // 다른 기기·브라우저에서 저장한 보기 상태를 먼저 받는다 (첫 이동이 로컬 시각을 새로 찍어 원격을 덮지 않게).
    // 저장소가 느리면 오래 기다리지 않는다.
    await Promise.race([this.loadRemoteState(), new Promise((r) => setTimeout(r, 1200))]);
    void this.countTodos();
    if (this.dock) void this.dock.start();
    const hash = this.opts.routing !== 'none' ? hashView() : '';
    await this.navigate(await this.startView([hash, this.opts.initialDoc, this.state.last]));
    if (this.opts.routing !== 'none') {
      const onHash = () => { const k = hashView(); if (k && k !== this.view) void this.navigate(k); };
      window.addEventListener('hashchange', onHash);
      this.unsubs.push(() => window.removeEventListener('hashchange', onHash));
    }
    // 창으로 돌아오면 펼친 폴더를 다시 읽는다(탐색기에서 파일을 만들거나 지웠을 수 있다 — 큰 폴더는 감시하지 않는다)
    const onFocus = () => { if (this.explorer && !this.destroyed) { this.explorer.invalidate(); this.renderRail(); } };
    window.addEventListener('focus', onFocus);
    this.unsubs.push(() => window.removeEventListener('focus', onFocus));
  }

  destroy(): void {
    this.destroyed = true;
    // 적는 칸의 문서 전역 듣기(Esc·바깥 누르기)를 걷는다 — 다음 작업대의 Esc 를 가로채지 않게
    this.composer?.close();
    this.dock?.destroy();
    for (const u of this.unsubs.splice(0)) { try { u(); } catch { /* 이미 끊김 */ } }
    this.doc?.destroy();
    this.root.replaceChildren();
    this.root.classList.remove('docbench');
  }

  /** 처음 열 문서: 범위 안의 첫 문서. 없으면(큰 폴더의 맨 위 등) 작업 공간 첫 화면 */
  private firstDoc(): string {
    for (const g of this.manifest.groups) for (const d of g.docs) if (this.inScope(d)) return d;
    return Object.keys(this.manifest.docs).find((d) => this.inScope(d)) || (this.explorer ? 'home' : 'map');
  }

  /**
   * 처음 열 화면: 주소의 #문서 → 호스트가 준 문서 → 지난번 문서 → 첫 문서. 목록에 없는 문서(큰 폴더의 깊은 곳)는
   * 그 폴더를 읽어 정말 있을 때만 — 다른 작업 공간의 주소·지난 기록이 남아 "없는 문서"를 열지 않게.
   */
  private async startView(cands: (string | undefined)[]): Promise<string> {
    for (const v of cands) {
      if (!v) continue;
      if (v === 'map' || v === 'changes' || v === 'home') return v;
      // 범위(대시보드 탭의 프로젝트)를 벗어난 문서는 열지 않는다 — 지난 문서가 다른 탭의 것일 수 있다
      if (!this.inScope(v)) continue;
      if (v in this.manifest.docs) return v;
      if (!this.looksDoc(v)) continue;
      const dir = v.includes('/') ? v.slice(0, v.lastIndexOf('/')) : '';
      try { if ((await this.ad.docs.tree!(dir))?.some((e) => e.path === v && e.doc)) return v; } catch { /* 다음 후보 */ }
    }
    return this.firstDoc();
  }

  // ------------------------------------------------------------ 범위·고정·최근
  /** 이 문서가 보이는 범위 안인가 */
  inScope(id: string | undefined): boolean { return !this.scope || !id || id === this.scope || id.startsWith(this.scope + '/'); }
  /** 범위 안의 피드백 (지도 항목 피드백은 범위가 없을 때만) */
  scopedFb(): Feedback[] { return this.scope ? this.fb.filter((f) => f.target.kind !== 'item' && this.inScope(f.docId)) : this.fb; }
  isPinned(key: string): boolean { return (this.state.pins || []).includes(key); }
  togglePin(key: string): void {
    const pins = this.state.pins || [];
    this.state.pins = pins.includes(key) ? pins.filter((x) => x !== key) : [key, ...pins].slice(0, 40);
    this.saveState();
    this.renderRail();
  }
  private noteRecent(id: string): void {
    this.state.recent = [id, ...(this.state.recent || []).filter((x) => x !== id)].slice(0, 12);
  }
  /** 목록에 없던 문서(큰 폴더에서 나무로 찾은 것)도 열 수 있게 자리를 만든다 */
  private ensureDocMeta(id: string): void {
    if (this.manifest.docs[id]) return;
    const file = id.split('/').pop() || id;
    this.manifest.docs[id] = { title: file.replace(/\.(md|markdown)$/i, ''), source: { path: id } };
  }
  /** 문서처럼 보이는 id (나무가 있는 어댑터에서 목록 밖 문서를 열 때) */
  private looksDoc(id: string): boolean { return !!this.explorer && /\.(md|markdown)$/i.test(id) && !/(^|\/)\.\.(\/|$)/.test(id); }

  /** 사람 이름 — 내 것이면 "나"(또는 내 별명), 남이면 별명, 없으면 "사용자 xxxx" */
  personLabel(p: Person | undefined): string {
    if (!p) return '';
    if (p.kind === 'assistant') return p.name || this.ai;
    if (p.kind === 'external') return this.t('changes.external');
    if (p.id && this.me.id && p.id === this.me.id) return this.me.name || this.t('me');
    if (p.name) return p.name;
    return p.id ? this.t('person.anon', { id: p.id.replace(/^u-/, '').slice(-4) }) : this.t('fb.by.me');
  }

  // ------------------------------------------------------------ 골격
  private buildShell(): void {
    const r = this.root;
    r.classList.add('docbench');
    r.dataset.theme = this.opts.theme || 'auto';
    r.tabIndex = -1;
    r.replaceChildren();
    const bar = h('header', { class: 'db-bar' });
    const rail = h('nav', { class: 'db-rail', 'aria-label': 'documents' });
    const page = h('div', { class: 'db-page' }, h('p', { class: 'db-loading', text: this.t('doc.loading') }));
    const selbtn = h('button', { class: 'db-btn primary sm db-selbtn', type: 'button', hidden: true, text: this.t('compose.selection') }) as HTMLButtonElement;
    const main = h('main', { class: 'db-main' }, page, selbtn);
    const panel = h('aside', { class: 'db-panel', 'aria-label': 'feedback' });
    const scrim = h('div', { class: 'db-scrim', onclick: () => r.classList.remove('rail-open', 'panel-open') });
    const toast = h('div', { class: 'db-toast', role: 'status', 'aria-live': 'polite', hidden: true });
    const shell = h('div', { class: 'db-shell' }, rail, main, panel, scrim);
    r.append(bar, shell, toast);
    this.els = { bar, rail, main, page, panel, toast, selbtn };
    toast.addEventListener('mouseenter', () => clearTimeout(this.toastT));
    toast.addEventListener('mouseleave', () => { if (!toast.hidden && !toast.dataset.sticky) this.toastT = setTimeout(() => { toast.hidden = true; }, 1500); });
    if (this.ad.runs) { this.dock = new RunDock(this); shell.append(this.dock.el); }
    this.dialogs = new Dialogs(this);
    this.hover = new Hover(this);
    this.bindKeys();
  }

  private buildPanel(): void {
    this.panel = new Panel(this, this.els.panel);
  }

  // ------------------------------------------------------------ 사용자·권한
  private async loadIdentity(): Promise<void> {
    const all: Action[] = ['doc.edit', 'feedback.create', 'feedback.update', 'feedback.delete', 'assistant.propose', 'assistant.notify', 'assistant.run'];
    const id = this.ad.identity;
    if (id) {
      try { this.me = await id.me(); } catch { /* 익명 */ }
      for (const a of all) { try { if (await id.can(a)) this.perms.add(a); } catch { /* 거부로 본다 */ } }
    } else all.forEach((a) => this.perms.add(a));
    if (!this.ad.docs.save) this.perms.delete('doc.edit');
    if (!this.ad.assistant) this.perms.delete('assistant.propose');
    if (!this.ad.notifier) this.perms.delete('assistant.notify');
    if (!this.ad.runs) this.perms.delete('assistant.run');
    if (this.opts.features?.edit === false) this.perms.delete('doc.edit');
  }
  can(a: Action): boolean { return this.perms.has(a); }

  // ------------------------------------------------------------ 구독
  private subscribe(): void {
    const store = this.ad.feedback;
    let first = true;
    this.unsubs.push(store.subscribe(
      (rows) => {
        this.fbMode = store.mode ? store.mode() : 'local';
        // 남의 초안은 보이지 않는다 — 보내기 전까지는 그 사람만의 메모(함께 쓰는 기록 폴더)
        this.fb = rows.map((r) => normalizeFeedback(r as unknown as Record<string, unknown>, r.id)).filter((f) => f.status !== 'draft' || isMyDraft(f, this.me));
        this.onFeedback(first);
        first = false;
      },
      (e) => { this.fbMode = 'error'; this.toast(this.t('err.generic', { msg: e.message })); this.renderRail(); },
    ));
    if (this.ad.docs.subscribe) this.unsubs.push(this.ad.docs.subscribe((ev) => this.onDocEvent(ev)));
  }

  private onFeedback(_first: boolean): void {
    this.renderBar();
    this.renderRail();
    this.doc?.anchorFeedback();
    this.panel.render();
    if (this.view === 'map') renderMap(this, true);
  }

  private onDocEvent(ev: DocEvent): void {
    if (this.destroyed) return;
    if (ev.type === 'manifest') {
      void this.ad.docs.manifest().then((m) => {
        // 나무로 찾아 연 문서(목록 밖)는 자리를 남긴다
        if (this.view && this.manifest.docs[this.view] && !m.docs[this.view]) m.docs[this.view] = this.manifest.docs[this.view];
        this.manifest = m; this.rules = compileRules(m.render); this.explorer?.invalidate(); this.renderRail(); void this.countTodos();
      });
    } else if (ev.type === 'doc' && ev.id) {
      this.todoDirty(ev.id);
      if (this.doc && this.doc.id === ev.id) void this.doc.onExternalChange();
      else if (this.manifest.docs[ev.id]) { this.changedDocs.add(ev.id); this.renderRail(); }
      else if (this.explorer) { this.explorer.invalidate(); this.renderRail(); }
    } else if (ev.type === 'changes' && this.view === 'changes') void renderChanges(this);
    else if (ev.type === 'runs' || ev.type === 'runner') this.dock?.onEvent(ev.type);
  }

  // ------------------------------------------------------------ 보기 상태
  private loadLocalState(): void {
    try {
      const raw = localStorage.getItem(this.stateKey);
      if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    } catch { /* 저장소 막힘 */ }
  }
  private async loadRemoteState(): Promise<void> {
    if (!this.ad.viewState) return;
    try {
      const remote = await this.ad.viewState.load();
      if (remote && (remote.updatedAt || 0) > (this.state.updatedAt || 0)) {
        this.state = { ...this.state, ...remote };
        try { localStorage.setItem(this.stateKey, JSON.stringify(this.state)); } catch { /* 무시 */ }
        if (this.doc) this.doc.applyFolds();
        this.renderRail();
      }
    } catch { /* 원격 없음 */ }
  }
  private pushRemote = debounce(() => { void this.ad.viewState?.save(JSON.parse(JSON.stringify(this.state))).catch(() => undefined); }, 1500);
  saveState(): void {
    this.state.updatedAt = Date.now();
    try { localStorage.setItem(this.stateKey, JSON.stringify(this.state)); } catch { /* 무시 */ }
    this.pushRemote();
  }
  docState(id: string) { return (this.state.docs[id] ||= {}); }

  // ------------------------------------------------------------ 빈칸 집계
  /**
   * 레일의 빈칸 수·"바뀜" 표시. 문서를 읽어야 해서 **이미 본 문서·피드백이 있는 문서·고정한 문서**만 센다(D64) —
   * 큰 폴더에서 모든 문서를 읽지 않게. 문서가 적으면(60개 이하) 전부. 저장소를 몰아치지 않게 4개씩, 300개까지.
   */
  private async countTodos(): Promise<void> {
    const all = Object.keys(this.manifest.docs).filter((d) => this.inScope(d));
    const tracked = new Set([...Object.keys(this.state.docs || {}), ...this.fb.map((f) => f.docId).filter(Boolean), ...(this.state.pins || []), ...(this.state.recent || [])]);
    const ids = (all.length <= 60 ? all : all.filter((d) => tracked.has(d))).slice(0, 300);
    let next = 0;
    const worker = async () => {
      while (next < ids.length && !this.destroyed) {
        const id = ids[next++];
        try {
          const d = await this.ad.docs.load(id);
          this.todo[id] = countPlaceholders(d.md, this.rules);
          // 마지막으로 본 뒤 바뀐 문서는 목록에 표시 (연 적 없는 문서는 표시하지 않는다)
          const seen = this.state.docs[id]?.lastSeen;
          if (seen && seen !== d.version && id !== this.view) this.changedDocs.add(id);
        } catch { /* 건너뜀 */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (!this.destroyed) this.renderRail();
  }
  private todoQueue = new Set<string>();
  private todoFlush = debounce(() => {
    const ids = [...this.todoQueue];
    this.todoQueue.clear();
    void Promise.all(ids.map((id) => this.ad.docs.load(id).then((d) => { this.todo[id] = countPlaceholders(d.md, this.rules); }).catch(() => undefined))).then(() => this.renderRail());
  }, 600);
  private todoDirty(id: string): void { this.todoQueue.add(id); this.todoFlush(); }

  // ------------------------------------------------------------ 이동
  async navigate(view: string, opts: { section?: string; compareFrom?: string; feedbackId?: string } = {}): Promise<void> {
    if (!this.manifest) return;
    if (view !== this.view && this.composer?.isOpen) void this.composer.flush(); // 적던 글은 초안으로 남긴다
    if (this.doc?.isEditing() && view !== this.view) {
      const ok = await this.dialogs.confirm(this.t('edit.leave'));
      if (!ok) return;
    }
    if (!(view in this.manifest.docs) && this.looksDoc(view)) this.ensureDocMeta(view);
    if (!(view in this.manifest.docs) && view !== 'map' && view !== 'changes' && view !== 'home') view = this.firstDoc();
    const same = view === this.view && (this.doc || view === 'home');
    this.root.classList.remove('rail-open');
    this.els.selbtn.hidden = true;
    if (!same) {
      this.doc?.destroy();
      this.doc = null;
      this.view = view;
      this.state.last = view;
      this.saveState();
      if (this.opts.routing !== 'none' && hashView() !== view) history.replaceState(null, '', '#' + view);
      this.els.main.scrollTop = 0;
      try { this.ad.docs.focus?.(view in this.manifest.docs ? view : null); } catch { /* 선택 기능 */ }
      if (view === 'map') renderMap(this);
      else if (view === 'changes') await renderChanges(this);
      else if (view === 'home') this.renderHome();
      else {
        this.explorer?.reveal(view);
        this.doc = new DocView(this, view);
        if (await this.doc.load(opts.compareFrom)) { this.noteRecent(view); this.saveState(); }
        // 목록에 없던 문서를 열려다 못 열었으면(지난 주소·다른 폴더의 문서) 자리를 지운다
        else if (!this.manifest.docs[view]?.source?.size && this.looksDoc(view) && this.state.recent?.includes(view)) this.state.recent = this.state.recent.filter((x) => x !== view);
      }
      this.emit({ type: 'navigate', view });
    } else if (opts.compareFrom && this.doc) await this.doc.showChangedSince(opts.compareFrom, true);
    this.renderRail();
    this.panel.render();
    if (opts.section && this.doc) this.doc.reveal(opts.section);
    if (opts.feedbackId) this.panel.focus(opts.feedbackId);
  }

  // ------------------------------------------------------------ 상단 바
  renderBar(): void {
    const bar = this.els.bar;
    bar.replaceChildren();
    const m = this.manifest;
    const embedded = this.opts.chrome === 'embedded';
    bar.append(
      h('button', { class: 'db-btn ghost db-toggle nav', type: 'button', onclick: () => this.root.classList.toggle('rail-open'), text: this.t('nav.toggle') }),
      // 대시보드 탭에 끼우면 제목 줄을 줄인다(탭 이름이 이미 있다) — 지금 문서 이름만
      embedded
        ? h('div', { class: 'db-brand compact' }, h('b', { text: this.view && this.manifest?.docs[this.view] ? this.manifest.docs[this.view].title : m?.project.name || 'DocBench' }))
        : h('div', { class: 'db-brand' }, h('span', { class: 'db-logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('b', { text: m?.project.name || 'DocBench' }), m?.project.subtitle ? h('small', { text: m.project.subtitle }) : null),
      h('div', { class: 'db-grow' }),
    );
    if (!m) return;
    if (m.milestones?.length && this.opts.features?.milestones !== false) {
      const box = h('div', { class: 'db-clocks' });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (const ms of m.milestones) {
        const d = new Date(ms.date + 'T00:00:00');
        const diff = Math.round((+d - +today) / 864e5);
        if (diff < 0) continue;
        box.append(h('span', { class: 'db-clock' + (ms.kind === 'plan' ? ' plan' : ''), title: `${ms.date} · ${ms.label}${ms.source ? ' · ' + ms.source : ''}` },
          h('span', { class: 'n', text: diff === 0 ? 'D-DAY' : 'D-' + diff }), h('span', { class: 'lbl', text: ms.label })));
      }
      bar.append(box);
    }
    const c = countTurns(this.scopedFb());
    // 대시보드가 탭에 배지를 달 수 있게 — 바뀔 때만(숫자만)
    const todoSig = `${c.owner}:${c.assistant}:${c.draft}`;
    if (todoSig !== this.lastTodo) { this.lastTodo = todoSig; this.emit({ type: 'todo', owner: c.owner, assistant: c.assistant, draft: c.draft }); }
    const pill = (cls: string, ic: 'edit' | 'eye', label: string, n: number, f: 'draft' | 'review') =>
      h('button', { class: 'db-pill ' + cls + (n ? '' : ' zero'), type: 'button', title: label, 'aria-label': `${label} ${n}`, onclick: () => this.panel.open(undefined, f) },
        h('span', { class: 'ic', html: icon(ic) }), h('span', { class: 'lbl', text: label }), h('span', { class: 'n', text: n }));
    bar.append(h('div', { class: 'db-turns' },
      pill('draft', 'edit', this.t('pill.draft'), c.draft, 'draft'),
      pill('owner', 'eye', this.t('pill.review'), c.owner, 'review')));
    if (this.dock) {
      const a = this.dock.activeRun();
      const av = this.dock.availability;
      const st = a ? (this.dock.isTerminal(a) ? 'terminal' : a.state) : av && !av.available && !this.ad.runs?.startTerminal ? 'off' : 'idle';
      const lb = this.t(st === 'off' ? 'run.bar.offFull' : 'run.bar.' + st);
      // 좁은 화면에서는 글을 접고 그림·도는 표시만 — 그래서 이름은 aria-label 로도 둔다
      bar.append(h('button', { class: 'db-btn db-claude ' + st, type: 'button', 'aria-pressed': String(this.dock.isOpen), 'aria-label': lb, title: av?.message || this.t('run.bar.hint'), onclick: () => this.dock!.toggle() },
        st === 'running' ? h('span', { class: 'db-spin' }) : h('span', { class: 'ic', html: icon('spark') }),
        h('span', { class: 'lb', text: lb }), h('span', { class: 'sh', text: 'Claude' }),
        a ? h('span', { class: 'clk', text: '' }) : null));
    }
    bar.append(this.meButton());
    bar.append(h('button', { class: 'db-btn ghost db-toggle panel', type: 'button', onclick: () => { this.root.classList.toggle('panel-open'); this.panel.render(); }, text: this.t('panel.toggle') }));
  }

  /** 오른쪽 위 "나" — 누르면 표시 이름(별명)과 계정을 본다. 처음에 이름을 묻지 않는다(D63) */
  private meButton(): HTMLElement {
    const label = this.me.name || this.t('me');
    const initial = (this.me.name || '').trim().slice(0, 1).toUpperCase();
    return h('button', { class: 'db-me', type: 'button', title: this.t('me.title'), 'aria-haspopup': 'dialog', onclick: () => void this.editMe() },
      initial ? h('span', { class: 'av', text: initial }) : h('span', { class: 'av', html: icon('user') }),
      h('span', { class: 'n', text: label }));
  }

  /** 표시 이름 바꾸기 — 계정(id)은 그대로라 예전 피드백도 계속 "내 것" */
  async editMe(): Promise<void> {
    const t = this.t;
    const id = this.ad.identity;
    const src = id?.source || 'host';
    const acct = src === 'browser' ? t('me.acct.browser', { id: this.me.id || '' }) : src === 'pc' ? t('me.acct.pc', { id: this.me.id || '' }) : t('me.acct.host');
    const name = await this.dialogs.prompt({ title: t('me.title'), label: t('me.name'), value: this.me.name || '', placeholder: t('me.name.ph'), note: acct + ' ' + t(id?.setName ? 'me.note' : 'me.note.fixed'), ok: t('me.save'), readOnly: !id?.setName });
    if (name == null || !id?.setName) return;
    try {
      this.me = await id.setName(name);
      this.renderBar(); this.panel.render(); this.renderRail();
      this.toast(t('me.saved'));
    } catch (e) { this.toast(t('err.generic', { msg: (e as Error).message })); }
  }

  /** 작업대가 묻는 짧은 선택 (DocBenchHandle.ask — 단일 HTML 의 기록 자리 고르기 등) */
  ask(o: AskOptions): Promise<string | null> { return this.dialogs.choose(o); }

  /** 문서가 아직 없는 작업 공간의 첫 화면 — 큰 폴더의 맨 위 등. 왼쪽 탐색기로 안내한다 */
  private renderHome(): void {
    const t = this.t;
    const m = this.manifest;
    const idx = m.index;
    const pins = (this.state.pins || []).filter((p) => this.inScope(p.replace(/\/$/, '')));
    const recent = (this.state.recent || []).filter((d) => this.inScope(d)).slice(0, 6);
    const go = (id: string) => h('button', { class: 'db-btn sm', type: 'button', onclick: () => void (id.endsWith('/') ? this.revealFolder(id.slice(0, -1)) : this.navigate(id)) }, id.endsWith('/') ? id : this.docTitle(id));
    this.els.page.replaceChildren(h('section', { class: 'db-home' },
      h('h1', { text: this.scope ? this.scope.split('/').pop()! : m.rootName || m.project.name }),
      h('p', { class: 'db-hint', text: t(idx && !idx.complete ? (idx.reason === 'big-root' ? 'home.big' : 'home.many') : 'home.lead', { n: idx?.docs ?? Object.keys(m.docs).length }) }),
      pins.length || recent.length ? h('div', { class: 'db-home-list' }, h('b', { text: t('rail.working') }), h('div', { class: 'db-row wrap' }, ...[...pins, ...recent.filter((r) => !pins.includes(r))].map(go))) : null,
      h('ol', { class: 'db-home-steps' }, h('li', { text: t('home.step1') }), h('li', { text: t('home.step2') }), h('li', { text: t('home.step3') }))));
  }

  /** 폴더를 나무에서 펼쳐 보이게 (고정한 폴더를 눌렀을 때) */
  async revealFolder(dir: string): Promise<void> {
    if (!this.explorer) return;
    this.explorer.reveal(dir + '/x');
    this.root.classList.add('rail-open');
    this.renderRail();
    requestAnimationFrame(() => this.els.rail.querySelector<HTMLElement>(`[title="${CSS.escape(dir + '/')}"]`)?.scrollIntoView({ block: 'center' }));
  }

  // ------------------------------------------------------------ 보내기 · 선제안 (D73·D74·D76)
  /** 어디로 보낼 수 있나 — 이 PC 의 앱(자동) · 터미널 Claude(설치 없음) · 대시보드 터미널 · 연습용 흉내 · 요청함 */
  connection(): { options: SendVia[]; current: SendVia | null; runner?: RunnerInfo } {
    const av = this.dock?.availability;
    const runs = this.ad.runs;
    const opts: SendVia[] = [];
    if (this.opts.host?.handoff) opts.push('host');
    if (runs && av?.available && av.runner) opts.push(av.runner.kind === 'demo' ? 'demo' : 'app');
    // 터미널 한 줄도 Claude 작업이다 — 맡길 권한이 없으면(작업 창도 없다) 고르지 않는다
    if (runs?.startTerminal && this.dock && this.can('assistant.run')) opts.push('terminal');
    if (!runs && this.ad.notifier && this.can('assistant.notify')) opts.push('notify');
    const want = this.state.runs?.via;
    return { options: opts, current: want && opts.includes(want) ? want : opts[0] || null, runner: av?.runner };
  }

  private runInput(base: Pick<RunStartInput, 'kind' | 'feedbackIds'> & Partial<RunStartInput>): RunStartInput {
    const s = this.state.runs || {};
    return { model: s.model || undefined, effort: (s.effort || undefined) as RunStartInput['effort'], mode: s.mode || 'auto', ...base };
  }

  /**
   * 고른 초안을 한 번에 보낸다 — 초안을 "보냄"으로 바꾸고(판 비교) Claude 작업 하나로. 시작하지 못하면 초안으로 되돌린다
   * (보냄에 남아 아무 일도 없는 것처럼 보이지 않게).
   */
  async sendDrafts(ids: string[], o: { note?: string; fromBar?: boolean } = {}): Promise<boolean> {
    const t = this.t;
    const rows = ids.map((id) => this.fb.find((f) => f.id === id)).filter((f): f is Feedback => !!f && f.status === 'draft');
    if (!rows.length) { this.toast(t('send.nothing')); return false; }
    const conn = this.connection();
    if (!conn.current) { this.toast(t('send.none'), { sticky: true }); return false; }
    // 지난 알림(초안 보기 등)이 보내기 뒤까지 남아 막대를 가리지 않게
    this.hideToast();
    // 묶음에 붙일 말은 보내기 막대에서 보낼 때만 — 카드 하나를 급히 보낼 때 다음 묶음의 말을 써 버리지 않게
    const note = (o.note ?? '').trim() || undefined;
    const sent: string[] = [];
    for (const f of rows) if (await this.updateFeedback(f, { status: 'open', waitingOn: 'assistant', drafter: null })) sent.push(f.id);
    if (!sent.length) return false;
    const docs = [...new Set(rows.map((f) => f.docId).filter(Boolean))];
    const input = this.runInput({ kind: 'handoff', feedbackIds: sent, ...(note ? { note } : {}) });
    try {
      await this.dispatch(conn.current, input, docs);
      if (o.fromBar) this.panel.clearNote();
      this.emit({ type: 'assistant:requested', feedbackIds: sent });
      this.panel.render();
      return true;
    } catch (e) {
      // 시작하지 못했다 — 내 초안으로 되돌린다(보냄에 남아 아무 일도 없는 것처럼 보이지 않게)
      for (const id of sent) { const back = await this.ad.feedback.update(id, { status: 'draft', waitingOn: 'owner', drafter: this.me.id || null }).catch(() => null); if (back) this.noteFeedback(back); }
      this.panel.render();
      this.toast(t('run.startFail', { msg: (e as Error).message }), { sticky: true });
      return false;
    }
  }

  /** Claude 에게 먼저 검토 받기 — 문서(들)·섹션을 읽고 제안·질문을 올리거나 읽기 정리를 제안한다 */
  async requestReview(o: { docIds: string[]; sections?: string[]; goal: 'suggest' | 'view'; note?: string }): Promise<boolean> {
    const conn = this.connection();
    if (!conn.current || conn.current === 'notify') { this.toast(this.t('review.none'), { sticky: true }); return false; }
    const input = this.runInput({ kind: 'review', feedbackIds: [], docIds: o.docIds.slice(0, RUN_MAX_DOCS), goal: o.goal, ...(o.sections?.length ? { sections: o.sections } : {}), ...(o.note ? { note: o.note } : {}) });
    try { await this.dispatch(conn.current, input, o.docIds); return true; } catch (e) {
      this.toast(this.t('run.startFail', { msg: (e as Error).message }), { sticky: true });
      return false;
    }
  }

  /**
   * 방금 만들거나 고친 피드백을 화면 목록에 바로 넣는다 — 저장소의 구독 알림은 늦게 올 수 있어(REST·폴더),
   * 곧바로 이어지는 일(바로 보내기)이 옛 모습을 보지 않게. 알림이 오면 그대로 덮인다
   */
  noteFeedback(f: Feedback): void {
    if (!f?.id) return;
    const visible = f.status !== 'draft' || isMyDraft(f, this.me);
    const i = this.fb.findIndex((x) => x.id === f.id);
    if (i >= 0) { if (visible) this.fb[i] = f; else this.fb.splice(i, 1); } else if (visible) this.fb.push(f);
  }

  /** 보낼 곳으로 */
  private async dispatch(via: SendVia, input: RunStartInput, docs: string[]): Promise<void> {
    const t = this.t;
    const what = input.kind === 'review' ? t('review.started') : t('send.started', { n: input.feedbackIds.length });
    if (via === 'app' || via === 'demo') {
      await this.dock!.startRun(input);
      this.toast(what, { action: t('run.open'), onAction: () => this.dock?.setOpen(true) });
      return;
    }
    if (via === 'terminal' || via === 'host') {
      const runs = this.ad.runs;
      const st = runs?.startTerminal ? await runs.startTerminal(input) : null;
      if (via === 'host') {
        // 대시보드가 자기 터미널에서 돌린다 — 넘기는 것은 id·문서 이름·칠 한 줄뿐(본문 없음, D68).
        // 켜진 Claude 대화에 넣을 한 줄(prompt)과 셸 한 줄(command) 둘 다 — 대시보드가 고른다. 다른 길로 처리되면 터미널 요청은 저절로 닫힌다
        const prompt = terminalHandoffPrompt(this.manifest.rootName || this.manifest.project.name, undefined, input.feedbackIds, { review: input.kind === 'review' });
        const command = st ? (navigator.userAgent.includes('Windows') ? st.terminal.command.pwsh : st.terminal.command.sh) : undefined;
        const r = await this.opts.host!.handoff!({ feedbackIds: input.feedbackIds, docs, prompt, ...(command ? { command } : {}) });
        if (!r?.handled) throw new Error(r?.message || t('send.host.no'));
        this.toast(r.message || t('send.host'));
        if (st) this.dock?.track(st);
        return;
      }
      if (st) { this.dock?.track(st); this.dock?.showTerminal(st, st.terminal); }
      return;
    }
    if (via === 'notify') {
      const res = await this.ad.notifier!.send({ count: input.feedbackIds.length, docs: docs.map((d) => this.docTitle(d)), feedbackIds: input.feedbackIds, ...(input.note ? { note: input.note } : {}) });
      this.toast(res.message || t(res.delivered ? 'send.done' : res.queued ? 'send.queued' : 'send.copied'), { sticky: !res.delivered });
    }
  }

  /** 선제안을 무엇으로 받을지 고르는 작은 창 */
  canReview(): boolean { const c = this.connection(); return !!c.current && c.current !== 'notify' && !!this.view && !!this.manifest.docs[this.view]; }
  async reviewMenu(_anchor?: HTMLElement): Promise<void> {
    const t = this.t;
    const id = this.view;
    if (!id || !this.manifest.docs[id]) return;
    const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/') + 1) : '';
    const siblings = Object.keys(this.manifest.docs).filter((d) => this.inScope(d) && (dir ? d.startsWith(dir) && !d.slice(dir.length).includes('/') : !d.includes('/')));
    const cur = this.doc?.current;
    const r = await this.dialogs.review({
      doc: this.docTitle(id),
      section: cur && cur.level > 1 ? cur.path.slice(-2).join(' › ') : undefined,
      folder: siblings.length > 1 ? { name: dir || this.manifest.rootName || '/', n: Math.min(siblings.length, RUN_MAX_DOCS) } : undefined,
    });
    if (!r) return;
    const docIds = r.scope === 'folder' ? siblings.slice(0, RUN_MAX_DOCS) : [id];
    await this.requestReview({ docIds, goal: r.goal, ...(r.scope === 'section' && cur ? { sections: [cur.key] } : {}), ...(r.note ? { note: r.note } : {}) });
  }

  /**
   * Claude 의 읽기 정리(접을 곳·볼 곳·안내)를 내 화면에 — 문서는 그대로. navigate=false 면 지금 문서에 머문다.
   * 아직 확인하지 않은 바뀐 섹션(과 그것을 품은 섹션)은 접지 않는다 — 바뀐 글이 접혀 숨지 않게. run = 볼 것에서 지울 작업
   */
  async applyReadingPlan(p: ReadingPlan | ReadingPlan[], o: { navigate?: boolean; run?: string } = {}): Promise<void> {
    const plans = (Array.isArray(p) ? p : [p]).filter((x) => this.manifest.docs[x.docId]);
    if (o.run) this.dismissReadingPlan(o.run, false);
    if (!plans.length) return;
    // 먼저 그 문서로 — 연 문서라야 확인 안 한 바뀐 섹션을 안다(접지 않을 곳)
    const here = plans.find((x) => x.docId === this.view) || plans[0];
    if (this.view !== here.docId && o.navigate !== false) await this.navigate(here.docId, here.focus?.[0] ? { section: here.focus[0] } : undefined);
    let folded = 0;
    for (const x of plans) {
      const st = this.docState(x.docId);
      if (!st.foldsBefore) st.foldsBefore = { ...(st.folds || {}) };
      const folds = { ...(st.folds || {}) };
      const changed = this.doc?.id === x.docId ? this.doc.changedKeys() : [];
      const holdsChange = (k: string) => changed.some((c) => c === k || c.startsWith(k + KEY_SEP));
      for (const k of x.fold) if (!holdsChange(k)) { folds[k] = true; folded++; }
      for (const k of x.focus || []) folds[k] = false;
      st.folds = folds;
      st.guide = x.guide;
    }
    this.saveState();
    if (this.view === here.docId) { this.doc?.applyFolds(); this.doc?.showGuide(); if (here.focus?.[0]) this.doc?.reveal(here.focus[0]); }
    this.panel?.render();
    this.toast(this.t(plans.length > 1 ? 'view.applied.n' : 'view.applied', { n: folded, docs: plans.length }), { action: this.t('view.undo'), onAction: () => plans.forEach((x) => this.undoReadingPlan(x.docId)) });
  }
  /** 볼 것의 읽기 정리를 치운다(적용했거나 필요 없다고 했거나) — 최근 50개만 기억 */
  dismissReadingPlan(run: string, render = true): void {
    const s = (this.state.runs ||= {});
    const seen = s.viewSeen || [];
    if (!seen.includes(run)) s.viewSeen = [run, ...seen].slice(0, 50);
    this.saveState();
    if (render) this.panel?.render();
  }
  /** 볼 것에 남은(아직 적용·치우지 않은) 읽기 정리 작업 */
  pendingReadingPlans(): RunStatus[] {
    const seen = new Set(this.state.runs?.viewSeen || []);
    // 내가 부탁한 것만 — 함께 쓰는 기록 폴더에서 남이 받은 읽기 정리가 내 화면을 접지 않게
    return (this.dock?.recent || []).filter((r) => r.state === 'done' && r.kind === 'review' && !!r.view?.length && !seen.has(r.id) && this.isMine(r) && r.view.some((x) => !!this.manifest.docs[x.docId]));
  }
  /** 내가 맡긴 작업인가 — 누가 맡겼는지 모르면(연습 공간·예전 기록) 내 것으로 본다 */
  isMine(r: RunStatus): boolean {
    const by = r.by?.id;
    return !by || !this.me.id || by === this.me.id;
  }
  undoReadingPlan(docId: string): void {
    const st = this.docState(docId);
    if (st.foldsBefore) st.folds = st.foldsBefore;
    delete st.foldsBefore; delete st.guide;
    this.saveState();
    if (this.doc?.id === docId) { this.doc.applyFolds(); this.doc.showGuide(); }
  }

  /** 늘 지킬 지시(기록 폴더 instructions.md) 고치기 */
  async editStanding(): Promise<void> {
    const ins = this.ad.instructions;
    if (!ins) return;
    const t = this.t;
    let cur = '';
    try { cur = await ins.load(); } catch { /* 처음 */ }
    const v = await this.dialogs.prompt({ title: t('standing.title'), label: t('standing.label'), value: cur, placeholder: t('standing.ph'), note: t('standing.note'), ok: t('standing.save'), multiline: true });
    if (v == null) return;
    try { await ins.save(v); this.toast(t('standing.saved')); } catch (e) { this.toast(t('err.generic', { msg: (e as Error).message })); }
  }

  // ------------------------------------------------------------ 레일
  /**
   * 왼쪽 목록: 위는 도구(Claude 작업·변경 이력·폴더 지도), 아래는 문서.
   * 문서는 작업 폴더의 실제 폴더 구조 그대로(탐색기처럼) — 문서가 없는 폴더도 흐리게 보이고 누르면 폴더 지도에서 연다.
   * config.json 에 그룹을 적었으면 그 그룹이 먼저, 나머지는 폴더 나무.
   */
  renderRail(): void {
    if (!this.manifest) return;
    const rail = this.els.rail;
    const keepScroll = rail.scrollTop;
    rail.replaceChildren();
    const t = this.t;
    const per: Record<string, { owner: number; assistant: number; draft: number }> = {};
    for (const f of this.scopedFb()) {
      const tt = turnOf(f);
      const k = f.target.kind === 'item' ? '#map' : f.docId;
      per[k] ||= { owner: 0, assistant: 0, draft: 0 };
      if (tt === 'owner' || tt === 'assistant' || tt === 'draft') per[k][tt]++;
    }
    const feats = this.opts.features || {};
    const busy = this.dock?.busyDocs() || new Set<string>();
    const waiting = this.dock?.waitingDocs() || new Map<string, RunStatus>();
    const dots = (key: string) => {
      const box = h('span', { class: 'db-dots' });
      const cnt = per[key];
      if (busy.has(key)) box.append(h('span', { class: 'db-spin sm', title: t('doc.busy') }));
      else if (waiting.has(key)) box.append(h('span', { class: 'ic db-wait-ic', title: t('doc.waitingTerminal'), html: icon('clock') }));
      if (cnt?.draft) box.append(h('span', { class: 'db-dot draft', title: t('turn.draft'), text: cnt.draft }));
      if (cnt?.assistant) box.append(h('span', { class: 'db-dot assistant', title: t('turn.assistant'), text: cnt.assistant }));
      if (cnt?.owner) box.append(h('span', { class: 'db-dot owner', title: t('turn.owner'), text: cnt.owner }));
      if (this.todo[key]) box.append(h('span', { class: 'db-dot todo', title: t('doc.todos'), text: this.todo[key] }));
      if (this.changedDocs.has(key)) box.append(h('span', { class: 'db-dot chg', title: t('rail.changed'), text: t('rail.changed.short') }));
      return box;
    };
    /** 폴더 아래 피드백 수 (접힌 폴더에서도 어디에 일이 있는지 보이게) */
    const dirDots = (dir: string): HTMLElement | null => {
      let a = 0, o = 0;
      for (const [k, v] of Object.entries(per)) if (k.startsWith(dir + '/')) { a += v.assistant; o += v.owner; }
      if (!a && !o) return null;
      return h('span', { class: 'db-dots' }, a ? h('span', { class: 'db-dot assistant soft', title: t('turn.assistant'), text: a }) : null, o ? h('span', { class: 'db-dot owner soft', title: t('turn.owner'), text: o }) : null);
    };

    // ---- 작업 공간 (이름 — 누르면 폴더 열기·바꾸기·기록 자리)
    rail.append(this.workspaceHead());

    // ---- 문서 줄 (나무·작업 중에서 함께 쓴다)
    const docRow = (id: string, depth: number, o: { pin?: boolean } = {}) => {
      const meta = this.manifest.docs[id];
      const file = id.split('/').pop() || id;
      const stem = file.replace(/\.(md|markdown)$/i, '');
      const title = meta?.title || stem;
      const b = h('button', { class: 'db-nav', type: 'button', style: `--d:${depth}`, title: id, role: 'treeitem', 'aria-current': this.view === id ? 'page' : null, onclick: () => void this.navigate(id) },
        h('span', { class: 'ic', html: icon('doc') }),
        h('span', { class: 't' }, h('span', { text: title }), title !== stem ? h('small', { text: file }) : null),
        dots(id));
      const row = o.pin === false ? b : h('div', { class: 'db-tree-row', style: `--d:${depth}` }, b, this.explorer ? this.explorer.pinButton(id, this.isPinned(id)) : null);
      const out: HTMLElement[] = [row];
      if (this.view === id && this.doc && feats.outline !== false) { const ol = this.doc.outline(); if (ol) { ol.style.setProperty('--d', String(depth)); out.push(ol); } }
      return out;
    };

    // ---- 작업 중 (고정한 폴더·문서 + 최근에 연 문서) — 큰 폴더에서도 자주 쓰는 곳으로 바로
    const pins = (this.state.pins || []).filter((p) => this.inScope(p.replace(/\/$/, '')));
    const recent = (this.state.recent || []).filter((d) => this.inScope(d) && !pins.includes(d) && d !== this.view).slice(0, 5);
    if (this.explorer && (pins.length || recent.length)) {
      const box = h('div', { class: 'db-working', role: 'group', 'aria-label': t('rail.working') }, h('div', { class: 'db-rail-h', text: t('rail.working') }));
      for (const p of pins) {
        if (p.endsWith('/')) {
          const dir = p.slice(0, -1);
          box.append(h('div', { class: 'db-tree-row' },
            h('button', { class: 'db-dir pinned', type: 'button', title: p, onclick: () => void this.revealFolder(dir) },
              h('span', { class: 'ic', html: icon('folder') }), h('span', { class: 't', text: dir.split('/').pop() || dir }), dirDots(dir)),
            this.explorer.pinButton(p, true)));
        } else box.append(...docRow(p, 0).slice(0, 1));
      }
      for (const d of recent) box.append(h('div', { class: 'db-recent' }, ...docRow(d, 0, { pin: false }).slice(0, 1)));
      rail.append(box);
    }

    // ---- 도구
    const views = new Set<string>();
    for (const g of this.manifest.groups) for (const v of g.views || []) views.add(v);
    const tool = (key: string, ic: Parameters<typeof icon>[0], label: string, onclick: () => void, pressed: boolean, extra?: HTMLElement | null) =>
      h('button', { class: 'db-tool', type: 'button', 'aria-pressed': String(pressed), 'data-tool': key, onclick }, h('span', { class: 'ic', html: icon(ic) }), h('span', { class: 't', text: label }), extra || null);
    const tools = h('div', { class: 'db-tools', role: 'group', 'aria-label': t('rail.tools') }, h('div', { class: 'db-rail-h', text: t('rail.tools') }));
    if (this.dock) {
      const a = this.dock.activeRun();
      const av = this.dock.availability;
      tools.append(tool('claude', 'spark', t('run.title'), () => this.dock!.toggle(), this.dock.isOpen,
        a ? (this.dock.isTerminal(a) ? h('span', { class: 'ic', title: t('run.bar.terminal'), html: icon('clock') }) : h('span', { class: 'db-spin sm' })) : av && !av.available ? h('span', { class: 'db-dot off', text: t('run.bar.off') }) : null));
    }
    if (views.has('changes') && feats.changes !== false && this.ad.docs.changes) tools.append(tool('changes', 'history', t('view.changes'), () => void this.navigate('changes'), this.view === 'changes'));
    if (views.has('map') && feats.map !== false) tools.append(tool('map', 'map', t('view.map'), () => void this.navigate('map'), this.view === 'map', per['#map'] ? dots('#map') : null));
    if (tools.childElementCount > 1) rail.append(tools);

    // ---- 문서: 탐색기(펼친 폴더만 읽음) — 나무가 없는 저장소·"모음" 보기는 예전 목록
    const customGroups = this.manifest.groups.filter((g) => g.id !== '_bench' && !g.id.startsWith('dir:') && g.docs.length);
    const seg = () => h('div', { class: 'db-seg db-railview', role: 'group', 'aria-label': t('rail.view') },
      h('button', { type: 'button', 'aria-pressed': String(this.state.railView === 'groups'), onclick: () => { this.state.railView = 'groups'; this.saveState(); this.renderRail(); } }, t('rail.view.groups')),
      h('button', { type: 'button', 'aria-pressed': String(this.state.railView !== 'groups'), onclick: () => { this.state.railView = 'folder'; this.saveState(); this.renderRail(); } }, t('rail.view.folder')));
    if (this.explorer && !(customGroups.length && this.state.railView === 'groups')) {
      const idx = this.manifest.index;
      const box = h('div', { class: 'db-docs' },
        h('div', { class: 'db-rail-h' }, h('span', { class: 'ic', html: icon('folderOpen') }), h('span', { text: t('rail.explorer') }),
          h('small', { title: idx && !idx.complete ? t(idx.reason === 'big-root' ? 'rail.index.big' : 'rail.index.many') : '', text: t(idx && !idx.complete ? 'rail.docs.countPartial' : 'rail.docs.count', { n: Object.keys(this.manifest.docs).filter((d) => this.inScope(d)).length }) })));
      if (customGroups.length) box.append(seg());
      if (idx && !idx.complete) box.append(h('div', { class: 'db-index-note', text: t(idx.reason === 'big-root' ? 'rail.index.big' : 'rail.index.many') }));
      box.append(this.explorer.render((id, d) => docRow(id, d), dirDots));
      rail.append(box);
      this.railFoot(rail);
      rail.scrollTop = keepScroll;
      return;
    }

    const docsBox = h('div', { class: 'db-docs' });
    const rootLabel = this.opts.workspace ? t('rail.explorer') : this.manifest.rootName || this.manifest.project.name;
    docsBox.append(h('div', { class: 'db-rail-h' }, h('span', { class: 'ic', html: icon('folderOpen') }), h('span', { text: rootLabel }), h('small', { text: t('rail.docs.count', { n: Object.keys(this.manifest.docs).length }) })));
    const custom = customGroups;
    // config.json 에 모음(그룹)을 적었으면 "모음 / 폴더" 를 고른다 — 폴더 = 디스크 구조 그대로, 모음 = 적어 둔 묶음
    const byFolder = !this.explorer && !!this.manifest.folders && (!custom.length || this.state.railView === 'folder');
    if (custom.length && (this.manifest.folders || this.explorer)) docsBox.append(seg());
    if (byFolder) {
      docsBox.append(this.folderTree(Object.keys(this.manifest.docs), docRow));
      rail.append(docsBox);
      this.railFoot(rail);
      rail.scrollTop = keepScroll;
      return;
    }
    const taken = new Set<string>();
    for (const g of custom) {
      const closed = this.state.groups?.[g.id] ?? !!g.collapsed;
      const list = h('div', { class: 'db-grp-list' });
      for (const d of g.docs.filter((x) => this.manifest.docs[x])) { taken.add(d); list.append(...docRow(d, 1)); }
      docsBox.append(h('div', { class: 'db-grp' + (closed ? ' closed' : '') },
        h('button', { class: 'db-grp-h', type: 'button', 'aria-expanded': String(!closed), onclick: () => { (this.state.groups ||= {})[g.id] = !closed; this.saveState(); this.renderRail(); } },
          h('span', { class: 'car', 'aria-hidden': 'true', text: '▾' }), g.label),
        g.note ? h('div', { class: 'db-grp-note', text: g.note }) : null,
        list));
    }
    const rest = Object.keys(this.manifest.docs).filter((d) => !taken.has(d));
    if (this.manifest.folders) {
      // 모음 보기: 모음에 없는 문서만 "그 밖의 문서"로 (폴더 경로를 붙여)
      if (rest.length) {
        const key = '_rest';
        const closed = this.state.groups?.[key] ?? false;
        const list = h('div', { class: 'db-grp-list' });
        for (const d of rest) list.append(...docRow(d, 1));
        docsBox.append(h('div', { class: 'db-grp' + (closed ? ' closed' : '') },
          h('button', { class: 'db-grp-h', type: 'button', 'aria-expanded': String(!closed), onclick: () => { (this.state.groups ||= {})[key] = !closed; this.saveState(); this.renderRail(); } },
            h('span', { class: 'car', 'aria-hidden': 'true', text: '▾' }), t('rail.rest')), list));
      }
    } else {
      // 폴더 정보가 없는 저장소(다른 어댑터): 예전처럼 그룹
      for (const g of this.manifest.groups.filter((x) => x.id.startsWith('dir:') || (x.id !== '_bench' && !custom.includes(x)))) {
        const ds = g.docs.filter((d) => rest.includes(d));
        if (!ds.length) continue;
        const closed = this.state.groups?.[g.id] ?? !!g.collapsed;
        const list = h('div', { class: 'db-grp-list' });
        for (const d of ds) list.append(...docRow(d, 1));
        docsBox.append(h('div', { class: 'db-grp' + (closed ? ' closed' : '') },
          h('button', { class: 'db-grp-h', type: 'button', 'aria-expanded': String(!closed), onclick: () => { (this.state.groups ||= {})[g.id] = !closed; this.saveState(); this.renderRail(); } },
            h('span', { class: 'car', 'aria-hidden': 'true', text: '▾' }), g.label), list));
      }
    }
    rail.append(docsBox);
    this.railFoot(rail);
    rail.scrollTop = keepScroll;
  }

  /** 왼쪽 맨 위: 작업 공간 이름. 호스트가 메뉴(DocBenchOptions.workspace)를 주면 누르면 열린다 */
  private workspaceHead(): HTMLElement {
    const m = this.manifest;
    const name = m.rootName || m.project.name;
    const menu = this.opts.workspace;
    const label = h('span', { class: 't' }, h('b', { text: name }), this.scope ? h('small', { text: this.scope }) : null);
    if (!menu) return h('div', { class: 'db-ws' }, h('span', { class: 'ic', html: icon('folderOpen') }), label);
    return h('button', { class: 'db-ws', type: 'button', 'aria-haspopup': 'menu', title: this.t('ws.menu'), onclick: (e: Event) => this.openMenu(e.currentTarget as HTMLElement, menu.items(), (id) => void menu.run(id)) },
      h('span', { class: 'ic', html: icon('folderOpen') }), label, h('span', { class: 'dn', html: icon('down') }));
  }

  /** 작은 메뉴 — 바깥을 누르거나 Esc 로 닫는다 */
  openMenu(anchor: HTMLElement, items: { id: string; label: string; hint?: string; primary?: boolean; disabled?: boolean }[], run: (id: string) => void): void {
    this.root.querySelector('.db-menu')?.remove();
    const r = anchor.getBoundingClientRect(), base = this.root.getBoundingClientRect();
    const close = () => { box.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
    const outside = (e: Event) => { if (!box.contains(e.target as Node) && e.target !== anchor) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
    const box = h('div', { class: 'db-menu', role: 'menu', style: `top:${Math.round(r.bottom - base.top + 4)}px;left:${Math.round(Math.max(8, r.left - base.left))}px` },
      ...items.map((it) => h('button', { class: 'db-menu-i' + (it.primary ? ' primary' : ''), type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => { close(); run(it.id); } },
        h('span', { class: 'l', text: it.label }), it.hint ? h('small', { text: it.hint }) : null)));
    this.root.append(box);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    (box.querySelector('button:not([disabled])') as HTMLElement | null)?.focus();
  }

  private railFoot(rail: HTMLElement): void {
    const t = this.t;
    const mode = this.fbMode;
    const st = mode === 'live' ? ['live', 'rail.storage.live'] : mode === 'poll' ? ['live', 'rail.storage.poll'] : mode === 'error' ? ['warn', 'rail.storage.error'] : mode === 'pending' ? ['', 'fb.loading'] : ['warn', 'rail.storage.local'];
    const foot = h('div', { class: 'db-rail-foot' }, h('div', { class: 'db-status ' + st[0] }, h('i'), t(st[1])));
    const where = this.manifest.project.storage;
    if (where) foot.append(h('div', { class: 'db-rail-store', title: where, text: t('rail.storage.where', { where }) }));
    for (const l of this.manifest.project.links || []) foot.append(h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: l.label + ' ↗' }));
    rail.append(foot);
  }

  /** 폴더 나무 — 폴더 먼저, 그다음 문서(탐색기 순서). 문서가 없는 폴더는 흐리게, 누르면 폴더 지도에서 */
  private folderTree(docIds: string[], docRow: (id: string, depth: number) => HTMLElement[]): HTMLElement {
    type Node = { path: string; name: string; dirs: Map<string, Node>; docs: string[]; files: number; count: number };
    const mk = (p: string): Node => ({ path: p, name: p.split('/').pop() || '', dirs: new Map(), docs: [], files: this.manifest.folders?.[p]?.files || 0, count: 0 });
    const root = mk('');
    const ensure = (p: string): Node => {
      if (!p) return root;
      let n = root;
      let acc = '';
      for (const seg of p.split('/')) { acc = acc ? acc + '/' + seg : seg; let c = n.dirs.get(seg); if (!c) { c = mk(acc); n.dirs.set(seg, c); } n = c; }
      return n;
    };
    for (const p of Object.keys(this.manifest.folders || {})) ensure(p);
    for (const id of docIds) ensure(id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '').docs.push(id);
    const count = (n: Node): number => (n.count = n.docs.length + [...n.dirs.values()].reduce((a, c) => a + count(c), 0));
    count(root);
    const t = this.t;
    const box = h('div', { class: 'db-ftree' });
    const curDir = this.view && this.manifest.docs[this.view] ? this.view.split('/').slice(0, -1).join('/') : '';
    const walk = (n: Node, depth: number) => {
      for (const c of [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
        const key = 'dir:' + c.path;
        const empty = !c.count;
        // 기본: 문서가 든 폴더는 펼침 (깊으면 지금 문서가 있는 길만)
        const dflt = depth >= 2 && !(curDir === c.path || curDir.startsWith(c.path + '/'));
        const closed = empty || (this.state.groups?.[key] ?? dflt);
        box.append(h('button', {
          class: 'db-dir' + (empty ? ' empty' : ''), type: 'button', style: `--d:${depth}`, title: empty ? t('rail.dir.empty.hint') : c.path + '/',
          'aria-expanded': empty ? null : String(!closed),
          onclick: () => { if (empty) void this.openFolderOnMap(c.path); else { (this.state.groups ||= {})[key] = !closed; this.saveState(); this.renderRail(); } },
        },
          h('span', { class: 'car', 'aria-hidden': 'true', text: empty ? '' : closed ? '▸' : '▾' }),
          h('span', { class: 'ic', html: icon(closed ? 'folder' : 'folderOpen') }),
          h('span', { class: 't', text: c.name }),
          h('small', { text: empty ? t('rail.dir.files', { n: c.files }) : String(c.count) })));
        if (!closed) walk(c, depth + 1);
      }
      for (const id of n.docs.sort((a, b) => {
        const ra = /(^|\/)readme\.md$/i.test(a) ? 0 : 1, rb = /(^|\/)readme\.md$/i.test(b) ? 0 : 1;
        return ra - rb || this.manifest.docs[a].title.localeCompare(this.manifest.docs[b].title, 'ko');
      })) box.append(...docRow(id, depth));
    };
    walk(root, 0);
    if (!box.childElementCount) box.append(h('div', { class: 'db-empty', text: t('rail.nodocs') }));
    return box;
  }

  private async openFolderOnMap(path: string): Promise<void> {
    revealItems(this, [path + '/']);
  }

  // ------------------------------------------------------------ 단축키
  private bindKeys(): void {
    const mode = this.opts.shortcuts ?? 'scoped';
    if (mode === false) return;
    const target: HTMLElement | Document = mode === 'global' ? document : this.root;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
        if (e.key === 'Escape') (el as HTMLElement).blur();
        return;
      }
      if (this.dialogs.isOpen()) return;
      const d = this.doc;
      switch (e.key) {
        case 'j': d?.step(1); break;
        case 'k': d?.step(-1); break;
        case 'o': case 'Enter': if (!d || !d.toggleCurrent()) return; break;
        case 'e': d?.editCurrent(); break;
        case 'c': d?.commentCurrent(); break;
        case '/': d?.focusFind(); break;
        case 'f': this.root.classList.toggle('panel-open'); this.panel.render(); break;
        case '1': case '2': case '3': d?.setDepthIndex(+e.key - 1); break;
        case '0': d?.setDepth(9); break;
        case '?': this.dialogs.help(); break;
        case 'Escape': this.root.classList.remove('panel-open', 'rail-open'); break;
        default: return;
      }
      e.preventDefault();
    };
    target.addEventListener('keydown', onKey as EventListener);
    this.unsubs.push(() => target.removeEventListener('keydown', onKey as EventListener));
  }

  // ------------------------------------------------------------ 공용
  /**
   * 아래 안내 한 줄. 글이 길면 그만큼 오래 두고(최대 12초), 마우스를 올리면 멈춘다.
   * sticky = 닫을 때까지 둔다(해야 할 일이 담긴 안내), action = 누를 수 있는 버튼 하나
   */
  /** weak = 알려 주기만 하는 말(다시 읽음 등) — 떠 있는 붙박이 알림(Claude 가 끝냄·보낼 수 없음)을 덮지 않는다 */
  toast(msg: string, o: { sticky?: boolean; weak?: boolean; action?: string; onAction?: () => void } = {}): void {
    const t = this.els.toast;
    if (o.weak && !t.hidden && t.dataset.sticky) return;
    const close = () => { t.hidden = true; clearTimeout(this.toastT); };
    t.replaceChildren(h('span', { class: 'm', text: msg }),
      o.action ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => { close(); o.onAction?.(); } }, o.action) : '',
      h('button', { class: 'db-toast-x', type: 'button', 'aria-label': this.t('close'), onclick: close, html: icon('close') }));
    t.hidden = false;
    if (o.sticky) t.dataset.sticky = '1'; else delete t.dataset.sticky;
    clearTimeout(this.toastT);
    if (!o.sticky) this.toastT = setTimeout(close, Math.min(12000, Math.max(3600, 2400 + msg.length * 60)));
  }
  hideToast(): void { this.els.toast.hidden = true; clearTimeout(this.toastT); }
  emit(ev: DocBenchEvent): void {
    try { this.opts.onEvent?.(ev); } catch { /* 호스트 오류는 삼킨다 */ }
    this.root.dispatchEvent(new CustomEvent('docbench:' + ev.type, { detail: ev, bubbles: true }));
  }
  async copy(text: string): Promise<boolean> {
    if (this.ad.platform?.copy) return this.ad.platform.copy(text);
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
  docTitle(id: string): string { return this.manifest.docs[id]?.title || (id === '#map' ? this.t('view.map') : id); }
  when(iso?: string): string { return fmtTime(iso); }
  find<T extends Element = HTMLElement>(sel: string): T | null { return $<T>(sel, this.root); }

  async updateFeedback(f: Feedback, patch: FeedbackPatch, toastOk?: string): Promise<boolean> {
    try {
      const out = await this.ad.feedback.update(f.id, { ...patch, updatedAt: new Date().toISOString() }, { version: f.version });
      this.noteFeedback(out);
      this.emit({ type: 'feedback:updated', feedback: out });
      if (toastOk) this.toast(toastOk);
      return true;
    } catch (e) {
      this.toast(this.t('fb.saveFail', { msg: (e as Error).message }));
      return false;
    }
  }
}

function injectStyles(nonce?: string): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  if (nonce) s.nonce = nonce;
  s.textContent = cssText;
  document.head.appendChild(s);
}

/** 주소의 #문서id — 잘못된 % 표기가 있어도 던지지 않는다 */
function hashView(): string {
  const raw = location.hash.slice(1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}
