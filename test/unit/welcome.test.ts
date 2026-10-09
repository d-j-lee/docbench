/**
 * 시작하기(연습 공간)의 흉내 Claude (src/welcome.ts demoRuns) — 처음 쓰는 사람이 검토 회차 한 바퀴를 직접 보게 한다.
 * 반영은 진짜와 같은 규칙(core/apply.ts):
 *  - 내용 없이 보내면 지어내지 않고 되묻는다(볼 것으로)
 *  - 답글로 값을 주고 보내면 그 섹션의 빈칸을 채우고, 결과는 확인할 때까지 "볼 것"에 — 전·후 판이 남아 되돌릴 수 있다
 *  - "이렇게 바꿔"는 그 글로 고친다. 그 밖의 요청은 이해하지 못한다고 솔직히 답한다(문서는 그대로)
 *  - 제안만 방식이면 문서는 그대로, 카드에 고친 섹션을 제안으로
 *  - Claude 검토: 빈칸은 질문, 두 문장 이상 문단은 목록 제안 / 읽기 정리: 빈칸 섹션 먼저, 나머지 접기
 *  - 로그 첫 줄은 시작, 끝 줄은 요약 — 화면 로그(run.log.*)와 같은 모양
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { welcomeContent, demoRuns } from '../../src/welcome';
import { createMemoryAdapters } from '../../src/adapters/memory';
import { buildManifest, mergeConfig, titleFromText } from '../../src/core/workspace';
import { turnOf } from '../../src/core/feedback';
import { planRevert } from '../../src/core/apply';

const HAND = '반영해';
function practice() {
  const w = welcomeContent('ko');
  const manifest = buildManifest(mergeConfig({ title: 'DocBench' }, 'DocBench'), Object.keys(w.docs), (id) => ({ title: titleFromText(w.docs[id], id) }), '', false, { rootName: '시작하기' });
  const mem = createMemoryAdapters({ manifest, docs: w.docs, feedback: w.feedback, me: { kind: 'human', id: 'u-0123456789', name: '디제이' } });
  const runs = demoRuns(mem, 'ko', [HAND, '다시 열기', '거절']);
  const me = { kind: 'human' as const, id: 'u-0123456789', name: '디제이' };
  const fb = () => mem.control.feedback().find((f) => f.id === 'welcome-1')!;
  const handTo = async (text: string) => { const f = fb(); await mem.feedback.update(f.id, { waitingOn: 'assistant', thread: [...f.thread, { author: me, text, at: new Date().toISOString() }] }); };
  const run = async (mode: 'auto' | 'propose' = 'auto') => {
    const st = await runs.start({ kind: 'handoff', feedbackIds: ['welcome-1'], mode });
    await vi.advanceTimersByTimeAsync(3000);
    return { st: (await runs.list()).find((r) => r.id === st.id)!, lines: (await runs.log(st.id, 0)).lines };
  };
  return { mem, runs, fb, handTo, run, doc: '연습용 기획서.md' };
}

afterEach(() => { vi.useRealTimers(); });

describe('연습 공간의 흉내 Claude', () => {
  it('언제나 쓸 수 있고, 흉내라고 밝힌다', async () => {
    const { runs } = practice();
    const av = await runs.status();
    expect(av.available).toBe(true);
    expect(av.runner?.kind).toBe('demo');
  });

  it('내용 없이 넘기면 되묻는다 — 문서는 그대로, 사람 차례로', async () => {
    vi.useFakeTimers();
    const p = practice();
    const before = (await p.mem.docs.load(p.doc)).md;
    await p.handTo(HAND); // "반영해" 는 내용이 아니다
    expect(turnOf(p.fb())).toBe('assistant');
    const { st, lines } = await p.run();
    expect(st.state).toBe('done');
    expect(st.summary).toMatchObject({ asked: 1, edited: 0 });
    expect(lines[0].k).toBe('start');
    expect(lines.map((l) => l.k)).toContain('apply.ask');
    expect(lines.at(-1)!.k).toBe('done');
    expect((await p.mem.docs.load(p.doc)).md).toBe(before);
    expect(turnOf(p.fb())).toBe('owner');
    expect(p.fb().thread.at(-1)!.author.kind).toBe('assistant');
    expect(p.fb().thread.at(-1)!.text).toMatch(/흉내/);
  });

  it('답글로 값을 주면 그 섹션의 빈칸을 차례로 채우고, 이력에 Claude 로 남는다', async () => {
    vi.useFakeTimers();
    const p = practice();
    await p.handTo('11월 3~14일, 김민지');
    const { st } = await p.run();
    expect(st.summary).toMatchObject({ edited: 1 });
    const md = (await p.mem.docs.load(p.doc)).md;
    expect(md).toContain('| 시범 운영 | 11월 3~14일 | 기획팀 |');
    expect(md).toContain('| 전사 확대 | 다음 분기 | 김민지 |');
    expect(md).not.toContain('[TODO]');
    expect(md).toContain('## 위험 요소'); // 다른 섹션은 그대로
    // 끝난 것이 아니라 "볼 것" — 사람이 확인할 때까지. 전·후 판이 결과에 남는다
    expect([p.fb().status, turnOf(p.fb())]).toEqual(['open', 'owner']);
    const res = p.fb().result!;
    expect(res).toMatchObject({ kind: 'edit', run: st.id, change: { docId: p.doc, from: '1', to: '2' } });
    const ch = (await p.mem.docs.changes!()).filter((c) => c.docId === p.doc);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ by: { kind: 'assistant', name: 'Claude' }, feedbackIds: ['welcome-1'] });
    // 되돌리기: 그 뒤 그 자리가 안 바뀌었으면 고치기 전 글로
    const [from, to] = await Promise.all([p.mem.docs.loadVersion!(p.doc, '1'), p.mem.docs.loadVersion!(p.doc, '2')]);
    const back = planRevert(md, from!.md, to!.md, res.change!.section);
    expect('md' in back && back.md).toBe(from!.md);
    // 그 뒤 같은 자리를 사람이 또 고쳤으면 저절로 되돌리지 않는다
    expect(planRevert(md.replace('김민지', '이지은'), from!.md, to!.md, res.change!.section)).toEqual({ problem: 'changed-after' });
  });

  it('제안만 방식이면 문서는 그대로 두고 카드에 제안을 올린다', async () => {
    vi.useFakeTimers();
    const p = practice();
    const before = (await p.mem.docs.load(p.doc)).md;
    await p.handTo('11월 3~14일, 김민지');
    const { st } = await p.run('propose');
    expect(st.summary).toMatchObject({ proposed: 1, edited: 0 });
    expect((await p.mem.docs.load(p.doc)).md).toBe(before);
    const pr = p.fb().proposal!;
    expect(pr.state).toBe('pending');
    expect(pr.after).toContain('11월 3~14일');
    expect(pr.before).toContain('[TODO]');
  });

  it('도중에 멈추면 아무것도 고치지 않는다', async () => {
    vi.useFakeTimers();
    const p = practice();
    const before = (await p.mem.docs.load(p.doc)).md;
    await p.handTo('11월 3~14일, 김민지');
    const st = await p.runs.start({ kind: 'handoff', feedbackIds: ['welcome-1'], mode: 'auto' });
    await vi.advanceTimersByTimeAsync(1000);   // 읽는 중(900ms 기다림)에
    await p.runs.cancel(st.id);
    await vi.advanceTimersByTimeAsync(3000);
    const ks = (await p.runs.log(st.id, 0)).lines.map((l) => l.k);
    expect(ks).toContain('canceled');
    expect(ks).not.toContain('apply.edit');
    expect((await p.mem.docs.load(p.doc)).md).toBe(before);
    expect(p.fb().status).toBe('open');
  });

  it('보낸 사이 초안으로 되가져가면 고치지 않고 건너뛴다', async () => {
    vi.useFakeTimers();
    const p = practice();
    const before = (await p.mem.docs.load(p.doc)).md;
    await p.handTo('11월 3~14일, 김민지');
    const st = await p.runs.start({ kind: 'handoff', feedbackIds: ['welcome-1'], mode: 'auto' });
    await vi.advanceTimersByTimeAsync(1000);
    await p.mem.feedback.update('welcome-1', { status: 'draft', waitingOn: 'owner' });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await p.runs.list()).find((r) => r.id === st.id)!.summary).toMatchObject({ skipped: 1, edited: 0 });
    expect((await p.mem.docs.load(p.doc)).md).toBe(before);
    expect(p.fb().status).toBe('draft');
  });

  it('"Claude 제안"(제안 종류)은 사람 차례여도 열린 피드백이면 맡는다', async () => {
    vi.useFakeTimers();
    const p = practice();
    expect(p.fb().waitingOn).toBe('owner');
    const st = await p.runs.start({ kind: 'propose', feedbackIds: ['welcome-1'], mode: 'propose' });
    await vi.advanceTimersByTimeAsync(3000);
    const r = (await p.runs.list()).find((x) => x.id === st.id)!;
    expect(r.summary!.skipped).toBe(0);
    expect(r.summary!.asked).toBe(1);   // 받은 값이 없으니 되묻는다
  });

  it('단추가 남긴 말(다시 열기·거절)은 값이 아니다 — Claude 가 답한 뒤 새 말이 없으면 되묻는다', async () => {
    vi.useFakeTimers();
    const p = practice();
    await p.handTo('11월 3~14일, 김민지');
    await p.run('propose');
    expect(p.fb().proposal!.state).toBe('pending');
    // 거절하고 다시 맡김 → 첫 빈칸이 "거절"로 채워지지 않는다
    const f = p.fb();
    await p.mem.feedback.update(f.id, { proposal: { ...f.proposal!, state: 'rejected' }, waitingOn: 'assistant', thread: [...f.thread, { author: { kind: 'human', id: 'u-0123456789' }, text: '거절', at: new Date().toISOString() }] });
    const { st } = await p.run();
    expect(st.summary).toMatchObject({ asked: 1, edited: 0 });
    expect((await p.mem.docs.load(p.doc)).md).not.toContain('| 거절 |');
  });

  it('줄바꿈·표 기호가 든 답도 표를 깨지 않는다', async () => {
    vi.useFakeTimers();
    const p = practice();
    await p.handTo('11월 3~14일\n김민지 | 기획');
    await p.run();
    const md = (await p.mem.docs.load(p.doc)).md;
    expect(md).toContain('| 시범 운영 | 11월 3~14일 | 기획팀 |');
    expect(md).toContain('| 전사 확대 | 다음 분기 | 김민지 \\| 기획 |');
  });

  it('그 밖의 요청은 지어서 고치지 않고 솔직히 답한다 — 문서는 그대로', async () => {
    vi.useFakeTimers();
    const p = practice();
    const before = (await p.mem.docs.load(p.doc)).md;
    const f = await p.mem.feedback.create({ docId: p.doc, target: { kind: 'section', path: ['연습용 기획서 — 사내 문서 검토 도우미', '배경'], heading: '배경' }, body: '더 짧게', status: 'open', waitingOn: 'assistant' } as never);
    const st = await p.runs.start({ kind: 'handoff', feedbackIds: [f.id], mode: 'auto' });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await p.runs.list()).find((r) => r.id === st.id)!.summary).toMatchObject({ answered: 1, edited: 0 });
    expect((await p.mem.docs.load(p.doc)).md).toBe(before);
    const g = p.mem.control.feedback().find((x) => x.id === f.id)!;
    expect([turnOf(g), g.result?.kind]).toEqual(['owner', 'answer']);
    expect(g.thread.at(-1)!.text).toMatch(/흉내.*이렇게 바꿔/);
  });

  it('"이렇게 바꿔"는 그 글로 고친다 — 고른 문구면 그 문구만, 다음 제목 앞 빈 줄은 그대로', async () => {
    vi.useFakeTimers();
    const p = practice();
    const sec = { kind: 'section' as const, path: ['연습용 기획서 — 사내 문서 검토 도우미', '배경'], heading: '배경' };
    const a = await p.mem.feedback.create({ docId: p.doc, target: sec, selector: { exact: '메신저와 메일로' }, body: '', suggestion: '메신저·메일·회의록으로', status: 'open', waitingOn: 'assistant' } as never);
    const st = await p.runs.start({ kind: 'handoff', feedbackIds: [a.id], mode: 'auto' });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await p.runs.list()).find((r) => r.id === st.id)!.summary).toMatchObject({ edited: 1 });
    let md = (await p.mem.docs.load(p.doc)).md;
    expect(md).toContain('검토할 때 메신저·메일·회의록으로 의견이 흩어져');
    expect(md).toContain('추적하기 어렵다.\n\n## 목표');
    // 섹션 본문을 통째로
    const b = await p.mem.feedback.create({ docId: p.doc, target: { kind: 'section', path: ['연습용 기획서 — 사내 문서 검토 도우미', '위험 요소'], heading: '위험 요소' }, body: '', suggestion: '- 원본은 지금 자리에 둔다', status: 'open', waitingOn: 'assistant' } as never);
    await p.runs.start({ kind: 'handoff', feedbackIds: [b.id], mode: 'auto' });
    await vi.advanceTimersByTimeAsync(3000);
    md = (await p.mem.docs.load(p.doc)).md;
    expect(md.endsWith('## 위험 요소\n\n- 원본은 지금 자리에 둔다\n')).toBe(true);
  });

  it('Claude 검토(선제안): 빈칸은 질문, 두 문장 문단은 목록 제안 — 작성자 Claude, 볼 것으로', async () => {
    vi.useFakeTimers();
    const p = practice();
    const st = await p.runs.start({ kind: 'review', feedbackIds: [], docIds: [p.doc], goal: 'suggest', mode: 'propose' });
    await vi.advanceTimersByTimeAsync(3000);
    const r = (await p.runs.list()).find((x) => x.id === st.id)!;
    expect(r.state).toBe('done');
    expect(r.created).toHaveLength(2);
    expect(r.overview).toMatch(/흉내.*빈칸 2곳/);
    const made = p.mem.control.feedback().filter((f) => r.created!.includes(f.id));
    const q = made.find((f) => !f.proposal)!;
    const sg = made.find((f) => f.proposal)!;
    expect([q.author.kind, turnOf(q), q.result?.kind, q.target]).toMatchObject(['assistant', 'owner', 'review', { heading: '일정' }]);
    expect(sg.proposal).toMatchObject({ state: 'pending', path: ['연습용 기획서 — 사내 문서 검토 도우미', '위험 요소'] });
    expect(sg.proposal!.after).toContain('- 문서 원본을 다른 곳으로 옮기면 관리 부담이 커진다.\n- 원본은 지금 자리 그대로 두어야 한다.');
    expect((await p.mem.docs.load(p.doc)).version).toBe('1');   // 문서는 그대로
  });

  it('읽기 정리: 빈칸 있는 섹션을 먼저, 나머지는 접기 — 문서·피드백은 그대로', async () => {
    vi.useFakeTimers();
    const p = practice();
    const n0 = p.mem.control.feedback().length;
    const st = await p.runs.start({ kind: 'review', feedbackIds: [], docIds: [p.doc], goal: 'view', mode: 'propose' });
    await vi.advanceTimersByTimeAsync(3000);
    const r = (await p.runs.list()).find((x) => x.id === st.id)!;
    const top = '연습용 기획서 — 사내 문서 검토 도우미';
    expect(r.view).toHaveLength(1);
    expect(r.view![0].focus).toEqual([top + ' › 일정']);
    expect(r.view![0].fold).toEqual(expect.arrayContaining([top + ' › 배경', top + ' › 위험 요소']));
    expect(r.view![0].guide).toMatch(/일정/);
    expect(p.mem.control.feedback()).toHaveLength(n0);
  });

  it('닫힌 피드백은 건너뛴다', async () => {
    vi.useFakeTimers();
    const p = practice();
    await p.mem.feedback.update('welcome-1', { status: 'resolved' });
    const { st } = await p.run();
    expect(st.summary).toMatchObject({ skipped: 1 });
  });
});
