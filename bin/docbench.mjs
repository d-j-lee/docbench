#!/usr/bin/env node
// @ts-check
/**
 * docbench CLI — 사람과 터미널의 Claude Code 가 같은 작업 폴더를 다룬다.
 * 서버가 꺼져 있어도 파일만으로 동작하고, 서버가 켜져 있으면 화면이 실시간으로 따라온다.
 *
 *   docbench serve [폴더] [--port 4317] [--host 127.0.0.1] [--token T] [--allow-origin URL] [--allow-host 이름] [--no-claude]
 *                                              토큰은 환경 변수 DOCBENCH_TOKEN 으로도(명령줄은 프로세스 목록에 보인다)
 *   docbench init [폴더] [--claude]            작업 폴더 준비 (+ Claude Code 스킬 복사)
 *   docbench status [--json]                   차례별 피드백 수 · Claude 작업(엔진·맡겨 둔 피드백)
 *   docbench fb list [--waiting assistant|owner] [--status open|resolved|declined|all] [--doc ID] [--json]
 *   docbench fb show <id> [--json]             피드백 + 지금 그 섹션 원문·판·인코딩
 *   docbench fb add --doc ID [--section KEY] -m 글 [--severity high|medium|low] [--quote 문구] [--to assistant|owner]
 *   docbench fb reply <id> -m 글 [--resolve | --ask | --decline]
 *   docbench fb propose <id> --file 제안.md [-m 이유]
 *   docbench doc list [--json]
 *   docbench doc sections <docId> [--json]
 *   docbench doc show <docId> [--section KEY] [--json]
 *   docbench doc write <docId> (--file F | --stdin) [--section KEY --base VER] [-m 요약] [--fb id,id] [--rename] [--force] [--convert-utf8]
 *   docbench log <docId> -m 요약 [--fb id,id]   마지막 변경에 요약 덧붙이기 (직접 편집한 뒤)
 *   docbench inbox [--clear] [--json]          "넘기기" 요청함 보기·비우기
 *   docbench runner [폴더] [--detach | --status | --stop] [--startup on|off]
 *                                              Claude 작업 실행기 — 단일 HTML 화면의 "Claude 작업"을 이 PC 에서 띄운다
 *                                              (--detach 창 없이 뒤에서, --startup on 로그인 때 자동으로, Windows)
 *
 * 작업 폴더 찾기: --root 폴더 → 환경 변수 DOCBENCH_ROOT → 현재 폴더에서 위로 .docbench 가 있는 곳.
 * 작성자: --as human:이름 | assistant:이름 (기본 assistant:Claude, 또는 DOCBENCH_ACTOR)
 * 종료 코드: 0 성공 · 1 잘못된 입력 · 2 작업 폴더 없음 · 3 그 사이 바뀜(다시 읽고 고칠 것) · 4 읽기 전용
 * 설정: 문서 폴더 .docbench/config.json(함께 씀) + 이 PC 의 설정(문서 폴더 밖 — 실행 명령 assistant·notify.command 와 이름 user 는
 *       여기에만, 폴더별은 "workspaces": { "<폴더 경로>": {…} }). 위치: Windows %LOCALAPPDATA%\docbench\config.json,
 *       macOS ~/Library/Application Support/docbench, Linux ~/.config/docbench. DOCBENCH_HOME 으로 옮김. status 가 위치를 보여 준다
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Workspace } from '../server/workspace.mjs';
import { decode } from '../server/textio.mjs';
import { core } from '../server/core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** 파일 하나로 묶은 CLI(release/docbench.mjs)인가 — 서버 화면·스킬 원본이 없다 */
const BUNDLED = !!(/** @type {any} */ (globalThis).__DOCBENCH_BUNDLE__);
const SELF = fileURLToPath(import.meta.url);

