/**
 * AI 수정 제안 프롬프트 — 아티팩트(sample)와 로컬 서버(claude -p)가 같은 지시를 쓴다.
 * 응답은 { after, rationale } JSON 하나.
 */
import type { ProposeRequest } from '../types';
import { KEY_SEP } from './source';

export const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    after: { type: 'string', description: 'The full revised section in Markdown, starting with its heading line' },
    rationale: { type: 'string', description: 'One short sentence in the document language: what changed' },
  },
  required: ['after'],
  additionalProperties: false,
} as const;

/** 프롬프트에 넣을 섹션 길이 상한 (문자) */
export const MAX_SECTION_CHARS = 60000;

export function buildProposePrompt(req: ProposeRequest): string {
  const f = req.feedback;
  const thread = f.thread.slice(-6).map((m) => `- ${m.author.kind === 'assistant' ? 'AI' : m.author.name || 'reviewer'}: ${m.text}`).join('\n');
  // 잘라 보내면 돌아온 '전체 섹션'이 잘린 만큼 짧아지고, 적용하면 나머지가 지워진다 → 자르지 않고 거부한다
  if (req.sectionText.length > MAX_SECTION_CHARS) {
    throw Object.assign(new Error(`섹션이 너무 깁니다(${req.sectionText.length.toLocaleString()}자, 한도 ${MAX_SECTION_CHARS.toLocaleString()}자). 하위 섹션에 피드백을 달아 주세요.`), { code: 'TOO_LARGE' });
  }
  const section = req.sectionText;
  return [
    'You are editing ONE section of a Markdown document in response to reviewer feedback.',
    '',
    'Rules:',
    '- Change only what the feedback asks for. Keep every other character of the section identical: wording, numbers, tables, links, evidence tags such as [실측] or [미확인], list markers, blank lines.',
    '- The first line must stay the section heading line, unchanged unless the feedback explicitly asks to rename it.',
    '- Write in the language and tone the document already uses. Add no notes or comments inside the section.',
    '- Do not invent facts or numbers. If the feedback needs information you do not have, keep the text and say so in the rationale.',
    '- If the feedback cannot be applied to this section alone, return the section unchanged and explain why in the rationale.',
    '',
    'Reply with only a JSON object: {"after": "<full revised section markdown>", "rationale": "<one short sentence, document language>"}',
    '',
    `Document: ${req.docTitle}`,
    `Section path: ${req.sectionPath.join(KEY_SEP)}`,
    `Feedback${f.kind ? ` (${f.kind})` : ''}${f.severity ? ` [${f.severity}]` : ''}: ${f.title ? f.title + ' — ' : ''}${f.body}`,
    f.selector?.exact ? `Quoted text: "${f.selector.exact}"` : '',
    thread ? `Discussion so far:\n${thread}` : '',
    '',
    '--- SECTION START ---',
    section,
    '--- SECTION END ---',
  ].filter((l) => l !== '').join('\n');
}

/** 모델 응답을 검증해 {after, rationale} 로. 머리줄이 사라졌으면 거부한다 */
export function checkProposal(req: ProposeRequest, out: unknown): { after: string; rationale?: string } {
  const o = out as { after?: unknown; rationale?: unknown };
  if (!o || typeof o.after !== 'string' || !o.after.trim()) throw new Error('empty proposal');
  const after = o.after.replace(/\r\n?/g, '\n');
  const headIn = req.sectionText.split('\n')[0].trim();
  const headOut = after.split('\n')[0].trim();
  if (/^#{1,6}\s/.test(headIn) && !/^#{1,6}\s/.test(headOut)) throw new Error('proposal dropped the heading line');
  return { after, rationale: typeof o.rationale === 'string' ? o.rationale : undefined };
}
