/**
 * 서버 없는 단일 HTML(dist/docbench.html)의 부트스트랩.
 *
 * 처음 열면 **작업대가 바로** 뜬다(D63) — 이름을 묻지 않고(계정은 이 브라우저에 저절로), 폴더도 묻지 않는다.
 * "시작하기" 작업 공간(메모리, 저장 안 함)에서 둘러보고, 왼쪽 위 작업 공간 메뉴의 "폴더 열기"로 내 폴더를 연다.
 *
 *   ?pick       기억한 폴더를 자동으로 열지 않고 시작하기
 *   ?lang=en    화면 말
 *   ?name=이름  표시 이름(별명)
 *
 * 폴더를 열면 탐색기처럼 펼친 곳만 읽는다(D64). 기록(피드백·이력·작업)은 문서 폴더 밖 "기록 보관함"(사람이 고른 폴더, 예: 이 HTML 옆)
 * 아래 <문서 폴더 이름>/ 에 두며(D57), **처음 저장할 때** 한 번 고른다(D65) — 보기만 할 때는 아무것도 묻지 않는다.
 * 주소(localhost·https)로 열면 고른 폴더를 기억하고, 파일로 열면 기억하지 않는다(D36 — 다른 로컬 HTML 이 꺼내 쓸 수 있어서).
 * 팀이 git 으로 함께 쓰는 문서 폴더 안 .docbench 가 있으면 그것을 쓴다(밖으로 옮길 수 있다).
 * 하위 폴더를 따로 열어 쓰던 기록이 같은 보관함에 있으면, 넓은 폴더를 열 때 합치자고 한다(D66).
 */
import { createDocBench, version, type DocBenchHandle } from './index';
import { createFolderAdapters, type FolderAdapters, type DataAttach } from './adapters/folder';
import { createMemoryAdapters } from './adapters/memory';
import { fsFromHandle, fsFromFiles, subFs, copyTree, type FsLike } from './adapters/folder-fs';
import { dataFolderCandidates, HOME_MARKER, DATA_MARKER, jsonFile, newDataMarker, parseDataMarker, sameDocsFolder, nextDocsSample, walkable, buildManifest, mergeConfig, titleFromText, lockKey, safeName } from './core/workspace';
import { mergeRecords } from './core/records';
import { liveRunners } from './core/runs';
import { pickFolder, ensurePermission, rememberFolder, recallFolder, forgetFolder, folderAccessSupported } from './adapters/folder-pick';
import { welcomeContent, demoRuns } from './welcome';
import { makeT } from './ui/i18n';
import type { DocBenchAdapters, WorkspaceMenu } from './types';

const q = new URLSearchParams(location.search);
const locale: 'ko' | 'en' = (q.get('lang') || navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
const t = makeT(locale, { v: version });
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 저장소가 막혀도 동작 */ } },
};

// ---------------------------------------------------------------- 계정 (D63)

const ACCOUNT_KEY = 'docbench:account';
/** 예전 판의 이름 칸 — 있으면 그 이름이 계정·표시 이름이 된다(예전 피드백이 계속 "내 것") */
const LEGACY_NAME_KEY = 'docbench:standalone:name';
type Account = { id: string; name?: string };

/** 이 브라우저의 계정. 처음이면 만든다 — 이름을 묻지 않는다 */
function account(): Account {
  try {
    const a = JSON.parse(store.get(ACCOUNT_KEY) || 'null');
    if (a && typeof a.id === 'string' && a.id) {
      const nm = q.get('name')?.trim();
      return nm && nm !== a.name ? saveAccount({ id: a.id, name: nm.slice(0, 60) }) : { id: a.id, ...(typeof a.name === 'string' && a.name ? { name: a.name } : {}) };
    }
  } catch { /* 새로 */ }
  const legacy = (q.get('name') || store.get(LEGACY_NAME_KEY) || '').trim();
  if (legacy) return saveAccount({ id: safeName(legacy), name: legacy.slice(0, 60) });
  const rnd = new Uint8Array(5);
  crypto.getRandomValues(rnd);
  return saveAccount({ id: 'u-' + Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('') });
}
function saveAccount(a: Account): Account {
  store.set(ACCOUNT_KEY, JSON.stringify(a));
  return a;
}

