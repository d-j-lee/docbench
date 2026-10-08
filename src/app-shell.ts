/**
 * DocBench 앱 화면 (server/app.mjs 가 내주는 / 와 /embed) — dist/app.js.
 *
 *  - 앱(/): 작업 공간 메뉴(왼쪽 위)에서 폴더를 더하고 바꾼다. 폴더 추가는 이 PC 의 폴더를 둘러보는 창(고르기 창 없음) —
 *    드라이브도 바로 더한다(펼친 곳만 읽는다, D64). 이미 더한 작업 공간 안의 폴더는 그 작업 공간의 범위로, 품는 폴더는 기록을 합친다(D66).
 *    사람은 이 PC 의 로그인(이름은 "나"에서), 기록은 이 PC 의 기록 보관함 — 묻지 않는다.
 *  - 끼움(/embed?root=…&scope=…&t=열쇠): 대시보드 탭의 iframe. 호스트(host.js)와 postMessage 로 테마·넘기기·이동·할 일 수를 주고받는다(D68).
 *    허용한 출처(app.allowOrigins)의 메시지만 받는다 — 서버가 그 목록을 화면에 넣고, frame-ancestors 로 다른 출처는 끼우지도 못한다.
 */
import { createDocBench, createRestAdapters, trimBySession, createMemoryAdapters, version, type DocBenchHandle } from './index';
import { welcomeContent } from './welcome';
import { buildManifest, mergeConfig, titleFromText } from './core/workspace';
import { makeT } from './ui/i18n';
import { h, icon } from './ui/dom';
import type { DocBenchAdapters, DocBenchEvent, DocBenchOptions, WorkspaceMenu } from './types';

interface AppWorkspace { id: string; root: string; name: string; added: boolean; linked: boolean; problem?: string; claude?: { available: boolean; reason?: string; message?: string } }
interface AppInfo { version: string; me: { id: string; name: string }; allowOrigins: string[]; workspaces: AppWorkspace[] }

const meta = (n: string) => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || '';
const mode = meta('docbench-mode') === 'embed' ? 'embed' : 'app';
const q = new URLSearchParams(location.search);
const locale: 'ko' | 'en' = (q.get('lang') || navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
const t = makeT(locale, { v: version });
const LAST = 'docbench:app:last';
const KEY = 'docbench:app:key';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 막힘 */ } },
};
/**
 * 앱 열쇠. 끼움(/embed)은 서버가 화면에 넣은 것(주소의 ?t=), 앱 화면은 처음 연 주소의 ?t= 를 이 출처의 localStorage 에 두고
 * 주소에서 지운다 — 쿠키는 포트를 가리지 않아 다른 로컬 서버로도 실려 가서 쓰지 않는다.
 */
const key = (() => {
  if (mode === 'embed') return meta('docbench-key');
  const fromUrl = q.get('t');
  if (fromUrl && /^[a-f0-9]{32,128}$/.test(fromUrl)) {
    store.set(KEY, fromUrl);
    q.delete('t');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash);
  }
  return store.get(KEY) || '';
})();
class Locked extends Error {}
/** 설치 안내가 CLI 를 두는 자리 (src/core/runs.ts runnerSetupPrompt 와 같은 곳) */
const openCmd = () => /Win/i.test(navigator.platform || navigator.userAgent) ? 'node "%LOCALAPPDATA%\\docbench\\docbench.mjs" app --open'
  : /Mac/i.test(navigator.platform || navigator.userAgent) ? 'node ~/Library/Application\\ Support/docbench/docbench.mjs app --open'
  : 'node ~/.config/docbench/docbench.mjs app --open';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-DocBench'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers.Authorization = 'Bearer ' + key;
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit' });
  if (r.status === 401) { if (mode === 'app') store.set(KEY, null); throw new Locked(); }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.message || data?.error || 'HTTP ' + r.status);
  return data as T;
}

let bench: DocBenchHandle | null = null;
let info: AppInfo;

async function mount(root: HTMLElement, adapters: DocBenchAdapters, o: Partial<DocBenchOptions>): Promise<void> {
  if (bench && location.hash) history.replaceState(null, '', location.pathname + location.search);
  bench?.destroy();
  root.replaceChildren();
  bench = createDocBench(root, { adapters, locale, injectStyles: false, routing: 'hash', shortcuts: 'global', ...o });
  (window as unknown as { docbench: unknown }).docbench = bench;
  await bench.ready;
}

