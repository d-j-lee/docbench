/**
 * DocBench 공개 타입.
 *
 * 화면(UI)은 아래 어댑터 인터페이스만 안다. 저장소·인증·AI가 무엇이든
 * 이 계약을 지키는 어댑터를 넘기면 같은 화면이 동작한다.
 */

// ---------------------------------------------------------------- 매니페스트

export type Tone = 'good' | 'info' | 'neutral' | 'warn' | 'bad' | 'accent';

export interface Manifest {
  schema: 2;
  project: {
    name: string;
    subtitle?: string;
    links?: { label: string; url: string }[];
    /** 기록(피드백·이력)이 있는 자리 — 화면 아래에 "기록: …" 으로 보인다 (D57) */
    storage?: string;
  };
  /** 상단 바의 D-day. 대시보드 안에서는 보통 비운다. */
  milestones?: { date: string; label: string; kind?: 'official' | 'plan'; source?: string }[];
  /** 문서 신뢰 등급 표시(정본·운영·참고 등). 키는 DocMeta.trust 와 맞춘다. */
  trust?: Record<string, { label: string; desc?: string; tone?: Tone }>;
  groups: DocGroup[];
  docs: Record<string, DocMeta>;
  render?: RenderRules;
  /** 화면 문구 중 AI 쪽 이름. 예: "Claude" */
  assistantName?: string;
  /**
   * 작업 폴더의 실제 폴더 구조 (상대 경로 → 그 폴더 바로 아래 문서가 아닌 파일 수). '' = 맨 위.
   * 있으면 왼쪽 목록을 탐색기처럼 폴더 나무로 그리고, 문서가 없는 폴더도 흐리게 보여 준다.
   */
  folders?: Record<string, { files: number }>;
  /** 작업 폴더 이름 (나무 맨 위) */
  rootName?: string;
  /**
   * 문서 목록(docs)을 얼마나 찾았나. 큰 폴더(드라이브 등)는 열 때 전부 훑지 않는다 — 펼친 폴더의 문서는 tree() 가 더한다.
   * complete = 전부 찾음, reason: big-root = 드라이브·홈처럼 커서 맨 위만, many = 찾다가 한도(시간·개수)에 닿음
   */
  index?: { complete: boolean; docs: number; reason?: 'big-root' | 'many' };
  /** 이 작업 공간이 무엇을 위한 곳인가 — 함께 쓰는 설정 config.json 의 purpose (없으면 개요가 맨 위 README 에서 읽는다, D88) */
  purpose?: string;
}

/** 폴더 나무의 한 항목 (DocSource.tree) — 탐색기처럼 펼친 폴더만 읽는다 */
export interface TreeEntry {
  name: string;
  /** 작업 폴더 기준 '/' 경로 */
  path: string;
  kind: 'dir' | 'file';
  /** 작업대가 여는 문서인가 (등록된 형식 — core/formats) */
  doc?: boolean;
  size?: number;
  modified?: string;
}

export interface DocGroup {
  id: string;
  label: string;
  note?: string;
  docs: string[];
  /** 'map' = 폴더 지도, 'changes' = 변경 이력 */
  views?: ('map' | 'changes')[];
  collapsed?: boolean;
}

export interface DocMeta {
  title: string;
  /** 형식 이름 (core/formats — markdown · yaml · csv · code · docx · image …). 없으면 마크다운 */
  format?: string;
  /** 문서 앞머리 YAML 의 값(상태·담당·꼬리표·검토일 …) — 앞부분을 읽은 문서만 (D88) */
  meta?: Record<string, string | string[]>;
  role?: string;
  audience?: string;
  trust?: string;
  /** 처음 열 때 펼칠 제목 깊이. 2 = h2 까지 보이고 그 아래는 접힘. 9 = 모두 펼침 */
  depth?: number;
  /** 문서 위에 띄우는 안내(주의 문구 등) */
  notice?: { text: string; tone?: Tone };
  source?: {
    label?: string;
    path?: string;
    url?: string;
    size?: number;
    modified?: string;
    encoding?: string;
    eol?: 'lf' | 'crlf';
  };
  readOnly?: boolean;
}

export interface RenderRules {
  /** 근거 표기 칩. pattern 은 `[` `]` 를 포함한 인라인 코드 전체에 맞춘다 */
  tags?: { pattern: string; tone: Tone }[];
  /** 채워야 할 빈칸 표기 (형광 표시·집계) */
  placeholders?: string[];
  /** 굵은 이름표가 몇 번 이상 반복되면 이름표 칩을 띄울지 */
  labelMinRepeat?: number;
}

// ---------------------------------------------------------------- 문서

export interface DocContent {
  id: string;
  /** 줄바꿈은 항상 LF. 원래 줄바꿈·인코딩은 저장소가 기억해 되살린다 */
  md: string;
  /** 낙관적 동시성용 버전. 해시든 정수든 저장소가 정한다 */
  version: string;
  updatedAt?: string;
  updatedBy?: Person;
  readOnly?: boolean;
  /**
   * 읽기 전용인 이유 — 'encoding'·'invalid-utf8'(사람이 동의하면 UTF-8 로) · 'config'(설정) · 'folder'(폴더에 쓸 수 없음) ·
   * 'format'(뽑은 글·미리보기 — 원본 형식은 고치지 않는다) · 'too-large'(글이 커서 앞부분만 보임)
   */
  readOnlyReason?: string;
  encoding?: string;
  /** 형식 이름 (core/formats) — 없으면 문서 id 의 확장자로, 그것도 없으면 마크다운 */
  format?: string;
  /** 글이 한도보다 커서 앞부분만 실었다 (bytes = 실은 바이트, total = 파일 크기) */
  truncated?: { bytes: number; total: number };
  /** 미리보기 형식(그림·PDF)이나 글을 뽑은 형식의 원본 — 바이트는 DocSource.loadBytes 로 */
  binary?: { mime?: string; size: number };
  /** 글을 뽑지 못했다(깨졌거나 암호가 걸린 파일 등) — 사람이 읽을 까닭 */
  deriveError?: string;
}

