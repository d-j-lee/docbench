// @ts-check
/** 작은 glob — `**`, `*`, `?`, `{a,b}` 만. 경로는 '/' 구분 상대 경로 */
const cache = new Map();

/** @param {string} pat */
export function globToRegExp(pat) {
  if (cache.has(pat)) return cache.get(pat);
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        i++;
        if (pat[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = pat.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += '(?:' + pat.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp('^' + re + '$', process.platform === 'win32' ? 'i' : '');
  cache.set(pat, out);
  return out;
}

/** @param {string} rel @param {string[] | undefined} pats */
export const matchAny = (rel, pats) => !!pats && pats.some((p) => globToRegExp(p).test(rel));
