/**
 * 처음 연 화면의 "시작하기" 작업 공간 (메모리, 저장하지 않음) — 이름·폴더를 묻기 전에 작업대가 어떻게 생겼는지 보고 만져 본다(D63).
 * 문서: 시작하기(무엇을·어떻게), 연습용 기획서(피드백·편집을 해 보는 곳), 활용 가이드 셋(직군별 활용·사용 팁·효용과 한계, D82).
 * 예제 피드백 둘: 값을 기다리는 질문(답하기), Claude 가 먼저 남긴 의견(반영해).
 */
import type { DocBenchAdapters, Feedback, NewFeedback, Person, RunLogLine, RunStatus, RunsAdapter, RunStartInput } from './types';
import type { MemoryControl } from './adapters/memory';
import { KEY_SEP, sectionSources } from './core/source';
import { RUN_PROTOCOL, type ReviewContext, type RunContext } from './core/runs';
import { applyReviewOutput, applyRunOutput, buildReviewContext, buildRunContext, failUnreadable, type ApplyHost } from './core/apply';
import { standingInstructions } from './core/room';
import { titleFromText } from './core/workspace';
// 연습 공간의 문서는 마크다운 파일 그대로(src/welcome/<언어>/*.md) — 빌드가 글로 싣는다(esbuild text 로더, vitest 는 같은 일을 하는 플러그인)
import koStart from './welcome/ko/start.md';
import koSample from './welcome/ko/sample.md';
import koUses from './welcome/ko/uses.md';
import koTips from './welcome/ko/tips.md';
import koValue from './welcome/ko/value.md';
import enStart from './welcome/en/start.md';
import enSample from './welcome/en/sample.md';
import enUses from './welcome/en/uses.md';
import enTips from './welcome/en/tips.md';
import enValue from './welcome/en/value.md';

export interface WelcomeContent { docs: Record<string, string>; feedback: Partial<Feedback>[] }

/** 문서 id(경로) — 활용 가이드는 폴더 하나에, 앞 숫자는 읽는 순서(제목은 문서의 첫 제목) */
export const WELCOME_DOCS = {
  ko: { start: 'DocBench 시작하기.md', sample: '연습용 기획서.md', uses: '활용 가이드/1 직군별 활용.md', tips: '활용 가이드/2 사용 팁.md', value: '활용 가이드/3 효용과 한계.md' },
  en: { start: 'Getting started.md', sample: 'Practice plan.md', uses: 'Guides/1 Uses by role.md', tips: 'Guides/2 Tips.md', value: 'Guides/3 Benefits and limits.md' },
} as const;

export function welcomeContent(locale: 'ko' | 'en'): WelcomeContent {
  const ko = locale === 'ko';
  const id = WELCOME_DOCS[locale];
  const now = new Date().toISOString();
  const top = ko ? '연습용 기획서 — 사내 문서 검토 도우미' : 'Practice plan — document review helper';
  const claude = { kind: 'assistant' as const, name: 'Claude' };
  return {
    docs: ko
      ? { [id.start]: koStart, [id.sample]: koSample, [id.uses]: koUses, [id.tips]: koTips, [id.value]: koValue }
      : { [id.start]: enStart, [id.sample]: enSample, [id.uses]: enUses, [id.tips]: enTips, [id.value]: enValue },
    feedback: [{
      // 값을 기다리는 질문 — 답하기로 값을 주고 보내면 빈칸을 채운다
      id: 'welcome-1', docId: id.sample,
      target: { kind: 'section', path: [top, ko ? '일정' : 'Schedule'], heading: ko ? '일정' : 'Schedule' },
      body: ko
        ? '시범 운영 기간과 확대 담당이 비어 있습니다. 답글로 알려 주시면(예: 11월 3~14일, 김민지) 일정표에 넣겠습니다.'
        : 'The pilot dates and the roll-out owner are empty. Reply with them (e.g. Nov 3–14, Kim) and I will fill in the schedule.',
      author: claude, waitingOn: 'owner', status: 'open', severity: 'medium',
      // 질문 카드로 보이게(답하기가 먼저) — 꼬리표 없이 두면 "Claude 의견"이 되어 반영해가 먼저 뜬다
      result: { kind: 'review', at: now },
      thread: [], createdAt: now, updatedAt: now,
    }, {
      // Claude 가 먼저 남긴 의견 — "반영해" 한 번이면 초안으로, 보내면 연습용 Claude 가 이 표로 고친다(바꿀 글은 suggestion 에)
      id: 'welcome-2', docId: id.sample,
      target: { kind: 'section', path: [top, ko ? '위험 요소' : 'Risks'], heading: ko ? '위험 요소' : 'Risks' },
      title: ko ? '위험과 대응을 표로' : 'Risks and responses as a table',
      body: ko
        ? '위험 요소가 한 문장뿐이라 회의에서 다루기 어렵습니다. 위험과 대응을 표로 나누면 어떨까요? 동의하면 반영해를 눌러 초안에 두었다가 보내 보세요.'
        : 'The risks section is a single sentence, which is hard to discuss in a meeting. How about a table of risks and responses? If you agree, press Do it, then send it with your drafts.',
      suggestion: ko
        ? '| 위험 | 대응 |\n|---|---|\n| 원본을 다른 곳으로 옮기면 관리 부담이 커진다 | 원본은 지금 자리에 두고, 의견과 이력만 따로 쌓는다 |\n| 반영됐는지 놓치는 의견이 생긴다 | 회차마다 볼 것에서 확인하고, 남은 것은 다시 보낸다 |'
        : '| Risk | Response |\n|---|---|\n| Moving the originals elsewhere adds overhead | Keep the originals where they are; store notes and history separately |\n| Some notes are never confirmed as applied | Check each round under To review and resend what is left |',
      author: claude, waitingOn: 'owner', status: 'open', severity: 'low',
      thread: [], createdAt: now, updatedAt: now,
    }],
  };
}

