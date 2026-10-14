/**
 * 형식마다 문서 본문 그리기 (D87) — 마크다운·뽑은 글은 마크다운으로, 구조 글(YAML·JSON·TOML·INI·AsciiDoc·rST·Org)은
 * 원문 그대로 색을 입혀 **원문 제목마다 섹션**으로, 글·코드·로그는 줄 번호와 함께, CSV·TSV 는 표로, HTML 은 정제해 읽기 화면으로,
 * SVG·그림은 그림으로, PDF·오피스 원본은 내려받기 카드로.
 *
 * 섹션 키 패리티: 구조 글의 화면 제목(data-md)은 core/source headsOf 의 제목 그대로 만든다 — sectionize 가 원문과 같은 키를 낸다.
 * 화면 글자(textContent)는 원문 글자와 같다(색은 태그만 씌운다) — 문구 인용을 원문에서 다시 찾을 수 있게.
 */
import type { DocContent } from '../types';
import { formatFor, type FormatSpec } from '../core/formats';
import { headsOf } from '../core/source';
import { resolveRelative } from '../core/overview';
import { renderMarkdown, sanitize } from './render';
import { highlightLines } from './highlight';
import { h, icon, fmtBytes } from './dom';
import type { T } from './i18n';

export interface ViewerCtx {
  t: T;
  /** 작업 공간 파일의 바이트 (그림·내려받기). 없으면 그림을 이어 보이지 않는다 */
  loadBytes?: (id: string) => Promise<Blob | null>;
  /** 표·HTML·SVG 를 원문으로 */
  source?: boolean;
}

/** 표로 그리는 최대 행·열 — 넘으면 앞부분만(원문 보기로 전부) */
export const TABLE_MAX_ROWS = 2000;
export const TABLE_MAX_COLS = 60;

/** 이 문서 화면이 만든 Blob 주소 — 문서를 닫을 때 놓는다 */
const URLS = new WeakMap<Element, string[]>();
function keepUrl(root: Element, url: string): string { (URLS.get(root) || URLS.set(root, []).get(root)!).push(url); return url; }
export function releaseDoc(root: Element | null | undefined): void {
  if (!root) return;
  for (const u of URLS.get(root) || []) { try { URL.revokeObjectURL(u); } catch { /* 이미 놓음 */ } }
  URLS.delete(root);
}

/** 원문 보기가 있는 형식 (표·HTML·SVG — 섹션이 없어 화면을 바꿔도 피드백 자리가 바뀌지 않는다) */
export const hasSourceToggle = (f: FormatSpec): boolean => f.view === 'table' || f.view === 'html' || f.view === 'svg';

/** 문서 본문 — .db-md 상자. 섹션(제목 data-md)은 sectionize 가 나눈다 */
export function renderDoc(c: DocContent, ctx: ViewerCtx): HTMLDivElement {
  const f = formatFor(c.format ? fakeName(c.format, c.id) : c.id);
  let div: HTMLDivElement;
  if (f.kind === 'binary') div = binaryView(c, f, ctx);
  else if (f.kind === 'derived' && (c.deriveError || !c.md)) { div = document.createElement('div'); }
  else if (f.kind === 'markdown' || f.kind === 'derived') div = renderMarkdown(c.md, { localImages: !!ctx.loadBytes });
  else if (f.kind === 'outline') div = outlineView(c.md, c.id, f);
  else if (ctx.source && hasSourceToggle(f)) div = sourceView(c.md, f.lang);
  else if (f.view === 'table') div = tableView(c.md, f.id === 'tsv' ? '\t' : sniffSep(c.md), ctx);
  else if (f.view === 'html') div = htmlView(c.md, ctx);
  else if (f.view === 'svg') div = svgView(c.md, ctx);
  else if (f.view === 'plain') div = plainView(c.md);
  else div = sourceView(c.md, f.lang);
  div.classList.add('db-md');
  div.dataset.view = ctx.source && hasSourceToggle(f) ? 'source' : f.view;
  if (ctx.loadBytes) resolveImages(div, c.id, ctx.loadBytes);
  return div;
}

