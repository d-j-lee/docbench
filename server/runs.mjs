// @ts-check
/**
 * Claude 작업 실행 — 서버(docbench serve·대시보드)와 실행기(docbench runner)가 같은 엔진을 쓴다.
 *
 * 요청은 .docbench/runs/<id>.req.json (화면·서버가 쓴다). 이 엔진은 runner 필드가 자기 id 인 요청만 집어
 * 한 번에 하나씩 로컬 Claude Code 를 헤드리스로 띄운다 (구독 로그인 그대로, API 키 불필요):
 *
 *   claude -p --restricted --safe-mode --permission-mode dontAsk --tools Read,Grep,Glob
 *          --add-dir <문서 폴더> --strict-mcp-config --no-session-persistence
 *          --output-format stream-json --verbose --json-schema <RUN_SCHEMA> [--model M] [--effort E]
 *   (실행 위치는 문서 폴더 밖 — 이 PC 의 설정 폴더 아래 work/)
 *
 * 왜 이렇게 막는가 (실측: Claude Code 2.1.293):
 *  - 문서 폴더 안에서 띄우면 그 폴더의 .claude/settings.json 훅이 실행되고 CLAUDE.md 가 지시로 읽혔다.
 *    문서 폴더는 git·OneDrive 로 남과 함께 쓰므로 → 폴더 밖에서 띄우고 --restricted(설정 파일 무시)·--safe-mode(CLAUDE.md·훅·플러그인 끔).
 *  - 지켜보는 사람이 없다 → 읽기 도구만, 문서 폴더 안만(--restricted 가 --add-dir 밖 읽기를 거부), 묻지 않고 거부(dontAsk).
 *  - Claude 는 고칠 글을 RUN_SCHEMA 모양으로 돌려주고, 쓰기는 이 엔진이 Workspace 규칙(판 비교·잠금·인코딩 보존·이력)으로 한다.
 *  - 필요한 플래그가 없는 옛 Claude Code 에서는 실행하지 않는다(probeClaude).
 */
import { spawn } from 'node:child_process';
import { promises as fs, watch as fsWatch, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { core } from './core.mjs';
import { readJson, writeJson } from './textio.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 실행할 claude 명령 → [실행 파일, ...앞 인자]. Windows 에서 npm 설치본(claude.cmd)은 셸 없이 띄울 수 없어
 * 그 옆의 cli.js 를 node 로 직접 부른다. 공식 설치본(claude.exe)은 그대로.
 * @param {string | string[] | undefined} command
 * @returns {string[]}
 */
export function resolveClaudeCommand(command) {
  if (Array.isArray(command) && command.length) return command.map(String);
  const cmd = typeof command === 'string' && command ? command : 'claude';
  if (process.platform !== 'win32' || /[\\/]/.test(cmd)) {
    if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) {
      const js = path.join(path.dirname(cmd), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (existsSync(js)) return [process.execPath, js];
    }
    return [cmd];
  }
  // Windows 는 이름만 주면 현재 폴더부터 찾는다 — 문서 폴더에 심어 둔 claude.exe 가 돌지 않게, 절대 경로의 PATH 만 보고 못 찾으면 띄우지 않는다
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter((d) => d && path.isAbsolute(d))) {
    const exe = path.join(dir, cmd + '.exe');
    if (existsSync(exe)) return [exe];
    const shim = path.join(dir, cmd + '.cmd');
    if (existsSync(shim)) {
      const js = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (existsSync(js)) return [process.execPath, js];
    }
  }
  return [];
}

/**
 * 명령을 끝까지 돌려 출력을 모은다 (짧은 확인용)
 * @param {string[]} cmd @param {string[]} args @param {number} ms
 * @returns {Promise<{ code: number | null, out: string, err: string, error?: Error }>}
 */
function runQuick(cmd, args, ms, cwd) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    if (!cmd.length) { resolve({ code: null, out, err, error: Object.assign(new Error('claude 를 찾지 못했습니다'), { code: 'ENOENT' }) }); return; }
    try { child = spawn(cmd[0], [...cmd.slice(1), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: cwd || os.tmpdir() }); } catch (e) { resolve({ code: null, out, err, error: /** @type {Error} */ (e) }); return; }
    const timer = setTimeout(() => { child.kill(); }, ms);
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out, err, error: e }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

/** @type {Map<string, { at: number, r: { ok: boolean, version?: string, problem?: string } }>} */
const probeCache = new Map();

/**
 * claude 가 있고 안전 실행 플래그를 아는지. 결과는 잠시 기억한다(실패는 1분, 성공은 10분).
 * 확인도 문서 폴더 밖(cwd)에서 띄운다.
 * @param {string[]} cmd @param {boolean} [force] @param {string} [cwd]
 * @returns {Promise<{ ok: boolean, version?: string, problem?: string, reason?: 'no-claude' | 'old-claude' }>}
 */