export interface SaveOptions {
  baseVersion: string;
  summary?: string;
  feedbackIds?: string[];
  /** 레거시 인코딩 파일을 UTF-8 로 바꿔 저장하는 데 사용자가 동의했을 때 */
  convertTo?: 'utf-8';
}

export interface SaveResult {
  version: string;
  updatedAt?: string;
}

export class DocConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(public current: DocContent) {
    super('document changed since it was loaded');
  }
}

export class DocReadOnlyError extends Error {
  readonly code = 'READ_ONLY';
  constructor(public reason: string, message?: string) {
    super(message || reason);
  }
}

export interface ChangeEntry {
  id?: string;
  at: string;
  docId: string;
  by?: Person;
  summary?: string;
  fromVersion?: string;
  toVersion?: string;
  feedbackIds?: string[];
  /** 바뀐·새 섹션 키 */
  sections?: string[];
  /** 없어진 섹션 키 */
  removed?: string[];
}

export interface DocEvent {
  /** runs = Claude 작업(요청·상태·로그)이 바뀜, runner = 실행기가 켜지거나 꺼짐 */
  type: 'doc' | 'manifest' | 'changes' | 'feedback' | 'request' | 'runs' | 'runner';
  id?: string;
}

export interface DocSource {
  manifest(): Promise<Manifest>;
  load(id: string): Promise<DocContent>;
  /** 특정 버전 본문 (마지막으로 본 뒤 바뀐 섹션 계산용) */
  loadVersion?(id: string, version: string): Promise<DocContent | null>;
  /** 기준본 (커밋본·처음 올린 원본 등). "기준 대비 변경" 보기용 */
  loadBase?(id: string): Promise<{ md: string; label: string } | null>;
  save?(id: string, md: string, opts: SaveOptions): Promise<SaveResult>;
  changes?(limit?: number): Promise<ChangeEntry[]>;
  inventory?(): Promise<Inventory | null>;
  subscribe?(cb: (ev: DocEvent) => void): Unsubscribe;
  /** 화면이 지금 보고 있는 문서(없으면 null). 폴링하는 어댑터가 이 문서를 더 자주 확인하는 데 쓴다 */
  focus?(id: string | null): void;
  /** 이 문서를 마지막으로 디스크·저장소와 맞춰 본 시각(ms). 실시간 감시면 비운다 */
  checkedAt?(id: string): number | undefined;
  /** 지금 바로 디스크와 맞춰 본다(바깥 편집이면 이력에 남기고 doc 이벤트). 바뀌었으면 true */
  refresh?(id: string): Promise<boolean>;
  /**
   * 폴더 하나의 항목(폴더 먼저, 이름순). '' = 맨 위. 없는 폴더면 null. 있으면 왼쪽 목록이 탐색기처럼 펼친 폴더만 읽는다 —
   * 드라이브 전체를 열어도 바로 뜬다. 문서 목록(manifest.docs)에 없던 문서도 여기서 찾아 열 수 있다.
   */
  tree?(dir: string): Promise<TreeEntry[] | null>;
  /**
   * 문서 파일의 바이트 (그림·PDF 미리보기, 원본 내려받기 — D87). 한도(BYTES_MAX)를 넘거나 없으면 null.
   * 글은 load 로 — 이것은 원본 그대로다
   */
  loadBytes?(id: string): Promise<Blob | null>;
  /**
   * 작업 공간 개요 — 구성·폴더 역할·메타데이터·점검 (D88). 없으면 개요 화면이 문서 목록만으로 간단히 그린다.
   * scope = 이 폴더만(대시보드 탭·넓은 작업 공간 안의 폴더) — 결과 경로는 작업 공간 기준 그대로
   */
  overview?(opts?: { scope?: string }): Promise<WorkspaceOverview | null>;
  /**
   * 새 문서를 만든다 — 이미 있으면 DocConflictError(지금 글). 폴더는 있어야 한다(없는 폴더를 만들지 않는다). 이력에 남긴다
   */
  create?(id: string, md: string, opts?: { summary?: string }): Promise<SaveResult>;
}

// ---------------------------------------------------------------- 작업 공간 개요 (D88)

/** 개요의 묶음 — 문서 · 데이터와 설정 · 코드 · 오피스 · 그림 · PDF · 소리와 영상 · 압축 · 그 밖 */
export type FileGroup = 'doc' | 'data' | 'code' | 'office' | 'image' | 'pdf' | 'media' | 'archive' | 'other';

/** 늘 하는 점검 (D88) — 팀 규칙 파일의 checks 로 수준을 바꾸거나 끈다 */
export type BuiltinCheckCode =
  | 'secrets' | 'huge-files' | 'no-readme' | 'review-due' | 'broken-links'
  | 'version-copies' | 'temp-files' | 'empty-folders' | 'folder-no-readme' | 'same-name' | 'long-paths'
  | 'stale-docs' | 'orphan-docs' | 'git-uncommitted';
