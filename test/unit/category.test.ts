// @vitest-environment node
/**
 * 피드백 종류·골라 보기(0.8, D85) — 사람과 Claude 가 같은 고정 목록을 쓰고, 화면은 말풍선·패널이 같은 거르기를 따른다
 *  - 예전 자유 꼬리표(0.1 사전 리뷰 "사실 갱신" 등)는 종류로 짐작한다(데이터는 고치지 않는다)
 *  - Claude 는 먼저 남길 때 종류·중요도를 반드시, 처리할 때 종류가 없던 것에만 붙인다(사람이 고른 것은 그대로)
 */
import { describe, it, expect } from 'vitest';
import { FEEDBACK_CATEGORIES, categoryOf, cleanLens, inferCategory, lensFilters, lensMatch, normalizeFeedback } from '../../src/core/feedback';
import { applyReviewOutput, applyRunOutput, buildRunContext, type ApplyHost } from '../../src/core/apply';
import { REVIEW_SCHEMA, RUN_SCHEMA, buildReviewPrompt, buildRunPrompt, planReview, planRun } from '../../src/core/runs';
import type { Feedback } from '../../src/types';

const md = '# 런북\n\n## 배포\n\n- 큐 확인\n- 재시도 5회\n\n## 연락처\n\n담당자\n';
const claude = { kind: 'assistant' as const, name: 'Claude' };
const person = { kind: 'human' as const, id: 'u-0a1b2c3d4e', name: '디제이' };

function host() {
  const fbs = new Map<string, Feedback>();
  let n = 0;
  const doc = { id: 'a.md', md, version: '1' };
  const h: ApplyHost = {
    async readDoc() { return { ...doc }; },
    async writeDoc(_id, next) { doc.md = next; doc.version = String(+doc.version + 1); return { version: doc.version }; },
    async getFeedback(id) { return fbs.get(id)!; },
    async updateFeedback(id, patch) { const f = { ...fbs.get(id)!, ...patch } as Feedback; fbs.set(id, f); return f; },
    async createFeedback(input) { const id = 'fb-new-' + ++n; const f = normalizeFeedback({ ...input, id }, id); fbs.set(id, f); return f; },
    async log() { /* 기록 생략 */ },
  };
  const add = (id: string, o: Record<string, unknown> = {}) => fbs.set(id, normalizeFeedback({ id, docId: 'a.md', target: { kind: 'section', path: ['런북', '배포'], heading: '배포' }, body: '재시도를 3회로', author: person, status: 'open', waitingOn: 'assistant', ...o }, id));
  return { h, fbs, add };
}

describe('종류', () => {
  it('고정 목록 아홉, 예전 꼬리표에서 짐작 — 실제 사전 리뷰 꼬리표가 모두 종류를 얻는다', () => {
    expect(FEEDBACK_CATEGORIES).toEqual(['typo', 'fact', 'conflict', 'duplicate', 'gap', 'structure', 'clarity', 'risk', 'direction']);
    const legacy: Record<string, string> = { '사실 갱신': 'fact', '할 일': 'gap', 불일치: 'conflict', 구조: 'structure', 리스크: 'risk', 용어: 'conflict', 일정: 'fact', 명료성: 'clarity', 위생: 'structure', 발표: 'direction', 보안: 'risk', 주의: 'risk', '질문 추가': 'gap', 오탈자: 'typo', 중복: 'duplicate', Typo: 'typo', inconsistency: 'conflict' };
    for (const [k, c] of Object.entries(legacy)) expect([k, inferCategory(k)]).toEqual([k, c]);
    expect(inferCategory('방법 바꾸기')).toBeUndefined();   // "법" 한 글자로 위험이 되지 않는다
    // 영어는 낱말 단위 — 낱말 속 글자에 걸리지 않는다 · 누락이 표기보다 먼저
    for (const k of ['artifact', 'refactor', 'milestone', 'validate', 'consolidate', 'renumber', '출처 표기']) expect([k, inferCategory(k)]).toEqual([k, undefined]);
    expect([inferCategory('근거 표기 누락'), inferCategory('표기 통일'), inferCategory('Dates'), inferCategory('missing owner'), inferCategory('주의 문구 다듬기')]).toEqual(['gap', 'typo', 'fact', 'gap', undefined]);
    expect(inferCategory(undefined)).toBeUndefined();
  });
  it('저장: 고정 종류만 category 로, 예전 판의 자유 category 는 꼬리표로 · 붙인 종류가 짐작보다 먼저', () => {
    const a = normalizeFeedback({ id: 'a', docId: 'd', body: 'x', category: 'conflict', kind: '사실 갱신' });
    expect([a.category, a.kind, categoryOf(a)]).toEqual(['conflict', '사실 갱신', 'conflict']);
    const b = normalizeFeedback({ id: 'b', docId: 'd', body: 'x', category: '사실' });
    expect([b.category, b.kind, categoryOf(b)]).toEqual([undefined, '사실', 'fact']);
  });
  it('골라 보기: 중요도는 없으면 보통으로, 종류는 없으면 none · 모양이 틀린 보기 상태는 버린다', () => {
    const f = (o: Partial<Feedback>) => ({ category: undefined, kind: undefined, severity: undefined, ...o }) as Feedback;
    expect(lensMatch(f({}), { severity: 'medium' })).toBe(true);
    expect(lensMatch(f({}), { severity: 'high' })).toBe(false);
    expect(lensMatch(f({ severity: 'low' }), { severity: 'medium' })).toBe(false);
    expect(lensMatch(f({ severity: 'high', kind: '불일치' }), { severity: 'high', cats: ['conflict'] })).toBe(true);
    expect(lensMatch(f({ category: 'typo' }), { cats: ['conflict', 'duplicate'] })).toBe(false);
    expect(lensMatch(f({}), { cats: ['none'] })).toBe(true);
    expect([lensFilters({ bubbles: true, closed: true }), lensFilters({ cats: ['gap'] })]).toEqual([false, true]);
    expect(cleanLens({ bubbles: true, severity: 'urgent', cats: ['gap', 'nope', 'gap', 'none'], closed: 'yes' })).toEqual({ bubbles: true, cats: ['gap', 'none'] });
    expect(cleanLens({})).toBeUndefined();
  });
});