function fail(root: HTMLElement, e: unknown): void {
  if (e instanceof Locked) {
    // 열쇠가 없거나 바뀌었다 — 여는 방법을 알려 준다(열쇠는 이 PC 의 설정 폴더에만 있다)
    bench?.destroy(); bench = null;
    root.replaceChildren(h('div', { class: 'db-locked' }, h('h1', { text: t('app.locked.title') }), h('p', { text: t('app.locked.body') }), h('pre', { class: 'db-cmd', text: openCmd() })));
    return;
  }
  const msg = (e as Error)?.message || String(e);
  if (bench) bench.toast(t('app.fail', { msg }), { sticky: true });
  else root.replaceChildren(h('p', { class: 'db-notice tone-bad', style: 'margin:24px', text: t('app.fail', { msg }) }));
}

// ---------------------------------------------------------------- 앱 (/)

async function appBoot(root: HTMLElement): Promise<void> {
  info = await api<AppInfo>('GET', '/api/app/info');
  const list = info.workspaces;
  const want = q.get('w') || store.get(LAST);
  const pick = list.find((w) => w.id === want) || list.find((w) => w.added) || list[0];
  if (pick) await openWorkspace(root, pick.id, q.get('scope') || '');
  else await welcome(root);
}

function menu(root: HTMLElement, current?: string): WorkspaceMenu {
  return {
    items: () => [
      ...info.workspaces.filter((w) => w.id !== current).map((w) => ({ id: 'ws:' + w.id, label: w.name, hint: w.root + (w.problem ? ' — ' + w.problem : w.added ? '' : ' · ' + t('app.linked')) })),
      { id: 'add', label: t('app.add'), hint: t('app.add.hint'), primary: !current },
      ...(current ? [{ id: 'remove', label: t('app.remove'), hint: t('app.remove.hint') }] : []),
      { id: 'welcome', label: t('ws.welcome') },
    ],
    run: async (id) => {
      try {
        if (id.startsWith('ws:')) await openWorkspace(root, id.slice(3), '');
        else if (id === 'add') await addFolder(root);
        else if (id === 'remove' && current) {
          const w = info.workspaces.find((x) => x.id === current);
          if ((await bench!.ask({ title: t('app.remove.q', { name: w?.name || '' }), body: t('app.remove.body'), choices: [{ id: 'yes', label: t('app.remove'), primary: true }] })) !== 'yes') return;
          await api('DELETE', `/api/app/workspaces/${current}`);
          store.set(LAST, null);
          await appBoot(root);
        } else if (id === 'welcome') await welcome(root);
      } catch (e) { fail(root, e); }
    },
  };
}

async function openWorkspace(root: HTMLElement, id: string, scope: string): Promise<void> {
  const w = info.workspaces.find((x) => x.id === id);
  store.set(LAST, id);
  const rest = createRestAdapters({ base: `/api/w/${id}`, live: 'sse', token: key || undefined });
  const adapters = await trimBySession(rest).catch(() => rest);
  document.title = `${w?.name || 'DocBench'} · DocBench`;
  await mount(root, adapters, { workspace: menu(root, id), scope });
  if (w?.problem) bench?.toast(w.problem, { sticky: true });
}

async function welcome(root: HTMLElement): Promise<void> {
  const w = welcomeContent(locale);
  const manifest = buildManifest(mergeConfig({ title: t('welcome.title') }, 'DocBench'), Object.keys(w.docs), (id) => ({ title: titleFromText(w.docs[id], id) }), '', false, { rootName: t('welcome.root') });
  manifest.project.storage = t('welcome.storage');
  manifest.groups = manifest.groups.filter((g) => g.id !== '_bench');
  const mem = createMemoryAdapters({ manifest, docs: w.docs, feedback: w.feedback, me: { kind: 'human', ...info.me } });
  document.title = `${t('welcome.title')} · DocBench`;
  await mount(root, mem, { workspace: menu(root), initialDoc: Object.keys(w.docs)[0] });
  if (!info.workspaces.length) bench?.toast(t('app.empty'), { action: t('app.add'), onAction: () => void addFolder(root).catch((e) => fail(root, e)) });
}