/** 팀 규칙(docbench.json — D90)에서 온 점검 · 규칙 파일 자체의 문제 */
export type RuleCheckCode = `rule-${RuleKind}` | 'rules-invalid';
export type OverviewCheckCode = BuiltinCheckCode | RuleCheckCode;

/** 점검의 수준 — risk 주의 · action 할 일 · tidy 정리 · info 참고 (CI 의 `docbench check --fail-on` 이 이 순서로 자른다) */
export type CheckLevel = 'risk' | 'action' | 'tidy' | 'info';

/**
 * 점검 하나. 문구는 사전(core/checktext — 화면·CLI 가 함께)이 code 로 정한다.
 * 팀 규칙에서 온 점검은 rule(몇 번째 규칙·무엇을 요구하나)이, 규칙 파일의 문제는 problems 가 붙는다
 */
export interface OverviewCheck {
  code: OverviewCheckCode;
  level: CheckLevel;
  n: number;
  paths: string[];
  /** index = 규칙 파일 rules 의 몇 번째(0부터) */
  rule?: { index: number; kind: RuleKind; name?: string; hint?: string; want: string; scope: string[] };
  /** 경로마다 짧은 까닭 — 빠진 앞머리 키(owner · status=wip), 맞지 않는 이름 규칙, 마지막 검토일, 크기 */
  notes?: Record<string, string>;
  problems?: RuleProblem[];
}

// ---------------------------------------------------------------- 팀 규칙 (docbench.json — D90)

/** 규칙 종류 */
export type RuleKind = 'front-matter' | 'readme' | 'naming' | 'review' | 'forbid' | 'max-size' | 'require';
/** 이름 규칙 — 정규식 대신 정해 둔 것만(함께 쓰는 설정의 정규식이 화면을 멈추지 않게) */
export type NameStyle = 'kebab-case' | 'snake_case' | 'lowercase' | 'no-spaces' | 'ascii' | 'date-prefix' | 'number-prefix' | 'no-version-marks';

interface RuleBase {
  /** 이 규칙이 보는 경로(glob — 폴더는 끝에 '/'). 종류마다 기본값이 있다 */
  paths: string[];
  /** 그 가운데 뺄 경로(glob) */
  except?: string[];
  /** 점검에 보일 이름 */
  name?: string;
  /** 왜·어떻게 고치나 — 점검에 그대로 보인다 */
  hint?: string;
  /** 기본 action(할 일) */
  level?: CheckLevel;
  /** 규칙 파일 rules 의 몇 번째인가 — 읽을 때 붙인다(쓰는 값이 아니다) */
  at?: number;
}
export type RuleSpec =
  /** 마크다운 문서의 앞머리에 이 키들이 있어야 한다. values = 키마다 받는 값 */
  | (RuleBase & { kind: 'front-matter'; keys: string[]; values?: Record<string, string[]> })
  /** 이 폴더들(paths = 폴더 glob)에 README(index)가 있어야 한다 — 파일이 minFiles 개 이상인 폴더만 */
  | (RuleBase & { kind: 'readme'; minFiles?: number })
  /** 파일·폴더 이름(확장자 앞)이 이 규칙들을 모두 따른다. README·LICENSE 같은 관례 이름과 숨김 파일은 뺀다 */
  | (RuleBase & { kind: 'naming'; style: NameStyle[] })
  /** 문서를 days 일 안에 다시 본다 — 앞머리 검토일(reviewed·updated …) 과 마지막 변경(git 커밋·파일 시각) 중 늦은 것 */
  | (RuleBase & { kind: 'review'; days: number; field?: string })
  /** 이 경로의 파일·폴더를 두지 않는다 */
  | (RuleBase & { kind: 'forbid' })
  /** 이 크기(바이트)를 넘는 파일을 두지 않는다 */
  | (RuleBase & { kind: 'max-size'; max: number })
  /** paths 의 패턴마다 맞는 파일·폴더가 하나는 있어야 한다 */
  | (RuleBase & { kind: 'require' });

/** 팀 규칙 파일(docbench.json)을 읽은 것 — 이 키들 말고는 읽지 않는다(실행 명령·사람 같은 PC 설정은 여기서 읽지 않는다) */
export interface WorkspaceRules {
  purpose?: string;
  folders?: Record<string, { role?: string }>;
  /** 모든 점검에서 뺄 경로(glob) — 보관함·외부 코드 */
  ignore: string[];
  /** 늘 하는 점검의 수준을 바꾸거나('risk'…) 끈다('off') */
  checks: Partial<Record<BuiltinCheckCode, CheckLevel | 'off'>>;
  rules: RuleSpec[];
}

/** 규칙 파일의 문제 — at = 어디(rules[2].style), value = 받은 값 */
export interface RuleProblem {
  at: string;
  code: 'json' | 'not-object' | 'too-big' | 'unknown-key' | 'unknown-kind' | 'missing' | 'bad-value' | 'pattern' | 'too-many';
  value?: string;
}

export interface OverviewFolder {
  /** 맨 위 폴더 이름 ('' = 작업 공간 맨 위의 파일들) */
  path: string;
  files: number;
  docs: number;
  bytes: number;
  modified?: string;
  /** 이 폴더가 하는 일 — 설정(config.json folders) 또는 그 폴더 README */
  role?: string;
  roleFrom?: 'config' | 'readme';
  /** 그 폴더의 README 문서 id */
  readme?: string;
}

