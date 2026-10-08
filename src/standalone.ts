/**
 * 서버 없는 단일 HTML(dist/docbench.html)의 부트스트랩.
 * 파일 하나를 엣지·크롬으로 열고 문서 폴더를 고르면 그 폴더를 직접 읽고 쓴다(폴더 어댑터).
 *
 *   ?pick       기억한 폴더를 자동으로 열지 않고 처음 화면
 *   ?lang=en    화면 말
 *   ?name=이름  피드백 작성자 이름(처음 화면의 입력과 같다)
 *
 * 기록(피드백·이력·작업)은 기본으로 문서 폴더 밖 "기록 보관함"(사람이 고른 폴더, 예: 이 HTML 옆) 아래 <문서 폴더 이름>/ 에 둔다(D57) —
 * 문서 폴더에는 아무것도 만들지 않아 같은 폴더에서 일하는 다른 프로그램(다른 Claude 세션 등)이 헷갈리지 않는다.
 * 팀이 git 으로 함께 쓰려면 문서 폴더 안 .docbench 를 고를 수 있다. 예전 안쪽 기록은 보관함으로 옮길 수 있다.
 */
import { createDocBench, version, type DocBenchHandle } from './index';
import { createFolderAdapters, type FolderAdapters } from './adapters/folder';
import { fsFromHandle, fsFromFiles, subFs, copyTree, type FsLike } from './adapters/folder-fs';
import { dataFolderCandidates, HOME_MARKER, DATA_MARKER, jsonFile, newDataMarker, parseDataMarker, sameDocsFolder, nextDocsSample, walkable } from './core/workspace';
import { liveRunners } from './core/runs';
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

/** 실행기 설치 안내에 넣을 CLI 주소·지문 — 빌드(scripts/build.mjs)가 같은 판의 release/docbench.mjs 로 채운다 */
const runnerSetup = typeof __DOCBENCH_CLI_URL__ !== 'undefined' && __DOCBENCH_CLI_URL__
  ? { version, cliUrl: __DOCBENCH_CLI_URL__, sha256: __DOCBENCH_CLI_SHA256__ }
  : undefined;

/** 기록 자리: 밖(보관함 핸들) 또는 안(.docbench) */
type DataChoice = { home: FileSystemDirectoryHandle; name: string } | { inside: true };
const INSIDE_KEY = (docs: string) => `docbench:standalone:inside:${docs}`;

/** 보관함 아래 이 문서 폴더의 기록 폴더 */
const dataFsOf = (home: FileSystemDirectoryHandle, name: string) => subFs(fsFromHandle(home), name);

/** 문서 폴더의 마크다운 몇 개(표본) — 이름이 같은 다른 문서 폴더의 기록을 가려낸다(브라우저는 경로를 모른다) */
async function docIdsOf(fs: FsLike, limit = 400): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || out.length >= limit) return;
    for (const e of (await fs.list(dir).catch(() => null)) || []) {
      if (out.length >= limit) return;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === 'directory') { if (walkable(e.name)) await walk(rel, depth + 1); }
      else if (/\.(md|markdown)$/i.test(e.name)) out.push(rel);
    }
  };
  await walk('', 0);
  return out;
}

/**
 * 보관함 안에서 이 문서 폴더의 기록 폴더 이름: '<이름>', '<이름> (2)' … 중 표식의 문서 표본이 겹치는 것,
 * 없으면 처음 빈 자리. 이름이 같은 다른 문서 폴더의 기록과 섞이지 않게(D61).
 */
async function dataNameFor(home: FileSystemDirectoryHandle, docs: FileSystemDirectoryHandle): Promise<string> {
  const hf = fsFromHandle(home);
  const ids = await docIdsOf(fsFromHandle(docs));
  let free: string | null = null;
  for (const name of dataFolderCandidates(docs.name)) {
    const ents = await hf.list(name);
    if (!ents) { free ??= name; continue; }
    const f = await hf.read(`${name}/${DATA_MARKER}`);
    let m = null;
    try { m = f ? parseDataMarker(JSON.parse(new TextDecoder().decode(f.bytes))) : null; } catch { m = null; }
    if (m) { if (sameDocsFolder(m, ids)) return name; continue; }
    if (!ents.length) free ??= name;
  }
  if (!free) throw new Error(t('data.bad.full', { name: docs.name }));
  return free;
}

