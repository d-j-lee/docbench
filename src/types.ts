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
  /** 바뀐 섹션 키 */
  sections?: string[];
}

export interface DocEvent {
  type: 'doc' | 'manifest' | 'changes' | 'feedback' | 'request';
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
  | 'assistant.notify';

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
  send(summary: { count: number; docs: string[]; feedbackIds: string[] }): Promise<{ delivered: boolean; message?: string }>;
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