// ---------------------------------------------------------------- 상태

let bench: DocBenchHandle | null = null;
let adapters: (DocBenchAdapters & { close?(): void; workspace?: FolderAdapters['workspace'] }) | null = null;
/** 지금 연 폴더 (시작하기면 null) */
let current: { dir: FileSystemDirectoryHandle | null; fs: FsLike; home?: FileSystemDirectoryHandle } | null = null;

/** 실행기 설치 안내에 넣을 CLI 주소·지문 — 빌드(scripts/build.mjs)가 같은 판의 release/docbench.mjs 로 채운다 */
const runnerSetup = typeof __DOCBENCH_CLI_URL__ !== 'undefined' && __DOCBENCH_CLI_URL__
  ? { version, cliUrl: __DOCBENCH_CLI_URL__, sha256: __DOCBENCH_CLI_SHA256__ }
  : undefined;

/**
 * 고른 폴더를 기억할지. file:// 은 모든 로컬 HTML 파일이 한 출처를 나눠 써서, 같은 브라우저로 연 다른 HTML 파일
 * (예: 메일로 받은 첨부)이 기억한 폴더 핸들을 꺼내 읽고 쓸 수 있다(독립 검토에서 재현) — 그래서 파일로 열면 기억하지 않는다.
 */
const persist = location.protocol !== 'file:';
const canWrite = () => folderAccessSupported() && window.isSecureContext;
const INSIDE_KEY = (docs: string) => `docbench:standalone:inside:${docs}`;

/** 기록 보관함 고르기 창 (시험은 준 핸들로) */
const pickHome = () => (testPickHome ? testPickHome() : pickFolder('docbench-home'));

/** 보관함 아래 이 문서 폴더의 기록 폴더 */
const dataFsOf = (home: FileSystemDirectoryHandle, name: string) => subFs(fsFromHandle(home), name);

// ---------------------------------------------------------------- 띄우기

async function mount(root: HTMLElement, ad: DocBenchAdapters, menu: WorkspaceMenu, title: string, initialDoc?: string): Promise<void> {
  // 다른 작업 공간으로 바꾸면 주소의 #문서(앞 작업 공간의 것)를 지운다
  if (adapters && location.hash) history.replaceState(null, '', location.pathname + location.search);
  adapters?.close?.();
  bench?.destroy();
  root.replaceChildren();
  document.title = `${title} · DocBench`;
  adapters = ad;
  bench = createDocBench(root, { adapters: ad, locale, routing: 'hash', shortcuts: 'global', injectStyles: false, workspace: menu, initialDoc });
  (window as unknown as { docbench: unknown }).docbench = bench;
  await bench.ready;
}

