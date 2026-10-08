/**
 * 작업 폴더 규약 — 서버(Node)·CLI 와 브라우저 폴더 어댑터가 같은 규칙을 쓴다.
 *
 *   <작업 폴더>/
 *     *.md                    문서 (정본은 언제나 이 파일들)
 *     .docbench/
 *       config.json           그룹·제목·규칙 (선택, 함께 쓰는 설정 — 커밋·동기화돼도 된다)
 *       feedback/<id>.json    피드백 한 건 = 파일 하나
 *       changes.jsonl         변경 이력 (한 줄 = 한 번 저장)
 *       blobs/<판>.md         본 적 있는 판의 본문 (바뀐 섹션 계산용, 커밋하지 않음)
 *       state.json            마지막으로 알던 문서 판 (외부 편집 감지용, 커밋하지 않음)
 *       viewstate/<user>.json 접기·깊이 등 보기 상태 (커밋하지 않음)
 *       inbox/                "AI에게 넘기기" 요청 (커밋하지 않음)
 *       locks/                같은 대상 쓰기를 줄 세우는 잠금 파일 (커밋하지 않음)
 *       runs/                 Claude 작업 요청·상태·로그 (커밋하지 않음, src/core/runs.ts)
 *       runners/              실행기 심장 박동 (커밋하지 않음)
 *
 * 이 PC 에만 해당하는 설정(실행 명령·이름)은 문서 폴더 밖, 운영체제의 앱 설정 자리에 둔다(서버·CLI):
 *   Windows %LOCALAPPDATA%\docbench\config.json · macOS ~/Library/Application Support/docbench · Linux ~/.config/docbench
 *   (DOCBENCH_HOME 으로 옮김)
 *   { "user": "김철수", "assistant": {…}, "notify": {…},              ← 이 PC 의 모든 작업 폴더 기본값
 *     "workspaces": { "D:/work/docs": { "assistant": {…}, "notify": { "command": [...] } } } }   ← 폴더별
 *
 * 입출력(파일 읽기·쓰기·해시)은 각자 한다. 여기에는 모양과 규칙만 둔다.
 */
import type { ChangeEntry, Manifest } from '../types';
import { headingPlain } from './markdown';

export const IGNORE_DIRS = new Set(['.git', 'node_modules', '.docbench', '.svn', '.hg', '__pycache__', '.venv', 'dist', 'build', '.idea', '.vscode']);

/** .docbench/.gitignore — 사람이 읽는 피드백·이력·설정만 커밋 대상 */
export const DOT_GITIGNORE = 'blobs/\nviewstate/\ninbox/\nlocks/\nruns/\nrunners/\nstate.json\n*.tmp\n';

