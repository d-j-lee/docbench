/**
 * 바뀐 글을 문서 위에 그린다 (Word 의 변경 내용 추적처럼).
 * 섹션의 자기 본문(하위 섹션 제외)을 예전 판과 낱말 단위로 비교해 더한 글은 <ins>, 지운 글은 <del> 로 그 자리에 둔다.
 * 지운 글은 .db-noindex 라서 피드백 문구 찾기·찾기에서 빠진다(문서 글자가 아니므로).
 */
import { diffWordsWithSpace } from 'diff';
import { renderMarkdown, decorate, type Compiled } from './render';
import { h } from './dom';

const SKIP = '.db-sec-side,button,.db-noindex,.db-editor';

/** 섹션 요소의 자기 글(하위 섹션 제외) — 공백을 한 칸으로 접은 글과 글자별 위치 */
export function ownTextIndex(secEl: Element): { s: string; map: [Text, number][] } {
  const w = document.createTreeWalker(secEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement as Element;
      if (p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return p.closest('.db-sec') === secEl ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  return collect(w);
}

function plainIndex(root: Element): { s: string; map: [Text, number][] } {
  return collect(document.createTreeWalker(root, NodeFilter.SHOW_TEXT));
}

function collect(w: TreeWalker): { s: string; map: [Text, number][] } {
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

export interface MarkResult { ins: number; del: number; big: boolean }

/**
 * 섹션 하나에 바뀐 글 표시. oldOwnMd = 예전 판의 그 섹션 자기 본문(제목 줄부터, 하위 섹션 전까지).
 * 너무 많이 바뀌었으면(60% 넘게) 낱말 표시는 하지 않고 big 을 돌려준다 — 그때는 섹션 전체를 "크게 바뀜"으로.
 */
export function markSectionChanges(secEl: HTMLElement, oldOwnMd: string, rules: Compiled): MarkResult {
  const old = renderMarkdown(oldOwnMd);
  decorate(old, rules);
  const a = plainIndex(old).s.trim();
  const idx = ownTextIndex(secEl);
  const b = idx.s;
  if (a === b.trim()) return { ins: 0, del: 0, big: false };
  if (a.length + b.length > 120000) return { ins: 0, del: 0, big: true };
  const chunks = coalesce(diffWordsWithSpace(a, b.replace(/\s+$/, '')));
  let changed = 0;
  for (const c of chunks) if (c.chg) changed += c.a.length + c.b.length;
  if (changed / Math.max(a.length + b.length, 1) > 0.6) return { ins: 0, del: 0, big: true };
  type Op = { pos: number; kind: 'ins'; end: number } | { pos: number; kind: 'del'; text: string };
  const ops: Op[] = [];
  let pos = 0;
  for (const c of chunks) {
    if (!c.chg) { pos += c.b.length; continue; }
    // 바꾼 구절은 "지운 글 → 더한 글" 한 덩어리로 (지운 글을 앞에)
    if (c.a.trim()) ops.push({ pos, kind: 'del', text: c.a });
    if (c.b.trim()) ops.push({ pos, kind: 'ins', end: pos + c.b.length });
    pos += c.b.length;
  }
  // 뒤에서부터 — 글자 위치표가 앞쪽은 그대로 맞게. 같은 자리면 더한 글을 먼저 감싸고 지운 글을 그 앞에 둔다
  ops.sort((x, y) => y.pos - x.pos || (x.kind === 'ins' ? -1 : 1));
  let ins = 0, del = 0;
  for (const op of ops) {
    if (op.kind === 'ins') {
      // 앞뒤 공백은 감싸지 않는다
      let s = op.pos, e = op.end;
      while (s < e && b[s] === ' ') s++;
      while (e > s && b[e - 1] === ' ') e--;
      if (s < e) { const got = wrap(idx.map, s, e); if (got) ins++; }
      continue;
    }
    const text = op.text.trim();
    const el = h('del', { class: 'db-chg-del db-noindex', 'data-full': text, text: text.length > 160 ? text.slice(0, 80) + ' … ' + text.slice(-40) : text });
    if (insertAt(idx.map, op.pos, el)) del++;
  }
  return { ins, del, big: false };
}

/**
 * 낱말 차이를 읽기 좋게 묶는다: 바뀐 곳 사이에 낀 짧은 같은 글(문장부호·한두 글자·공백)은 양쪽에 넣어
 * "(최대 5회)" → "— 최대 3회, …" 처럼 구절 단위로 보이게 한다. 글자 하나씩 지우고 더한 표시는 읽기 어렵다.
 */
function coalesce(parts: { value: string; added?: boolean; removed?: boolean }[]): { chg: boolean; a: string; b: string }[] {
  const out: { chg: boolean; a: string; b: string }[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.added || p.removed) {
      if (last?.chg) { if (p.added) last.b += p.value; else last.a += p.value; }
      else out.push({ chg: true, a: p.removed ? p.value : '', b: p.added ? p.value : '' });
    } else out.push({ chg: false, a: p.value, b: p.value });
  }
  const short = (s: string) => s.length <= 3 || !/[\p{L}\p{N}]{2,}/u.test(s);
  for (let again = true; again;) {
    again = false;
    for (let i = 1; i < out.length - 1; i++) {
      if (!out[i].chg && out[i - 1].chg && out[i + 1].chg && short(out[i].b)) {
        const m = { chg: true, a: out[i - 1].a + out[i].a + out[i + 1].a, b: out[i - 1].b + out[i].b + out[i + 1].b };
        out.splice(i - 1, 3, m);
        again = true;
        break;
      }
    }
  }
  return out;
}

function wrap(map: [Text, number][], a: number, b: number): boolean {
  const segs: { n: Text; start: number; end: number }[] = [];
  for (let i = a; i < b && i < map.length; i++) {
    const [n, off] = map[i];
    const last = segs[segs.length - 1];
    if (last && last.n === n && last.end === off) last.end = off + 1;
    else segs.push({ n, start: off, end: off + 1 });
  }
  let ok = false;
  for (const sg of segs.reverse()) {
    if (!sg.n.parentNode || sg.n.parentElement?.closest('.db-noindex')) continue;
    const r = document.createRange();
    r.setStart(sg.n, sg.start);
    r.setEnd(sg.n, Math.min(sg.end, sg.n.length));
    try { r.surroundContents(h('ins', { class: 'db-chg-ins' })); ok = true; } catch { /* 요소 경계를 넘는 조각은 건너뛴다 */ }
  }
  return ok;
}

function insertAt(map: [Text, number][], pos: number, el: HTMLElement): boolean {
  if (!map.length) return false;
  if (pos < map.length) {
    const [n, off] = map[pos];
    if (!n.parentNode) return false;
    const after = n.splitText(Math.min(off, n.length));
    after.parentNode!.insertBefore(el, after);
    return true;
  }
  const [n, off] = map[map.length - 1];
  if (!n.parentNode) return false;
  const after = n.splitText(Math.min(off + 1, n.length));
  after.parentNode!.insertBefore(el, after);
  return true;
}

/** 표시를 모두 걷는다 (끄기·다시 그리기 전) */
export function clearChangeMarks(root: Element): void {
  for (const d of Array.from(root.querySelectorAll('del.db-chg-del'))) d.remove();
  for (const i of Array.from(root.querySelectorAll('ins.db-chg-ins'))) i.replaceWith(...Array.from(i.childNodes));
  root.normalize();
}