/** 폴더 추가 — 이 PC 의 폴더를 둘러보고 고른다(폴더 이름만 보인다) */
async function addFolder(root: HTMLElement): Promise<void> {
  const chosen = await browseDialog(root);
  if (!chosen) return;
  type Added = { id?: string; scope?: string; existing?: boolean; needsMerge?: { id: string; root: string; rel: string }[]; kept?: { rel: string }[] };
  let r = await api<Added>('POST', '/api/app/workspaces', { path: chosen });
  if (r.needsMerge) {
    const ok = await bench!.ask({ title: t('app.merge.q'), body: t('app.merge.body', { list: r.needsMerge.map((x) => x.rel).join(', ') }), choices: [{ id: 'merge', label: t('merge.do'), primary: true }], note: t('merge.note') });
    if (ok !== 'merge') return;
    r = await api('POST', '/api/app/workspaces', { path: chosen, merge: true });
  }
  info = await api<AppInfo>('GET', '/api/app/info');
  await openWorkspace(root, r.id!, r.scope || '');
  if (r.existing && r.scope) bench?.toast(t('app.inside', { name: info.workspaces.find((w) => w.id === r.id)?.name || '' }));
  // 안쪽 작업 공간 중 팀 기록(.docbench)을 쓰는 것은 합치지 않고 따로 둔다
  if (r.kept?.length) bench?.toast(t('app.kept', { list: r.kept.map((x) => x.rel).join(', ') }), { sticky: true });
}

function browseDialog(root: HTMLElement): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'db-dialog db-browse' }) as HTMLDialogElement;
    root.append(dlg);
    let settled = false;
    const done = (v: string | null) => { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    const render = async (p: string) => {
      let data: { path: string; parent: string | null; dirs: { name: string; path: string; kind: string }[]; docs?: number; big?: boolean };
      try { data = await api('GET', '/api/app/browse?path=' + encodeURIComponent(p)); } catch (e) { bench?.toast((e as Error).message); return; }
      const list = h('div', { class: 'db-browse-list', role: 'listbox' },
        ...data.dirs.map((d) => h('button', { class: 'db-dir', type: 'button', role: 'option', title: d.path, ondblclick: () => done(d.path), onclick: () => void render(d.path) },
          h('span', { class: 'ic', html: icon(d.kind === 'home' ? 'user' : 'folder') }), h('span', { class: 't', text: d.name }))));
      if (!data.dirs.length) list.append(h('p', { class: 'db-hint', text: t('app.browse.none') }));
      dlg.replaceChildren(h('div', { class: 'db-sheet' },
        h('h3', { text: t('app.add') }),
        h('div', { class: 'db-browse-path' },
          data.path ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void render(data.parent || '') }, '↑ ' + t('app.browse.up')) : null,
          h('code', { text: data.path || t('app.browse.start') })),
        list,
        data.path ? h('p', { class: 'db-hint', text: data.big ? t('app.browse.big') : t('app.browse.docs', { n: data.docs || 0 }) }) : h('p', { class: 'db-hint', text: t('app.browse.tip') }),
        h('div', { class: 'db-sheet-act' },
          h('button', { class: 'db-btn', type: 'button', onclick: () => done(null) }, t('compose.cancel')),
          h('button', { class: 'db-btn primary', type: 'button', disabled: !data.path, onclick: () => done(data.path) }, t('app.browse.pick')))));
    };
    dlg.showModal();
    void render('');
  });
}

// ---------------------------------------------------------------- 끼움 (/embed) — 대시보드 탭

type HostInit = { origin: string; theme?: 'auto' | 'light' | 'dark'; handoff?: boolean; view?: string; tokens?: Record<string, string> };

