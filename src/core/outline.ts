/**
 * 구조 글의 제목 — YAML 키 · TOML/INI 표 · JSON 키 · AsciiDoc/rST/Org 제목을 마크다운 제목처럼 센다(D87).
 *
 * 형식마다 "어느 줄이 제목인가"만 다르고, 섹션의 범위·키(` › `·` #n`)·바꿔 끼우기·바이트 보존은 마크다운과 같은 규칙(core/source)을 쓴다.
 * 화면(ui/viewers)도 이 함수의 결과로 제목을 그리므로 원문과 화면의 섹션 키가 늘 같다(패리티).
 *
 *   YAML   맨 위 키 = 2단계, 그 바로 아래 단계에서 블록 값(중첩 매핑·목록·여러 줄 글)을 가진 키 = 3단계. 바로 위에 붙은 주석 줄은 그 키의 섹션에
 *   TOML   [표] · [[표 배열]] = 2단계 (같은 이름이 또 나오면 #2 …)   INI  [섹션] = 2단계
 *   JSON   맨 위 객체의 키 = 2단계, 그 값이 객체일 때 그 안에서 객체·배열 값을 가진 키 = 3단계. 키가 줄 맨 앞에 있을 때만(한 줄로 줄인 JSON 은 섹션 없음).
 *          섹션은 그 키의 값이 끝나는 줄까지(쉼표 포함) — 맨 위 객체를 닫는 '}' 는 어느 섹션에도 들지 않는다
 *   AsciiDoc  `= 제목`(1단계) … `====== 제목`(6단계), 구분 블록(----, ...., ====, ****, ____, ++++, ////) 안은 세지 않는다
 *   rST    밑줄(·윗줄) 장식이 붙은 줄 — 장식 모양이 처음 나온 차례대로 1, 2, 3 … 단계
 *   Org    `*` 개수가 단계
 * 입력은 LF 글.
 */
import type { FormatSpec } from './formats';
import { norm } from './markdown';

export interface Head {
  level: number;
  title: string;
  /** 섹션 시작 — 제목 줄, 바로 위에 붙은 주석이 있으면 그 주석의 시작 */
  start: number;
  /** 형식이 섹션 끝을 정할 때(JSON — 값이 끝나는 줄 다음). 없으면 다음 같은·상위 제목 직전 */
  end?: number;
}

/** 제목을 찾을 때 보는 줄 앞부분 — 아주 긴 줄(한 줄짜리 데이터)은 앞만 본다. 화면도 같은 제목을 쓰므로 키는 그대로 같다 */
export const LINE_SCAN_MAX = 2000;

/** 줄과 그 시작 오프셋 (s 는 앞 LINE_SCAN_MAX 글자까지) */
function lines(text: string): { s: string; at: number }[] {
  const out: { s: string; at: number }[] = [];
  let at = 0;
  for (;;) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    if (nl < 0 && at >= text.length) break;
    out.push({ s: text.slice(at, Math.min(end, at + LINE_SCAN_MAX)), at });
    if (nl < 0) break;
    at = nl + 1;
  }
  return out;
}

/** AsciiDoc 제목 끝의 닫는 = 표시(`== 제목 ==`)와 끝 빈칸 — 정규식 되짚기 없이 */
function stripClosing(t: string): string {
  let x = t.trimEnd();
  let j = x.length;
  while (j > 0 && x[j - 1] === '=') j--;
  if (j < x.length && j > 0 && (x[j - 1] === ' ' || x[j - 1] === '\t')) x = x.slice(0, j).trimEnd();
  return x;
}