// ---------------------------------------------------------------- 연습용 Claude (흉내)

/**
 * 시작하기(연습 공간)의 Claude 작업 — **흉내**다. 실제 Claude 를 부르지 않고 몇 초 뒤 정해진 방식으로 결과를 만든다.
 * 결과 반영은 진짜와 **같은 규칙**(core/apply.ts, D75)으로 한다 — 판 비교·볼 것·되돌리기까지 그대로 보이게.
 *  - 보낸 초안: "이렇게 바꿔"는 그 글로 고치고, 빈칸([TODO])에 값을 준 답글은 빈칸을 채운다. 그 밖의 요청은 글을 이해하지 못한다고 솔직히 답한다
 *  - Claude 검토(선제안): 빈칸은 질문으로, 두 문장 이상인 문단은 목록으로 나누는 제안으로
 *  - 읽기 정리: 빈칸 있는 섹션을 먼저, 나머지는 접기
 * 화면·로그·회신 모두 "연습용(흉내)"라고 밝힌다 — 진짜 Claude 작업은 PC 에서 폴더를 열고 연결해야 한다.
 */
export function demoRuns(mem: DocBenchAdapters & { control: MemoryControl }, locale: 'ko' | 'en', actionTexts: string[]): RunsAdapter {
  const ko = locale === 'ko';
  const claude: Person = { kind: 'assistant', name: 'Claude' };
  const runs: (RunStatus & { lines: RunLogLine[] })[] = [];
  const now = () => new Date().toISOString();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const actions = new Set(actionTexts.map((x) => x.trim()));
  const P = ko ? '(연습용 흉내 Claude) ' : '(Practice Claude, simulated) ';
  let seq = 0;

  /** 사람이 Claude 의 마지막 말 뒤에 준 내용. 단추가 남기는 말은 내용이 아니다 */
  const humanInput = (f: Feedback): string => {
    for (let i = f.thread.length - 1; i >= 0; i--) {
      const m = f.thread[i];
      if (m.author.kind === 'assistant') return '';
      const v = (m.text || '').trim();
      if (v && !actions.has(v)) return v;
    }
    return f.author.kind !== 'assistant' ? (f.body || '').trim() : '';
  };
  /** 받은 말을 마크다운 한 칸으로 — 표를 깨거나 제목을 끼워 넣지 않게 */
  const cell = (x: string) => x.replace(/\s+/g, ' ').replace(/^#+\s*/, '').replace(/\|/g, '\\|').trim().slice(0, 200);

  const hostFor = (st: RunStatus & { lines: RunLogLine[] }): ApplyHost => ({
    async readDoc(id) { const c = await mem.docs.load(id); return { id, md: c.md, version: c.version }; },
    async writeDoc(id, md, o) {
      const cur = await mem.docs.load(id);
      if (cur.version !== o.baseVersion) throw Object.assign(new Error('conflict'), { code: 'CONFLICT' });
      if (st.state !== 'running') throw new Error('canceled');
      mem.control.write(id, md, claude, o.summary, o.feedbackIds);
      return { version: (await mem.docs.load(id)).version };
    },
    async getFeedback(id) { const f = mem.control.feedback().find((x) => x.id === id); if (!f) throw Object.assign(new Error('gone'), { code: 'NOT_FOUND' }); return f; },
    updateFeedback: (id, patch) => mem.feedback.update(id, patch),
    createFeedback: (input) => mem.feedback.create(input as NewFeedback),
    async log(l) { st.lines.push({ at: now(), ...l }); },
    async titleOf(id) { try { return titleFromText((await mem.docs.load(id)).md, id); } catch { return id; } },
    async standing() { return standingInstructions(await mem.instructions?.load()); },
  });

  /** 보낸 묶음 → RUN_SCHEMA 모양의 결과 */
  function simulateRun(ctx: RunContext): { items: { feedbackId: string; action: string; text: string; message: string; section?: string }[]; summary: string } {
    const items: { feedbackId: string; action: string; text: string; message: string; section?: string }[] = [];
    for (const it of ctx.items) {
      const f = it.feedback;
      const change = it.allowed.includes('edit') ? 'edit' : it.allowed.includes('propose') ? 'propose' : null;
      const sec = it.sectionText;
      const input = humanInput(f);
      // 1) 이렇게 바꿔 — 고른 문구면 그 문구만, 섹션이면 본문을
      if (f.suggestion != null && change && sec != null) {
        let text: string | null = null;
        if (f.selector?.exact) { if (sec.includes(f.selector.exact)) text = sec.replace(f.selector.exact, f.suggestion.trim()); }
        else { const head = sec.split('\n')[0]; const tail = /\n*$/.exec(sec)![0] || '\n'; text = head + '\n\n' + f.suggestion.trim() + tail; }
        if (text != null) {
          const mine = f.author.kind === 'assistant';
          items.push({ feedbackId: f.id, action: change, text, message: P + (mine
            ? (ko ? '제안한 글로 바꿨습니다. 마음에 들지 않으면 되돌리기 한 번이면 됩니다.' : 'Applied the suggested text. If you do not like it, one Revert undoes it.')
            : (ko ? '적어 주신 글로 바꿨습니다. 진짜 Claude 는 앞뒤 문맥에 맞게 다듬습니다.' : 'Replaced it with the text you wrote. The real Claude also smooths it into the context.')) });
          continue;
        }
      }
      // 2) 빈칸 채우기 — 쉼표·가운뎃점·줄바꿈으로 나눈 값을 차례로
      if (change && sec != null && sec.includes('[TODO]') && input) {
        const parts = input.split(/\s*(?:[,，、·]|\n)\s*/).map(cell).filter(Boolean);
        let i = 0;
        const total = (sec.match(/\[TODO\]/g) || []).length;
        const text = sec.replace(/\[TODO\]/g, (m) => (i < parts.length ? parts[i++] : m));
        if (text !== sec) {
          const rest = total - i;
          items.push({ feedbackId: f.id, action: change, text, message: P + (rest
            ? (ko ? `빈칸 ${total}곳 중 ${i}곳을 채웠습니다 — 나머지는 값을 쉼표로 나눠 더 보내 주세요.` : `Filled ${i} of ${total} blanks — send the rest as values separated by commas.`)
            : (ko ? '받은 값으로 빈칸을 채웠습니다 — 문서에 바뀐 글이 표시됩니다.' : 'Filled the blanks with your values — the change is highlighted in the document.')) });
          continue;
        }
      }
      // 3) 값을 기다리던 질문에 새 말이 없으면 되묻는다 — 지어내지 않는다
      if (!input) {
        items.push({ feedbackId: f.id, action: 'ask', text: '', message: P + (ko ? '채울 값을 지어내지 않았습니다 — 답글로 값을 적어(예: 11월 3~14일, 김민지) 다시 보내 주세요.' : 'I did not invent values — reply with them (e.g. Nov 3–14, Kim) and send again.') });
        continue;
      }
      // 4) 그 밖의 요청 — 흉내는 글을 이해하지 못한다. 솔직히 말하고 고침까지 보는 길을 알려 준다
      items.push({ feedbackId: f.id, action: 'answer', text: '', message: P + (ko
        ? `"${input.replace(/\s+/g, ' ').slice(0, 60)}" — 연습용 흉내라 요청 글을 이해하지는 못합니다. 진짜 Claude 는 이 요청대로 고칩니다. 고침·되돌리기를 보려면 "이렇게 바꿔"로 바꿀 글을 적어 보내 보세요.`
        : `"${input.replace(/\s+/g, ' ').slice(0, 60)}" — as a simulation I cannot understand requests. The real Claude edits as asked. To see edit and revert, write the new text with "Rewrite as" and send it.`) });
    }
    const n = items.filter((x) => x.action === 'edit' || x.action === 'propose').length;
    return { items, summary: P + (ko ? `${items.length}건 중 ${n}건을 고쳤습니다.` : `Changed ${n} of ${items.length}.`) };
  }

  /** 선제안·읽기 정리 → REVIEW_SCHEMA 모양의 결과 */
  function simulateReview(ctx: ReviewContext): { overview: string; items: Record<string, string>[]; view: { docId: string; fold: string[]; focus: string[]; guide: string }[] } {
    const items: Record<string, string>[] = [];
    const view: { docId: string; fold: string[]; focus: string[]; guide: string }[] = [];
    let blanks = 0, longs = 0;
    for (const d of ctx.docs) {
      const secs = sectionSources(d.md).filter((s) => s.level >= 2 && (!ctx.sections?.length || ctx.sections.some((k) => s.key === k || s.key.startsWith(k + KEY_SEP))));
      const leaf = secs.filter((s) => !secs.some((o) => o !== s && o.key.startsWith(s.key + KEY_SEP)));
      const todo = leaf.filter((s) => d.md.slice(s.start, s.end).includes('[TODO]'));
      if (ctx.goal === 'view') {
        const rest = leaf.filter((s) => !todo.includes(s));
        view.push({ docId: d.id, fold: rest.map((s) => s.key), focus: todo.map((s) => s.key), guide: P + (todo.length
          ? (ko ? `빈칸이 있는 "${todo.map((s) => s.title).join('", "')}"부터 보세요. 나머지는 접어 두었습니다.` : `Start with "${todo.map((s) => s.title).join('", "')}" — it has blanks. The rest is folded.`)
          : (ko ? '빈칸이 없어 모두 접었습니다 — 목차처럼 훑고 필요한 곳만 펼치세요.' : 'No blanks, so everything is folded — skim it like an outline and open what you need.')) });
        continue;
      }
      for (const s of todo) {
        const n = (d.md.slice(s.start, s.end).match(/\[TODO\]/g) || []).length;
        blanks += n;
        items.push({ docId: d.id, section: s.key, kind: 'question', title: ko ? `빈칸 ${n}곳` : `${n} blank(s)`, message: P + (ko ? '이 섹션에 빈칸([TODO])이 있습니다. 값을 답글로 주시면 채우겠습니다.' : 'This section has blanks ([TODO]). Reply with the values and I will fill them in.'), quote: '[TODO]', text: '' });
      }
      for (const s of leaf) {
        if (d.readOnly) break;
        const sec = d.md.slice(s.start, s.end);
        const lines = sec.split('\n');
        const idx = lines.findIndex((l, i) => i > 0 && /^[^\s#|>\-*\d`]/.test(l) && (l.match(/[.!?。]\s+\S/g) || []).length >= 1);
        if (idx < 0) continue;
        const sentences = lines[idx].split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean);
        if (sentences.length < 2) continue;
        const text = [...lines.slice(0, idx), ...sentences.map((x) => '- ' + x), ...lines.slice(idx + 1)].join('\n');
        longs++;
        items.push({ docId: d.id, section: s.key, kind: 'suggest', title: ko ? '문장을 목록으로' : 'Sentences as a list', message: P + (ko ? '두 문장 이상인 문단을 목록으로 나누면 한눈에 읽힙니다. 진짜 Claude 는 내용을 보고 제안합니다.' : 'Splitting this paragraph into a list makes it scannable. The real Claude suggests based on the content.'), text });
        if (longs >= 2) break;
      }
    }
    const overview = P + (ctx.goal === 'view'
      ? (ko ? `문서 ${ctx.docs.length}개의 읽기 순서를 정리했습니다.` : `Made a reading plan for ${ctx.docs.length} document(s).`)
      : (ko ? `문서 ${ctx.docs.length}개를 훑었습니다 — 빈칸 ${blanks}곳, 목록으로 나눌 만한 문단 ${longs}곳.` : `Skimmed ${ctx.docs.length} document(s): ${blanks} blank(s), ${longs} paragraph(s) worth splitting.`));
    return { overview, items, view };
  }

  async function work(st: RunStatus & { lines: RunLogLine[] }, input: RunStartInput): Promise<void> {
    const host = hostFor(st);
    const log = (l: Omit<RunLogLine, 'at'>) => st.lines.push({ at: now(), ...l });
    const t0 = Date.now();
    st.state = 'running'; st.startedAt = now(); st.progress = { phase: 'starting', at: now() };
    log({ k: 'start', v: { kind: st.kind, model: st.model || '', effort: st.effort || '', mode: st.mode, n: st.kind === 'review' ? (input.docIds?.length || 0) : st.feedbackIds.length } });
    log({ k: 'demo' });
    await sleep(600);
    const req = { ...input, id: st.id };
    st.progress = { phase: 'reading', at: now() };
    if (input.kind === 'review') {
      const { ctx, skipped } = await buildReviewContext(host, req, { root: '' });
      for (const d of ctx.docs) log({ k: 'read', v: { path: d.id } });
      for (const s of skipped) log({ k: 'skip', v: { fb: s.id, reason: s.reason } });
      await sleep(1200);
      if (st.state !== 'running') return;
      st.progress = { phase: 'applying', at: now() };
      const r = await applyReviewOutput(host, req, ctx, simulateReview(ctx), claude);
      if (st.state !== 'running') return;
      st.docs = ctx.docs.map((d) => d.id);
      Object.assign(st, { summary: r.summary, overview: r.overview, created: r.created, view: r.view });
    } else {
      const { ctx, skipped } = await buildRunContext(host, req, { root: '', inline: true });
      for (const s of skipped) log({ k: 'skip', v: { fb: s.id, reason: s.reason }, ref: { feedbackId: s.id } });
      const lost = await failUnreadable(host, req, skipped);
      for (const d of Object.keys(ctx.docs)) log({ k: 'read', v: { path: d } });
      await sleep(1200);
      if (st.state !== 'running') return;   // 그 사이 멈췄으면 아무것도 고치지 않는다
      st.progress = { phase: 'applying', at: now() };
      const r = await applyRunOutput(host, req, ctx, simulateRun(ctx), claude);
      if (st.state !== 'running') return;
      r.summary.skipped += skipped.length - lost;
      r.summary.failed += lost;
      st.docs = Object.keys(ctx.docs);
      Object.assign(st, { summary: r.summary, overview: r.overview });
    }
    st.state = 'done'; st.endedAt = now(); st.progress = undefined;
    log({ k: 'done', v: { ms: Date.now() - t0, ...st.summary } });
  }

  const pub = (r: RunStatus & { lines: RunLogLine[] }): RunStatus => { const { lines: _l, ...rest } = r; void _l; return { ...rest }; };
  return {
    async status() {
      return {
        available: true,
        runner: { id: 'demo', kind: 'demo', user: '', host: ko ? '연습' : 'practice', pid: 0, version: '', protocol: RUN_PROTOCOL, startedAt: '', seenAt: now(), claude: { ok: true, version: '' }, models: ['sonnet', 'opus', 'haiku'], efforts: ['low', 'medium', 'high'] },
        others: [],
      };
    },
    async start(input: RunStartInput) {
      const st: RunStatus & { lines: RunLogLine[] } = {
        id: `run-demo-${Date.now()}-${++seq}`, at: now(), runner: 'demo', by: undefined,
        kind: input.kind, feedbackIds: [...new Set(input.feedbackIds)], model: input.model, effort: input.effort, mode: input.mode || 'auto',
        ...(input.note ? { note: input.note } : {}), ...(input.docIds ? { docIds: input.docIds } : {}), ...(input.goal ? { goal: input.goal } : {}), ...(input.sections ? { sections: input.sections } : {}),
        state: 'queued', lines: [],
      } as RunStatus & { lines: RunLogLine[] };
      runs.unshift(st);
      void work(st, input).catch((e) => { st.state = 'failed'; st.error = String((e as Error)?.message || e); st.endedAt = now(); });
      return pub(st);
    },
    async cancel(id) {
      const r = runs.find((x) => x.id === id);
      if (r && (r.state === 'queued' || r.state === 'running')) { r.state = 'canceled'; r.endedAt = now(); r.lines.push({ at: now(), k: 'canceled' }); }
    },
    async list(limit = 20) { return runs.slice(0, limit).map(pub); },
    async log(id, from) {
      const r = runs.find((x) => x.id === id);
      const lines = r ? r.lines.slice(from) : [];
      return { lines, next: from + lines.length };
    },
  };
}
