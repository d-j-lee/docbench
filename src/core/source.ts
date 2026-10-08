/**
 * 섹션 ↔ 원문 위치.
 *
 * 화면의 섹션 키와 원문 범위를 같은 규칙으로 만든다. 그래서 화면에서 고른
 * 섹션을 원문에서 정확히 잘라 고치고, 나머지 글자는 바이트 단위로 그대로 둔다.
 *
 * 키 규칙: 상위 제목부터 현재 제목까지 화면 글자를 ' › ' 로 잇는다.
 * 같은 키가 또 나오면 ' #2', ' #3' 을 붙인다(문서 순서 기준).
 */
import { marked, headingPlain, toLF } from './markdown';

export const KEY_SEP = ' › ';

export interface SectionSource {
  key: string;
  path: string[];
  title: string;
  level: number;
  /** 제목 줄 시작 (LF 기준 오프셋) */
  start: number;
  /** 다음 같은·상위 제목 직전 */
  end: number;
  /** 바로 아래 하위 섹션이 시작되기 전까지 (자기 본문만) */
  bodyEnd: number;
}

const BOX_TAGS = 'details|div|section|article|aside|blockquote|figure|table|nav|main|header|footer|form|fieldset|dl|ul|ol';
const OPEN_RE = new RegExp(`<(${BOX_TAGS})(?=[\\s>/])[^>]*?(/?)>`, 'gi');
const CLOSE_RE = new RegExp(`</(${BOX_TAGS})\\s*>`, 'gi');
/** HTML 조각이 여는 상자 수 − 닫는 상자 수 (주석 안은 빼고) */
function htmlBoxDelta(raw: string): number {
  const s = raw.replace(/<!--[\s\S]*?-->/g, '');
  let open = 0;
  for (const m of s.matchAll(OPEN_RE)) if (m[2] !== '/') open++;
  const close = (s.match(CLOSE_RE) || []).length;
  return open - close;
}

export function sectionSources(mdIn: string): SectionSource[] {
  const md = toLF(mdIn);
  const tokens = marked.lexer(md);
  const heads: { level: number; title: string; start: number }[] = [];
  let off = 0;
  // 열린 HTML 상자(<details> <div> …) 안의 제목은 브라우저가 그 상자 안에 넣는다 → 화면에서 섹션이 아니므로 여기서도 세지 않는다
  let boxDepth = 0;
  for (const t of tokens) {
    if (t.type === 'html') boxDepth = Math.max(0, boxDepth + htmlBoxDelta(t.raw));
    else if (t.type === 'heading' && boxDepth === 0) heads.push({ level: (t as { depth: number }).depth, title: headingPlain((t as { text: string }).text), start: off });
    off += t.raw.length;
  }
  const out: SectionSource[] = [];
  const stack: { level: number; path: string[] }[] = [];
  const seen = new Map<string, number>();
  heads.forEach((hd, i) => {
    while (stack.length && stack[stack.length - 1].level >= hd.level) stack.pop();
    const path = (stack.length ? stack[stack.length - 1].path : []).concat(hd.title);
    let key = path.join(KEY_SEP);
    const c = (seen.get(key) || 0) + 1;
    seen.set(key, c);
    if (c > 1) key += ' #' + c;
    let end = md.length;
    for (let j = i + 1; j < heads.length; j++) if (heads[j].level <= hd.level) { end = heads[j].start; break; }
    const bodyEnd = i + 1 < heads.length ? Math.min(end, heads[i + 1].start) : end;
    out.push({ key, path, title: hd.title, level: hd.level, start: hd.start, end, bodyEnd });
    stack.push({ level: hd.level, path });
  });
  return out;
}

export function findSection(md: string, keyOrPath: string | string[]): SectionSource | null {
  const secs = sectionSources(md);
  if (Array.isArray(keyOrPath)) {
    const k = keyOrPath.join(KEY_SEP);
    return secs.find((s) => s.key === k) || null;
  }
  return secs.find((s) => s.key === keyOrPath) || null;
}

export function getSectionText(md: string, keyOrPath: string | string[]): string | null {
  const lf = toLF(md);
  const s = findSection(lf, keyOrPath);
  return s ? lf.slice(s.start, s.end) : null;
}

/**
 * 섹션 하나를 새 글로 바꾼다. 섹션 끝의 빈 줄 모양은 원래대로 둔다.
 * 키를 못 찾으면 null.
 */
export function replaceSection(md: string, keyOrPath: string | string[], text: string): string | null {
  const lf = toLF(md);
  const s = findSection(lf, keyOrPath);
  if (!s) return null;
  const orig = lf.slice(s.start, s.end);
  // 끝 줄바꿈 모양을 그대로: 파일 끝 섹션이 줄바꿈 없이 끝났으면 없이
  const trail = (orig.match(/\n*$/) || [''])[0] || (s.end < lf.length ? '\n\n' : '');
  const body = toLF(text).replace(/\n*$/, '');
  return lf.slice(0, s.start) + body + trail + lf.slice(s.end);
}

export interface SectionDiff {
  changed: string[];
  added: string[];
  removed: string[];
  /** 첫 제목 앞 머리말이 바뀌었는지 */
  preamble: boolean;
}

/** 두 판의 섹션별 차이. 자기 본문(하위 섹션 제외)만 비교한다 */
export function diffSections(oldMd: string, newMd: string): SectionDiff {
  const a = toLF(oldMd), b = toLF(newMd);
  const sa = sectionSources(a), sb = sectionSources(b);
  const own = (md: string, s: SectionSource) => md.slice(s.start, s.bodyEnd).replace(/\s+$/, '');
  const ma = new Map(sa.map((s) => [s.key, own(a, s)]));
  const mb = new Map(sb.map((s) => [s.key, own(b, s)]));
  const changed: string[] = [], added: string[] = [], removed: string[] = [];
  for (const [k, v] of mb) {
    if (!ma.has(k)) added.push(k);
    else if (ma.get(k) !== v) changed.push(k);
  }
  for (const k of ma.keys()) if (!mb.has(k)) removed.push(k);
  const pre = (md: string, s: SectionSource[]) => md.slice(0, s.length ? s[0].start : md.length).trim();
  return { changed, added, removed, preamble: pre(a, sa) !== pre(b, sb) };
}

/** 키에서 #n 을 뗀 경로 */
export const keyToPath = (key: string): string[] => key.replace(/ #\d+$/, '').split(KEY_SEP);

/** 키 → 경로 + 몇 번째 (같은 경로 제목이 여럿일 때) */
export function parseKey(key: string): { path: string[]; occurrence?: number } {
  const m = / #(\d+)$/.exec(key);
  const n = m ? Number(m[1]) : 1;
  return n > 1 ? { path: keyToPath(key), occurrence: n } : { path: keyToPath(key) };
}

/** 경로 + 몇 번째 → 키 */
export const makeKey = (path: string[], occurrence?: number): string => path.join(KEY_SEP) + (occurrence && occurrence > 1 ? ' #' + occurrence : '');