async function open(root: HTMLElement, fs: FsLike, name: string, choice: DataChoice = { inside: true }): Promise<void> {
  const outside = 'home' in choice;
  adapters = await createFolderAdapters(fs, { userName: name || undefined, locale, runnerSetup, ...(outside ? { data: dataFsOf(choice.home, choice.name), dataHome: choice.home.name, dataName: choice.name } : {}) });
  // 실행기(이 PC 로그인 이름)와 이름을 맞추자는 제안을 받아들이면: 이름을 바꿔 다시 연다
  root.addEventListener('docbench:rename', (e) => {
    const n = String((e as CustomEvent).detail?.name || '').trim();
    if (!n) return;
    store.set(NAME_KEY, n);
    const u = new URL(location.href);
    u.searchParams.delete('name');
    location.replace(u.toString());
  }, { once: true });
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

  const fail = (e: unknown) => {
    const n = (e as DOMException)?.name;
    say(n === 'SecurityError' ? t('start.blocked') : n === 'NotAllowedError' ? t('start.denied') : t('start.fail', { msg: (e as Error)?.message || String(e) }));
  };
  const run = async (fn: () => Promise<FsLike | null>) => {
    say(t('start.opening'), true);
    try {
      const fs = await fn();
      if (!fs) { say(''); return; }
      await open(root, fs, name());
    } catch (e) { fail(e); }
  };
  /** 문서 폴더를 얻은 뒤: 기록 자리를 정하고(필요하면 묻고) 연다 */
  const withDocs = async (dir: FileSystemDirectoryHandle) => {
    say(t('start.opening'), true);
    try {
      const choice = await chooseData(dir, step, say);
      if (!choice) { step.replaceChildren(); say(''); return; }
      say(t('start.opening'), true);
      await open(root, fsFromHandle(dir), name(), choice);
    } catch (e) { fail(e); }
  };
  const openNew = () => { if (needName()) return; void (async () => {
    try {
      const dir = await pickFolder();
      if (!dir) return;
      if (!(await ensurePermission(dir))) throw new DOMException('denied', 'NotAllowedError');
      if (persist) await rememberFolder(dir);
      await withDocs(dir);
    } catch (e) { fail(e); }
  })(); };
  const reopen = () => { if (needName()) return; void (async () => {
    try {
      if (!remembered || !(await ensurePermission(remembered))) throw new DOMException('denied', 'NotAllowedError');
      await withDocs(remembered);
    } catch (e) { fail(e); }
  })(); };
  /** 두 번째 단계(기록 자리 고르기)가 그려질 곳 */
  const step = h('div', { class: 'db-start-step' });
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
    h('p', { text: t('start.where2') }),
    canWrite ? h('label', { class: 'db-start-name' }, h('span', { class: 'l', text: t('start.name') }), nameInput,
      h('span', { class: 'db-start-note' }, h('b', { text: t('start.name.important') }), ' ', t('start.name.hint'), h('br'), h('small', { text: t('start.name.how') }))) : null,
    acts, step, picker, msg,
    h('small', { text: t('start.foot') }),
  )));
}

/**
 * 고른 폴더를 기억할지. file:// 은 모든 로컬 HTML 파일이 한 출처를 나눠 써서, 같은 브라우저로 연 다른 HTML 파일
 * (예: 메일로 받은 첨부)이 기억한 폴더 핸들을 꺼내 읽고 쓸 수 있다(독립 검토에서 재현) — 그래서 파일로 열면 기억하지 않는다.
 */
const persist = location.protocol !== 'file:';


