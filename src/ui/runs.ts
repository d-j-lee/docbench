/**
 * Claude 작업 창 — 화면 아래에 붙는다. 모델·노력·방식을 고르고 넘기면, 서버(또는 이 PC 의 실행기)가 Claude 를 백그라운드로 띄운다.
 * 진행 로그가 실시간으로 보이고, 끝나면 무엇을 고치고·제안하고·물었는지 줄마다 문서·피드백으로 이어진다.
 * 실행기가 없으면(단일 HTML) Claude Code 에 붙여 넣을 설치 문구를 보여 준다.
 */
import type { Feedback, RunEffort, RunLogLine, RunMode, RunsAvailability, RunStatus } from '../types';
import { RUN_EFFORTS, RUN_MODELS, runnerSetupPrompt, terminalHandoffPrompt } from '../core/runs';
import { turnOf } from '../core/feedback';
import { h, icon } from './dom';
import type { App } from './app';

const ACTIVE = new Set(['queued', 'running']);
const clock = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};
const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class RunDock {
  readonly el: HTMLElement;
  private app: App;
  private av: RunsAvailability | null = null;
  private runs: RunStatus[] = [];
  private sel: string | null = null;
  private logs = new Map<string, { lines: RunLogLine[]; next: number }>();
  private pending: string[] | null = null;
  private follow = true;
  private known = new Map<string, string>();
  private tickT: ReturnType<typeof setInterval> | null = null;
  private lastStatus = 0;
  private busy = false;
  private els: { log?: HTMLElement; logHead?: HTMLElement; list?: HTMLElement } = {};
  private destroyed = false;

  constructor(app: App) {
    this.app = app;
    this.el = h('section', { class: 'db-dock', 'aria-label': 'Claude', hidden: true });
  }

  get ad() { return this.app.ad.runs!; }
  get t() { return this.app.t; }
  get isOpen(): boolean { return !!this.app.state.runs?.open; }
  get availability(): RunsAvailability | null { return this.av; }
  private settings() { return (this.app.state.runs ||= {}); }

  async start(): Promise<void> {
    const pick = this.settings().runner;
    if (pick) this.ad.choose?.(pick);
    await this.refreshStatus();
    await this.refreshRuns(true);
    this.render();
    this.tickT = setInterval(() => void this.tick(), 1000);
  }
  destroy(): void { this.destroyed = true; if (this.tickT) clearInterval(this.tickT); }

  onEvent(type: string): void {
    if (type === 'runs') void this.refreshRuns();
    else if (type === 'runner') void this.refreshStatus();
  }

  private async tick(): Promise<void> {
    if (this.destroyed || this.busy) return;
    this.busy = true;
    try {
      const active = this.runs.some((r) => ACTIVE.has(r.state));
      if (Date.now() - this.lastStatus > (this.av?.available ? 15000 : 5000)) await this.refreshStatus();
      // 폴더 어댑터는 몇 초마다만 알린다 — 돌고 있는 동안은 1초마다 로그를 당긴다
      if (active) await this.refreshRuns();
      this.paintClock();
    } finally { this.busy = false; }
  }

  // ------------------------------------------------------------ 데이터
  async refreshStatus(): Promise<void> {
    this.lastStatus = Date.now();
    const prev = JSON.stringify([this.av?.available, this.av?.reason, this.av?.runner?.id, this.av?.runner?.claude?.version, this.av?.others?.length]);
    try { this.av = await this.ad.status(); } catch (e) { this.av = { available: false, reason: 'disabled', message: (e as Error).message }; }
    const now = JSON.stringify([this.av?.available, this.av?.reason, this.av?.runner?.id, this.av?.runner?.claude?.version, this.av?.others?.length]);
    if (prev !== now) { this.render(); this.app.renderBar(); this.app.renderRail(); }
  }

  async refreshRuns(first = false): Promise<void> {
    let list: RunStatus[];
    try { list = await this.ad.list(20); } catch { return; }
    list = list.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.feedbackIds));
    // 맡은 실행기가 꺼진 "대기·실행 중" 작업은 멈춘 것으로 보인다 — 카드를 붙잡지 않게 (실행기가 다시 켜지면 원래대로)
    const alive = this.aliveRunners();
    if (alive) list = list.map((r) => (ACTIVE.has(r.state) && !alive.has(r.runner) ? { ...r, state: 'failed', error: this.t('run.staleErr'), stale: true } as RunStatus : r));
    const changedActive = JSON.stringify(this.runs.filter((r) => ACTIVE.has(r.state)).map((r) => r.id + r.state)) !== JSON.stringify(list.filter((r) => ACTIVE.has(r.state)).map((r) => r.id + r.state));
    for (const r of list) {
      const was = this.known.get(r.id);
      if (!first && was && ACTIVE.has(was) && !ACTIVE.has(r.state) && !(r as { stale?: boolean }).stale) this.finished(r);
      this.known.set(r.id, r.state);
    }
    this.runs = list;
    if (!this.sel || !list.some((r) => r.id === this.sel)) this.sel = (list.find((r) => ACTIVE.has(r.state)) || list[0])?.id || null;
    if (this.sel) await this.pullLog(this.sel);
    this.renderList();
    this.renderLog();
    if (changedActive || first) { this.app.renderBar(); this.app.panel?.render(); this.app.renderRail(); this.app.doc?.renderBusy(); }
  }

  /** 살아 있는 실행기 id — 폴더 어댑터(others 를 주는 쪽)에서만 안다. 모르면 null */
  private aliveRunners(): Set<string> | null {
    const av = this.av;
    if (!av || !av.others) return null;
    return new Set([av.runner?.id, ...av.others.map((r) => r.id)].filter((x): x is string => !!x));
  }

  /** 이 실행기를 내 것으로 쓴다 (다시 열어도 기억) */
  private useRunner(id: string): void {
    this.settings().runner = id;
    this.app.saveState();
    this.ad.choose?.(id);
    void this.refreshStatus().then(() => this.refreshRuns());
  }

  private async pullLog(id: string): Promise<void> {
    const cur = this.logs.get(id) || { lines: [], next: 0 };
    try {
      const r = await this.ad.log(id, cur.next);
      if (r.next < cur.next) { this.logs.set(id, { lines: r.lines, next: r.next }); return; }
      if (r.lines.length) cur.lines.push(...r.lines);
      cur.next = r.next;
      this.logs.set(id, cur);
    } catch { /* 다음에 */ }
  }

  private finished(r: RunStatus): void {
    const s = r.summary;
    const parts = s ? (['edited', 'proposed', 'answered', 'asked', 'declined', 'skipped', 'failed'] as const).filter((k) => s[k]).map((k) => this.t('run.sum.' + k, { n: s[k] })) : [];
    const msg = r.state === 'done' ? this.t('run.toast.done', { what: parts.join(' · ') || this.t('run.sum.none') }) : r.state === 'canceled' ? this.t('run.toast.canceled') : this.t('run.toast.failed', { msg: r.error || '' });
    this.app.toast(msg, { action: this.t('run.open'), onAction: () => { this.sel = r.id; this.setOpen(true); } });
  }

  /** 이 피드백을 지금 다루는(줄 서 있거나 도는) 작업 */
  activeFor(fbId: string): RunStatus | undefined { return this.runs.find((r) => ACTIVE.has(r.state) && r.feedbackIds.includes(fbId)); }
  /** 지금 Claude 가 손대는 문서 */
  busyDocs(): Set<string> {
    const out = new Set<string>();
    for (const r of this.runs) {
      if (!ACTIVE.has(r.state)) continue;
      for (const d of r.docs || []) out.add(d);
      for (const id of r.feedbackIds) { const f = this.app.fb.find((x) => x.id === id); if (f?.docId) out.add(f.docId); }
    }
    return out;
  }
  activeRun(): RunStatus | undefined { return this.runs.find((r) => r.state === 'running') || this.runs.find((r) => r.state === 'queued'); }

  // ------------------------------------------------------------ 동작
  setOpen(v: boolean): void {
    this.settings().open = v;
    this.app.saveState();
    this.app.root.classList.toggle('dock-open', v);
    this.render();
    this.app.renderBar();
    if (v) requestAnimationFrame(() => this.scrollLog());
  }
  toggle(): void { this.setOpen(!this.isOpen); }

  /** 넘기기 준비 — 창을 열고 넘길 목록·설정을 보여 준다(바로 시작하지 않는다) */
  handoff(ids: string[]): void {
    this.pending = ids;
    this.setOpen(true);
    void this.refreshStatus();
  }

  async propose(f: Feedback): Promise<void> { await this.launch('propose', [f.id]); }

  private async launch(kind: 'handoff' | 'propose', ids: string[]): Promise<void> {
    const s = this.settings();
    try {
      const st = await this.ad.start({ kind, feedbackIds: ids, model: s.model || undefined, effort: (s.effort || undefined) as RunEffort | undefined, mode: kind === 'propose' ? 'propose' : s.mode || 'auto' });
      this.pending = null;
      this.sel = st.id;
      this.runs = [st, ...this.runs.filter((r) => r.id !== st.id)];
      this.known.set(st.id, st.state);
      this.app.emit({ type: 'assistant:requested', feedbackIds: ids });
      if (!this.isOpen) this.setOpen(true); else this.render();
      this.app.renderBar(); this.app.panel?.render(); this.app.renderRail();
    } catch (e) {
      this.app.toast(this.t('run.startFail', { msg: (e as Error).message }));
      await this.refreshStatus();
      this.setOpen(true);
    }
  }

  async cancel(id: string): Promise<void> {
    try { await this.ad.cancel(id); this.app.toast(this.t('run.canceling')); } catch (e) { this.app.toast(this.t('err.generic', { msg: (e as Error).message })); }
  }

  // ------------------------------------------------------------ 그리기
  render(): void {
    const t = this.t;
    const open = this.isOpen;
    this.el.hidden = !open;
    this.app.root.classList.toggle('dock-open', open);
    if (!open) return;
    const s = this.settings();
    const av = this.av;
    const sel = (label: string, value: string, opts: [string, string][], on: (v: string) => void, title?: string) =>
      h('label', { class: 'db-dock-opt', title: title || '' }, h('span', { text: label }),
        (() => { const e = h('select', { onchange: (ev: Event) => on((ev.target as HTMLSelectElement).value) }) as HTMLSelectElement; for (const [v, l] of opts) e.append(h('option', { value: v, text: l, selected: v === value })); return e; })());
    const models: [string, string][] = [['', t('run.model.default')], ...((av?.runner?.models?.length ? av.runner.models : RUN_MODELS).map((m) => [m, m[0].toUpperCase() + m.slice(1)] as [string, string]))];
    if (s.model && !models.some(([v]) => v === s.model)) models.push([s.model, s.model]);
    const efforts: [string, string][] = [['', t('run.effort.default')], ...((av?.runner?.efforts?.length ? av.runner.efforts : RUN_EFFORTS).map((e) => [e, t('run.effort.' + e)] as [string, string]))];
    const modes: [string, string][] = [['auto', t('run.mode.auto')], ['propose', t('run.mode.propose')]];
    const save = () => this.app.saveState();
    const state = !av ? ['', t('run.state.checking')] : av.available ? ['ok', av.runner?.kind === 'server' ? t('run.state.server', { v: av.runner?.claude?.version || '' }) : t('run.state.runner', { v: av.runner?.claude?.version || '', host: av.runner?.host || '' })] : ['bad', t('run.state.' + (av.reason || 'disabled'))];
    const head = h('header', { class: 'db-dock-h' },
      h('div', { class: 'db-dock-title' }, h('span', { class: 'db-dock-ic', html: icon('spark') }), h('b', { text: t('run.title') }),
        h('span', { class: 'db-dock-state ' + state[0], title: av?.message || '' }, h('i'), state[1])),
      h('div', { class: 'db-dock-opts' },
        sel(t('run.model'), s.model || '', models, (v) => { s.model = v; save(); }, t('run.model.hint')),
        sel(t('run.effort'), s.effort || '', efforts, (v) => { s.effort = v as RunEffort | ''; save(); }, t('run.effort.hint')),
        sel(t('run.mode'), s.mode || 'auto', modes, (v) => { s.mode = v as RunMode; save(); this.render(); }, t('run.mode.hint'))),
      h('button', { class: 'db-btn ghost sm db-dock-x', type: 'button', title: t('close'), 'aria-label': t('close'), onclick: () => this.setOpen(false), html: icon('close') }));
    const body = h('div', { class: 'db-dock-b' });
    if (this.pending) body.append(this.composer(this.pending));
    if (av && !av.available) body.append(this.setupCard(av));
    const stale = this.staleRunner(av);
    if (stale) body.append(stale);
    const hint = this.nameHint();
    if (hint) body.append(hint);
    if (av?.others?.length && av.runner) body.append(this.chooser(av));
    const list = h('ol', { class: 'db-runs', 'aria-label': t('run.list') });
    const logHead = h('div', { class: 'db-runlog-h' });
    const log = h('div', { class: 'db-runlog', role: 'log', 'aria-live': 'polite' });
    log.addEventListener('scroll', () => { this.follow = log.scrollTop + log.clientHeight >= log.scrollHeight - 24; });
    this.els = { list, log, logHead };
    body.append(h('div', { class: 'db-dock-cols' }, list, h('div', { class: 'db-runlog-wrap' }, logHead, log)));
    this.el.replaceChildren(head, body);
    this.renderList();
    this.renderLog(true);
  }

  private composer(ids: string[]): HTMLElement {
    const t = this.t;
    const rows = ids.map((id) => this.app.fb.find((f) => f.id === id)).filter((f): f is Feedback => !!f);
    const byDoc = new Map<string, number>();
    for (const f of rows) byDoc.set(f.docId || '#map', (byDoc.get(f.docId || '#map') || 0) + 1);
    const s = this.settings();
    const can = !!this.av?.available;
    return h('div', { class: 'db-dock-card compose' },
      h('div', { class: 'db-dock-card-h' }, h('b', { text: t('run.compose.title', { n: rows.length }) }),
        h('span', { class: 'db-hint', text: [...byDoc].map(([d, n]) => `${this.app.docTitle(d)} ${n}`).join(' · ') })),
      h('p', { class: 'db-hint', text: (s.mode === 'propose' ? t('run.compose.propose') : t('run.compose.auto')) + ' ' + t('run.compose.safe') }),
      h('div', { class: 'db-row' },
        h('button', { class: 'db-btn primary', type: 'button', disabled: !can || !rows.length, onclick: () => void this.launch('handoff', rows.map((f) => f.id)) }, t('run.compose.start')),
        h('button', { class: 'db-btn ghost', type: 'button', onclick: () => { this.pending = null; this.render(); } }, t('compose.cancel')),
        !can && this.app.ad.notifier ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void this.terminalFallback(rows) }, t('run.terminal.btn')) : null));
  }

  /** 실행기 없이: 요청함에 남기고 터미널에 붙여 넣을 한 줄을 복사 */
  private async terminalFallback(rows: Feedback[]): Promise<void> {
    const t = this.t;
    const name = this.ad.setup?.folderName || this.app.manifest.project.name;
    try { await this.app.ad.notifier?.send({ count: rows.length, docs: [...new Set(rows.map((f) => this.app.docTitle(f.docId)))], feedbackIds: rows.map((f) => f.id) }); } catch { /* 요청함은 선택 */ }
    const line = terminalHandoffPrompt(name, this.ad.setup);
    const ok = await this.app.copy(line);
    this.app.toast(ok ? t('run.terminal.copied') : t('run.terminal.manual', { cmd: line }), { sticky: true });
  }

  /** 실행기 판이 이 화면과 다르면 한 줄 — 설치 문구를 다시 붙여 넣으면 같은 판으로 바뀐다 */
  private staleRunner(av: RunsAvailability | null): HTMLElement | null {
    const setup = this.ad.setup, r = av?.runner;
    if (!av?.available || !setup || !r || r.kind !== 'runner' || !r.version || r.version === setup.version || setup.version === 'dev' || r.version === 'dev') return null;
    const t = this.t;
    const prompt = runnerSetupPrompt(setup);
    return h('div', { class: 'db-dock-card stale' },
      h('span', { class: 'db-dock-ic warn', html: icon('warn') }),
      h('span', { text: t('run.stale', { r: r.version, v: setup.version }) }),
      h('button', { class: 'db-btn sm', type: 'button', onclick: async () => { const ok = await this.app.copy(prompt); this.app.toast(ok ? t('run.setup.copied') : t('run.setup.copyFail')); }, html: icon('copy') + ' ' + t('run.setup.copy') }));
  }

  private setupCard(av: RunsAvailability): HTMLElement {
    const t = this.t;
    const setup = this.ad.setup;
    const box = h('div', { class: 'db-dock-card setup' });
    const reason = av.reason || 'disabled';
    box.append(h('div', { class: 'db-dock-card-h' }, h('span', { class: 'db-dock-ic warn', html: icon('warn') }), h('b', { text: t('run.setup.' + reason + '.title') })));
    if (av.message) box.append(h('p', { class: 'db-hint', text: av.message }));
    box.append(h('p', { text: t('run.setup.' + reason + '.body') }));
    if (reason === 'no-runner' && setup) {
      const prompt = runnerSetupPrompt(setup);
      const ta = h('textarea', { class: 'db-dock-prompt', readonly: true, rows: '6', 'aria-label': t('run.setup.prompt') }) as HTMLTextAreaElement;
      ta.value = prompt;
      const runCmd = `node "%LOCALAPPDATA%\\docbench\\docbench.mjs" runner "<${t('run.setup.folder')}>"${setup.dataHome && setup.dataName ? ` --data "<${setup.dataHome}\\${setup.dataName}>"` : ''} --detach`;
      box.append(
        h('ol', { class: 'db-steps' },
          h('li', {}, h('b', { text: t('run.setup.step1') }), ' ', t('run.setup.step1.body')),
          h('li', {}, h('b', { text: t('run.setup.step2') }), ' ', t('run.setup.step2.body')),
          h('li', {}, h('b', { text: t('run.setup.step3') }), ' ', t('run.setup.step3.body'))),
        ta,
        h('div', { class: 'db-row' },
          h('button', { class: 'db-btn primary sm', type: 'button', onclick: async () => { const ok = await this.app.copy(prompt); this.app.toast(ok ? t('run.setup.copied') : t('run.setup.copyFail')); if (!ok) { ta.focus(); ta.select(); } }, html: icon('copy') + ' ' + t('run.setup.copy') }),
          h('span', { class: 'db-hint', text: t('run.setup.again') }),
          h('code', { class: 'db-cmd', text: runCmd }),
          h('button', { class: 'db-btn ghost sm', type: 'button', title: t('run.setup.copy'), onclick: async () => { await this.app.copy(runCmd); this.app.toast(t('run.setup.copied')); }, html: icon('copy') })),
        h('p', { class: 'db-hint', text: t('run.setup.why') }));
    } else if (reason === 'not-mine') {
      const me = this.app.me.name || '';
      for (const r of (av.others || []).filter((x) => x.kind === 'runner')) {
        box.append(h('div', { class: 'db-row' },
          h('code', { class: 'db-cmd', text: `${r.user}@${r.host}` }),
          h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => this.useRunner(r.id) }, t('run.notMine.use')),
          me && r.user.toLowerCase() !== me.toLowerCase() ? h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => this.app.root.dispatchEvent(new CustomEvent('docbench:rename', { detail: { name: r.user }, bubbles: true })) }, t('run.name.use', { user: r.user })) : null));
      }
    } else if (reason === 'old-claude' || reason === 'no-claude') {
      box.append(h('code', { class: 'db-cmd', text: reason === 'old-claude' ? 'claude update' : 'npm install -g @anthropic-ai/claude-code' }));
    }
    if (this.app.ad.notifier && (reason === 'no-runner' || reason === 'no-claude' || reason === 'old-claude')) {
      const waiting = this.app.fb.filter((f) => turnOf(f) === 'assistant');
      if (waiting.length) box.append(h('p', { class: 'db-hint' }, t('run.terminal.alt') + ' ', h('button', { class: 'db-btn sm', type: 'button', onclick: () => void this.terminalFallback(waiting) }, t('run.terminal.btn'))));
    }
    return box;
  }

  /** 단일 HTML: 실행기(이 PC 로그인 이름)와 화면 이름이 다르면 맞추자고 한다 — 서버·CLI 와 같은 사람으로 남게 */
  private nameHint(): HTMLElement | null {
    const r = this.av?.runner;
    const me = this.app.me.name || '';
    if (!r || r.kind !== 'runner' || !me || r.user.toLowerCase() === me.toLowerCase() || this.app.state.runs?.chosen === 'name-ok:' + r.user) return null;
    const t = this.t;
    return h('div', { class: 'db-dock-card hint' },
      h('span', { text: t('run.name.hint', { user: r.user, me }) }),
      h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => this.app.root.dispatchEvent(new CustomEvent('docbench:rename', { detail: { name: r.user }, bubbles: true })) }, t('run.name.use', { user: r.user })),
      h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => { this.settings().chosen = 'name-ok:' + r.user; this.app.saveState(); this.render(); } }, t('run.name.keep')));
  }

  private chooser(av: RunsAvailability): HTMLElement {
    const all = [av.runner!, ...(av.others || [])];
    const e = h('select', { onchange: (ev: Event) => this.useRunner((ev.target as HTMLSelectElement).value) }) as HTMLSelectElement;
    for (const r of all) e.append(h('option', { value: r.id, selected: r.id === av.runner!.id, text: `${r.user}@${r.host} · ${r.kind === 'server' ? 'serve' : 'runner'}` }));
    return h('div', { class: 'db-dock-card hint' }, h('span', { text: this.t('run.choose') }), e);
  }

  private renderList(): void {
    const list = this.els.list;
    if (!list || !this.isOpen) return;
    const t = this.t;
    list.replaceChildren();
    if (!this.runs.length) { list.append(h('li', { class: 'db-empty', text: t('run.empty') })); return; }
    for (const r of this.runs) {
      const s = r.summary;
      const chips = s ? (['edited', 'proposed', 'answered', 'asked', 'declined', 'failed'] as const).filter((k) => s[k]).map((k) => h('span', { class: 'db-chip-s ' + k, text: this.t('run.sum.' + k, { n: s[k] }) })) : [];
      list.append(h('li', {},
        h('button', { type: 'button', class: 'db-run' + (r.id === this.sel ? ' sel' : ''), 'data-state': r.state, onclick: () => { this.sel = r.id; this.follow = true; void this.pullLog(r.id).then(() => { this.renderList(); this.renderLog(true); }); } },
          h('span', { class: 'db-run-ic ' + r.state, html: r.state === 'running' ? '' : r.state === 'done' ? icon('check') : r.state === 'queued' ? icon('clock') : r.state === 'canceled' ? icon('stop') : icon('warn') }),
          h('span', { class: 'db-run-t' },
            h('b', { text: t(r.kind === 'propose' ? 'run.kind.propose' : 'run.kind.handoff', { n: r.feedbackIds.length }) }),
            h('small', { text: [clock(r.startedAt || r.at), r.model, r.effort && t('run.effort.' + r.effort), r.mode === 'propose' && r.kind !== 'propose' ? t('run.mode.propose') : ''].filter(Boolean).join(' · ') }),
            chips.length ? h('span', { class: 'db-chips-s' }, chips) : null))));
    }
  }

  private renderLog(full = false): void {
    const log = this.els.log, head = this.els.logHead;
    if (!log || !head || !this.isOpen) return;
    const t = this.t;
    const r = this.runs.find((x) => x.id === this.sel);
    if (!r) { head.replaceChildren(); log.replaceChildren(h('p', { class: 'db-hint', text: this.av?.available ? t('run.howto') : '' })); return; }
    const active = ACTIVE.has(r.state);
    const usage = r.usage;
    head.replaceChildren(
      h('div', { class: 'db-runlog-t' },
        h('b', { text: t(r.kind === 'propose' ? 'run.kind.propose' : 'run.kind.handoff', { n: r.feedbackIds.length }) }),
        h('span', { class: 'db-run-st ' + r.state, text: t('run.st.' + r.state) }),
        h('span', { class: 'db-run-clock', 'data-start': r.startedAt || '', 'data-end': r.endedAt || '', text: this.elapsed(r) }),
        r.progress && active ? h('span', { class: 'db-run-phase', text: t('run.phase.' + r.progress.phase, { n: r.progress.tokens || '' }) }) : null,
        usage?.outputTokens ? h('span', { class: 'db-hint', text: t('run.usage', { inT: Math.round((usage.inputTokens || 0) / 1000), out: usage.outputTokens }) }) : null,
        usage?.limit?.utilization != null ? h('span', { class: 'db-hint', title: t('run.limit.hint'), text: t('run.limit', { p: Math.round(usage.limit.utilization * 100) }) }) : null),
      active ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void this.cancel(r.id), html: icon('stop') + ' ' + t('run.cancel') }) : '');
    const cur = this.logs.get(r.id) || { lines: [], next: 0 };
    const have = full ? 0 : log.querySelectorAll('.db-ll').length;
    if (full || have > cur.lines.length) log.replaceChildren();
    for (const l of cur.lines.slice(full ? 0 : have)) log.append(this.lineEl(l));
    if (r.error && !log.querySelector('.db-ll.err-final')) log.append(h('div', { class: 'db-ll error err-final', text: r.error }));
    if (!cur.lines.length && active) log.append(h('div', { class: 'db-ll muted', text: t('run.waiting') }));
    this.scrollLog();
  }

  private scrollLog(): void { const log = this.els.log; if (log && this.follow) log.scrollTop = log.scrollHeight; }

  private elapsed(r: RunStatus): string {
    const a = Date.parse(r.startedAt || ''), b = r.endedAt ? Date.parse(r.endedAt) : Date.now();
    return isFinite(a) ? dur(b - a) : '';
  }
  /** 매초: 경과 시간만 고친다 */
  private paintClock(): void {
    const r = this.runs.find((x) => x.id === this.sel);
    const c = this.el.querySelector<HTMLElement>('.db-run-clock');
    if (r && c) c.textContent = this.elapsed(r);
    const bar = this.app.root.querySelector<HTMLElement>('.db-claude .clk');
    const a = this.activeRun();
    if (bar && a) bar.textContent = this.elapsed(a);
  }

  private lineEl(l: RunLogLine): HTMLElement {
    const t = this.t;
    const v = (l.v || {}) as Record<string, string | number | undefined>;
    const cls: Record<string, string> = { text: 'say', denied: 'warn', toolError: 'warn', 'apply.edit': 'good', 'apply.propose': 'accent', 'apply.ask': 'owner', 'apply.answer': 'good', 'apply.decline': 'muted', skip: 'muted', safe: 'muted', applyFail: 'bad', error: 'bad', timeout: 'bad', canceled: 'muted', done: 'good', warn: 'warn', summary: 'say' };
    const vv: Record<string, unknown> = { ...v };
    if (v.doc) vv.doc = this.app.docTitle(String(v.doc));
    if (v.section) vv.section = String(v.section).split(' › ').slice(-1)[0];
    if (v.fb) vv.fb = this.fbLabel(String(v.fb));
    if (v.note) vv.note = t('run.note.' + v.note) + (v.problem ? ' ' + String(v.problem) : '');
    if (v.reason) vv.reason = t('run.reason.' + v.reason) === 'run.reason.' + v.reason ? v.reason : t('run.reason.' + v.reason);
    if (l.k === 'start') {
      vv.kind = t('run.kindw.' + (v.kind || 'handoff'));
      vv.model = v.model || t('run.model.default');
      vv.effort = v.effort ? t('run.effort.' + v.effort) : t('run.effort.default');
      vv.mode = t('run.mode.' + (v.mode || 'auto'));
    }
    if (l.k === 'done') vv.what = (['edited', 'proposed', 'answered', 'asked', 'declined', 'skipped', 'failed'] as const).filter((k) => Number(v[k])).map((k) => t('run.sum.' + k, { n: v[k] })).join(' · ') || t('run.sum.none');
    if (l.k === 'done' || l.k === 'timeout') vv.time = dur(Number(v.ms || 0) || Number(v.sec || 0) * 1000);
    const text = l.k === 'text' || l.k === 'summary' ? (l.k === 'summary' ? t('run.log.summary') + ' ' : '') + (l.text || '') : t('run.log.' + l.k, vv);
    const row = h('div', { class: 'db-ll ' + (cls[l.k] || '') }, h('time', { text: clock(l.at) }), h('span', { class: 'm', text: text }));
    if ((l.k.startsWith('apply.') || l.k === 'skip' || l.k === 'applyFail') && l.text && l.k !== 'apply.edit') row.append(h('q', { text: l.text }));
    const ref = l.ref;
    if (ref && (ref.docId || ref.feedbackId)) {
      row.classList.add('link');
      row.append(h('button', { class: 'db-btn ghost sm', type: 'button', onclick: () => void this.app.navigate(ref.docId || this.app.fb.find((f) => f.id === ref.feedbackId)?.docId || this.app.view || 'map', { section: ref.section, feedbackId: ref.feedbackId }) }, t('run.show')));
    }
    return row;
  }

  private fbLabel(id: string): string {
    const f = this.app.fb.find((x) => x.id === id);
    if (!f) return id.slice(-4);
    const b = (f.title || f.body || '').replace(/\s+/g, ' ').trim();
    return '“' + (b.length > 28 ? b.slice(0, 27) + '…' : b) + '”';
  }
}
