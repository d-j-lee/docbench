/**
 * 서버 없는 단일 HTML(dist/docbench.html)의 부트스트랩.
 * 파일 하나를 엣지·크롬으로 열고 문서 폴더를 고르면 그 폴더를 직접 읽고 쓴다(폴더 어댑터).
 *
 *   ?pick       기억한 폴더를 자동으로 열지 않고 처음 화면
 *   ?lang=en    화면 말
 *   ?name=이름  피드백 작성자 이름(처음 화면의 입력과 같다)
 */
import { createDocBench, version, type DocBenchHandle } from './index';
import { createFolderAdapters, type FolderAdapters } from './adapters/folder';
import { fsFromHandle, fsFromFiles, type FsLike } from './adapters/folder-fs';
import { pickFolder, ensurePermission, rememberFolder, recallFolder, forgetFolder, folderAccessSupported } from './adapters/folder-pick';
import { makeT } from './ui/i18n';
import { h } from './ui/dom';

const q = new URLSearchParams(location.search);
const locale: 'ko' | 'en' = (q.get('lang') || navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
const t = makeT(locale, { v: version });
const NAME_KEY = 'docbench:standalone:name';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 저장소가 막혀도 동작 */ } },
};

let bench: DocBenchHandle | null = null;
let adapters: FolderAdapters | null = null;

async function open(root: HTMLElement, fs: FsLike, name: string): Promise<void> {
  adapters = await createFolderAdapters(fs, { userName: name || undefined, locale });
  // 다른 폴더로 바꾸는 길 — 작업대 아래 링크(새 탭에서 처음 화면)
  const manifest = adapters.docs.manifest.bind(adapters.docs);
  adapters.docs.manifest = async () => {
    const m = await manifest();
    m.project.links = [...(m.project.links || []), { label: t('start.switch'), url: '?pick' }];
    return m;
  };
  document.title = `${fs.name} · DocBench`;
  root.replaceChildren();
  bench = createDocBench(root, { adapters, locale, routing: 'hash', shortcuts: 'global', injectStyles: false });
  (window as unknown as { docbench: unknown }).docbench = bench;
  await bench.ready;
}

