/**
 * 시작하기(연습 공간)의 흉내 Claude (src/welcome.ts demoRuns) — 처음 쓰는 사람이 넘기기 한 바퀴를 직접 보게 한다.
 *  - 내용 없이 넘기면 지어내지 않고 되묻는다(사람 차례로)
 *  - 답글로 값을 주고 다시 넘기면 그 섹션의 빈칸을 채우고, 이력에 Claude 로 남는다
 *  - 제안만 방식이면 문서는 그대로, 카드에 고친 섹션을 제안으로
 *  - 로그 첫 줄은 시작, 끝 줄은 요약 — 화면 로그(run.log.*)와 같은 모양
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { welcomeContent, demoRuns } from '../../src/welcome';
import { createMemoryAdapters } from '../../src/adapters/memory';
import { buildManifest, mergeConfig, titleFromText } from '../../src/core/workspace';
import { turnOf } from '../../src/core/feedback';

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
    expect(p.fb().status).toBe('resolved');
    const ch = (await p.mem.docs.changes!()).filter((c) => c.docId === p.doc);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ by: { kind: 'assistant', name: 'Claude' }, feedbackIds: ['welcome-1'] });
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

  it('기다리는 사이 사람이 답글을 달면 낡은 사본으로 덮지 않고 건너뛴다', async () => {
    vi.useFakeTimers();
    const p = practice();
    await p.handTo('11월 3~14일, 김민지');
    const st = await p.runs.start({ kind: 'handoff', feedbackIds: ['welcome-1'], mode: 'auto' });
    await vi.advanceTimersByTimeAsync(1000);
    const f = p.fb();
    await p.mem.feedback.update(f.id, { thread: [...f.thread, { author: { kind: 'human', id: 'u-0123456789' }, text: '잠깐, 담당은 이지은', at: new Date().toISOString() }] });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await p.runs.list()).find((r) => r.id === st.id)!.summary).toMatchObject({ skipped: 1, edited: 0 });
    expect(p.fb().thread.at(-1)!.text).toBe('잠깐, 담당은 이지은');
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

  it('빈칸이 없는 섹션에는 끝에 한 줄 — 다음 제목 앞 빈 줄은 그대로', async () => {
    vi.useFakeTimers();
    const p = practice();
    const f = p.fb();
    await p.mem.feedback.update(f.id, { target: { kind: 'section', path: ['연습용 기획서 — 사내 문서 검토 도우미', '배경'], heading: '배경' } });
    await p.handTo('# 메일 대신 문서 댓글로');
    await p.run();
    const md = (await p.mem.docs.load(p.doc)).md;
    expect(md).toContain('추적하기 어렵다.\n\n- 메일 대신 문서 댓글로\n\n## 목표');
  });

  it('닫힌 피드백은 건너뛴다', async () => {
    vi.useFakeTimers();
    const p = practice();
    await p.mem.feedback.update('welcome-1', { status: 'resolved' });
    const { st } = await p.run();
    expect(st.summary).toMatchObject({ skipped: 1 });
  });
});