export async function boot(root: HTMLElement): Promise<void> {
  if (!persist) await forgetFolder();   // 예전 판이 file:// 에 남긴 핸들도 지운다
  const remembered = folderAccessSupported() && persist ? await recallFolder() : null;
  // 권한이 이미 있으면(브라우저가 "항상 허용"을 기억) 바로 연다. ?pick 이면 처음 화면
  const knownName = q.get('name') || store.get(NAME_KEY) || '';
  if (remembered && knownName && !q.has('pick') && (await ensurePermission(remembered, 'readwrite', false).catch(() => false))) {
    // 기록 자리도 묻지 않고 정해지면(기억한 보관함·안에 두기로 한 폴더) 바로 연다
    const quiet = await quietChoice(remembered);
    if (quiet) { try { await open(root, fsFromHandle(remembered), knownName, quiet); return; } catch { /* 처음 화면으로 */ } }
  }
  startScreen(root, remembered);
}

/** 시험용: 이미 가진 폴더 핸들(OPFS 등)로 바로 연다. home 을 주면 기록은 그 보관함 아래(밖), 아니면 문서 폴더 안 */
export async function openHandle(root: HTMLElement, dir: FileSystemDirectoryHandle, name = '', home?: FileSystemDirectoryHandle): Promise<FolderAdapters> {
  const dn = home ? await prepareHome(home, dir) : '';
  await open(root, fsFromHandle(dir), name, home ? { home, name: dn } : { inside: true });
  return adapters!;
}

/** 시험용: 처음 화면의 기록 자리 단계를 그 폴더 핸들로(고르기 창 대신) */
export async function startWith(root: HTMLElement, dir: FileSystemDirectoryHandle, name: string, pickHome: () => Promise<FileSystemDirectoryHandle | null>): Promise<void> {
  testPickHome = pickHome;
  store.set(NAME_KEY, name);
  startScreen(root, null);
  const step = root.querySelector('.db-start-step') as HTMLElement;
  const msg = root.querySelector('.db-start-msg') as HTMLElement;
  const choice = await chooseData(dir, step, (text) => { msg.textContent = text; });
  if (choice) await open(root, fsFromHandle(dir), name, choice);
}
let testPickHome: (() => Promise<FileSystemDirectoryHandle | null>) | null = null;

// ---------------------------------------------------------------- 기록 자리

const isDir = async (dir: FileSystemDirectoryHandle, name: string) => { try { await dir.getDirectoryHandle(name); return true; } catch { return false; } };

/** 묻지 않고 정할 수 있으면: 기억한 보관함(문서 폴더 안 기록이 없을 때) · 이 문서 폴더는 안에 두기로 함 */
async function quietChoice(docs: FileSystemDirectoryHandle): Promise<DataChoice | null> {
  const hasInside = await isDir(docs, '.docbench');
  if (hasInside && store.get(INSIDE_KEY(docs.name)) === '1') return { inside: true };
  if (hasInside) return null;
  const home = persist ? await recallFolder('home') : null;
  if (home && (await ensurePermission(home, 'readwrite', false).catch(() => false)) && !(await homeProblem(home, docs))) return { home, name: await prepareHome(home, docs) };
  return null;
}

/** 보관함으로 쓸 수 없는 이유 (없으면 null): 문서 폴더 자체·문서 폴더 안·문서 폴더를 품은 곳 */
async function homeProblem(home: FileSystemDirectoryHandle, docs: FileSystemDirectoryHandle): Promise<string | null> {
  if (await home.isSameEntry(docs)) return t('data.bad.same');
  if (await docs.resolve(home)) return t('data.bad.insideDocs');
  if (await home.resolve(docs)) return t('data.bad.holdsDocs');
  return null;
}

/** 보관함 표식(없으면)과 이 문서 폴더의 기록 폴더(이름을 정하고 표식) — 기록 폴더 이름을 돌려준다 */
async function prepareHome(home: FileSystemDirectoryHandle, docs: FileSystemDirectoryHandle, name?: string): Promise<string> {
  const hf = fsFromHandle(home);
  if (!(await hf.stat(HOME_MARKER))) await hf.write(HOME_MARKER, jsonFile({ protocol: 1, createdAt: new Date().toISOString() }));
  const dn = name || (await dataNameFor(home, docs));
  const df = dataFsOf(home, dn);
  if (!(await df.stat(DATA_MARKER))) await df.write(DATA_MARKER, jsonFile(newDataMarker(docs.name, undefined, await docIdsOf(fsFromHandle(docs)))));
  return dn;
}

