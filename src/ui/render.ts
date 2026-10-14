/**
 * 문서 그리기 — 정제(DOMPurify) · 장식(표·링크·근거 칩·빈칸·이름표) · 섹션 나누기.
 */
import DOMPurify from 'dompurify';
import { toHTML, norm } from '../core/markdown';
import { KEY_SEP } from '../core/source';
import type { RenderRules, Tone } from '../types';
import { h, CARET } from './dom';

export const DEFAULT_RULES: Required<RenderRules> = {
  // 근거 표기 — 한국어는 뒤에 무엇이 붙어도([실측 9/29]), 영어는 낱말로만([measured 9/29] · [documented] — [docs/a] 같은 글은 아니다)
  tags: [
    { pattern: '\\[(?:실측|measured\\b)[^\\]]*\\]', tone: 'good' },
    { pattern: '\\[(?:문서|확인|documented\\b|verified\\b|confirmed\\b)[^\\]]*\\]', tone: 'info' },
    { pattern: '\\[(?:조사|researched\\b)[^\\]]*\\]', tone: 'neutral' },
    { pattern: '\\[(?:추정|estimated?\\b|assumed\\b)[^\\]]*\\]', tone: 'warn' },
    { pattern: '\\[(?:미확인|unverified\\b|unconfirmed\\b)[^\\]]*\\]', tone: 'bad' },
  ],
  placeholders: ['\\[\\(?(작업 후 기입|코드 확인|결정 대기|확인 필요)[^\\]]*\\]', '\\b(TODO|TBD|FIXME)\\b'],
  labelMinRepeat: 3,
};

export interface Compiled {
  tags: { re: RegExp; tone: Tone }[];
  placeholder: RegExp | null;
  /** 본문 글자에서 칩·빈칸을 한 번에 찾는 식 (빈칸 우선) */
  inline: RegExp | null;
  labelMinRepeat: number;
}

const any = (srcs: string[]) => (srcs.length ? srcs.map((p) => '(?:' + p + ')').join('|') : '');

export function compileRules(r?: RenderRules): Compiled {
  const tagSrc = (r?.tags ?? DEFAULT_RULES.tags);
  const tags = tagSrc.map((t) => ({ re: new RegExp('^(?:' + t.pattern + ')+$'), tone: t.tone }));
  const ph = r?.placeholders ?? DEFAULT_RULES.placeholders;
  const inline = any([any(ph), any(tagSrc.map((t) => t.pattern))].filter(Boolean));
  return {
    tags,
    placeholder: ph.length ? new RegExp(any(ph), 'g') : null,
    inline: inline ? new RegExp(inline, 'g') : null,
    labelMinRepeat: r?.labelMinRepeat ?? DEFAULT_RULES.labelMinRepeat,
  };
}

/** 빈칸이 먼저다: `[확인 필요]` 는 '확인' 칩이 아니라 채울 빈칸 */
function classify(txt: string, c: Compiled): { todo: true } | { tone: Tone } | null {
  if (c.placeholder && new RegExp('^(?:' + c.placeholder.source + ')$').test(txt)) return { todo: true };
  const hit = c.tags.find((t) => t.re.test(txt));
  return hit ? { tone: hit.tone } : null;
}

/**
 * 문서 안 상대 경로 그림(`![](img/a.png)`)은 주소를 data-db-src 로 옮겨 둔다 — 그대로 두면 화면 주소 기준으로 읽으려다
 * 막히거나(단일 HTML CSP) 엉뚱한 곳을 부른다. 문서 화면이 작업 공간 파일로 이어 Blob 으로 보인다(viewers.resolveImages).
 * 바이트를 내주는 저장소(loadBytes)가 있을 때만 — 없으면 예전처럼(호스트가 같은 상대 주소로 그림을 내줄 수 있다)
 */
let localImages = false;
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!localImages || node.nodeName !== 'IMG') return;
  const el = node as Element;
  const src = (el.getAttribute('src') || '').trim();
  el.removeAttribute('srcset');
  if (src && !/^(data:|blob:|https?:|\/\/)/i.test(src)) { el.setAttribute('data-db-src', src); el.removeAttribute('src'); }
});

/** 정제 — localImages 면 상대 경로 그림을 data-db-src 로 (위) */
export function sanitize(html: string, cfg: Record<string, unknown>, o: { localImages?: boolean } = {}): string {
  localImages = !!o.localImages;
  try { return DOMPurify.sanitize(html, cfg) as unknown as string; } finally { localImages = false; }
}

