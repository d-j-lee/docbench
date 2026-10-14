/**
 * 뽑은 글 — Word·PowerPoint·Excel·한글(HWPX)·Jupyter 파일에서 글을 뽑아 마크다운으로(D87). DOM 없이 돈다.
 *
 * 원본은 고치지 않는다(읽기 전용). 뽑은 글은 마크다운이라 섹션·피드백 위치·바뀐 글 표시·Claude 맥락이 마크다운 문서와 같은 규칙으로 돈다 —
 * 판(바이트 해시)이 바뀌면 이력에 남고, 다시 열면 "본 뒤로 바뀐 글"이 Word 문서에서도 보인다.
 *
 * ZIP 은 직접 읽는다(중앙 디렉터리 → 로컬 헤더). 압축 풀기(deflate-raw)는 부르는 쪽이 준다:
 * 서버·CLI 는 node:zlib, 브라우저는 DecompressionStream. 주지 않으면 DecompressionStream 을 찾는다.
 * XML 은 작은 토큰 읽개로 읽는다(DOMParser 가 없는 Node 에서도 같게) — 이름공간 접두어(w: a: hp: …)는 보지 않는다.
 */
import type { FormatSpec } from './formats';
import { decodeEntities } from './markdown';

/** deflate-raw 풀기 — max 바이트를 넘으면 멈추고 던진다(압축 폭탄: 작게 적힌 크기를 믿지 않는다) */
export type Inflate = (raw: Uint8Array, max: number) => Promise<Uint8Array>;
export interface DeriveOptions { inflate?: Inflate; locale?: 'ko' | 'en' }

/** 글을 뽑지 못했다 — not-zip: ZIP 이 아님(암호가 걸린 오피스 파일도 이렇게 보인다) · broken: 깨짐 · unsupported: 모르는 압축 */
export class DeriveError extends Error {
  constructor(public reason: 'not-zip' | 'broken' | 'unsupported' | 'too-large', msg?: string) { super(msg || reason); }
}

/** 뽑은 글의 한도(글자) — 넘으면 자르고 알린다 */
export const DERIVED_MAX_CHARS = 2_000_000;
/** 항목 하나를 풀 때의 한도 */
const ENTRY_MAX = 64 * 1024 * 1024;
/** 파일 하나에서 모두 풀어도 되는 바이트 — 같은 항목을 여러 번 가리키는 꾸민 목록(슬라이드·시트)으로 부풀리지 못하게 */
const TOTAL_MAX = 160 * 1024 * 1024;
/** 슬라이드·시트·구역 수 한도 (같은 것은 한 번만) */
const PARTS_MAX = 1000;

// ---------------------------------------------------------------- ZIP

export interface ZipEntry { name: string; method: number; csize: number; usize: number; local: number }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** ZIP 의 항목 목록 (중앙 디렉터리에서). ZIP 이 아니면 DeriveError('not-zip') */
export function readZip(b: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new DeriveError('not-zip');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: ZipEntry[] = [];
  const names = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new DeriveError('broken');
    const method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24);
    const nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), local = u32(b, p + 42);
    out.push({ name: names.decode(b.subarray(p + 46, p + 46 + nl)), method, csize, usize, local });
    p += 46 + nl + xl + cl;
  }
  return out;
}