/** 저장소가 형식 이름만 줄 때(확장자 없는 id) — 그 형식의 대표 확장자로 */
function fakeName(format: string, id: string): string {
  if (/\.[\w]+$/.test(id.split('/').pop() || '')) return id;
  const ext: Record<string, string> = { yaml: 'yaml', json: 'json', toml: 'toml', ini: 'ini', asciidoc: 'adoc', rst: 'rst', org: 'org', text: 'txt', csv: 'csv', tsv: 'tsv', html: 'html', svg: 'svg', log: 'log' };
  return ext[format] ? 'x.' + ext[format] : id;
}

// ---------------------------------------------------------------- 원문(줄 번호)

/** 원문 한 덩어리 — 줄마다 span(번호는 CSS 카운터, 글자가 아니다). from = 첫 줄 번호 */
function codeBlock(lines: string[], from: number, wrap = false): HTMLPreElement {
  const pre = h('pre', { class: 'db-src' + (wrap ? ' wrap' : ''), style: `counter-reset: ln ${from - 1}` });
  const code = h('code');
  code.innerHTML = lines.map((l) => `<span class="ln">${l}</span>`).join('\n');
  pre.append(code);
  return pre;
}

/** 줄 끝 빈 줄 하나(파일 끝 줄바꿈)는 줄로 세지 않는다 */
function splitLines(text: string): string[] {
  const ls = text.split('\n');
  if (ls.length > 1 && ls[ls.length - 1] === '') ls.pop();
  return ls;
}

function sourceView(text: string, lang?: string): HTMLDivElement {
  const div = document.createElement('div');
  const html = highlightLines(text, lang);
  if (html.length > 1 && html[html.length - 1] === '' && text.endsWith('\n')) html.pop();
  div.append(codeBlock(html, 1));
  return div;
}

/** 글(.txt) — 줄을 접어(wrap) 읽기 좋게, 번호 없이 */
function plainView(text: string): HTMLDivElement {
  const div = document.createElement('div');
  const pre = h('pre', { class: 'db-src wrap plain' }, h('code', { text: text.endsWith('\n') ? text.slice(0, -1) : text }));
  div.append(pre);
  return div;
}

/**
 * 구조 글: 원문 제목마다 data-md 제목 + 그 제목에서 다음 제목 앞까지의 원문(색·줄 번호). 첫 제목 앞(머리말)은 제목 없이.
 * 색은 문서 전체를 한 번에 입힌 뒤 줄로 나눈다(여러 줄 주석·글이 덩어리 경계를 넘어도 맞게)
 */
function outlineView(md: string, id: string, f: FormatSpec): HTMLDivElement {
  const div = document.createElement('div');
  const heads = headsOf(md, id);
  const prose = f.group === 'doc';
  const lines = highlightLines(md, f.lang);
  // 오프셋 → 줄 번호(0부터)
  const starts: number[] = [0];
  for (let i = 0; i < md.length; i++) if (md.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (off: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo; };
  const total = md.endsWith('\n') ? starts.length - 1 : starts.length;
  const chunk = (a: number, b: number) => { if (b > a) div.append(codeBlock(lines.slice(a, b), a + 1, prose)); };
  const first = heads.length ? lineOf(heads[0].start) : total;
  chunk(0, first);
  heads.forEach((hd, i) => {
    const a = lineOf(hd.start);
    const b = i + 1 < heads.length ? lineOf(heads[i + 1].start) : total;
    const level = Math.min(6, Math.max(1, hd.level));
    div.append(h(`h${level}` as 'h2', { 'data-md': '', class: 'db-okey', text: hd.title }));
    // 원문이 섹션 끝을 정하면(YAML 아래 키의 블록·JSON 값) 그 뒤는 위 섹션의 글 — 섹션 끝 표시로 감싸 sectionize 가 위로 돌려놓는다
    const e = hd.end != null && hd.end < md.length ? lineOf(hd.end) : b;
    if (e > a && e < b) {
      chunk(a, e);
      const rest = h('div', { 'data-sec-end': String(level), class: 'db-sec-rest' });
      rest.append(codeBlock(lines.slice(e, b), e + 1, prose));
      div.append(rest);
    } else chunk(a, Math.max(b, a + 1));
  });
  return div;
}

// ---------------------------------------------------------------- 표

/** 쉼표·세미콜론 중 첫 줄에 많은 것 (유럽식 CSV 는 ;) */
function sniffSep(text: string): string {
  const line = text.slice(0, text.indexOf('\n') >>> 0);
  const c = (line.match(/,/g) || []).length, s = (line.match(/;/g) || []).length;
  return s > c ? ';' : ',';
}

/** RFC 4180 — 따옴표 안의 쉼표·줄바꿈, "" 는 " */
export function parseDelimited(text: string, sep: string, maxRows = TABLE_MAX_ROWS): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    let cell = '';
    if (text[i] === '"') {
      i++;
      while (i < n) {
        if (text[i] === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } i++; break; }
        cell += text[i++];
      }
      while (i < n && text[i] !== sep && text[i] !== '\n') cell += text[i++];
    } else {
      while (i < n && text[i] !== sep && text[i] !== '\n') cell += text[i++];
    }
    row.push(cell.replace(/\r$/, ''));
    if (text[i] === sep) { i++; if (i === n) row.push(''); continue; }
    i++;
    rows.push(row);
    row = [];
    if (rows.length >= maxRows) return { rows, more: i < n };
  }
  if (row.length) rows.push(row);
  return { rows, more: false };
}

