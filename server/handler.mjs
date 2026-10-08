// @ts-check
/**
 * HTTP 처리기 — docs/openapi.yaml 계약. Node http·Express·Fastify(raw) 어디에나 끼운다.
 *
 *   const handle = createDocBenchHandler(ws, { base: '/api' });
 *   http.createServer((req, res) => handle(req, res) || res.end());   // 단독
 *   app.use((req, res, next) => handle(req, res) || next());          // Express
 *
 * 보안 기본값 (로컬 도구지만 브라우저가 붙으므로):
 *  - Host 헤더 검사 (DNS rebinding 방지), 바꾸는 요청은 X-DocBench 헤더 필수 (CSRF 방지)
 *  - token 을 주면 모든 API 가 Bearer 또는 ?token= 을 요구
 *  - CORS 는 allowOrigins 에 적은 출처만
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConflictError, NotFoundError, BadRequestError } from './workspace.mjs';
import { proposeWithClaudeCli } from './assistant.mjs';
import { core } from './core.mjs';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../dist');
const STATIC = path.resolve(here, 'static');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.json': 'application/json', '.svg': 'image/svg+xml' };

/**
 * @param {import('./workspace.mjs').Workspace} ws
 * @param {{ base?: string, token?: string, allowOrigins?: string[], allowHosts?: string[], ui?: boolean, uiBase?: string }} [opts]
 */