/** 마크다운을 정제된 DOM 조각으로 */
export function renderMarkdown(md: string, o: { localImages?: boolean } = {}): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = sanitize(toHTML(md), { ADD_ATTR: ['target'] }, o);
  return div;
}

/** 코드 밖 빈칸 표기 수 (화면을 그리지 않고 셀 때) */
export function countPlaceholders(md: string, c: Compiled): number {
  if (!c.placeholder) return 0;
  const text = md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return (text.match(c.placeholder) || []).length;
}

export function decorate(root: HTMLElement, c: Compiled): void {
  for (const t of Array.from(root.querySelectorAll('table'))) {
    const w = h('div', { class: 'db-tw', tabindex: '0' });
    t.replaceWith(w);
    w.append(t);
  }
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  }
  // 인라인 코드로 쓴 근거 표기·빈칸: `[실측]`
  for (const code of Array.from(root.querySelectorAll('code'))) {
    if (code.closest('pre')) continue;
    const k = classify((code.textContent || '').trim(), c);
    if (k) code.classList.add('db-tag', 'todo' in k ? 'tone-todo' : 'tone-' + k.tone);
  }
  // 본문 글자로 쓴 근거 표기·빈칸: [실측], [작업 후 기입], TODO
  if (c.inline) {
    const re = new RegExp(c.inline.source, 'g');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if ((n.parentElement as Element).closest('code,pre,mark,.db-tag')) return NodeFilter.FILTER_REJECT;
        re.lastIndex = 0;
        return re.test((n as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0; let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(n.data))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const k = classify(m[0], c);
        if (!k) continue;
        frag.append(n.data.slice(last, m.index), 'todo' in k ? h('mark', { class: 'db-todo', text: m[0] }) : h('span', { class: 'db-tag tone-' + k.tone, text: m[0] }));
        last = m.index + m[0].length;
      }
      frag.append(n.data.slice(last));
      n.replaceWith(frag);
    }
  }
  // 이름표 줄: 목록 항목이 굵은 글씨 + 쌍점으로 시작
  for (const li of Array.from(root.querySelectorAll('li'))) {
    const host = li.firstElementChild && li.firstElementChild.tagName === 'P' ? li.firstElementChild : li;
    const f = host.firstElementChild;
    if (!f || f.tagName !== 'STRONG') continue;
    const first = host.firstChild;
    if (!(first === f || (first && first.nodeType === 3 && !(first as Text).data.trim() && first.nextSibling === f))) continue;
    const after = f.nextSibling;
    const raw = (f.textContent || '').trim();
    if ((after && after.nodeType === 3 && /^\s*[:：]/.test((after as Text).data)) || /[:：]$/.test(raw)) {
      const label = norm(raw).replace(/[:：]$/, '');
      if (label.length <= 16) (li as HTMLElement).dataset.label = label;
    }
  }
}

export interface Section {
  el: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  heading: HTMLElement;
  key: string;
  path: string[];
  title: string;
  level: number;
  index: number;
}

/** 최상위 제목마다 <section> 으로 감싸 접을 수 있게 한다. 키 규칙은 core/source.ts 와 같다 */
export function sectionize(root: HTMLElement): Section[] {
  const nodes = Array.from(root.childNodes);
  root.textContent = '';
  const stack: { level: number; body: HTMLElement; path: string[] }[] = [{ level: 0, body: root, path: [] }];
  const seen = new Map<string, number>();
  const secs: Section[] = [];
  for (const n of nodes) {
    // 섹션 끝 표시(구조 글 — 원문이 섹션 끝을 정할 때, D87): 그 단계 이상의 섹션을 닫고 나머지는 위 섹션 본문으로.
    // 키를 바꾸지 않는다(제목만 키를 만든다). 문서 HTML 에서는 data-* 를 지우므로 화면 그리기(viewers)만 만든다
    if (n.nodeType === 1 && (n as Element).hasAttribute('data-sec-end')) {
      const lv = Number((n as Element).getAttribute('data-sec-end')) || 1;
      while (stack.length > 1 && stack[stack.length - 1].level >= lv) stack.pop();
      stack[stack.length - 1].body.append(n);
      continue;
    }
    // 마크다운 제목(data-md)만 섹션을 연다 — 문서에 직접 쓴 HTML 제목은 본문으로 둔다
    const m = n.nodeType === 1 && (n as Element).hasAttribute('data-md') ? /^H([1-6])$/.exec((n as Element).tagName) : null;
    if (!m) { stack[stack.length - 1].body.append(n); continue; }
    const level = +m[1];
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    const title = norm(n.textContent);
    const path = parent.path.concat(title);
    let key = path.join(KEY_SEP);
    const c = (seen.get(key) || 0) + 1;
    seen.set(key, c);
    if (c > 1) key += ' #' + c;
    const el = h('section', { class: 'db-sec', 'data-level': level, 'data-key': key, 'data-collapsed': 'false' });
    const head = h('div', { class: 'db-sec-head' });
    const body = h('div', { class: 'db-sec-body' });
    const caret = h('button', { class: 'db-caret', type: 'button', 'aria-expanded': 'true', 'aria-label': 'toggle', html: CARET });
    if (level === 1) caret.hidden = true;
    const side = h('span', { class: 'db-sec-side' },
      h('span', { class: 'db-sec-sum' }),
      h('span', { class: 'db-sec-badges' }),
      h('span', { class: 'db-sec-acts' }));
    head.append(caret, n, side);
    el.append(head, body);
    parent.body.append(el);
    secs.push({ el, head, body, heading: n as HTMLElement, key, path, title, level, index: secs.length });
    stack.push({ level, body, path });
  }
  return secs;
}

