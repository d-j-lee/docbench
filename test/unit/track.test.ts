/**
 * 바뀐 글 표시 (src/ui/track.ts) — 섹션 자기 본문을 예전 판과 비교해 더한 글은 <ins>, 지운 글은 <del>.
 * 지운 글은 문서 글자가 아니므로 피드백 문구 찾기(textIndex)에서 빠져야 한다.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown, decorate, sectionize, compileRules, textIndex } from '../../src/ui/render';
import { markSectionChanges, clearChangeMarks } from '../../src/ui/track';

const rules = compileRules();
const view = (md: string) => { const a = renderMarkdown(md); decorate(a, rules); const secs = sectionize(a); return { a, secs }; };

describe('바뀐 글 표시', () => {
  it('구절 단위로: 지운 글 → 더한 글, 하위 섹션은 건드리지 않는다', () => {
    const before = '## 배포\n\n- 재시도 설정 확인 (최대 5회)\n- 상태 페이지\n\n';
    const { a, secs } = view('# 문서\n\n## 배포\n\n- 재시도 설정 확인 — 최대 3회, `retry.yaml`\n- 상태 페이지\n\n### 롤백\n\n그대로\n');
    const s = secs.find((x) => x.key === '문서 › 배포')!;
    const r = markSectionChanges(s.el, before, rules);
    expect(r.big).toBe(false);
    const del = Array.from(a.querySelectorAll('del.db-chg-del')).map((d) => d.textContent);
    const ins = Array.from(a.querySelectorAll('ins.db-chg-ins')).map((d) => d.textContent).join('|');
    expect(del).toEqual(['(최대 5회)']);
    expect(ins).toContain('최대 3회');
    expect(ins).toContain('retry.yaml');
    expect(a.querySelector('.db-sec[data-key="문서 › 배포 › 롤백"] ins, .db-sec[data-key="문서 › 배포 › 롤백"] del')).toBeNull();
    // 지운 글은 피드백 위치 찾기에서 빠진다 — 문서 글자만
    expect(textIndex(s.el).s).not.toContain('(최대 5회)');
    expect(textIndex(s.el).s).toContain('— 최대 3회');
    clearChangeMarks(a);
    expect(a.querySelectorAll('ins.db-chg-ins, del.db-chg-del').length).toBe(0);
    expect(textIndex(s.el).s).toContain('재시도 설정 확인 — 최대 3회');
  });
  it('통째로 바뀌면 낱말 표시 대신 big', () => {
    const { secs } = view('## 개요\n\n완전히 다른 새 글이 여기에 길게 들어갑니다. 예전 글과 겹치는 낱말이 없습니다.\n');
    expect(markSectionChanges(secs[0].el, '## 개요\n\n짧은 옛 글\n', rules).big).toBe(true);
  });
  it('같으면 아무것도 하지 않는다', () => {
    const { a, secs } = view('## 개요\n\n그대로\n');
    expect(markSectionChanges(secs[0].el, '## 개요\n\n그대로\n', rules)).toEqual({ ins: 0, del: 0, big: false });
    expect(a.querySelectorAll('ins, del').length).toBe(0);
  });
});
