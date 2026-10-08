/**
 * 피드백 모델 — 정규화·차례·집계·정렬.
 * 예전(작업대 v1) 행도 읽어서 같은 모양으로 맞춘다.
 */
import type { Feedback, FeedbackStatus, Person, Severity, WaitingOn } from '../types';
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
  let status: FeedbackStatus = r.status === 'done' ? 'resolved' : r.status === 'declined' ? 'declined' : r.status === 'resolved' ? 'resolved' : 'open';
  let waitingOn: WaitingOn;
  if (r.waitingOn === 'owner' || r.waitingOn === 'assistant') waitingOn = r.waitingOn;
  else if (r.turn === 'claude' || r.turn === 'assistant') waitingOn = 'assistant';
  else if (r.turn === 'dj' || r.turn === 'owner') waitingOn = 'owner';
  else waitingOn = author.kind === 'assistant' ? 'owner' : 'assistant';
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
    wasCollapsed: r.wasCollapsed || undefined,
    order: typeof r.order === 'number' ? r.order : undefined,
    createdAt: isoOr(r.createdAt, now),
    updatedAt: isoOr(r.updatedAt, isoOr(r.createdAt, now)),
  };
  return out;
}

export type Turn = 'owner' | 'assistant' | 'resolved' | 'declined';
export const turnOf = (f: Feedback): Turn => (f.status === 'open' ? f.waitingOn : f.status);

export function countTurns(rows: Feedback[]): Record<Turn, number> {
  const c: Record<Turn, number> = { owner: 0, assistant: 0, resolved: 0, declined: 0 };
  for (const r of rows) c[turnOf(r)]++;
  return c;
}

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