/** 공백 정규화 텍스트와 원래 텍스트 노드 위치의 대응표 */
export function textIndex(root: Element): { s: string; map: [Text, number][] } {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement as Element).closest('.db-sec-side,button,.db-noindex') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let s = '';
  const map: [Text, number][] = [];
  let prevSpace = true;
  while (w.nextNode()) {
    const n = w.currentNode as Text;
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (/\s/.test(ch)) { if (prevSpace) continue; s += ' '; map.push([n, i]); prevSpace = true; }
      else { s += ch; map.push([n, i]); prevSpace = false; }
    }
  }
  return { s, map };
}

/**
 * 고른 범위(Range)가 textIndex 글의 어디인가 — 앞뒤 공백은 뺀다. 범위 안의 문서 글자가 없으면 null.
 * Selection.toString() 대신 이것을 쓴다: 그쪽은 제목 옆 단추·지운 글 표시처럼 문서 글자가 아닌 것까지 담는다.
 */
export function selectedSpan(idx: { s: string; map: [Text, number][] }, rg: Range): { text: string; start: number; end: number; exact: string } | null {
  let a = boundaryAt(idx.map, rg.startContainer, rg.startOffset);
  let b = boundaryAt(idx.map, rg.endContainer, rg.endOffset);
  while (a < b && idx.s[a] === ' ') a++;
  while (b > a && idx.s[b - 1] === ' ') b--;
  return a < b ? { text: idx.s, start: a, end: b, exact: idx.s.slice(a, b) } : null;
}

/** 경계(노드·오프셋) 바로 뒤에 오는 첫 글자의 자리 — 없으면 map.length. map 은 문서 순서 */
function boundaryAt(map: [Text, number][], c: Node, o: number): number {
  const ref = c.nodeType === Node.TEXT_NODE ? null : c.childNodes[o] || null;
  const after = (n: Node): boolean => {
    if (c.nodeType === Node.TEXT_NODE) return !!(c.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (ref) return ref === n || !!(ref.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
    return !c.contains(n) && !!(c.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
  };
  let last: Node | null = null;
  for (let i = 0; i < map.length; i++) {
    const [n, off] = map[i];
    if (n === c) { if (off >= o) return i; continue; }
    if (n !== last) { last = n; if (after(n)) return i; }
  }
  return map.length;
}

/** 정규화 구간 [a,b) 를 텍스트 노드별로 감싼다 */
export function wrapRange(map: [Text, number][], a: number, b: number, make: () => HTMLElement): HTMLElement[] {
  const segs: { n: Text; start: number; end: number }[] = [];
  for (let i = a; i < b && i < map.length; i++) {
    const [n, off] = map[i];
    const last = segs[segs.length - 1];
    if (last && last.n === n && last.end === off) last.end = off + 1;
    else segs.push({ n, start: off, end: off + 1 });
  }
  const out: HTMLElement[] = [];
  for (const sg of segs.reverse()) {
    if (!sg.n.parentNode) continue;
    const r = document.createRange();
    r.setStart(sg.n, sg.start);
    r.setEnd(sg.n, sg.end);
    const mk = make();
    try { r.surroundContents(mk); out.push(mk); } catch { /* 요소 경계를 넘는 조각은 건너뛴다 */ }
  }
  return out;
}
