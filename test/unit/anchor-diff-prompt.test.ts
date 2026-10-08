import { describe, it, expect } from 'vitest';
import { makeSelector, locate } from '../../src/core/selectors';
import { lineDiff } from '../../src/core/diff';
import { buildProposePrompt, checkProposal, PROPOSAL_SCHEMA } from '../../src/core/prompt';
import { normalizeFeedback } from '../../src/core/feedback';

describe('문구 앵커', () => {
  const text = '재시도는 최대 5회. 설정 표의 재시도는 최대 5회가 아니라 3회로 바꾼다.';
  it('같은 문구가 둘이면 앞뒤 문맥으로 고른다', () => {
    const second = text.lastIndexOf('최대 5회');
    const sel = makeSelector(text, second, second + '최대 5회'.length);
    expect(locate(text, sel)!.start).toBe(second);
  });
  it('문서가 조금 바뀌어도 다시 찾는다', () => {
    const at = text.indexOf('3회');
    const sel = makeSelector(text, at, at + 2);
    const edited = '앞에 한 줄 추가. ' + text;
    expect(edited.slice(locate(edited, sel)!.start).startsWith('3회')).toBe(true);
  });
  it('없으면 null', () => expect(locate(text, { exact: '없는 말' })).toBeNull());
});

describe('lineDiff', () => {
  it('바뀐 줄 안의 낱말까지', () => {
    const d = lineDiff('a\nb 1\nc\n', 'a\nb 2\nc\n');
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    const add = d.lines.find((l) => l.t === 'add') as { words: { text: string; changed: boolean }[] };
    expect(add.words.filter((w) => w.changed).map((w) => w.text).join('')).toBe('2');
  });
  it('긴 같은 구간은 접는다', () => {
    const a = Array.from({ length: 30 }, (_, i) => 'l' + i).join('\n');
    const b = a.replace('l15', 'L15');
    expect(lineDiff(a, b).lines.some((l) => l.t === 'skip')).toBe(true);
  });
});

describe('AI 제안 프롬프트', () => {
  const fb = normalizeFeedback({ docId: 'a.md', body: '숫자를 고쳐', author: { kind: 'human', name: 'dj' }, selector: { exact: '5회' } }, 'f');
  const req = { docId: 'a.md', docTitle: '문서', feedback: fb, sectionPath: ['문서', '재시도'], sectionText: '## 재시도\n\n최대 5회 [실측]\n' };
  it('섹션·피드백·규칙이 들어간다', () => {
    const p = buildProposePrompt(req);
    expect(p).toContain('--- SECTION START ---\n## 재시도');
    expect(p).toContain('Feedback: 숫자를 고쳐');
    expect(p).toContain('Quoted text: "5회"');
    expect(p).toContain('Do not invent facts');
  });
  it('머리줄을 버린 답은 거부', () => {
    expect(() => checkProposal(req, { after: '최대 3회' })).toThrow();
    expect(() => checkProposal(req, { after: '' })).toThrow();
    expect(checkProposal(req, { after: '## 재시도\r\n\r\n최대 3회', rationale: 'r' })).toEqual({ after: '## 재시도\n\n최대 3회', rationale: 'r' });
  });
  it('스키마는 after 필수', () => expect(PROPOSAL_SCHEMA.required).toEqual(['after']));
});
