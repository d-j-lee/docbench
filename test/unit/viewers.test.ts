/**
 * 형식마다 그리기(D87) — 구조 글의 화면 섹션 키가 원문(core/source)과 같고, 색을 입혀도 글자는 원문 그대로이며,
 * 표·HTML·SVG·뽑은 글이 안전하게 그려지는지.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionSources, getSectionText, replaceSection } from '../../src/core/source';
import { sectionize } from '../../src/ui/render';
import { renderDoc, parseDelimited } from '../../src/ui/viewers';
import { highlightLines } from '../../src/ui/highlight';
import { makeT } from '../../src/ui/i18n';
import type { DocContent } from '../../src/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = makeT('ko');
const doc = (id: string, md: string, extra: Partial<DocContent> = {}): DocContent => ({ id, md, version: '1', ...extra });
/** 태그를 떼고 엔티티를 푼 글 — 화면 글자 */
const plain = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; };

describe('구조 글: 원문 ↔ 화면 섹션 키 일치', () => {
  const dir = path.join(here, '../fixtures/formats');
  for (const n of readdirSync(dir)) {
    it(n, () => {
      const text = readFileSync(path.join(dir, n), 'utf8').replace(/\r\n?/g, '\n');
      const src = sectionSources(text, n).map((s) => s.key);
      expect(src.length).toBeGreaterThan(1);
      const dom = sectionize(renderDoc(doc(n, text), { t })).map((s) => s.key);
      expect(dom).toEqual(src);
    });
  }
  it('같은 이름 키는 #2 — 화면도 같은 순번', () => {
    const y = 'a:\n  x: 1\nb:\n  x: 2\na:\n  y: 3\n';
    expect(sectionize(renderDoc(doc('d.yaml', y), { t })).map((s) => s.key)).toEqual(sectionSources(y, 'd.yaml').map((s) => s.key));
  });
  it('YAML 아래 키의 섹션은 그 블록까지 — 뒤따르는 같은 단계 값은 위 섹션(원문·화면 같게)', () => {
    const y = 'server:\n  tls:\n    on: true\n  hosts:\n  - a\n  - b\n  port: 80\nretry: 1\n';
    expect(getSectionText(y, 'server › tls', 'a.yaml')).toBe('  tls:\n    on: true\n');
    expect(getSectionText(y, 'server › hosts', 'a.yaml')).toBe('  hosts:\n  - a\n  - b\n');
    expect(replaceSection(y, 'server › tls', '  tls:\n    on: false\n', 'a.yaml')).toBe(y.replace('on: true', 'on: false'));
    const secs = sectionize(renderDoc(doc('a.yaml', y), { t }));
    const tls = secs.find((x) => x.key === 'server › tls')!;
    const server = secs.find((x) => x.key === 'server')!;
    expect(tls.el.textContent).not.toContain('port: 80');
    expect(server.body.textContent).toContain('port: 80');
  });
  it('긴 줄(한 줄짜리 데이터)에서도 제목 찾기·색 입히기가 오래 걸리지 않는다', () => {
    const sp = ' '.repeat(40000);
    for (const [id, line] of [['a.yaml', 'a' + sp + 'b'], ['a.toml', '[a' + sp + 'b'], ['a.adoc', '= a' + sp + 'b'], ['a.org', '* a' + sp + 'b']]) {
      const text = Array(60).fill(line).join('\n');
      const t0 = Date.now(); sectionSources(text, id); expect(Date.now() - t0, id).toBeLessThan(2000);
    }
    for (const lang of ['yaml', 'ini', 'js', 'xml']) { const t0 = Date.now(); highlightLines(Array(5).fill('a' + sp + 'b').join('\n'), lang); expect(Date.now() - t0, lang).toBeLessThan(2000); }
  });
  it('화면 글자 = 원문 (줄 번호는 글자가 아니다)', () => {
    const y = readFileSync(path.join(dir, 'sample.yaml'), 'utf8').replace(/\r\n?/g, '\n');
    const el = renderDoc(doc('s.yaml', y), { t });
    const code = Array.from(el.querySelectorAll('pre.db-src')).map((p) => p.textContent).join('\n');
    expect(code).toBe(y.replace(/\n$/, ''));
  });
});

describe('색 입히기 — 글자는 그대로', () => {
  const cases: [string, string][] = [
    ['js', 'const a = "x<y>&z"; // 주석 <b>\n/* 여러\n줄 */ let b = `t${1}`;\nif (a) return 0x1F;'],
    ['python', 'def f(x):\n    """문서\n    글"""\n    return x # 끝'],
    ['sh', 'echo "$HOME" # c\nA=1 # x\nurl=a#b'],
    ['sql', "SELECT * FROM t WHERE a = 'x' -- c"],
    ['yaml', 'a: "q" # c\nb: |\n  긴 글: 여기\nc: [1, 2]\n- x: 1'],
    ['toml', '[s]\nk = """여러\n줄"""\nn = 1 # c'],
    ['ini', '; c\n[s]\nk=v'],
    ['json', '{"a": 1, "b": [true, null], "c": "x"}'],
    ['xml', '<a href="x>y">t &amp; <!-- c\n여러 --><b/>'],
    ['log', '2026-10-14T09:00:00Z ERROR boom\n[2026-10-14 09:00:00,123] WARN slow'],
    ['diff', '--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y'],
    ['nope', 'a < b'],
  ];
  for (const [lang, text] of cases) {
    it(lang, () => {
      const lines = highlightLines(text, lang);
      expect(lines.length).toBe(text.split('\n').length);
      expect(lines.map(plain).join('\n')).toBe(text);
      // 태그는 span 만 — 문서 글자에서 온 태그가 살아 있지 않다
      const d = document.createElement('div');
      d.innerHTML = lines.join('\n');
      expect(Array.from(d.querySelectorAll('*')).every((e) => e.tagName === 'SPAN' && /^tk-[a-z]$/.test(e.className))).toBe(true);
    });
  }
  it('주석·글이 줄을 넘어 이어진다', () => {
    const l = highlightLines('a /* x\ny */ b', 'js');
    expect(l[1]).toContain('class="tk-c"');
  });
});

