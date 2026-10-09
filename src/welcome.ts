/**
 * 처음 연 화면의 "시작하기" 작업 공간 (메모리, 저장하지 않음) — 이름·폴더를 묻기 전에 작업대가 어떻게 생겼는지 보고 만져 본다(D63).
 * 문서 두 개: 시작하기(무엇을·어떻게), 연습용 기획서(피드백·편집을 해 보는 곳). 예제 피드백 하나가 "차례"를 보여 준다.
 */
import type { DocBenchAdapters, Feedback, NewFeedback, Person, RunLogLine, RunStatus, RunsAdapter, RunStartInput } from './types';
import type { MemoryControl } from './adapters/memory';
import { KEY_SEP, sectionSources } from './core/source';
import { RUN_PROTOCOL, type ReviewContext, type RunContext } from './core/runs';
import { applyReviewOutput, applyRunOutput, buildReviewContext, buildRunContext, failUnreadable, type ApplyHost } from './core/apply';
import { standingInstructions } from './core/room';
import { titleFromText } from './core/workspace';

export interface WelcomeContent { docs: Record<string, string>; feedback: Partial<Feedback>[] }

const KO_START = `# DocBench 시작하기

사람과 Claude 가 **같은 문서**를 읽고, 피드백을 주고받고, 고친 이력을 남기는 작업대입니다.
문서는 이 PC 의 폴더에 그대로 있고, 어디로도 보내지 않습니다.

## 1. 폴더 열기

왼쪽 위 **작업 공간 이름**을 누르고 **폴더 열기**를 고르세요.

- 드라이브나 큰 폴더를 열어도 바로 뜹니다 — 탐색기처럼 **펼친 폴더만** 읽습니다.
- 마크다운(\`.md\`) 문서를 누르면 열립니다. 다른 파일은 흐리게 보입니다.
- 자주 보는 폴더·문서는 줄 끝의 핀으로 **고정**하면 위쪽 "작업 중"에 늘 있습니다.
- 휴대폰·태블릿 브라우저는 폴더에 쓰지 못해 **둘러보기와 연습**까지만 됩니다. 내 문서와 Claude 작업은 PC 의 엣지·크롬에서 여세요.

## 2. 읽으며 적어 두기

- 제목 깊이별로 접고 펼치며 읽습니다(키 \`1\` \`2\` \`3\`, 전부 \`0\`).
- 섹션 옆 말풍선을 누르거나 문구를 고르면 **그 자리에 작은 칸**이 열립니다. 적은 것은 **초안**으로 모이고 아직 아무에게도 가지 않습니다 — 읽어 가며 고치고, 지우고, 합치세요.
- 요청 문구가 고민되면 **이렇게 바꿔**로 바꿀 글을 직접 쓰거나 *줄이기·근거·표로* 같은 단추를 누르세요. 급한 것은 **★**.
- 직접 고쳐도 됩니다(섹션 단위). 그 사이 밖에서 바뀌었으면 차이를 보여 주고 고르게 합니다.

처음 저장할 때 **기록 폴더**(피드백·이력을 둘 곳)를 한 번 고릅니다. 문서 폴더에는 아무것도 만들지 않습니다.

## 3. Claude 와 주고받기

- 다 읽었으면 오른쪽 검토 패널의 **초안**에서 보낼 것을 고르고(★만 먼저도 됩니다), 묶음 전체에 붙일 말을 한 줄 적어 **보내기**. 하나씩 따로 가지 않고 한 번에 갑니다.
- **바로 고치기**(기본)면 Claude 가 문서를 고치고, **제안만**이면 고친 글을 제안으로 올립니다. 결과는 **볼 것**에 회차별로 모이고, 하나씩 확인·되돌리기·다시 요청을 고릅니다.
- 내가 다 읽기 전에 **Claude 검토**로 먼저 제안·질문을 받거나, 긴 문서를 **읽기 정리**(접을 곳·먼저 볼 곳)해 달라고 할 수도 있습니다.

| 연결 | 하는 일 | 준비 |
|---|---|---|
| 터미널 한 줄 | 보내면 명령 한 줄이 나옵니다. PowerShell 에 붙여 넣으면 Claude Code 가 기록 폴더에서 처리하고, 이 화면이 결과를 받아 반영합니다 | Claude Code (DocBench 설치 없음) |
| 이 화면에서 바로 | 백그라운드로 처리하고 진행이 아래 창에 보입니다 | DocBench 앱 (문구 하나로 설치) |
| 대시보드에서 | 쓰던 대시보드의 탭으로 끼워 넣습니다 | DocBench 앱 + 연결 한 줄 |

Claude 는 내 **구독 로그인 그대로** 씁니다(API 키 없음). 문서를 직접 고치지 않고 결과만 내며, 작업대가 판을 비교해 반영하고 이력을 남깁니다.

> 이 연습 공간에서는 **흉내 Claude** 가 답합니다(실제로 보내지 않음). 연습용 기획서의 질문 카드에 답하거나, "이렇게 바꿔"로 초안을 몇 개 만든 뒤 한 번에 보내 보세요 — 고침 → 볼 것 → 되돌리기까지 미리 볼 수 있습니다. 위의 **Claude 검토**도 눌러 보세요.

## 4. 이름과 계정

이름을 묻지 않습니다. 이 브라우저에 계정이 저절로 생기고, 오른쪽 위 **나**를 누르면 표시 이름을 정할 수 있습니다(여럿이 함께 쓸 때 서로 구분됩니다).
`;