export async function probeClaude(cmd, force = false, cwd) {
  const key = JSON.stringify(cmd);
  const hit = probeCache.get(key);
  if (hit && !force && Date.now() - hit.at < (hit.r.ok ? 600000 : 60000)) return hit.r;
  const v = await runQuick(cmd, ['--version'], 20000, cwd);
  /** @type {{ ok: boolean, version?: string, problem?: string, reason?: 'no-claude' | 'old-claude' }} */
  let r;
  if (v.error || v.code !== 0) {
    r = { ok: false, reason: 'no-claude', problem: !cmd.length || (v.error && /** @type {any} */ (v.error).code === 'ENOENT')
      ? 'claude 실행 파일을 찾지 못했습니다. Claude Code 를 설치하거나, 이 PC 의 설정(docbench status 가 위치를 알려 준다)의 assistant.command 에 claude 전체 경로를 적으세요.'
      : `claude --version 이 실패했습니다: ${(v.err || v.out || String(v.error?.message || '')).trim().slice(0, 200)}` };
  } else {
    const version = (v.out.match(/\d+\.\d+\.\d+/) || [])[0];
    const help = await runQuick(cmd, ['--help'], 20000, cwd);
    const missing = core.REQUIRED_CLAUDE_FLAGS.filter((f) => !help.out.includes(f));
    r = missing.length
      ? { ok: false, version, reason: 'old-claude', problem: `이 Claude Code(${version || '?'})에는 안전 실행에 필요한 ${missing.join(' ')} 가 없습니다. claude update 로 올려 주세요.` }
      : { ok: true, version };
  }
  probeCache.set(key, { at: Date.now(), r });
  return r;
}

/** @param {unknown} pid */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || /** @type {number} */ (pid) <= 0 || pid === process.pid) return false;
  try { process.kill(/** @type {number} */ (pid), 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; }
}

/** @param {import('node:child_process').ChildProcess} child */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { child.kill(); }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    setTimeout(() => { try { process.kill(-(child.pid || 0), 'SIGKILL'); } catch { /* 이미 끝남 */ } }, 4000).unref();
  }
}

/**
 * 이 PC·이 사용자의 엔진 id. 화면이 요청에 적는 runner 와 같아야 한다 — 이 PC 의 설정 user 가 있으면 그것.
 * @param {{ config: any }} ws @param {'runner' | 'server'} kind
 */
export function engineId(ws, kind) {
  return `${kind}:${ws.config.user || os.userInfo().username || 'me'}@${os.hostname() || 'pc'}`;
}

/**
 * 이 PC 가 직접 적어 두는 "내 엔진" 기록 (문서 폴더 밖, 이 PC 의 설정 폴더). 문서 폴더의 심장 박동 파일은 폴더를 함께 쓰는
 * 누구나 고칠 수 있으므로, 프로세스를 끝내거나 "이미 켜짐"을 판단할 때는 이 기록만 믿는다.
 * @param {{ pcConfigFile: string }} ws @param {string} root @param {'runner' | 'server'} kind
 */
export function localEngineFile(ws, root, kind) {
  const key = crypto.createHash('sha1').update(process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root)).digest('hex').slice(0, 12);
  return path.join(path.dirname(ws.pcConfigFile), 'engines', `${kind}-${key}.json`);
}

/**
 * 이 PC 에서 그 폴더의 엔진이 돌고 있나. 셋 다 맞아야 한다:
 *  - 이 PC 의 기록이 있고 그 pid 가 살아 있다
 *  - 기록이 이번 부팅 뒤의 것이다 (꺼짐·재부팅으로 남은 기록의 pid 를 다른 프로그램이 다시 받았을 수 있다)
 *  - 기록 폴더의 내 심장 박동이 최근이고 같은 pid 다 (엔진은 4초마다 적는다)
 * @param {{ pcConfigFile: string, config: any, dir: string }} ws @param {string} root @param {'runner' | 'server'} kind
 * @returns {Promise<any | null>}
 */
export async function localEngine(ws, root, kind) {
  const rec = /** @type {any} */ (await readJson(localEngineFile(ws, root, kind)));
  if (!rec || !pidAlive(rec.pid)) return null;
  const started = Date.parse(rec.startedAt || '');
  if (!isFinite(started) || started < Date.now() - os.uptime() * 1000 - 5000) return null;
  const id = engineId(ws, kind);
  if (rec.id !== id) return null;
  const beat = /** @type {any} */ (await readJson(path.join(ws.dir, 'runners', core.runnerFileName(id))));
  return beat && core.runnerAlive(beat) && beat.id === id && beat.pid === rec.pid ? rec : null;
}

export class RunEngine {
  /**
   * @param {import('./workspace.mjs').Workspace} ws
   * @param {{ kind: 'runner' | 'server', emit?: (ev: { type: string, id?: string }) => void, log?: (line: any, run?: string) => void, claudeCommand?: string[], onStopRequest?: () => void }} o
   */
  constructor(ws, o) {
    this.ws = ws;
    this.o = o;
    this.user = ws.config.user || os.userInfo().username || 'me';
    this.host = os.hostname() || 'pc';
    this.id = engineId(ws, o.kind);
    this.localFile = localEngineFile(ws, ws.root, o.kind);
    this.dir = path.join(ws.dir, 'runs');
    this.beatDir = path.join(ws.dir, 'runners');
    this.beatFile = path.join(this.beatDir, core.runnerFileName(this.id));
    this.workDir = path.join(path.dirname(ws.pcConfigFile), 'work');
    this.startedAt = new Date().toISOString();
    /** @type {any[]} */
    this.queue = [];
    /** @type {any | null} */
    this.current = null;
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null;
    this.cancelRequested = false;
    /** @type {Set<string>} */
    this.known = new Set();
    /** 읽기에 실패한 요청 → 처음 실패한 때 (동기화 중·잠긴 파일은 1분 동안 다시 읽는다) @type {Map<string, number>} */
    this.tries = new Map();
    /** 지금 작업의 단계 (꺼질 때 반영 중이었는지) @type {string | null} */
    this.phase = null;
    /** @type {{ ok: boolean, version?: string, problem?: string, reason?: string }} */
    this.claude = { ok: false, problem: '확인 전' };
    this.stopped = false;
    /** @type {NodeJS.Timeout[]} */
    this.timers = [];
    /** @type {import('node:fs').FSWatcher | null} */
    this.watcher = null;
    this.emitLater = new Map();
  }