export type AiFileKind = 'claude' | 'agents' | 'gemini' | 'cursor' | 'copilot' | 'mcp' | 'skill' | 'prompt';

export interface WorkspaceOverview {
  asof: string;
  root: string;
  purpose?: { text: string; from: 'config' | 'readme'; docId?: string };
  /** 얼마나 훑었나 — complete false 면 일부(드라이브 같은 큰 폴더·항목 한도) */
  scope: { complete: boolean; items: number; reason?: 'big-root' | 'many' };
  totals: { files: number; dirs: number; bytes: number; docs: number; recent7: number; newest?: string };
  groups: { group: FileGroup; files: number; bytes: number }[];
  folders: OverviewFolder[];
  recent: { path: string; modified: string; size?: number; doc?: boolean }[];
  large: { path: string; size: number; doc?: boolean }[];
  /** 문서 앞머리 메타데이터 모음 (앞부분을 읽은 문서 수 기준) */
  meta: { docs: number; status: Record<string, number>; owners: Record<string, number>; tags: Record<string, number>; due: { docId: string; field: string; date: string }[] };
  ai: { path: string; kind: AiFileKind }[];
  git?: { modified: number; untracked: number; added: number };
  /** 링크를 훑었나 (문서가 많거나 큰 폴더면 건너뛴다) */
  links?: { docs: number; links: number };
  /**
   * 팀 규칙 파일(D90) — 있을 때만. count = 읽은 규칙 수, problems = 파일의 문제 수,
   * unchecked = 앞머리를 아직 읽지 않아 앞머리 규칙에서 빠진 문서 수(큰 폴더 — 다시 확인하면 이어 읽는다)
   */
  rules?: { file: string; count: number; problems: number; unchecked: number };
  checks: OverviewCheck[];
}

// ---------------------------------------------------------------- 피드백

export type Severity = 'high' | 'medium' | 'low';

/**
 * 피드백의 종류 — 사람과 Claude 가 같은 고정 목록을 쓴다(D85). 무엇이 문제인가로 나눈다(요청·질문 같은 말투가 아니라).
 * typo 오탈자 · fact 사실·수치 · conflict 충돌 · duplicate 중복 · gap 누락 · structure 구조 · clarity 표현 · risk 위험 · direction 방향
 */
export type FeedbackCategory = 'typo' | 'fact' | 'conflict' | 'duplicate' | 'gap' | 'structure' | 'clarity' | 'risk' | 'direction';

/** 피드백 골라 보기 — 문서 위 말풍선과 검토 패널(초안 칸은 빼고)이 함께 따른다 */
export interface FeedbackLens {
  /** 문서 안 그 자리에 말풍선으로 보인다 */
  bubbles?: boolean;
  /** 이 중요도 이상만 — 없으면 모두. 중요도가 없는 피드백은 보통으로 친다 */
  severity?: 'medium' | 'high';
  /** 이 종류만 — 없거나 비면 모두. 'none' = 종류가 없는 것 */
  cats?: (FeedbackCategory | 'none')[];
  /** 끝난 것(닫음·안 함)도 말풍선으로 */
  closed?: boolean;
}
/**
 * draft = 보내기 전의 내 메모(초안) — Claude·CLI·알림이 집어 가지 않는다. 디스크에는 늘 waitingOn 'owner' 로 적어
 * 옛 판도 "Claude 차례"로 오인하지 않게 한다(D73). open = 주고받는 중, resolved = 끝남, declined = 하지 않기로 함
 */
export type FeedbackStatus = 'draft' | 'open' | 'resolved' | 'declined';
/** 다음 수를 둘 쪽. owner = 문서 주인(사람), assistant = AI */
export type WaitingOn = 'owner' | 'assistant';

export interface Person {
  kind: 'human' | 'assistant' | 'external';
  id?: string;
  name?: string;
}

export type FeedbackTarget =
  | { kind: 'doc' }
  /** occurrence: 같은 경로의 제목이 여럿일 때 몇 번째인지(1부터). 없으면 첫째 */
  | { kind: 'section'; path: string[]; heading: string; occurrence?: number }
  | { kind: 'item'; itemId: string; label?: string };

/** W3C Web Annotation TextQuoteSelector 와 같은 모양 */
export interface TextSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface ThreadMessage {
  author: Person;
  text: string;
  at: string;
}

export interface Proposal {
  path: string[];
  before: string;
  after: string;
  rationale?: string;
  author: Person;
  at: string;
  state: 'pending' | 'applied' | 'rejected';
}

/**
 * Claude 가 처리한 결과 — 사람이 "확인"할 때까지 볼 것(open·owner)에 남는다(D73).
 * change: 바로 고친 경우 무엇을 어느 판에서 어느 판으로 — 되돌리기의 근거(section 이 없으면 문서 전체)
 */
export interface FeedbackResult {
  /** failed = 반영하지 못함(고친 글이 비었거나 모양이 틀림, Claude 가 답하지 않음) — problem 에 이유 */
  kind: 'edit' | 'propose' | 'answer' | 'ask' | 'decline' | 'review' | 'failed';
  at: string;
  /** 그 결과를 낸 Claude 작업 id */
  run?: string;
  change?: { docId: string; section?: string; from: string; to: string };
  /** 되돌렸으면 그때 */
  reverted?: string;
  /** failed 의 이유 (사람이 읽는 한 줄) */
  problem?: string;
}

