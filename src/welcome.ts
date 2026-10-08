/**
 * 처음 연 화면의 "시작하기" 작업 공간 (메모리, 저장하지 않음) — 이름·폴더를 묻기 전에 작업대가 어떻게 생겼는지 보고 만져 본다(D63).
 * 문서 두 개: 시작하기(무엇을·어떻게), 연습용 기획서(피드백·편집을 해 보는 곳). 예제 피드백 하나가 "차례"를 보여 준다.
 */
import type { Feedback } from './types';

export interface WelcomeContent { docs: Record<string, string>; feedback: Partial<Feedback>[] }

const KO_START = `# DocBench 시작하기

사람과 Claude 가 **같은 문서**를 읽고, 피드백을 주고받고, 고친 이력을 남기는 작업대입니다.
문서는 이 PC 의 폴더에 그대로 있고, 어디로도 보내지 않습니다.

## 1. 폴더 열기

왼쪽 위 **작업 공간 이름**을 누르고 **폴더 열기**를 고르세요.

- 드라이브나 큰 폴더를 열어도 바로 뜹니다 — 탐색기처럼 **펼친 폴더만** 읽습니다.
- 마크다운(\`.md\`) 문서를 누르면 열립니다. 다른 파일은 흐리게 보입니다.
- 자주 보는 폴더·문서는 줄 끝의 핀으로 **고정**하면 위쪽 "작업 중"에 늘 있습니다.

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
      body: ko ? '시범 운영 기간과 확대 담당이 비어 있습니다. 채워 주시면 일정표를 다시 보겠습니다.' : 'The pilot dates and the owner for the roll-out are empty. Fill them in and I will look at the schedule again.',
      author: { kind: 'assistant', name: 'Claude' }, waitingOn: 'owner', status: 'open', severity: 'medium',
      thread: [], createdAt: now, updatedAt: now,
    }],
  };
}