  get claudeCmd() { return this.o.claudeCommand || resolveClaudeCommand(this.ws.config.assistant?.command); }
  get actor() { return { kind: 'assistant', name: this.ws.config.assistantName || 'Claude' }; }

  /** @returns {import('../dist/core.mjs').RunnerInfo} */
  info() {
    return {
      id: this.id, kind: this.o.kind, user: this.user, host: this.host, pid: process.pid, version: core.DOCBENCH_VERSION, protocol: core.RUN_PROTOCOL,
      startedAt: this.startedAt, seenAt: new Date().toISOString(),
      claude: { ok: this.claude.ok, version: this.claude.version, problem: this.claude.problem, reason: /** @type {any} */ (this.claude.reason) },
      models: core.RUN_MODELS, efforts: core.RUN_EFFORTS, busy: this.current?.id || null, queue: this.queue.length,
    };
  }

  /** 화면에 줄 상태 @returns {import('../dist/core.mjs').RunsAvailability} */
  availability() {
    if (this.stopped) return { available: false, reason: 'disabled' };
    if (!this.claude.ok) return { available: false, reason: /** @type {any} */ (this.claude.reason || 'no-claude'), message: this.claude.problem, runner: this.info() };
    return { available: true, runner: this.info() };
  }

  /** @param {string} type @param {string} [id] */
  emit(type, id) {
    if (!this.o.emit) return;
    // 로그 줄마다 알리면 너무 잦다 — 같은 작업은 0.3초에 한 번
    const k = type + ':' + (id || '');
    if (this.emitLater.has(k)) return;
    this.emitLater.set(k, setTimeout(() => { this.emitLater.delete(k); this.o.emit?.({ type, id }); }, 300));
  }