describe('표 (CSV·TSV)', () => {
  it('RFC 4180 — 따옴표 안 쉼표·줄바꿈·"" · BOM · 빈 끝 칸', () => {
    const { rows } = parseDelimited('\uFEFFa,b,c\n"x, y","줄\n바꿈","그는 ""네"""\n1,,\n', ',');
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', '줄\n바꿈', '그는 "네"'], ['1', '', '']]);
  });
  it('CRLF · 행 한도', () => {
    const { rows, more } = parseDelimited('a\r\nb\r\nc\r\n', ',', 2);
    expect(rows).toEqual([['a'], ['b']]);
    expect(more).toBe(true);
  });
  it('첫 행은 머리, 수는 오른쪽, 행 번호는 글자로 세지 않는다', () => {
    const el = renderDoc(doc('m.csv', 'name,n\n가,1200\n나,3.5%\n'), { t });
    expect(Array.from(el.querySelectorAll('thead th')).map((x) => x.textContent)).toEqual(['', 'name', 'n']);
    expect(el.querySelectorAll('td.num').length).toBe(2);
    expect(el.querySelector('td.rn')!.classList.contains('db-noindex')).toBe(true);
  });
  it('세미콜론 CSV 를 알아본다 · 원문 보기', () => {
    const el = renderDoc(doc('m.csv', 'a;b\n1;2\n'), { t });
    expect(el.querySelectorAll('thead th').length).toBe(3);
    const src = renderDoc(doc('m.csv', 'a;b\n1;2\n'), { t, source: true });
    expect(src.dataset.view).toBe('source');
    expect(src.querySelector('pre')!.textContent).toBe('a;b\n1;2');
  });
});

describe('HTML · SVG · 그림 · 뽑은 글', () => {
  it('HTML: 스크립트·스타일·폼·이벤트·class·data-md 는 지우고 글·링크만', () => {
    const el = renderDoc(doc('r.html', '<html><head><style>p{}</style><script>x()</script></head><body><h2 data-md="" class="db-sec" id="k">제목</h2><p onclick="x()" style="color:red">글 <a href="a.md">링크</a></p><form><input></form><iframe src="x"></iframe></body></html>'), { t });
    expect(el.querySelector('script,style,form,input,iframe,[onclick],[style],[class="db-sec"],[id],[data-md]')).toBeNull();
    expect(el.textContent).toContain('제목');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('a.md');
    // HTML 제목은 섹션이 아니다(원문도 섹션이 없다)
    expect(sectionize(el).length).toBe(0);
  });
  it('상대 경로 그림은 바이트를 줄 수 있을 때만 data-db-src 로', () => {
    const md = '# a\n\n![x](img/p.png) ![w](https://x.y/w.png) ![d](data:image/png;base64,AA==)\n';
    const withBytes = renderDoc(doc('d/a.md', md), { t, loadBytes: async () => null });
    expect(withBytes.querySelector('img[data-db-src="img/p.png"]:not([src])')).not.toBeNull();
    expect(withBytes.querySelector('img[src^="https:"]')).not.toBeNull();
    const without = renderDoc(doc('d/a.md', md), { t });
    expect(without.querySelector('img[src="img/p.png"]')).not.toBeNull();
    expect(without.querySelector('[data-db-src]')).toBeNull();
  });
  it('SVG 는 <img> 로(스크립트가 돌지 않는다)', () => {
    const el = renderDoc(doc('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { t });
    expect(el.querySelector('img.db-img')).not.toBeNull();
    expect(el.querySelector('svg, script')).toBeNull();
  });
  it('PDF 는 내려받기 카드, 뽑지 못한 Word 는 빈 본문(머리가 알린다)', () => {
    const pdf = renderDoc(doc('a.pdf', '', { binary: { mime: 'application/pdf', size: 2048 } }), { t, loadBytes: async () => null });
    expect(pdf.querySelector('.db-filecard')!.textContent).toContain('2.0 KB');
    const bad = renderDoc(doc('a.docx', '', { deriveError: 'broken' }), { t });
    expect(bad.textContent).toBe('');
  });
  it('뽑은 글(Word)은 마크다운으로 — 섹션이 원문 규칙과 같다', () => {
    const md = '# 계획\n\n## 개요\n\n글\n';
    expect(sectionize(renderDoc(doc('p.docx', md), { t })).map((s) => s.key)).toEqual(sectionSources(md, 'p.docx').map((s) => s.key));
  });
  it('글·코드·로그는 섹션이 없다(문서 전체 하나)', () => {
    for (const [id, text] of [['a.txt', '# 아님\n'], ['a.ts', '// # x\n'], ['a.log', 'INFO x\n']]) {
      expect(sectionize(renderDoc(doc(id, text), { t })).length).toBe(0);
      expect(sectionSources(text, id).length).toBe(0);
    }
  });
});

describe('SVG 정제', () => {
  it('스크립트·이벤트·javascript: 링크·foreignObject 를 지우고 이름공간은 남긴다', async () => {
    const { safeSvg } = await import('../../src/ui/viewers');
    const out = safeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><script>alert(1)</script><rect onload="x()"/><a xlink:href="javascript:alert(1)"><text>t</text></a><foreignObject><div>x</div></foreignObject></svg>');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).not.toMatch(/script|onload|javascript:|foreignObject/i);
  });
});