function tableView(text: string, sep: string, ctx: ViewerCtx): HTMLDivElement {
  const div = document.createElement('div');
  const { rows, more } = parseDelimited(text, sep);
  if (!rows.length) { div.append(h('p', { class: 'db-hint', text: ctx.t('view.table.empty') })); return div; }
  const cols = Math.min(TABLE_MAX_COLS, Math.max(...rows.map((r) => r.length)));
  const numeric = (s: string) => /^\s*[-+]?[\d,]*\.?\d+(e[-+]?\d+)?\s*%?\s*$/i.test(s);
  const t = h('table', { class: 'db-csv' });
  const head = h('tr', {}, h('th', { class: 'rn db-noindex', 'aria-hidden': 'true' }));
  for (let c = 0; c < cols; c++) head.append(h('th', { text: rows[0][c] ?? '' }));
  t.append(h('thead', {}, head));
  const body = h('tbody');
  for (let r = 1; r < rows.length; r++) {
    const tr = h('tr', {}, h('td', { class: 'rn db-noindex', 'aria-hidden': 'true', text: r }));
    for (let c = 0; c < cols; c++) { const v = rows[r][c] ?? ''; tr.append(h('td', { class: numeric(v) ? 'num' : null, text: v })); }
    body.append(tr);
  }
  t.append(body);
  div.append(h('p', { class: 'db-view-note db-noindex', text: ctx.t('view.table.size', { rows: rows.length - 1, cols }) + (more || cols < Math.max(...rows.map((r) => r.length)) ? ' · ' + ctx.t('view.table.more') : '') }), t);
  return div;
}

// ---------------------------------------------------------------- HTML · SVG

