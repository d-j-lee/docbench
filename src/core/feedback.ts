/**
 * 피드백 모델 — 정규화·차례·집계·정렬.
 * 예전(작업대 v1) 행도 읽어서 같은 모양으로 맞춘다.
 */
import type { Feedback, FeedbackResult, FeedbackStatus, Person, Severity, WaitingOn } from '../types';
import { makeKey, parseKey } from './source';

const SEV: Record<string, Severity> = { 높음: 'high', 중간: 'medium', 낮음: 'low', high: 'high', medium: 'medium', low: 'low', h: 'high', m: 'medium', l: 'low' };

const isoOr = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback);

/** 어떤 모양의 행이 와도 Feedback 으로 맞춘다. 예전 필드는 옮겨 담고, 모르는 필드는 버린다(저장소가 지저분해지지 않게) */
export function normalizeFeedback(raw: Record<string, any>, id?: string): Feedback {
  const now = new Date(0).toISOString();
  const r = { ...raw };
  const legacyBy = r.by as string | undefined;
  const author: Person = r.author && typeof r.author === 'object'
    ? r.author
    : legacyBy === 'claude' || legacyBy === 'assistant'
      ? { kind: 'assistant', name: 'Claude' }
      : { kind: 'human', name: legacyBy || undefined };
  const status: FeedbackStatus = r.status === 'done' ? 'resolved' : r.status === 'declined' ? 'declined' : r.status === 'resolved' ? 'resolved' : r.status === 'draft' ? 'draft' : 'open';
  let waitingOn: WaitingOn;
  if (r.waitingOn === 'owner' || r.waitingOn === 'assistant') waitingOn = r.waitingOn;
  else if (r.turn === 'claude' || r.turn === 'assistant') waitingOn = 'assistant';
  else if (r.turn === 'dj' || r.turn === 'owner') waitingOn = 'owner';
  else waitingOn = author.kind === 'assistant' ? 'owner' : 'assistant';
  // 초안은 아직 아무에게도 가지 않았다 — 디스크에도 owner 로 적어 옛 판(엔진·CLI·스킬)이 Claude 차례로 집어 가지 않게(D73)
  if (status === 'draft') waitingOn = 'owner';
  let target = r.target;
  if (!target || typeof target !== 'object') {
    if (r.path || r.heading) {
      const parsed = typeof r.path === 'string' ? parseKey(r.path) : { path: Array.isArray(r.path) ? r.path : [r.heading] as string[] };
      const path = parsed.path;
      target = { kind: 'section', path, heading: r.heading || path[path.length - 1], ...('occurrence' in parsed && parsed.occurrence ? { occurrence: parsed.occurrence } : {}) };
    } else if (r.doc === '_map' && r.target) target = { kind: 'item', itemId: String(r.target), label: r.heading };
    else target = { kind: 'doc' };
  }
  if (r.doc === '_map' && typeof raw.target === 'string') target = { kind: 'item', itemId: raw.target, label: r.heading };
  const selector = r.selector || (r.quote ? { exact: String(r.quote) } : undefined);
  const thread = Array.isArray(r.thread)
    ? r.thread.map((m: any) => ({
        author: m.author || (m.by === 'claude' ? { kind: 'assistant', name: 'Claude' } : { kind: 'human', name: m.by }),
        text: String(m.text ?? ''),
        at: isoOr(m.at, now),
      }))
    : [];
  const out: Feedback = {
    id: String(id ?? r.id),
    version: typeof r.version === 'number' ? r.version : undefined,
    docId: String(r.docId ?? r.doc ?? ''),
    target,
    selector,
    title: r.title || undefined,
    body: String(r.body ?? ''),
    kind: r.kind || r.category || undefined,
    severity: r.severity ? SEV[String(r.severity)] : undefined,
    status,
    waitingOn,
    author,
    thread,
    proposal: r.proposal || undefined,
    suggestion: typeof r.suggestion === 'string' && r.suggestion ? r.suggestion.slice(0, MAX_SUGGESTION) : undefined,
    result: cleanResult(r.result),
    // 사람 id 모양(이 PC 의 이름은 한글일 수 있다 — safeName 과 같은 글자들)
    drafter: status === 'draft' && typeof r.drafter === 'string' && /^[\p{L}\p{N}_.@:+-]{1,120}$/u.test(r.drafter) ? r.drafter : undefined,
    wasCollapsed: r.wasCollapsed || undefined,
    order: typeof r.order === 'number' ? r.order : undefined,
    createdAt: isoOr(r.createdAt, now),
    updatedAt: isoOr(r.updatedAt, isoOr(r.createdAt, now)),
  };
  return out;
}

