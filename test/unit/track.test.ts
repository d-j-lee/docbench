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
  it('표의 칸이 바뀌어도 칸 수는 그대로 — 줄(tr) 바로 아래에 표시를 두지 않는다', () => {
    const intro = '## 내 업무에 적용해 보기\n\n내 업무 문서 하나로 시작해 보세요. 문서 위의 단추를 누르고 답하기에 값을 적어 보내면 표를 채웁니다.\n\n| 문서 | 지금 방식 | 바꿔 볼 것 |\n|---|---|---|\n';
    const before = intro + '| [TODO] | [TODO] | [TODO] |\n';
    const { a, secs } = view('# 문서\n\n' + intro + '| 주간 보고 | 메신저로 의견 받기 | 읽기 정리 |\n');
    const s = secs.find((x) => x.key === '문서 › 내 업무에 적용해 보기')!;
    const r = markSectionChanges(s.el, before, rules);
    expect(r.big).toBe(false);
    expect(r.ins + r.del).toBeGreaterThan(0);
    for (const tr of Array.from(a.querySelectorAll('tr'))) {
      const cells = Array.from(tr.children).map((c) => c.tagName);
      expect(cells).toHaveLength(3);
      expect(cells.every((t) => t === 'TD' || t === 'TH')).toBe(true);
      for (const n of Array.from(tr.childNodes)) expect(n.nodeType === 1 || !n.textContent?.trim()).toBe(true);
    }
    for (const sec of ['TBODY', 'THEAD', 'TABLE']) for (const el of Array.from(a.querySelectorAll(sec))) for (const c of Array.from(el.children)) expect(['INS', 'DEL']).not.toContain(c.tagName);
    const row = a.querySelector('tbody tr')!;
    expect(Array.from(row.children).map((td) => td.querySelector('ins')?.textContent ?? '')).toEqual(['주간 보고', '메신저로 의견 받기', '읽기 정리']);
    // 칸마다 지운 글 → 더한 글 (첫 칸에 몰리지 않는다)
    expect(Array.from(row.children).map((td) => td.querySelector('del')?.textContent ?? '')).toEqual(['[TODO]', '[TODO]', '[TODO]']);
    clearChangeMarks(a);
    expect(Array.from(row.children).map((td) => td.textContent)).toEqual(['주간 보고', '메신저로 의견 받기', '읽기 정리']);
  });
  it('같으면 아무것도 하지 않는다', () => {
    const { a, secs } = view('## 개요\n\n그대로\n');
    expect(markSectionChanges(secs[0].el, '## 개요\n\n그대로\n', rules)).toEqual({ ins: 0, del: 0, big: false });
    expect(a.querySelectorAll('ins, del').length).toBe(0);
  });
});