/** Org 제목 끝의 꼬리표(`:a:b:`)와 끝 빈칸 */
function stripTags(t: string): string {
  const x = t.trimEnd();
  const sp = Math.max(x.lastIndexOf(' '), x.lastIndexOf('\t'));
  return sp >= 0 && /^:[\w@#%:]+:$/.test(x.slice(sp + 1)) ? x.slice(0, sp).trimEnd() : x;
}

const indentOf = (s: string): number => (/^ */.exec(s) as RegExpExecArray)[0].length;

/** 형식의 제목들. 섹션을 세지 않는 형식(글·코드·표)은 빈 목록 */
export function outlineHeads(text: string, f: FormatSpec): Head[] {
  switch (f.id) {
    case 'yaml': return yamlHeads(text);
    case 'toml': return bracketHeads(text, /^\s*\[\[?([^\],\n]+)\]\]?\s*(#.*)?$/, /^\s*#/, true);
    case 'ini': return bracketHeads(text, /^\s*\[([^\]\n]+)\]\s*([;#].*)?$/, /^\s*[;#]/, false);
    case 'json': return jsonHeads(text);
    case 'asciidoc': return asciidocHeads(text);
    case 'rst': return rstHeads(text);
    case 'org': return orgHeads(text);
    default: return [];
  }
}

// ---------------------------------------------------------------- YAML

/** YAML 키 줄: 들여쓰기 · 키(따옴표 가능) · 쌍점 뒤 값 */
// 키 글자 묶음은 쌍점을 넘지 못하고 빈칸을 품으므로 쌍점 앞 빈칸을 따로 세지 않는다 — 겹치면 긴 빈칸 줄에서 되짚기가 제곱으로 는다(독립 검토 실측)
const YAML_KEY = /^( *)("(?:[^"\\\n]|\\.)*"[ \t]*|'(?:[^'\n]|'')*'[ \t]*|[^\s#'"[\]{},&*!|>%@`?-][^:#\n]*?|-[^\s:#][^:#\n]*?):(?=[ \t]|$)(.*)$/;

const unquote = (k: string): string => {
  if (k.startsWith('"') && k.endsWith('"')) { try { return JSON.parse(k); } catch { return k.slice(1, -1); } }
  if (k.startsWith("'") && k.endsWith("'")) return k.slice(1, -1).replace(/''/g, "'");
  return k;
};

function yamlHeads(text: string): Head[] {
  const heads: Head[] = [];
  /** 끝을 아직 모르는 2단계 아래 키(블록) — 그 키보다 얕거나 같은 들여쓰기의 줄이 나오면 거기서 끝 */
  let openBlock: { head: Head; indent: number } | null = null;
  /** 여러 줄 글(| >) 안 — 이 들여쓰기보다 깊은 줄은 글이다 */
  let scalar: number | null = null;
  /** 지금 맨 위 키 아래 첫 단계의 들여쓰기 */
  let top: { child: number | null } | null = null;
  /** 바로 앞에 이어진 주석 줄들 (시작, 들여쓰기) */
  let comment: { at: number; indent: number } | null = null;
  for (const ln of lines(text)) {
    const s = ln.s.replace(/\r$/, '');
    const trimmed = s.trim();
    const ind = indentOf(s);
    if (scalar != null) {
      if (!trimmed || ind > scalar) continue;
      scalar = null;
    }
    if (!trimmed) { comment = null; continue; }
    // 아래 키의 블록이 끝났나 — 더 얕은 줄, 또는 같은 들여쓰기의 목록 항목(- …)이 아닌 줄(같은 단계의 다음 키·주석)
    if (openBlock && (ind < openBlock.indent || (ind === openBlock.indent && !/^-(\s|$)/.test(trimmed)))) { openBlock.head.end = ln.at; openBlock = null; }
    if (trimmed.startsWith('#')) { if (!comment || comment.indent !== ind) comment = { at: ln.at, indent: ind }; continue; }
    if (ind === 0 && /^(---|\.\.\.)(\s|$)/.test(s)) { top = null; comment = null; continue; }
    const m = YAML_KEY.exec(s);
    if (m) {
      // 값 앞의 앵커·태그(&기준 · !!map · !Ref)는 값이 아니다 — 그것만 있으면 아래 줄이 값(블록)
      const value = m[3].replace(/(^|\s)#.*$/, '').trim().replace(/^((&|!)[^\s]*\s*)+/, '');
      const blockScalar = /^[|>][-+0-9]*$/.test(value);
      const block = value === '' || blockScalar;
      const title = norm(unquote(m[2].trim()));
      const start = comment && comment.indent === ind ? comment.at : ln.at;
      if (ind === 0) {
        if (title) heads.push({ level: 2, title, start });
        top = { child: null };
      } else if (top) {
        if (top.child == null) top.child = ind;
        if (ind === top.child && block && title) { const hd: Head = { level: 3, title, start }; heads.push(hd); openBlock = { head: hd, indent: ind }; }
      }
      if (blockScalar) scalar = ind;
    } else if (ind > 0 && top && top.child == null) top.child = ind;
    comment = null;
  }
  return heads;
}

// ---------------------------------------------------------------- TOML · INI

/**
 * [표] 줄 제목. toml 이면 여러 줄 글("""·''')과 여러 줄에 걸친 배열·인라인 표 안은 세지 않는다
 * (배열 안의 `[1, 2]`·`["a"]` 줄을 표로 읽지 않게)
 */
function bracketHeads(text: string, head: RegExp, commentLine: RegExp, toml: boolean): Head[] {
  const heads: Head[] = [];
  let comment: number | null = null;
  /** 여러 줄 글("""·''') 안 */
  let inStr: string | null = null;
  /** 값의 괄호 깊이 (여러 줄 배열·인라인 표) */
  let depth = 0;
  for (const ln of lines(text)) {
    const s = ln.s.replace(/\r$/, '');
    if (toml) {
      const was = inStr;
      for (const q of ['"""', "'''"]) {
        if (inStr && inStr !== q) continue;
        const n = s.split(q).length - 1;
        if (n % 2 === 1) inStr = inStr ? null : q;
      }
      if (was) { comment = null; continue; }
    }
    if (!s.trim()) { comment = null; continue; }
    if (commentLine.test(s)) { if (comment == null) comment = ln.at; continue; }
    const m = depth === 0 && !inStr ? head.exec(s) : null;
    if (m) {
      const title = norm(m[1]);
      if (title) heads.push({ level: 2, title, start: comment ?? ln.at });
    } else if (toml) depth = Math.max(0, depth + bracketDelta(s));
    comment = null;
  }
  return heads;
}

/** 줄의 여는 괄호 − 닫는 괄호 ([ ] { }) — 따옴표 글과 주석 밖만 */
function bracketDelta(s: string): number {
  let d = 0;
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#') break;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
  }
  return d;
}

// ---------------------------------------------------------------- JSON

interface JsonScan { heads: Head[]; ok: boolean }

/**
 * JSON(주석 허용)을 훑어 맨 위 객체의 키(2단계)와 그 안 한 단계의 블록 키(3단계)를 찾는다. 섹션 끝은 값이 끝난 줄의 끝(쉼표 포함).
 * 키가 줄 맨 앞이 아니면(한 줄 JSON) 맨 위 키는 세지 않는다 — 줄 단위로 그리고 고치는 화면과 맞지 않는다.
 */
function jsonHeads(text: string): Head[] {
  const r = scanJson(text);
  return r.ok ? r.heads : [];
}

function scanJson(text: string): JsonScan {
  const heads: Head[] = [];
  const n = text.length;
  let i = 0;
  const lineStart = (p: number) => text.lastIndexOf('\n', p - 1) + 1;
  const lineEnd = (p: number) => { const e = text.indexOf('\n', p); return e < 0 ? n : e + 1; };
  const firstOnLine = (p: number) => /^[ \t]*$/.test(text.slice(lineStart(p), p));
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith('//', i)) { const e = text.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
      if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      break;
    }
  };
  const readString = (): string | null => {
    if (text[i] !== '"') return null;
    const s0 = i++;
    while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
    i++;
    try { return JSON.parse(text.slice(s0, i)); } catch { return text.slice(s0 + 1, i - 1); }
  };
  /** 값 하나를 건너뛴다. 마지막 글자 다음 자리를 돌려준다 */
  const skipValue = (depth: number, onKey?: (key: string, keyAt: number, depth: number) => ((valueStart: number, valueEnd: number) => void) | void): number => {
    skip();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      for (;;) {
        skip();
        if (i >= n) return n;
        if (text[i] === close) { i++; return i; }
        if (text[i] === ',') { i++; continue; }
        if (c === '{') {
          const keyAt = i;
          const key = readString();
          if (key == null) { i++; continue; }
          skip();
          if (text[i] === ':') i++;
          skip();
          const valueStart = i;
          const done = onKey?.(key, keyAt, depth + 1);
          const end = skipValue(depth + 1, onKey);
          if (done) done(valueStart, end);
        } else skipValue(depth + 1, onKey);
      }
    }
    if (c === '"') { readString(); return i; }
    while (i < n && !/[\s,\]}]/.test(text[i]) && !text.startsWith('//', i) && !text.startsWith('/*', i)) i++;
    return i;
  };
  skip();
  if (text[i] !== '{') return { heads, ok: false };
  /** 맨 위 키를 줄 맨 앞에 두지 않은 한 줄 JSON 이면 거둔다 */
  let inline = false;
  /** 섹션 끝: 값 끝 뒤의 쉼표까지, 그 줄 끝까지 */
  const endAfter = (valueEnd: number): number => {
    let j = valueEnd;
    while (j < n && /[ \t]/.test(text[j])) j++;
    if (text[j] === ',') j++;
    return lineEnd(j);
  };
  let parent: string | null = null;
  skipValue(0, (key, keyAt, depth) => {
    if (depth === 1) {
      if (!firstOnLine(keyAt)) { inline = true; return; }
      const h: Head = { level: 2, title: norm(key), start: lineStart(keyAt) };
      heads.push(h);
      parent = key;
      return (vs, ve) => { h.end = endAfter(ve); parent = null; void vs; };
    }
    if (depth === 2 && parent != null && firstOnLine(keyAt)) {
      // 값이 객체·배열일 때만 (숫자·글 하나짜리 키까지 섹션이면 목차가 시끄럽다)
      let j = i;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] !== '{' && text[j] !== '[') return;
      const h: Head = { level: 3, title: norm(key), start: lineStart(keyAt) };
      heads.push(h);
      return (vs, ve) => { h.end = endAfter(ve); void vs; };
    }
    return;
  });
  if (inline) return { heads: [], ok: false };
  // 제목 글자가 빈 키("")는 섹션으로 세지 않는다
  return { heads: heads.filter((h) => h.title), ok: true };
}

/**
 * JSON 글이 읽히는가 — 주석(//, /* *\/)과 끝의 쉼표는 허용하는 형식(jsonc·tsconfig 등)도 있어 그것들을 뺀 뒤 본다.
 * 고친 글이 문서를 깨뜨리지 않는지 보는 데 쓴다(원래 읽히던 문서만).
 */
export function jsonReadable(text: string): boolean {
  try { JSON.parse(stripJsonExtras(text)); return true; } catch { return false; }
}

/** 문자열 밖의 주석과 닫는 괄호 앞 쉼표를 뺀다 */
export function stripJsonExtras(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const s0 = i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      i++;
      out += text.slice(s0, i);
      continue;
    }
    if (text.startsWith('//', i)) { const e = text.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1').replace(/^﻿/, '');
}

// ---------------------------------------------------------------- AsciiDoc

function asciidocHeads(text: string): Head[] {
  const heads: Head[] = [];
  let fence: string | null = null;
  for (const ln of lines(text)) {
    const s = ln.s.replace(/\r$/, '');
    if (fence) { if (s === fence) fence = null; continue; }
    if (/^(-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|\/{4,})$/.test(s)) { fence = s; continue; }
    const m = /^(={1,6})[ \t]+(\S.*)$/.exec(s);
    if (m) heads.push({ level: m[1].length, title: norm(stripClosing(m[2])), start: ln.at });
  }
  return heads.filter((h) => h.title);
}

// ---------------------------------------------------------------- reStructuredText

/** 장식 줄 — 같은 문장 부호 셋 이상. '.' 은 넣지 않는다(… 줄임표 줄을 밑줄로 읽지 않게) */
const RST_ADORN = /^([=\-`:'"~^_*+#<>])\1{2,}[ \t]*$/;

function rstHeads(text: string): Head[] {
  const heads: Head[] = [];
  const L = lines(text).map((l) => ({ ...l, s: l.s.replace(/\r$/, '') }));
  const styles: string[] = [];
  const levelOf = (style: string) => { let k = styles.indexOf(style); if (k < 0) { styles.push(style); k = styles.length - 1; } return Math.min(6, k + 1); };
  for (let i = 0; i < L.length; i++) {
    const a = L[i].s, b = L[i + 1]?.s, c = L[i + 2]?.s;
    // 윗줄 + 글 + 밑줄
    if (RST_ADORN.test(a) && b != null && b.trim() && !RST_ADORN.test(b) && c != null && c.trim() === a.trim()) {
      heads.push({ level: levelOf('o' + a.trim()[0]), title: norm(b), start: L[i].at });
      i += 2;
      continue;
    }
    // 글 + 밑줄 (앞 줄은 비었거나 문서 처음)
    const prevBlank = i === 0 || !L[i - 1].s.trim();
    if (prevBlank && a.trim() && !/^\s/.test(a) && !RST_ADORN.test(a) && b != null && RST_ADORN.test(b)) {
      heads.push({ level: levelOf('u' + b.trim()[0]), title: norm(a), start: L[i].at });
      i += 1;
    }
  }
  return heads.filter((h) => h.title);
}

// ---------------------------------------------------------------- Org

function orgHeads(text: string): Head[] {
  const heads: Head[] = [];
  let block = false;
  for (const ln of lines(text)) {
    const s = ln.s.replace(/\r$/, '');
    if (/^\s*#\+begin_/i.test(s)) { block = true; continue; }
    if (/^\s*#\+end_/i.test(s)) { block = false; continue; }
    if (block) continue;
    const m = /^(\*+)[ \t]+(.*)$/.exec(s);
    const title = m ? stripTags(m[2]) : '';
    if (m && title.trim()) heads.push({ level: Math.min(6, m[1].length), title: norm(title), start: ln.at });
  }
  return heads;
}