/** 예전 판이 만든 .docbench/.gitignore 에 빠진 줄을 덧붙인 글(바뀔 것이 없으면 null) — 사람이 더한 줄은 그대로 */
export function mergeGitignore(existing: string): string | null {
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = DOT_GITIGNORE.split('\n').filter((l) => l && !have.has(l));
  if (!missing.length) return null;
  return existing + (existing && !existing.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n';
}

/** 잠금 파일이 이보다 오래되면 죽은 잠금으로 본다 */
export const LOCK_STALE_MS = 15000;

export interface WorkspaceConfig {
  title: string;
  subtitle: string;
  links?: { label: string; url: string }[];
  include: string[];
  exclude: string[];
  groups: { id?: string; label: string; note?: string; match?: string[]; collapsed?: boolean }[];
  docs: Record<string, { title?: string; role?: string; audience?: string; trust?: string; depth?: number; notice?: { text: string; tone?: string }; readOnly?: boolean }>;
  trust?: Manifest['trust'];
  milestones?: Manifest['milestones'];
  render?: Manifest['render'];
  assistantName: string;
  assistant: { command?: string | string[]; args?: string[]; model?: string; timeoutSec?: number } | null;
  /** inbox: .docbench/inbox 에 요청 파일 · command: 넘기기 때 실행할 명령(배열, 서버만) · message: 화면에 보일 안내 */
  notify: { inbox?: boolean; command?: string[] | null; message?: string | null };
  readOnly: boolean;
  user: string;
  maxDocs: number;
  maxInventory: number;
  inventory: { flags?: boolean };
  /** 설정을 읽다 무시한 것 (예: config.json 에 적은 실행 명령) — 사람에게 알린다 */
  warnings?: string[];
}

export const DEFAULT_CONFIG: WorkspaceConfig = {
  title: '',
  subtitle: '',
  include: ['**/*.md', '**/*.markdown'],
  exclude: ['node_modules/**', '.git/**', '.docbench/**', '**/.*/**', '.claude/**'],
  groups: [],
  docs: {},
  trust: undefined,
  milestones: undefined,
  render: undefined,
  assistantName: 'Claude',
  assistant: null,
  notify: { inbox: true, command: null, message: null },
  readOnly: false,
  user: '',
  maxDocs: 2000,
  maxInventory: 4000,
  inventory: { flags: true },
};

/** 이 PC 에만 해당하는 설정 — 문서 폴더 밖(사용자 폴더)에서만 읽는다 */
export interface PcSettings {
  user?: string;
  assistant?: WorkspaceConfig['assistant'];
  notify?: { command?: string[] | null };
}

/**
 * PC 설정 파일 → 이 작업 폴더에 해당하는 값. 맨 위 값이 기본, `workspaces[<폴더 경로>]` 가 덮는다.
 * 경로 비교는 '/' 로 맞추고 끝 '/' 를 떼며, Windows(ci)는 대소문자를 무시한다.
 */
export function pcSettingsFor(file: unknown, rootPaths: string[], ci = false): PcSettings {
  const f = (file && typeof file === 'object' ? file : {}) as PcSettings & { workspaces?: Record<string, PcSettings> };
  const norm = (p: string) => { const x = p.replace(/\\/g, '/').replace(/\/+$/, ''); return ci ? x.toLowerCase() : x; };
  const want = new Set(rootPaths.map(norm));
  let ws: PcSettings = {};
  for (const [k, v] of Object.entries(f.workspaces || {})) if (want.has(norm(k)) && v && typeof v === 'object') ws = v;
  return {
    user: ws.user ?? f.user,
    assistant: ws.assistant ?? f.assistant,
    notify: { ...(f.notify || {}), ...(ws.notify || {}) },
  };
}

/**
 * config.json(함께 쓰는 설정) + 이 PC 의 설정 → 완전한 설정. title 이 비면 폴더 이름.
 *
 * **실행 명령과 이름은 이 PC 의 설정에서만 받는다**: `assistant`(헤드리스 claude 명령·인자), `notify.command`, `user` 는
 * 문서 폴더 밖 PC 설정(pc)에서만 쓴다. git·OneDrive·공유 폴더로 퍼지는 config.json 에 누가 명령을 적어 넣어도
 * 다른 사람 PC 에서 "넘기기"·"제안" 때 실행되지 않고, 모두가 한 사람으로 기록되지도 않게 한다. 무시한 것은 warnings 로 알린다.
 * 브라우저(단일 HTML)는 pc 를 넘기지 않는다 — 명령을 실행하지 않고, 이름은 사람이 적는다.
 */
export function mergeConfig(raw: unknown, folderName: string, pc?: PcSettings): WorkspaceConfig {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<WorkspaceConfig>) : {});
  const shared = { ...obj(raw) };
  const warnings: string[] = [];
  const where = '이 PC 의 설정(docbench status 가 위치를 알려 준다)';
  if (shared.assistant != null) warnings.push(`문서 폴더 config.json 의 assistant 는 쓰지 않습니다 — 실행 명령은 ${where}에 두세요.`);
  if (shared.user) warnings.push(`문서 폴더 config.json 의 user 는 쓰지 않습니다 — 이름은 ${where}에 두세요.`);
  delete shared.assistant;
  delete shared.user;
  const sharedNotify = { ...(shared.notify || {}) };
  if (sharedNotify.command != null) warnings.push(`문서 폴더 config.json 의 notify.command 는 쓰지 않습니다 — ${where}에 두세요.`);
  delete sharedNotify.command;
  const out: WorkspaceConfig = {
    ...DEFAULT_CONFIG, ...shared,
    notify: { ...DEFAULT_CONFIG.notify, ...sharedNotify, ...(pc?.notify?.command != null ? { command: pc.notify.command } : {}) },
    assistant: pc?.assistant ?? null,
    user: pc?.user || '',
  };
  if (!out.title) out.title = folderName;
  if (warnings.length) out.warnings = warnings;
  else delete out.warnings;
  return out;
}

