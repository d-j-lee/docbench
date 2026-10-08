import { describe, it, expect } from 'vitest';
import { normalizeFeedback, countTurns, sortFeedback, sectionKeyOf, turnOf, newFeedbackId } from '../../src/core/feedback';

describe('normalizeFeedback', () => {
  it('작업대 v1 행을 새 모양으로', () => {
    const f = normalizeFeedback({ by: 'claude', turn: 'dj', status: 'open', doc: 'a.md', path: '제목 › 절 #2', heading: '절', quote: '문구', severity: '높음', category: '사실', body: '확인' }, 'x1');
    expect(f.author).toEqual({ kind: 'assistant', name: 'Claude' });
    expect(f.waitingOn).toBe('owner');
    expect(f.target).toEqual({ kind: 'section', path: ['제목', '절'], heading: '절', occurrence: 2 });
    expect(f.selector).toEqual({ exact: '문구' });
    expect(f.severity).toBe('high');
    expect(f.kind).toBe('사실');
    expect(sectionKeyOf(f)).toBe('제목 › 절 #2');
  });
  it('done → resolved, 차례 기본값은 작성자 반대편', () => {
    expect(normalizeFeedback({ status: 'done', body: '' }, 'a').status).toBe('resolved');
    expect(normalizeFeedback({ author: { kind: 'human' }, body: '' }, 'a').waitingOn).toBe('assistant');
    expect(normalizeFeedback({ author: { kind: 'assistant' }, body: '' }, 'a').waitingOn).toBe('owner');
  });
  it('지도 항목 피드백', () => {
    const f = normalizeFeedback({ doc: '_map', target: 'folder/file.pdf', heading: 'file.pdf', body: '' }, 'm');
    expect(f.target).toEqual({ kind: 'item', itemId: 'folder/file.pdf', label: 'file.pdf' });
  });
  it('이미 새 모양이면 그대로', () => {
    const raw = { id: 'n', version: 3, docId: 'a.md', target: { kind: 'doc' }, body: 'b', status: 'open', waitingOn: 'assistant', author: { kind: 'human', name: 'dj' }, thread: [], createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' };
    const f = normalizeFeedback(raw, 'n');
    expect(f.version).toBe(3);
    expect(f.target).toEqual({ kind: 'doc' });
  });
});

describe('집계·정렬', () => {
  const rows = [
    normalizeFeedback({ docId: 'b.md', body: '', severity: 'low', author: { kind: 'human' } }, '1'),
    normalizeFeedback({ docId: 'a.md', body: '', severity: 'low', author: { kind: 'human' } }, '2'),
    normalizeFeedback({ docId: 'a.md', body: '', severity: 'high', author: { kind: 'assistant' } }, '3'),
    normalizeFeedback({ docId: 'a.md', body: '', status: 'declined' }, '4'),
  ];
  it('차례 수', () => expect(countTurns(rows)).toEqual({ owner: 1, assistant: 2, resolved: 0, declined: 1 }));
  it('문서 순서 → 심각도', () => expect(sortFeedback(rows, ['a.md', 'b.md']).map((r) => r.id)).toEqual(['3', '2', '4', '1']));
  it('turnOf', () => expect(turnOf(rows[3])).toBe('declined'));
  it('id 모양', () => expect(newFeedbackId(new Date(2026, 9, 8, 9, 5, 7))).toMatch(/^fb-20261008-090507-[a-z0-9]{1,4}$/));
});
