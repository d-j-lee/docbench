/**
 * 줄 단위 차이 + 바뀐 줄 안의 낱말 차이.
 * 화면은 hunks 를 그대로 그리고, 긴 같은 구간은 접는다.
 */
import { diffLines, diffWordsWithSpace } from 'diff';

export type DiffLine =
  | { t: 'ctx'; text: string }
  | { t: 'add'; text: string; words?: WordPart[] }
  | { t: 'del'; text: string; words?: WordPart[] }
  | { t: 'skip'; count: number };

export interface WordPart { text: string; changed: boolean }

export interface DiffResult { lines: DiffLine[]; added: number; removed: number }

export function lineDiff(a: string, b: string, context = 2): DiffResult {
  const parts = diffLines(a, b);
  const lines: DiffLine[] = [];
  let added = 0, removed = 0;
  const split = (v: string) => v.replace(/\n$/, '').split('\n');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const ls = split(p.value);
    if (p.removed) {
      const next = parts[i + 1];
      if (next && next.added) {
        const ns = split(next.value);
        if (ns.length === ls.length) {
          ls.forEach((l, j) => {
            const w = diffWordsWithSpace(l, ns[j]);
            lines.push({ t: 'del', text: l, words: w.filter((x) => !x.added).map((x) => ({ text: x.value, changed: !!x.removed })) });
            lines.push({ t: 'add', text: ns[j], words: w.filter((x) => !x.removed).map((x) => ({ text: x.value, changed: !!x.added })) });
          });
        } else {
          ls.forEach((l) => lines.push({ t: 'del', text: l }));
          ns.forEach((l) => lines.push({ t: 'add', text: l }));
        }
        removed += ls.length; added += ns.length;
        i++;
        continue;
      }
      removed += ls.length;
      ls.forEach((l) => lines.push({ t: 'del', text: l }));
    } else if (p.added) {
      added += ls.length;
      ls.forEach((l) => lines.push({ t: 'add', text: l }));
    } else {
      const first = i === 0, last = i === parts.length - 1;
      const head = first ? 0 : context, tail = last ? 0 : context;
      if (ls.length > head + tail + 1) {
        ls.slice(0, head).forEach((l) => lines.push({ t: 'ctx', text: l }));
        lines.push({ t: 'skip', count: ls.length - head - tail });
        ls.slice(ls.length - tail).forEach((l) => lines.push({ t: 'ctx', text: l }));
      } else ls.forEach((l) => lines.push({ t: 'ctx', text: l }));
    }
  }
  return { lines, added, removed };
}