/**
 * 기록 자리를 정한다. 기억한 보관함이 있으면 그것, 아니면 묻는다:
 *   - 기록 보관함 고르기(권장) — 문서 폴더에는 아무것도 생기지 않는다
 *   - 문서 폴더 안에 두기(.docbench) — 팀이 git 으로 함께 쓸 때
 * 문서 폴더 안에 예전 기록이 있으면: 보관함으로 옮기기 / 안에서 계속.
 */
async function chooseData(docs: FileSystemDirectoryHandle, step: HTMLElement, say: (text: string, info?: boolean) => void): Promise<DataChoice | null> {
  const quiet = await quietChoice(docs);
  if (quiet) return quiet;
  const hasInside = await isDir(docs, '.docbench');
  const remembered = persist ? await recallFolder('home') : null;
  say('');
  return new Promise<DataChoice | null>((resolve) => {
    const done = (c: DataChoice | null) => { step.replaceChildren(); resolve(c); };
    /** fresh = 기억한 보관함 대신 새로 고른다, migrate = 안쪽 기록을 옮긴다 */
    const useHome = async (fresh: boolean, migrate: boolean) => {
      try {
        let home = !fresh && remembered && (await ensurePermission(remembered).catch(() => false)) ? remembered : null;
        if (!home) home = testPickHome ? await testPickHome() : await pickFolder('docbench-home');
        if (!home) return;
        if (!(await ensurePermission(home))) throw new DOMException('denied', 'NotAllowedError');
        const bad = await homeProblem(home, docs);
        if (bad) { say(bad); return; }
        const hf = fsFromHandle(home);
        if (!(await hf.stat(HOME_MARKER))) {
          // 다른 파일이 있는 폴더를 보관함으로 — 한 번 확인한다(보관함 안에는 문서 폴더마다 폴더 하나와 표식 파일만 생긴다)
          const ents = (await hf.list('')) || [];
          if (ents.length && !testPickHome && !window.confirm(t('data.home.notEmpty', { name: home.name }))) return;
        }
        const dn = await dataNameFor(home, docs);
        if (migrate) { say(t('data.move.doing'), true); await migrateInside(docs, dataFsOf(home, dn)); }
        await prepareHome(home, docs, dn);
        if (persist) await rememberFolder(home, 'home');
        store.set(INSIDE_KEY(docs.name), '');
        done({ home, name: dn });
      } catch (e) {
        const n = (e as DOMException)?.name;
        say(n === 'NotAllowedError' ? t('start.denied') : n === 'SecurityError' ? t('start.blocked') : (e as Error)?.message || String(e));
      }
    };
    const useInside = () => { store.set(INSIDE_KEY(docs.name), '1'); done({ inside: true }); };
    const primary = hasInside ? t('data.move') : remembered ? t('data.home.use', { name: remembered.name }) : t('data.home.pick');
    step.replaceChildren(h('div', { class: 'db-start-data' },
      h('b', { text: t(hasInside ? 'data.q.hasInside' : 'data.q') }),
      h('p', { text: t(hasInside ? 'data.lead.hasInside' : 'data.lead') }),
      h('div', { class: 'db-start-acts' },
        h('button', { class: 'db-btn primary', type: 'button', onclick: () => void useHome(false, hasInside), text: primary }),
        remembered ? h('button', { class: 'db-btn', type: 'button', onclick: () => void useHome(true, hasInside), text: t('data.home.other') }) : null,
        h('button', { class: 'db-btn ghost', type: 'button', onclick: useInside, text: t(hasInside ? 'data.inside.keep' : 'data.inside') })),
      h('small', { text: t(persist ? 'data.note' : 'data.note.file') })));
    (step.querySelector('.db-btn.primary') as HTMLElement | null)?.focus();
  });
}

