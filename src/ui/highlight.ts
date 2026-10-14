/**
 * 글자 색 입히기 — 코드·설정·데이터 파일을 읽기 좋게(D87). 의존성 없이 작은 토큰 읽개로, 줄마다 HTML 을 낸다.
 *
 * 글자는 하나도 바꾸지 않는다(태그만 씌운다) — 화면 글자(textContent)가 원문과 같아야 문구 인용·찾기가 원문에 맞는다.
 * 여러 줄에 걸친 주석·글(/* *\/ · """ · <!-- -->)은 줄을 넘어 이어 칠한다. 아주 큰 글은 칠하지 않는다(그대로 보인다).
 */

type Tok = 'c' | 's' | 'n' | 'k' | 'p' | 't' | 'a' | 'v' | 'h' | 'd' | 'i';
/** 언어별 규칙: 줄 주석, 블록 주석, 글 따옴표, 낱말, 대소문자 무시 */
interface Lang { line?: string[]; block?: [string, string][]; quotes: string[]; words?: Set<string>; ci?: boolean; hashVar?: boolean }

const W = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
const C_WORDS = W(`if else for while do switch case default break continue return function class interface extends implements new delete typeof instanceof in of
 var let const import export from as async await yield try catch finally throw this super null undefined true false void static public private protected
 readonly abstract enum type namespace module declare package func go defer chan map struct range select fn impl trait pub mut use crate self Self
 match loop where int long short byte char float double boolean bool string String val def lateinit override open data object companion
 using virtual sealed partial get set lock unsafe fixed nil`);
const PY_WORDS = W('def class if elif else for while try except finally with as import from return yield lambda pass break continue raise global nonlocal assert del in is not and or None True False async await self match case');
const RB_WORDS = W('def class module if elsif else unless case when while until for begin rescue ensure end do return yield self nil true false and or not require include then');
const SH_WORDS = W('if then else elif fi for while until do done case esac in function return local export source exit echo set unset readonly shift trap cd test true false');
const PS_WORDS = W('function param begin process end if elseif else foreach for while do switch return try catch finally throw break continue exit');
const SQL_WORDS = W(`select from where and or not insert into values update set delete create table view index drop alter add column primary key foreign references
 join left right inner outer full on group by order having limit offset as distinct union all case when then else end null is in exists between like
 count sum avg min max with returning default constraint unique check begin commit rollback transaction grant revoke`);
const LUA_WORDS = W('and break do else elseif end false for function goto if in local nil not or repeat return then true until while');
const CSS_WORDS = W('important media import keyframes font-face supports');
const MAKE_WORDS = W('ifeq ifneq ifdef ifndef else endif include define endef export override');

const LANGS: Record<string, Lang> = {
  c: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'], words: C_WORDS },
  js: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'], words: C_WORDS },
  css: { block: [['/*', '*/']], quotes: ['"', "'"], words: CSS_WORDS },
  python: { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]], quotes: ['"', "'"], words: PY_WORDS },
  ruby: { line: ['#'], block: [['=begin', '=end']], quotes: ['"', "'"], words: RB_WORDS },
  sh: { line: ['#'], quotes: ['"', "'"], words: SH_WORDS, hashVar: true },
  ps: { line: ['#'], block: [['<#', '#>']], quotes: ['"', "'"], words: PS_WORDS, ci: true },
  bat: { line: ['REM ', 'rem ', '::'], quotes: ['"'], words: W('echo set if else goto call exit for in do not exist defined errorlevel'), ci: true },
  hash: { line: ['#', '//'], quotes: ['"', "'"], words: W('true false null nil if else for in return def fn let') },
  make: { line: ['#'], quotes: ['"', "'"], words: MAKE_WORDS, hashVar: true },
  sql: { line: ['--'], block: [['/*', '*/']], quotes: ["'", '"'], words: SQL_WORDS, ci: true },
  lua: { line: ['--'], quotes: ['"', "'"], words: LUA_WORDS },
  json: { line: ['//'], block: [['/*', '*/']], quotes: ['"'], words: W('true false null') },
  yaml: { line: ['#'], quotes: ['"', "'"], words: W('true false null yes no on off ~') },
  toml: { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]], quotes: ['"', "'"], words: W('true false') },
  ini: { line: [';', '#'], quotes: ['"'], words: W('true false yes no on off') },
  mermaid: { line: ['%%'], quotes: ['"'], words: W('graph flowchart sequenceDiagram classDiagram stateDiagram erDiagram gantt pie journey participant actor loop alt else opt end note subgraph direction TD TB LR RL BT') },
  plantuml: { line: ["'"], quotes: ['"'], words: W('@startuml @enduml actor participant usecase class interface package node component database if else endif while endwhile note end as') },
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const span = (t: Tok, s: string) => `<span class="tk-${t}">${esc(s)}</span>`;

