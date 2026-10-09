/**
 * 대화상자 — 확인, 짧은 글 받기, 선제안 고르기, 터미널 한 줄, 단축키 도움말. 네이티브 <dialog> 를 쓴다.
 * 피드백 적기는 창이 아니라 그 자리의 입력 칸(composer.ts)이다.
 */
import type { AskOptions, TerminalHandoff } from '../types';
import { h, icon } from './dom';
import type { App } from './app';

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
  /** 띄워 둔 창(쓰던 피드백 등) 위에 잠깐 묻는다 — 끝나면 앞의 창을 쓰던 그대로 되살린다 */
  private stack: Node[][] = [];
  private push(content: HTMLElement): void {
    if (this.dlg.open && this.dlg.childNodes.length) this.stack.push([...this.dlg.childNodes]);
    this.show(content);
  }
  private pop(): void {
    const prev = this.stack.pop();
    if (!prev) { this.close(); return; }
    this.dlg.replaceChildren(...prev);
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

  /** 여러 갈래 중 하나 — 고른 id, 닫으면 null (기록 자리 고르기처럼 사람의 결정이 필요한 순간) */
  choose(o: AskOptions): Promise<string | null> {
    const t = this.app.t;
    return new Promise((resolve) => {
      let done = false;
      const fin = (v: string | null) => { if (done) return; done = true; this.pop(); resolve(v); };
      const btns = o.choices.map((c) => h('button', { class: 'db-btn' + (c.primary ? ' primary' : ''), type: 'button', onclick: () => fin(c.id) }, c.label));
      this.push(h('div', { class: 'db-sheet db-ask' },
        h('h3', { text: o.title }),
        o.body ? h('p', { class: 'db-ask-body', text: o.body }) : null,
        h('div', { class: 'db-ask-choices' }, ...btns),
        o.note ? h('p', { class: 'db-hint', text: o.note }) : null,
        h('div', { class: 'db-sheet-act' }, h('button', { class: 'db-btn ghost', type: 'button', onclick: () => fin(null) }, t('compose.cancel')))));
      this.dlg.addEventListener('close', () => fin(null), { once: true });
      (btns.find((_, i) => o.choices[i].primary) || btns[0])?.focus();
    });
  }

  /** 글 한 줄 받기 — 확인이면 글, 닫으면 null. readOnly 면 보여 주기만 */
  prompt(o: { title: string; label: string; value?: string; placeholder?: string; note?: string; ok?: string; readOnly?: boolean; multiline?: boolean }): Promise<string | null> {
    const t = this.app.t;
    return new Promise((resolve) => {
      let done = false;
      const fin = (v: string | null) => { if (done) return; done = true; this.close(); resolve(v); };
      const input = (o.multiline
        ? h('textarea', { rows: 6, placeholder: o.placeholder || '', maxlength: '4000', readonly: !!o.readOnly })
        : h('input', { type: 'text', value: o.value || '', placeholder: o.placeholder || '', maxlength: '60', readonly: !!o.readOnly, autocomplete: 'nickname' })) as HTMLInputElement;
      if (o.multiline) input.value = o.value || '';
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !o.readOnly && (!o.multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); fin(input.value.trim()); } });
      this.show(h('div', { class: 'db-sheet db-ask' },
        h('h3', { text: o.title }),
        h('label', { class: 'db-field' }, h('span', { text: o.label }), input),
        o.note ? h('p', { class: 'db-hint', text: o.note }) : null,
        h('div', { class: 'db-sheet-act' },
          h('button', { class: 'db-btn', type: 'button', onclick: () => fin(null) }, t(o.readOnly ? 'close' : 'compose.cancel')),
          o.readOnly ? null : h('button', { class: 'db-btn primary', type: 'button', onclick: () => fin(input.value.trim()) }, o.ok || 'OK'))));
      this.dlg.addEventListener('close', () => fin(null), { once: true });
      input.focus(); if (!o.multiline) input.select();
    });
  }

  /** Claude 에게 먼저 검토 받기 — 무엇을(제안·질문 / 읽기 정리), 어디까지(문서·섹션·폴더), 무엇을 중점으로 */
  review(o: { doc: string; section?: string; folder?: { name: string; n: number } }): Promise<{ goal: 'suggest' | 'view'; scope: 'doc' | 'section' | 'folder'; note: string } | null> {
    const t = this.app.t;
    return new Promise((resolve) => {
      let done = false;
      const fin = (v: { goal: 'suggest' | 'view'; scope: 'doc' | 'section' | 'folder'; note: string } | null) => { if (done) return; done = true; this.close(); resolve(v); };
      let goal: 'suggest' | 'view' = 'suggest';
      let scope: 'doc' | 'section' | 'folder' = 'doc';
      const radio = <V extends string>(name: string, v: V, label: string, hint: string, on: (v: V) => void, checked: boolean) => {
        const r = h('input', { type: 'radio', name, value: v, checked }) as HTMLInputElement;
        r.addEventListener('change', () => { if (r.checked) on(v); });
        return h('label', { class: 'db-radio' }, r, h('span', {}, h('b', { text: label }), h('span', { class: 'db-hint', text: hint })));
      };
      const note = h('textarea', { rows: 2, placeholder: t('review.note.ph'), 'aria-label': t('review.note') }) as HTMLTextAreaElement;
      const go = h('button', { class: 'db-btn primary', type: 'button', onclick: () => fin({ goal, scope, note: note.value.trim() }) }, t('review.go'));
      this.show(h('div', { class: 'db-sheet db-ask' },
        h('h3', { text: t('review.title') }),
        h('p', { class: 'db-hint', text: t('review.lead') }),
        h('div', { class: 'db-radios' },
          radio('goal', 'suggest', t('review.goal.suggest'), t('review.goal.suggest.hint'), (v) => { goal = v; }, true),
          radio('goal', 'view', t('review.goal.view'), t('review.goal.view.hint'), (v) => { goal = v; }, false)),
        h('div', { class: 'db-radios' },
          radio('scope', 'doc', t('review.scope.doc', { doc: o.doc }), '', (v) => { scope = v; }, true),
          o.section ? radio('scope', 'section', t('review.scope.section', { sec: o.section }), '', (v) => { scope = v; }, false) : null,
          o.folder ? radio('scope', 'folder', t('review.scope.folder', { dir: o.folder.name, n: o.folder.n }), t('review.scope.folder.hint'), (v) => { scope = v; }, false) : null),
        note,
        h('div', { class: 'db-sheet-act' }, h('button', { class: 'db-btn', type: 'button', onclick: () => fin(null) }, t('compose.cancel')), go)));
      this.dlg.addEventListener('close', () => fin(null), { once: true });
      go.focus();
    });
  }

  /**
   * 터미널에서 칠 한 줄 — 설치 없음(D76). 기록 폴더(Claude 자리)에서 Claude Code 를 켜면 결과 파일을 남기고,
   * 이 화면이 그것을 받아 반영한다.
   */
  /**
   * 터미널 Claude 에게 넘기기. 기록 폴더의 전체 경로를 알면(앱·서버, 또는 사람이 한 번 알려 준 경로) 버튼 하나 —
   * Claude Code 의 deep link 가 새 터미널 창에 요청을 입력해 둔 채로 연다(Enter 만). 모르면 경로를 한 번 묻고, 칠 줄은 늘 함께.
   * rebuild = 사람이 알려 준 경로로 안내를 다시 만든다(브라우저 — 경로를 모르는 쪽)
   */
  terminal(ho: TerminalHandoff, o: { rebuild?: (room: string) => TerminalHandoff | null } = {}): void {
    const t = this.app.t;
    const win = /Windows/.test(navigator.userAgent);
    const leaf = (ho.roomName.split(/[\\/]/).filter(Boolean).pop() || ho.roomName).trim();
    const key = 'docbench:roomPath:' + ho.roomName;
    const recall = (): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
    let cur = ho;
    if (!cur.room && o.rebuild) { const p = recall(); const r = p ? o.rebuild(p) : null; if (r) cur = r; }
    let shell: 'pwsh' | 'sh' = win ? 'pwsh' : 'sh';
    const body = h('div', { class: 'db-sheet db-term' });
    const paint = () => {
      const code = h('pre', { class: 'db-cmdbox', text: cur.command[shell] });
      const tabs = h('div', { class: 'db-seg sm' },
        ...(['pwsh', 'sh'] as const).map((v) => h('button', { type: 'button', 'aria-pressed': String(shell === v), onclick: () => { shell = v; paint(); } }, v === 'pwsh' ? 'PowerShell' : 'bash · zsh')));
      const copy = h('button', { class: 'db-btn', type: 'button', onclick: async () => { const ok = await this.app.copy(cur.command[shell]); this.app.toast(ok ? t('term.copied') : t('run.setup.copyFail')); }, html: icon('copy') + ' ' + t('term.copy') });
      const lineBox = h('div', {}, h('div', { class: 'db-row wrap' }, tabs, copy), code,
        cur.room ? null : h('div', { class: 'db-hint', text: t('term.where', { room: cur.roomName }) + ' ' + (cur.homeName ? t('term.where.home', { home: cur.homeName }) + ' ' : '') + (win ? t('term.where.win') : t('term.where.other')) }));
      // 경로를 모르는 브라우저: 한 번 알려 주면 다음부터 버튼 하나
      let where: HTMLElement | null = null;
      if (!cur.room && o.rebuild) {
        const input = h('input', { type: 'text', class: 'db-input', spellcheck: 'false', 'aria-label': t('term.path.ask'), placeholder: win ? `C:\\...\\${leaf}` : `/.../${leaf}`, value: guessRoom(ho) || '' }) as HTMLInputElement;
        const err = h('div', { class: 'db-hint warn', hidden: true });
        const save = () => {
          const v = input.value.trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '');
          const r = o.rebuild!(v);
          // 끝 폴더 이름이 기록 폴더와 같아야 — 문서 폴더에서 Claude 를 켜게 되는 실수를 막는다(그 폴더의 지시·훅이 섞인다)
          if (!r || (v.split(/[\\/]/).pop() || '') !== leaf) { err.textContent = t('term.path.bad', { name: leaf }); err.hidden = false; input.focus(); return; }
          try { localStorage.setItem(key, v); } catch { /* 이 창에만 */ }
          cur = r; paint();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        where = h('li', {}, h('b', { text: t('term.path.ask') }),
          h('div', { class: 'db-hint', text: win ? t('term.path.how.win') : t('term.path.how.other') }),
          h('div', { class: 'db-row' }, input, h('button', { class: 'db-btn', type: 'button', onclick: save }, t('term.path.save'))), err);
      }
      const open = cur.link
        ? h('li', {}, h('a', { class: 'db-btn primary db-term-open', href: cur.link, onclick: () => this.app.toast(t('term.opened'), { sticky: true }) }, h('span', { class: 'ic', html: icon('spark') }), t('term.open')),
          h('div', { class: 'db-hint', text: t('term.open.hint') }),
          cur.room && !ho.room ? h('button', { class: 'db-link', type: 'button', onclick: () => { try { localStorage.removeItem(key); } catch { /* */ } cur = ho; paint(); } }, t('term.path.change')) : null)
        : null;
      body.replaceChildren(
        h('h3', { text: t('term.title') }),
        h('p', { class: 'db-hint', text: t('term.lead') }),
        h('ol', { class: 'db-steps' },
          open || where,
          open ? h('li', {}, h('details', {}, h('summary', { text: t('term.fallback') }), lineBox)) : h('li', {}, h('b', { text: t('term.run') }), lineBox),
          h('li', {}, t('term.trust')),
          h('li', {}, t('term.after'))),
        h('p', { class: 'db-hint', text: t('term.next') }),
        h('details', { class: 'db-hint' }, h('summary', { text: t('term.why.title') }), h('p', { text: t('term.why') })),
        h('div', { class: 'db-sheet-act' }, h('button', { class: 'db-btn', type: 'button', onclick: () => this.close() }, t('close'))));
    };
    paint();
    this.show(body);
  }

  help(): void {
    const t = this.app.t;
    const rows: [string, string][] = [['j', 'help.j'], ['k', 'help.k'], ['o', 'help.o'], ['e', 'help.e'], ['c', 'help.c'], ['/', 'help.slash'], ['f', 'help.f'], ['1 2 3 0', 'help.num'], ['Ctrl Enter', 'help.ctrlEnter'], ['j k x s e a u r', 'help.panel'], ['?', 'help.q'], ['Esc', 'help.esc']];
    const grid = h('div', { class: 'db-keys' });
    for (const [k, l] of rows) grid.append(h('span', {}, ...k.split(' ').map((x) => h('kbd', { text: x }))), h('span', { text: t(l) }));
    this.show(h('div', { class: 'db-sheet' }, h('h3', { text: t('help.title') }), grid,
      h('div', { class: 'db-sheet-act' }, h('button', { class: 'db-btn', type: 'button', onclick: () => this.close() }, t('close')))));
  }
}

/** 기록 폴더 위치 추정 — 파일로 연 단일 HTML 이면 그 HTML 옆의 보관함(처음 저장할 때 권하는 자리). 사람이 확인한다 */
function guessRoom(ho: TerminalHandoff): string | null {
  try {
    if (location.protocol !== 'file:' || !ho.homeName) return null;
    let dir = decodeURIComponent(location.pathname).replace(/\/[^/]*$/, '');
    const winPath = /^\/[A-Za-z]:\//.test(dir);
    if (winPath) dir = dir.slice(1).replace(/\//g, '\\');
    const sep = winPath ? '\\' : '/';
    return dir + sep + ho.roomName.split('/').join(sep);
  } catch { return null; }
}
