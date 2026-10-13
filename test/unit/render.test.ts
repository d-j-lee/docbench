import { describe, it, expect } from 'vitest';
import { renderMarkdown, decorate, compileRules, countPlaceholders, sectionize, textIndex, selectedSpan } from '../../src/ui/render';
import { locate } from '../../src/core/selectors';

const c = compileRules();
const render = (md: string) => { const d = renderMarkdown(md); decorate(d, c); return d; };

describe('장식', () => {
  it('본문 글자와 인라인 코드의 근거 표기 둘 다 칩', () => {
    const d = render('값 [실측] 과 `[추정]` 그리고 [미확인 — 사유]');
    const tags = [...d.querySelectorAll('.db-tag')].map((e) => e.className.split(' ').pop() + ':' + e.textContent);
    expect(tags).toEqual(['tone-good:[실측]', 'tone-warn:[추정]', 'tone-bad:[미확인 — 사유]']);
  });
  it('빈칸이 칩보다 먼저: [확인 필요] 는 빈칸', () => {
    const d = render('여기 [확인 필요] 와 [확인] 과 [(작업 후 기입)] 과 TODO');
    expect([...d.querySelectorAll('mark.db-todo')].map((e) => e.textContent)).toEqual(['[확인 필요]', '[(작업 후 기입)]', 'TODO']);
    expect([...d.querySelectorAll('.db-tag')].map((e) => e.textContent)).toEqual(['[확인]']);
  });
  it('코드 블록 안은 건드리지 않는다', () => {
    const d = render('```\n[실측] TODO\n```');
    expect(d.querySelectorAll('.db-tag, mark').length).toBe(0);
  });
  it('빈칸 수는 코드 밖만', () => {
    expect(countPlaceholders('TODO `TODO`\n```\nTODO\n```\n[작업 후 기입]', c)).toBe(2);
  });
  it('표는 가로 스크롤 상자에, 바깥 링크는 새 창', () => {
    const d = render('| a |\n|---|\n| b |\n\n[x](https://example.com)');
    expect(d.querySelector('.db-tw > table')).not.toBeNull();
    const a = d.querySelector('a')!;
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
  it('이름표 줄', () => {
    const d = render('- **담당:** 플랫폼팀\n- **일정**: 10/10\n- 그냥 줄');
    expect([...d.querySelectorAll('li')].map((li) => (li as HTMLElement).dataset.label || '')).toEqual(['담당', '일정', '']);
  });
  it('스크립트는 정제된다', () => {
    const d = render('<img src=x onerror="alert(1)"><script>alert(1)</script>');
    expect(d.innerHTML).not.toContain('onerror');
    expect(d.innerHTML).not.toContain('<script');
  });
  it('장식해도 섹션 키는 그대로 (textContent 불변)', () => {
    const d = render('# 제목 [실측]\n\n## TODO 목록\n');
    expect(sectionize(d).map((s) => s.key)).toEqual(['제목 [실측]', '제목 [실측] › TODO 목록']);
  });
});

describe('고른 글 (문구 선택 → 인용)', () => {
  // 제목 옆 단추(적기·편집)는 문서 글자가 아니다 — 제목부터 본문까지 고르면 Selection.toString() 에는 들어간다
  const doc = () => {
    const d = render('# 문서\n\n## 남은 확인\n\n공급자 응답 시간은 아직 재지 않았다.\n\n## 다음\n\n끝.\n');
    const secs = sectionize(d);
    for (const s of secs) s.head.querySelector('.db-sec-acts')!.append(Object.assign(document.createElement('button'), { textContent: '적기' }), Object.assign(document.createElement('button'), { textContent: '편집' }));
    document.body.replaceChildren(d);
    return secs;
  };
  it('제목부터 본문까지: 단추 글자 없이, 문서에서 다시 찾을 수 있게', () => {
    const secs = doc();
    const s = secs.find((x) => x.title === '남은 확인')!;
    const body = s.body.querySelector('p')!.firstChild as Text;
    const rg = document.createRange();
    rg.setStart(s.heading.firstChild!, 0);
    rg.setEnd(body, '공급자 응답 시간'.length);
    const idx = textIndex(s.el);
    const at = selectedSpan(idx, rg)!;
    expect(at.exact).toBe('남은 확인 공급자 응답 시간');
    expect(locate(idx.s, { exact: at.exact })).not.toBeNull();
  });
  it('앞뒤 공백은 빼고, 문서 글자가 없는 범위는 null', () => {
    const secs = doc();
    const s = secs.find((x) => x.title === '남은 확인')!;
    const body = s.body.querySelector('p')!.firstChild as Text;
    const rg = document.createRange();
    rg.setStart(body, '공급자'.length);
    rg.setEnd(body, '공급자 응답 '.length);
    expect(selectedSpan(textIndex(s.el), rg)!.exact).toBe('응답');
    const btn = s.head.querySelector('.db-sec-acts button')!;
    const only = document.createRange();
    only.selectNodeContents(btn);
    expect(selectedSpan(textIndex(s.el), only)).toBeNull();
  });
});