/** 작업 공간 메뉴 — 폴더 열기·다시 열기·기록 자리·시작하기 */
function menuFor(root: HTMLElement, kind: 'welcome' | 'folder'): WorkspaceMenu {
  let remembered: FileSystemDirectoryHandle | null = null;
  if (persist && folderAccessSupported()) void recallFolder().then((h) => { remembered = h; });
  const picker = document.createElement('input');
  picker.type = 'file'; picker.hidden = true; picker.multiple = true;
  (picker as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
  picker.addEventListener('change', () => { const files = picker.files; if (files?.length) void openReadOnly(root, files); });
  root.append(picker);
  return {
    items: () => {
      const ws = adapters?.workspace;
      const out: ReturnType<WorkspaceMenu['items']> = [];
      if (canWrite()) out.push({ id: 'open', label: t('ws.open'), hint: t('ws.open.hint'), primary: kind === 'welcome' });
      if (canWrite() && remembered && (kind === 'welcome' || remembered.name !== current?.fs.name)) out.push({ id: 'reopen', label: t('start.reopen', { name: remembered.name }) });
      out.push({ id: 'readonly', label: t('start.readonly'), hint: canWrite() ? t('ws.readonly.hint') : t(folderAccessSupported() ? 'start.insecure' : 'start.unsupported') });
      if (kind === 'folder' && ws?.fs.writable) {
        out.push({ id: 'records', label: ws.hasData ? t('ws.records', { where: ws.dataLabel }) : t('ws.records.none'), hint: t(ws.dataMode === 'inside' ? 'ws.records.inside' : 'ws.records.hint') });
        if (ws.dataMode === 'inside' && current?.dir) out.push({ id: 'moveOut', label: t('data.move') });
      }
      if (kind === 'folder') out.push({ id: 'welcome', label: t('ws.welcome') });
      return out;
    },
    run: async (id) => {
      try {
        if (id === 'open') { const dir = await pickFolder(); if (dir) await openPicked(root, dir); }
        else if (id === 'reopen' && remembered) { if (await ensurePermission(remembered)) await openPicked(root, remembered); else bench?.toast(t('start.denied')); }
        else if (id === 'readonly') picker.click();
        else if (id === 'records') await recordsInfo();
        else if (id === 'moveOut') await moveOut(root);
        else if (id === 'welcome') { if (persist) await forgetFolder(); await welcome(root); }
      } catch (e) { fail(e); }
    },
  };
}

function fail(e: unknown): void {
  const n = (e as DOMException)?.name;
  bench?.toast(n === 'SecurityError' ? t('start.blocked') : n === 'NotAllowedError' ? t('start.denied') : t('start.fail', { msg: (e as Error)?.message || String(e) }), { sticky: true });
}

/** 시작하기 — 메모리 작업 공간. 이름·폴더를 묻지 않고 작업대를 보여 준다 */
async function welcome(root: HTMLElement): Promise<void> {
  current = null;
  const w = welcomeContent(locale);
  const cfg = mergeConfig({ title: t('welcome.title') }, 'DocBench');
  const manifest = buildManifest(cfg, Object.keys(w.docs), (id) => ({ title: titleFromText(w.docs[id], id) }), '', false, { rootName: t('welcome.root') });
  manifest.project.storage = t('welcome.storage');
  manifest.groups = manifest.groups.filter((g) => g.id !== '_bench');
  let acct = account();
  const mem = createMemoryAdapters({ manifest, docs: w.docs, feedback: w.feedback, me: { kind: 'human', id: acct.id, ...(acct.name ? { name: acct.name } : {}) } });
  mem.identity = {
    source: 'browser',
    me: async () => ({ kind: 'human', id: acct.id, ...(acct.name ? { name: acct.name } : {}) }),
    can: () => true,
    setName: async (name) => { acct = saveAccount({ id: acct.id, ...(name.trim() ? { name: name.trim().slice(0, 60) } : {}) }); return { kind: 'human', id: acct.id, ...(acct.name ? { name: acct.name } : {}) }; },
  };
  // 연습 공간에도 Claude 작업 창 — 흉내 Claude 가 한 바퀴를 보여 준다(넘겼는데 아무 일도 없던 것, 주인 폰 실사용)
  mem.runs = demoRuns(mem, locale, ['fb.act.toAssistant', 'fb.act.reopen', 'fb.act.decline', 'fb.act.resolve', 'fb.proposal.reject'].map((k) => t(k)));
  await mount(root, mem, menuFor(root, 'welcome'), t('welcome.title'), Object.keys(w.docs)[0]);
  if (!canWrite()) bench?.toast(t(folderAccessSupported() ? 'start.insecure' : 'start.unsupported'), { sticky: true });
}

/** 고른 문서 폴더를 연다 — 주소로 열었으면 기억 */
async function openPicked(root: HTMLElement, dir: FileSystemDirectoryHandle): Promise<void> {
  if (!(await ensurePermission(dir))) throw new DOMException('denied', 'NotAllowedError');
  if (persist) await rememberFolder(dir);
  await openFolder(root, dir);
}

/**
 * 문서 폴더를 연다. 기록 자리는 묻지 않고 정해지면 붙이고(문서 폴더 안 .docbench · 기억한 보관함), 아니면 처음 저장할 때 묻는다.
 */
async function openFolder(root: HTMLElement, dir: FileSystemDirectoryHandle): Promise<void> {
  const fs = fsFromHandle(dir);
  const acct = account();
  const hasInside = await isDir(dir, '.docbench');
  const quiet = hasInside ? null : await quietHome(dir);
  current = { dir, fs, home: quiet?.home };
  const ad = await createFolderAdapters(fs, {
    user: acct, onUserChange: saveAccount, locale, runnerSetup,
    // 안쪽 .docbench 가 있으면 그것(예전 판·팀 공유) — data 를 비우면 어댑터가 안쪽을 쓴다
    ...(hasInside ? {} : { data: quiet ? dataFsOf(quiet.home, quiet.name) : null, dataHome: quiet?.home.name, dataName: quiet?.name }),
    requestData: () => askData(dir),
  });
  addSwitchLink(ad);
  await mount(root, ad, menuFor(root, 'folder'), dir.name);
  tellMerged();
  if (quiet) void offerMerge(quiet.home, quiet.name, dir);
  if (hasInside && store.get(INSIDE_KEY(dir.name)) !== '1' && store.get(INSIDE_KEY(dir.name) + ':told') !== '1') {
    store.set(INSIDE_KEY(dir.name) + ':told', '1');
    bench?.toast(t('data.inside.told'), { action: t('data.move'), onAction: () => void moveOut(root).catch(fail) });
  }
}

/** 다른 브라우저·http 주소: <input webkitdirectory> 로 읽기만 */
async function openReadOnly(root: HTMLElement, files: FileList): Promise<void> {
  const fs = fsFromFiles(files);
  current = { dir: null, fs };
  const ad = await createFolderAdapters(fs, { user: account(), onUserChange: saveAccount, locale, data: null });
  addSwitchLink(ad);
  await mount(root, ad, menuFor(root, 'folder'), fs.name);
}

/** 작업대 아래 "다른 폴더 열기" 링크 (새 탭에서 시작하기) */
function addSwitchLink(ad: FolderAdapters): void {
  const manifest = ad.docs.manifest.bind(ad.docs);
  ad.docs.manifest = async () => {
    const m = await manifest();
    m.project.links = [...(m.project.links || []), { label: t('start.switch'), url: '?pick' }];
    return m;
  };
}

// ---------------------------------------------------------------- 기록 자리 (D65)

const isDir = async (dir: FileSystemDirectoryHandle, name: string) => { try { await dir.getDirectoryHandle(name); return true; } catch { return false; } };

/**
 * 이 창에서 고른 보관함 — 파일로 열면(기억하지 않음) 창을 닫을 때까지만 쓴다(창마다 한 번 묻기, D65).
 * 그래야 같은 창에서 다른 폴더를 열거나 안쪽 기록을 옮긴 뒤에도 보관함의 기록이 그대로 보인다.
 */
let sessionHome: FileSystemDirectoryHandle | null = null;
const rememberedHome = async (): Promise<FileSystemDirectoryHandle | null> => (persist ? await recallFolder('home') : null) || sessionHome;

/** 묻지 않고 정할 수 있는 보관함: 기억한(주소로 열었을 때)·이 창에서 고른 보관함(권한이 이미 있고 쓸 수 있는 자리) */
async function quietHome(docs: FileSystemDirectoryHandle): Promise<{ home: FileSystemDirectoryHandle; name: string } | null> {
  const home = await rememberedHome();
  if (!home || !(await ensurePermission(home, 'readwrite', false).catch(() => false)) || (await homeProblem(home, docs))) return null;
  try { return { home, name: await prepareHome(home, docs) }; } catch { return null; }
}

/** 이 HTML 이 있는 폴더 (파일로 열었을 때) — 기록 보관함을 그 옆에 두라고 권한다 */
function htmlFolder(): string {
  if (location.protocol !== 'file:') return '';
  let p = decodeURIComponent(location.pathname).replace(/\/[^/]*$/, '');
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1).replace(/\//g, '\\');
  return p;
}

/**
 * 처음 저장하는 순간 기록 자리를 묻는다. 고른 보관함 아래 <문서 폴더 이름>/ 을 기록 폴더로 쓴다.
 * 안에 두기(.docbench)는 팀이 git 으로 함께 쓸 때. 취소하면 null(저장하지 않음).
 */
async function askData(docs: FileSystemDirectoryHandle): Promise<DataAttach | null> {
  const remembered = await rememberedHome();
  const near = htmlFolder();
  for (;;) {
    const choice = await bench!.ask({
      title: t('data.q'),
      body: t('data.lead.jit'),
      choices: [
        ...(remembered ? [{ id: 'remembered', label: t('data.home.use', { name: remembered.name }), primary: true }] : []),
        { id: 'pick', label: t(remembered ? 'data.home.other' : 'data.home.pick'), primary: !remembered },
        { id: 'inside', label: t('data.inside') },
      ],
      note: [near ? t('data.note.near', { dir: near }) : '', t(persist ? 'data.note' : 'data.note.file')].filter(Boolean).join(' '),
    });
    if (!choice) return null;
    if (choice === 'inside') {
      store.set(INSIDE_KEY(docs.name), '1');
      return { fs: subFs(fsFromHandle(docs), '.docbench'), mode: 'inside' };
    }
    try {
      const home = choice === 'remembered' && remembered && (await ensurePermission(remembered).catch(() => false)) ? remembered : await pickHome();
      if (!home) continue;
      if (!(await ensurePermission(home))) { bench?.toast(t('start.denied')); continue; }
      const bad = await homeProblem(home, docs);
      if (bad) { bench?.toast(bad, { sticky: true }); continue; }
      const hf = fsFromHandle(home);
      if (!(await hf.stat(HOME_MARKER)) && ((await hf.list('')) || []).length) {
        // 다른 파일이 있는 폴더를 보관함으로 — 한 번 확인한다(보관함 안에는 문서 폴더마다 폴더 하나와 표식 파일만 생긴다)
        const ok = await bench!.ask({ title: t('data.home.notEmpty', { name: home.name }), choices: [{ id: 'yes', label: t('data.home.notEmpty.yes'), primary: true }, { id: 'no', label: t('data.home.notEmpty.no') }] });
        if (ok !== 'yes') continue;
      }
      const dn = await prepareHome(home, docs);
      if (persist) await rememberFolder(home, 'home');
      sessionHome = home;
      store.set(INSIDE_KEY(docs.name), '');
      if (current) current.home = home;
      setTimeout(tellMerged, 300);
      // 붙인 뒤에(어댑터가 기록을 쓰기 시작한 뒤) 하위 폴더의 따로 쓰던 기록을 합치자고 한다
      setTimeout(() => void offerMerge(home, dn, docs), 400);
      return { fs: dataFsOf(home, dn), mode: 'outside', home: home.name, name: dn };
    } catch (e) { fail(e); }
  }
}

/** 기록 자리 안내 (메뉴) */
async function recordsInfo(): Promise<void> {
  const ws = adapters?.workspace;
  if (!ws || !current?.dir) return;
  if (!ws.hasData) { await ws.ensureData().catch(() => undefined); return; }
  await bench!.ask({ title: t('ws.records.title'), body: t(ws.dataMode === 'inside' ? 'ws.records.body.inside' : 'ws.records.body', { where: ws.dataLabel }), choices: [{ id: 'ok', label: t('close'), primary: true }] });
}

/** 보관함으로 쓸 수 없는 이유 (없으면 null): 문서 폴더 자체·문서 폴더 안·문서 폴더를 품은 곳 */
async function homeProblem(home: FileSystemDirectoryHandle, docs: FileSystemDirectoryHandle): Promise<string | null> {
  if (await home.isSameEntry(docs)) return t('data.bad.same');
  if (await docs.resolve(home)) return t('data.bad.insideDocs');
  if (await home.resolve(docs)) return t('data.bad.holdsDocs');
  return null;
}

/** 문서 폴더의 마크다운 몇 개(표본) — 이름이 같은 다른 문서 폴더의 기록을 가려낸다(브라우저는 경로를 모른다). 큰 폴더는 한도 안에서 */
async function docIdsOf(fs: FsLike, limit = 400): Promise<string[]> {
  const out: string[] = [];
  let visits = 0;
  const queue: [string, number][] = [['', 0]];
  while (queue.length && out.length < limit && visits < 6000) {
    const [dir, depth] = queue.shift()!;
    for (const e of (await fs.list(dir).catch(() => null)) || []) {
      visits++;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === 'directory') { if (walkable(e.name) && depth < 8) queue.push([rel, depth + 1]); }
      else if (/\.(md|markdown)$/i.test(e.name)) { out.push(rel); if (out.length >= limit) break; }
    }
  }
  return out;
}

