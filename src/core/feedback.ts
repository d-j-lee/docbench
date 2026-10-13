/**
 * 피드백 모델 — 정규화·차례·집계·정렬.
 * 예전(작업대 v1) 행도 읽어서 같은 모양으로 맞춘다.
 */
import type { Feedback, FeedbackCategory, FeedbackLens, FeedbackResult, FeedbackStatus, Person, Severity, WaitingOn } from '../types';
import { makeKey, parseKey } from './source';

const SEV: Record<string, Severity> = { 높음: 'high', 중간: 'medium', 낮음: 'low', high: 'high', medium: 'medium', low: 'low', h: 'high', m: 'medium', l: 'low' };

const isoOr = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback);

// ---------------------------------------------------------------- 종류(D85)

/** 고정 종류 — 이 순서로 보인다(손으로 고치는 것 → 판단이 드는 것) */
export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = ['typo', 'fact', 'conflict', 'duplicate', 'gap', 'structure', 'clarity', 'risk', 'direction'];
export const isCategory = (v: unknown): v is FeedbackCategory => typeof v === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(v);

/** Claude 에게 주는 종류 풀이 — 실행 지시·스킬·아티팩트 문서가 같은 말을 쓴다 */
export const CATEGORY_GUIDE: Record<FeedbackCategory, string> = {
  typo: 'typos, spelling, spacing, punctuation or notation — a mechanical fix',
  fact: 'a fact, number, date or name that is wrong or outdated',
  conflict: 'disagrees with another place in this or another document — terms, numbers, rules, decisions',
  duplicate: 'the same content is said in more than one place',
  gap: 'something needed is missing — a blank, an unverified claim, an open question, a to-do',
  structure: 'order, grouping, headings, splitting or merging sections, where content lives',
  clarity: 'hard to read or ambiguous — wording, length, tone',
  risk: 'could cause harm if missed — security, legal, privacy, compliance, deadlines, reputation',
  direction: 'scope, purpose, strategy or the overall approach',
};
/** 프롬프트에 넣는 종류 목록 한 덩어리 */
export const categoryGuideLines = (): string[] => FEEDBACK_CATEGORIES.map((c) => `- ${c}: ${CATEGORY_GUIDE[c]}`);

/**
 * 예전 자유 꼬리표(0.1 사전 리뷰의 "사실 갱신"·"불일치" 등)에서 종류 짐작 — 앞의 것이 먼저. 화면 표시용이다:
 * 저장된 category 가 없으면 Claude 가 처리하며 붙인다(짐작과 다를 수 있다). 영어는 낱말 단위로(artifact·milestone 이 걸리지 않게)
 */
const INFER: [RegExp, FeedbackCategory][] = [
  [/누락|빈칸|할 ?일|확인 ?필요|질문 ?추가|\bmissing\b|\bgaps?\b|\bto-?dos?\b|\bblanks?\b/i, 'gap'],
  [/오탈|오타|맞춤법|띄어쓰기|표기 ?(?:오류|통일|법)|\btypos?\b|\bspelling\b|\bgrammar\b|\bpunctuation\b/i, 'typo'],
  [/중복|되풀이|\bduplicat|\bredundan/i, 'duplicate'],
  [/불일치|충돌|모순|어긋|용어|\bconflicts?\b|\binconsisten|\bmismatch|\bcontradict|\bterminology\b/i, 'conflict'],
  [/사실|갱신|수치|숫자|일정|날짜|낡은|\bfacts?\b|\boutdated\b|\baccura|\bnumbers?\b|\bdates?\b/i, 'fact'],
  [/구조|순서|배치|위생|\bstructur|\borgani[sz]|\blayout\b/i, 'structure'],
  [/명료|표현|문장|가독|어조|\bclarity\b|\bwording\b|\breadab|\btone\b|\bstyle\b/i, 'clarity'],
  // "주의"는 꼬리표 전체일 때만("주의 문구 다듬기"는 위험이 아니다)
  [/^\s*주의\s*$|리스크|위험|보안|법률|법적|법무|규정|개인정보|\brisks?\b|\bsecurity\b|\blegal\b|\bprivacy\b|\bcomplian/i, 'risk'],
  [/방향|전략|범위|목표|발표|\bdirection\b|\bstrategy\b|\bscope\b|\bgoals?\b/i, 'direction'],
];
export function inferCategory(kind?: string): FeedbackCategory | undefined {
  if (!kind) return undefined;
  if (isCategory(kind)) return kind;
  for (const [re, c] of INFER) if (re.test(kind)) return c;
  return undefined;
}
/** 보이는 종류 — 붙인 종류, 없으면 예전 꼬리표에서 짐작 */
export const categoryOf = (f: Pick<Feedback, 'category' | 'kind'>): FeedbackCategory | undefined => f.category || inferCategory(f.kind);

/** 골라 보기에 드는가 — 중요도가 없으면 보통으로, 종류가 없으면 'none' 으로 친다 */
export function lensMatch(f: Pick<Feedback, 'category' | 'kind' | 'severity'>, lens?: FeedbackLens | null): boolean {
  if (!lens) return true;
  if (lens.severity && SEV_RANK[f.severity || 'medium'] > SEV_RANK[lens.severity]) return false; // SEV_RANK: 높음 0 · 보통 1 · 낮음 2
  if (lens.cats?.length && !lens.cats.includes(categoryOf(f) || 'none')) return false;
  return true;
}
/** 무엇이든 걸러 내는 중인가(말풍선 켜기·끝난 것은 거르기가 아니다) */
export const lensFilters = (lens?: FeedbackLens | null): boolean => !!(lens && (lens.severity || lens.cats?.length));
/** 보기 상태에서 읽은 골라 보기 — 남이 쓸 수 있는 파일이라 모양을 확인한다 */
export function cleanLens(x: unknown): FeedbackLens | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const out: FeedbackLens = {};
  if (o.bubbles === true) out.bubbles = true;
  if (o.severity === 'medium' || o.severity === 'high') out.severity = o.severity;
  if (Array.isArray(o.cats)) { const cats = [...new Set(o.cats.filter((c): c is FeedbackCategory | 'none' => c === 'none' || isCategory(c)))]; if (cats.length) out.cats = cats; }
  if (o.closed === true) out.closed = true;
  return Object.keys(out).length ? out : undefined;
}

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
    // 예전 판의 category 는 자유 꼬리표였다 — 고정 종류가 아니면 꼬리표(kind)로 옮긴다
    kind: r.kind || (typeof r.category === 'string' && !isCategory(r.category) ? r.category : undefined) || undefined,
    category: isCategory(r.category) ? r.category : undefined,
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