export interface Feedback {
  id: string;
  version?: number;
  docId: string;
  target: FeedbackTarget;
  selector?: TextSelector;
  title?: string;
  body: string;
  /** 예전 자유 꼬리표(0.1 사전 리뷰의 "사실 갱신" 등) — 종류가 없으면 여기서 짐작한다(categoryOf) */
  kind?: string;
  /** 고정 종류(D85). 사람이 고르거나, Claude 가 남기거나 처리하며 붙인다 — 사람이 고른 것은 Claude 가 바꾸지 않는다 */
  category?: FeedbackCategory;
  severity?: Severity;
  status: FeedbackStatus;
  waitingOn: WaitingOn;
  author: Person;
  thread: ThreadMessage[];
  proposal?: Proposal;
  /** "이렇게 바꿔" — 사람이 직접 적은 바꿀 글. 문구 피드백이면 selector.exact 를 이 글로, 섹션이면 섹션 본문 전체를 */
  suggestion?: string;
  /** Claude 가 처리한 마지막 결과 */
  result?: FeedbackResult;
  /** 초안으로 되가져온 사람의 계정 — 그 사람의 초안으로 보인다(작성자·마지막 답보다 먼저). 초안이 아니면 없다 */
  drafter?: string;
  wasCollapsed?: boolean;
  order?: number;
  createdAt: string;
  updatedAt: string;
}

export type NewFeedback = Omit<Feedback, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'thread' | 'status' | 'waitingOn' | 'author'> &
  Partial<Pick<Feedback, 'status' | 'waitingOn' | 'author' | 'thread'>>;

/** 고칠 필드만. **null 이면 그 필드를 지운다**(JSON 은 undefined 를 싣지 못한다 — REST·파일 어디서나 같은 뜻) */
export type FeedbackPatch = { [K in keyof Omit<Feedback, 'id' | 'createdAt'>]?: Omit<Feedback, 'id' | 'createdAt'>[K] | null };

export class FeedbackConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(public current: Feedback) {
    super('feedback changed since it was loaded');
  }
}

export interface FeedbackStore {
  /** 처음 한 번, 그리고 바뀔 때마다 전체 목록을 넘긴다 */
  subscribe(cb: (rows: Feedback[]) => void, onError?: (e: Error) => void): Unsubscribe;
  create(input: NewFeedback): Promise<Feedback>;
  update(id: string, patch: FeedbackPatch, opts?: { version?: number }): Promise<Feedback>;
  remove?(id: string): Promise<void>;
  /** 'live' = 다른 기기·AI 의 변경이 실시간으로 온다 */
  mode?(): 'live' | 'poll' | 'local';
}

// ---------------------------------------------------------------- 보기 상태·사용자·AI

export interface DocViewState {
  depth?: number;
  /** 섹션 키 → 접힘 여부 (깊이 기본값을 덮어쓴 것만) */
  folds?: Record<string, boolean>;
  /** 숨긴 이름표 */
  hiddenLabels?: string[];
  /** 마지막으로 본 버전 — "확인"을 누를 때만 옮긴다(보기만 하면 바뀐 글 표시가 남는다) */
  lastSeen?: string;
  /** 본 판 뒤로 바뀌었지만 하나씩 확인한 섹션 — 키 → 확인할 때 글의 지문. 글이 또 바뀌면 다시 보인다 */
  acked?: Record<string, string>;
  /** Claude 의 읽기 안내(읽기 정리를 받아들였을 때) · 그 전의 접기 상태(되돌리기) */
  guide?: string;
  foldsBefore?: Record<string, boolean>;
}

export type SendVia = 'app' | 'terminal' | 'host' | 'demo' | 'notify';

export interface ViewState {
  v: 1;
  updatedAt: number;
  last?: string;
  docs: Record<string, DocViewState>;
  groups?: Record<string, boolean>;
  panel?: { scope?: 'doc' | 'all'; filter?: PanelFilter; open?: boolean };
  map?: { open?: Record<string, boolean>; filters?: Record<string, unknown> };
  /** Claude 작업 창: 고른 모델·노력·방식, 열림 */
  /** chosen = 이름 맞추기 안내를 접은 표시, runner = 내가 고른 실행기 id (이름이 다른 실행기를 내 것으로 쓸 때) */
  runs?: { model?: string; effort?: RunEffort | ''; mode?: RunMode; open?: boolean; chosen?: string; runner?: string;
    /** 보낼 곳: 이 PC 의 앱(자동) · 터미널 Claude(설치 없음) · 대시보드 터미널 · 연습용 흉내 · 요청함 */
    via?: SendVia;
    /** 터미널: 지난 대화 이어서(claude -c) */
    resume?: boolean;
    /** 볼 것에서 치운 읽기 정리(작업 id) */
    viewSeen?: string[] };
  /** 변경 표시(더한 글·지운 글)를 문서 위에 그릴지 */
  showChanges?: boolean;
  /** 피드백 골라 보기·말풍선 */
  lens?: FeedbackLens;
  /** 왼쪽 문서 목록: 폴더 나무 / config.json 의 모음 */
  railView?: 'folder' | 'groups';
  /** 고정한 폴더('경로/')·문서 — 왼쪽 위 "작업 중"에 늘 보인다 */
  pins?: string[];
  /** 최근에 연 문서 (새것 먼저, 최대 12) */
  recent?: string[];
  /** 나무에서 펼친 폴더 */
  open?: string[];
}

/** 검토 패널의 칸: 초안 · 볼 것(내 확인·답 필요) · 보냄(Claude 가 처리 중·대기) · 끝남 */
export type PanelFilter = 'draft' | 'review' | 'sent' | 'done';

