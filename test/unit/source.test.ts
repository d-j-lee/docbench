import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionSources, findSection, getSectionText, replaceSection, diffSections, keyToPath, parseKey, makeKey, KEY_SEP } from '../../src/core/source';
import { marked, protectTildes, toHTML, headingPlain } from '../../src/core/markdown';

// jsdom 환경의 URL 은 Node 의 URL 이 아니라서 경로로 읽는다
const tricky = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/tricky.md'), 'utf8');

describe('sectionSources', () => {
  const secs = sectionSources(tricky);
  const keys = secs.map((s) => s.key);

  it('붙는 번호로 같은 이름 제목을 가른다', () => {
    expect(keys).toContain('까다로운 문서 › 같은 이름');
    expect(keys).toContain('까다로운 문서 › 같은 이름 #2');
  });
  it('HTML 로 쓴 제목·<details> 안 제목은 섹션이 아니다 (화면과 같게)', () => {
    expect(keys.filter((k) => k.startsWith('까다로운 문서 › 겹침'))).toEqual(['까다로운 문서 › 겹침', '까다로운 문서 › 겹침 #2']);
    expect(keys.some((k) => k.includes('접힌 상자 안 제목'))).toBe(false);
    expect(keys).toContain('까다로운 문서 › 상자 뒤');
  });
  it('코드 블록 안 제목은 섹션이 아니다', () => {
    expect(keys.some((k) => k.includes('코드 블록 안'))).toBe(false);
    expect(keys.some((k) => k.includes('이것도 아니다'))).toBe(false);
  });
  it('제목 키는 화면 글자(마크다운·엔티티 제거)', () => {
    expect(keys).toContain('까다로운 문서 › 같은 이름 #2 › 코드 와 굵게 가 섞인 제목'.replace(' #2 ›', ' ›'));
    expect(keys).toContain('까다로운 문서 › A & B < C');
    expect(headingPlain('`코드` 와 **굵게**')).toBe('코드 와 굵게');
  });
  it('lexer raw 를 이으면 원문 그대로 (오프셋 기준이 안전)', () => {
    const md = tricky.replace(/\r\n?/g, '\n');
    expect(marked.lexer(md).map((t) => t.raw).join('')).toBe(md);
  });
  it('섹션 범위가 다음 같은·상위 제목 직전까지', () => {
    const s = findSection(tricky, '까다로운 문서 › 같은 이름 #2')!;
    const text = tricky.slice(s.start, s.end);
    expect(text.startsWith('## 같은 이름\n\n둘째.')).toBe(true);
    expect(text).toContain('### `코드`');
    expect(text).not.toContain('## A &amp; B');
  });
});

describe('replaceSection', () => {
  it('같은 글로 바꾸면 바이트가 그대로', () => {
    for (const s of sectionSources(tricky)) {
      const cur = getSectionText(tricky, s.key)!;
      expect(replaceSection(tricky, s.key, cur)).toBe(tricky);
    }
  });
  it('한 섹션만 바뀌고 나머지는 그대로', () => {
    const next = replaceSection(tricky, '까다로운 문서 › 같은 이름', '## 같은 이름\n\n첫째 고침.')!;
    expect(next).toContain('첫째 고침.\n\n## 같은 이름\n\n둘째.');
    const d = diffSections(tricky, next);
    expect(d.changed).toEqual(['까다로운 문서 › 같은 이름']);
    expect(d.added).toEqual([]);
    expect(d.preamble).toBe(false);
  });
  it('마지막 섹션(끝 줄바꿈 없음)도 모양 유지', () => {
    const key = '까다로운 문서 › 마지막 섹션';
    const next = replaceSection(tricky, key, '## 마지막 섹션\n고침')!;
    expect(next.endsWith('## 마지막 섹션\n고침')).toBe(true);
  });
  it('없는 키는 null', () => {
    expect(replaceSection(tricky, '없는 › 키', 'x')).toBeNull();
  });
  it('CRLF 입력도 LF 기준으로 계산', () => {
    const crlf = tricky.replace(/\n/g, '\r\n');
    expect(sectionSources(crlf).map((s) => s.key)).toEqual(sectionSources(tricky).map((s) => s.key));
  });
});

describe('diffSections', () => {
  it('추가·삭제·머리말', () => {
    const a = '앞\n\n# T\n\n## A\n\nx\n';
    const b = '앞 고침\n\n# T\n\n## B\n\ny\n';
    const d = diffSections(a, b);
    expect(d.added).toEqual(['T › B']);
    expect(d.removed).toEqual(['T › A']);
    expect(d.preamble).toBe(true);
  });
  it('하위 섹션만 바뀌면 상위는 바뀐 것이 아니다', () => {
    const a = '# T\n\n본문\n\n## A\n\nx\n';
    const b = '# T\n\n본문\n\n## A\n\ny\n';
    expect(diffSections(a, b).changed).toEqual(['T › A']);
  });
});

describe('키 ↔ 경로', () => {
  it('parseKey / makeKey 왕복', () => {
    expect(parseKey('a › b #3')).toEqual({ path: ['a', 'b'], occurrence: 3 });
    expect(parseKey('a › b')).toEqual({ path: ['a', 'b'] });
    expect(makeKey(['a', 'b'], 3)).toBe('a › b #3');
    expect(makeKey(['a', 'b'], 1)).toBe('a › b');
    expect(keyToPath('a › b #2')).toEqual(['a', 'b']);
    expect(KEY_SEP).toBe(' › ');
  });
});

describe('protectTildes', () => {
  it('한 문단의 범위 표기 두 개가 취소선이 되지 않는다', () => {
    const html = toHTML('9/29~10/2 와 10/5~10/9');
    expect(html).not.toContain('<del>');
    expect(html).toContain('9/29~10/2');
  });
  it('~~취소선~~ 과 코드·펜스 안은 그대로', () => {
    expect(toHTML('~~지움~~')).toContain('<del>지움</del>');
    expect(protectTildes('`a~b`')).toBe('`a~b`');
    expect(protectTildes('```\na~b\n```')).toBe('```\na~b\n```');
  });
});