/** JSON 파일 글 → 값. 메모장·PowerShell 5.1 이 붙이는 BOM 을 떼고 읽는다(서버와 브라우저가 같게) */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

// ---------------------------------------------------------------- glob

const globCache = new Map<string, RegExp>();

/** 작은 glob — `**`, `*`, `?`, `{a,b}` 만. 경로는 '/' 구분 상대 경로. ci = 대소문자 무시(Windows) */
export function globToRegExp(pat: string, ci = false): RegExp {
  const key = (ci ? 'i:' : 's:') + pat;
  const hit = globCache.get(key);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        i++;
        if (pat[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = pat.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += '(?:' + pat.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp('^' + re + '$', ci ? 'i' : '');
  globCache.set(key, out);
  return out;
}

export const matchAny = (rel: string, pats: string[] | undefined, ci = false): boolean => !!pats && pats.some((p) => globToRegExp(p, ci).test(rel));

export const isDocPath = (rel: string, c: Pick<WorkspaceConfig, 'include' | 'exclude'>, ci = false): boolean =>
  matchAny(rel, c.include, ci) && !matchAny(rel, c.exclude, ci);

/** 훑을 폴더인가 — 숨김 폴더·빌드 산출물·의존성 폴더는 건너뛴다 */
export const walkable = (dirName: string): boolean => !IGNORE_DIRS.has(dirName) && !dirName.startsWith('.');

// ---------------------------------------------------------------- 문서 id

/**
 * 사용자가 준 문서 id 를 정규화한다. 작업 폴더 밖·절대 경로·드라이브 문자·NUL 은 null.
 * (서버는 여기에 더해 실제 경로·심볼릭 링크를 확인한다)
 */
export function normalizeDocId(id: unknown): string | null {
  if (typeof id !== 'string' || !id || id.includes('\0') || id.startsWith('/') || id.startsWith('\\') || /^[a-zA-Z]:/.test(id)) return null;
  const parts: string[] = [];
  for (const seg of id.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

/** 대소문자만 다른 id(Windows 는 같은 파일)를 실제 이름으로 맞춘다 — 이력·피드백이 둘로 갈라지지 않게 */
export function canonDocId(id: string, known: Iterable<string>): string {
  const norm = id.replace(/\\/g, '/').replace(/^\.\//, '');
  const list = [...known];
  if (list.includes(norm)) return norm;
  const low = norm.toLowerCase();
  return list.find((k) => k.toLowerCase() === low) ?? norm;
}

/** 피드백 id → 파일 이름에 쓸 수 있는가 */
export const validFeedbackId = (id: string): boolean => /^[\w.-]{1,120}$/.test(id);

/** 파일 이름에 쓸 수 있게: 모든 문자 체계의 글자·숫자는 남긴다 (김철수 → 김철수) */
export const safeName = (s: string): string => String(s).normalize('NFC').replace(/[^\p{L}\p{N}_.@-]/gu, '_').slice(0, 80) || 'me';

/** 같은 대상 쓰기 잠금 키. 서버·CLI·브라우저가 같은 이름의 잠금 파일을 쓴다 */
export const lockKey = {
  doc: (id: string) => 'doc:' + id.toLowerCase(),
  feedback: (id: string) => 'fb:' + id,
  state: 'state',
  /** changes.jsonl 덧붙이기 — 브라우저는 O_APPEND 가 없어 파일을 통째로 바꿔 끼우므로 서버·CLI 도 이 잠금 안에서 덧붙인다 */
  changes: 'changes',
};

/**
 * 이력 파일에서 새로 붙은 바이트 → 완성된 줄(마지막 줄바꿈까지)의 기록과 소비한 바이트 수.
 * 반쯤 쓴 줄은 남겨 두었다가 다음에 읽는다(위치는 바이트 단위 — 한글이 섞여도 어긋나지 않게).
 */
export function completeChangeLines(bytes: Uint8Array): { entries: ChangeEntry[]; consumed: number } {
  const end = bytes.lastIndexOf(0x0a);
  if (end < 0) return { entries: [], consumed: 0 };
  const entries: ChangeEntry[] = [];
  for (const l of new TextDecoder().decode(bytes.subarray(0, end)).split('\n')) {
    if (!l) continue;
    try { const e = JSON.parse(l); if (e && typeof e === 'object') entries.push(e); } catch { /* 깨진 줄 건너뜀 */ }
  }
  return { entries, consumed: end + 1 };
}

/** 넘기기 요청 파일 이름 */
export const requestFileName = (now = Date.now()): string => `req-${now}.json`;

// ---------------------------------------------------------------- 매니페스트

/** 문서 첫 `# 제목` (앞부분 글만 받아도 된다). 없으면 파일 이름 */
export function titleFromText(text: string, id: string): string {
  const base = id.split('/').pop()!.replace(/\.(md|markdown)$/i, '');
  const m = text.match(/^#\s+(.+)$/m);
  return m ? headingPlain(m[1]).slice(0, 80) : base;
}

/** README 먼저, 얕은 것 먼저, 이름순 */
export function sortDocIds(ids: string[]): string[] {
  return ids.slice().sort((a, b) => {
    const ra = /(^|\/)readme\.md$/i.test(a) ? 0 : 1, rb = /(^|\/)readme\.md$/i.test(b) ? 0 : 1;
    const da = a.split('/').length, db = b.split('/').length;
    return da - db || ra - rb || a.localeCompare(b, 'ko');
  });
}

export interface DocFileInfo { title: string; size?: number; mtimeMs?: number }

/** 설정 + 문서 목록 → 화면 매니페스트. 설정 그룹에 안 걸린 문서는 최상위 폴더별로 묶는다 */
export function buildManifest(c: WorkspaceConfig, docIds: string[], info: (id: string) => DocFileInfo | undefined, subtitle: string, ci = false, extra: { folders?: Manifest['folders']; rootName?: string } = {}): Manifest {
  const ids = sortDocIds(docIds);
  const groups: Manifest['groups'] = [];
  const taken = new Set<string>();
  for (const g of c.groups || []) {
    const docs = ids.filter((id) => !taken.has(id) && matchAny(id, g.match || [], ci));
    docs.forEach((d) => taken.add(d));
    groups.push({ id: g.id || g.label, label: g.label, note: g.note, docs, collapsed: g.collapsed });
  }
  const byDir = new Map<string, string[]>();
  for (const id of ids.filter((x) => !taken.has(x))) {
    const top = id.includes('/') ? id.split('/')[0] : '';
    if (!byDir.has(top)) byDir.set(top, []);
    byDir.get(top)!.push(id);
  }
  for (const [dir, docs] of [...byDir.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0], 'ko')))) {
    groups.push({ id: 'dir:' + (dir || '.'), label: dir || '문서', docs });
  }
  groups.unshift({ id: '_bench', label: '작업대', docs: [], views: ['map', 'changes'] });
  const docs: Manifest['docs'] = {};
  for (const id of ids) {
    const d = info(id);
    const over = c.docs?.[id] || {};
    docs[id] = {
      title: over.title || d?.title || id,
      role: over.role, audience: over.audience, trust: over.trust, depth: over.depth, notice: over.notice as Manifest['docs'][string]['notice'],
      readOnly: c.readOnly || over.readOnly || undefined,
      source: { path: id, size: d?.size, modified: d?.mtimeMs != null ? new Date(d.mtimeMs).toISOString() : undefined },
    };
  }
  return {
    schema: 2,
    project: { name: c.title, subtitle: c.subtitle || subtitle, links: c.links },
    milestones: c.milestones,
    trust: c.trust,
    groups,
    docs,
    render: c.render,
    assistantName: c.assistantName,
    folders: extra.folders,
    rootName: extra.rootName,
  };
}

/**
 * 폴더 나무에 넣을 폴더 기록기 — 훑으면서 폴더마다 "문서가 아닌 파일" 수를 센다.
 * 문서가 없는 폴더도 나무에 보여 주려고(탐색기와 같은 모양) 쓴다. 숨김·의존성 폴더는 훑지 않으므로 빠진다.
 */
export function folderTally(): { dir(rel: string): void; file(rel: string, isDoc: boolean): void; result(): Record<string, { files: number }> } {
  // 폴더 이름이 __proto__ 같아도 Object.prototype 을 건드리지 않게 — 프로토타입 없는 객체
  const m: Record<string, { files: number }> = Object.assign(Object.create(null) as Record<string, { files: number }>, { '': { files: 0 } });
  const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
  return {
    dir(rel) { m[rel] ||= { files: 0 }; },
    file(rel, isDoc) { const p = parentOf(rel); m[p] ||= { files: 0 }; if (!isDoc && !rel.split('/').pop()!.startsWith('.')) m[p].files++; },
    result: () => m,
  };
}

// ---------------------------------------------------------------- 변경 이력

/** changes.jsonl → 목록. note 줄(직접 편집 뒤 요약 덧붙이기)은 같은 판의 변경에 합친다 */
export function parseChanges(text: string, limit = 300): ChangeEntry[] {
  const lines = text.split('\n').filter(Boolean).slice(-Math.max(limit * 2, 400));
  const out: any[] = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch { /* 깨진 줄 건너뜀 */ } }
  const merged: any[] = [];
  for (const e of out) {
    if (e.type === 'note') {
      const tgt = [...merged].reverse().find((m) => m.docId === e.docId && (!e.toVersion || m.toVersion === e.toVersion));
      if (tgt) {
        tgt.summary = e.summary || tgt.summary;
        tgt.feedbackIds = [...new Set([...(tgt.feedbackIds || []), ...(e.feedbackIds || [])])];
        if (e.by && tgt.by?.kind === 'external') tgt.by = e.by;
        continue;
      }
      merged.push({ ...e, type: undefined });
    } else merged.push(e);
  }
  return merged.slice(-limit);
}

/** 이 문서의 가장 최근 기록이 이 판으로 가는가 — 예전 판으로 되돌린 외부 편집도 새 기록으로 남게 최근 것만 본다 */
export function lastChangeIs(list: ChangeEntry[], docId: string, version: string): boolean {
  const last = list.filter((c) => c.docId === docId).at(-1);
  return !!last && last.toVersion === version;
}

/** 이력 한 줄 (undefined 는 빼고) */
export const changeLine = (entry: ChangeEntry | Record<string, unknown>): string => JSON.stringify(JSON.parse(JSON.stringify(entry))) + '\n';

/** 사람과 AI 가 같이 읽는 파일이라 들여쓴다 */
export const jsonFile = (obj: unknown): string => JSON.stringify(obj, null, 2) + '\n';

// ---------------------------------------------------------------- 폴더 지도

export const INVENTORY_FLAG_LABELS = {
  doc: { label: '문서', tone: 'good' as const },
  modified: { label: '커밋 안 됨', tone: 'warn' as const },
  untracked: { label: '새 파일', tone: 'info' as const },
  added: { label: '추가됨', tone: 'info' as const },
};
