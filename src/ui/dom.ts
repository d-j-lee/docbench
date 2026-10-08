/** 작은 DOM 도구 */
type Attrs = Record<string, unknown> | null | undefined;
type Kid = Node | string | number | false | null | undefined | Kid[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = String(v);
      else if (k === 'text') e.textContent = String(v);
      else if (k === 'html') e.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(e, kids);
  return e;
}

function append(e: Node, kids: Kid[]): void {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(e, k);
    else e.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode): T | null => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode): T[] => Array.from(root.querySelectorAll(sel)) as T[];

export const CARET = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function icon(name: 'caret' | 'close' | 'edit' | 'chat' | 'spark'): string {
  switch (name) {
    case 'caret': return CARET;
    case 'close': return '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    case 'edit': return '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 11.5l.6-2.6 6.4-6.4 2 2-6.4 6.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    case 'chat': return '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 3.5h10v6H6l-3 2.2V9.5H2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    case 'spark': return '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5l1.3 3.7 3.7 1.3-3.7 1.3L7 11.5 5.7 7.8 2 6.5l3.7-1.3z" fill="currentColor"/></svg>';
  }
}

export const fmtBytes = (n?: number | null): string =>
  n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

/** 시각을 보는 사람 기준 'YYYY-MM-DD HH:MM' */
export function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function relTime(iso: string | undefined, t: (k: string, v?: Record<string, unknown>) => string): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hour', { n: Math.floor(s / 3600) });
  return fmtTime(iso).slice(5, 10);
}

export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
