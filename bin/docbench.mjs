#!/usr/bin/env node
// @ts-check
/**
 * docbench CLI — 사람과 터미널의 Claude Code 가 같은 작업 폴더를 다룬다.
 * 서버가 꺼져 있어도 파일만으로 동작하고, 서버가 켜져 있으면 화면이 실시간으로 따라온다.
 *
 *   docbench serve [폴더] [--port 4317] [--host 127.0.0.1] [--token T] [--allow-origin URL] [--allow-host 이름]
 *                                              토큰은 환경 변수 DOCBENCH_TOKEN 으로도(명령줄은 프로세스 목록에 보인다)
 *   docbench init [폴더] [--claude]            작업 폴더 준비 (+ Claude Code 스킬 복사)
 *   docbench status [--json]                   차례별 피드백 수
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
import { Workspace } from '../server/workspace.mjs';
import { decode } from '../server/textio.mjs';
import { core } from '../server/core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 값을 받지 않는 플래그 — 뒤의 인자를 삼키지 않는다 */
const BOOL = new Set(['json', 'stdin', 'resolve', 'ask', 'decline', 'claude', 'help', 'force', 'rename', 'convert-utf8', 'clear']);

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
 * 섹션 교체 안전장치: 제목 줄 유지(바꾸려면 --rename), 하위 섹션이 사라지면 거부(지우려면 --force)
 * @param {string} cur 지금 섹션 글 @param {string} next 새 섹션 글 @param {any} a
 */
function guardSection(cur, next, a) {
  const head = (t) => t.split('\n')[0].trim();
  const lvl = (h) => (/^(#{1,6})\s/.exec(h) || [])[1]?.length || 0;
  const hc = head(cur), hn = head(next);
  if (!lvl(hn)) die(`새 글의 첫 줄이 제목이 아닙니다. 섹션은 제목 줄부터 줍니다:\n  ${hc}`);
  if (lvl(hn) !== lvl(hc)) die(`제목 단계가 바뀝니다 (${'#'.repeat(lvl(hc))} → ${'#'.repeat(lvl(hn))}). 문서 구조가 바뀌므로 문서 전체 쓰기로 하세요.`);
  if (core.headingPlain(hn.replace(/^#{1,6}\s+/, '')) !== core.headingPlain(hc.replace(/^#{1,6}\s+/, '')) && !a.rename) {
    die(`제목이 바뀝니다 ("${hc}" → "${hn}"). 그 섹션에 달린 피드백이 떨어질 수 있습니다. 의도했다면 --rename.`);
  }
  const subs = (t) => core.sectionSources(t).slice(1).map((s) => s.key.split(core.KEY_SEP).slice(1).join(core.KEY_SEP));
  const lost = subs(cur).filter((k) => !subs(next).includes(k));
  if (lost.length && !a.force && !a.rename) die(`하위 섹션이 사라집니다: ${lost.join(', ')}. 지우려는 것이면 --force.`);
}

async function main() {
  const a = parse(process.argv.slice(2));
  const [cmd, sub, ...rest] = a._;
  if (!cmd || cmd === 'help' || a.help) {
    // 파일 머리 주석만 (아래 함수 설명 주석은 빼고)
    const src = (await fs.readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n');
    const end = src.findIndex((l) => l.trim() === '*/');
    process.stdout.write(src.slice(0, end).filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n') + '\n');
    return;
  }

  if (cmd === 'serve') {
    const { startServer } = await import('../server/index.mjs');
    const root = path.resolve(sub || a.root || process.env.DOCBENCH_ROOT || '.');
    const s = await startServer({ root, port: a.port ? Number(a.port) : 4317, host: a.host, token: a.token || process.env.DOCBENCH_TOKEN || undefined, allowOrigins: a['allow-origin'] ? String(a['allow-origin']).split(',') : undefined, allowHosts: a['allow-host'] ? String(a['allow-host']).split(',') : undefined });
    process.stdout.write(`DocBench: ${s.url}  (작업 폴더 ${root})\n`);
    if (s.ws.git) process.stdout.write('git: 커밋 대비 변경 보기 사용\n');
    if (s.ws.config.assistant) { const c = s.ws.config.assistant.command; process.stdout.write(`AI 제안: ${Array.isArray(c) ? c.join(' ') : c || 'claude'} -p (헤드리스)\n`); }
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
    out(a, { root, docs: ws.docs.size, feedback: c, byDoc: by, inbox, warnings, pcConfigFile: ws.pcConfigFile }, () =>
      (`작업 폴더 ${root} · 문서 ${ws.docs.size}개${inbox ? ` · 넘기기 요청 ${inbox}건` : ''}\nAI 차례 ${c.assistant} · 사람 차례 ${c.owner} · 반영됨 ${c.resolved} · 보류 ${c.declined}\n` +
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

main().catch((e) => die(e?.message || String(e), e?.code === 'BAD_REQUEST' || e?.code === 'NOT_FOUND' ? 1 : 1));