/** 호스트(host.js)의 인사를 잠깐 기다린다 — 허용한 출처의 것만 */
function waitHost(hosts: string[], ms = 1500): Promise<HostInit | null> {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window.parent || !hosts.includes(e.origin) || e.data?.docbench !== 1 || e.data.type !== 'init') return;
      done = true; window.removeEventListener('message', onMsg);
      resolve({ origin: e.origin, theme: e.data.theme, handoff: !!e.data.handoff, view: typeof e.data.view === 'string' ? e.data.view : undefined, tokens: e.data.tokens });
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ docbench: 1, type: 'hello', version }, '*');   // 비밀 없음 — 호스트가 init 으로 답한다
    setTimeout(() => { if (!done) { window.removeEventListener('message', onMsg); resolve(null); } }, ms);
  });
}

/** 호스트가 준 모양 값 — --db-* 토큰만, 색·글꼴로 보이는 값만 */
function applyTokens(root: HTMLElement, tokens?: Record<string, string>): void {
  if (!tokens || typeof tokens !== 'object') return;
  for (const [k, v] of Object.entries(tokens)) if (/^--db-[a-z0-9-]{1,40}$/.test(k) && typeof v === 'string' && /^[#\w\s,.'"()%-]{1,120}$/.test(v)) root.style.setProperty(k, v);
}

async function embedBoot(root: HTMLElement): Promise<void> {
  const hosts = meta('docbench-hosts').split(' ').filter(Boolean);
  const framed = window.parent !== window;
  const host = framed && hosts.length ? await waitHost(hosts) : null;
  const path = q.get('root') || '';
  if (!path) { root.replaceChildren(h('p', { class: 'db-notice', style: 'margin:24px', text: t('app.embed.noRoot') })); return; }
  const r = await api<{ id?: string; scope?: string; needsMerge?: unknown[] }>('POST', '/api/app/workspaces', { path });
  if (!r.id) { root.replaceChildren(h('p', { class: 'db-notice tone-bad', style: 'margin:24px', text: t('app.embed.merge') })); return; }
  const rest = createRestAdapters({ base: `/api/w/${r.id}`, live: 'sse', token: key || undefined });
  const adapters = await trimBySession(rest).catch(() => rest);
  const scope = [r.scope, q.get('scope')].filter(Boolean).join('/');
  const post = (msg: Record<string, unknown>) => { if (host) window.parent.postMessage({ docbench: 1, ...msg }, host.origin); };
  const pending = new Map<string, (v: { handled: boolean; message?: string }) => void>();
  const theme = (host?.theme || q.get('theme') || 'auto') as 'auto' | 'light' | 'dark';
  await mount(root, adapters, {
    chrome: 'embedded', scope, theme, routing: 'none', shortcuts: 'scoped', initialDoc: host?.view,
    host: host?.handoff ? {
      handoff: (req) => new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        pending.set(id, resolve);
        post({ type: 'handoff', id, ...req });
        setTimeout(() => { if (pending.delete(id)) resolve({ handled: false }); }, 15000);
      }),
    } : undefined,
    onEvent: (ev: DocBenchEvent) => post({ type: 'event', event: slimEvent(ev) }),
  });
  applyTokens(root, host?.tokens);
  if (host) {
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || e.origin !== host.origin || e.data?.docbench !== 1) return;
      const d = e.data;
      if (d.type === 'theme' && ['auto', 'light', 'dark'].includes(d.theme)) bench?.setTheme(d.theme);
      else if (d.type === 'navigate' && typeof d.view === 'string') void bench?.navigate(d.view);
      else if (d.type === 'tokens') applyTokens(root, d.tokens);
      else if (d.type === 'handoff:result' && typeof d.id === 'string') { const f = pending.get(d.id); if (f) { pending.delete(d.id); f({ handled: !!d.handled, message: typeof d.message === 'string' ? d.message : undefined }); } }
    });
  }
}

/** 호스트로 보낼 이벤트 — 문서 내용·피드백 본문은 빼고 id·상태만 */
function slimEvent(ev: DocBenchEvent): Record<string, unknown> {
  switch (ev.type) {
    case 'feedback:created': case 'feedback:updated': return { type: ev.type, id: ev.feedback.id, docId: ev.feedback.docId, status: ev.feedback.status, waitingOn: ev.feedback.waitingOn };
    case 'error': return { type: 'error', message: ev.message };
    default: return { ...ev };
  }
}

// ---------------------------------------------------------------- 시작

const el = document.getElementById('app');
if (el) void (mode === 'embed' ? embedBoot(el) : appBoot(el)).catch((e) => fail(el, e));