const KO_SAMPLE = `# 연습용 기획서 — 사내 문서 검토 도우미

이 문서는 연습용입니다. 마음껏 피드백하고 고쳐 보세요(이 창을 닫으면 사라집니다).

## 배경

팀마다 기획서·운영 문서를 검토할 때 메신저와 메일로 의견이 흩어져, 무엇이 반영됐는지 추적하기 어렵다.

## 목표

- 검토 의견을 문서의 그 자리에 남긴다
- 다음에 누가 할 차례인지 한눈에 보인다
- 반영 이력이 문서 옆에 남는다

## 일정

| 단계 | 기간 | 담당 |
|---|---|---|
| 시범 운영 | [TODO] | 기획팀 |
| 전사 확대 | 다음 분기 | [TODO] |

## 위험 요소

문서 원본을 다른 곳으로 옮기면 관리 부담이 커진다. 원본은 지금 자리 그대로 두어야 한다.
`;

const EN_START = `# Getting started with DocBench

A workbench where people and Claude read **the same documents**, trade feedback, and keep a record of every change.
Documents stay in folders on this PC and are never sent anywhere.

## 1. Open a folder

Click the **workspace name** at the top left and choose **Open folder**.

- Even a whole drive opens instantly — like an explorer, only **expanded folders** are read.
- Click a Markdown (\`.md\`) document to open it; other files are dimmed.
- **Pin** folders and documents you use often; they stay under "Working on" at the top.
- Phone and tablet browsers cannot write to folders, so they are for **looking around and practice** only. Open your own documents and run Claude jobs in Edge or Chrome on a PC.

## 2. Read and jot down

- Fold and unfold by heading depth (keys \`1\` \`2\` \`3\`, all \`0\`).
- Click the bubble next to a section, or select text, and a **small box opens right there**. What you write collects as **drafts** — nothing goes anywhere yet. Edit, delete and merge them as you read.
- Not sure how to phrase it? Use **Rewrite as** to type the text you want, or tap *Shorter · Evidence · As table* and the like. Mark urgent ones with **★**.
- You can also edit directly (section by section). If the file changed outside meanwhile, you see the difference and choose.

The first time you save, choose a **records folder** (where feedback and history live) once. Nothing is created in your docs folder.

## 3. Back and forth with Claude

- When you are done reading, pick drafts in the review panel (or just the ★ ones first), add one line for the whole batch, and **Send**. They go together, not one by one.
- With **Edit directly** (default) Claude edits the documents; with **Suggest only** it proposes the edited text. Results collect under **To review**, round by round — confirm, revert or ask again per item.
- Before you read it all, ask **Claude review** for suggestions and questions first, or for a **reading plan** of a long document (what to fold, where to start).

| Connection | What happens | Needs |
|---|---|---|
| One terminal line | Sending shows a single command. Paste it into PowerShell; Claude Code handles it in the records folder and this page applies the result | Claude Code (no DocBench install) |
| Right here | Runs in the background; progress shows in the bottom panel | DocBench app (one prompt to install) |
| In a dashboard | Drop it into your dashboard as a tab | DocBench app + one line |

Claude runs on **your subscription login** — no API key. It never edits documents itself; it returns results, and DocBench applies them with version checks and keeps the history.

> In this practice space a **simulated Claude** answers (nothing is sent). Answer the question card on the practice plan, or make a few drafts with "Rewrite as" and send them together — you will see edit → To review → revert. Try **Claude review** above too.

## 4. Name and account

No name is asked. An account is created in this browser automatically; click **Me** at the top right to set a display name (useful when several people share a folder).
`;

