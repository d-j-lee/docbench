/**
 * 처음 연 화면의 "시작하기" 작업 공간 (메모리, 저장하지 않음) — 이름·폴더를 묻기 전에 작업대가 어떻게 생겼는지 보고 만져 본다(D63).
 * 문서 두 개: 시작하기(무엇을·어떻게), 연습용 기획서(피드백·편집을 해 보는 곳). 예제 피드백 하나가 "차례"를 보여 준다.
 */
import type { DocBenchAdapters, Feedback, Person, RunLogLine, RunStatus, RunsAdapter, RunStartInput } from './types';
import type { MemoryControl } from './adapters/memory';
import { findSection } from './core/source';
import { locateSectionKey } from './core/runs';

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

## 2. 읽고 피드백하기

- 제목 깊이별로 접고 펼치며 읽습니다(키 \`1\` \`2\` \`3\`, 전부 \`0\`).
- 섹션 옆 말풍선이나 문구를 고른 뒤 **피드백**을 답니다. 사람 차례·Claude 차례가 나뉘어 다음에 누가 할지 보입니다.
- 섹션 단위로 바로 고칩니다. 그 사이 밖에서 바뀌었으면 차이를 보여 주고 고르게 합니다.

처음 저장할 때 **기록 폴더**(피드백·이력을 둘 곳)를 한 번 고릅니다. 문서 폴더에는 아무것도 만들지 않습니다.

## 3. Claude 와 함께

필요할 때 단계적으로 씁니다 — 처음부터 설치할 것은 없습니다.

| 단계 | 하는 일 | 준비 |
|---|---|---|
| 손으로 | 피드백을 Claude 차례로 넘기고, 터미널의 Claude Code 에서 \`/docbench-feedback\` | Claude Code |
| 이 화면에서 | **Claude 에게 넘기기**를 누르면 백그라운드로 처리하고 진행이 아래 창에 보입니다 | DocBench 앱 (문구 하나로 설치) |
| 대시보드에서 | 쓰던 대시보드의 탭으로 끼워 넣습니다 | DocBench 앱 + 연결 한 줄 |

Claude 는 내 **구독 로그인 그대로** 쓰고, API 키는 필요 없습니다. 읽기 도구만 받고 문서 폴더 밖에서 돌며, 고칠 내용은 작업대가 판을 비교해 반영합니다.

> 지금 이 연습 공간에서는 **흉내 Claude** 가 답합니다(실제로 보내지 않음). 연습용 기획서의 피드백을 Claude 차례로 넘기면, 되묻고 → 답글을 받아 → 고치는 흐름을 미리 볼 수 있습니다.

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

## 2. Read and give feedback

- Fold and unfold by heading depth (keys \`1\` \`2\` \`3\`, all \`0\`).
- Use the bubble next to a section, or select text, to leave **feedback**. Each item shows whose turn it is — yours or Claude's.
- Edit section by section. If the file changed outside meanwhile, you see the difference and choose.

The first time you save, choose a **records folder** (where feedback and history live) once. Nothing is created in your docs folder.

## 3. With Claude

Use it step by step when you need it — nothing to install up front.

| Level | What happens | Needs |
|---|---|---|
| By hand | Hand feedback to Claude, then run \`/docbench-feedback\` in Claude Code | Claude Code |
| From this page | **Hand to Claude** runs in the background; progress shows in the bottom panel | DocBench app (one prompt to install) |
| In a dashboard | Drop it into your dashboard as a tab | DocBench app + one line |

Claude runs on **your subscription login** — no API key. It gets read-only tools outside the docs folder; DocBench applies edits with version checks.

> In this practice space a **simulated Claude** answers (nothing is sent). Hand the practice plan's feedback to Claude to preview the flow: it asks back → you reply → it edits.

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
 * 시작하기(연습 공간)의 Claude 작업 — **흉내**다. 실제 Claude 를 부르지 않고 몇 초 뒤 정해진 방식으로 답한다:
 * 사람이 답글로 내용을 주었으면 그 섹션의 빈칸([TODO])을 차례로 채우거나 끝에 한 줄을 더하고, 내용이 없으면 되묻는다.
 * 처음 쓰는 사람이 "넘기기 → 진행 → 문서가 바뀜 → 카드 회신" 한 바퀴를 직접 보게 하려는 것(폰에서도 된다).
 * 화면·로그·회신 모두 "연습용(흉내)"라고 밝힌다 — 진짜 Claude 작업은 PC 에서 폴더를 열고 연결해야 한다.
 */
export function demoRuns(mem: DocBenchAdapters & { control: MemoryControl }, locale: 'ko' | 'en', actionTexts: string[]): RunsAdapter {
  const ko = locale === 'ko';
  const claude: Person = { kind: 'assistant', name: 'Claude' };
  const runs: (RunStatus & { lines: RunLogLine[] })[] = [];
  const now = () => new Date().toISOString();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const actions = new Set(actionTexts.map((x) => x.trim()));
  let seq = 0;

  /**
   * 사람이 Claude 의 마지막 말 뒤에 준 내용. 단추가 남기는 말(반영해·다시 열기·거절 …)은 내용이 아니다.
   * Claude 가 이미 답한 뒤 새 말이 없으면 비어 있다 — 지난 값을 다시 쓰지 않고 되묻는다.
   */
  const humanInput = (f: Feedback): string => {
    for (let i = f.thread.length - 1; i >= 0; i--) {
      const m = f.thread[i];
      if (m.author.kind === 'assistant') return '';
      const v = (m.text || '').trim();
      if (v && !actions.has(v)) return v;
    }
    return f.author.kind !== 'assistant' ? (f.body || '').trim() : '';
  };
  /** 받은 말을 마크다운 한 칸·한 줄로 — 표를 깨거나 제목을 끼워 넣지 않게 */
  const cell = (x: string) => x.replace(/\s+/g, ' ').replace(/^#+\s*/, '').replace(/\|/g, '\\|').trim().slice(0, 200);
  const fresh = (id: string) => mem.control.feedback().find((x) => x.id === id);

  async function work(st: RunStatus & { lines: RunLogLine[] }): Promise<void> {
    const log = (l: Omit<RunLogLine, 'at'>) => st.lines.push({ at: now(), ...l });
    const live = () => st.state === 'running';
    const t0 = Date.now();
    st.state = 'running'; st.startedAt = now(); st.progress = { phase: 'starting', at: now() };
    log({ k: 'start', v: { kind: st.kind, model: st.model || '', effort: st.effort || '', mode: st.mode, n: st.feedbackIds.length } });
    log({ k: 'demo' });
    await sleep(700);
    const sum = { edited: 0, proposed: 0, answered: 0, asked: 0, declined: 0, skipped: 0, failed: 0 };
    const docs = new Set<string>();
    // 진짜 엔진과 같은 조건: 넘기기는 Claude 차례인 열린 것만, 제안은 열린 것이면
    const ready = (f: Feedback | undefined) => !!f && f.status === 'open' && (st.kind !== 'handoff' || f.waitingOn === 'assistant');
    const skip = (id: string, reason: string) => { sum.skipped++; log({ k: 'skip', v: { fb: id, reason }, ref: { feedbackId: id } }); };
    for (const id of st.feedbackIds) {
      if (!live()) return;
      const f0 = fresh(id);
      if (!f0) { skip(id, 'gone'); continue; }
      if (!ready(f0)) { skip(id, 'not-waiting'); continue; }
      st.progress = { phase: 'reading', at: now() };
      if (f0.docId) { log({ k: 'read', v: { path: f0.docId } }); docs.add(f0.docId); }
      await sleep(900);
      if (!live()) return;   // 그 사이 멈췄으면 아무것도 고치지 않는다
      // 기다리는 동안 사람이 답글·적용·삭제를 했을 수 있다 — 다시 읽고, 판이 바뀌었으면 건너뛴다
      const f = fresh(id);
      if (!f || f.version !== f0.version || !ready(f)) { skip(id, f ? 'changed' : 'gone'); continue; }
      const input = humanInput(f);
      const md = f.docId ? (await mem.docs.load(f.docId)).md : null;
      if (!live()) return;
      const key = md != null ? locateSectionKey(md, f) : null;
      const s = md != null && key ? findSection(md, key) : null;
      if (!input || !s || md == null || !f.docId) {
        // 내용이 없으면 지어내지 않고 되묻는다 — 진짜 Claude 도 그렇게 한다. 섹션을 못 찾으면 그렇다고 말한다
        const msg = !s && input
          ? (ko ? '(연습용 흉내 Claude) 이 피드백이 가리키는 섹션을 찾지 못했습니다 — 제목이 바뀌었으면 그 섹션에 피드백을 다시 달아 주세요.' : '(Practice Claude, simulated) I could not find the section this feedback points to — if its heading changed, leave the feedback on that section again.')
          : (ko ? '(연습용 흉내 Claude) 채울 내용을 지어내지 않았습니다 — 진짜 Claude 도 근거 없는 값은 되묻습니다. 답글로 내용을 적어(예: 11월 3~14일, 김민지) 다시 넘겨 보세요. 그러면 문서를 고치는 것까지 보여 드릴게요.'
            : '(Practice Claude, simulated) I did not invent the values — the real Claude asks instead of guessing too. Reply with them (e.g. Nov 3–14, Kim) and hand it over again; then you will see the document change.');
        await mem.feedback.update(f.id, { waitingOn: 'owner', thread: [...f.thread, { author: claude, text: msg, at: now() }] });
        sum.asked++;
        log({ k: 'apply.ask', v: { fb: f.id }, text: msg, ref: { feedbackId: f.id, docId: f.docId } });
        continue;
      }
      st.progress = { phase: 'applying', at: now() };
      // 빈칸([TODO])을 사람이 준 값으로 차례로 채운다(쉼표·가운뎃점·줄바꿈으로 나눔). 빈칸이 없으면 섹션 끝에 한 줄(뒤의 빈 줄은 그대로)
      const body = md.slice(s.start, s.end);
      const parts = input.split(/\s*(?:[,，、·]|\n)\s*/).map(cell).filter(Boolean);
      let i = 0;
      let next = body.replace(/\[TODO\]/g, (m) => (i < parts.length ? parts[i++] : m));
      if (next === body) { const tail = /\n*$/.exec(body)![0]; next = body.slice(0, body.length - tail.length) + '\n\n- ' + parts.join(', ') + (tail || '\n'); }
      if (st.kind === 'propose' || st.mode === 'propose') {
        // 제안만: 문서는 그대로 두고 카드에 고친 섹션을 올린다(사람이 차이를 보고 적용·거절)
        const msg = ko ? '(연습용 흉내 Claude) 고친 섹션을 제안으로 올렸습니다 — 카드에서 차이를 보고 적용하거나 거절하세요.' : '(Practice Claude, simulated) I proposed the edited section — review the difference on the card and apply or reject it.';
        await mem.feedback.update(f.id, { waitingOn: 'owner', proposal: { path: s.path, before: body, after: next, rationale: msg, author: claude, at: now(), state: 'pending' }, thread: [...f.thread, { author: claude, text: msg, at: now() }] });
        sum.proposed++;
        log({ k: 'apply.propose', v: { fb: f.id, doc: f.docId, section: s.key }, ref: { feedbackId: f.id, docId: f.docId, section: s.key } });
        continue;
      }
      const summary = ko ? `(연습) 받은 내용을 "${s.title}" 에 넣었습니다` : `(practice) Put your answer into "${s.title}"`;
      mem.control.write(f.docId, md.slice(0, s.start) + next + md.slice(s.end), claude, summary, [f.id]);
      const msg = ko
        ? `(연습용 흉내 Claude) 받은 내용을 "${s.title}" 에 넣었습니다 — 문서에 바뀐 글이 표시됩니다. 진짜 Claude 는 문맥에 맞게 고치고, 판을 비교해 반영합니다.`
        : `(Practice Claude, simulated) Put your answer into "${s.title}" — the change is highlighted in the document. The real Claude edits in context and applies with version checks.`;
      await mem.feedback.update(f.id, { status: 'resolved', waitingOn: 'owner', thread: [...f.thread, { author: claude, text: msg, at: now() }] });
      sum.edited++;
      log({ k: 'apply.edit', v: { fb: f.id, doc: f.docId, section: s.key }, ref: { feedbackId: f.id, docId: f.docId, section: s.key } });
    }
    if (!live()) return;
    st.docs = [...docs];
    st.state = 'done'; st.endedAt = now(); st.progress = undefined; st.summary = sum;
    log({ k: 'done', v: { ms: Date.now() - t0, ...sum } });
  }

  const pub = (r: RunStatus & { lines: RunLogLine[] }): RunStatus => { const { lines: _l, ...rest } = r; void _l; return { ...rest }; };
  return {
    async status() {
      return {
        available: true,
        runner: { id: 'demo', kind: 'demo', user: '', host: ko ? '연습' : 'practice', pid: 0, version: '', protocol: 1, startedAt: '', seenAt: now(), claude: { ok: true, version: '' }, models: ['sonnet', 'opus', 'haiku'], efforts: ['low', 'medium', 'high'] },
        others: [],
      };
    },
    async start(input: RunStartInput) {
      const st: RunStatus & { lines: RunLogLine[] } = {
        id: `run-demo-${Date.now()}-${++seq}`, at: now(), runner: 'demo', by: undefined,
        kind: input.kind, feedbackIds: [...new Set(input.feedbackIds)], model: input.model, effort: input.effort, mode: input.mode || 'auto',
        state: 'queued', lines: [],
      } as RunStatus & { lines: RunLogLine[] };
      runs.unshift(st);
      void work(st).catch((e) => { st.state = 'failed'; st.error = String((e as Error)?.message || e); st.endedAt = now(); });
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
