/**
 * 섹션 ↔ 원문 위치.
 *
 * 화면의 섹션 키와 원문 범위를 같은 규칙으로 만든다. 그래서 화면에서 고른
 * 섹션을 원문에서 정확히 잘라 고치고, 나머지 글자는 바이트 단위로 그대로 둔다.
 *
 * 키 규칙: 상위 제목부터 현재 제목까지 화면 글자를 ' › ' 로 잇는다.
 * 같은 키가 또 나오면 ' #2', ' #3' 을 붙인다(문서 순서 기준).
 *
 * 형식(D87): 함수마다 마지막 인자로 문서 id 를 주면 그 형식의 제목 규칙으로 센다 — YAML 키·TOML 표·JSON 키 …(core/outline).
 * 주지 않거나 모르는 형식이면 마크다운. 뽑은 글(Word 등)은 마크다운이고, 글·코드·표는 섹션이 없다(문서 전체 하나).
 */
import { marked, headingPlain, toLF, frontMatterLength } from './markdown';
import { formatFor, markdownLike } from './formats';
import { outlineHeads, type Head } from './outline';

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

/** 마크다운 제목 — marked lexer 토큰의 raw 길이로 오프셋을 잰다(raw 를 이으면 입력과 같다) */
function markdownHeads(md: string): Head[] {
  // 앞머리 YAML 은 섹션이 아니다(첫 제목 앞 머리말) — 화면(toHTML)과 같은 함수로 떼고, 오프셋은 원문 기준으로 잇는다
  const fm = frontMatterLength(md);
  const tokens = marked.lexer(fm ? md.slice(fm) : md);
  const heads: Head[] = [];
  let off = fm;
  // 열린 HTML 상자(<details> <div> …) 안의 제목은 브라우저가 그 상자 안에 넣는다 → 화면에서 섹션이 아니므로 여기서도 세지 않는다
  let boxDepth = 0;
  for (const t of tokens) {
    if (t.type === 'html') boxDepth = Math.max(0, boxDepth + htmlBoxDelta(t.raw));
    else if (t.type === 'heading' && boxDepth === 0) heads.push({ level: (t as { depth: number }).depth, title: headingPlain((t as { text: string }).text), start: off });
    off += t.raw.length;
  }
  return heads;
}

/** 이 형식의 제목들 (LF 글). 마크다운·뽑은 글은 마크다운 규칙, 구조 글은 core/outline, 나머지는 없음 */
export function headsOf(md: string, id?: string): Head[] {
  const f = formatFor(id);
  if (markdownLike(f)) return markdownHeads(md);
  if (f.kind === 'outline') return outlineHeads(md, f);
  return [];
}

export function sectionSources(mdIn: string, id?: string): SectionSource[] {
  const md = toLF(mdIn);
  const heads = headsOf(md, id);
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
    // 형식이 끝을 정하면(JSON — 값이 끝나는 줄) 그보다 넓히지 않는다
    if (hd.end != null) end = Math.min(end, hd.end);
    const bodyEnd = i + 1 < heads.length ? Math.min(end, heads[i + 1].start) : end;
    out.push({ key, path, title: hd.title, level: hd.level, start: hd.start, end, bodyEnd });
    stack.push({ level: hd.level, path });
  });
  return out;
}

export function findSection(md: string, keyOrPath: string | string[], id?: string): SectionSource | null {
  const secs = sectionSources(md, id);
  if (Array.isArray(keyOrPath)) {
    const k = keyOrPath.join(KEY_SEP);
    return secs.find((s) => s.key === k) || null;
  }
  return secs.find((s) => s.key === keyOrPath) || null;
}

export function getSectionText(md: string, keyOrPath: string | string[], id?: string): string | null {
  const lf = toLF(md);
  const s = findSection(lf, keyOrPath, id);
  return s ? lf.slice(s.start, s.end) : null;
}

/**
 * 섹션 하나를 새 글로 바꾼다. 섹션 끝의 빈 줄 모양은 원래대로 둔다.
 * 키를 못 찾으면 null.
 */
export function replaceSection(md: string, keyOrPath: string | string[], text: string, id?: string): string | null {
  const lf = toLF(md);
  const s = findSection(lf, keyOrPath, id);
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
  /** 섹션 밖 글(첫 제목 앞 머리말, JSON 의 닫는 괄호 같은 꼬리)이 바뀌었는지 — 섹션이 없는 형식은 문서 전체 */
  preamble: boolean;
}

/** 두 판의 섹션별 차이. 자기 본문(하위 섹션 제외)만 비교한다 */
export function diffSections(oldMd: string, newMd: string, id?: string): SectionDiff {
  const a = toLF(oldMd), b = toLF(newMd);
  const sa = sectionSources(a, id), sb = sectionSources(b, id);
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
  // 섹션 밖 꼬리 — 형식이 섹션 끝을 정하는 JSON 의 닫는 '}' 등 (마크다운은 늘 빈 글)
  const post = (md: string, s: SectionSource[]) => (s.length ? md.slice(Math.max(...s.map((x) => x.end))) : '').trim();
  return { changed, added, removed, preamble: pre(a, sa) !== pre(b, sb) || post(a, sa) !== post(b, sb) };
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