export interface ViewStateStore {
  load(): Promise<ViewState | null>;
  save(state: ViewState): Promise<void>;
}

export type Action =
  | 'doc.edit'
  | 'feedback.create'
  | 'feedback.update'
  | 'feedback.delete'
  | 'assistant.propose'
  | 'assistant.notify'
  /** 백그라운드 Claude 작업(보낸 묶음·먼저 검토)을 시작 */
  | 'assistant.run';

export interface Identity {
  me(): Promise<Person>;
  can(action: Action): boolean | Promise<boolean>;
  /**
   * 표시 이름(별명)을 바꾼다. 계정(id)은 그대로 — 작성자·보기 상태·실행기 짝은 id 로 잇는다.
   * 없으면 "나" 메뉴에서 이름을 바꿀 수 없다(호스트가 정한 사람).
   */
  setName?(name: string): Promise<Person>;
  /** 계정이 어디서 왔나 — 'browser' = 이 브라우저에 자동으로 만든 계정, 'pc' = 이 PC 의 로그인, 'host' = 대시보드 로그인 */
  source?: 'browser' | 'pc' | 'host';
}

export interface ProposeRequest {
  docId: string;
  docTitle: string;
  feedback: Feedback;
  sectionPath: string[];
  sectionText: string;
}

export interface Assistant {
  name: string;
  available?(): Promise<boolean>;
  propose(req: ProposeRequest, opts: { signal: AbortSignal }): Promise<{ after: string; rationale?: string }>;
}

export interface Notifier {
  /** 보낼 곳 이름(어디로). 예: "이 대화의 Claude 에게" */
  label?: string;
  /** delivered = AI 를 실제로 깨웠다 · queued = 요청함에 남겼다(터미널의 AI 가 읽는다) · message = 화면에 그대로 보일 안내 */
  send(summary: { count: number; docs: string[]; feedbackIds: string[]; note?: string }): Promise<{ delivered: boolean; queued?: boolean; message?: string }>;
}

export interface Platform {
  copy?(text: string): Promise<boolean>;
  download?(filename: string, text: string, mime?: string): Promise<boolean>;
}

export interface DocBenchAdapters {
  docs: DocSource;
  feedback: FeedbackStore;
  viewState?: ViewStateStore;
  identity?: Identity;
  assistant?: Assistant;
  notifier?: Notifier;
  platform?: Platform;
  /** 백그라운드 Claude 작업 — 서버(docbench serve·대시보드)는 직접, 단일 HTML 은 이 PC 의 앱이 띄우거나 터미널 Claude 에게 맡긴다 */
  runs?: RunsAdapter;
  /** 이 작업 공간에서 Claude 가 늘 지킬 지시(기록 폴더 instructions.md) — Claude 작업·터미널 Claude 가 요청마다 붙인다 */
  instructions?: { load(): Promise<string>; save(text: string): Promise<void> };
}

// ---------------------------------------------------------------- Claude 작업 (백그라운드 실행)

/**
 * handoff = 보낸 피드백을 처리(고침·제안·답·질문·보류), propose = 고르게 한 피드백에 수정 제안만,
 * review = Claude 가 먼저 문서를 읽고 제안·질문을 올린다(선제안) 또는 읽기 정리(접을 곳·읽는 순서)를 제안한다(D74)
 */
export type RunKind = 'handoff' | 'propose' | 'review';
/** auto = Claude 가 판단해 바로 고치기도 한다, propose = 고치지 않고 제안만 올린다 */
export type RunMode = 'auto' | 'propose';
export type RunEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RunState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface RunStartInput {
  kind: RunKind;
  feedbackIds: string[];
  /** 'opus' 'sonnet' 같은 별칭이나 전체 모델 이름. 비우면 Claude Code 기본값 */
  model?: string;
  effort?: RunEffort;
  mode?: RunMode;
  /** 이번 묶음 전체에 붙이는 지시(공통 지시) — 항목마다의 허용 처리를 넓히지 못한다 */
  note?: string;
  /** review: 읽을 문서 (최대 RUN_MAX_DOCS) */
  docIds?: string[];
  /** review: 문서 하나일 때 볼 섹션만 */
  sections?: string[];
  /** review: suggest = 제안·질문을 올린다, view = 문서는 그대로 두고 읽기 정리(접을 곳·읽는 순서)만 */
  goal?: 'suggest' | 'view';
}

/** 읽기 정리 — 문서는 그대로, 화면에서 접을 섹션과 읽는 순서 안내(받아들이면 내 화면에만) */
export interface ReadingPlan { docId: string; fold: string[]; focus?: string[]; guide?: string }

export interface RunRequest extends RunStartInput {
  id: string;
  at: string;
  by?: Person;
  /** 이 요청을 실행할 실행기 id (폴더를 함께 쓰는 다른 PC 의 실행기가 집어 가지 않게) */
  runner: string;
}

export interface RunSummary { edited: number; proposed: number; answered: number; asked: number; declined: number; skipped: number; failed: number; created: number }