/** 브라우저 기본 — DecompressionStream 을 조각마다 읽어 한도를 넘으면 멈춘다 */
async function defaultInflate(raw: Uint8Array, max: number): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw new DeriveError('unsupported', 'DecompressionStream 이 없습니다');
  const reader = new Blob([raw as BlobPart]).stream().pipeThrough(new DS('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => undefined); throw new DeriveError('too-large'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** 항목 하나의 바이트 */
export async function zipEntry(b: Uint8Array, e: ZipEntry, inflate: Inflate = defaultInflate, max = ENTRY_MAX): Promise<Uint8Array> {
  if (e.usize > max || e.csize === 0xffffffff) throw new DeriveError('too-large');
  if (e.local + 30 > b.length || u32(b, e.local) !== 0x04034b50) throw new DeriveError('broken');
  const start = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
  const raw = b.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method === 8) {
    try { return await inflate(raw, max); } catch (err) {
      if (err instanceof DeriveError) throw err;
      // 서버 zlib 의 maxOutputLength 초과(RangeError) 등 — 한도를 넘었거나 깨진 압축
      throw new DeriveError(/output|length|buffer|max/i.test(String((err as Error)?.message)) ? 'too-large' : 'broken');
    }
  }
  throw new DeriveError('unsupported', '압축 방식 ' + e.method);
}

// ---------------------------------------------------------------- XML

export interface XmlTok { t: 'open' | 'close' | 'text'; name: string; attrs: Record<string, string>; self?: boolean; text?: string }

/** 작은 XML 토큰 읽개 — 태그 이름은 접두어를 뗀 이름(w:p → p). 주석·처리 지시·DOCTYPE 은 건너뛴다. CDATA 는 글로 */
export function* xmlTokens(xml: string): Generator<XmlTok> {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { yield { t: 'text', name: '', attrs: {}, text: decodeEntities(xml.slice(i)) }; break; }
    if (lt > i) yield { t: 'text', name: '', attrs: {}, text: decodeEntities(xml.slice(i, lt)) };
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); yield { t: 'text', name: '', attrs: {}, text: xml.slice(lt + 9, e < 0 ? n : e) }; i = e < 0 ? n : e + 3; continue; }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') { const e = xml.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    // 속성값 안의 '>' 를 지나며 태그 끝을 찾는다
    let j = lt + 1;
    let q: string | null = null;
    while (j < n) { const c = xml[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body.startsWith('/')) { yield { t: 'close', name: local(body.slice(1).trim()), attrs: {} }; continue; }
    const self = body.endsWith('/');
    const m = /^([^\s/>]+)/.exec(body);
    const attrs: Record<string, string> = {};
    for (const a of body.matchAll(/([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
    yield { t: 'open', name: local(m ? m[1] : ''), attrs, self };
  }
}
const local = (q: string) => { const k = q.indexOf(':'); return k >= 0 ? q.slice(k + 1) : q; };
/** 속성값 — 접두어 없는 이름 먼저, 없으면 접두어가 붙은 같은 이름(w:val · r:id …) */
export const attr = (tk: XmlTok, name: string): string | undefined => tk.attrs[name] ?? Object.entries(tk.attrs).find(([k]) => k.includes(':') && local(k) === name)?.[1];
/** 접두어가 붙은 속성만 (관계 id r:id — 접두어 없는 id 와 다르다) */
const nsAttr = (tk: XmlTok, name: string): string | undefined => Object.entries(tk.attrs).find(([k]) => k.includes(':') && local(k) === name)?.[1];

// ---------------------------------------------------------------- 마크다운 쓰기

/** 뽑은 글을 마크다운 안에 그대로 보이게 — 마크다운 기호를 이스케이프한다(줄 첫머리의 제목·목록·인용 표시도) */
export function mdText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/[\\`*_[\]<>~|]/g, '\\$&').replace(/^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/gm, (_m, sp: string, mk: string) => sp + '\\' + mk);
}

/** 표 → 마크다운 표 (첫 줄이 머리). 칸의 줄바꿈은 <br> 대신 공백 */
export function mdTable(rows: string[][]): string {
  const w = Math.max(0, ...rows.map((r) => r.length));
  if (!w || !rows.length) return '';
  const cell = (s: string) => mdText((s || '').replace(/\s*\n\s*/g, ' ').trim()) || ' ';
  const line = (r: string[]) => '| ' + Array.from({ length: w }, (_, k) => cell(r[k] || '')).join(' | ') + ' |';
  return [line(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(line)].join('\n');
}

const fence = (src: string): string => { let f = '```'; while (src.includes(f)) f += '`'; return f; };

// ---------------------------------------------------------------- 형식마다

/** 형식에 맞춰 글을 뽑는다 (뽑을 수 없는 형식이면 null) */
export async function deriveText(bytes: Uint8Array, f: FormatSpec, o: DeriveOptions = {}): Promise<string | null> {
  let out: string | null = null;
  if (f.id === 'ipynb') out = notebookText(new TextDecoder().decode(bytes), o);
  else if (f.id === 'docx' || f.id === 'pptx' || f.id === 'xlsx' || f.id === 'hwpx') {
    const entries = readZip(bytes);
    // 같은 항목은 한 번만 풀고, 파일 하나에서 푸는 바이트는 모두 합쳐 TOTAL_MAX 까지
    const cache = new Map<string, string | null>();
    let budget = TOTAL_MAX;
    const read = async (name: string): Promise<string | null> => {
      if (cache.has(name)) return cache.get(name)!;
      const e = entries.find((x) => x.name === name);
      let text: string | null = null;
      if (e) {
        if (budget <= 0) throw new DeriveError('too-large');
        const raw = await zipEntry(bytes, e, o.inflate, Math.min(ENTRY_MAX, budget));
        budget -= raw.length;
        text = new TextDecoder().decode(raw);
      }
      cache.set(name, text);
      return text;
    };
    out = f.id === 'docx' ? await docxText(read, o) : f.id === 'pptx' ? await pptxText(entries, read, o) : f.id === 'xlsx' ? await xlsxText(read, o) : await hwpxText(entries, read, o);
  }
  if (out == null) return null;
  if (out.length > DERIVED_MAX_CHARS) out = out.slice(0, DERIVED_MAX_CHARS).replace(/\n[^\n]*$/, '') + '\n\n' + (o.locale === 'en' ? '_(The rest is too long and was cut.)_' : '_(뒤는 길어서 잘랐습니다.)_');
  return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s*$/, '\n');
}

type Reader = (name: string) => Promise<string | null>;
const imageMark = (o: DeriveOptions) => (o.locale === 'en' ? '[image]' : '[그림]');

/** 관계 파일(_rels/*.rels) → id → 대상 경로 */
function rels(xml: string | null, base: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!xml) return m;
  for (const tk of xmlTokens(xml)) if (tk.t === 'open' && tk.name === 'Relationship' && tk.attrs.Id && tk.attrs.Target) {
    const t = tk.attrs.Target;
    m.set(tk.attrs.Id, t.startsWith('/') ? t.slice(1) : normPath(base + t));
  }
  return m;
}
const normPath = (p: string) => { const out: string[] = []; for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); };

// ---- 단락·표 모으기 (Word·한글이 같이 쓴다)

interface Para { text: string; level: number; list: number; img: number }
interface Table { rows: string[][]; row: string[] | null; cell: string[] | null }

/** 단락 하나 → 마크다운 줄. 탭은 공백, 줄 앞뒤 공백은 뗀다(4칸 들여쓰기가 코드 블록이 되지 않게) */
function paraLine(p: Para, o: DeriveOptions): string | null {
  const body = p.text.replace(/\t/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  // 그림 표시는 이스케이프하지 않는다(뽑은 글이 아니라 DocBench 가 붙인 표시)
  const mark = p.img ? (body ? ' ' : '') + imageMark(o) + (p.img > 1 ? ' ×' + p.img : '') : '';
  if (!body && !mark) return null;
  if (p.level) return '#'.repeat(p.level) + ' ' + mdText(body.replace(/\n/g, ' ')) + mark;
  if (p.list) return '  '.repeat(Math.min(p.list, 6) - 1) + '- ' + mdText(body.replace(/\n/g, ' ')) + mark;
  return mdText(body) + mark;
}

/** 단락·표를 받아 마크다운 덩이로 — 표 안의 단락은 칸 글로, 표 안의 표는 칸 글로 합친다 */
function collector(o: DeriveOptions) {
  const out: string[] = [];
  const tables: Table[] = [];
  return {
    out,
    para(p: Para) {
      const tb = tables[tables.length - 1];
      if (tb?.cell) { const t = p.text.replace(/\s+/g, ' ').trim() + (p.img ? ' ' + imageMark(o) : ''); if (t.trim()) tb.cell.push(t.trim()); return; }
      const line = paraLine(p, o);
      if (line) out.push(line);
    },
    openTable() { tables.push({ rows: [], row: null, cell: null }); },
    openRow() { const tb = tables[tables.length - 1]; if (tb) tb.row = []; },
    openCell() { const tb = tables[tables.length - 1]; if (tb) tb.cell = []; },
    closeCell() { const tb = tables[tables.length - 1]; if (tb?.row && tb.cell) tb.row.push(tb.cell.join(' ').trim()); if (tb) tb.cell = null; },
    closeRow() { const tb = tables[tables.length - 1]; if (tb?.row) tb.rows.push(tb.row); if (tb) tb.row = null; },
    closeTable() {
      const tb = tables.pop();
      if (!tb) return;
      const outer = tables[tables.length - 1];
      if (outer?.cell) outer.cell.push(tb.rows.map((r) => r.join(' / ')).join(' ; '));
      else { const md = mdTable(tb.rows); if (md) out.push(md); }
    },
  };
}

// ---- Word

async function docxText(read: Reader, o: DeriveOptions): Promise<string> {
  const doc = await read('word/document.xml');
  if (doc == null) throw new DeriveError('broken', 'word/document.xml 이 없습니다');
  // 스타일 id → 제목 단계: 이름이 "heading n"(→ n+1 단계)·"Title"(→ 1) 이거나 개요 수준(outlineLvl)이 있는 스타일.
  // 한국어 Word 도 styles.xml 의 이름은 영어("heading 1")다 — 화면 이름(제목 1)은 따로
  const levels = new Map<string, number>();
  const styles = await read('word/styles.xml');
  if (styles) {
    let id: string | null = null;
    for (const tk of xmlTokens(styles)) {
      if (tk.t === 'open' && tk.name === 'style') id = attr(tk, 'styleId') || null;
      else if (tk.t === 'close' && tk.name === 'style') id = null;
      else if (id && tk.t === 'open' && tk.name === 'name') {
        const v = attr(tk, 'val') || '';
        const h = /^heading\s*(\d)$/i.exec(v);
        if (h) levels.set(id, Math.min(6, +h[1] + 1));
        else if (/^title$/i.test(v)) levels.set(id, 1);
      } else if (id && tk.t === 'open' && tk.name === 'outlineLvl' && !levels.has(id)) levels.set(id, Math.min(6, +(attr(tk, 'val') || 0) + 2));
    }
  }
  const styleLevel = (v: string): number => {
    const known = levels.get(v);
    if (known) return known;
    const m = /^(?:heading|제목)\s*(\d)$/i.exec(v);
    return m ? Math.min(6, +m[1] + 1) : /^title$/i.test(v) ? 1 : 0;
  };
  const c = collector(o);
  let para: Para | null = null;
  let inText = false;
  /** 바뀐 글 추적의 지운 글(delText)·필드 코드(instrText)는 글이 아니다 */
  for (const tk of xmlTokens(doc)) {
    if (tk.t === 'open') {
      switch (tk.name) {
        case 'p': if (para) c.para(para); para = { text: '', level: 0, list: 0, img: 0 }; if (tk.self) { c.para(para); para = null; } break;
        case 'pStyle': if (para) para.level = styleLevel(attr(tk, 'val') || ''); break;
        case 'outlineLvl': if (para && !para.level) para.level = Math.min(6, +(attr(tk, 'val') || 0) + 2); break;
        case 'ilvl': if (para) para.list = +(attr(tk, 'val') || 0) + 1; break;
        case 'numPr': if (para && !para.list) para.list = 1; break;
        case 't': inText = !tk.self; break;
        // 탭 멈춤 정의(<w:tabs><w:tab w:pos=…/>)가 아니라 글 속 탭만
        case 'tab': if (para && attr(tk, 'pos') == null) para.text += '\t'; break;
        case 'br': case 'cr': if (para) para.text += '\n'; break;
        case 'drawing': case 'pict': if (para) para.img++; break;
        case 'tbl': if (para) { c.para(para); para = null; } c.openTable(); break;
        case 'tr': c.openRow(); break;
        case 'tc': c.openCell(); break;
      }
    } else if (tk.t === 'close') {
      switch (tk.name) {
        case 'p': if (para) { c.para(para); para = null; } break;
        case 't': inText = false; break;
        case 'tc': if (para) { c.para(para); para = null; } c.closeCell(); break;
        case 'tr': c.closeRow(); break;
        case 'tbl': c.closeTable(); break;
      }
    } else if (inText && para) para.text += tk.text || '';
  }
  if (para) c.para(para);
  return c.out.join('\n\n') + '\n';
}

// ---- PowerPoint

async function pptxText(entries: ZipEntry[], read: Reader, o: DeriveOptions): Promise<string> {
  const pres = await read('ppt/presentation.xml');
  const presRels = rels(await read('ppt/_rels/presentation.xml.rels'), 'ppt/');
  let order: string[] = [];
  // 슬라이드 차례는 presentation.xml 의 sldId(r:id → 관계) — 파일 이름 번호는 순서를 바꾸면 어긋난다
  if (pres) for (const tk of xmlTokens(pres)) if (tk.t === 'open' && tk.name === 'sldId') { const t = presRels.get(nsAttr(tk, 'id') || ''); if (t) order.push(t); }
  if (!order.length) order = entries.map((e) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  // 같은 슬라이드를 여러 번 가리키는 목록은 한 번만, 한도까지
  order = [...new Set(order)].slice(0, PARTS_MAX);
  const en = o.locale === 'en';
  const out: string[] = [];
  let n = 0;
  let size = 0;
  for (const path of order) {
    if (size > DERIVED_MAX_CHARS) break;
    const xml = await read(path);
    if (xml == null) continue;
    n++;
    const { title, body } = slideText(xml, o);
    out.push(`## ${en ? 'Slide' : '슬라이드'} ${n}${title ? ' — ' + mdText(title) : ''}`);
    if (body.length) out.push(body.join('\n'));
    // 발표자 노트 (슬라이드의 관계에서 notesSlide)
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const sr = rels(await read(dir + '_rels/' + path.slice(dir.length) + '.rels'), dir);
    const notes = [...sr.values()].find((t) => /notesSlides\/notesSlide\d+\.xml$/.test(t));
    const nx = notes ? await read(notes) : null;
    const nt = nx ? slideText(nx, o, true).body.map((l) => l.replace(/^\s*- /, '')).join(' ').trim() : '';
    if (nt) out.push('> ' + (en ? 'Notes: ' : '발표자 노트: ') + nt.replace(/\n+/g, ' '));
    size = out.reduce((a, x) => a + x.length, 0);
  }
  return out.join('\n\n') + '\n';
}
const num = (name: string) => +((/(\d+)\.xml$/i.exec(name) || ['', '0'])[1]);

/** 슬라이드(또는 노트) 한 장 → 제목·본문 줄. 노트는 슬라이드 그림 자리(sldImg)·번호(sldNum)를 뺀다 */
function slideText(xml: string, o: DeriveOptions, notes = false): { title: string; body: string[] } {
  let title = '';
  const body: string[] = [];
  let shape: { ph: string; paras: { text: string; lvl: number }[] } | null = null;
  let para: { text: string; lvl: number } | null = null;
  let inText = false;
  let table: Table | null = null;
  let pics = 0;
  for (const tk of xmlTokens(xml)) {
    if (tk.t === 'open') {
      if (tk.name === 'sp' || tk.name === 'graphicFrame') shape = { ph: '', paras: [] };
      else if (tk.name === 'ph' && shape) shape.ph = attr(tk, 'type') || 'body';
      else if (tk.name === 'p') para = { text: '', lvl: 0 };
      else if (tk.name === 'pPr' && para) para.lvl = +(attr(tk, 'lvl') || 0);
      else if (tk.name === 't') inText = !tk.self;
      else if (tk.name === 'br' && para) para.text += '\n';
      else if (tk.name === 'pic') pics++;
      else if (tk.name === 'tbl') table = { rows: [], row: null, cell: null };
      else if (tk.name === 'tr' && table) table.row = [];
      else if (tk.name === 'tc' && table) table.cell = [];
    } else if (tk.t === 'close') {
      if (tk.name === 't') inText = false;
      else if (tk.name === 'p' && para) {
        if (table?.cell) table.cell.push(para.text);
        else if (shape) shape.paras.push(para);
        para = null;
      } else if (tk.name === 'tc' && table?.row && table.cell) { table.row.push(table.cell.join(' ').trim()); table.cell = null; }
      else if (tk.name === 'tr' && table?.row) { table.rows.push(table.row); table.row = null; }
      else if (tk.name === 'tbl' && table) { const md = mdTable(table.rows); if (md) body.push(md); table = null; }
      else if ((tk.name === 'sp' || tk.name === 'graphicFrame') && shape) {
        const texts = shape.paras.filter((p) => p.text.trim());
        if (!(notes && (shape.ph === 'sldImg' || shape.ph === 'sldNum'))) {
          if (!title && (shape.ph === 'title' || shape.ph === 'ctrTitle')) title = texts.map((p) => p.text.trim()).join(' ');
          else for (const p of texts) body.push('  '.repeat(Math.min(p.lvl, 5)) + '- ' + mdText(p.text.replace(/\s+/g, ' ').trim()));
        }
        shape = null;
      }
    } else if (inText && para) para.text += tk.text || '';
  }
  if (pics && !notes) body.push(imageMark(o) + (pics > 1 ? ' ×' + pics : ''));
  return { title: title.replace(/\s+/g, ' ').trim(), body };
}

// ---- Excel

/** 시트마다 앞에서부터 보일 행·열 */
const SHEET_ROWS = 200, SHEET_COLS = 30;

async function xlsxText(read: Reader, o: DeriveOptions): Promise<string> {
  const wb = await read('xl/workbook.xml');
  if (wb == null) throw new DeriveError('broken', 'xl/workbook.xml 이 없습니다');
  const wbRels = rels(await read('xl/_rels/workbook.xml.rels'), 'xl/');
  const shared: string[] = [];
  const ss = await read('xl/sharedStrings.xml');
  if (ss) {
    let cur: string | null = null;
    let inT = false;
    /** 읽기 표기(rPh, 일본어 후리가나)의 글은 넣지 않는다 */
    let rph = 0;
    for (const tk of xmlTokens(ss)) {
      if (tk.t === 'open' && tk.name === 'si') cur = '';
      else if (tk.t === 'close' && tk.name === 'si') { shared.push(cur || ''); cur = null; }
      else if (tk.t === 'open' && tk.name === 'rPh' && !tk.self) rph++;
      else if (tk.t === 'close' && tk.name === 'rPh') rph = Math.max(0, rph - 1);
      else if (tk.t === 'open' && tk.name === 't') inT = !tk.self;
      else if (tk.t === 'close' && tk.name === 't') inT = false;
      else if (tk.t === 'text' && inT && !rph && cur != null) cur += tk.text || '';
    }
  }
  const sheets: { name: string; path: string }[] = [];
  for (const tk of xmlTokens(wb)) if (tk.t === 'open' && tk.name === 'sheet') {
    const p = wbRels.get(nsAttr(tk, 'id') || '');
    if (p && !sheets.some((x) => x.path === p) && sheets.length < PARTS_MAX) sheets.push({ name: attr(tk, 'name') || p, path: p });
  }
  const en = o.locale === 'en';
  const out: string[] = [];
  for (const sh of sheets) {
    if (out.reduce((a, x) => a + x.length, 0) > DERIVED_MAX_CHARS) break;
    const xml = await read(sh.path);
    if (xml == null) continue;
    const rows: string[][] = [];
    let total = 0;
    let row: string[] | null = null;
    let cell: { col: number; type: string; v: string } | null = null;
    let inV = false;
    let maxCol = 0;
    for (const tk of xmlTokens(xml)) {
      if (tk.t === 'open') {
        if (tk.name === 'row') { total++; row = total <= SHEET_ROWS ? [] : null; if (tk.self && row) { rows.push(row); row = null; } }
        else if (tk.name === 'c' && row && !tk.self) cell = { col: colIndex(attr(tk, 'r') || '') ?? row.length, type: attr(tk, 't') || 'n', v: '' };
        else if ((tk.name === 'v' || tk.name === 't') && cell) inV = !tk.self;
      } else if (tk.t === 'close') {
        if ((tk.name === 'v' || tk.name === 't') && cell) inV = false;
        else if (tk.name === 'c' && cell && row) {
          const v = cell.type === 's' ? shared[+cell.v] ?? '' : cell.type === 'b' ? (cell.v === '1' ? 'TRUE' : 'FALSE') : cell.v;
          if (cell.col < SHEET_COLS) { row[cell.col] = v; maxCol = Math.max(maxCol, cell.col + 1); }
          cell = null;
        } else if (tk.name === 'row' && row) { rows.push(row); row = null; }
      } else if (inV && cell) cell.v += tk.text || '';
    }
    out.push('## ' + mdText(sh.name));
    const kept = rows.filter((r) => r.some((x) => x && x.trim()));
    if (!kept.length) { out.push(en ? '_(empty sheet)_' : '_(빈 시트)_'); continue; }
    out.push(mdTable(kept.map((r) => Array.from({ length: maxCol }, (_, k) => r[k] || ''))));
    if (total > SHEET_ROWS) out.push(en ? `_(Showing the first ${SHEET_ROWS} of ${total} rows.)_` : `_(${total}행 중 앞 ${SHEET_ROWS}행만 보입니다.)_`);
  }
  return out.join('\n\n') + '\n';
}

/** "C12" → 2 (0부터) */
function colIndex(ref: string): number | null {
  const m = /^([A-Z]+)\d*$/i.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---- 한글(HWPX, OWPML)

async function hwpxText(entries: ZipEntry[], read: Reader, o: DeriveOptions): Promise<string> {
  const sections = [...new Set(entries.map((e) => e.name).filter((n) => /^Contents\/section\d+\.xml$/i.test(n)))].sort((a, b) => num(a) - num(b)).slice(0, PARTS_MAX);
  if (!sections.length) throw new DeriveError('broken', 'Contents/section*.xml 이 없습니다');
  // 제목 단계: 스타일 이름 "개요 n"(engName "Outline n") 또는 문단 모양의 개요 수준(heading type="OUTLINE" level)
  const styleLv = new Map<string, number>();
  const paraLv = new Map<string, number>();
  const header = await read('Contents/header.xml');
  if (header) {
    let pp: string | null = null;
    for (const tk of xmlTokens(header)) {
      if (tk.t === 'open' && tk.name === 'style') {
        const m = /(?:outline|개요)\s*(\d)/i.exec((attr(tk, 'engName') || '') + ' ' + (attr(tk, 'name') || ''));
        const id = attr(tk, 'id');
        if (m && id != null) styleLv.set(id, Math.min(6, +m[1] + 1));
      } else if (tk.t === 'open' && tk.name === 'paraPr') pp = tk.self ? null : attr(tk, 'id') ?? null;
      else if (tk.t === 'close' && tk.name === 'paraPr') pp = null;
      else if (tk.t === 'open' && tk.name === 'heading' && pp != null && /^outline$/i.test(attr(tk, 'type') || '')) paraLv.set(pp, Math.min(6, +(attr(tk, 'level') || 0) + 2));
    }
  }
  const c = collector(o);
  for (const s of sections) {
    const xml = await read(s);
    if (xml == null) continue;
    let para: Para | null = null;
    let inText = false;
    /** 표는 단락(의 글 조각) 안에 든다 — 표 안 단락이 끝나면 바깥 단락으로 돌아간다 */
    const stack: (Para | null)[] = [];
    for (const tk of xmlTokens(xml)) {
      if (tk.t === 'open') {
        if (tk.name === 'p') {
          stack.push(para);
          para = { text: '', level: styleLv.get(attr(tk, 'styleIDRef') || '') || paraLv.get(attr(tk, 'paraPrIDRef') || '') || 0, list: 0, img: 0 };
          if (tk.self) { c.para(para); para = stack.pop() ?? null; }
        } else if (tk.name === 't') inText = !tk.self;
        else if (tk.name === 'tab' && para) para.text += '\t';
        else if (tk.name === 'lineBreak' && para) para.text += '\n';
        else if (tk.name === 'pic' && para) para.img++;
        else if (tk.name === 'tbl') c.openTable();
        else if (tk.name === 'tr') c.openRow();
        else if (tk.name === 'tc') c.openCell();
      } else if (tk.t === 'close') {
        if (tk.name === 't') inText = false;
        else if (tk.name === 'p' && para) { c.para(para); para = stack.pop() ?? null; }
        else if (tk.name === 'tc') c.closeCell();
        else if (tk.name === 'tr') c.closeRow();
        else if (tk.name === 'tbl') c.closeTable();
      } else if (inText && para) para.text += tk.text || '';
    }
  }
  return c.out.join('\n\n') + '\n';
}

// ---- Jupyter

/** 노트북 → 마크다운: 마크다운 칸은 그대로, 코드 칸은 코드 블록, 출력은 글만(그림은 표시만) */
export function notebookText(json: string, o: DeriveOptions = {}): string {
  let nb: { cells?: unknown[]; metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } } };
  try { nb = JSON.parse(json.replace(/^\uFEFF/, '')); } catch { throw new DeriveError('broken', 'JSON 이 아닙니다'); }
  const lang = nb.metadata?.language_info?.name || nb.metadata?.kernelspec?.language || '';
  const src = (v: unknown) => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n');
  const en = o.locale === 'en';
  const out: string[] = [];
  for (const c of Array.isArray(nb.cells) ? nb.cells : []) {
    const cell = (c && typeof c === 'object' ? c : {}) as { cell_type?: string; source?: unknown; outputs?: unknown[] };
    const s = src(cell.source).replace(/\s+$/, '');
    if (cell.cell_type === 'markdown') { if (s) out.push(s); continue; }
    if (cell.cell_type === 'raw') { if (s) { const f = fence(s); out.push(f + '\n' + s + '\n' + f); } continue; }
    if (cell.cell_type !== 'code') continue;
    if (s) { const f = fence(s); out.push(f + lang + '\n' + s + '\n' + f); }
    const texts: string[] = [];
    let imgs = 0;
    for (const x of Array.isArray(cell.outputs) ? cell.outputs : []) {
      const op = (x && typeof x === 'object' ? x : {}) as { output_type?: string; text?: unknown; data?: Record<string, unknown>; ename?: string; evalue?: string };
      if (op.output_type === 'stream') texts.push(src(op.text));
      else if (op.output_type === 'error') texts.push(`${op.ename || 'Error'}: ${op.evalue || ''}`);
      else if (op.data) {
        if (Object.keys(op.data).some((k) => k.startsWith('image/'))) imgs++;
        if (op.data['text/plain'] != null) texts.push(src(op.data['text/plain']));
      }
    }
    const t = texts.join('\n').replace(/\s+$/, '');
    if (t) { const shown = t.length > 2000 ? t.slice(0, 2000) + '\n…' : t; const f = fence(shown); out.push((en ? 'Output:' : '출력:') + '\n\n' + f + 'text\n' + shown + '\n' + f); }
    if (imgs) out.push(imageMark(o) + (imgs > 1 ? ' ×' + imgs : ''));
  }
  return out.join('\n\n') + '\n';
}
