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
  /** 읽기 전용인 이유 (예: 'encoding') */
  readOnlyReason?: string;
  encoding?: string;
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
}

// ---------------------------------------------------------------- 피드백

export type Severity = 'high' | 'medium' | 'low';
export type FeedbackStatus = 'open' | 'resolved' | 'declined';
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

export interface Feedback {
  id: string;
  version?: number;
  docId: string;
  target: FeedbackTarget;
  selector?: TextSelector;
  title?: string;
  body: string;
  kind?: string;
  severity?: Severity;
  status: FeedbackStatus;
  waitingOn: WaitingOn;
  author: Person;
  thread: ThreadMessage[];
  proposal?: Proposal;
  wasCollapsed?: boolean;
  order?: number;
  createdAt: string;
  updatedAt: string;
}

export type NewFeedback = Omit<Feedback, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'thread' | 'status' | 'waitingOn' | 'author'> &
  Partial<Pick<Feedback, 'status' | 'waitingOn' | 'author' | 'thread'>>;

export type FeedbackPatch = Partial<Omit<Feedback, 'id' | 'createdAt'>>;

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
  /** 마지막으로 본 버전 */
  lastSeen?: string;
}

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
  runs?: { model?: string; effort?: RunEffort | ''; mode?: RunMode; open?: boolean; chosen?: string; runner?: string };
  /** 변경 표시(더한 글·지운 글)를 문서 위에 그릴지 */
  showChanges?: boolean;
  /** 왼쪽 문서 목록: 폴더 나무 / config.json 의 모음 */
  railView?: 'folder' | 'groups';
}

export type PanelFilter = 'active' | 'owner' | 'assistant' | 'closed';

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
  /** 백그라운드 Claude 작업(넘기기·제안)을 시작 */
  | 'assistant.run';

export interface Identity {
  me(): Promise<Person>;
  can(action: Action): boolean | Promise<boolean>;
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
  /** 버튼 문구. 예: "AI에게 넘기기" */
  label?: string;
  /** delivered = AI 를 실제로 깨웠다 · queued = 요청함에 남겼다(터미널의 AI 가 읽는다) · message = 화면에 그대로 보일 안내 */
  send(summary: { count: number; docs: string[]; feedbackIds: string[] }): Promise<{ delivered: boolean; queued?: boolean; message?: string }>;
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
  /** 백그라운드 Claude 작업 — 서버(docbench serve·대시보드)는 직접, 단일 HTML 은 이 PC 의 실행기(docbench runner)가 띄운다 */
  runs?: RunsAdapter;
}

// ---------------------------------------------------------------- Claude 작업 (백그라운드 실행)

/** handoff = Claude 차례 피드백을 처리(고침·제안·답·질문·보류), propose = 고르게 한 피드백에 수정 제안만 */
export type RunKind = 'handoff' | 'propose';
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
}

export interface RunRequest extends RunStartInput {
  id: string;
  at: string;
  by?: Person;
  /** 이 요청을 실행할 실행기 id (폴더를 함께 쓰는 다른 PC 의 실행기가 집어 가지 않게) */
  runner: string;
}

export interface RunSummary { edited: number; proposed: number; answered: number; asked: number; declined: number; skipped: number; failed: number }

export interface RunStatus extends RunRequest {
  state: RunState;
  startedAt?: string;
  endedAt?: string;
  /** 지금 하는 일 (실행 중일 때만) */
  progress?: { phase: 'starting' | 'thinking' | 'reading' | 'writing' | 'applying'; tokens?: number; at: string };
  summary?: RunSummary;
  /** 처리한 피드백의 문서 */
  docs?: string[];
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
  /** 'runner' = 단일 HTML 용 실행기, 'server' = docbench serve·대시보드 */
  kind: 'runner' | 'server';
  user: string;
  host: string;
  pid: number;
  version: string;
  protocol: number;
  startedAt: string;
  seenAt: string;
  claude: { ok: boolean; version?: string; problem?: string; reason?: 'no-claude' | 'old-claude' };
  models: string[];
  efforts: RunEffort[];
  busy?: string | null;
  queue?: number;
}

export interface RunsAvailability {
  available: boolean;
  /**
   * no-runner = 실행기가 꺼져 있음, not-mine = 켜진 실행기가 내 이름과 다름(저절로 맡기지 않음 — 내 PC 의 것이면 고른다),
   * no-claude = claude 를 못 찾음, old-claude = 안전 실행 플래그가 없는 판, read-only = 폴더에 쓸 수 없음
   */
  reason?: 'no-runner' | 'not-mine' | 'no-claude' | 'old-claude' | 'read-only' | 'disabled';
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
  /** 실행기가 없을 때 보여 줄 설치 안내의 재료 (단일 HTML — 받을 CLI 주소·지문) */
  /** dataHome·dataName = 기록을 문서 폴더 밖(기록 보관함 dataHome 아래 dataName)에 둘 때 그 이름들 */
  setup?: { version: string; cliUrl: string; sha256: string; folderName: string; dataHome?: string; dataName?: string };
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
  features?: Partial<{ milestones: boolean; map: boolean; changes: boolean; edit: boolean; outline: boolean }>;
  /** 스타일을 자동으로 넣을지. CSP 가 인라인 스타일을 막으면 false 로 두고 docbench.css 를 직접 링크한다 */
  injectStyles?: boolean;
  styleNonce?: string;
  onEvent?: (ev: DocBenchEvent) => void;
}

export type DocBenchEvent =
  | { type: 'navigate'; view: string }
  | { type: 'feedback:created'; feedback: Feedback }
  | { type: 'feedback:updated'; feedback: Feedback }
  | { type: 'doc:saved'; docId: string; version: string }
  | { type: 'assistant:requested'; feedbackIds: string[] }
  | { type: 'error'; message: string; error?: unknown };

export type Unsubscribe = () => void;
