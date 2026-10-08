/**
 * 작업대 본체 — 골격·데이터·이동·상단 바·레일·단축키.
 */
import type { Action, DocBenchAdapters, DocBenchEvent, DocBenchOptions, DocEvent, Feedback, Manifest, Person, Unsubscribe, ViewState } from '../types';
import { normalizeFeedback, countTurns, turnOf } from '../core/feedback';
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
  hover!: Hover;
  private unsubs: Unsubscribe[] = [];
  private stateKey = 'docbench:view';
  private toastT: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(root: HTMLElement, opts: DocBenchOptions) {
    this.root = root;
    this.opts = opts;
    this.ad = opts.adapters;
    this.t = makeT(opts.locale || 'ko', { ai: this.ai });
    if (opts.injectStyles !== false) injectStyles(opts.styleNonce);
    this.buildShell();
  }

  // ------------------------------------------------------------ 시작·정리
  async start(): Promise<void> {
    try {
      this.manifest = await this.ad.docs.manifest();
    } catch (e) {
      this.els.page.replaceChildren(h('p', { class: 'db-notice tone-bad', text: this.t('doc.loadFail', { msg: (e as Error).message }) }));
      this.emit({ type: 'error', message: 'manifest', error: e });
      return;
    }
    this.ai = this.manifest.assistantName || this.ad.assistant?.name || 'AI';
    this.t = makeT(this.opts.locale || 'ko', { ai: this.ai });
    this.rules = compileRules(this.manifest.render);
    this.stateKey = 'docbench:view:' + this.manifest.project.name;
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
    await this.navigate(hash || this.opts.initialDoc || this.state.last || this.firstDoc());
    if (this.opts.routing !== 'none') {
      const onHash = () => { const k = hashView(); if (k && k !== this.view) void this.navigate(k); };
      window.addEventListener('hashchange', onHash);
      this.unsubs.push(() => window.removeEventListener('hashchange', onHash));
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.dock?.destroy();
    for (const u of this.unsubs.splice(0)) { try { u(); } catch { /* 이미 끊김 */ } }
    this.doc?.destroy();
    this.root.replaceChildren();
    this.root.classList.remove('docbench');
  }

  private firstDoc(): string {
    for (const g of this.manifest.groups) if (g.docs.length) return g.docs[0];
    return Object.keys(this.manifest.docs)[0] || 'map';
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
        this.fb = rows.map((r) => normalizeFeedback(r as unknown as Record<string, unknown>, r.id));
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
      void this.ad.docs.manifest().then((m) => { this.manifest = m; this.rules = compileRules(m.render); this.renderRail(); void this.countTodos(); });
    } else if (ev.type === 'doc' && ev.id) {
      this.todoDirty(ev.id);
      if (this.doc && this.doc.id === ev.id) void this.doc.onExternalChange();
      else if (this.manifest.docs[ev.id]) { this.changedDocs.add(ev.id); this.renderRail(); }
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
  /** 레일의 빈칸 수. 문서가 많아도 저장소를 몰아치지 않게 4개씩, 300개 넘으면 연 문서만 센다 */
  private async countTodos(): Promise<void> {
    const ids = Object.keys(this.manifest.docs);
    if (ids.length > 300) return;
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
    if (this.doc?.isEditing() && view !== this.view) {
      const ok = await this.dialogs.confirm(this.t('edit.leave'));
      if (!ok) return;
    }
    if (!(view in this.manifest.docs) && view !== 'map' && view !== 'changes') view = this.firstDoc();
    const same = view === this.view && this.doc;
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
      else {
        this.doc = new DocView(this, view);
        await this.doc.load(opts.compareFrom);
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
    bar.append(
      h('button', { class: 'db-btn ghost db-toggle nav', type: 'button', onclick: () => this.root.classList.toggle('rail-open'), text: this.t('nav.toggle') }),
      h('div', { class: 'db-brand' }, h('span', { class: 'db-logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('b', { text: m?.project.name || 'DocBench' }), m?.project.subtitle ? h('small', { text: m.project.subtitle }) : null),
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
    const c = countTurns(this.fb);
    bar.append(h('div', { class: 'db-turns' },
      h('button', { class: 'db-pill owner', type: 'button', title: this.t('turn.owner'), onclick: () => this.panel.open('all', 'owner') }, h('span', { class: 'lbl', text: this.t('turn.owner') }), h('span', { class: 'n', text: c.owner })),
      h('button', { class: 'db-pill assistant', type: 'button', title: this.t('turn.assistant'), onclick: () => this.panel.open('all', 'assistant') }, h('span', { class: 'lbl', text: this.t('turn.assistant') }), h('span', { class: 'n', text: c.assistant })),
    ));
    if ((this.can('assistant.notify') || this.dock) && c.assistant > 0) {
      bar.append(h('button', { class: 'db-btn primary db-send', type: 'button', title: this.t(this.dock ? 'send.hint.run' : 'send.hint.inbox'), onclick: () => void this.handToAssistant(), text: this.t('send.label', { n: c.assistant }) }));
    }
    if (this.dock) {
      const a = this.dock.activeRun();
      const av = this.dock.availability;
      const st = a ? a.state : av && !av.available ? 'off' : 'idle';
      bar.append(h('button', { class: 'db-btn db-claude ' + st, type: 'button', 'aria-pressed': String(this.dock.isOpen), title: av?.message || this.t('run.bar.hint'), onclick: () => this.dock!.toggle() },
        st === 'running' ? h('span', { class: 'db-spin' }) : h('span', { class: 'ic', html: icon('spark') }),
        h('span', { text: this.t(st === 'off' ? 'run.bar.offFull' : 'run.bar.' + st) }),
        a ? h('span', { class: 'clk', text: '' }) : null));
    }
    bar.append(h('button', { class: 'db-btn ghost db-toggle panel', type: 'button', onclick: () => { this.root.classList.toggle('panel-open'); this.panel.render(); }, text: this.t('panel.toggle') }));
  }

  async handToAssistant(): Promise<void> {
    const rows = this.fb.filter((f) => turnOf(f) === 'assistant' && !this.dock?.activeFor(f.id));
    if (!rows.length) { this.toast(this.t('send.empty')); return; }
    // Claude 작업을 띄울 수 있으면 창에서 모델·노력을 보고 시작한다
    if (this.dock) { this.dock.handoff(rows.map((f) => f.id)); return; }
    const docs = [...new Set(rows.map((r) => this.manifest.docs[r.docId]?.title || r.docId))];
    try {
      const res = await this.ad.notifier!.send({ count: rows.length, docs, feedbackIds: rows.map((r) => r.id) });
      this.toast(res.message || this.t(res.delivered ? 'send.done' : res.queued ? 'send.queued' : 'send.copied'), { sticky: !res.delivered });
      this.emit({ type: 'assistant:requested', feedbackIds: rows.map((r) => r.id) });
    } catch (e) { this.toast(this.t('err.generic', { msg: (e as Error).message })); }
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
    const per: Record<string, { owner: number; assistant: number }> = {};
    for (const f of this.fb) {
      const tt = turnOf(f);
      const k = f.target.kind === 'item' ? '#map' : f.docId;
      per[k] ||= { owner: 0, assistant: 0 };
      if (tt === 'owner' || tt === 'assistant') per[k][tt]++;
    }
    const feats = this.opts.features || {};
    const busy = this.dock?.busyDocs() || new Set<string>();
    const dots = (key: string) => {
      const box = h('span', { class: 'db-dots' });
      const cnt = per[key];
      if (busy.has(key)) box.append(h('span', { class: 'db-spin sm', title: t('doc.busy') }));
      if (cnt?.assistant) box.append(h('span', { class: 'db-dot assistant', title: t('turn.assistant'), text: cnt.assistant }));
      if (cnt?.owner) box.append(h('span', { class: 'db-dot owner', title: t('turn.owner'), text: cnt.owner }));
      if (this.todo[key]) box.append(h('span', { class: 'db-dot todo', title: t('doc.todos'), text: this.todo[key] }));
      if (this.changedDocs.has(key)) box.append(h('span', { class: 'db-dot chg', title: t('rail.changed'), text: t('rail.changed.short') }));
      return box;
    };

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
        a ? h('span', { class: 'db-spin sm' }) : av && !av.available ? h('span', { class: 'db-dot off', text: t('run.bar.off') }) : null));
    }
    if (views.has('changes') && feats.changes !== false && this.ad.docs.changes) tools.append(tool('changes', 'history', t('view.changes'), () => void this.navigate('changes'), this.view === 'changes'));
    if (views.has('map') && feats.map !== false) tools.append(tool('map', 'map', t('view.map'), () => void this.navigate('map'), this.view === 'map', per['#map'] ? dots('#map') : null));
    if (tools.childElementCount > 1) rail.append(tools);

    // ---- 문서
    const docRow = (id: string, depth: number) => {
      const meta = this.manifest.docs[id];
      const file = id.split('/').pop() || id;
      const stem = file.replace(/\.(md|markdown)$/i, '');
      const b = h('button', { class: 'db-nav', type: 'button', style: `--d:${depth}`, title: id, 'aria-current': this.view === id ? 'page' : null, onclick: () => void this.navigate(id) },
        h('span', { class: 'ic', html: icon('doc') }),
        h('span', { class: 't' }, h('span', { text: meta.title }), meta.title !== stem ? h('small', { text: file }) : null),
        dots(id));
      const out: HTMLElement[] = [b];
      if (this.view === id && this.doc && feats.outline !== false) { const ol = this.doc.outline(); if (ol) { ol.style.setProperty('--d', String(depth)); out.push(ol); } }
      return out;
    };
    const docsBox = h('div', { class: 'db-docs' });
    const rootLabel = this.manifest.rootName || this.manifest.project.name;
    docsBox.append(h('div', { class: 'db-rail-h' }, h('span', { class: 'ic', html: icon('folderOpen') }), h('span', { text: rootLabel }), h('small', { text: t('rail.docs.count', { n: Object.keys(this.manifest.docs).length }) })));
    const custom = this.manifest.groups.filter((g) => g.id !== '_bench' && !g.id.startsWith('dir:') && g.docs.length);
    // config.json 에 모음(그룹)을 적었으면 "모음 / 폴더" 를 고른다 — 폴더 = 디스크 구조 그대로, 모음 = 적어 둔 묶음
    const byFolder = !!this.manifest.folders && (!custom.length || this.state.railView === 'folder');
    if (custom.length && this.manifest.folders) {
      const seg = h('div', { class: 'db-seg db-railview', role: 'group', 'aria-label': t('rail.view') },
        h('button', { type: 'button', 'aria-pressed': String(!byFolder), onclick: () => { this.state.railView = 'groups'; this.saveState(); this.renderRail(); } }, t('rail.view.groups')),
        h('button', { type: 'button', 'aria-pressed': String(byFolder), onclick: () => { this.state.railView = 'folder'; this.saveState(); this.renderRail(); } }, t('rail.view.folder')));
      docsBox.append(seg);
    }
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

  private railFoot(rail: HTMLElement): void {
    const t = this.t;
    const mode = this.fbMode;
    const st = mode === 'live' ? ['live', 'rail.storage.live'] : mode === 'poll' ? ['live', 'rail.storage.poll'] : mode === 'error' ? ['warn', 'rail.storage.error'] : mode === 'pending' ? ['', 'fb.loading'] : ['warn', 'rail.storage.local'];
    const foot = h('div', { class: 'db-rail-foot' }, h('div', { class: 'db-status ' + st[0] }, h('i'), t(st[1])));
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
  toast(msg: string, o: { sticky?: boolean; action?: string; onAction?: () => void } = {}): void {
    const t = this.els.toast;
    const close = () => { t.hidden = true; clearTimeout(this.toastT); };
    t.replaceChildren(h('span', { class: 'm', text: msg }),
      o.action ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => { close(); o.onAction?.(); } }, o.action) : '',
      h('button', { class: 'db-toast-x', type: 'button', 'aria-label': this.t('close'), onclick: close, html: icon('close') }));
    t.hidden = false;
    if (o.sticky) t.dataset.sticky = '1'; else delete t.dataset.sticky;
    clearTimeout(this.toastT);
    if (!o.sticky) this.toastT = setTimeout(close, Math.min(12000, Math.max(3600, 2400 + msg.length * 60)));
  }
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

  async updateFeedback(f: Feedback, patch: Partial<Feedback>, toastOk?: string): Promise<boolean> {
    try {
      const out = await this.ad.feedback.update(f.id, { ...patch, updatedAt: new Date().toISOString() }, { version: f.version });
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