function startScreen(root: HTMLElement, remembered: FileSystemDirectoryHandle | null): void {
  root.className = 'docbench';
  root.dataset.theme = 'auto';
  const msg = h('p', { class: 'db-start-msg', role: 'status' });
  const say = (text: string, info = false) => { msg.textContent = text; msg.classList.toggle('info', info); };
  const nameInput = h('input', { type: 'text', value: q.get('name') || store.get(NAME_KEY) || '', autocomplete: 'name', maxlength: '60', required: true }) as HTMLInputElement;
  const name = () => { const v = nameInput.value.trim(); if (v) store.set(NAME_KEY, v); return v; };
  const canWrite = folderAccessSupported() && window.isSecureContext;
  // 쓰기는 이름이 있어야 한다 — 비우면 모두가 같은 'me' 가 되어 남의 피드백이 '내 것'으로 보이고 보기 상태가 섞인다
  const needName = () => { if (name()) return false; say(t('start.name.need')); nameInput.focus(); return true; };

  const run = async (fn: () => Promise<FsLike | null>) => {
    say(t('start.opening'), true);
    try {
      const fs = await fn();
      if (!fs) { say(''); return; }
      await open(root, fs, name());
    } catch (e) {
      const n = (e as DOMException)?.name;
      say(n === 'SecurityError' ? t('start.blocked') : n === 'NotAllowedError' ? t('start.denied') : t('start.fail', { msg: (e as Error)?.message || String(e) }));
    }
  };
  const openNew = () => { if (needName()) return; void run(async () => {
    const dir = await pickFolder();
    if (!dir) return null;
    if (!(await ensurePermission(dir))) throw new DOMException('denied', 'NotAllowedError');
    if (persist) await rememberFolder(dir);
    return fsFromHandle(dir);
  }); };
  const reopen = () => { if (needName()) return; void run(async () => {
    if (!remembered || !(await ensurePermission(remembered))) throw new DOMException('denied', 'NotAllowedError');
    return fsFromHandle(remembered);
  }); };
  // 다른 브라우저·http 주소: <input webkitdirectory> 로 읽기만
  const picker = h('input', { type: 'file', hidden: true, webkitdirectory: true, multiple: true }) as HTMLInputElement;
  picker.addEventListener('change', () => { const files = picker.files; if (files?.length) void run(async () => fsFromFiles(files)); });

  const acts = h('div', { class: 'db-start-acts' },
    canWrite ? h('button', { class: 'db-btn primary', type: 'button', onclick: openNew, text: t('start.open') }) : null,
    canWrite && remembered ? h('button', { class: 'db-btn', type: 'button', onclick: reopen, text: t('start.reopen', { name: remembered.name }) }) : null,
    h('button', { class: canWrite ? 'db-btn ghost' : 'db-btn primary', type: 'button', onclick: () => picker.click(), text: t('start.readonly') }),
  );
  if (!canWrite) say(folderAccessSupported() ? t('start.insecure') : t('start.unsupported'), true);
  else if (!persist) say(t('start.forget'), true);
  root.replaceChildren(h('div', { class: 'db-start-wrap' }, h('section', { class: 'db-start', 'aria-labelledby': 'db-start-title' },
    h('div', { class: 'db-brand' }, h('span', { class: 'db-logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('b', { text: 'DocBench' })),
    h('h1', { id: 'db-start-title', text: t('start.title') }),
    h('p', { text: t('start.lead') }),
    h('p', { html: escapeHtml(t('start.where', { dir: '\u0000' })).replace('\u0000', '<code>.docbench/</code>') }),
    canWrite ? h('label', null, t('start.name'), h('span', { text: t('start.name.hint') }), nameInput) : null,
    acts, picker, msg,
    h('small', { text: t('start.foot') }),
  )));
}

/**
 * 고른 폴더를 기억할지. file:// 은 모든 로컬 HTML 파일이 한 출처를 나눠 써서, 같은 브라우저로 연 다른 HTML 파일
 * (예: 메일로 받은 첨부)이 기억한 폴더 핸들을 꺼내 읽고 쓸 수 있다(독립 검토에서 재현) — 그래서 파일로 열면 기억하지 않는다.
 */
const persist = location.protocol !== 'file:';

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export async function boot(root: HTMLElement): Promise<void> {
  if (!persist) await forgetFolder();   // 예전 판이 file:// 에 남긴 핸들도 지운다
  const remembered = folderAccessSupported() && persist ? await recallFolder() : null;
  // 권한이 이미 있으면(브라우저가 "항상 허용"을 기억) 바로 연다. ?pick 이면 처음 화면
  const knownName = q.get('name') || store.get(NAME_KEY) || '';
  if (remembered && knownName && !q.has('pick') && (await ensurePermission(remembered, 'readwrite', false).catch(() => false))) {
    try { await open(root, fsFromHandle(remembered), knownName); return; } catch { /* 처음 화면으로 */ }
  }
  startScreen(root, remembered);
}

/** 시험용: 이미 가진 폴더 핸들(OPFS 등)로 바로 연다 */
export async function openHandle(root: HTMLElement, dir: FileSystemDirectoryHandle, name = ''): Promise<FolderAdapters> {
  await open(root, fsFromHandle(dir), name);
  return adapters!;
}

const el = document.getElementById('app');
if (el && !(window as unknown as { DOCBENCH_NO_BOOT?: boolean }).DOCBENCH_NO_BOOT) void boot(el);
(window as unknown as { DocBenchStandalone: unknown }).DocBenchStandalone = { boot, openHandle, get adapters() { return adapters; }, get bench() { return bench; } };
