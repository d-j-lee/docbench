/**
 * Claude 결과 반영 — 한 벌의 규칙(D75). 앱·서버 엔진(server/runs.mjs), 터미널 Claude 의 결과 파일을 받는 화면·앱,
 * 연습 공간의 흉내 Claude 가 모두 이것을 쓴다. 저장소마다 다른 것은 ApplyHost 로만 넘긴다.
 *
 * 결과는 사람이 확인할 때까지 "볼 것"(open · waitingOn owner + result)에 남는다(D73):
 *   edit    → 문서를 고치고(판 비교·잠금·인코딩 보존은 host.writeDoc) result.change 에 전·후 판 — 되돌리기의 근거
 *   propose → proposal(전·후 글)을 붙인다
 *   answer · ask · decline → 회신만
 * 반영할 수 없는 결과(글이 비었거나 모양이 틀림)·Claude 가 빠뜨린 것·문서를 읽지 못한 것은 문서를 건드리지 않고
 *   볼 것에 result failed + 까닭(problem) — 보냄에 말없이 남지 않게(D79). 사람이 다시 보내거나 초안으로 가져간다.
 */
import type { Feedback, FeedbackResult, Person, ReadingPlan, RunLogLine, RunStartInput, RunSummary } from '../types';
import { findSection, getSectionText, keyToPath, replaceSection, sectionSources } from './source';
import { MAX_SECTION_CHARS } from './prompt';
import {
  MAX_DOC_CHARS, emptySummary, locateSectionKey, noteText, planReview, planRun,
  type PlannedAction, type ReviewContext, type RunAction, type RunContext, type RunItem,
} from './runs';

export interface HostDoc { id: string; md: string; version: string; readOnly?: boolean; readOnlyReason?: string }

