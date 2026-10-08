/**
 * 문구 앵커 — W3C TextQuoteSelector(exact + prefix + suffix).
 * 문서가 조금 바뀌어도 앞뒤 문맥 점수로 가장 그럴듯한 자리를 다시 찾는다.
 * 모두 공백 정규화(norm)된 문자열 기준이다.
 */
import type { TextSelector } from '../types';
import { norm } from './markdown';

export const CONTEXT = 32;

export function makeSelector(text: string, start: number, end: number): TextSelector {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** text 안에서 selector 의 위치. 여러 곳이면 문맥이 가장 잘 맞는 곳. 없으면 null */
export function locate(text: string, sel: TextSelector): { start: number; end: number; score: number } | null {
  const exact = norm(sel.exact);
  if (!exact) return null;
  let best: { start: number; end: number; score: number } | null = null;
  let i = text.indexOf(exact);
  while (i >= 0) {
    const before = text.slice(Math.max(0, i - CONTEXT), i);
    const after = text.slice(i + exact.length, i + exact.length + CONTEXT);
    const score = (sel.prefix ? commonSuffixLen(before, norm(sel.prefix)) : 0) + (sel.suffix ? commonPrefixLen(after, norm(sel.suffix)) : 0);
    if (!best || score > best.score) best = { start: i, end: i + exact.length, score };
    i = text.indexOf(exact, i + 1);
  }
  return best;
}