export interface RunStatus extends RunRequest {
  state: RunState;
  startedAt?: string;
  endedAt?: string;
  /** 지금 하는 일 (실행 중일 때만) */
  progress?: { phase: 'starting' | 'thinking' | 'reading' | 'writing' | 'applying'; tokens?: number; at: string };
  summary?: RunSummary;
  /** 처리한 피드백의 문서 */
  docs?: string[];
  /** review: Claude 의 총평 · 만든 피드백 · 읽기 정리 */
  overview?: string;
  created?: string[];
  view?: ReadingPlan[];
  /**
   * 터미널 Claude 를 기다리는 요청(queued, runner terminal:…)의 안내 — 어댑터가 자기가 아는 기록 자리로 붙인다(함께 쓰는 파일에서 읽지 않는다).
   * 화면을 다시 열어도 "명령 다시 보기"가 맞는 폴더를 가리키게
   */
  terminal?: TerminalHandoff;
  error?: string;
  usage?: { model?: string; durationMs?: number; turns?: number; inputTokens?: number; outputTokens?: number; costUsd?: number; limit?: { window: string; utilization?: number; resetsAt?: number } };
}

/** 작업 로그 한 줄. k = 화면 사전의 'run.log.<k>' (값은 v), text = Claude 가 쓴 글 */
export interface RunLogLine {
  at: string;
  k: string;
  v?: Record<string, string | number | undefined>;
  text?: string;
  ref?: { docId?: string; feedbackId?: string; section?: string };
}

export interface RunnerInfo {
  id: string;
  /** 'runner' = 단일 HTML 용 실행기(폴더 하나), 'app' = 이 PC 의 DocBench 앱(여러 폴더), 'server' = docbench serve·대시보드, 'demo' = 시작하기(연습 공간)의 흉내 — 실제 Claude 가 아니다 */
  kind: 'runner' | 'server' | 'app' | 'demo';
  /** 이 엔진을 "내 것"으로 쓰는 계정 id (설치 안내가 짝을 지어 이 PC 의 설정에 적는다) — 이름이 달라도 잇는다 */
  owners?: string[];
  user: string;
  host: string;
  pid: number;
  version: string;
  protocol: number;
  startedAt: string;
  seenAt: string;
  claude: { ok: boolean; version?: string; problem?: string; reason?: 'no-claude' | 'old-claude' | 'not-logged-in' };
  models: string[];
  efforts: RunEffort[];
  busy?: string | null;
  queue?: number;
}

/** 터미널 Claude 에게 맡길 때 화면이 보여 줄 것 */
export interface TerminalHandoff {
  /** 기록 폴더(Claude 자리)의 절대 경로 — 서버·앱만 안다. 없으면 그 폴더에서 치라고 안내한다 */
  room?: string;
  /** 기록 폴더 이름 · 기록 보관함 이름(밖에 둘 때) — 폴더를 찾아가게 */
  roomName: string;
  homeName?: string;
  /** 칠 한 줄 — pwsh(Windows) · sh */
  command: { pwsh: string; sh: string };
  /** 같은 줄로 지난 대화 이어서(claude -c) — "지난 대화 이어서"를 고른 사람에게 */
  resume?: { pwsh: string; sh: string };
  /** Claude Code deep link(claude-cli://open?cwd=…&q=…) — 기록 폴더의 절대 경로를 알 때만. 누르면 새 터미널 창에 요청이 입력된 채로 열린다 */
  link?: string;
}

export interface RunsAvailability {
  available: boolean;
  /**
   * no-runner = 실행기가 꺼져 있음, not-mine = 켜진 실행기가 내 이름과 다름(저절로 맡기지 않음 — 내 PC 의 것이면 고른다),
   * no-claude = claude 를 못 찾음, old-claude = 안전 실행 플래그가 없는 판, not-logged-in = Claude Code 에 로그인하지 않음(구독 로그인 필요),
   * read-only = 폴더에 쓸 수 없음
   */
  reason?: 'no-runner' | 'old-runner' | 'not-mine' | 'no-claude' | 'old-claude' | 'not-logged-in' | 'read-only' | 'disabled';
  message?: string;
  runner?: RunnerInfo;
  /** 폴더를 함께 쓰는 다른 실행기들 (여럿이면 고른다) */
  others?: RunnerInfo[];
}

export interface RunsAdapter {
  status(): Promise<RunsAvailability>;
  start(input: RunStartInput): Promise<RunStatus>;
  cancel(id: string): Promise<void>;
  list(limit?: number): Promise<RunStatus[]>;
  /** from = 지난번 next (처음 0). 완성된 줄만 준다 */
  log(id: string, from: number): Promise<{ lines: RunLogLine[]; next: number }>;
  /** 여럿일 때 쓸 실행기를 고른다 (폴더 어댑터) */
  choose?(runnerId: string): void;
  /** 연결 전에 준비할 것 (단일 HTML: 기록 폴더를 아직 고르지 않았으면 지금 고르게 한다) */
  prepare?(): Promise<void>;
  /**
   * 터미널의 Claude Code 에게 맡긴다 — 설치 없음(D76). 요청·맥락·지시 파일을 기록 폴더(Claude 자리)에 쓰고 칠 한 줄을 돌려준다.
   * Claude 가 결과 파일을 남기면 같은 계정의 화면·앱이 같은 규칙으로 반영한다.
   */
  startTerminal?(input: RunStartInput): Promise<RunStatus & { terminal: TerminalHandoff }>;
  /**
   * 실행기가 없을 때 보여 줄 연결 안내의 재료 (단일 HTML — 받을 CLI 주소·지문).
   * dataHome·dataName = 기록을 문서 폴더 밖(기록 보관함 dataHome 아래 dataName)에 둘 때 그 이름들,
   * owner = 이 화면의 계정 id (안내가 실행기와 짝을 지어 이름이 달라도 "내 것"으로 잇는다),
   * noData = 기록 폴더를 아직 고르지 않음(연결하려면 먼저 고른다)
   */
  setup?: { version: string; cliUrl: string; sha256: string; folderName: string; dataHome?: string; dataName?: string; owner?: string; noData?: boolean };
}

