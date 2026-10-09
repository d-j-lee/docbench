/**
 * Claude 작업 창 — 보낸 묶음·선제안의 진행과 로그. 보내기는 검토 패널에서 한다(D73).
 * 이 PC 의 앱(자동)이 맡으면 진행 로그가 실시간으로 보이고, 터미널 Claude(설치 없음, D76)에게 맡기면 칠 한 줄과
 * 결과를 기다리는 상태가 보인다. 끝나면 결과는 검토 패널의 "볼 것"으로 간다.
 */
import type { RunLogLine, RunsAvailability, RunStartInput, RunStatus, TerminalHandoff } from '../types';
import { runnerSetupPrompt, isTerminalRunner } from '../core/runs';
import { terminalCommands, isRoomPath } from '../core/room';
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
  /** 최근 작업(최근 것 먼저) — 볼 것의 회차 머리·읽기 정리가 쓴다 */
  get recent(): RunStatus[] { return this.runs; }
  private sel: string | null = null;
  private logs = new Map<string, { lines: RunLogLine[]; next: number }>();
  /** 터미널 Claude 에게 맡긴 요청의 칠 한 줄 (이 창이 연 동안) */
  private handoffs = new Map<string, TerminalHandoff>();
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
    const was = this.av?.available;
    try { this.av = await this.ad.status(); } catch (e) { this.av = { available: false, reason: 'disabled', message: (e as Error).message }; }
    const now = JSON.stringify([this.av?.available, this.av?.reason, this.av?.runner?.id, this.av?.runner?.claude?.version, this.av?.others?.length]);
    if (prev !== now) {
      this.render(); this.app.renderBar(); this.app.renderRail(); this.app.panel?.render();
      if (was === false && this.av?.available) this.app.toast(this.t('run.connected'));
    }
  }

  async refreshRuns(first = false): Promise<void> {
    let list: RunStatus[];
    try { list = await this.ad.list(20); } catch { return; }
    list = list.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.feedbackIds));
    // 맡은 실행기가 꺼진 "대기·실행 중" 작업은 멈춘 것으로 보인다 — 카드를 붙잡지 않게 (실행기가 다시 켜지면 원래대로)
    const alive = this.aliveRunners();
    // 터미널 Claude 에게 맡긴 것은 실행기가 없다 — 결과 파일을 기다린다
    if (alive) list = list.map((r) => (ACTIVE.has(r.state) && !isTerminalRunner(r.runner) && !alive.has(r.runner) ? { ...r, state: 'failed', error: this.t('run.staleErr'), stale: true } as RunStatus : r));
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
    // 터미널 요청이 다른 길로 이미 처리되어 닫힌 것 — 알릴 결과가 없다
    if (r.state === 'done' && isTerminalRunner(r.runner) && s && !s.edited && !s.proposed && !s.answered && !s.asked && !s.declined && !s.failed && !(s.created || 0)) { this.app.panel?.render(); return; }
    const parts = s ? (['edited', 'proposed', 'answered', 'asked', 'declined', 'skipped', 'failed'] as const).filter((k) => s[k]).map((k) => this.t('run.sum.' + k, { n: s[k] })) : [];
    const msg = r.state === 'done' ? this.t(r.kind === 'review' ? 'run.toast.reviewed' : 'run.toast.done', { what: parts.join(' · ') || this.t('run.sum.none') }) : r.state === 'canceled' ? this.t('run.toast.canceled') : this.t('run.toast.failed', { msg: r.error || '' });
    // 읽기 정리는 문서를 바꾸지 않는다 — 그 문서를 보고 있으면 바로 적용하고 되돌리기를 준다(묻는 단계를 하나 줄인다).
    // 다른 곳을 보고 있으면 끌고 가지 않는다 — 알리고, 볼 것에 남긴다
    if (r.state === 'done' && r.kind === 'review' && r.goal === 'view' && r.view?.length) {
      if (!this.app.isMine(r)) { this.app.panel?.render(); return; }
      const view = r.view;
      if (view.some((p) => p.docId === this.app.view)) void this.app.applyReadingPlan(view, { navigate: false, run: r.id });
      else this.app.toast(this.t('view.arrived', { n: view.length }), { sticky: true, action: this.t('round.view.apply'), onAction: () => void this.app.applyReadingPlan(view, { run: r.id }) });
      this.app.panel?.render();
      return;
    }
    if (r.state === 'done') this.app.toast(msg, { sticky: true, action: this.t('run.toast.see'), onAction: () => this.app.panel.open(undefined, 'review') });
    else this.app.toast(msg, { action: this.t('run.open'), onAction: () => { this.sel = r.id; this.setOpen(true); } });
    this.app.panel?.render();
  }

  /** 이 피드백을 마지막으로 맡았던 작업(끝난 것 포함, 최근 것) */
  lastFor(fbId: string): RunStatus | undefined { return this.runs.find((r) => r.feedbackIds.includes(fbId)); }
  /** 이 피드백을 지금 다루는(줄 서 있거나 도는) 작업 */
  activeFor(fbId: string): RunStatus | undefined { return this.runs.find((r) => ACTIVE.has(r.state) && r.feedbackIds.includes(fbId)); }
  /** 지금 Claude 가 손대는 문서 — 터미널을 기다리는 요청은 빼고(아직 아무도 손대지 않았다) */
  busyDocs(): Set<string> { return this.docsOf((r) => ACTIVE.has(r.state) && !this.isTerminal(r)); }
  /** 터미널의 Claude 를 기다리는 요청의 문서 — 사람이 한 줄을 쳐야 시작한다 */
  waitingDocs(): Map<string, RunStatus> {
    const out = new Map<string, RunStatus>();
    for (const r of this.runs) if (this.isTerminal(r)) for (const d of this.docsOf((x) => x === r)) if (!out.has(d)) out.set(d, r);
    return out;
  }
  private docsOf(want: (r: RunStatus) => boolean): Set<string> {
    const out = new Set<string>();
    for (const r of this.runs) {
      if (!want(r)) continue;
      for (const d of r.docs || []) out.add(d);
      for (const id of r.feedbackIds) { const f = this.app.fb.find((x) => x.id === id); if (f?.docId) out.add(f.docId); }
    }
    return out;
  }
  activeRun(): RunStatus | undefined { return this.runs.find((r) => r.state === 'running') || this.runs.find((r) => r.state === 'queued' && !this.isTerminal(r)) || this.runs.find((r) => r.state === 'queued'); }
  /** 최근 작업 (회차 머리에 지시·총평·읽기 정리를 보일 때) */
  runFor(id: string): RunStatus | undefined { return id ? this.runs.find((r) => r.id === id) : undefined; }
  /** 터미널 Claude 에게 맡겨 결과를 기다리는 것 */
  isTerminal(r: RunStatus): boolean { return isTerminalRunner(r.runner) && r.state === 'queued'; }

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

  /** 이 PC 의 앱(또는 서버·연습용 흉내)으로 바로 시작한다 */
  async startRun(input: RunStartInput): Promise<RunStatus> {
    const st = await this.ad.start(input);
    this.track(st);
    return st;
  }

  /** 새 작업을 목록에 올리고 지켜본다 */
  track(st: RunStatus & { terminal?: TerminalHandoff }): void {
    if (st.terminal) this.handoffs.set(st.id, st.terminal);
    this.sel = st.id;
    this.runs = [st, ...this.runs.filter((r) => r.id !== st.id)];
    this.known.set(st.id, st.state);
    this.render();
    this.app.renderBar(); this.app.panel?.render(); this.app.renderRail(); this.app.doc?.renderBusy();
  }

  /** 터미널에서 칠 한 줄 — 맡긴 직후, 또는 "보냄"에서 다시 볼 때 */
  showTerminal(r: RunStatus, h0?: TerminalHandoff): void {
    const s = this.app.state.runs || {};
    const setup = this.ad.setup;
    // 어댑터가 붙여 준 안내(기록 자리를 아는 쪽)를 먼저 — 문서 폴더 이름으로 짐작하지 않는다(거기서 켜면 그 폴더의 지시·훅이 섞인다)
    const ho = h0 || r.terminal || this.handoffs.get(r.id) || {
      roomName: setup?.dataHome && setup.dataName ? setup.dataName : this.t('term.room.unknown'), homeName: setup?.dataHome,
      ...terminalCommands({ id: r.id, model: r.model, effort: r.effort, locale: this.app.opts.locale === 'en' ? 'en' : 'ko' }),
    };
    const locale = this.app.opts.locale === 'en' ? 'en' as const : 'ko' as const;
    const pick = (x: TerminalHandoff): TerminalHandoff => ({ ...x, command: s.resume && x.resume ? x.resume : x.command });
    // 지난 대화 이어서: 만든 쪽이 준 -c 줄. 옛 서버가 준 안내(resume 없음)는 그대로 — 손으로 고친 명령을 만들지 않는다.
    // 경로를 모르는 쪽(브라우저)은 사람이 알려 준 기록 폴더 경로로 칠 줄·deep link 를 다시 만든다
    this.app.dialogs.terminal(pick(ho), {
      rebuild: ho.room ? undefined : (room) => (isRoomPath(room) ? pick({ ...ho, room, ...terminalCommands({ id: r.id, room, model: r.model, effort: r.effort, locale }) }) : null),
    });
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
    const av = this.av;
    const state = !av ? ['', t('run.state.checking')] : av.available ? ['ok', av.runner?.kind === 'demo' ? t('run.state.demo') : av.runner?.kind === 'server' ? t('run.state.server', { v: av.runner?.claude?.version || '' }) : av.runner?.kind === 'app' ? t('run.state.app', { v: av.runner?.claude?.version || '', host: av.runner?.host || '' }) : t('run.state.runner', { v: av.runner?.claude?.version || '', host: av.runner?.host || '' })] : ['bad', t('run.state.' + (av.reason || 'disabled'))];
    const head = h('header', { class: 'db-dock-h' },
      h('div', { class: 'db-dock-title' }, h('span', { class: 'db-dock-ic', html: icon('spark') }), h('b', { text: t('run.title') }),
        h('span', { class: 'db-dock-state ' + state[0], title: av?.message || '' }, h('i'), state[1])),
      h('span', { class: 'db-grow' }),
      h('button', { class: 'db-btn ghost sm db-dock-x', type: 'button', title: t('close'), 'aria-label': t('close'), onclick: () => this.setOpen(false), html: icon('close') }));
    const body = h('div', { class: 'db-dock-b' });
    const term = this.runs.find((r) => this.isTerminal(r));
    if (term) body.append(h('div', { class: 'db-dock-card hint' }, h('span', { class: 'db-dock-ic', html: icon('clock') }), h('span', { text: t('run.terminal.waiting') }), h('button', { class: 'db-btn sm', type: 'button', onclick: () => this.showTerminal(term) }, t('sent.terminal.show'))));
    if (av && !av.available) body.append(this.setupCard(av));
    const stale = this.staleRunner(av);
    if (stale) body.append(stale);
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

  /** 실행기 판이 이 화면과 다르면 한 줄 — 설치 문구를 다시 붙여 넣으면 같은 판으로 바뀐다 */
  private staleRunner(av: RunsAvailability | null): HTMLElement | null {
    const setup = this.ad.setup, r = av?.runner;
    if (!av?.available || !setup || !r || r.kind === 'server' || !r.version || r.version === setup.version || setup.version === 'dev' || r.version === 'dev') return null;
    const t = this.t;
    const prompt = runnerSetupPrompt(setup);
    return h('div', { class: 'db-dock-card stale' },
      h('span', { class: 'db-dock-ic warn', html: icon('warn') }),
      h('span', { text: t('run.stale', { r: r.version, v: setup.version }) }),
      h('button', { class: 'db-btn sm', type: 'button', onclick: async () => { const ok = await this.app.copy(prompt); this.app.toast(ok ? t('run.setup.copied') : t('run.setup.copyFail')); }, html: icon('copy') + ' ' + t('run.setup.copy') }));
  }

  /**
   * 연결 안내 — 엔진이 없을 때 이 창에 뜬다(터미널 한 줄로도 된다고 함께). 단계: (기록 폴더) → Claude Code → 문구 붙여 넣기 → 연결을 기다림.
   * 구독 로그인 그대로, API 키 없이. 연결되면 이 카드는 사라지고 기다리던 일을 이어서 맡긴다.
   */
  private setupCard(av: RunsAvailability): HTMLElement {
    const t = this.t;
    const setup = this.ad.setup;
    const box = h('div', { class: 'db-dock-card setup' });
    const reason = av.reason || 'disabled';
    const copyBtn = (text: string, primary = true) => h('button', { class: 'db-btn sm' + (primary ? ' primary' : ' ghost'), type: 'button', onclick: async () => { const ok = await this.app.copy(text); this.app.toast(ok ? t('run.setup.copied') : t('run.setup.copyFail')); }, html: icon('copy') + ' ' + t('run.setup.copy') });
    box.append(h('div', { class: 'db-dock-card-h' }, h('span', { class: 'db-dock-ic ' + (reason === 'no-runner' ? 'plug' : 'warn'), html: icon(reason === 'no-runner' ? 'plug' : 'warn') }), h('b', { text: t('run.setup.' + reason + '.title') })));
    if (av.message && reason !== 'no-runner') box.append(h('p', { class: 'db-hint', text: av.message }));
    box.append(h('p', { text: t('run.setup.' + reason + '.body') }));
    if (reason === 'no-runner' && setup?.noData) {
      // 연결하려면 먼저 기록 자리가 있어야 한다 (앱이 그 폴더의 요청을 읽는다)
      box.append(h('div', { class: 'db-row' }, h('button', { class: 'db-btn primary sm', type: 'button', onclick: async () => {
        try { await this.ad.prepare?.(); } catch (e) { this.app.toast((e as Error).message); }
        await this.refreshStatus(); this.render();
      } }, t('run.setup.pickData'))), h('p', { class: 'db-hint', text: t('run.setup.pickData.why') }));
    } else if (reason === 'old-runner' && setup) {
      // 예전 판 앱: 같은 설치 문구가 새 판으로 바꾼다(바꿔 쓰기)
      const prompt = runnerSetupPrompt(setup);
      box.append(h('div', { class: 'db-row' }, copyBtn(prompt)));
    } else if (reason === 'no-runner' && setup) {
      const prompt = runnerSetupPrompt(setup);
      const ta = h('textarea', { class: 'db-dock-prompt', readonly: true, rows: '5', 'aria-label': t('run.setup.prompt') }) as HTMLTextAreaElement;
      ta.value = prompt;
      box.append(
        h('ol', { class: 'db-steps' },
          h('li', {}, h('b', { text: t('run.setup.step1') }), ' ', t('run.setup.step1.body')),
          h('li', {}, h('b', { text: t('run.setup.step2') }), ' ', t('run.setup.step2.body'), h('div', { class: 'db-row' }, copyBtn(prompt))),
          h('li', { class: 'wait' }, h('span', { class: 'db-spin sm' }), h('b', { text: t('run.setup.step3') }), ' ', t('run.setup.step3.body'))),
        h('details', { class: 'db-setup-more' }, h('summary', { text: t('run.setup.show') }), ta),
        h('details', { class: 'db-setup-more' }, h('summary', { text: t('run.setup.trouble') }),
          h('ul', {}, ...['t1', 't2', 't3', 't4'].map((k) => h('li', { text: t('run.setup.trouble.' + k) })))),
        h('p', { class: 'db-hint', text: t('run.setup.why') }));
    } else if (reason === 'not-mine') {
      for (const r of (av.others || []).filter((x) => x.kind !== 'server')) {
        box.append(h('div', { class: 'db-row' },
          h('code', { class: 'db-cmd', text: `${r.user}@${r.host}` }),
          h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => this.useRunner(r.id) }, t('run.notMine.use'))));
      }
    } else if (reason === 'old-claude' || reason === 'no-claude' || reason === 'not-logged-in') {
      const cmd = reason === 'old-claude' ? 'claude update' : reason === 'not-logged-in' ? 'claude auth login' : 'claude --version';
      box.append(h('div', { class: 'db-row' }, h('code', { class: 'db-cmd', text: cmd }), copyBtn(cmd, false)));
    }
    // 앱 없이도 된다 — 보내기에서 "터미널"을 고르면 설치 없이 지금 쓰는 Claude Code 로(D76)
    if (this.ad.startTerminal && reason !== 'read-only' && reason !== 'disabled') box.append(h('p', { class: 'db-hint' }, t('run.setup.orTerminal')));
    return box;
  }

  private chooser(av: RunsAvailability): HTMLElement {
    const all = [av.runner!, ...(av.others || [])];
    const e = h('select', { onchange: (ev: Event) => this.useRunner((ev.target as HTMLSelectElement).value) }) as HTMLSelectElement;
    for (const r of all) e.append(h('option', { value: r.id, selected: r.id === av.runner!.id, text: `${r.user}@${r.host} · ${r.kind === 'server' ? 'serve' : r.kind === 'app' ? this.t('run.kind.app') : 'runner'}` }));
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
            h('b', { text: r.kind === 'review' ? t(r.goal === 'view' ? 'run.kind.view' : 'run.kind.review', { n: r.docIds?.length || 1 }) : t(r.kind === 'propose' ? 'run.kind.propose' : 'run.kind.handoff', { n: r.feedbackIds.length }) }),
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
    // 자리표시("Claude를 띄우는 중…")·마지막 오류 줄은 로그 줄이 아니다 — 세면 첫 줄(시작)을 건너뛴다. 떼고 세어 맨 뒤에 다시 붙인다
    log.querySelectorAll('.db-ll.ph, .db-ll.err-final').forEach((e) => e.remove());
    const have = full ? 0 : log.querySelectorAll('.db-ll').length;
    const from = full || have > cur.lines.length ? 0 : have;
    if (from === 0) log.replaceChildren();
    for (const l of cur.lines.slice(from)) log.append(this.lineEl(l));
    if (r.error) log.append(h('div', { class: 'db-ll error err-final', text: r.error }));
    if (!cur.lines.length && active) log.append(h('div', { class: 'db-ll muted ph', text: t('run.waiting') }));
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
    const cls: Record<string, string> = { text: 'say', denied: 'warn', toolError: 'warn', 'apply.edit': 'good', 'apply.propose': 'accent', 'apply.ask': 'owner', 'apply.answer': 'good', 'apply.decline': 'muted', skip: 'muted', safe: 'muted', applyFail: 'bad', error: 'bad', timeout: 'bad', canceled: 'muted', done: 'good', warn: 'warn', summary: 'say', 'review.suggest': 'accent', 'review.question': 'owner', 'review.view': 'good', terminal: 'muted' };
    const vv: Record<string, unknown> = { ...v };
    if (v.doc) vv.doc = this.app.docTitle(String(v.doc));
    if (v.section) vv.section = String(v.section).split(' › ').slice(-1)[0];
    if (v.fb) vv.fb = this.fbLabel(String(v.fb));
    vv.note = v.note ? t('run.note.' + v.note) + (v.problem ? ' ' + String(v.problem) : '') : ''; // 꼬리표 없는 줄에 '{note}' 가 그대로 보이지 않게
    if (v.reason) vv.reason = t('run.reason.' + v.reason) === 'run.reason.' + v.reason ? v.reason : t('run.reason.' + v.reason);
    if (l.k === 'start') {
      vv.kind = t('run.kindw.' + (v.kind || 'handoff'));
      if (v.kind === 'review') vv.kind += ' · ' + t('run.sum.docs', { n: v.n || 0 });
      vv.model = v.model || t('run.model.default');
      vv.effort = v.effort ? t('run.effort.' + v.effort) : t('run.effort.default');
      vv.mode = t('run.mode.' + (v.mode || 'auto'));
    }
    if (l.k === 'done') vv.what = (['edited', 'proposed', 'answered', 'asked', 'declined', 'skipped', 'failed'] as const).filter((k) => Number(v[k])).map((k) => t('run.sum.' + k, { n: v[k] })).join(' · ') || t('run.sum.none');
    if (l.k === 'done' || l.k === 'timeout') vv.time = dur(Number(v.ms || 0) || Number(v.sec || 0) * 1000);
    const text = l.k === 'text' || l.k === 'summary' ? (l.k === 'summary' ? t('run.log.summary') + ' ' : '') + (l.text || '') : t('run.log.' + l.k, vv).trim();
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