/** 칠하지 않는 크기 — 이보다 크면 글 그대로 */
export const HIGHLIGHT_MAX = 400_000;
/** 이보다 긴 줄(한 줄짜리 데이터·압축한 코드)은 그 줄만 칠하지 않는다 — 긴 줄에서 토큰 읽기가 느려지지 않게 */
export const HIGHLIGHT_LINE_MAX = 2000;

/**
 * 글 → 줄마다 HTML (태그만 씌운 글). lang 이 없거나 모르면 이스케이프만.
 * 'xml' · 'log' · 'diff' 는 줄 단위 규칙, 나머지는 LANGS 의 토큰 규칙
 */
export function highlightLines(text: string, lang?: string): string[] {
  const lines = text.split('\n');
  if (!lang || text.length > HIGHLIGHT_MAX) return lines.map(esc);
  // 긴 줄은 빈 줄로 바꿔 칠하고(여러 줄 상태는 그대로 이어진다) 그 자리에 이스케이프한 원문을 넣는다
  const long = lines.map((l) => l.length > HIGHLIGHT_LINE_MAX);
  const work = long.some(Boolean) ? lines.map((l, i) => (long[i] ? '' : l)) : lines;
  const out = paint(work, lang);
  return long.some(Boolean) ? out.map((h, i) => (long[i] ? esc(lines[i]) : h)) : out;
}

function paint(lines: string[], lang: string): string[] {
  if (lang === 'xml') return xmlLines(lines);
  if (lang === 'log') return lines.map(logLine);
  if (lang === 'diff') return lines.map((l) => (/^\+(?!\+\+)/.test(l) ? span('i', l) : /^-(?!--)/.test(l) ? span('d', l) : /^(@@|diff |index |\+\+\+|---)/.test(l) ? span('h', l) : esc(l)));
  const L = LANGS[lang];
  if (!L) return lines.map(esc);
  if (lang === 'yaml') return yamlLines(lines, L);
  if (lang === 'ini' || lang === 'toml') return iniLines(lines, L);
  return tokenLines(lines, L, lang === 'json');
}

