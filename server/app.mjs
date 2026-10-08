// @ts-check
/**
 * DocBench 앱 (D67) — 이 PC 에 하나 도는 작은 서비스.
 *
 *   docbench app [--port 4317] [--detach | --stop | --status | --open] [--startup on|off] [--allow-origin URL]
 *
 * 폴더마다 serve·runner 를 띄우던 것을 하나로 묶는다:
 *  - 화면: http://127.0.0.1:<포트>/ — 고르기 창 없이 드라이브를 둘러보고 폴더를 "작업 공간"으로 더한다(펼친 폴더만 읽는다, D64).
 *    사람은 이 PC 의 로그인(표시 이름은 화면의 "나"에서), 기록은 이 PC 의 기록 보관함(locateData) — 묻지 않는다.
 *  - Claude 작업: 작업 공간마다 엔진(RunEngine, kind 'app') 하나. 단일 HTML 로 쓰는 폴더도 `docbench link` 로 이어 두면 맡는다.
 *  - 대시보드 탭: /embed?root=<폴더>&scope=… 를 iframe 으로, /host.js 가 테마·사람·넘기기·할 일 수를 postMessage 로 잇는다(D68).
 *
 * 보안(로컬 도구지만 브라우저와 같은 PC 의 다른 사용자가 붙을 수 있다):
 *  - 127.0.0.1 에만 열고 Host 헤더를 본다(DNS rebinding).
 *  - 열쇠(토큰): API 는 모두 열쇠가 있어야 한다(Authorization: Bearer, 실시간 연결은 ?token=). 처음 연 주소(?t=열쇠 —
 *    `docbench app --open`·바로가기)의 열쇠를 화면이 이 출처의 localStorage 에 두고 주소에서 지운다.
 *    쿠키는 쓰지 않는다 — 쿠키는 포트를 가리지 않아 같은 PC 의 다른 로컬 서버(127.0.0.1:다른 포트)로도 실려 간다.
 *    화면 껍데기(/)는 비밀이 없어 열쇠 없이 내주고, 열쇠가 없으면 화면이 여는 방법을 알려 준다.
 *    대시보드 iframe 은 주소의 ?t= 로 — 그 열쇠는 iframe 을 만든 쪽이 이미 가진 것.
 *    열쇠는 이 PC 의 설정 폴더 app-token 에만 있다(같은 사용자만 읽는다).
 *  - 바꾸는 요청은 X-DocBench 헤더(CSRF), 대시보드 출처는 허용 목록(app.allowOrigins)만 iframe 으로 끼울 수 있다(frame-ancestors).
 *  - 폴더 둘러보기는 폴더 이름만 준다(파일 내용은 더한 작업 공간 안에서만).
 */
import http from 'node:http';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Workspace, defaultPcConfigFile, defaultDataHome, updatePcWorkspace, setPcValue, samePath, isInside, DataLocationError } from './workspace.mjs';
import { createDocBenchHandler } from './handler.mjs';
import { RunEngine } from './runs.mjs';
import { readJson, writeJson, atomicWrite } from './textio.mjs';
import { core } from './core.mjs';
import { appAsset } from './app-assets.mjs';

const CI = process.platform === 'win32';
export const APP_PORT = 4317;
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.map': 'application/json' };

/** 작업 공간 id — 폴더 경로의 짧은 지문 (주소에 경로를 싣지 않는다) @param {string} root */
export const workspaceId = (root) => crypto.createHash('sha1').update(CI ? path.resolve(root).toLowerCase() : path.resolve(root)).digest('hex').slice(0, 12);

/** 앱 기록 파일 (이 PC 의 설정 폴더) — 켜진 앱의 pid·포트·판 @param {string} pcConfigFile */
export const appFile = (pcConfigFile) => path.join(path.dirname(pcConfigFile), 'app.json');
const tokenFile = (/** @type {string} */ pcConfigFile) => path.join(path.dirname(pcConfigFile), 'app-token');