/**
 * 문서 폴더 안 .docbench 를 보관함 아래 기록 폴더로 옮긴다(D59): 실행기·서버가 그 기록을 쓰고 있으면 멈추고,
 * 표식에 "옮기는 중"을 먼저 적고 → 복사(잠금 빼고, 덮어씀) → 안쪽 파일이 모두 같은지 확인 → 안쪽을 지우고 → 표식을 마친다.
 * 도중에 끊기면(창을 닫음·파일 잠김) 다시 "옮기기"로 이어 간다 — 보관함 쪽은 지우지 않고 안쪽을 다시 덮어 복사한다.
 * 이미 다른 기록이 있는 자리(옮기는 중이 아님)에는 덮지 않는다.
 */
async function migrateInside(docs: FileSystemDirectoryHandle, data: FsLike): Promise<void> {
  const docsFs = fsFromHandle(docs);
  const inside = subFs(docsFs, '.docbench');
  const runners: unknown[] = [];
  for (const e of (await inside.list('runners')) || []) {
    const f = e.kind === 'file' && e.name.endsWith('.json') ? await inside.read(`runners/${e.name}`) : null;
    if (f) { try { runners.push(JSON.parse(new TextDecoder().decode(f.bytes))); } catch { /* 깨진 파일 */ } }
  }
  if (liveRunners(runners).length) throw new Error(t('data.move.busy'));
  const mf = await data.read(DATA_MARKER);
  let marker = null;
  try { marker = mf ? parseDataMarker(JSON.parse(new TextDecoder().decode(mf.bytes))) : null; } catch { marker = null; }
  if (((await data.list('')) || []).some((e) => e.name !== DATA_MARKER) && !marker?.migrating) throw new Error(t('data.move.exists'));
  const ids = await docIdsOf(docsFs);
  await data.write(DATA_MARKER, jsonFile({ ...(marker || newDataMarker(docs.name)), docsName: marker?.docsName || docs.name, docs: nextDocsSample(marker?.docs, ids), migrating: true }));
  const skip = ['locks', '.gitignore'];
  await copyTreeExcept(inside, data, skip);
  // 같은지 확인 — 하나라도 다르면 안쪽을 지우지 않는다
  for (const p of await allFiles(inside, skip)) {
    const a = await inside.read(p), b = await data.read(p);
    if (!a || !b || a.bytes.length !== b.bytes.length || a.bytes.some((x, i) => x !== b.bytes[i])) throw new Error(t('data.move.verify', { path: p }));
  }
  try { await docsFs.removeDir!('.docbench'); } catch (e) { throw new Error(t('data.move.removeFail', { msg: (e as Error)?.message || String(e) })); }
  const done = parseDataMarker(JSON.parse(new TextDecoder().decode((await data.read(DATA_MARKER))!.bytes)))!;
  delete done.migrating;
  await data.write(DATA_MARKER, jsonFile(done));
}
async function allFiles(fs: FsLike, skip: string[], dir = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of (await fs.list(dir)) || []) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (!dir && skip.includes(e.name)) continue;
    if (e.kind === 'directory') out.push(...(await allFiles(fs, skip, p))); else out.push(p);
  }
  return out;
}
async function copyTreeExcept(from: FsLike, to: FsLike, skip: string[]): Promise<number> {
  let n = 0;
  for (const e of (await from.list('')) || []) {
    if (skip.includes(e.name)) continue;
    if (e.kind === 'directory') n += await copyTree(subFs(from, e.name), subFs(to, e.name));
    else { const f = await from.read(e.name); if (f) { await to.write(e.name, f.bytes); n++; } }
  }
  return n;
}

const el = document.getElementById('app');
if (el && !(window as unknown as { DOCBENCH_NO_BOOT?: boolean }).DOCBENCH_NO_BOOT) void boot(el);
(window as unknown as { DocBenchStandalone: unknown }).DocBenchStandalone = { boot, openHandle, startWith, get adapters() { return adapters; }, get bench() { return bench; } };
