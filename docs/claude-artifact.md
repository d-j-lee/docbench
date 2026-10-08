# claude.ai 아티팩트로 쓰기

로컬 서버 없이, claude.ai 의 비공개 아티팩트 한 장으로 같은 작업대를 연다. 사람은 브라우저(모바일 포함)에서 읽고 피드백하고,
대화 속 Claude 는 `ArtifactData` 도구로 같은 저장소를 읽고 쓴다. 런타임 계약 0.2.73 기준으로 검토했다.

## 만들기

1. 폴더 하나에 `docs/<id>.md`, `data/manifest.json`(스키마 2, `src/types.ts` 의 `Manifest`), 선택으로 `data/inventory.json`.
   문서 id 는 영문·숫자·`_-.` 로 짓는 것을 권한다(그대로 db 경로가 된다). 그 밖의 id 는 자동으로 `@base64url` 키가 된다.
2. 페이지 만들기: `npm run build` 후 `node examples/claude-artifact/assemble.mjs <폴더>/index.html "<제목>"`.
   CSS·스크립트가 인라인된 한 장(약 290 KB)이 나온다. 아티팩트 CSP 는 허용된 CDN 밖의 스크립트를 막기 때문이다.
3. Artifact 도구로 `index.html` 을 게시하면서 `files` 에 문서·데이터를 같이 싣고, 선언은
   `capabilities: { db: {}, user: {}, comments: {}, sample: {}, downloads: true }`.

## 저장소 모양 (db)

| 경로 | 내용 | 쓰는 쪽 |
|---|---|---|
| (게시 파일) `docs/<id>.md` | **기준본**. 처음 올린 원본 | 게시 |
| `docs/<key>` | **편집본** `{ docId, md, version, updatedAt, updatedBy }` — 있으면 기준본 위에 덮인다 | 화면 저장, Claude |
| `revisions/<key>~<n>` | 판 기록 `{ docId, version, md, at, by, summary }` — 문서마다 최근 30개 | 화면 저장, Claude |
| `changes/<auto>` | 변경 이력 `{ at, docId, by, summary, fromVersion, toVersion, feedbackIds, sections }` — 최근 600개 | 화면 저장, Claude |
| `feedback/<id>` | 피드백 (모양은 [FEEDBACK-PROTOCOL.md](FEEDBACK-PROTOCOL.md)) | 화면, Claude |
| `data/users/<uid>/viewstate` | 접기·깊이·마지막으로 본 판 — 본인만 읽는다 | 화면 |

- `key` = 문서 id 가 경로 한 칸 문법(`A-Z a-z 0-9 _ - . ~ : @ +`, 200바이트 이하)에 맞으면 그대로, 아니면 `'@' + base64url(UTF-8 id)`. 본문의 `docId` 가 원래 id 다.
- 사람은 공유 데이터에 **id 만** 남는다(`{ kind: 'human', id }`). 이름은 보는 사람마다 다르게 풀리므로 저장하지 않는다.
- 판(`version`)은 1부터 오르는 정수. 기준본은 판 `0`.
- 본문 한 건은 256 KiB 이하(한글 약 8만 자). 넘으면 화면이 저장을 막고 이유를 보여 준다.

## 화면이 하는 일

- **저장**: 짧은 임대(`acquire`)를 잡고 현재 판을 다시 읽어, 편집을 시작한 판과 다르면 충돌로 돌려보낸다. 같으면 판 기록 → 편집본 → 이력 순으로 쓴다.
  임대는 화면끼리만 맞춘다. Claude 의 `ArtifactData` 쓰기는 `if_version` 으로 따로 지킨다.
- **변경 알림**: `docs` 구독으로 다른 사람·Claude 의 저장을 받아 "바뀐 섹션"을 표시한다. 내 저장(확정 전)은 알리지 않는다.
- **Claude 제안**: `sample.json` 으로 그 섹션만 보내고 `{ after, rationale }` 를 받는다. 옛 뷰어(`capability_removed`)면 글로 받아 JSON 만 떼어 낸다.
- **Claude에게 넘기기**: 편집자면 `comments.sendToClaude` 로 이 대화에 요청을 남긴다(클릭에서만). 안 되면 요청 문구를 복사해 준다.
  전송 결과가 불확실한 오류면 중복을 막으려고 다시 보내지 않고 댓글 패널을 확인하라고 안내한다.

## Claude 가 피드백을 처리하는 법 (대화 세션)

1. `ArtifactData list feedback` → `status: open` 이고 `waitingOn: assistant` 인 것.
2. 대상 문서 읽기: `ArtifactData get docs/<key>` 가 있으면 그 `md`(판 = 본문 `version`), 없으면 `Artifact read path=docs/<id>.md`(판 0).
3. 섹션만 고친다. 섹션 경계·키 규칙은 DocBench 코어와 같아야 하니, 로컬에서 `dist/core.mjs` 의 `replaceSection` 을 쓴다:
   ```js
   import * as core from './dist/core.mjs';
   const next = core.replaceSection(md, core.sectionKeyOf(feedback), newSectionText);
   const d = core.diffSections(md, next);   // changes 의 sections
   ```
4. `ArtifactData batch` 한 번으로(모두 `if_version` 고정):
   - `set docs/<key>` `{ docId, md: next, version: v+1, updatedAt, updatedBy: { kind: 'assistant', name: 'Claude' } }`
   - `set revisions/<key>~<v+1>` `{ docId, version: v+1, md: next, at, by, summary }`
   - `set changes/<새 id>` `{ at, docId, by, summary, fromVersion: 'v', toVersion: 'v+1', feedbackIds, sections }`
   - `update feedback/<id>` `{ status: 'resolved', version: n+1, updatedAt, thread: [...기존, { author: Claude, text: 한두 문장, at }] }`
5. 되물을 때는 `update feedback/<id>` 로 `waitingOn: 'owner'` 와 질문 한 줄만.

화면이 열려 있으면 구독으로 바로 반영되고, 고친 섹션에 "바뀜" 표시가 뜬다.

## 한계

- 기준본(게시 파일)은 화면에서 바꾸지 않는다. 편집본을 기준본으로 굳히려면 Claude 가 게시 파일을 다시 올리고 `docs/<key>` 를 지운다.
- 공유 링크로 들어온 사람(로그인 안 함)은 db 가 없어 읽기 전용이고, 피드백은 그 브라우저에만 남는다.
- 실시간 공동 타이핑은 없다. 같은 섹션을 동시에 고치면 나중 저장이 충돌로 멈추고 차이를 보여 준다.