/** 이 PC 의 앱 열쇠 — 없으면 만든다(한 번 만들면 그대로: 열어 둔 탭·대시보드가 다시 켜도 이어지게) @param {string} pcConfigFile */
export async function appToken(pcConfigFile) {
  const f = tokenFile(pcConfigFile);
  const have = (await fs.readFile(f, 'utf8').catch(() => '')).trim();
  if (/^[a-f0-9]{32,}$/.test(have)) return have;
  const t = crypto.randomBytes(24).toString('hex');
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, t + '\n', { mode: 0o600 });
  return t;
}

/**
 * @typedef {{ id: string, root: string, ws: Workspace | null, engine: RunEngine | null, handler: any, problem?: string, problemCode?: string, added: boolean, linked: boolean }} Entry
 */

/**
 * @param {{ port?: number, pcConfigFile?: string, allowOrigins?: string[], log?: (s: string) => void, onShutdown?: () => void }} [o]
 */
export async function startApp(o = {}) {
  const pcConfigFile = o.pcConfigFile || defaultPcConfigFile();
  const token = await appToken(pcConfigFile);
  const log = o.log || (() => undefined);
  /** @type {Map<string, Entry>} */
  const reg = new Map();
  /** 허용한 대시보드 출처 — 같은 배열을 고쳐 쓴다(작업 공간 처리기의 CORS 가 같은 목록을 본다) @type {string[]} */
  const allowOrigins = [...new Set(o.allowOrigins || [])];
  let pcSig = '';
  let closing = false;

  const readPc = async () => /** @type {any} */ ((await readJson(pcConfigFile, {})) || {});

  /** 이 PC 의 설정에서 작업 공간 목록: 앱에 더한 것(added)과 단일 HTML 의 연결 안내로 이은 것(owners) */
  async function loadList() {
    const c = await readPc();
    allowOrigins.splice(0, allowOrigins.length, ...new Set([...(o.allowOrigins || []), ...((c.app && Array.isArray(c.app.allowOrigins)) ? c.app.allowOrigins.filter((x) => typeof x === 'string') : [])]));
    const ws = c.workspaces && typeof c.workspaces === 'object' ? c.workspaces : {};
    /** @type {{ root: string, added: boolean, linked: boolean }[]} */
    const out = [];
    for (const [k, v] of Object.entries(ws)) {
      if (!v || typeof v !== 'object' || !path.isAbsolute(k)) continue;
      const added = typeof v.added === 'string' || v.added === true;
      // 이은 것 = 연결 안내의 `docbench link` 가 적은 owners (기록 짝 data 만으로는 맡지 않는다 — CLI 가 기록을 찾는 데 쓰는 것)
      const linked = Array.isArray(v.owners);
      if (added || linked) out.push({ root: path.resolve(k), added, linked });
    }
    return out;
  }

  /** 준비 중인 작업 공간 — 같은 폴더를 두 번 준비하면 엔진이 둘 떠서 한 요청을 두 번 돌린다(독립 검토 재현) @type {Map<string, Promise<Entry>>} */
  const preparing = new Map();
  /** 작업 공간 하나를 준비한다(기록을 찾고, Claude 작업 엔진을 켠다). 이미 있으면 그대로, 준비 중이면 그것을 기다린다 @param {string} root @param {{ added: boolean, linked: boolean, create?: boolean }} f */
  async function ensure(root, f) {
    const id = workspaceId(root);
    const busy = preparing.get(id);
    if (busy) { const e = await busy; e.added = f.added; e.linked = f.linked; return e; }
    const cur = reg.get(id);
    if (cur) { cur.added = f.added; cur.linked = f.linked; if (cur.ws || !existsSync(root)) return cur; }
    /** @type {Entry} */
    const e = cur || { id, root, ws: null, engine: null, handler: null, added: f.added, linked: f.linked };
    reg.set(id, e);
    const job = (async () => {
      try {
        const ws = await new Workspace(root, { pcConfigFile, create: !!f.create || f.added }).init();
        await ws.reconcileAll().catch(() => 0);
        e.ws = ws;
        e.problem = undefined; e.problemCode = undefined;
        // 준비하는 사이 빠졌거나(목록에서 뺌·합침) 앱이 꺼지면 엔진을 켜지 않는다
        if (closing || reg.get(id) !== e) return e;
        const engine = new RunEngine(ws, { kind: 'app', emit: (ev) => e.handler?.emit(ev) });
        try { await engine.start(); e.engine = engine; } catch (err) { e.problem = String(/** @type {any} */ (err)?.message || err); await engine.stop().catch(() => undefined); }
        if (closing || reg.get(id) !== e) { await engine.stop().catch(() => undefined); e.engine = null; }
      } catch (err) { e.problem = String(/** @type {any} */ (err)?.message || err); e.problemCode = /** @type {any} */ (err)?.code; }
      return e;
    })();
    preparing.set(id, job);
    try { return await job; } finally { preparing.delete(id); }
  }

  /** 한 번에 하나만 맞춘다(타이머·요청이 겹치면 끝난 뒤 한 번 더) @type {Promise<void> | null} */
  let syncing = null;
  let syncAgain = false;
  function sync() {
    if (syncing) { syncAgain = true; return syncing; }
    syncing = (async () => { do { syncAgain = false; await syncOnce(); } while (syncAgain); })().finally(() => { syncing = null; });
    return syncing;
  }
  /** 설정이 바뀌면(연결 안내가 link 를 적음) 목록을 다시 맞춘다 — 새 것은 켜고, 빠진 것은 끈다 */
  async function syncOnce() {
    const st = await fs.stat(pcConfigFile).catch(() => null);
    const sig = st ? `${st.size}:${st.mtimeMs}` : 'none';
    if (sig === pcSig) return;
    pcSig = sig;
    const list = await loadList();
    const want = new Set(list.map((x) => workspaceId(x.root)));
    // 이 PC 의 설정이 바뀌었다(표시 이름·짝 계정 등) — 켜 둔 작업 공간도 다시 읽는다
    for (const e of reg.values()) await e.ws?.loadConfig().catch(() => undefined);
    for (const x of list) await ensure(x.root, x);
    for (const [id, e] of reg) if (!want.has(id)) await drop(e);
  }
  /** @param {Entry} e */
  async function drop(e) {
    reg.delete(e.id);
    await e.handler?.close?.().catch(() => undefined);
    await e.engine?.stop().catch(() => undefined);
  }

  // ------------------------------------------------------------ HTTP
  /** 한 번 쓰는 열기 코드 → 끝 시각 @type {Map<string, number>} */
  const openCodes = new Map();
  /** 브라우저로 열 주소 — 열쇠 대신 2분 동안 한 번 쓰는 코드를 싣는다(명령 줄·브라우저 기록·로그에 열쇠가 남지 않게) */
  const openLink = () => {
    for (const [c, t] of openCodes) if (t < Date.now()) openCodes.delete(c);
    const c = crypto.randomBytes(16).toString('hex');
    openCodes.set(c, Date.now() + 120000);
    return `${url}?c=${c}`;
  };
  /** @param {string} a @param {string} b */
  const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  /** @param {import('node:http').IncomingMessage} req @param {URL} url */
  const authed = (req, url) => {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return [bearer, url.searchParams.get('t') || '', url.searchParams.get('token') || ''].some((x) => x && same(x, token));
  };

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function route(req, res) {
    const url = new URL(req.url || '/', 'http://local');
    const p = url.pathname;
    const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) return send(res, 403, { error: 'HOST_NOT_ALLOWED' });

    // 열쇠 없이 되는 것: 대시보드가 실을 다리 스크립트, 화면 파일(비밀 없음)
    if (p === '/host.js') return serveAsset(res, 'host.js', { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    if (p.startsWith('/assets/')) return serveAsset(res, path.basename(p));
    if (p === '/favicon.ico') return res.writeHead(204).end();
    // 앱 화면 껍데기 — 비밀이 없다. 열쇠는 화면이 한 번 쓰는 열기 코드(?c=)로 받거나(주소·명령 줄·기록에 열쇠가 남지 않게)
    // 주소의 ?t= 를 확인한 뒤 이 출처의 localStorage 에 둔다
    if (p === '/' || p === '/index.html') return page(res, 'app', '');
    // 열기 코드 → 열쇠 (한 번, 2분). 교차 출처는 X-DocBench 헤더 때문에 사전 요청에서 막힌다(CORS 를 열지 않는다)
    if (p === '/api/app/redeem' && req.method === 'POST') {
      if (req.headers['x-docbench'] !== '1') return send(res, 403, { error: 'CSRF', message: 'X-DocBench 헤더가 필요합니다' });
      const b = await body(req).catch(() => ({}));
      const c = typeof b.code === 'string' ? b.code : '';
      const until = openCodes.get(c);
      openCodes.delete(c);
      if (!until || until < Date.now()) return send(res, 400, { error: 'BAD_REQUEST', message: '열기 코드가 맞지 않거나 지났습니다 — docbench app --open 으로 다시 여세요' });
      return send(res, 200, { key: token });
    }

    // CORS 사전 요청(OPTIONS)은 열쇠를 싣지 않는다 — 작업 공간 처리기가 허용 출처에만 답한다(데이터 없음)
    const wpre = req.method === 'OPTIONS' && p.match(/^\/api\/w\/([a-f0-9]{12})(\/.*)?$/);
    if (wpre) { const e = reg.get(wpre[1]); if (e?.ws) { e.handler ||= makeHandler(e); if (e.handler(req, res)) return; } return res.writeHead(204).end(); }

    if (!authed(req, url)) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'UNAUTHORIZED', message: 'DocBench 앱 열쇠가 필요합니다 — docbench app --open 으로 여세요' });
      return page(res, 'locked', '', 401);
    }
    if (p === '/embed') return page(res, 'embed', url.searchParams.get('t') || '');

    if (p.startsWith('/api/app/')) {
      if (req.method !== 'GET' && req.headers['x-docbench'] !== '1') return send(res, 403, { error: 'CSRF', message: 'X-DocBench 헤더가 필요합니다' });
      return appApi(req, res, url, p.slice('/api/app'.length)).catch((e) => fail(res, e));
    }
    const wm = p.match(/^\/api\/w\/([a-f0-9]{12})(\/.*)?$/);
    if (wm) {
      const e = reg.get(wm[1]);
      if (!e || !e.ws) return send(res, 404, { error: 'NOT_FOUND', message: e?.problem || '이 작업 공간이 없습니다' });
      e.handler ||= makeHandler(e);
      if (e.handler(req, res)) return;
    }
    send(res, 404, { error: 'NOT_FOUND' });
  }

  /** 작업 공간 하나의 REST 처리기 — serve 와 같은 것, 엔진은 앱이 켠 것 @param {Entry} e */
  const makeHandler = (e) => createDocBenchHandler(/** @type {Workspace} */ (e.ws), { base: `/api/w/${e.id}`, ui: false, engine: e.engine || undefined, allowOrigins, identity: 'pc' });

  /** 앱 API — 작업 공간 목록·더하기·빼기, 폴더 둘러보기, 나 @param {any} req @param {any} res @param {URL} url @param {string} p */
  async function appApi(req, res, url, p) {
    const m = req.method;
    if (m === 'GET' && p === '/info') return send(res, 200, await info());
    if (m === 'GET' && p === '/browse') return send(res, 200, await browse(url.searchParams.get('path') || ''));
    if (m === 'POST' && p === '/workspaces') return send(res, 200, await addWorkspace(await body(req)));
    const dm = p.match(/^\/workspaces\/([a-f0-9]{12})$/);
    if (dm && m === 'DELETE') {
      const e = reg.get(dm[1]);
      if (!e) return send(res, 404, { error: 'NOT_FOUND' });
      // 앱에서 뺀다 — 더한 표시와 이은 계정을 지운다(기록과 기록 짝은 그대로: CLI·단일 HTML 은 계속 그 기록을 쓴다)
      await updatePcWorkspace(pcConfigFile, e.root, (cur) => { delete cur.added; delete cur.owners; return cur; });
      await drop(e);
      pcSig = '';
      return send(res, 204, null);
    }
    if (m === 'PUT' && p === '/me') {
      const b = await body(req);
      await setPcValue(pcConfigFile, 'name', typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '');
      for (const e of reg.values()) await e.ws?.loadConfig();
      return send(res, 200, await me());
    }
    if (m === 'POST' && p === '/open-code') return send(res, 200, { url: openLink() });
    if (m === 'POST' && p === '/shutdown') { send(res, 202, { ok: true }); setTimeout(() => void close().then(() => o.onShutdown?.()), 50); return; }
    send(res, 404, { error: 'NOT_FOUND' });
  }

  async function me() {
    const c = await readPc();
    const user = (typeof c.user === 'string' && c.user) || os.userInfo().username || 'me';
    return { kind: 'human', id: core.safeName(user), name: (typeof c.name === 'string' && c.name) || user };
  }

  async function info() {
    await sync();
    return {
      version: core.DOCBENCH_VERSION, me: await me(), allowOrigins,
      workspaces: [...reg.values()].sort((a, b) => a.root.localeCompare(b.root)).map((e) => ({
        id: e.id, root: e.root, name: path.basename(e.root) || e.root, added: e.added, linked: e.linked,
        data: e.ws ? { mode: e.ws.dataMode, dir: e.ws.dir } : undefined, problem: e.problem,
        claude: e.engine ? e.engine.availability() : undefined,
      })),
    };
  }

  /**
   * 폴더를 작업 공간으로 더한다(D66). 이미 더한 작업 공간 안이면 새로 만들지 않고 그 작업 공간 + 범위(scope),
   * 이미 더한 작업 공간을 품으면 merge 로 합칠지 묻는다(그 기록을 넓은 쪽으로 옮긴다).
   * @param {{ path?: unknown, merge?: unknown }} b
   */
  async function addWorkspace(b) {
    const raw = typeof b.path === 'string' ? b.path.trim() : '';
    if (!raw || !path.isAbsolute(raw)) throw Object.assign(new Error('폴더의 전체 경로가 필요합니다'), { code: 'BAD_REQUEST' });
    const root = path.resolve(raw);
    const st = await fs.stat(root).catch(() => null);
    if (!st?.isDirectory()) throw Object.assign(new Error('폴더가 없습니다: ' + root), { code: 'NOT_FOUND' });
    // 이 PC 의 설정·열쇠·기록 보관함을 품는 폴더(C:\·홈 등)는 통째로 더하지 않는다 — 기록이 문서로 훑히고, Claude 가 열쇠를 읽을 수 있게 된다
    const pcDir = path.dirname(pcConfigFile);
    const pcc = await readPc();
    const home = typeof pcc.dataHome === 'string' && pcc.dataHome ? path.resolve(pcDir, pcc.dataHome) : defaultDataHome(pcConfigFile);
    for (const d of [pcDir, home]) if (samePath(d, root) || isInside(d, root)) throw Object.assign(new Error(`이 폴더 안에 DocBench 의 이 PC 설정·기록 보관함(${d})이 있어 통째로 더할 수 없습니다 — 그 아래 폴더(예: 문서·바탕 화면·작업 폴더)를 더하세요.`), { code: 'BAD_REQUEST' });
    await sync();
    const added = [...reg.values()].filter((e) => e.added && e.ws);
    const outer = added.find((e) => samePath(e.root, root) || isInside(root, e.root));
    if (outer) {
      const scope = samePath(outer.root, root) ? '' : path.relative(outer.root, root).split(path.sep).join('/');
      return { id: outer.id, scope, existing: true };
    }
    // 품는 폴더: 안쪽 작업 공간의 기록을 넓은 쪽으로 합친다. 단 기록이 문서 폴더 안(.docbench — 팀이 git 으로 함께 쓰는 기록)이면
    // 합치지 않고 따로 둔다 — 합쳤다는 표시를 그 안에 적으면 팀 모두의 CLI 가 그 기록을 놓는다
    const inner = added.filter((e) => isInside(e.root, root));
    const mergeable = inner.filter((e) => e.ws?.dataMode === 'outside');
    const kept = inner.filter((e) => !mergeable.includes(e)).map((e) => ({ id: e.id, root: e.root, rel: path.relative(root, e.root).split(path.sep).join('/') }));
    if (mergeable.length && b.merge !== true) {
      return { needsMerge: mergeable.map((e) => ({ id: e.id, root: e.root, rel: path.relative(root, e.root).split(path.sep).join('/') })), kept };
    }
    const e = await ensure(root, { added: true, linked: false, create: true });
    // 열지 못했으면 목록에 남기지 않는다(다음에 앱을 켤 때 그 문제의 작업 공간을 열지 않게) — 더한 표시는 연 뒤에 적는다
    if (!e.ws) { if (!e.linked) await drop(e); throw Object.assign(new Error(e.problem || '작업 공간을 열지 못했습니다'), { code: e.problemCode || 'INTERNAL' }); }
    await updatePcWorkspace(pcConfigFile, root, (cur) => ({ ...cur, added: new Date().toISOString() }));
    const ws = e.ws;
    let merged = 0;
    for (const c of mergeable) {
      const cws = c.ws;
      if (!cws) continue;
      const rel = path.relative(root, c.root).split(path.sep).join('/');
      // 안쪽 작업 공간을 먼저 내린다(그 처리기·엔진이 합치는 사이 쓰지 않게)
      await drop(c);
      // 두 기록의 이력·판 잠금을 잡고 합친다 — CLI·다른 프로그램이 좁은 쪽에 쓰는 것을 놓치지 않게
      const r = await cws.withLock(core.lockKey.changes, () => cws.withLock(core.lockKey.state, () =>
        ws.withLock(core.lockKey.changes, () => ws.withLock(core.lockKey.state, () => core.mergeRecords(nodeFs(cws.dir), nodeFs(ws.dir), rel)))));
      merged += r.feedback;
      const mk = path.join(cws.dir, core.DATA_MARKER);
      const m = core.parseDataMarker(await readJson(mk));
      if (m) await writeJson(mk, { ...m, mergedInto: { to: path.basename(ws.dir), prefix: rel, at: new Date().toISOString() } });
      // 짝 지은 계정(단일 HTML 의 Claude 작업)은 넓은 쪽으로 옮긴다 — 그 사람의 작업을 넓은 작업 공간의 엔진이 맡는다
      let owners = /** @type {string[]} */ ([]);
      await updatePcWorkspace(pcConfigFile, c.root, (cur) => { owners = Array.isArray(cur.owners) ? cur.owners : []; delete cur.added; delete cur.data; delete cur.owners; return cur; });
      if (owners.length) await updatePcWorkspace(pcConfigFile, root, (cur) => ({ ...cur, owners: [...new Set([...(Array.isArray(cur.owners) ? cur.owners : []), ...owners])].slice(-20) }));
    }
    pcSig = '';
    return { id: e.id, scope: '', merged, ...(kept.length ? { kept } : {}) };
  }

  /**
   * 폴더 둘러보기 — 폴더 이름만 준다(파일 내용 없음). 빈 경로면 시작점(드라이브·홈·문서·바탕 화면).
   * @param {string} p
   */
  async function browse(p) {
    if (!p) {
      const home = os.homedir();
      /** @type {{ name: string, path: string, kind: string }[]} */
      const roots = [];
      if (CI) for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const d = `${L}:\\`; if (existsSync(d)) roots.push({ name: `${L}:`, path: d, kind: 'drive' }); }
      else roots.push({ name: '/', path: '/', kind: 'drive' });
      roots.push({ name: path.basename(home) || home, path: home, kind: 'home' });
      for (const n of ['Documents', 'Desktop', 'OneDrive']) { const d = path.join(home, n); if (existsSync(d)) roots.push({ name: n, path: d, kind: 'place' }); }
      return { path: '', parent: null, dirs: roots };
    }
    if (!path.isAbsolute(p)) throw Object.assign(new Error('전체 경로가 필요합니다'), { code: 'BAD_REQUEST' });
    const abs = path.resolve(p);
    let ents;
    try { ents = await fs.readdir(abs, { withFileTypes: true }); } catch (e) { throw Object.assign(new Error('열 수 없는 폴더입니다: ' + String(/** @type {any} */ (e).code || e)), { code: 'BAD_REQUEST' }); }
    const dirs = ents.filter((d) => d.isDirectory() && core.walkable(d.name)).map((d) => ({ name: d.name, path: path.join(abs, d.name), kind: 'dir' })).sort((a, b) => core.fileNameOrder.compare(a.name, b.name));
    const docs = ents.filter((d) => d.isFile() && /\.(md|markdown)$/i.test(d.name)).length;
    const parent = path.dirname(abs);
    return { path: abs, parent: parent === abs ? '' : parent, dirs: dirs.slice(0, 2000), docs, big: core.looksBigRoot(path.basename(abs) || abs, ents.map((d) => d.name)) };
  }

  /** @param {any} res @param {string} name @param {Record<string, string>} [extra] */
  async function serveAsset(res, name, extra = {}) {
    const data = await appAsset(name);
    if (data == null) return send(res, 404, { error: 'NOT_FOUND' });
    res.writeHead(200, { 'Content-Type': MIME[/** @type {'.js'} */ (path.extname(name))] || 'application/octet-stream', 'Cache-Control': 'max-age=300', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(data);
  }

  /**
   * 화면 HTML. 앱 화면은 끼울 수 없고(frame-ancestors 'none'), embed 는 허용한 대시보드 출처만 끼운다.
   * embed 는 주소의 열쇠를 화면에 넘긴다(교차 사이트 iframe 은 쿠키가 안 가서) — 그 열쇠는 iframe 을 만든 쪽이 이미 가진 것.
   * @param {any} res @param {'app' | 'embed' | 'locked'} mode @param {string} key @param {number} [status]
   */
  function page(res, mode, key, status = 200) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
    const ancestors = mode === 'embed' ? ["'self'", ...allowOrigins].join(' ') : "'none'";
    const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`;
    const head = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="referrer" content="no-referrer">`;
    let html;
    if (mode === 'locked') {
      html = `${head}<title>DocBench</title><style>body{font:15px/1.6 system-ui,"Malgun Gothic",sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#f4f6f3;color:#17201b}main{max-width:460px;padding:24px}code{background:#e6ebe6;padding:1px 6px;border-radius:4px}</style></head><body><main><h1 style="font-size:20px">DocBench 앱</h1><p>이 주소는 열쇠가 있어야 열립니다. 터미널에서 <code>docbench app --open</code> 을 실행하거나, 설치할 때 만든 바로가기로 여세요.</p><p lang="en" style="color:#6f7a74">This address needs the app key. Run <code>docbench app --open</code> or use the shortcut created at install.</p></main></body></html>`;
    } else {
      html = `${head}<meta name="docbench-mode" content="${mode}"><meta name="docbench-version" content="${esc(core.DOCBENCH_VERSION)}">${mode === 'embed' ? `<meta name="docbench-key" content="${esc(key)}"><meta name="docbench-hosts" content="${esc(allowOrigins.join(' '))}">` : ''}<title>DocBench</title><link rel="stylesheet" href="/assets/docbench.css"><style>html,body{height:100%;margin:0}body{background:#f4f6f3}@media (prefers-color-scheme: dark){body{background:#0f1412}}#app{height:100%}</style></head><body><div id="app" class="docbench" data-theme="auto"></div><script src="/assets/app.js"></script></body></html>`;
    }
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp, 'Referrer-Policy': 'no-referrer' });
    res.end(html);
  }

  const server = http.createServer((req, res) => { void route(req, res).catch((e) => fail(res, e)); });
  // 포트가 쓰이고 있으면 다음 자리로 (실제 주소는 app.json 과 --status 가 알려 준다)
  let port = o.port ?? APP_PORT;
  for (let i = 0; ; i++) {
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(undefined); }); });
      break;
    } catch (e) {
      if (/** @type {any} */ (e).code !== 'EADDRINUSE' || o.port != null || i >= 10) throw e;
      port++;
    }
  }
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  const url = `http://127.0.0.1:${addr.port}/`;
  await sync();
  const timer = setInterval(() => void sync().catch(() => undefined), 5000);
  await writeJson(appFile(pcConfigFile), { pid: process.pid, port: addr.port, url, version: core.DOCBENCH_VERSION, startedAt: new Date().toISOString() });
  log(`DocBench 앱 ${core.DOCBENCH_VERSION}: ${url}`);

  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await syncing?.catch(() => undefined);
    await Promise.all([...preparing.values()].map((p) => p.catch(() => undefined)));
    for (const e of [...reg.values()]) await drop(e);
    const rec = /** @type {any} */ (await readJson(appFile(pcConfigFile)));
    if (rec && rec.pid === process.pid) await fs.rm(appFile(pcConfigFile), { force: true }).catch(() => undefined);
    await new Promise((r) => { server.close(() => r(undefined)); server.closeAllConnections?.(); });
  }
  return { url, port: addr.port, token, openUrl: `${url}?t=${token}`, openLink, close, registry: reg, sync };
}