/** 저장소(서버 Workspace · 브라우저 FolderWorkspace · 메모리)가 주는 것. 실패는 code 'CONFLICT' | 'BUSY' | 'READ_ONLY' | 'NOT_FOUND' 로 */
export interface ApplyHost {
  readDoc(id: string): Promise<HostDoc>;
  writeDoc(id: string, md: string, o: { baseVersion: string; summary?: string; feedbackIds?: string[]; by?: Person }): Promise<{ version: string; unchanged?: boolean }>;
  getFeedback(id: string): Promise<Feedback>;
  updateFeedback(id: string, patch: Partial<Feedback>, version?: number): Promise<Feedback>;
  createFeedback(input: Partial<Feedback>): Promise<Feedback>;
  log(line: Omit<RunLogLine, 'at'>): Promise<void>;
  titleOf?(id: string): Promise<string>;
  /** Claude 가 Read 로 열 절대 경로 (모르면 없음 — 그러면 프롬프트에 글을 넣는다) */
  docPath?(id: string): string | undefined;
  /** 화면에 바로 알릴 것(서버 안의 쓰기) */
  emit?(ev: { type: string; id?: string }): void;
  /** 이 작업 공간에서 늘 지킬 지시(기록 폴더 instructions.md, 주석 뺀 글) */
  standing?(): Promise<string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * 같은 글인가 — 줄바꿈 모양(CRLF)과 끝의 빈 줄만 빼고 그대로 비교한다. 공백을 뭉개 비교하면 사람이 문단을 나누거나
 * 들여쓰기·빈 줄을 바꾼 것을 "그대로"로 보고 덮는다(독립 검토에서 재현)
 */
const sameText = (a: string, b: string) => a.replace(/\r\n?/g, '\n').replace(/\s+$/, '') === b.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
const retryable = (e: unknown) => { const c = (e as { code?: string })?.code; return c === 'CONFLICT' || c === 'BUSY'; };
const now = () => new Date().toISOString();

type Req = RunStartInput & { id: string };

// ---------------------------------------------------------------- 맥락 만들기

/** 보낸 피드백(handoff·propose) → Claude 에게 줄 맥락. 처리할 수 없는 것은 skipped 로 */
export async function buildRunContext(host: ApplyHost, req: Req, o: { root: string; inline?: boolean }): Promise<{ ctx: RunContext; skipped: { id: string; reason: string }[] }> {
  const standing = (await host.standing?.().catch(() => '')) || '';
  const ctx: RunContext = { kind: req.kind, mode: req.mode || 'auto', root: o.root, items: [], docs: {}, ...(req.note ? { note: req.note } : {}), ...(standing ? { standing } : {}) };
  const skipped: { id: string; reason: string }[] = [];
  const titles = new Map<string, string>();
  const rows: Feedback[] = [];
  for (const id of req.feedbackIds) {
    let f: Feedback;
    try { f = await host.getFeedback(id); } catch { skipped.push({ id, reason: 'gone' }); continue; }
    if (f.status !== 'open' || (req.kind === 'handoff' && f.waitingOn !== 'assistant')) { skipped.push({ id, reason: 'not-waiting' }); continue; }
    if (req.kind === 'propose' && f.target.kind !== 'section') { skipped.push({ id, reason: 'not-section' }); continue; }
    rows.push(f);
  }
  // 급한 것 먼저 — 프롬프트 순서가 곧 우선순위
  const rank = (f: Feedback) => (f.severity === 'high' ? 0 : f.severity === 'medium' ? 1 : f.severity === 'low' ? 3 : 2);
  rows.sort((a, b) => rank(a) - rank(b));
  for (const f of rows) {
    const it: RunItem = { feedback: f, allowed: ['answer', 'ask', 'decline'] };
    if (f.docId && f.target.kind !== 'item') {
      let doc: HostDoc;
      try { doc = await host.readDoc(f.docId); } catch { skipped.push({ id: f.id, reason: 'no-doc' }); continue; }
      if (!titles.has(f.docId)) titles.set(f.docId, (await host.titleOf?.(f.docId).catch(() => f.docId)) || f.docId);
      ctx.docs[f.docId] ||= { md: doc.md, version: doc.version };
      it.docId = doc.id;
      it.docTitle = titles.get(f.docId);
      it.docPath = host.docPath?.(doc.id);
      it.docVersion = doc.version;
      // 설정으로 막은 문서는 고치지도 제안하지도 않는다. 인코딩 때문에 읽기 전용이면 제안만(사람이 UTF-8 변환에 동의하고 적용)
      const canChange: RunAction[] = !doc.readOnly ? ['edit', 'propose'] : doc.readOnlyReason === 'config' ? [] : ['propose'];
      const key = locateSectionKey(doc.md, f);
      if (key) {
        const text = getSectionText(doc.md, key);
        const s = findSection(doc.md, key);
        it.sectionKey = key;
        it.sectionLine = s ? doc.md.slice(0, s.start).split('\n').length : undefined;
        if (text != null && text.length > MAX_SECTION_CHARS) it.tooLarge = true;
        else { it.sectionText = text ?? undefined; it.allowed = [...canChange, ...it.allowed]; }
      } else if (f.target.kind === 'doc') {
        it.sectionKeys = sectionSources(doc.md).map((s) => s.key);
        if (doc.md.length <= MAX_DOC_CHARS && canChange.length) { it.wholeDoc = true; it.docText = doc.md; }
        if (it.sectionKeys.length || it.wholeDoc) it.allowed = [...canChange, ...it.allowed];
      }
      if (req.kind === 'propose') it.allowed = it.allowed.filter((a) => a !== 'edit');
      // 파일을 읽을 수 없는 Claude(터미널, 경로를 모름)에게는 섹션 글이 곧 전부다 — 문서 전체 피드백이면 문서 글도
      if (o.inline && f.target.kind === 'doc' && !it.docText && doc.md.length <= MAX_DOC_CHARS) it.docText = doc.md;
    }
    if (ctx.mode === 'propose') it.allowed = it.allowed.filter((a) => a !== 'edit');
    ctx.items.push(it);
  }
  return { ctx, skipped };
}

/** 선제안·읽기 정리 → 맥락 */
export async function buildReviewContext(host: ApplyHost, req: Req, o: { root: string }): Promise<{ ctx: ReviewContext; skipped: { id: string; reason: string }[] }> {
  const standing = (await host.standing?.().catch(() => '')) || '';
  const ctx: ReviewContext = { kind: 'review', goal: req.goal === 'view' ? 'view' : 'suggest', root: o.root, docs: [], ...(req.note ? { note: req.note } : {}), ...(standing ? { standing } : {}), ...(req.sections?.length ? { sections: req.sections } : {}) };
  const skipped: { id: string; reason: string }[] = [];
  for (const id of req.docIds || []) {
    let doc: HostDoc;
    try { doc = await host.readDoc(id); } catch { skipped.push({ id, reason: 'no-doc' }); continue; }
    const title = (await host.titleOf?.(id).catch(() => id)) || id;
    ctx.docs.push({ id: doc.id, title, md: doc.md, version: doc.version, path: host.docPath?.(doc.id), readOnly: !!doc.readOnly && doc.readOnlyReason === 'config' });
  }
  return { ctx, skipped };
}

// ---------------------------------------------------------------- 반영

/** Claude 가 결과에 빠뜨린 피드백의 까닭(볼 것 카드에 그대로 보인다) */
export const NO_ANSWER = 'Claude 가 이 피드백에 답하지 않았습니다';
/** 보낼 때 문서를 읽지 못한 피드백의 까닭 */
export const NO_DOC = '문서를 읽지 못했습니다 — 옮겼거나 지웠을 수 있습니다';

/** 피드백 하나를 고친다. 그 사이 사람이 닫았거나 되가져갔으면 'gone' */
async function updateFb(host: ApplyHost, req: Req, id: string, patchOf: (f: Feedback) => Partial<Feedback>): Promise<'ok' | 'gone'> {
  for (let i = 0; i < 3; i++) {
    let f: Feedback;
    try { f = await host.getFeedback(id); } catch { return 'gone'; }
    if (f.status !== 'open' || (req.kind === 'handoff' && f.waitingOn !== 'assistant')) return 'gone';
    try { await host.updateFeedback(id, patchOf(f), f.version); return 'ok'; } catch (e) {
      if (!retryable(e)) throw e;
      await sleep(120 * (i + 1));
    }
  }
  throw new Error('피드백이 계속 바뀌어 회신하지 못했습니다');
}

const resultOf = (kind: FeedbackResult['kind'], req: Req, extra: Partial<FeedbackResult> = {}): FeedbackResult => ({ kind, at: now(), run: req.id, ...extra });

/**
 * 반영하지 못한 것은 사람의 "볼 것"으로(결과 failed + 까닭) — 보냄에 말없이 남아 처리 중인지 잊혔는지 모르게 두지 않는다.
 * 사람이 거기서 다시 보내거나 초안으로 가져가 다듬는다. 그 사이 닫혔거나 되가져갔으면 건드리지 않는다
 */
async function markFailed(host: ApplyHost, req: Req, id: string, problem: string): Promise<'ok' | 'gone'> {
  // 보낸 묶음(handoff)만 — 한 건 제안(propose)은 이미 볼 것에 있는 피드백이라 그 결과(되돌리기의 근거 change)를 덮지 않는다
  if (req.kind !== 'handoff') return 'gone';
  try { return await updateFb(host, req, id, () => ({ waitingOn: 'owner', result: resultOf('failed', req, { problem: problem.slice(0, 500) }) })); } catch { return 'gone'; /* 기록(로그)만 남는다 */ }
}

/**
 * 맥락을 만들며 뺀 것 중 사람이 알아야 할 것(문서를 읽지 못함)은 볼 것에 못 함으로 — 요청을 맡긴 뒤 부른다.
 * 볼 것으로 옮긴 수를 돌려준다(요약에서 skipped 가 아니라 failed 로 센다)
 */
export async function failUnreadable(host: ApplyHost, req: Req, skipped: { id: string; reason: string }[]): Promise<number> {
  let n = 0;
  for (const s of skipped) if (s.reason === 'no-doc' && (await markFailed(host, req, s.id, NO_DOC)) === 'ok') n++;
  return n;
}

/** 한 항목 반영 */
async function applyOne(host: ApplyHost, req: Req, a: PlannedAction, actor: Person): Promise<RunAction | 'gone'> {
  const msg = (m: string, note?: PlannedAction['note']) => (m + (note ? ' ' + noteText(note) : '')).trim();
  const ref = { feedbackId: a.feedbackId, docId: a.docId, section: a.sectionKey };
  let action = a.action;
  let note = a.note;
  const whole = a.sectionKey === '*';

  if (action === 'edit' && a.docId && a.sectionKey && a.text != null) {
    // 사람이 그 사이 같은 곳을 고쳤으면 덮지 않고 제안으로. 다른 곳만 바뀌었으면 지금 판에 그대로 끼운다
    for (let i = 0; i < 3 && action === 'edit'; i++) {
      const doc = await host.readDoc(a.docId);
      const cur = whole ? doc.md : getSectionText(doc.md, a.sectionKey);
      if (cur == null || !sameText(cur, a.before || '')) { action = 'propose'; note = 'changed-meanwhile'; break; }
      const next = whole ? a.text : replaceSection(doc.md, a.sectionKey, a.text);
      if (next == null) { action = 'propose'; break; }
      // 피드백이 아직 보낸 상태인지 먼저 본다 — 닫힌 피드백 때문에 문서를 고치지 않게
      const f = await host.getFeedback(a.feedbackId).catch(() => null);
      if (!f || f.status !== 'open' || (req.kind === 'handoff' && f.waitingOn !== 'assistant')) return 'gone';
      try {
        const w = await host.writeDoc(a.docId, next, { baseVersion: doc.version, summary: a.message.slice(0, 200), feedbackIds: [a.feedbackId], by: actor });
        host.emit?.({ type: 'doc', id: a.docId });
        host.emit?.({ type: 'changes' });
        const change = { docId: a.docId, ...(whole ? {} : { section: a.sectionKey }), from: doc.version, to: w.version };
        const r = await updateFb(host, req, a.feedbackId, (fb) => ({ waitingOn: 'owner', result: resultOf('edit', req, { change }), thread: [...fb.thread, { author: actor, text: msg(a.message, note), at: now() }] }));
        await host.log({ k: 'apply.edit', v: { fb: a.feedbackId, doc: a.docId, section: whole ? '' : a.sectionKey }, ref });
        if (r === 'gone') await host.log({ k: 'warn', v: { message: '문서는 고쳤지만 그 사이 피드백이 바뀌어 회신은 남기지 못했습니다' }, ref });
        return 'edit';
      } catch (e) {
        const c = (e as { code?: string })?.code;
        if (c === 'READ_ONLY') { action = 'propose'; break; }
        if (!retryable(e)) throw e;
        await sleep(150 * (i + 1));
      }
    }
    if (action === 'edit') { action = 'propose'; note ||= 'changed-meanwhile'; }
  }

  if (action === 'propose' && a.sectionKey && a.text != null) {
    const r = await updateFb(host, req, a.feedbackId, (fb) => ({
      waitingOn: 'owner',
      proposal: { path: whole ? [] : keyToPath(a.sectionKey!), before: a.before || '', after: a.text!, rationale: a.message, author: actor, at: now(), state: 'pending' },
      result: resultOf('propose', req),
      thread: [...fb.thread, { author: actor, text: msg(a.message, note), at: now() }],
    }));
    if (r === 'gone') return 'gone';
    await host.log({ k: 'apply.propose', v: { fb: a.feedbackId, doc: a.docId || '', section: whole ? '' : a.sectionKey, note: note || '' }, ref });
    return 'propose';
  }
  if (action === 'propose') { action = 'ask'; note ||= 'no-section'; }

  const kind = action as 'answer' | 'ask' | 'decline';
  const r = await updateFb(host, req, a.feedbackId, (fb) => ({ waitingOn: 'owner', result: resultOf(kind, req), thread: [...fb.thread, { author: actor, text: msg(a.message, note), at: now() }] }));
  if (r === 'gone') return 'gone';
  await host.log({ k: 'apply.' + action, v: { fb: a.feedbackId, note: note || '', problem: a.problem || undefined }, ref, text: a.message });
  return action;
}

/** handoff·propose 결과(RUN_SCHEMA 모양) → 반영. 요약을 돌려준다 */
export async function applyRunOutput(host: ApplyHost, req: Req, ctx: RunContext, output: unknown, actor: Person): Promise<{ summary: RunSummary; overview: string }> {
  const summary = emptySummary();
  const plan = planRun(ctx, output);
  for (const a of plan.actions) {
    if (a.failed) {
      // 반영할 수 없는 결과(섹션을 자르는 글 등) — 볼 것에 까닭과 함께
      summary.failed++;
      await host.log({ k: 'applyFail', v: { fb: a.feedbackId, message: a.problem || a.failed }, ref: { feedbackId: a.feedbackId, docId: a.docId }, text: a.message });
      await markFailed(host, req, a.feedbackId, a.problem || a.failed);
      continue;
    }
    try {
      const r = await applyOne(host, req, a, actor);
      if (r === 'gone') { summary.skipped++; await host.log({ k: 'skip', v: { fb: a.feedbackId, reason: 'changed' }, ref: { feedbackId: a.feedbackId } }); continue; }
      summary[r === 'edit' ? 'edited' : r === 'propose' ? 'proposed' : r === 'answer' ? 'answered' : r === 'ask' ? 'asked' : 'declined']++;
    } catch (e) {
      summary.failed++;
      const message = String((e as Error)?.message || e).slice(0, 300);
      await host.log({ k: 'applyFail', v: { fb: a.feedbackId, message }, ref: { feedbackId: a.feedbackId, docId: a.docId } });
      await markFailed(host, req, a.feedbackId, message);
    }
  }
  for (const id of plan.missing) {
    await host.log({ k: 'skip', v: { fb: id, reason: 'no-answer' }, ref: { feedbackId: id } });
    // 볼 것에 "못 함"으로 올렸으면 실패로 센다(알림·카드가 같은 말을 하게). 그 사이 사람이 가져갔으면 건너뜀
    if ((await markFailed(host, req, id, NO_ANSWER)) === 'ok') summary.failed++; else summary.skipped++;
  }
  if (plan.summary) await host.log({ k: 'summary', text: plan.summary });
  return { summary, overview: plan.summary };
}

/**
 * 선제안 결과(REVIEW_SCHEMA 모양) → 피드백을 만든다(작성자 Claude, 볼 것). 읽기 정리는 돌려주기만 — 받아들이면 화면이 접기 상태에.
 * 제안은 지금 문서 글과 Claude 가 본 글이 같을 때만 그 글을 before 로 — 다르면 질문으로 바꾼다(남이 고친 것을 덮는 제안이 되지 않게)
 */
export async function applyReviewOutput(host: ApplyHost, req: Req, ctx: ReviewContext, output: unknown, actor: Person): Promise<{ summary: RunSummary; overview: string; created: string[]; view: ReadingPlan[] }> {
  const summary = emptySummary();
  const plan = planReview(ctx, output);
  const created: string[] = [];
  for (const d of plan.dropped) await host.log({ k: 'skip', v: { fb: d.docId || '', reason: d.why } });
  for (const c of plan.creates) {
    try {
      let kind = c.kind;
      let before = c.before;
      if (kind === 'suggest') {
        const doc = await host.readDoc(c.docId);
        const cur = c.sectionKey === '*' ? doc.md : getSectionText(doc.md, c.sectionKey);
        if (cur == null || !sameText(cur, before || '')) { kind = 'question'; before = undefined; }
      }
      const whole = c.sectionKey === '*';
      const target: Feedback['target'] = whole ? { kind: 'doc' } : (() => { const p = keyToPath(c.sectionKey); const m = / #(\d+)$/.exec(c.sectionKey); return { kind: 'section', path: p, heading: p[p.length - 1], ...(m ? { occurrence: Number(m[1]) } : {}) }; })();
      const f = await host.createFeedback({
        docId: c.docId, target, ...(c.quote ? { selector: { exact: c.quote } } : {}),
        title: c.title || undefined, body: c.message, author: actor, status: 'open', waitingOn: 'owner',
        result: { kind: 'review', at: now(), run: req.id },
        ...(kind === 'suggest' && before != null && c.text != null ? { proposal: { path: whole ? [] : keyToPath(c.sectionKey), before, after: c.text, rationale: c.message, author: actor, at: now(), state: 'pending' as const } } : {}),
      });
      created.push(f.id);
      summary.created++;
      if (kind === 'suggest') summary.proposed++; else summary.asked++;
      await host.log({ k: kind === 'suggest' ? 'review.suggest' : 'review.question', v: { fb: f.id, doc: c.docId, section: whole ? '' : c.sectionKey }, ref: { feedbackId: f.id, docId: c.docId, section: whole ? undefined : c.sectionKey }, text: c.title || c.message });
    } catch (e) {
      summary.failed++;
      await host.log({ k: 'applyFail', v: { fb: '', message: String((e as Error)?.message || e).slice(0, 300) }, ref: { docId: c.docId } });
    }
  }
  if (plan.view.length) await host.log({ k: 'review.view', v: { n: plan.view.reduce((n, p) => n + p.fold.length, 0) } });
  if (plan.overview) await host.log({ k: 'summary', text: plan.overview });
  return { summary, overview: plan.overview, created, view: plan.view };
}

// ---------------------------------------------------------------- 되돌리기

/**
 * Claude 가 바로 고친 것을 되돌린 문서. 그 뒤 그 자리가 또 바뀌었으면(지금 글 ≠ Claude 가 쓴 글) 저절로 되돌리지 않는다.
 * fromMd·toMd: 고치기 전·후 판의 문서 글. section 이 없으면 문서 전체
 */
export function planRevert(curMd: string, fromMd: string, toMd: string, section?: string): { md: string } | { problem: 'changed-after' | 'no-section' } {
  if (!section) return sameText(curMd, toMd) ? { md: fromMd } : { problem: 'changed-after' };
  const cur = getSectionText(curMd, section);
  const was = getSectionText(fromMd, section);
  const wrote = getSectionText(toMd, section);
  if (cur == null || was == null || wrote == null) return { problem: 'no-section' };
  if (!sameText(cur, wrote)) return { problem: 'changed-after' };
  const md = replaceSection(curMd, section, was);
  return md == null ? { problem: 'no-section' } : { md };
}