// ---------------------------------------------------------------- 폴더 지도

export interface InventoryItem {
  id: string;
  /** 상위 경로, '/' 로 끝남. 최상위는 '' */
  parent: string;
  name: string;
  folder: boolean;
  /** 파일 종류 약칭 (md, pdf, zip …) */
  kind?: string;
  size?: number;
  modified?: string;
  url?: string;
  note?: string;
  flags?: string[];
  /** 이 항목이 작업대 문서면 그 id */
  docId?: string;
}

export interface Inventory {
  asof?: string;
  source?: string;
  items: InventoryItem[];
  flagLabels?: Record<string, { label: string; tone?: Tone }>;
  notes?: { title: string; detail?: string; ids: string[]; level?: 'action' | 'tidy' | 'risk' | 'pii' }[];
  /** 처음에 숨겨 둘 표시(예: 구판·자동 산출물). 지도 위 칩으로 다시 켠다 */
  hiddenFlags?: string[];
  /** 처음에 펼쳐 둘 폴더 경로 */
  open?: string[];
}

// ---------------------------------------------------------------- 옵션·이벤트

export interface DocBenchOptions {
  adapters: DocBenchAdapters;
  locale?: 'ko' | 'en';
  theme?: 'auto' | 'light' | 'dark';
  /** 'hash' = 주소의 #문서id 로 이동 기억, 'none' = 호스트가 navigate() 로 제어 */
  routing?: 'hash' | 'none';
  initialDoc?: string;
  /** 단축키 범위. scoped = 작업대 안에 포커스가 있을 때만 */
  shortcuts?: 'scoped' | 'global' | false;
  /** 끌 기능 — overview = 작업 공간 개요(D88, 저장소가 overview 를 줄 때 첫 화면) */
  features?: Partial<{ milestones: boolean; map: boolean; changes: boolean; edit: boolean; outline: boolean; overview: boolean }>;
  /** 스타일을 자동으로 넣을지. CSP 가 인라인 스타일을 막으면 false 로 두고 docbench.css 를 직접 링크한다 */
  injectStyles?: boolean;
  styleNonce?: string;
  onEvent?: (ev: DocBenchEvent) => void;
  /**
   * 이 폴더 아래만 보인다 — 대시보드가 "지금 프로젝트" 폴더를 줄 때(작업 공간 기준 '/' 경로, '' = 전부).
   * 기록은 작업 공간 하나에 그대로 쌓이고(하위 폴더를 따로 열어 기록이 갈라지지 않게) 보이는 범위만 좁힌다.
   */
  scope?: string;
  /** 'full' = 단독 화면, 'embedded' = 대시보드 탭에 끼움(제목 줄을 줄이고 호스트 모양을 따른다) */
  chrome?: 'full' | 'embedded';
  /** 왼쪽 위 작업 공간 이름을 누르면 열리는 메뉴 — 단일 HTML·DocBench 앱이 "폴더 열기·바꾸기·기록 자리"를 여기에 둔다 */
  workspace?: WorkspaceMenu;
  /** 호스트(대시보드)가 맡는 일 */
  host?: HostHooks;
}

/** 작업 공간 메뉴 (DocBenchOptions.workspace) */
export interface WorkspaceMenu {
  items(): { id: string; label: string; hint?: string; primary?: boolean; disabled?: boolean }[];
  run(id: string): void | Promise<void>;
}

/** 호스트가 맡는 일 (DocBenchOptions.host) — 대시보드 탭에 끼울 때 */
export interface HostHooks {
  /**
   * 보내기를 호스트가 맡는다 — 대시보드가 자기 터미널로.
   *  - prompt: 이미 켜진 Claude Code 대화에 넣을 한 줄(플러그인의 /docbench:docbench-feedback — CLI 로 처리)
   *  - command: 셸에서 칠 한 줄(설치 없음, D76) — 기록 폴더로 가서 새 Claude Code 를 켜 요청 파일을 처리한다. 없으면 셸 길은 없다
   * 둘 중 하나만 쓴다. handled=false 면 작업대가 스스로(Claude 작업 창·터미널 안내·요청함) 처리한다.
   */
  handoff?(req: { feedbackIds: string[]; docs: string[]; prompt: string; command?: string }): Promise<{ handled: boolean; message?: string }>;
}

/** 작업대가 묻는 짧은 선택 (DocBenchHandle.ask) */
export interface AskOptions {
  title: string;
  body?: string;
  choices: { id: string; label: string; primary?: boolean }[];
  note?: string;
}

export type DocBenchEvent =
  | { type: 'navigate'; view: string }
  /** 할 일 수 — draft = 보내지 않은 초안, owner = 볼 것(내 확인·답 필요), assistant = 보냄(Claude 가 처리할 것). 숫자만 싣는다 */
  | { type: 'todo'; owner: number; assistant: number; draft: number }
  | { type: 'feedback:created'; feedback: Feedback }
  | { type: 'feedback:updated'; feedback: Feedback }
  | { type: 'doc:saved'; docId: string; version: string }
  | { type: 'assistant:requested'; feedbackIds: string[] }
  | { type: 'error'; message: string; error?: unknown };

export type Unsubscribe = () => void;