/**
 * 보관함 안에서 이 문서 폴더의 기록 폴더 이름: '<이름>', '<이름> (2)' … 중 표식의 문서 표본이 겹치는 것,
 * 없으면 처음 빈 자리. 이름이 같은 다른 문서 폴더의 기록과 섞이지 않게(D61). 다른 작업 공간에 합쳐진 기록은 건너뛴다.
 */
async function dataNameFor(home: FileSystemDirectoryHandle, docs: FileSystemDirectoryHandle): Promise<string> {
  const hf = fsFromHandle(home);
  const ids = await docIdsOf(fsFromHandle(docs));
  let free: string | null = null;
  mergedHint = null;
  for (const name of dataFolderCandidates(docs.name)) {
    const ents = await hf.list(name);
    if (!ents) { free ??= name; continue; }
    const m = await markerOf(hf, name);
    if (m) {
      if (!sameDocsFolder(m, ids)) continue;
      if (!m.mergedInto) return name;
      // 이 폴더의 예전 기록은 넓은 작업 공간에 합쳐졌다 — 새로 시작하되 어디에 있는지 알려 준다
      mergedHint = m.mergedInto.to;
      continue;
    }
    if (!ents.length) free ??= name;
  }
  if (!free) throw new Error(t('data.bad.full', { name: docs.name }));
  return free;
}