const EN_SAMPLE = `# Practice plan — document review helper

This document is for practice. Leave feedback and edit freely (it disappears when you close this window).

## Background

Review comments on plans and runbooks scatter across chat and mail, so it is hard to see what was applied.

## Goals

- Leave review comments right where they apply
- See at a glance whose turn it is
- Keep the change history next to the document

## Schedule

| Phase | When | Owner |
|---|---|---|
| Pilot | [TODO] | Planning |
| Company-wide | Next quarter | [TODO] |

## Risks

Moving the originals elsewhere adds overhead. The originals must stay where they are.
`;

export function welcomeContent(locale: 'ko' | 'en'): WelcomeContent {
  const ko = locale === 'ko';
  const start = ko ? 'DocBench 시작하기.md' : 'Getting started.md';
  const sample = ko ? '연습용 기획서.md' : 'Practice plan.md';
  const now = new Date().toISOString();
  return {
    docs: { [start]: ko ? KO_START : EN_START, [sample]: ko ? KO_SAMPLE : EN_SAMPLE },
    feedback: [{
      id: 'welcome-1', docId: sample,
      target: { kind: 'section', path: [ko ? '연습용 기획서 — 사내 문서 검토 도우미' : 'Practice plan — document review helper', ko ? '일정' : 'Schedule'], heading: ko ? '일정' : 'Schedule' },
      body: ko
        ? '시범 운영 기간과 확대 담당이 비어 있습니다. 답글로 알려 주시면(예: 11월 3~14일, 김민지) 일정표에 넣겠습니다.'
        : 'The pilot dates and the roll-out owner are empty. Reply with them (e.g. Nov 3–14, Kim) and I will fill in the schedule.',
      author: { kind: 'assistant', name: 'Claude' }, waitingOn: 'owner', status: 'open', severity: 'medium',
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
          items.push({ feedbackId: f.id, action: change, text, message: P + (ko ? '적어 주신 글로 바꿨습니다. 진짜 Claude 는 앞뒤 문맥에 맞게 다듬습니다.' : 'Replaced it with the text you wrote. The real Claude also smooths it into the context.') });
          continue;
        }
      }
      // 2) 빈칸 채우기 — 쉼표·가운뎃점·줄바꿈으로 나눈 값을 차례로
      if (change && sec != null && sec.includes('[TODO]') && input) {
        const parts = input.split(/\s*(?:[,，、·]|\n)\s*/).map(cell).filter(Boolean);
        let i = 0;
        const text = sec.replace(/\[TODO\]/g, (m) => (i < parts.length ? parts[i++] : m));
        if (text !== sec) { items.push({ feedbackId: f.id, action: change, text, message: P + (ko ? '받은 값으로 빈칸을 채웠습니다 — 문서에 바뀐 글이 표시됩니다.' : 'Filled the blanks with your values — the change is highlighted in the document.') }); continue; }
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
          : (ko ? '빈칸이 없어 위에서부터 차례로 읽으면 됩니다. 긴 섹션은 접어 두었습니다.' : 'No blanks — read top to bottom. Long sections are folded.')) });
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