/** 노드 파일 시스템을 기록 합치기(core.mergeRecords)에 맞춘다 @param {string} dir */
export function nodeFs(dir) {
  return {
    /** @param {string} p */
    async list(p) { try { return (await fs.readdir(path.join(dir, p), { withFileTypes: true })).map((d) => ({ name: d.name, kind: /** @type {'file' | 'directory'} */ (d.isDirectory() ? 'directory' : 'file') })); } catch { return null; } },
    /** @param {string} p */
    async read(p) { try { return { bytes: new Uint8Array(await fs.readFile(path.join(dir, p))) }; } catch { return null; } },
    /** @param {string} p @param {Uint8Array | string} d */
    async write(p, d) { const f = path.join(dir, p); await fs.mkdir(path.dirname(f), { recursive: true }); await atomicWrite(f, typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d)); },
  };
}

/** @param {any} res @param {number} status @param {any} data */
function send(res, status, data) {
  if (res.writableEnded) return;
  if (status === 204 || data == null) { res.writeHead(status === 200 ? 204 : status).end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
/** 앱 API 의 오류 → 상태 코드. 아는 코드만 내보낸다(노드 오류 이름 등은 INTERNAL) */
const APP_ERRORS = /** @type {Record<string, number>} */ ({ BAD_REQUEST: 400, NOT_FOUND: 404, TOO_LARGE: 413, BUSY: 409, DATA_LOCATION: 409, DATA_CONFLICT: 409, DATA_MISSING: 409, DATA_MERGED: 409, NO_DATA: 409 });
/** @param {any} res @param {any} e */
function fail(res, e) {
  const code = e instanceof DataLocationError ? e.code || 'DATA_LOCATION' : typeof e?.code === 'string' && APP_ERRORS[e.code] ? e.code : 'INTERNAL';
  send(res, APP_ERRORS[code] || 500, { error: code, message: String(e?.message || e).slice(0, 500) });
}
/** @param {any} req */
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    // 한도를 넘으면 더 모으지 않고 413 으로 답한다(연결을 바로 끊으면 응답이 가지 않는다 — handler.mjs 와 같게)
    req.on('data', (c) => { if (over) return; size += c.length; if (size > 1024 * 1024) { over = true; chunks.length = 0; reject(Object.assign(new Error('요청이 1 MB 를 넘습니다'), { code: 'TOO_LARGE' })); } else chunks.push(c); });
    req.on('end', () => { if (over) return; try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('JSON 이 아닙니다'), { code: 'BAD_REQUEST' })); } });
    req.on('error', reject);
  });
}