/** 마지막 dataNameFor 가 본, 이 문서 폴더의 기록이 합쳐진 곳 (없으면 null) */
let mergedHint: string | null = null;
const tellMerged = () => { if (mergedHint) { bench?.toast(t('merge.moved', { to: mergedHint }), { sticky: true }); mergedHint = null; } };

async function markerOf(hf: FsLike, name: string) {
  const f = await hf.read(`${name}/${DATA_MARKER}`).catch(() => null);
  try { return f ? parseDataMarker(JSON.parse(new TextDecoder().decode(f.bytes))) : null; } catch { return null; }
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

// ---------------------------------------------------------------- 기록 합치기 (D66)

/**
 * 같은 보관함에서, 이 작업 공간 안의 하위 폴더를 따로 열어 쓰던 기록을 찾는다: 표식의 폴더 이름과 같은 하위 폴더(3단계까지)가 있고,
 * 표식의 문서 표본 절반 이상이 그 하위 폴더에 있으면 그 폴더의 기록이다.
 */
async function mergeCandidates(home: FileSystemDirectoryHandle, self: string, docs: FileSystemDirectoryHandle): Promise<{ dataName: string; prefix: string; feedback: number }[]> {
  const hf = fsFromHandle(home);
  const want = new Map<string, { dataName: string; marker: NonNullable<Awaited<ReturnType<typeof markerOf>>> }[]>();
  for (const e of (await hf.list('')) || []) {
    if (e.kind !== 'directory' || e.name === self) continue;
    const m = await markerOf(hf, e.name);
    if (!m || m.mergedInto || m.migrating || !m.docs?.length) continue;
    const list = want.get(m.docsName) || [];
    list.push({ dataName: e.name, marker: m });
    want.set(m.docsName, list);
  }
  if (!want.size) return [];
  const df = fsFromHandle(docs);
  const out: { dataName: string; prefix: string; feedback: number }[] = [];
  const queue: [string, number][] = [['', 0]];
  let visits = 0;
  while (queue.length && visits < 3000) {
    const [dir, depth] = queue.shift()!;
    for (const e of (await df.list(dir).catch(() => null)) || []) {
      if (e.kind !== 'directory' || !walkable(e.name)) continue;
      visits++;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      for (const c of want.get(e.name) || []) {
        // 이름이 같은 다른 프로젝트의 하위 폴더를 고르지 않게 — 보관함의 다른 곳과 같은 규칙(D61: README 같은 흔한 이름은 빼고 표본 비교)
        if (sameDocsFolder(c.marker, await docIdsOf(subFs(df, rel)))) {
          const fb = ((await hf.list(`${c.dataName}/feedback`)) || []).filter((x) => x.name.endsWith('.json')).length;
          out.push({ dataName: c.dataName, prefix: rel, feedback: fb });
        }
      }
      if (depth < 2) queue.push([rel, depth + 1]);
    }
  }
  return out;
}

async function offerMerge(home: FileSystemDirectoryHandle, self: string, docs: FileSystemDirectoryHandle): Promise<void> {
  const ws = adapters?.workspace;
  if (!ws || !bench) return;
  let cands: Awaited<ReturnType<typeof mergeCandidates>> = [];
  try { cands = await mergeCandidates(home, self, docs); } catch { return; }
  for (const c of cands) {
    const choice = await bench.ask({ title: t('merge.q', { prefix: c.prefix }), body: t('merge.body', { prefix: c.prefix, n: c.feedback, root: docs.name }), choices: [{ id: 'merge', label: t('merge.do'), primary: true }, { id: 'later', label: t('merge.later') }], note: t('merge.note') });
    if (choice !== 'merge') continue;
    try {
      const target = ws.data!;
      const src = dataFsOf(home, c.dataName);
      const r = await ws.withLock(lockKey.changes, () => ws.withLock(lockKey.state, () => mergeRecords(src, target, c.prefix)));
      const m = await markerOf(fsFromHandle(home), c.dataName);
      if (m) await src.write(DATA_MARKER, jsonFile({ ...m, mergedInto: { to: self, prefix: c.prefix, at: new Date().toISOString() } }));
      ws.onDataAttached?.();
      bench.toast(t('merge.done', { n: r.feedback, c: r.changes }));
    } catch (e) { fail(e); }
  }
}

// ---------------------------------------------------------------- 안쪽 기록을 밖으로 (D59)

async function moveOut(root: HTMLElement): Promise<void> {
  const dir = current?.dir;
  if (!dir || !(await isDir(dir, '.docbench'))) return;
  const remembered = await rememberedHome();
  const home = remembered && (await ensurePermission(remembered).catch(() => false)) && !(await homeProblem(remembered, dir)) ? remembered : await pickHome();
  if (!home) return;
  if (!(await ensurePermission(home))) throw new DOMException('denied', 'NotAllowedError');
  const bad = await homeProblem(home, dir);
  if (bad) { bench?.toast(bad, { sticky: true }); return; }
  const dn = await dataNameFor(home, dir);
  // 화면을 내려 이 창의 쓰기(문서 판 적기·보기 상태·폴링)를 멈춘 뒤 옮긴다 — 옮기는 사이 안쪽 기록이 바뀌면 확인에서 멈춘다(실측)
  adapters?.close?.(); bench?.destroy(); bench = null; adapters = null;
  const note = document.createElement('p');
  note.className = 'db-boot-note';
  note.textContent = t('data.move.doing');
  root.replaceChildren(note);
  await new Promise((r) => setTimeout(r, 300));
  try { await migrateInside(dir, dataFsOf(home, dn)); } catch (e) { await openFolder(root, dir); throw e; }
  await prepareHome(home, dir, dn);
  if (persist) await rememberFolder(home, 'home');
  sessionHome = home;
  store.set(INSIDE_KEY(dir.name), '');
  await openFolder(root, dir);
  // 위에서 bench 를 비웠다가 openFolder 가 다시 채운다 — 좁혀진 타입을 풀어 읽는다
  (bench as DocBenchHandle | null)?.toast(t('data.move.done', { where: `${home.name}/${dn}` }));
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

// ---------------------------------------------------------------- 시작

export async function boot(root: HTMLElement): Promise<void> {
  if (!persist) await forgetFolder();   // 예전 판이 file:// 에 남긴 핸들도 지운다
  account();
  const remembered = folderAccessSupported() && persist && !q.has('pick') ? await recallFolder() : null;
  // 권한이 이미 있으면(브라우저가 "항상 허용"을 기억) 그 폴더를 바로 연다. 아니면 시작하기
  if (remembered && (await ensurePermission(remembered, 'readwrite', false).catch(() => false))) {
    try { await openFolder(root, remembered); return; } catch { /* 시작하기로 */ }
  }
  await welcome(root);
}

/** 시험용: 이미 가진 폴더 핸들(OPFS 등)로 바로 연다. home 을 주면 기록은 그 보관함 아래(밖), 아니면 문서 폴더 안 */
export async function openHandle(root: HTMLElement, dir: FileSystemDirectoryHandle, name = '', home?: FileSystemDirectoryHandle): Promise<FolderAdapters> {
  if (name) saveAccount({ id: safeName(name), name });
  const dn = home ? await prepareHome(home, dir) : '';
  const ad = await createFolderAdapters(fsFromHandle(dir), { user: account(), onUserChange: saveAccount, locale, runnerSetup, ...(home ? { data: dataFsOf(home, dn), dataHome: home.name, dataName: dn } : {}) });
  current = { dir, fs: fsFromHandle(dir), home };
  await mount(root, ad, menuFor(root, 'folder'), dir.name);
  return ad;
}

/** 시험용: 실제 흐름 그대로 연다(기록은 처음 저장할 때 묻는다) — 보관함 고르기 창 대신 pickHome */
export async function openWith(root: HTMLElement, dir: FileSystemDirectoryHandle, pickHome?: () => Promise<FileSystemDirectoryHandle | null>): Promise<FolderAdapters> {
  testPickHome = pickHome || null;
  await openFolder(root, dir);
  return adapters as FolderAdapters;
}
let testPickHome: (() => Promise<FileSystemDirectoryHandle | null>) | null = null;

const el = document.getElementById('app');
if (el && !(window as unknown as { DOCBENCH_NO_BOOT?: boolean }).DOCBENCH_NO_BOOT) void boot(el);
(window as unknown as { DocBenchStandalone: unknown }).DocBenchStandalone = { boot, welcome, openHandle, openWith, get adapters() { return adapters; }, get bench() { return bench; } };