  async start() {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.mkdir(this.beatDir, { recursive: true });
    await fs.mkdir(this.workDir, { recursive: true });
    this.claude = await probeClaude(this.claudeCmd, false, this.workDir);
    // 같은 PC·같은 폴더에 이미 도는 엔진 — 이 PC 가 적어 둔 기록으로만 판단한다(문서 폴더의 심장 박동은 남이 꾸밀 수 있다)
    const prev = await localEngine(this.ws, this.ws.root, this.o.kind);
    if (prev) throw Object.assign(new Error(`같은 ${this.o.kind === 'runner' ? '실행기' : '서버'}가 이 폴더에서 이미 돌고 있습니다 (pid ${prev.pid}).${this.o.kind === 'runner' ? ' 끄려면: docbench runner --stop' : ''}`), { code: 'RUNNING' });
    await writeJson(this.localFile, { pid: process.pid, id: this.id, kind: this.o.kind, root: this.ws.root, startedAt: this.startedAt });
    // 지난번에 남은 끄기 요청은 지운다(켜자마자 꺼지지 않게)
    await fs.rm(this.stopFile, { force: true }).catch(() => undefined);
    await this.recover();
    await this.beat();
    this.timers.push(setInterval(() => void this.beat(), core.RUNNER_BEAT_MS));
    // 요청은 감시로 바로, 감시가 안 되는 드라이브를 위해 1.5초 폴링도
    try { this.watcher = fsWatch(this.dir, () => void this.scan()); this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null; }); } catch { /* 폴링만 */ }
    this.timers.push(setInterval(() => void this.scan(), 1500));
    // 실패한 확인은 1분마다 다시 (claude 를 설치·업데이트한 뒤 실행기를 다시 켜지 않아도 되게)
    this.timers.push(setInterval(async () => { if (!this.claude.ok) { this.claude = await probeClaude(this.claudeCmd, true, this.workDir); if (this.claude.ok) { await this.beat(); this.emit('runner'); void this.scan(); } } }, 60000));
    await this.scan();
    void this.cleanup();
    return this;
  }

  async stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.watcher?.close();
    for (const t of this.emitLater.values()) clearTimeout(t);
    if (this.child) { this.cancelRequested = true; killTree(this.child); }
    // 하던 작업·줄 선 작업이 "실행 중·대기"로 남아 화면의 카드를 붙잡지 않게
    const now = new Date().toISOString();
    if (this.current) {
      // 반영하던 중이었으면 일부는 이미 들어갔을 수 있다 — "취소"가 아니라 확인이 필요한 실패로
      const applying = this.phase === 'applying';
      await writeJson(this.files(this.current.id).status, { ...this.current, state: applying ? 'failed' : 'canceled', endedAt: now, error: applying ? '반영하던 중에 실행기·서버가 꺼졌습니다. 일부만 반영됐을 수 있으니 변경 이력을 확인하세요.' : '실행기·서버가 꺼져 멈췄습니다.', progress: undefined }).catch(() => undefined);
    }
    for (const r of this.queue.splice(0)) await writeJson(this.files(r.id).status, { ...r, state: 'canceled', endedAt: now, error: '실행기·서버가 꺼져 멈췄습니다.' }).catch(() => undefined);
    const cur = /** @type {any} */ (await readJson(this.beatFile));
    if (cur && cur.pid === process.pid) await fs.rm(this.beatFile, { force: true });
    const mine = /** @type {any} */ (await readJson(this.localFile));
    if (mine && mine.pid === process.pid) await fs.rm(this.localFile, { force: true }).catch(() => undefined);
  }

  get stopFile() { return this.beatFile.replace(/\.json$/, '.stop'); }

  async beat() {
    if (this.stopped) return;
    await writeJson(this.beatFile, this.info()).catch(() => undefined);
    // 끄기 요청 (docbench runner --stop · 화면): 실행기만 따른다 — 서버는 화면을 띄운 사람이 끈다
    if (this.o.kind === 'runner' && existsSync(this.stopFile)) { await fs.rm(this.stopFile, { force: true }).catch(() => undefined); this.o.onStopRequest?.(); }
  }

  /** 지난번에 이 실행기가 하다 만 작업: 돌던 것은 실패로, 줄 서 있던 것은 다시 줄에 */
  async recover() {
    for (const st of await this.list(1000)) {
      if (st.runner !== this.id) continue;
      if (st.state === 'running') await this.writeStatus({ ...st, state: 'failed', endedAt: new Date().toISOString(), error: '실행기가 작업 도중 꺼졌다가 다시 켜졌습니다.', progress: undefined });
    }
  }

  // ------------------------------------------------------------ 파일
  /** @param {string} id */
  files(id) {
    // 상태 파일 안의 id 는 믿지 않는다 — 파일 이름에서 온, 모양이 맞는 id 만 경로가 된다
    if (!core.validRunId(id)) throw Object.assign(new Error('잘못된 작업 id: ' + String(id).slice(0, 60)), { code: 'BAD_REQUEST' });
    const f = core.runFiles(id); return { req: path.join(this.dir, f.req), status: path.join(this.dir, f.status), log: path.join(this.dir, f.log), cancel: path.join(this.dir, f.cancel), out: path.join(this.dir, id + '.out.json') }; }
  /** @param {any} st */
  async writeStatus(st) { if (this.current?.id === st.id) this.phase = st.progress?.phase || null; await writeJson(this.files(st.id).status, st); this.emit('runs', st.id); }
  /** @param {string} id @param {any} line */
  async log(id, line) {
    const l = { at: new Date().toISOString(), ...line };
    await fs.appendFile(this.files(id).log, JSON.stringify(l) + '\n');
    this.o.log?.(l, id);
    this.emit('runs', id);
  }

  /** 요청·상태 목록 (최근 것 먼저) @param {number} [limit] @returns {Promise<any[]>} */
  async list(limit = 30) {
    const names = await fs.readdir(this.dir).catch(() => []);
    const ids = [...new Set(names.map((n) => n.replace(/\.(req\.json|json|log\.jsonl|cancel)$/, '')).filter((id) => core.validRunId(id)))].sort().reverse().slice(0, limit);
    const out = [];
    for (const id of ids) {
      const f = this.files(id);
      const st = core.cleanRunEntry(await readJson(f.status), id);
      if (st) { out.push(st); continue; }
      const req = core.cleanRunEntry(await readJson(f.req), id, 'queued');
      if (req) out.push(req);
    }
    return out;
  }

  /** @param {string} id @param {number} from @returns {Promise<{ lines: any[], next: number }>} */
  async readLog(id, from = 0) {
    if (!core.validRunId(id)) throw Object.assign(new Error('잘못된 작업 id'), { code: 'BAD_REQUEST' });
    const fh = await fs.open(this.files(id).log, 'r').catch(() => null);
    if (!fh) return { lines: [], next: 0 };
    try {
      const { size } = await fh.stat();
      if (from > size) from = 0;
      const len = Math.min(size - from, 4 * 1024 * 1024);
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(len), 0, len, from);
      const { items, consumed } = core.completeJsonLines(buffer.subarray(0, bytesRead));
      return { lines: items, next: from + consumed };
    } finally { await fh.close(); }
  }

  // ------------------------------------------------------------ 요청 받기
  /**
   * 서버 화면의 요청: 요청 파일을 남기고 줄에 세운다
   * @param {any} input @param {any} [by]
   */
  async submit(input, by) {
    if (!this.claude.ok) this.claude = await probeClaude(this.claudeCmd, true, this.workDir);
    if (!this.claude.ok) throw Object.assign(new Error(this.claude.problem || 'claude 를 쓸 수 없습니다'), { code: 'UNAVAILABLE' });
    const req = core.makeRunRequest(input, { runner: this.id, by });
    await writeJson(this.files(req.id).req, req);
    await this.scan();
    return { ...req, state: 'queued' };
  }

  /** @param {string} id */
  async cancel(id) {
    if (!core.validRunId(id)) throw Object.assign(new Error('잘못된 작업 id'), { code: 'BAD_REQUEST' });
    await fs.writeFile(this.files(id).cancel, new Date().toISOString());
    await this.scan();
  }

  scanning = false;
  scanAgain = false;
  async scan() {
    if (this.stopped) return;
    if (this.scanning) { this.scanAgain = true; return; }
    this.scanning = true;
    try {
      do {
        this.scanAgain = false;
        const names = await fs.readdir(this.dir).catch(() => []);
        const set = new Set(names);
        for (const n of names) {
          if (!n.endsWith('.req.json')) continue;
          const id = n.slice(0, -'.req.json'.length);
          if (!core.validRunId(id)) continue;
          const f = core.runFiles(id);
          // 취소 요청: 줄 서 있으면 빼고, 돌고 있으면 멈춘다
          if (set.has(f.cancel)) {
            if (this.current?.id === id && this.child && !this.cancelRequested) { this.cancelRequested = true; killTree(this.child); }
            const qi = this.queue.findIndex((r) => r.id === id);
            if (qi >= 0) { const [r] = this.queue.splice(qi, 1); await this.writeStatus({ ...r, state: 'canceled', endedAt: new Date().toISOString() }); }
          }
          if (this.known.has(id)) continue;
          // 읽다 실패하면(동기화 중·잠김) 다음 훑기에서 다시 — 처음 실패하고 1분까지. 그래도 안 되면 내 앞 요청이면 실패로 남긴다(카드를 붙잡지 않게)
          const retry = async () => {
            const first = this.tries.get(id) ?? Date.now();
            this.tries.set(id, first);
            if (Date.now() - first < 60000) return;
            this.known.add(id);
            this.tries.delete(id);
            const text = await fs.readFile(path.join(this.dir, n), 'utf8').catch(() => '');
            if (text.includes(JSON.stringify(this.id)) && !set.has(f.status)) await this.writeStatus({ id, at: new Date().toISOString(), runner: this.id, kind: 'handoff', feedbackIds: [], state: 'failed', error: '요청 파일을 읽지 못했습니다(깨졌거나 동기화가 끝나지 않음). 다시 넘겨 주세요.', endedAt: new Date().toISOString() }).catch(() => undefined);
          };
          if (set.has(f.status)) {
            // 지난번 실행 때 줄 서 있던 내 요청은 다시 줄에
            const st = /** @type {any} */ (await readJson(path.join(this.dir, f.status)));
            if (!st) { await retry(); continue; }
            if (!(st.runner === this.id && st.state === 'queued' && !set.has(f.cancel))) { this.known.add(id); continue; }
          }
          const raw = /** @type {any} */ (await readJson(path.join(this.dir, n)));
          if (!raw || typeof raw !== 'object') { await retry(); continue; }
          this.known.add(id);
          this.tries.delete(id);
          if (raw.runner !== this.id) continue;
          let req;
          try { req = { ...core.cleanRunEntry(raw, id), ...core.normalizeRunInput(raw), id, runner: this.id }; } catch (e) {
            await this.writeStatus({ id, at: new Date().toISOString(), runner: this.id, kind: 'handoff', feedbackIds: [], state: 'failed', error: String(/** @type {any} */ (e).message).slice(0, 300), endedAt: new Date().toISOString() });
            continue;
          }
          if (set.has(f.cancel)) { await this.writeStatus({ ...req, state: 'canceled', endedAt: new Date().toISOString() }); continue; }
          this.queue.push(req);
          await this.writeStatus({ ...req, state: 'queued' });
        }
      } while (this.scanAgain);
    } finally { this.scanning = false; }
    void this.pump();
  }

  async pump() {
    if (this.current || this.stopped || !this.queue.length) return;
    const req = this.queue.shift();
    this.current = req;
    this.cancelRequested = false;
    void this.beat();
    try { await this.runOne(req); } catch (e) {
      await this.writeStatus({ ...req, state: 'failed', endedAt: new Date().toISOString(), error: String(/** @type {any} */ (e)?.message || e).slice(0, 500) }).catch(() => undefined);
    } finally {
      this.current = null;
      this.child = null;
      void this.beat();
      void this.cleanup();
    }
    void this.pump();
  }

  /** 오래된 작업 파일 정리 (최근 RUN_KEEP 개만) */
  async cleanup() {
    const names = await fs.readdir(this.dir).catch(() => []);
    const ids = [...new Set(names.map((n) => n.replace(/\.(req\.json|out\.json|json|log\.jsonl|cancel)$/, '')).filter((id) => core.validRunId(id)))].sort().reverse();
    for (const id of ids.slice(core.RUN_KEEP)) {
      const st = /** @type {any} */ (await readJson(this.files(id).status));
      if (st && (st.state === 'queued' || st.state === 'running') && !this.staleEntry(st)) continue;
      for (const f of Object.values(this.files(id))) await fs.rm(f, { force: true }).catch(() => undefined);
    }
  }

  /** 줄 서 있다고 적혀 있지만 맡을 엔진이 하루 넘게 소식이 없는 작업 — 정리해도 된다 @param {any} st */
  staleEntry(st) { return Date.parse(st.at || '') < Date.now() - 86400000; }

  // ------------------------------------------------------------ 한 작업
  /** @param {any} req */
  async buildContext(req) {
    const ws = this.ws;
    await ws.scan();
    /** @type {import('../dist/core.mjs').RunContext} */
    const ctx = { kind: req.kind, mode: req.mode || 'auto', root: ws.root, items: [], docs: {} };
    /** @type {{ id: string, reason: string }[]} */
    const skipped = [];
    const titles = new Map();
    for (const id of req.feedbackIds) {
      let f;
      try { f = await ws.getFeedback(id); } catch { skipped.push({ id, reason: 'gone' }); continue; }
      if (f.status !== 'open' || (req.kind === 'handoff' && f.waitingOn !== 'assistant')) { skipped.push({ id, reason: 'not-waiting' }); continue; }
      if (req.kind === 'propose' && f.target.kind !== 'section') { skipped.push({ id, reason: 'not-section' }); continue; }
      /** @type {import('../dist/core.mjs').RunItem} */
      const it = { feedback: f, allowed: ['answer', 'ask', 'decline'] };
      if (f.docId && f.target.kind !== 'item') {
        let doc;
        try { doc = await ws.readDoc(f.docId); } catch { skipped.push({ id, reason: 'no-doc' }); continue; }
        if (!titles.has(f.docId)) titles.set(f.docId, await ws.titleOf(f.docId).catch(() => f.docId));
        ctx.docs[f.docId] ||= { md: doc.md, version: doc.version };
        it.docId = doc.id;
        it.docTitle = titles.get(f.docId);
        it.docPath = path.join(ws.root, ...doc.id.split('/'));
        it.docVersion = doc.version;
        // 설정으로 막은 문서는 고치지도 제안하지도 않는다. 인코딩 때문에 읽기 전용이면 제안만(사람이 UTF-8 변환에 동의하고 적용)
        /** @type {import('../dist/core.mjs').RunAction[]} */
        const canChange = !doc.readOnly ? ['edit', 'propose'] : doc.readOnlyReason === 'config' ? [] : ['propose'];
        const key = core.locateSectionKey(doc.md, f);
        if (key) {
          const text = core.getSectionText(doc.md, key);
          const s = core.findSection(doc.md, key);
          it.sectionKey = key;
          it.sectionLine = s ? doc.md.slice(0, s.start).split('\n').length : undefined;
          if (text != null && text.length > core.MAX_SECTION_CHARS) it.tooLarge = true;
          else { it.sectionText = text ?? undefined; it.allowed = [...canChange, ...it.allowed]; }
        } else if (f.target.kind === 'doc') {
          it.sectionKeys = core.sectionSources(doc.md).map((s) => s.key);
          if (it.sectionKeys.length) it.allowed = [...canChange, ...it.allowed];
        }
        if (req.kind === 'propose') it.allowed = it.allowed.filter((a) => a !== 'edit');
      }
      if (ctx.mode === 'propose') it.allowed = it.allowed.filter((a) => a !== 'edit');
      ctx.items.push(it);
    }
    return { ctx, skipped };
  }

  /** @param {any} req */
  async runOne(req) {
    const t0 = Date.now();
    /** @type {any} */
    let st = { ...req, state: 'running', startedAt: new Date().toISOString(), progress: { phase: 'starting', at: new Date().toISOString() } };
    await this.writeStatus(st);
    await this.log(req.id, { k: 'start', v: { kind: req.kind, model: req.model || '', effort: req.effort || '', mode: req.mode || 'auto', n: req.feedbackIds.length } });
    const summary = core.emptySummary();
    if (!this.claude.ok) this.claude = await probeClaude(this.claudeCmd, true, this.workDir);
    if (!this.claude.ok) throw new Error(this.claude.problem || 'claude 를 쓸 수 없습니다');

    const { ctx, skipped } = await this.buildContext(req);
    for (const s of skipped) { summary.skipped++; await this.log(req.id, { k: 'skip', v: { fb: s.id, reason: s.reason }, ref: { feedbackId: s.id } }); }
    st.docs = [...new Set(ctx.items.map((i) => i.docId).filter(Boolean))];
    if (!ctx.items.length) {
      await this.writeStatus({ ...st, state: 'done', endedAt: new Date().toISOString(), summary, progress: undefined });
      await this.log(req.id, { k: 'done', v: { ms: Date.now() - t0 } });
      return;
    }
    const prompt = core.buildRunPrompt(ctx);
    const args = [
      '-p',
      '--restricted', '--safe-mode',
      '--permission-mode', 'dontAsk',
      '--tools', 'Read,Grep,Glob',
      '--add-dir', this.ws.root,
      '--strict-mcp-config', '--no-session-persistence',
      '--output-format', 'stream-json', '--verbose',
      '--json-schema', JSON.stringify(core.RUN_SCHEMA),
      ...(req.model ? ['--model', req.model] : this.ws.config.assistant?.model ? ['--model', this.ws.config.assistant.model] : []),
      ...(req.effort ? ['--effort', req.effort] : []),
      ...(this.ws.config.assistant?.args || []),
    ];
    const cmd = this.claudeCmd;
    // 어떻게 띄우는지 사람이 볼 수 있게 — 화면 로그에 "안전 실행" 한 줄
    await this.log(req.id, { k: 'safe', v: { tools: 'Read, Grep, Glob', flags: '--restricted --safe-mode --permission-mode dontAsk' } });
    const timeoutMs = (this.ws.config.assistant?.timeoutSec || 900) * 1000;
    /** @type {any} */
    let result = null;
    /** @type {any} */
    let limit = null;
    let errTail = '';
    let lastProgress = 0;
    let timedOut = false;
    /** 이 작업의 모델 (stream 의 system/init) @type {string} */
    let mainModel = '';
    const code = await new Promise((resolve) => {
      /** @type {import('node:child_process').ChildProcess} */
      let child;
      try {
        child = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd: this.workDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
      } catch (e) { errTail = String(/** @type {any} */ (e).message); resolve(null); return; }
      this.child = child;
      const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
      let buf = '';
      /** @type {Promise<void>} */
      let chain = Promise.resolve();
      child.stdout?.setEncoding('utf8').on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'result') { result = ev; continue; }
          if (ev.type === 'rate_limit_event') { const w = ev.rate_limit_info?.unifiedWindows?.five_hour; if (w) limit = { window: 'five_hour', utilization: w.utilization, resetsAt: w.resetsAt }; continue; }
          const lines = core.streamEventToLog(ev, this.ws.root);
          if (ev?.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') mainModel = ev.model;
          const ph = core.streamEventPhase(ev);
          chain = chain.then(async () => {
            for (const l of lines) await this.log(req.id, l);
            if (ph && Date.now() - lastProgress > 1000) { lastProgress = Date.now(); st = { ...st, progress: { ...ph, at: new Date().toISOString() } }; await this.writeStatus(st); }
          }).catch(() => undefined);
        }
      });
      child.stderr?.setEncoding('utf8').on('data', (d) => { errTail = (errTail + d).slice(-2000); });
      child.on('error', (e) => { clearTimeout(timer); errTail = /** @type {any} */ (e).code === 'ENOENT' ? 'claude 실행 파일을 찾지 못했습니다' : e.message; resolve(null); });
      child.on('close', (c) => { clearTimeout(timer); void chain.then(() => resolve(c)); });
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(prompt);
    });
    const usage = result ? {
      // modelUsage 에는 보조로 쓰인 작은 모델이 먼저(때로는 출력도 더 많이) 나온다(실측: sonnet 작업에 haiku 가 첫 키) — 시작 때 알린 모델로
      model: mainModel || req.model, durationMs: result.duration_ms, turns: result.num_turns,
      inputTokens: (result.usage?.input_tokens || 0) + (result.usage?.cache_creation_input_tokens || 0) + (result.usage?.cache_read_input_tokens || 0),
      outputTokens: result.usage?.output_tokens, costUsd: result.total_cost_usd, limit: limit || undefined,
    } : limit ? { limit } : undefined;
    const end = (/** @type {any} */ extra) => this.writeStatus({ ...st, ...extra, endedAt: new Date().toISOString(), progress: undefined, usage, summary });

    if (this.cancelRequested) { await this.log(req.id, { k: 'canceled' }); await end({ state: 'canceled' }); return; }
    if (timedOut) { await this.log(req.id, { k: 'timeout', v: { sec: timeoutMs / 1000 } }); await end({ state: 'failed', error: `시간 초과 (${timeoutMs / 1000}초)` }); return; }
    if (!result || result.is_error) {
      const msg = result ? String(result.result || result.api_error_status || 'claude 오류').slice(0, 400) : (errTail.trim().split('\n').slice(-3).join(' ') || `claude 가 결과 없이 끝났습니다 (종료 코드 ${code})`).slice(0, 400);
      await this.log(req.id, { k: 'error', v: { message: msg } });
      await end({ state: 'failed', error: msg });
      return;
    }
    let payload = result.structured_output;
    if (!payload && typeof result.result === 'string') { try { payload = JSON.parse(result.result.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* 아래에서 */ } }
    if (!payload) { await this.log(req.id, { k: 'error', v: { message: '정해진 모양의 결과가 없습니다' } }); await end({ state: 'failed', error: '정해진 모양의 결과가 없습니다' }); return; }

    // 문제를 살펴볼 때: DOCBENCH_RUN_DEBUG=1 이면 Claude 가 돌려준 결과를 그대로 남긴다 (.docbench/runs/<id>.out.json, 커밋하지 않음)
    if (process.env.DOCBENCH_RUN_DEBUG === '1') await writeJson(path.join(this.dir, req.id + '.out.json'), payload).catch(() => undefined);

    // ---- 반영
    st = { ...st, progress: { phase: 'applying', at: new Date().toISOString() } };
    await this.writeStatus(st);
    const plan = core.planRun(ctx, payload);
    for (const a of plan.actions) {
      if (a.failed) {
        // 반영할 수 없는 결과: 피드백은 그대로 Claude 차례 — 다시 넘기면 된다
        summary.failed++;
        await this.log(req.id, { k: 'applyFail', v: { fb: a.feedbackId, message: a.problem || a.failed }, ref: { feedbackId: a.feedbackId, docId: a.docId }, text: a.message });
        continue;
      }
      try {
        const r = await this.apply(req, ctx, a);
        if (r === 'gone') { summary.skipped++; await this.log(req.id, { k: 'skip', v: { fb: a.feedbackId, reason: 'changed' }, ref: { feedbackId: a.feedbackId } }); continue; }
        summary[r === 'edit' ? 'edited' : r === 'propose' ? 'proposed' : r === 'answer' ? 'answered' : r === 'ask' ? 'asked' : 'declined']++;
      } catch (e) {
        summary.failed++;
        await this.log(req.id, { k: 'applyFail', v: { fb: a.feedbackId, message: String(/** @type {any} */ (e)?.message || e).slice(0, 300) }, ref: { feedbackId: a.feedbackId, docId: a.docId } });
      }
    }
    for (const id of plan.missing) { summary.skipped++; await this.log(req.id, { k: 'skip', v: { fb: id, reason: 'no-answer' }, ref: { feedbackId: id } }); }
    if (plan.summary) await this.log(req.id, { k: 'summary', text: plan.summary });
    await this.log(req.id, { k: 'done', v: { ms: Date.now() - t0, edited: summary.edited, proposed: summary.proposed, answered: summary.answered, asked: summary.asked, declined: summary.declined, skipped: summary.skipped, failed: summary.failed } });
    await end({ state: 'done' });
  }

  /**
   * 피드백 하나를 고친다. 그 사이 사람이 닫았거나 남에게 넘겼으면 'gone'
   * @param {any} req @param {string} id @param {(f: any) => any} patchOf
   */
  async updateFb(req, id, patchOf) {
    for (let i = 0; i < 3; i++) {
      let f;
      try { f = await this.ws.getFeedback(id); } catch { return 'gone'; }
      if (f.status !== 'open' || (req.kind === 'handoff' && f.waitingOn !== 'assistant')) return 'gone';
      try { await this.ws.updateFeedback(id, patchOf(f), f.version); return 'ok'; } catch (e) {
        if (/** @type {any} */ (e).code !== 'CONFLICT' && /** @type {any} */ (e).code !== 'BUSY') throw e;
        await sleep(120 * (i + 1));
      }
    }
    throw new Error('피드백이 계속 바뀌어 회신하지 못했습니다');
  }

  /**
   * @param {any} req @param {import('../dist/core.mjs').RunContext} ctx @param {import('../dist/core.mjs').PlannedAction} a
   * @returns {Promise<'edit' | 'propose' | 'answer' | 'ask' | 'decline' | 'gone'>}
   */
  async apply(req, ctx, a) {
    const ws = this.ws;
    const now = () => new Date().toISOString();
    const actor = this.actor;
    const msg = (/** @type {string} */ m, /** @type {any} */ note) => (m + (note ? ' ' + core.noteText(note) : '')).trim();
    const ref = { feedbackId: a.feedbackId, docId: a.docId, section: a.sectionKey };
    let action = a.action;
    let note = a.note;

    if (action === 'edit' && a.docId && a.sectionKey && a.text != null) {
      // 사람이 그 사이 같은 섹션을 고쳤으면 덮지 않고 제안으로. 다른 곳만 바뀌었으면 지금 판에 그대로 끼운다
      for (let i = 0; i < 3 && action === 'edit'; i++) {
        const doc = await ws.readDoc(a.docId);
        const cur = core.getSectionText(doc.md, a.sectionKey);
        if (cur == null || core.norm(cur) !== core.norm(a.before || '')) { action = 'propose'; note = 'changed-meanwhile'; break; }
        const next = core.replaceSection(doc.md, a.sectionKey, a.text);
        if (next == null) { action = 'propose'; break; }
        // 피드백이 아직 Claude 차례인지 먼저 본다 — 닫힌 피드백 때문에 문서를 고치지 않게
        const f = await ws.getFeedback(a.feedbackId).catch(() => null);
        if (!f || f.status !== 'open' || (req.kind === 'handoff' && f.waitingOn !== 'assistant')) return 'gone';
        try {
          await ws.writeDoc(a.docId, next, { baseVersion: doc.version, summary: a.message.slice(0, 200), feedbackIds: [a.feedbackId], by: actor });
          // 서버 안에서 쓴 것은 이력 감시가 '내 쓰기'로 건너뛴다 — 화면에 직접 알린다 (실행기 프로세스면 화면이 이력 줄을 본다)
          this.o.emit?.({ type: 'doc', id: a.docId });
          this.o.emit?.({ type: 'changes' });
          const r = await this.updateFb(req, a.feedbackId, (fb) => ({ status: 'resolved', thread: [...fb.thread, { author: actor, text: msg(a.message, note), at: now() }] }));
          await this.log(req.id, { k: 'apply.edit', v: { fb: a.feedbackId, doc: a.docId, section: a.sectionKey }, ref });
          if (r === 'gone') await this.log(req.id, { k: 'warn', v: { message: '문서는 고쳤지만 그 사이 피드백이 바뀌어 회신은 남기지 못했습니다' }, ref });
          return 'edit';
        } catch (e) {
          const c = /** @type {any} */ (e).code;
          if (c === 'READ_ONLY') { action = 'propose'; break; }
          if (c !== 'CONFLICT' && c !== 'BUSY') throw e;
          await sleep(150 * (i + 1));
        }
      }
      if (action === 'edit') { action = 'propose'; note ||= 'changed-meanwhile'; }
    }

    if (action === 'propose' && a.sectionKey && a.text != null) {
      const r = await this.updateFb(req, a.feedbackId, (fb) => ({
        waitingOn: 'owner',
        proposal: { path: a.sectionKey ? core.keyToPath(a.sectionKey) : [], before: a.before || '', after: a.text, rationale: a.message, author: actor, at: now(), state: 'pending' },
        thread: [...fb.thread, { author: actor, text: msg(a.message, note), at: now() }],
      }));
      if (r === 'gone') return 'gone';
      await this.log(req.id, { k: 'apply.propose', v: { fb: a.feedbackId, doc: a.docId || '', section: a.sectionKey, note: note || '' }, ref });
      return 'propose';
    }
    if (action === 'propose') { action = 'ask'; note ||= 'no-section'; }

    const patch = action === 'answer' ? { status: 'resolved' } : action === 'decline' ? { status: 'declined' } : { status: 'open', waitingOn: 'owner' };
    const r = await this.updateFb(req, a.feedbackId, (fb) => ({ ...patch, thread: [...fb.thread, { author: actor, text: msg(a.message, note), at: now() }] }));
    if (r === 'gone') return 'gone';
    await this.log(req.id, { k: 'apply.' + action, v: { fb: a.feedbackId, note: note || '', problem: a.problem || undefined }, ref, text: a.message });
    return /** @type {any} */ (action);
  }
}

/**
 * 이 폴더의 실행기 심장 박동들
 * @param {string} root
 */
/** 기록 폴더의 실행기 심장 박동들 (보여 주기·고르기용 — 남이 꾸밀 수 있다) @param {string} dataDir 기록 폴더(Workspace.dir) */
export async function listRunners(dataDir) {
  const dir = path.join(dataDir, 'runners');
  const out = [];
  for (const n of await fs.readdir(dir).catch(() => [])) {
    if (!n.endsWith('.json')) continue;
    const r = /** @type {any} */ (await readJson(path.join(dir, n)));
    if (r && typeof r === 'object') out.push(r);
  }
  return out;
}
