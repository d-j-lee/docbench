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

export type IconName = 'caret' | 'close' | 'edit' | 'chat' | 'spark' | 'folder' | 'folderOpen' | 'doc' | 'history' | 'map' | 'refresh' | 'copy' | 'check' | 'stop' | 'clock' | 'warn' | 'eye' | 'pin' | 'file' | 'user' | 'plug' | 'down' | 'plus';

export function icon(name: IconName): string {
  const s = (d: string, vb = '0 0 14 14') => `<svg viewBox="${vb}" aria-hidden="true">${d}</svg>`;
  const st = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
  switch (name) {
    case 'caret': return CARET;
    case 'close': return '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    case 'edit': return '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 11.5l.6-2.6 6.4-6.4 2 2-6.4 6.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    case 'chat': return '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 3.5h10v6H6l-3 2.2V9.5H2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    case 'spark': return '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5l1.3 3.7 3.7 1.3-3.7 1.3L7 11.5 5.7 7.8 2 6.5l3.7-1.3z" fill="currentColor"/></svg>';
    case 'folder': return s(`<path d="M1.8 3.5h3.6l1.2 1.4h5.6v6.6H1.8z" ${st}/>`);
    case 'folderOpen': return s(`<path d="M1.8 11.5V3.5h3.6l1.2 1.4h4.6v1.6M1.8 11.5l1.6-4.8h9l-1.6 4.8z" ${st}/>`);
    case 'doc': return s(`<path d="M3.2 1.8h5l2.6 2.6v7.8H3.2zM8.2 1.8v2.6h2.6M5 7.2h4M5 9.4h4" ${st}/>`);
    case 'history': return s(`<path d="M2.2 7a4.8 4.8 0 1 0 1.4-3.4M2 2.2v2.4h2.4M7 4.4V7l1.8 1.2" ${st}/>`);
    case 'map': return s(`<path d="M1.8 3.2l3.4-1.2 3.6 1.2 3.4-1.2v8.8l-3.4 1.2-3.6-1.2-3.4 1.2zM5.2 2v8.8M8.8 3.2V12" ${st}/>`);
    case 'refresh': return s(`<path d="M11.6 6.2A4.7 4.7 0 0 0 3 4.4M2.4 7.8A4.7 4.7 0 0 0 11 9.6M3 1.8v2.6h2.6M11 12.2V9.6H8.4" ${st}/>`);
    case 'copy': return s(`<path d="M4.6 4.6h7v7.6h-7zM2.4 9.4V1.8h7" ${st}/>`);
    case 'check': return s(`<path d="M2.6 7.4l2.8 2.8 6-6.4" ${st}/>`);
    case 'stop': return s(`<rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.2" fill="currentColor"/>`);
    case 'clock': return s(`<circle cx="7" cy="7" r="5.2" ${st}/><path d="M7 4v3.2l2 1.2" ${st}/>`);
    case 'warn': return s(`<path d="M7 1.8l5.6 10H1.4zM7 5.6v3M7 10.2v.1" ${st}/>`);
    case 'eye': return s(`<path d="M1.2 7S3.2 3 7 3s5.8 4 5.8 4-2 4-5.8 4S1.2 7 1.2 7z" ${st}/><circle cx="7" cy="7" r="1.6" ${st}/>`);
    case 'pin': return s(`<path d="M5.2 1.8h3.6l-.5 3.4 2 2H3.7l2-2zM7 7.2v5" ${st}/>`);
    case 'file': return s(`<path d="M3.2 1.8h5l2.6 2.6v7.8H3.2zM8.2 1.8v2.6h2.6" ${st}/>`);
    case 'user': return s(`<circle cx="7" cy="4.8" r="2.4" ${st}/><path d="M2.4 12.2c.6-2.4 2.4-3.6 4.6-3.6s4 1.2 4.6 3.6" ${st}/>`);
    case 'plug': return s(`<path d="M4.6 1.8v2.6M9.4 1.8v2.6M3.2 4.4h7.6v2.2a3.8 3.8 0 0 1-7.6 0zM7 10.4v1.8" ${st}/>`);
    case 'down': return s(`<path d="M3.4 5.4L7 9l3.6-3.6" ${st}/>`);
    case 'plus': return s(`<path d="M7 2.6v8.8M2.6 7h8.8" ${st}/>`);
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