const HELP = `docbench CLI — 사람과 터미널의 Claude Code 가 같은 작업 폴더를 다룬다.
서버가 꺼져 있어도 파일만으로 동작하고, 서버가 켜져 있으면 화면이 실시간으로 따라온다.

  docbench serve [폴더] [--port 4317] [--host 127.0.0.1] [--token T] [--allow-origin URL] [--allow-host 이름] [--no-claude]
                                             토큰은 환경 변수 DOCBENCH_TOKEN 으로도(명령줄은 프로세스 목록에 보인다)
  docbench init [폴더] [--claude]            작업 폴더 준비 (+ Claude Code 스킬 복사)
  docbench status [--json]                   차례별 피드백 수 · Claude 작업(엔진·맡겨 둔 피드백)
  docbench fb list [--waiting assistant|owner] [--status open|resolved|declined|all] [--doc ID] [--json]
  docbench fb show <id> [--json]             피드백 + 지금 그 섹션 원문·판·인코딩
  docbench fb add --doc ID [--section KEY] -m 글 [--severity high|medium|low] [--quote 문구] [--to assistant|owner]
  docbench fb reply <id> -m 글 [--resolve | --ask | --decline]
  docbench fb propose <id> --file 제안.md [-m 이유]
  docbench doc list [--json]
  docbench doc sections <docId> [--json]
  docbench doc show <docId> [--section KEY] [--json]
  docbench doc write <docId> (--file F | --stdin) [--section KEY --base VER] [-m 요약] [--fb id,id] [--rename] [--force] [--convert-utf8]
  docbench log <docId> -m 요약 [--fb id,id]   마지막 변경에 요약 덧붙이기 (직접 편집한 뒤)
  docbench inbox [--clear] [--json]          "넘기기" 요청함 보기·비우기
  docbench runner [폴더] [--detach | --status | --stop] [--startup on|off]
                                             Claude 작업 실행기 — 단일 HTML 화면의 "Claude 작업"을 이 PC 에서 띄운다
                                             (--detach 창 없이 뒤에서, --startup on 로그인 때 자동으로, Windows)

작업 폴더 찾기: --root 폴더 → 환경 변수 DOCBENCH_ROOT → 현재 폴더에서 위로 .docbench 가 있는 곳.
작성자: --as human:이름 | assistant:이름 (기본 assistant:Claude, 또는 DOCBENCH_ACTOR)
종료 코드: 0 성공 · 1 잘못된 입력 · 2 작업 폴더 없음 · 3 그 사이 바뀜(다시 읽고 고칠 것) · 4 읽기 전용
설정: 문서 폴더 .docbench/config.json(함께 씀) + 이 PC 의 설정(문서 폴더 밖 — 실행 명령 assistant·notify.command 와 이름 user 는
      여기에만, 폴더별은 "workspaces": { "<폴더 경로>": {…} }). 위치: Windows %LOCALAPPDATA%\\docbench\\config.json,
      macOS ~/Library/Application Support/docbench, Linux ~/.config/docbench. DOCBENCH_HOME 으로 옮김. status 가 위치를 보여 준다
판: ${core.DOCBENCH_VERSION}
`;

/** 값을 받지 않는 플래그 — 뒤의 인자를 삼키지 않는다 */
const BOOL = new Set(['json', 'stdin', 'resolve', 'ask', 'decline', 'claude', 'help', 'force', 'rename', 'convert-utf8', 'clear', 'detach', 'stop', 'no-claude']);
/** --status 는 둘로 쓴다: fb list --status <open|resolved|declined|all>, runner --status (값 없음) */
const STATUS_VALUES = new Set(['open', 'resolved', 'declined', 'all']);

function parse(argv) {
  /** @type {{ _: string[], [k: string]: any }} */
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '-m') { a.m = argv[++i]; continue; }
    if (s === '-h') { a.help = true; continue; }
    if (s.startsWith('--')) {
      const eq = s.indexOf('=');
      const k = eq > 0 ? s.slice(2, eq) : s.slice(2);
      if (eq > 0) a[k] = s.slice(eq + 1);
      else if (BOOL.has(k)) a[k] = true;
      else if (k === 'status') a[k] = STATUS_VALUES.has(argv[i + 1]) ? argv[++i] : true;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) a[k] = argv[++i];
      else a[k] = true;
    } else a._.push(s);
  }
  return a;
}

/**
 * 위로 .docbench 를 찾는다. 홈 폴더는 찾아낸 작업 폴더로 치지 않는다 — 홈 아래 아무 데서나 부른 CLI 가
 * 홈 전체(개인 문서)를 작업 폴더로 삼지 않게. 홈을 쓰려면 --root 로 분명히 준다.
 * @param {string} start @returns {string | null}
 */
