/**
 * 원문 섹션 키(core/source) 와 화면 섹션 키(ui/render) 가 같아야 섹션 편집이 안전하다.
 * 예제 작업 폴더 + 까다로운 고정 문서, 그리고 DOCBENCH_PARITY_DIR 에 둔 실제 문서로 검사한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionSources } from '../../src/core/source';
import { renderMarkdown, sectionize } from '../../src/ui/render';

const here = path.dirname(fileURLToPath(import.meta.url));
function mdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n.startsWith('.') || n === 'node_modules') continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...mdFiles(p));
    else if (/\.md$/i.test(n)) out.push(p);
  }
  return out;
}
const files = [
  path.join(here, '../fixtures/tricky.md'),
  ...mdFiles(path.join(here, '../../examples/sample-workspace')),
  ...(process.env.DOCBENCH_PARITY_DIR && existsSync(process.env.DOCBENCH_PARITY_DIR) ? mdFiles(process.env.DOCBENCH_PARITY_DIR) : []),
];

describe('원문 ↔ 화면 섹션 키 일치', () => {
  for (const f of files) {
    it(path.basename(f), () => {
      const buf = readFileSync(f);
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('euc-kr').decode(buf); }
      text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      const src = sectionSources(text).map((s) => s.key);
      const dom = sectionize(renderMarkdown(text)).map((s) => s.key);
      expect(dom).toEqual(src);
    });
  }
});