/** "이렇게 바꿔" 글의 한도 — 섹션 하나 고칠 만큼 */
export const MAX_SUGGESTION = 60_000;
const RESULT_KINDS = ['edit', 'propose', 'answer', 'ask', 'decline', 'review', 'failed'] as const;

/** 결과 꼬리표 — 남이 쓸 수 있는 파일이라 모양을 확인해 옮긴다 */
function cleanResult(x: unknown): FeedbackResult | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const kind = RESULT_KINDS.find((k) => k === o.kind);
  if (!kind) return undefined;
  const s = (v: unknown, n = 200) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);
  const out: FeedbackResult = { kind, at: s(o.at, 40) || new Date(0).toISOString() };
  const run = s(o.run, 80); if (run) out.run = run;
  const rv = s(o.reverted, 40); if (rv) out.reverted = rv;
  const pr = s(o.problem, 500); if (pr) out.problem = pr;
  const c = o.change as Record<string, unknown> | undefined;
  if (c && typeof c === 'object' && s(c.docId) && s(c.from, 80) && s(c.to, 80)) out.change = { docId: s(c.docId, 400)!, ...(s(c.section, 2000) ? { section: s(c.section, 2000) } : {}), from: s(c.from, 80)!, to: s(c.to, 80)! };
  return out;
}

/**
 * 화면의 칸: draft(초안) · owner(볼 것 — 내 확인·답 필요) · assistant(보냄 — Claude 가 처리할 것) · resolved · declined.
 * open 은 waitingOn 을 따른다.
 */
export type Turn = 'draft' | 'owner' | 'assistant' | 'resolved' | 'declined';
export const turnOf = (f: Feedback): Turn => (f.status === 'open' ? f.waitingOn : f.status);

export function countTurns(rows: Feedback[]): Record<Turn, number> {
  const c: Record<Turn, number> = { draft: 0, owner: 0, assistant: 0, resolved: 0, declined: 0 };
  for (const r of rows) c[turnOf(r)]++;
  return c;
}

/**
 * 초안의 주인 — 마지막으로 말한 사람(답글로 이어 쓴 초안이면 그 사람), 없으면 작성자. Claude 가 올린 제안에 내가 답하면 내 초안이다
 */
export function draftOwner(f: Feedback): Person | null {
  if (f.drafter) return { kind: 'human', id: f.drafter };
  for (let i = f.thread.length - 1; i >= 0; i--) if (f.thread[i].author.kind === 'human') return f.thread[i].author;
  return f.author.kind === 'human' ? f.author : null;
}
/**
 * 내 초안인가 — 함께 쓰는 기록이면 남의 초안은 내 화면에서 거른다(보내기 전까지는 그 사람만의 메모).
 * 주인이 없는 초안(Claude 가 올린 것을 아무도 답하지 않고 다시 연 것)은 모두에게 보인다 — 아무도 못 보는 초안이 생기지 않게
 */
export const isMyDraft = (f: Feedback, me: Person): boolean => {
  if (f.status !== 'draft') return false;
  const o = draftOwner(f);
  return !o || !o.id || !me.id || o.id === me.id;
};

export const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function sortFeedback(rows: Feedback[], docOrder: string[]): Feedback[] {
  const di = (id: string) => { const i = docOrder.indexOf(id); return i < 0 ? 999 : i; };
  return rows.slice().sort((a, b) =>
    di(a.docId) - di(b.docId)
    || (a.severity ? SEV_RANK[a.severity] : 3) - (b.severity ? SEV_RANK[b.severity] : 3)
    || (a.order ?? 1e9) - (b.order ?? 1e9)
    || a.createdAt.localeCompare(b.createdAt));
}

/** 피드백이 가리키는 섹션 키 (같은 이름 제목이면 ' #n' 포함). 섹션 피드백이 아니면 null */
export function sectionKeyOf(f: Pick<Feedback, 'target'>): string | null {
  return f.target.kind === 'section' ? makeKey(f.target.path, f.target.occurrence) : null;
}

export function newFeedbackId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `fb-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}