/** 토큰 규칙으로 — 블록 주석·여러 줄 글은 줄을 넘어 이어 간다 */
function tokenLines(lines: string[], L: Lang, json: boolean): string[] {
  const out: string[] = [];
  /** 이어지는 블록: 끝 표시와 토큰 종류 */
  let open: { end: string; tok: Tok } | null = null;
  for (const line of lines) {
    let html = '';
    let i = 0;
    const n = line.length;
    while (i < n) {
      if (open) {
        const e = line.indexOf(open.end, i);
        if (e < 0) { html += span(open.tok, line.slice(i)); i = n; break; }
        html += span(open.tok, line.slice(i, e + open.end.length));
        i = e + open.end.length;
        open = null;
        continue;
      }
      const rest = line.slice(i);
      const lc = L.line?.find((m) => rest.startsWith(m) && (m !== '#' || !L.hashVar || i === 0 || /\s/.test(line[i - 1])));
      if (lc) { html += span('c', rest); break; }
      const bl = L.block?.find(([a]) => rest.startsWith(a));
      if (bl) {
        const tok: Tok = bl[0].startsWith('"') || bl[0].startsWith("'") ? 's' : 'c';
        const e = line.indexOf(bl[1], i + bl[0].length);
        if (e < 0) { html += span(tok, rest); open = { end: bl[1], tok }; break; }
        html += span(tok, line.slice(i, e + bl[1].length));
        i = e + bl[1].length;
        continue;
      }
      const c = line[i];
      if (L.quotes.includes(c)) {
        let j = i + 1;
        while (j < n && line[j] !== c) { if (line[j] === '\\') j++; j++; }
        const s = line.slice(i, Math.min(n, j + 1));
        // JSON: 쌍점 앞의 글은 키
        const key = json && /^\s*:/.test(line.slice(j + 1));
        html += span(key ? 'a' : 's', s);
        i = Math.min(n, j + 1);
        continue;
      }
      const num = /^-?(0x[\da-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)\b/i.exec(rest);
      if (num && (i === 0 || !/[\w$]/.test(line[i - 1]))) { html += span('n', num[0]); i += num[0].length; continue; }
      const w = /^[A-Za-z_$@][\w$-]*/.exec(rest);
      if (w) {
        const word = w[0].replace(/-+$/, '');
        const hit = L.words && (L.words.has(word) || (L.ci && L.words.has(word.toLowerCase())));
        html += hit ? span('k', word) : esc(word);
        i += word.length || 1;
        continue;
      }
      if (L.hashVar && c === '$') { const v = /^\$(\{[^}]*\}|\(?[\w@#?*!$-]+\)?)/.exec(rest); if (v) { html += span('v', v[0]); i += v[0].length; continue; } }
      html += esc(c);
      i++;
    }
    out.push(html);
  }
  return out;
}

/** YAML: 키·주석·글·값 낱말 */
function yamlLines(lines: string[], L: Lang): string[] {
  let scalar: number | null = null;
  return lines.map((line) => {
    const ind = (/^ */.exec(line) as RegExpExecArray)[0].length;
    if (scalar != null) { if (!line.trim() || ind > scalar) return span('s', line); scalar = null; }
    if (/^\s*#/.test(line)) return span('c', line);
    if (/^(---|\.\.\.)\s*$/.test(line)) return span('p', line);
    // 키 묶음과 쌍점 앞 빈칸이 겹치지 않게(되짚기가 제곱으로 늘지 않게) — 따옴표 키만 뒤 빈칸을 따로
    const m = /^(\s*(?:-\s+)?)("(?:[^"\\]|\\.)*"\s*|'(?:[^']|'')*'\s*|[^\s#'"][^:#]*?)(:)(\s|$)(.*)$/.exec(line);
    if (!m) return valueHtml(line, L);
    if (/^[|>][-+0-9]*\s*(#.*)?$/.test(m[5].trim())) scalar = ind;
    return esc(m[1]) + span('a', m[2]) + esc(m[3]) + esc(m[4]) + valueHtml(m[5], L);
  });
}

/** 값 부분: 뒤 주석 · 글 · 수 · 참거짓 */
function valueHtml(v: string, L: Lang): string {
  const cm = /(^|\s)#.*$/.exec(v);
  const body = cm ? v.slice(0, cm.index + cm[1].length) : v;
  const tail = cm ? v.slice(cm.index + cm[1].length) : '';
  const t = body.trim();
  const at = body.indexOf(t);
  const wrap = (tok: Tok) => esc(body.slice(0, at)) + span(tok, t) + esc(body.slice(at + t.length));
  const h = !t ? esc(body)
    : /^(".*"|'.*')$/.test(t) ? wrap('s')
    : /^-?\d[\d_.]*(e[+-]?\d+)?$/i.test(t) ? wrap('n')
    : L.words?.has(t.toLowerCase()) ? wrap('k')
    : /^[&*!]/.test(t) ? wrap('p')
    : esc(body);
  return h + (tail ? span('c', tail) : '');
}

/** INI·TOML: [섹션]·키 = 값·주석 (TOML 의 여러 줄 글은 이어서) */
function iniLines(lines: string[], L: Lang): string[] {
  let open: string | null = null;
  return lines.map((line) => {
    if (open) { if (line.includes(open)) open = null; return span('s', line); }
    if (/^\s*[;#]/.test(line)) return span('c', line);
    if (/^\s*\[.*\]\s*([;#].*)?$/.test(line)) return span('h', line);
    const m = /^(\s*)([^=\s][^=]*)(=)(.*)$/.exec(line);
    if (!m) return esc(line);
    for (const q of ['"""', "'''"]) if ((m[4].split(q).length - 1) % 2 === 1) open = q;
    return esc(m[1]) + span('a', m[2]) + esc(m[3]) + valueHtml(m[4], L);
  });
}

/** XML·HTML·SVG: 태그·속성·주석 (주석은 줄을 넘어) */
function xmlLines(lines: string[]): string[] {
  let comment = false;
  return lines.map((line) => {
    let html = '';
    let i = 0;
    while (i < line.length) {
      if (comment) {
        const e = line.indexOf('-->', i);
        if (e < 0) { html += span('c', line.slice(i)); i = line.length; break; }
        html += span('c', line.slice(i, e + 3)); i = e + 3; comment = false; continue;
      }
      if (line.startsWith('<!--', i)) { comment = true; continue; }
      if (line[i] === '<') {
        const e = line.indexOf('>', i);
        html += tagHtml(line.slice(i, e < 0 ? line.length : e + 1));
        i = e < 0 ? line.length : e + 1;
        continue;
      }
      const e = line.indexOf('<', i);
      html += esc(line.slice(i, e < 0 ? line.length : e));
      i = e < 0 ? line.length : e;
    }
    return html;
  });
}

/** 태그 하나(<…> 또는 줄 끝에서 잘린 <…): 이름·속성 이름·따옴표 값·닫는 표시 */
function tagHtml(tag: string): string {
  const name = /^<[/!?]?[\w:.-]*/.exec(tag)![0];
  let html = span('t', name);
  let i = name.length;
  while (i < tag.length) {
    const rest = tag.slice(i);
    const m = /^("[^"]*"?|'[^']*'?)/.exec(rest) || /^[\w:.-]+(?=\s*=)/.exec(rest) || /^[/?]?>$/.exec(rest);
    if (m) { html += span(m[0][0] === '"' || m[0][0] === "'" ? 's' : /^[\w]/.test(m[0]) ? 'a' : 't', m[0]); i += m[0].length; continue; }
    html += esc(tag[i]);
    i++;
  }
  return html;
}

/** 로그: 수준(ERROR·WARN·INFO·DEBUG)과 시각 */
function logLine(line: string): string {
  const lv = /\b(FATAL|ERROR|ERR|SEVERE|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/.exec(line);
  const ts = /^\s*\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?/.exec(line);
  let html = '';
  let rest = line;
  if (ts) { html += esc(rest.slice(0, ts.index)) + span('p', ts[0].slice(ts.index)); rest = rest.slice(ts[0].length); }
  if (lv) {
    const at = rest.indexOf(lv[1]);
    if (at >= 0) {
      const t: Tok = /FATAL|ERR|SEVERE/.test(lv[1]) ? 'd' : /WARN/.test(lv[1]) ? 'h' : 'p';
      return html + esc(rest.slice(0, at)) + span(t, lv[1]) + esc(rest.slice(at + lv[1].length));
    }
  }
  return html + esc(rest);
}