describe('Claude 가 종류를 붙인다', () => {
  it('먼저 검토: 결과 모양이 종류·중요도를 요구하고, 지시문에 목록이 있다 → 만든 피드백에 그대로', async () => {
    const items = REVIEW_SCHEMA.properties.items.items;
    expect(items.required).toEqual(expect.arrayContaining(['category', 'severity']));
    expect(items.properties.category.enum).toEqual([...FEEDBACK_CATEGORIES]);
    const ctx = { kind: 'review' as const, goal: 'suggest' as const, root: '/w', docs: [{ id: 'a.md', title: '런북', md, version: '1' }] };
    const prompt = buildReviewPrompt(ctx);
    for (const c of FEEDBACK_CATEGORIES) expect(prompt).toContain(`- ${c}: `);
    const out = { overview: '', view: [], items: [
      { docId: 'a.md', section: '런북 › 배포', kind: 'question', category: 'conflict', severity: 'high', title: '횟수', message: '다른 문서는 3회', text: '' },
      { docId: 'a.md', section: '런북 › 연락처', kind: 'question', category: 'whatever', severity: 'urgent', title: '이름', message: '누구?', text: '' },
    ] };
    expect(planReview(ctx, out).creates.map((c) => [c.category, c.severity])).toEqual([['conflict', 'high'], [undefined, undefined]]);
    const m = host();
    await applyReviewOutput(m.h, { id: 'run-r', kind: 'review', feedbackIds: [] }, ctx, out, claude);
    expect([...m.fbs.values()].map((f) => [f.title, f.category, f.severity])).toEqual([['횟수', 'conflict', 'high'], ['이름', undefined, undefined]]);
  });
  it('보낸 것 처리: 저장된 종류가 없는 것만 묻고 붙인다(예전 꼬리표의 짐작은 화면용 — Claude 가 정한다) · 사람이 고른 것, 그 사이 사람이 고른 것은 덮지 않는다', async () => {
    const m = host();
    m.add('fb-1');                                  // 종류 없음
    m.add('fb-2', { category: 'typo' });             // 사람이 고름
    m.add('fb-3', { kind: '사실 갱신' });             // 예전 꼬리표
    m.add('fb-4');                                  // 처리 중에 사람이 고른다
    const req = { id: 'run-x', kind: 'handoff' as const, feedbackIds: ['fb-1', 'fb-2', 'fb-3', 'fb-4'] };
    const { ctx } = await buildRunContext(m.h, req, { root: '/w' });
    const prompt = buildRunPrompt(ctx);
    expect(prompt.match(/^Category: none$/gm)?.length).toBe(3);
    expect(prompt).toContain('Category: typo');
    expect(prompt).toContain('(사실 갱신)');   // 꼬리표는 피드백 줄에 그대로 보인다
    expect(prompt).toContain('- gap: ');
    expect(RUN_SCHEMA.properties.items.items.required).not.toContain('category');
    const out = { summary: '', items: ['fb-1', 'fb-2', 'fb-3', 'fb-4'].map((id) => ({ feedbackId: id, action: 'answer', text: '', message: '확인', category: 'clarity' })) };
    expect(planRun(ctx, out).actions.map((a) => a.category)).toEqual(['clarity', undefined, 'clarity', 'clarity']);
    await m.h.updateFeedback('fb-4', { category: 'risk' });
    await applyRunOutput(m.h, req, ctx, out, claude);
    expect(['fb-1', 'fb-2', 'fb-3', 'fb-4'].map((id) => m.fbs.get(id)!.category)).toEqual(['clarity', 'typo', 'clarity', 'risk']);
    // 종류가 다 있으면 목록을 싣지 않는다
    const m2 = host(); m2.add('fb-9', { category: 'gap' });
    const { ctx: c2 } = await buildRunContext(m2.h, { id: 'run-y', kind: 'handoff', feedbackIds: ['fb-9'] }, { root: '/w' });
    expect(buildRunPrompt(c2)).not.toContain('- gap: ');
  });
});
