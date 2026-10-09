import { describe, it, expect } from 'vitest';
import { normalizeFeedback, countTurns, sortFeedback, sectionKeyOf, turnOf, newFeedbackId, isMyDraft } from '../../src/core/feedback';
import { createMemoryAdapters } from '../../src/adapters/memory';

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
  it('null 은 지운다(PATCH 의 "이 값 없애기") · 초안 주인(drafter)은 사람 id 모양만 — 한글 이름도', () => {
    const f = normalizeFeedback({ body: 'x', severity: null, suggestion: null, selector: null, proposal: null, result: null, title: null, status: 'draft', drafter: '홍길동' }, 'a');
    expect([f.severity, f.suggestion, f.selector, f.proposal, f.result, f.title, f.drafter]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, '홍길동']);
    expect(normalizeFeedback({ body: '', status: 'draft', drafter: '../x' }, 'a').drafter).toBeUndefined();
    expect(normalizeFeedback({ body: '', status: 'open', drafter: 'me' }, 'a').drafter).toBeUndefined();
    // 남이 답한 Claude 의 제안을 내가 초안으로 가져오면 내 초안 — 함께 쓰는 기록에서 남에게는 보이지 않는다
    const mine = normalizeFeedback({ body: '', status: 'draft', author: { kind: 'assistant' }, drafter: 'u-me' }, 'b');
    expect([isMyDraft(mine, { kind: 'human', id: 'u-me' }), isMyDraft(mine, { kind: 'human', id: 'u-you' })]).toEqual([true, false]);
  });
  it('저장소 update: null 이면 그 값을 지우고, 빠진 키는 그대로 (★ 끄기 · 요청으로 바꾸기)', async () => {
    const ad = createMemoryAdapters({ manifest: { project: { name: 'x' }, docs: {} } as never, docs: {}, feedback: [] });
    const f = await ad.feedback.create({ docId: 'a.md', target: { kind: 'doc' }, body: '고쳐', severity: 'high', suggestion: '새 글', status: 'draft', waitingOn: 'owner', author: { kind: 'human', id: 'me' } });
    const g = await ad.feedback.update(f.id, { severity: null, suggestion: null });
    expect([g.severity, g.suggestion, g.body, g.status]).toEqual([undefined, undefined, '고쳐', 'draft']);
    const k = await ad.feedback.update(f.id, { body: '더' });
    expect([k.body, k.severity]).toEqual(['더', undefined]);
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
  it('차례 수', () => expect(countTurns(rows)).toEqual({ draft: 0, owner: 1, assistant: 2, resolved: 0, declined: 1 }));
  it('초안: 디스크에서 무엇이라 적혀 있든 사람(쓴 사람) 몫 — 예전 판이 Claude 차례로 집어 가지 않는다', () => {
    const d = normalizeFeedback({ docId: 'a.md', body: '줄여 줘', status: 'draft', waitingOn: 'assistant', author: { kind: 'human', id: 'u-0a1b2c3d4e', name: '디제이' } }, '5');
    expect([d.status, d.waitingOn, turnOf(d)]).toEqual(['draft', 'owner', 'draft']);
    expect(countTurns([...rows, d]).draft).toBe(1);
    expect(isMyDraft(d, { kind: 'human', id: 'u-0a1b2c3d4e', name: '디제이' })).toBe(true);
    expect(isMyDraft(d, { kind: 'human', id: 'u-ffffffffff', name: '동료' })).toBe(false);
    // Claude 가 올린 질문에 내가 답해 초안이 됐으면 내 것
    const q = normalizeFeedback({ docId: 'a.md', body: '기간은?', status: 'draft', author: { kind: 'assistant', name: 'Claude' }, thread: [{ author: { kind: 'human', id: 'u-0a1b2c3d4e', name: '디제이' }, text: '11월', at: '2026-10-09T00:00:00Z' }] }, '6');
    expect(isMyDraft(q, { kind: 'human', id: 'u-0a1b2c3d4e', name: '디제이' })).toBe(true);
  });
  it('결과(result)는 모양이 맞을 때만', () => {
    const f = normalizeFeedback({ docId: 'a.md', body: 'x', status: 'open', waitingOn: 'owner', result: { kind: 'edit', at: '2026-10-09T00:00:00Z', run: 'run-1', change: { docId: 'a.md', section: 'A', from: 'v1', to: 'v2' } } }, '7');
    expect(f.result).toMatchObject({ kind: 'edit', change: { docId: 'a.md', from: 'v1', to: 'v2' } });
    expect(normalizeFeedback({ docId: 'a.md', body: 'x', result: { kind: 'hack', at: 1 } }, '8').result).toBeUndefined();
  });
  it('문서 순서 → 심각도', () => expect(sortFeedback(rows, ['a.md', 'b.md']).map((r) => r.id)).toEqual(['3', '2', '4', '1']));
  it('turnOf', () => expect(turnOf(rows[3])).toBe('declined'));
  it('id 모양', () => expect(newFeedbackId(new Date(2026, 9, 8, 9, 5, 7))).toMatch(/^fb-20261008-090507-[a-z0-9]{1,4}$/));
});