export function createDocBenchHandler(ws, opts = {}) {
  const base = (opts.base || '/api').replace(/\/$/, '');
  const uiBase = (opts.uiBase ?? '').replace(/\/$/, '');
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  const emit = (ev) => {
    const msg = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  const stopWatch = ws.watch(emit);
  const beat = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);
  /** @type {Map<string, AbortController>} */
  const running = new Map();
  /** @type {import('node:child_process').ChildProcess | null} */
  let notifyChild = null;

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  function handle(req, res) {
    const url = new URL(req.url || '/', 'http://local');
    const p = url.pathname;
    const isApi = p === base || p.startsWith(base + '/');
    const isUi = opts.ui !== false && (p === uiBase + '/' || p === uiBase || p.startsWith(uiBase + '/assets/'));
    if (!isApi && !isUi) return false;
    // Host 검사
    const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const hosts = ['localhost', '127.0.0.1', '::1', ...(opts.allowHosts || [])];
    if (!hosts.includes(host)) { send(res, 403, { error: 'HOST_NOT_ALLOWED', message: 'Host 헤더가 허용 목록에 없습니다' }); return true; }
    // CORS
    const origin = req.headers.origin;
    if (origin && opts.allowOrigins?.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DocBench, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return true; }
    if (isUi && !isApi) { void serveUi(p.slice(uiBase.length) || '/', res); return true; }
    // 인증
    if (opts.token) {
      const auth = req.headers.authorization || '';
      if (auth !== 'Bearer ' + opts.token && url.searchParams.get('token') !== opts.token) { send(res, 401, { error: 'UNAUTHORIZED' }); return true; }
    }
    if (req.method !== 'GET' && req.headers['x-docbench'] !== '1') { send(res, 403, { error: 'CSRF', message: 'X-DocBench 헤더가 필요합니다' }); return true; }
    void route(req, res, url, p.slice(base.length) || '/').catch((e) => fail(res, e));
    return true;
  }

  /** @param {any} req @param {any} res @param {URL} url @param {string} p */
  async function route(req, res, url, p) {
    const q = (k) => url.searchParams.get(k) || '';
    const m = req.method;
    if (m === 'GET' && p === '/session') {
      const perms = ['feedback.create', 'feedback.update', 'feedback.delete', 'assistant.notify'];
      if (!ws.config.readOnly) perms.push('doc.edit');
      if (ws.config.assistant) perms.push('assistant.propose');
      return send(res, 200, {
        me: ws.me, permissions: perms,
        assistant: ws.config.assistant ? { name: ws.config.assistantName || 'Claude' } : null,
        notify: ws.config.notify?.inbox !== false || ws.config.notify?.command ? { label: (ws.config.assistantName || 'AI') + '에게 넘기기' } : null,
        features: { base: !!ws.git, versions: true, inventory: true, changes: true },
        workspace: { root: ws.root, git: !!ws.git },
      });
    }
    if (m === 'GET' && p === '/manifest') { await ws.scan(); return send(res, 200, await ws.manifest()); }
    if (m === 'GET' && p === '/doc') return send(res, 200, await ws.readDoc(q('id')));
    if (m === 'PUT' && p === '/doc') {
      const b = await body(req);
      const out = await ws.writeDoc(q('id'), b.md, { baseVersion: b.baseVersion, summary: b.summary, feedbackIds: b.feedbackIds, convertTo: b.convertTo === 'utf-8' ? 'utf-8' : undefined, by: ws.me });
      emit({ type: 'doc', id: q('id') }); emit({ type: 'changes' });
      return send(res, 200, out);
    }
    if (m === 'GET' && p === '/doc/version') { const d = await ws.docVersion(q('id'), q('v')); return d ? send(res, 200, d) : send(res, 404, { error: 'NOT_FOUND' }); }
    if (m === 'GET' && p === '/doc/base') { const d = await ws.docBase(q('id')); return d ? send(res, 200, d) : send(res, 404, { error: 'NOT_FOUND' }); }
    if (m === 'GET' && p === '/changes') return send(res, 200, { items: await ws.changes(Number(q('limit')) || 300) });
    if (m === 'GET' && p === '/inventory') return send(res, 200, await ws.inventory());
    if (m === 'GET' && p === '/feedback') return send(res, 200, { items: await ws.listFeedback() });
    if (m === 'POST' && p === '/feedback') { const f = await ws.createFeedback(await body(req), ws.me); emit({ type: 'feedback' }); return send(res, 201, f); }
    const fm = p.match(/^\/feedback\/([\w.-]+)$/);
    if (fm && m === 'PATCH') { const b = await body(req); const f = await ws.updateFeedback(fm[1], b.patch || {}, b.version); emit({ type: 'feedback' }); return send(res, 200, f); }
    if (fm && m === 'DELETE') { await ws.deleteFeedback(fm[1]); emit({ type: 'feedback' }); return send(res, 204, null); }
    if (m === 'GET' && p === '/viewstate') return send(res, 200, await ws.viewState());
    if (m === 'PUT' && p === '/viewstate') { await ws.saveViewState(await body(req)); return send(res, 204, null); }
    if (m === 'GET' && p === '/events') return sse(req, res);
    if (m === 'POST' && p === '/notify') return notify(req, res);
    if (m === 'POST' && p === '/assistant/propose') return propose(req, res);
    return send(res, 404, { error: 'NOT_FOUND', message: m + ' ' + p });
  }

  /** @param {any} req @param {any} res */
  function sse(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  /** @param {any} req @param {any} res */
  async function notify(req, res) {
    const b = await body(req);
    const n = ws.config.notify || {};
    const file = n.inbox !== false ? await ws.addRequest({ count: b.count, docs: b.docs, feedbackIds: b.feedbackIds }) : null;
    emit({ type: 'request', id: file ? path.basename(file) : undefined });
    let delivered = false;
    let problem = '';
    const ai = ws.config.assistantName || 'Claude';
    if (Array.isArray(n.command) && n.command.length) {
      if (notifyChild && notifyChild.exitCode === null) {
        problem = `${ai}가 앞선 요청을 아직 처리하고 있습니다. 끝나면 이번 요청도 요청함에서 읽습니다.`;
      } else {
        // 출력은 요청 파일 옆 .log 로 — 무인 실행이 실패해도 원인을 볼 수 있게
        const logFd = await fs.open((file || path.join(ws.dir, 'inbox', 'notify')) + '.log', 'a');
        try {
          const child = spawn(n.command[0], n.command.slice(1), { cwd: ws.root, detached: true, stdio: ['ignore', logFd.fd, logFd.fd], windowsHide: true, env: { ...process.env, DOCBENCH_REQUEST: file || '', DOCBENCH_ROOT: ws.root } });
          // 실행 파일이 없으면 'error' 가 비동기로 온다 — 결과를 보고 답한다
          delivered = await new Promise((resolve) => { child.once('spawn', () => resolve(true)); child.once('error', (e) => { problem = `명령을 시작하지 못했습니다: ${e.message}`; resolve(false); }); });
          if (delivered) { notifyChild = child; child.unref(); }
        } finally { await logFd.close(); }
      }
    }
    send(res, 200, { delivered, message: problem || n.message || (delivered ? `${ai}에게 넘겼습니다 (${b.count}건).` : `요청을 남겼습니다. 터미널의 ${ai}에게 /docbench-feedback 을 실행시키세요.`) });
  }

  /** @param {any} req @param {any} res */
  async function propose(req, res) {
    const cfg = ws.config.assistant;
    if (!cfg) return send(res, 501, { error: 'NO_ASSISTANT', message: '.docbench/config.json 에 assistant 설정이 없습니다' });
    const b = await body(req);
    const f = await ws.getFeedback(String(b.feedbackId));
    const doc = await ws.readDoc(f.docId);
    const sectionPath = Array.isArray(b.sectionPath) ? b.sectionPath : f.target.kind === 'section' ? core.sectionKeyOf(f).split(core.KEY_SEP) : null;
    if (!sectionPath) return send(res, 400, { error: 'BAD_REQUEST', message: '섹션 피드백만 제안할 수 있습니다' });
    const sectionText = core.getSectionText(doc.md, sectionPath);
    if (sectionText == null) return send(res, 409, { error: 'SECTION_MOVED', message: '섹션을 찾지 못했습니다' });
    const title = (await ws.manifest()).docs[f.docId]?.title || f.docId;
    const ctl = new AbortController();
    running.set(f.id, ctl);
    req.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    try {
      const out = await proposeWithClaudeCli({ ...cfg, cwd: ws.root }, { docId: f.docId, docTitle: title, feedback: f, sectionPath, sectionText }, ctl.signal);
      send(res, 200, out);
    } finally { running.delete(f.id); }
  }

  /** @param {string} p @param {any} res */
  async function serveUi(p, res) {
    let file;
    if (p === '/' || p === '') file = path.join(STATIC, 'index.html');
    else if (p.startsWith('/assets/')) {
      const name = path.basename(p);
      file = name === 'boot.js' ? path.join(STATIC, 'boot.js') : path.join(DIST, name);
    }
    if (!file) return send(res, 404, { error: 'NOT_FOUND' });
    try {
      let data = await fs.readFile(file);
      if (file.endsWith('index.html')) data = Buffer.from(data.toString('utf8').replace(/__API__/g, base).replace(/__TITLE__/g, escapeHtml(ws.config.title)));
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'max-age=300',
        'X-Content-Type-Options': 'nosniff',
        ...(file.endsWith('.html') ? { 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors ${["'self'", ...(opts.allowOrigins || [])].join(' ')}; base-uri 'none'`, 'Referrer-Policy': 'no-referrer' } : {}),
      });
      res.end(data);
    } catch { send(res, 404, { error: 'NOT_FOUND' }); }
  }

  handle.close = () => { stopWatch(); clearInterval(beat); for (const c of clients) c.end(); clients.clear(); for (const r of running.values()) r.abort(); };
  handle.emit = emit;
  return handle;
}

/** @param {any} res @param {number} status @param {any} data */
function send(res, status, data) {
  if (res.writableEnded) return;
  if (status === 204 || data == null) { res.writeHead(status === 200 ? 204 : status).end(); return; }
  const s = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(s);
}

/** @param {any} res @param {any} e */
function fail(res, e) {
  if (e instanceof ConflictError) return send(res, 409, { error: 'CONFLICT', current: e.current });
  if (e instanceof NotFoundError) return send(res, 404, { error: 'NOT_FOUND', message: e.message });
  if (e instanceof BadRequestError) return send(res, 400, { error: 'BAD_REQUEST', message: e.message });
  if (e && e.code === 'READ_ONLY') return send(res, 422, { error: 'READ_ONLY', reason: e.reason, message: e.message });
  if (e && e.code === 'TOO_LARGE') { send(res, 413, { error: 'TOO_LARGE', message: e.message }); return; }
  if (e && e.code === 'BUSY') return send(res, 409, { error: 'BUSY', message: e.message });
  send(res, 500, { error: 'INTERNAL', message: String(e?.message || e).slice(0, 500) });
}

/** @param {any} req */
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    // 한도를 넘으면 더 모으지 않고 413 으로 답한다 (연결을 바로 끊으면 응답이 가지 않는다)
    req.on('data', (c) => { if (over) return; size += c.length; if (size > 8 * 1024 * 1024) { over = true; chunks.length = 0; reject(Object.assign(new Error('요청 본문이 8 MB 를 넘습니다'), { code: 'TOO_LARGE' })); } else chunks.push(c); });
    req.on('end', () => { if (over) return; try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new BadRequestError('JSON 이 아닙니다')); } });
    req.on('error', reject);
  });
}

/** @param {string} s */
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