/** HTML 읽기 화면 — 스크립트·스타일·폼·끼운 창은 지우고 글·표·그림·링크만. 문서의 class·id·data-* 는 화면 규칙과 겹치지 않게 뗀다 */
function htmlView(text: string, ctx: ViewerCtx): HTMLDivElement {
  const div = document.createElement('div');
  const body = /<body[^>]*>([\s\S]*?)(<\/body>|$)/i.exec(text);
  div.innerHTML = sanitize(body ? body[1] : text, {
    FORBID_TAGS: ['style', 'link', 'meta', 'base', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'frame', 'frameset', 'object', 'embed', 'audio', 'video', 'source', 'track', 'canvas', 'template', 'svg', 'math'],
    FORBID_ATTR: ['style', 'class', 'id', 'name', 'srcset', 'action', 'formaction', 'background', 'ping'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
  }, { localImages: !!ctx.loadBytes });
  div.classList.add('db-html');
  return div;
}

/** SVG — <img> 로(스크립트·바깥 불러오기가 돌지 않는다) */
function svgView(text: string, ctx: ViewerCtx): HTMLDivElement {
  const div = document.createElement('div');
  const fig = h('figure', { class: 'db-figure' });
  const img = h('img', { alt: ctx.t('view.image'), class: 'db-img' }) as HTMLImageElement;
  img.src = keepUrl(div, URL.createObjectURL(new Blob([safeSvg(text)], { type: 'image/svg+xml' })));
  fig.append(img);
  div.append(fig);
  return div;
}

// ---------------------------------------------------------------- 그림 · 내려받기 카드

function binaryView(c: DocContent, f: FormatSpec, ctx: ViewerCtx): HTMLDivElement {
  const div = document.createElement('div');
  if (f.view === 'image') {
    const fig = h('figure', { class: 'db-figure' });
    const img = h('img', { alt: c.id.split('/').pop() || '', class: 'db-img' }) as HTMLImageElement;
    const cap = h('figcaption', { class: 'db-hint db-noindex', text: ctx.t('doc.loading') });
    fig.append(img, cap);
    div.append(fig);
    if (!ctx.loadBytes) { cap.textContent = ctx.t('view.noBytes'); return div; }
    void ctx.loadBytes(c.id).then((b) => {
      if (!b) { cap.textContent = ctx.t('view.tooBig'); return; }
      img.onload = () => { cap.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${fmtBytes(b.size)}`; };
      img.onerror = () => { cap.textContent = ctx.t('view.imageFail'); };
      img.src = keepUrl(div, URL.createObjectURL(b));
    }).catch(() => { cap.textContent = ctx.t('view.imageFail'); });
    return div;
  }
  div.append(fileCard(c, f, ctx, div));
  return div;
}

/** 원본 파일 카드 — 이름·형식·크기 + 내려받기 */
export function fileCard(c: DocContent, f: FormatSpec, ctx: ViewerCtx, owner: Element): HTMLElement {
  const name = c.id.split('/').pop() || c.id;
  return h('div', { class: 'db-filecard db-noindex' },
    h('span', { class: 'ic', html: icon(groupIcon(f.group)) }),
    h('div', { class: 't' }, h('b', { text: name }), h('small', { text: [f.label, c.binary?.size != null ? fmtBytes(c.binary.size) : ''].filter(Boolean).join(' · ') })),
    ctx.loadBytes ? downloadButton(c.id, ctx, owner) : null);
}

/** 원본 내려받기 단추 */
export function downloadButton(id: string, ctx: ViewerCtx, owner: Element, label?: string): HTMLButtonElement {
  return h('button', {
    class: 'db-btn sm', type: 'button', html: icon('down') + ' ',
    onclick: async (e: Event) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const b = await ctx.loadBytes!(id);
        if (!b) { btn.title = ctx.t('view.tooBig'); return; }
        const a = h('a', { href: keepUrl(owner, URL.createObjectURL(b)), download: id.split('/').pop() || 'file' });
        document.body.append(a); a.click(); a.remove();
      } finally { btn.disabled = false; }
    },
  }, label || ctx.t('view.download')) as HTMLButtonElement;
}

export function groupIcon(g: string): 'doc' | 'file' | 'image' | 'table' | 'code' | 'pdf' | 'office' {
  return g === 'doc' ? 'doc' : g === 'image' ? 'image' : g === 'data' ? 'table' : g === 'code' ? 'code' : g === 'pdf' ? 'pdf' : g === 'office' ? 'office' : 'file';
}

/**
 * SVG 를 그림으로 내기 전에 정제한다 — <img> 로는 스크립트가 돌지 않지만, 사람이 "새 탭에서 그림 열기"를 하면 그 Blob 은
 * 이 화면의 출처에서 문서로 열린다(독립 검토). 스크립트·이벤트 속성·바깥 참조를 지운 SVG 만 Blob 으로
 */
export function safeSvg(text: string): string {
  return sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject', 'style'], FORBID_ATTR: ['style'] });
}

// ---------------------------------------------------------------- 상대 경로 그림

/** data-db-src 그림을 작업 공간 파일로 이어 Blob 으로 (못 읽으면 대체 글) */
export function resolveImages(root: HTMLElement, docId: string, loadBytes: (id: string) => Promise<Blob | null>): void {
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img[data-db-src]'))) {
    const p = resolveRelative(docId, img.getAttribute('data-db-src') || '');
    if (!p || p.endsWith('/')) continue;
    void loadBytes(p).then(async (b) => {
      if (!b) { img.classList.add('db-img-miss'); return; }
      // SVG 는 정제한 글로(위 safeSvg), 나머지 그림은 바이트 그대로
      const blob = /\.svg$/i.test(p) ? new Blob([safeSvg(await b.text())], { type: 'image/svg+xml' }) : b;
      img.src = keepUrl(root, URL.createObjectURL(blob));
    })
      .catch(() => img.classList.add('db-img-miss'));
  }
}