function findRoot(start) {
  let d = path.resolve(start);
  const home = path.resolve(os.homedir());
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  for (;;) {
    if (!same(d, home) && existsSync(path.join(d, '.docbench'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function actorOf(a) {
  const spec = a.as || process.env.DOCBENCH_ACTOR || 'assistant:Claude';
  const [kind, ...rest] = String(spec).split(':');
  return { kind: kind === 'human' ? 'human' : 'assistant', name: rest.join(':') || (kind === 'human' ? undefined : 'Claude') };
}

const out = (a, data, human) => {
  if (a.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else process.stdout.write((typeof human === 'function' ? human(data) : human ?? JSON.stringify(data, null, 2)) + '\n');
};
/** @returns {never} */
const die = (msg, code = 1) => { process.stderr.write('docbench: ' + msg + '\n'); process.exit(code); };
/** 화면·사람용 인코딩 이름 — 내부 이름 'euc-kr' 은 실제로 CP949(확장 음절 포함)다 @param {string} e */
const encLabel = (e) => (e === 'euc-kr' ? 'cp949(euc-kr)' : e);
const turn = (f) => (f.status === 'open' ? f.waitingOn : f.status);
const where = (f) => (f.target.kind === 'section' ? core.sectionKeyOf(f) : f.target.kind === 'item' ? '[지도] ' + (f.target.label || f.target.itemId) : '(문서 전체)');

/**
 * 입력 글 읽기 — BOM·UTF-16(PowerShell 기본)을 풀고 LF 로. 깨진 글자·NUL 이 있으면 거부(문서에 섞여 들어가지 않게)
 * @param {Buffer} buf
 */
function inputText(buf) {
  const d = decode(buf);
  if (d.encoding === 'euc-kr' || d.readOnlyReason === 'invalid-utf8') die('입력 파일이 UTF-8(또는 UTF-16)이 아닙니다. UTF-8 로 저장해 다시 주세요.');
  if (/\u0000|�/.test(d.text)) die('입력에 깨진 글자(NUL·U+FFFD)가 있습니다.');
  return d.text;
}
async function readInput(a) {
  if (a.stdin) { const chunks = []; for await (const c of process.stdin) chunks.push(c); return inputText(Buffer.concat(chunks)); }
  if (!a.file || a.file === true) die('--file <경로> 또는 --stdin 이 필요합니다');
  return inputText(await fs.readFile(String(a.file)));
}

/**
 * 섹션 교체 안전장치: 제목 줄 유지(바꾸려면 --rename), 하위 섹션이 사라지면 거부(지우려면 --force) — 규칙은 core.checkSectionText
 * (Claude 작업 실행기도 같은 규칙으로 검사한다)
 * @param {string} cur 지금 섹션 글 @param {string} next 새 섹션 글 @param {any} a
 */
function guardSection(cur, next, a) {
  const bad = core.checkSectionText(cur, next, { rename: !!a.rename, allowDrop: !!a.force });
  if (bad) die(bad + (/제목이 바뀝니다/.test(bad) ? ' 의도했다면 --rename.' : /하위 섹션/.test(bad) ? ' 지우려는 것이면 --force.' : ''));
}

async function main() {
  const a = parse(process.argv.slice(2));
  const [cmd, sub, ...rest] = a._;
  if (!cmd || cmd === 'help' || a.help) {
    process.stdout.write(HELP);
    return;
  }

  if (cmd === 'serve') {
    if (BUNDLED) die('파일 하나로 받은 CLI 에는 서버 화면이 없습니다. 서버 화면은 저장소 설치본에서: git clone https://github.com/d-j-lee/docbench && npm install → node bin/docbench.mjs serve <폴더>. 서버 없이 쓰려면 docbench.html + docbench runner.');
    const { startServer } = await import('../server/index.mjs');
    const root = path.resolve(sub || a.root || process.env.DOCBENCH_ROOT || '.');
    const s = await startServer({ root, port: a.port ? Number(a.port) : 4317, host: a.host, token: a.token || process.env.DOCBENCH_TOKEN || undefined, allowOrigins: a['allow-origin'] ? String(a['allow-origin']).split(',') : undefined, allowHosts: a['allow-host'] ? String(a['allow-host']).split(',') : undefined, runs: a['no-claude'] ? false : undefined });
    process.stdout.write(`DocBench: ${s.url}  (작업 폴더 ${root})\n`);
    if (s.ws.git) process.stdout.write('git: 커밋 대비 변경 보기 사용\n');
    if (!a['no-claude']) {
      const eng = await s.handle.runs();
      const av = eng?.availability();
      process.stdout.write(av?.available ? `Claude 작업: Claude Code ${av.runner?.claude.version || ''} — 화면 아래 "Claude 작업" 창에서 (끄려면 --no-claude)\n` : `Claude 작업: 쓸 수 없음 — ${av?.message || '엔진을 시작하지 못했습니다'}\n`);
    }
    process.stdout.write(`이 PC 의 설정: ${s.ws.pcConfigFile}${existsSync(s.ws.pcConfigFile) ? '' : ' (없음)'}\n`);
    for (const w of s.ws.config.warnings || []) process.stderr.write('주의: ' + w + '\n');
    const stop = () => { void s.close().then(() => process.exit(0)); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }

  if (cmd === 'init') {
    const root = path.resolve(sub || a.root || '.');
    const ws = await new Workspace(root).init();
    const cfg = path.join(ws.dir, 'config.json');
    if (!existsSync(cfg)) {
      await fs.writeFile(cfg, JSON.stringify({ title: path.basename(root), groups: [], docs: {}, assistantName: 'Claude', notify: { inbox: true } }, null, 2) + '\n');
    }
    let skill = '';
    if (a.claude && BUNDLED) die('파일 하나로 받은 CLI 에는 스킬 원본이 없습니다. Claude Code 플러그인으로 까세요: claude plugin marketplace add d-j-lee/docbench → claude plugin install docbench@docbench');
    if (a.claude) {
      const src = path.resolve(here, '../integrations/claude-code/skills/docbench-feedback');
      const dst = path.join(root, '.claude', 'skills', 'docbench-feedback');
      await fs.mkdir(dst, { recursive: true });
      for (const f of await fs.readdir(src)) await fs.copyFile(path.join(src, f), path.join(dst, f));
      skill = `\nClaude Code 스킬: ${path.relative(root, dst)} (터미널에서 /docbench-feedback)`;
    }
    out(a, { root, docs: ws.docs.size }, `작업 폴더 준비: ${root}\n문서 ${ws.docs.size}개 · 설정 ${path.relative(root, cfg)}${skill}`);
    return;
  }

  if (cmd === 'runner') return runnerCmd(a, sub);

  const root = a.root ? path.resolve(String(a.root)) : process.env.DOCBENCH_ROOT ? path.resolve(process.env.DOCBENCH_ROOT) : findRoot(process.cwd());
  if (!root || !existsSync(path.join(root, '.docbench'))) die(`작업 폴더(.docbench)를 찾지 못했습니다${root ? ': ' + root : ''}. --root <폴더> 또는 DOCBENCH_ROOT 를 주거나, 먼저 docbench init <폴더>.`, 2);
  const ws = await new Workspace(root, { actor: actorOf(a) }).init();

  if (cmd === 'status') {
    const rows = await ws.listFeedback();
    const by = {};
    for (const f of rows) { const t = turn(f); (by[f.docId || '(지도)'] ||= { owner: 0, assistant: 0, resolved: 0, declined: 0 })[t]++; }
    const c = core.countTurns(rows);
    const inbox = (await fs.readdir(path.join(ws.dir, 'inbox')).catch(() => [])).filter((n) => n.endsWith('.json')).length;
    const warnings = ws.config.warnings || [];
    const { listRunners } = await import('../server/runs.mjs');
    const runners = core.liveRunners(await listRunners(root)).map((r) => ({ id: r.id, kind: r.kind, pid: r.pid, claude: r.claude, busy: r.busy || null }));
    // 맡겨 둔(대기·실행 중) Claude 작업 — 터미널에서 같은 피드백을 동시에 잡지 않게. 맡을 엔진이 꺼져 있으면 셈하지 않는다
    const runsDir = path.join(ws.dir, 'runs');
    const active = [];
    for (const n of (await fs.readdir(runsDir).catch(() => [])).filter((x) => x.endsWith('.req.json')).sort()) {
      const id = n.slice(0, -'.req.json'.length);
      if (!core.validRunId(id)) continue;
      const read = (f) => fs.readFile(path.join(runsDir, f), 'utf8').then(JSON.parse).catch(() => null);
      const st = await read(core.runFiles(id).status);
      const state = st?.state || 'queued';
      if (state !== 'queued' && state !== 'running') continue;
      const req = st || (await read(n));
      if (!req || !runners.some((r) => r.id === req.runner)) continue;
      active.push({ id, state, feedbackIds: Array.isArray(req.feedbackIds) ? req.feedbackIds : [] });
    }
    out(a, { root, docs: ws.docs.size, feedback: c, byDoc: by, inbox, runners, activeRuns: active, warnings, pcConfigFile: ws.pcConfigFile }, () =>
      (`작업 폴더 ${root} · 문서 ${ws.docs.size}개${inbox ? ` · 넘기기 요청 ${inbox}건` : ''}\nAI 차례 ${c.assistant} · 사람 차례 ${c.owner} · 반영됨 ${c.resolved} · 보류 ${c.declined}\n` +
      `Claude 작업: ${runners.length ? runners.map((r) => `${r.kind === 'server' ? '서버' : '실행기'} ${r.id.split(':')[1]}${r.claude?.ok ? '' : ' (쓸 수 없음)'}${r.busy ? ' — 작업 중' : ''}`).join(', ') : '켜진 실행기·서버 없음'}\n` +
      active.map((r) => `  ${r.state === 'running' ? '실행 중' : '대기'} ${r.id}: 피드백 ${r.feedbackIds.join(', ')}\n`).join('') +
      `이 PC 의 설정: ${ws.pcConfigFile}${existsSync(ws.pcConfigFile) ? '' : ' (없음)'}\n` +
      warnings.map((w) => '주의: ' + w + '\n').join('') +
      Object.entries(by).filter(([, v]) => v.assistant || v.owner).map(([d, v]) => `  ${d}: AI ${v.assistant} · 사람 ${v.owner}`).join('\n')).trimEnd());
    return;
  }

  if (cmd === 'inbox') {
    const dir = path.join(ws.dir, 'inbox');
    const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json')).sort();
    const reqs = [];
    for (const n of names) { try { reqs.push({ file: n, ...JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')) }); } catch { /* 깨진 요청 */ } }
    if (a.clear) for (const n of names) { await fs.rm(path.join(dir, n), { force: true }); await fs.rm(path.join(dir, n + '.log'), { force: true }); }
    out(a, reqs, (r) => (r.length ? r.map((x) => `${x.file}  ${x.at}  ${x.count ?? '?'}건  ${(x.docs || []).join(', ')}`).join('\n') : '요청 없음') + (a.clear && r.length ? `\n(${r.length}건 비움)` : ''));
    return;
  }

  if (cmd === 'fb') {
    const conflict = (e) => { if (e && e.code === 'CONFLICT') die('그 사이 피드백이 바뀌었습니다. fb show 로 다시 읽고 하세요.', 3); throw e; };
    if (sub === 'list') {
      let rows = await ws.listFeedback();
      const status = a.status || 'open';
      if (status !== 'all') rows = rows.filter((f) => f.status === status);
      if (a.waiting) rows = rows.filter((f) => f.status === 'open' && f.waitingOn === a.waiting);
      if (a.doc) rows = rows.filter((f) => f.docId === ws.canonId(String(a.doc)));
      rows = core.sortFeedback(rows, [...ws.docs.keys()]);
      out(a, rows, (r) => r.length ? r.map((f) => `${f.id}  [${turn(f)}]${f.severity ? ' ' + f.severity : ''}  ${f.docId} › ${where(f)}\n    ${(f.title ? f.title + ' — ' : '') + f.body.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n') : '해당 피드백 없음');
      return;
    }
    if (sub === 'show') {
      const f = await ws.getFeedback(rest[0] || die('id 가 필요합니다'));
      let doc = null, section = null, located = null;
      if (f.docId) {
        doc = await ws.readDoc(f.docId);
        if (f.target.kind === 'section') {
          const s = core.findSection(doc.md, core.sectionKeyOf(f));
          if (s) {
            section = doc.md.slice(s.start, s.end);
            const line = doc.md.slice(0, s.start).split('\n').length;
            located = { key: s.key, startLine: line, endLine: line + section.replace(/\n+$/, '').split('\n').length - 1 };
          }
        }
      }
      const data = { feedback: f, doc: doc && { id: doc.id, path: path.join(root, doc.id), version: doc.version, encoding: doc.encoding, eol: doc.eol, bom: doc.bom, readOnly: doc.readOnly, readOnlyReason: doc.readOnlyReason }, section: located, sectionText: section };
      out(a, data, () => [
        `${f.id} [${turn(f)}] ${f.docId} › ${where(f)}`,
        f.title ? '제목: ' + f.title : '', '내용: ' + f.body,
        f.selector?.exact ? '인용: "' + f.selector.exact + '"' : '',
        ...f.thread.map((m) => `  - ${m.author.kind === 'assistant' ? (m.author.name || 'AI') : (m.author.name || '사람')}: ${m.text}`),
        doc ? `문서: ${path.join(root, doc.id)} (${encLabel(doc.encoding)}${doc.bom ? '+BOM' : ''}, ${doc.eol.toUpperCase()}, 판 ${doc.version}${doc.readOnly ? ', 읽기 전용: ' + doc.readOnlyReason : ''})` : '',
        located ? `섹션: ${located.key} (줄 ${located.startLine}-${located.endLine})\n고칠 때: docbench doc write ${doc.id} --section "${located.key}" --base ${doc.version} --file <새 섹션.md> --fb ${f.id}\n----\n${section}----` : f.target.kind === 'section' ? '섹션을 찾지 못했습니다 (제목이 바뀌었을 수 있음 — docbench doc sections 로 확인)' : '',
      ].filter(Boolean).join('\n'));
      return;
    }
    if (sub === 'add') {
      if (!a.doc || !a.m) die('--doc 와 -m 이 필요합니다');
      const docId = ws.canonId(String(a.doc));
      const target = a.section ? { kind: 'section', heading: core.keyToPath(String(a.section)).pop(), ...core.parseKey(String(a.section)) } : { kind: 'doc' };
      if (a.section) {
        const d = await ws.readDoc(docId);
        if (!core.findSection(d.md, String(a.section))) die('그 섹션이 없습니다: ' + a.section + ' (docbench doc sections ' + docId + ')');
      }
      const f = await ws.createFeedback({ docId, target, body: a.m, title: a.title, severity: a.severity, kind: a.kind, waitingOn: a.to === 'assistant' || a.to === 'owner' ? a.to : undefined, selector: a.quote ? { exact: String(a.quote) } : undefined });
      out(a, f, `만듦: ${f.id} (${turn(f)})`);
      return;
    }
    if (sub === 'reply') {
      const f = await ws.getFeedback(rest[0] || die('id 가 필요합니다'));
      if (!a.m) die('-m 회신 글이 필요합니다');
      const msg = { author: ws.actor, text: String(a.m), at: new Date().toISOString() };
      const patch = { thread: [...f.thread, msg] };
      if (a.resolve) Object.assign(patch, { status: 'resolved' });
      else if (a.decline) Object.assign(patch, { status: 'declined' });
      else if (a.ask) Object.assign(patch, { status: 'open', waitingOn: 'owner' });
      const g = await ws.updateFeedback(f.id, patch, f.version).catch(conflict);
      out(a, g, `회신: ${g.id} → ${turn(g)}`);
      return;
    }
    if (sub === 'propose') {
      const f = await ws.getFeedback(rest[0] || die('id 가 필요합니다'));
      const t = f.target;
      if (t.kind !== 'section') die('섹션 피드백에만 제안할 수 있습니다');
      const after = await readInput(a);
      const doc = await ws.readDoc(f.docId);
      const key = core.sectionKeyOf(f);
      const before = core.getSectionText(doc.md, key);
      if (before == null) die('섹션을 찾지 못했습니다');
      guardSection(before, after, a);
      const now = new Date().toISOString();
      const g = await ws.updateFeedback(f.id, {
        waitingOn: 'owner',
        proposal: { path: key.split(core.KEY_SEP), before, after, rationale: a.m, author: ws.actor, at: now, state: 'pending' },
        thread: [...f.thread, { author: ws.actor, text: a.m || '수정 제안을 올렸습니다', at: now }],
      }, f.version).catch(conflict);
      out(a, g, `제안 올림: ${g.id} → 사람 차례 (화면에서 차이를 보고 적용)`);
      return;
    }
    die('알 수 없는 fb 명령: ' + sub);
  }

  if (cmd === 'doc') {
    if (sub === 'list') {
      const m = await ws.manifest();
      out(a, Object.entries(m.docs).map(([id, d]) => ({ id, title: d.title, size: d.source?.size })), (r) => r.map((d) => `${d.id}  ${d.title}`).join('\n'));
      return;
    }
    if (sub === 'sections') {
      const d = await ws.readDoc(rest[0] || die('문서 id 가 필요합니다'));
      const secs = core.sectionSources(d.md).map((s) => ({ key: s.key, level: s.level, line: d.md.slice(0, s.start).split('\n').length }));
      out(a, secs, (r) => r.map((s) => `${String(s.line).padStart(5)}  ${'  '.repeat(s.level - 1)}${s.key.split(core.KEY_SEP).pop()}   ⟨${s.key}⟩`).join('\n'));
      return;
    }
    if (sub === 'show') {
      const d = await ws.readDoc(rest[0] || die('문서 id 가 필요합니다'));
      const text = a.section ? core.getSectionText(d.md, String(a.section)) : d.md;
      if (text == null) die('섹션을 찾지 못했습니다: ' + a.section);
      out(a, { id: d.id, version: d.version, encoding: d.encoding, eol: d.eol, section: a.section || null, text }, () => text);
      return;
    }
    if (sub === 'write') {
      const id = rest[0] || die('문서 id 가 필요합니다');
      const input = await readInput(a);
      const d = await ws.readDoc(id);
      let next = input;
      if (a.section) {
        // 섹션 쓰기는 판을 꼭 받는다 — 읽은 뒤 사람이 그 섹션을 고쳤으면 덮지 않게
        if (!a.base && !a.force) die('--section 쓰기에는 --base <판> 이 필요합니다 (fb show / doc show --json 의 version)');
        const cur = core.getSectionText(d.md, String(a.section));
        if (cur == null) die('섹션을 찾지 못했습니다: ' + a.section);
        guardSection(cur, input, a);
        next = /** @type {string} */ (core.replaceSection(d.md, String(a.section), input));
      }
      const fbIds = a.fb ? String(a.fb).split(',').filter(Boolean) : undefined;
      try {
        const r = await ws.writeDoc(d.id, next, { baseVersion: a.base ? String(a.base) : d.version, summary: a.m, feedbackIds: fbIds, convertTo: a['convert-utf8'] ? 'utf-8' : undefined, by: ws.actor });
        out(a, r, r.unchanged ? '바뀐 것 없음' : `저장: ${d.id} 판 ${r.version}${d.encoding !== 'utf-8' && !a['convert-utf8'] ? ` (${encLabel(d.encoding)} 유지)` : ''}`);
      } catch (e) {
        if (e.code === 'CONFLICT') die(`그 사이 문서가 바뀌었습니다 (지금 판 ${e.current.version}). 다시 읽고 고치세요.`, 3);
        if (e.code === 'BUSY') die(e.message, 3);
        if (e.code === 'READ_ONLY') die(e.message + (e.reason === 'config' ? '' : ' (사람 확인 후 --convert-utf8 로 UTF-8 변환 저장 가능)'), 4);
        throw e;
      }
      return;
    }
    die('알 수 없는 doc 명령: ' + sub);
  }

  if (cmd === 'log') {
    const id = ws.canonId(sub || die('문서 id 가 필요합니다'));
    await ws.reconcile(id);
    const d = await ws.readDoc(id);
    await ws.appendChange({ type: 'note', at: new Date().toISOString(), docId: id, toVersion: d.version, by: ws.actor, summary: a.m, feedbackIds: a.fb ? String(a.fb).split(',') : undefined });
    out(a, { ok: true, version: d.version }, `기록: ${id} 판 ${d.version}`);
    return;
  }

  die('알 수 없는 명령: ' + cmd + ' (docbench help)');
}

// ---------------------------------------------------------------- 실행기 (docbench runner)

/** 이 PC 의 설정 폴더 (실행기 기록·자동 시작 목록) */
function pcDir() {
  if (process.env.DOCBENCH_HOME) return process.env.DOCBENCH_HOME;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'docbench');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'docbench');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'docbench');
}
const short = (s) => crypto.createHash('sha1').update(process.platform === 'win32' ? s.toLowerCase() : s).digest('hex').slice(0, 8);

/** 실행기 로그 한 줄 → 사람 말 */
function fmtRunLog(l) {
  const v = l.v || {};
  const t = (l.at || '').slice(11, 19);
  const m = {
    start: () => `시작 · ${v.kind === 'propose' ? '제안' : '넘기기'} ${v.n}건${v.model ? ' · ' + v.model : ''}${v.effort ? ' · ' + v.effort : ''}${v.mode === 'propose' ? ' · 제안만' : ''}`,
    claude: () => `Claude Code ${v.version || ''} · ${v.model || ''}`,
    safe: () => `안전 실행 · 문서 폴더 밖 · 읽기 도구만(${v.tools})`,
    text: () => (l.text || '').replace(/\s+/g, ' ').slice(0, 200),
    read: () => `읽음 ${v.path}`, search: () => `찾음 "${v.pattern}"`, list: () => `목록 ${v.pattern}`,
    denied: () => `거부됨 ${v.tool || ''} (${v.reason || ''})`, output: () => '결과 정리', tool: () => `도구 ${v.name}`,
    'apply.edit': () => `고침 ${v.doc} › ${v.section}`, 'apply.propose': () => `제안 ${v.doc} › ${v.section}`,
    'apply.answer': () => `답함 ${v.fb}`, 'apply.ask': () => `질문 ${v.fb}`, 'apply.decline': () => `보류 ${v.fb}`,
    skip: () => `건너뜀 ${v.fb} (${v.reason})`, applyFail: () => `반영 실패 ${v.fb}: ${v.message}`,
    summary: () => '요약: ' + (l.text || ''), done: () => `끝 (${Math.round(Number(v.ms || 0) / 100) / 10}초)`,
    error: () => '오류: ' + v.message, canceled: () => '취소됨', timeout: () => `시간 초과 (${v.sec}초)`, warn: () => '주의: ' + v.message,
  }[l.k];
  return `${t} ${m ? m() : l.k}`;
}

async function runnerCmd(a, sub) {
  const rootArg = sub || a.root || process.env.DOCBENCH_ROOT;
  const root = rootArg ? path.resolve(String(rootArg)) : findRoot(process.cwd());
  if (a.startup === 'entry') return startupEntry(String(a.id || ''));
  if (!root || !existsSync(path.join(root, '.docbench'))) die(`작업 폴더(.docbench)를 찾지 못했습니다${root ? ': ' + root : ''}. 브라우저의 DocBench 로 그 폴더를 한 번 열거나 docbench init <폴더>.`, 2);
  const { listRunners, engineId, localEngine, localEngineFile, pidAlive } = await import('../server/runs.mjs');
  // 엔진과 같은 규칙의 내 id (이 PC 의 설정 user 가 있으면 그것)
  const ws0 = await new Workspace(root, { actor: { kind: 'assistant', name: 'Claude' } }).init();
  const me = engineId(ws0, 'runner');
  /** 문서 폴더의 심장 박동 중 내 id 인 것 (보여 주기·기다리기용 — 프로세스를 끝낼 때는 이 PC 의 기록만 믿는다) */
  const mine = async () => (await listRunners(root)).filter((r) => core.runnerAlive(r) && r.id === me);

  if (a.status) {
    const all = core.liveRunners(await listRunners(root));
    out(a, all, (rs) => rs.length ? rs.map((r) => `${r.id}  pid ${r.pid}  Claude Code ${r.claude?.version || '?'}${r.claude?.ok ? '' : ' (쓸 수 없음: ' + (r.claude?.problem || '') + ')'}${r.busy ? '  작업 중 ' + r.busy : ''}`).join('\n') : '켜진 실행기 없음');
    if (!all.length) process.exitCode = 1;
    return;
  }
  if (a.stop) {
    const rec = await localEngine(ws0, root, 'runner');
    const beat = (await mine())[0];
    if (!rec && !beat) { out(a, { stopped: 0 }, '이 PC 에서 켜진 실행기가 없습니다'); return; }
    const runnersDir = path.join(root, '.docbench', 'runners');
    const stopFile = path.join(runnersDir, core.runnerFileName(me).replace(/\.json$/, '.stop'));
    // 먼저 끄기 요청 파일로 (돌던 claude 까지 정리하고 끈다)
    await fs.writeFile(stopFile, new Date().toISOString());
    const gone = async () => !(await localEngine(ws0, root, 'runner')) && !(await mine()).length;
    let end = Date.now() + core.RUNNER_BEAT_MS * 2 + 2000;
    while (Date.now() < end && !(await gone())) await new Promise((r) => setTimeout(r, 300));
    // 안 꺼졌으면 프로세스를 끝낸다 — 이 PC 가 적어 둔 pid 만 (문서 폴더의 심장 박동에 적힌 pid 는 남이 꾸밀 수 있어 쓰지 않는다)
    if (!(await gone()) && rec && pidAlive(rec.pid)) {
      try { process.kill(rec.pid); } catch { /* 이미 끝남 */ }
      end = Date.now() + 5000;
      while (Date.now() < end && pidAlive(rec.pid) && !(await gone())) await new Promise((r) => setTimeout(r, 300));
    }
    // 실행기가 스스로 기록을 지웠거나(정상 종료) 프로세스가 없으면 꺼진 것 — 끝난 프로세스가 좀비로 남는 환경도 있다
    const ok = (await gone()) || !(rec && pidAlive(rec.pid));
    // 남은 표시 정리: 끄기 요청(남아 있으면 다음 실행기가 켜자마자 꺼진다)·내 심장 박동·이 PC 의 기록
    await fs.rm(stopFile, { force: true }).catch(() => undefined);
    if (ok) {
      await fs.rm(path.join(runnersDir, core.runnerFileName(me)), { force: true }).catch(() => undefined);
      await fs.rm(localEngineFile(ws0, root, 'runner'), { force: true }).catch(() => undefined);
    }
    if (!ok) die(`실행기(pid ${rec?.pid})를 끄지 못했습니다. 작업 관리자에서 끄세요.`, 1);
    out(a, { stopped: 1 }, '실행기를 껐습니다');
    return;
  }
  if (a.startup === 'on' || a.startup === 'off') return startupSet(root, a.startup === 'on', a);
  if (a.detach) {
    const already = await localEngine(ws0, root, 'runner');
    if (already) { out(a, { ...((await mine())[0] || {}), pid: already.pid }, `이미 켜져 있습니다 (pid ${already.pid})`); return; }
    const logFile = path.join(pcDir(), 'logs', `runner-${short(root)}.log`);
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    const fh = await fs.open(logFile, 'a');
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [SELF, 'runner', root], { detached: true, stdio: ['ignore', fh.fd, fh.fd], windowsHide: true, cwd: pcDir() });
    child.unref();
    await fh.close();
    const end = Date.now() + 15000;
    let up = null;
    while (Date.now() < end && !up) { await new Promise((r) => setTimeout(r, 300)); up = (await mine()).find((r) => r.pid === child.pid); if (child.exitCode !== null) break; }
    if (!up) die(`실행기가 켜지지 않았습니다. 로그: ${logFile}`, 1);
    out(a, up, `실행기를 켰습니다 (pid ${up.pid}) · ${root}\nClaude Code ${up.claude?.version || '?'}${up.claude?.ok ? '' : ' — 쓸 수 없음: ' + up.claude?.problem}\n로그: ${logFile}\n끄기: docbench runner --stop "${root}"`);
    return;
  }

  // 앞에서 돌기 — 창을 닫거나 Ctrl+C 로 끈다
  const { RunEngine } = await import('../server/runs.mjs');
  const ws = ws0;
  /** @type {any} */
  let eng = null;
  const stop = () => { void (eng ? eng.stop() : Promise.resolve()).then(() => process.exit(0)); };
  eng = new RunEngine(ws, { kind: 'runner', onStopRequest: stop, log: (l, id) => process.stdout.write(`[${id.slice(4, 19)}] ${fmtRunLog(l)}\n`) });
  try { await eng.start(); } catch (e) { die(e.message, e.code === 'RUNNING' ? 3 : 1); }
  const av = eng.availability();
  process.stdout.write(`DocBench 실행기 ${core.DOCBENCH_VERSION} · ${root}\n${av.available ? `Claude Code ${av.runner?.claude.version} — 화면의 "Claude 작업" 요청을 기다립니다 (끄기: Ctrl+C)` : '쓸 수 없음: ' + av.message}\n`);
  for (const w of ws.config.warnings || []) process.stderr.write('주의: ' + w + '\n');
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
  await new Promise(() => undefined);
}

/**
 * 로그인 때 자동으로 켜기 (Windows 시작프로그램 폴더의 .cmd). 경로는 .cmd 에 적지 않고 이 PC 의 설정 폴더 JSON 에 둔다 —
 * cmd.exe 는 .cmd 파일을 ANSI 코드 페이지로 읽어 한글 경로가 깨지므로, .cmd 에는 ASCII 와 %LOCALAPPDATA% 만 쓴다.
 */
async function startupSet(root, on, a) {
  if (process.platform !== 'win32') die('--startup 은 Windows 에서만 됩니다. macOS·Linux 는 로그인 항목·systemd 에 docbench runner --detach 를 등록하세요.');
  const listFile = path.join(pcDir(), 'runner-startup.json');
  const list = JSON.parse(await fs.readFile(listFile, 'utf8').catch(() => '{}') || '{}');
  const key = short(root);
  const startupDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const cmdFile = path.join(startupDir, `DocBench-runner-${key}.cmd`);
  if (!on) {
    delete list[key];
    await fs.writeFile(listFile, JSON.stringify(list, null, 2) + '\n');
    await fs.rm(cmdFile, { force: true });
    out(a, { startup: false }, `로그인 때 켜지 않습니다 (${root})`);
    return;
  }
  const ascii = (p) => /^[\x20-\x7e]+$/.test(p);
  const lad = process.env.LOCALAPPDATA || '';
  // .cmd 안의 % 는 변수로 읽힌다 — 경로의 % 는 %% 로
  const pct = (p) => p.replace(/%/g, '%%');
  const script = lad && SELF.toLowerCase().startsWith(lad.toLowerCase() + path.sep) ? '%LOCALAPPDATA%' + pct(SELF.slice(lad.length)) : pct(SELF);
  if (!ascii(script)) die(`실행기 파일 경로에 영문이 아닌 글자가 있어 시작프로그램에 넣을 수 없습니다: ${SELF}\n%LOCALAPPDATA%\\docbench\\docbench.mjs 에 두고 다시 하세요.`);
  const node = ascii(process.execPath) ? pct(process.execPath) : 'node';
  list[key] = root;
  await fs.mkdir(pcDir(), { recursive: true });
  await fs.writeFile(listFile, JSON.stringify(list, null, 2) + '\n');
  await fs.mkdir(startupDir, { recursive: true });
  await fs.writeFile(cmdFile, `@echo off\r\nrem DocBench 실행기 - 문서 폴더는 %LOCALAPPDATA%\\docbench\\runner-startup.json 의 ${key}\r\n"${node}" "${script}" runner --startup entry --id ${key}\r\n`.replace(/[^\x00-\x7e]/g, ''));
  out(a, { startup: true, file: cmdFile }, `로그인 때 자동으로 켭니다: ${cmdFile}\n끄기: docbench runner "${root}" --startup off`);
}

/** 시작프로그램의 .cmd 가 부르는 자리: 목록에서 폴더를 찾아 뒤에서 켠다 */
async function startupEntry(key) {
  const list = JSON.parse(await fs.readFile(path.join(pcDir(), 'runner-startup.json'), 'utf8').catch(() => '{}') || '{}');
  const root = list[key];
  if (!root) die('자동 시작 목록에 없는 폴더입니다: ' + key);
  process.argv = [process.argv[0], SELF, 'runner', root, '--detach'];
  return runnerCmd(parse(['runner', root, '--detach']), root);
}

main().catch((e) => die(e?.message || String(e), e?.code === 'BAD_REQUEST' || e?.code === 'NOT_FOUND' ? 1 : 1));
