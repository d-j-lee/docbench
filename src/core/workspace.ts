/**
 * 작업 폴더 규약 — 서버(Node)·CLI 와 브라우저 폴더 어댑터가 같은 규칙을 쓴다.
 *
 * 문서 폴더(*.md, 정본은 언제나 이 파일들)와 **기록 폴더**(아래 모양)는 따로다. 기록 폴더는 둘 중 한 곳:
 *   - 밖(기본, D57): 기록 보관함/<문서 폴더 이름>/ — 문서 폴더에는 아무것도 만들지 않는다.
 *     보관함 = 이 PC 의 설정 dataHome(없으면 <PC 설정 폴더>/data), 브라우저는 사람이 고른 폴더(예: HTML 옆).
 *     기록 폴더에는 표식 docbench-data.json { protocol, docsName, docsPath? } — 어느 문서 폴더의 기록인지.
 *   - 안: <문서 폴더>/.docbench/ (예전 판·팀이 git 으로 함께 쓸 때)
 * 서버·CLI 가 찾는 순서는 server/workspace.mjs locateData (D58).
 *
 *   <기록 폴더>/
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
import type { ChangeEntry, Manifest, TreeEntry } from '../types';
import { headingPlain } from './markdown';

/** 밖에 둔 기록 폴더의 표식 — 어느 문서 폴더의 기록인지 */
export const DATA_MARKER = 'docbench-data.json';
/** 기록 보관함(문서 폴더마다 기록 폴더를 하나씩 담는 곳)의 표식 */
export const HOME_MARKER = 'docbench-home.json';
export const DATA_PROTOCOL = 1;

/**
 * 기록 폴더 표식. docs = 그 문서 폴더의 문서 몇 개(정렬, 최대 DATA_SAMPLE) — 이름이 같은 다른 문서 폴더를 가려낸다(브라우저는 경로를 모른다).
 * migrating = 문서 폴더 안 기록을 옮기는 중(끝나지 않았으면 다시 옮길 수 있다).
 */
export interface DataMarker {
  protocol: number; docsName: string; docsPath?: string; createdAt: string; docs?: string[]; migrating?: boolean;
  /** 더 넓은 작업 공간의 기록으로 합쳐짐 — 이 기록은 더 쓰지 않는다(지우지 않고 남긴다). to = 합친 기록 폴더 이름, prefix = 그 안의 이 폴더 경로 */
  mergedInto?: { to: string; prefix: string; at: string };
}
export const DATA_SAMPLE = 40;

/** 기록 보관함 안의 폴더 이름 = 문서 폴더 이름 (파일 이름에 못 쓰는 글자만 바꾼다). 드라이브 뿌리처럼 이름이 없으면 'root' */
export function dataFolderName(docsName: string): string {
  const s = (docsName || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  return s && !/^\.+$/.test(s) ? s.slice(0, 120) : 'root';
}

/** 표식 파일 → 모양이 맞으면 DataMarker */
export function parseDataMarker(x: unknown): DataMarker | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.docsName !== 'string') return null;
  const docs = Array.isArray(o.docs) ? o.docs.filter((x): x is string => typeof x === 'string').slice(0, DATA_SAMPLE) : undefined;
  const mi = o.mergedInto && typeof o.mergedInto === 'object' ? o.mergedInto as Record<string, unknown> : null;
  const mergedInto = mi && typeof mi.to === 'string' && typeof mi.prefix === 'string' ? { to: mi.to, prefix: mi.prefix, at: typeof mi.at === 'string' ? mi.at : '' } : undefined;
  return { protocol: Number(o.protocol) || 1, docsName: o.docsName, docsPath: typeof o.docsPath === 'string' && o.docsPath ? o.docsPath : undefined, createdAt: typeof o.createdAt === 'string' ? o.createdAt : '', ...(docs?.length ? { docs } : {}), ...(o.migrating === true ? { migrating: true } : {}), ...(mergedInto ? { mergedInto } : {}) };
}

export const newDataMarker = (docsName: string, docsPath?: string, docs?: string[]): DataMarker => ({ protocol: DATA_PROTOCOL, docsName, ...(docsPath ? { docsPath } : {}), createdAt: new Date().toISOString(), ...(docs?.length ? { docs: docsSample(docs) } : {}) });

/** 표식에 적을 문서 표본 — 정렬해서 앞의 DATA_SAMPLE 개 */
export const docsSample = (ids: Iterable<string>): string[] => [...ids].sort().slice(0, DATA_SAMPLE);

/** 어느 폴더에나 흔한 이름 — 같은 폴더인지 가리는 데 쓰지 않는다 */
const COMMON_DOC = /(^|\/)(readme|index|changelog|license|todo|notes?)\.(md|markdown)$/i;

/**
 * 표식의 문서 표본이 지금 문서 폴더와 같은 폴더의 것인가 (D61).
 *  - 표식에 표본이 없으면(빈 문서 폴더로 만들어짐) 가릴 수 없어 같다고 본다. 지금 폴더가 비었는데 표식에 표본이 있으면 다르다.
 *  - README·index 같은 흔한 이름은 빼고 비교한다(어느 한쪽이 그것뿐이면 둘 다 빼지 않고).
 *  - 표본은 정렬한 앞 DATA_SAMPLE 개라, 꽉 찬 표본끼리는 서로 겹치는 범위 안에서만 본다.
 *  - 겹친 수가 작은 쪽의 절반 이상이고, 2개 이상(작은 쪽이 1개면 1개) — 문서가 늘어도 같은 폴더로 남는다.
 */
export function sameDocsFolder(marker: DataMarker | null, ids: Iterable<string>): boolean {
  const a0 = marker?.docs || [];
  const b0 = docsSample(ids);
  if (!a0.length) return true;
  if (!b0.length) return false;
  // 흔한 이름을 빼되, 어느 한쪽이 흔한 이름뿐이면(README 하나로 시작한 폴더) 둘 다 빼지 않고 비교한다
  const fa = a0.filter((x) => !COMMON_DOC.test(x)), fb = b0.filter((x) => !COMMON_DOC.test(x));
  let a = fa.length && fb.length ? fa : a0, b = fa.length && fb.length ? fb : b0;
  if (a0.length >= DATA_SAMPLE && b0.length >= DATA_SAMPLE) {
    const hi = a[a.length - 1] < b[b.length - 1] ? a[a.length - 1] : b[b.length - 1];
    a = a.filter((x) => x <= hi); b = b.filter((x) => x <= hi);
    if (!a.length || !b.length) return false;
  }
  const set = new Set(b);
  const hit = a.filter((x) => set.has(x)).length;
  const small = Math.min(a.length, b.length);
  return hit >= Math.min(2, small) && hit / small >= 0.5;
}

/** 표본을 고칠 때: 비어 있지 않은 표본을 빈 표본으로 덮지 않는다(문서 폴더가 잠깐 비었거나 다른 빈 폴더가 열었을 때) */
export const nextDocsSample = (prev: string[] | undefined, ids: Iterable<string>): string[] => {
  const next = docsSample(ids);
  return next.length || !prev?.length ? next : prev;
};

/** 기록 보관함 안에서 이 문서 폴더 이름이 쓸 수 있는 폴더 이름들 — 같은 이름의 다른 문서 폴더가 있으면 '이름 (2)' … */
export const dataFolderCandidates = (docsName: string, n = 9): string[] => {
  const base = dataFolderName(docsName);
  return [base, ...Array.from({ length: n - 1 }, (_, i) => `${base} (${i + 2})`)];
};

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
  /** 계정 (이 PC 의 설정 user — 없으면 운영체제 로그인) */
  user: string;
  /** 표시 이름 (이 PC 의 설정 name — 없으면 user). 바꿔도 계정은 그대로 */
  name: string;
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
  name: '',
  maxDocs: 2000,
  maxInventory: 4000,
  inventory: { flags: true },
};

/** 이 PC 에만 해당하는 설정 — 문서 폴더 밖(사용자 폴더)에서만 읽는다 */
export interface PcSettings {
  user?: string;
  /** 표시 이름 (화면의 "나"에서 바꾼다) */
  name?: string;
  assistant?: WorkspaceConfig['assistant'];
  notify?: { command?: string[] | null };
  /** 이 문서 폴더의 기록 폴더 (workspaces[<폴더>].data) */
  data?: string;
  /** 이 폴더의 Claude 작업을 "내 것"으로 맡기는 계정 id (workspaces[<폴더>].owners — 연결 안내가 link --owner 로 적는다) */
  owners?: string[];
  /** DocBench 앱의 작업 공간 목록에 더한 때 (workspaces[<폴더>].added) */
  added?: string;
}

/**
 * 이 PC 의 설정에서 기록 자리: 이 문서 폴더의 짝(workspaces[<폴더>].data)과 기록 보관함(dataHome).
 * 경로 비교는 pcSettingsFor 와 같다.
 */
export function pcDataFor(file: unknown, rootPaths: string[], ci = false): { data?: string; dataHome?: string } {
  const f = (file && typeof file === 'object' ? file : {}) as { dataHome?: unknown; workspaces?: Record<string, PcSettings> };
  const norm = (p: string) => { const x = p.replace(/\\/g, '/').replace(/\/+$/, ''); return ci ? x.toLowerCase() : x; };
  const want = new Set(rootPaths.map(norm));
  let data: string | undefined;
  for (const [k, v] of Object.entries(f.workspaces || {})) if (want.has(norm(k)) && v && typeof v === 'object' && typeof v.data === 'string' && v.data) data = v.data;
  return { data, dataHome: typeof f.dataHome === 'string' && f.dataHome ? f.dataHome : undefined };
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
    name: typeof f.name === 'string' ? f.name : undefined,
    owners: Array.isArray(ws.owners) ? ws.owners.filter((x) => typeof x === 'string') : undefined,
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
 * 브라우저(단일 HTML)는 pc 를 넘기지 않는다 — 명령을 실행하지 않고, 사람은 그 브라우저의 계정(표시 이름은 화면의 "나", D63).
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
  delete (shared as Partial<WorkspaceConfig>).name;
  const sharedNotify = { ...(shared.notify || {}) };
  if (sharedNotify.command != null) warnings.push(`문서 폴더 config.json 의 notify.command 는 쓰지 않습니다 — ${where}에 두세요.`);
  delete sharedNotify.command;
  const out: WorkspaceConfig = {
    ...DEFAULT_CONFIG, ...shared,
    notify: { ...DEFAULT_CONFIG.notify, ...sharedNotify, ...(pc?.notify?.command != null ? { command: pc.notify.command } : {}) },
    assistant: pc?.assistant ?? null,
    user: pc?.user || '',
    name: pc?.name || '',
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
  docFloor(rel) && matchAny(rel, c.include, ci) && !matchAny(rel, c.exclude, ci);

/**
 * 설정과 상관없이 문서가 될 수 있는 바닥 규칙 — 마크다운 파일이고, 숨김(.git·.docbench·.vscode …)·의존성 폴더 안이 아닐 것.
 * 함께 쓰는 config.json 의 include 는 누구나 고칠 수 있다: `**\/*` 로 넓혀 `.git/hooks/…` 나 스크립트를 "문서"로 만들고
 * 꾸민 피드백으로 Claude 작업이 그 파일을 고치게 하는 길을 막는다(D71).
 */
export const docFloor = (rel: string): boolean =>
  /\.(md|markdown)$/i.test(rel) && !rel.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules');

/** 훑을 폴더인가 — 숨김 폴더·빌드 산출물·의존성 폴더는 건너뛴다 */
export const walkable = (dirName: string): boolean => !IGNORE_DIRS.has(dirName) && !dirName.startsWith('.') && !SYSTEM_DIRS.has(dirName);

// ---------------------------------------------------------------- 가벼운 열기 (D64)

/** 운영체제가 드라이브·홈 맨 위에 두는 것 — 문서를 찾으러 들어가지 않는다 */
const SYSTEM_DIRS = new Set(['$RECYCLE.BIN', 'System Volume Information', '$Recycle.Bin', 'Recovery', '$WinREAgent', 'Config.Msi']);
const BIG_ROOT_MARKS = ['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', '$RECYCLE.BIN', 'System Volume Information', 'AppData', 'NTUSER.DAT', 'Applications', 'Library', 'usr', 'etc', 'var'];

/**
 * 드라이브·홈·시스템 맨 위처럼 아주 큰 폴더인가 — 그러면 열 때 전부 훑지 않고 맨 위만 본다(펼친 폴더는 tree 로).
 * 이름(드라이브 문자, 빈 이름)과 맨 위 항목(Windows·Program Files·$RECYCLE.BIN·AppData …)으로 가린다.
 */
export function looksBigRoot(rootName: string, topNames: string[]): boolean {
  if (/^([a-zA-Z]:[\\/]?|[\\/]|)$/.test(rootName.trim())) return true;
  const have = new Set(topNames);
  const hits = BIG_ROOT_MARKS.filter((n) => have.has(n)).length;
  return hits >= 2 || have.has('$RECYCLE.BIN') || have.has('System Volume Information') || have.has('NTUSER.DAT');
}

/** 열 때 문서를 찾는 한도 — 들른 항목 수·시간. 넘으면 찾은 데까지만 목록에(나머지는 펼칠 때) */
export const SCAN_LIMITS = { visits: 20000, ms: 2500 };

/** 나무 한 폴더에 보일 항목 수 한도 (더 있으면 잘라 내고 수를 알린다) */
export const TREE_MAX = 2000;

/**
 * 폴더 하나의 항목 → 나무 항목. 숨김·의존성·시스템 폴더와 점으로 시작하는 파일은 뺀다. 폴더 먼저, 그다음 이름순(숫자는 크기순).
 * 문서 여부는 설정의 include/exclude 를 따른다.
 */
/** 파일 이름 순서 — 탐색기처럼: 숫자는 크기순, 대소문자 무시, 숫자·영문·한글 차례 ('ko' 정렬은 한글을 영문 앞에 둔다) */
export const fileNameOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function toTreeEntries(raw: { name: string; kind: 'file' | 'directory'; size?: number; mtimeMs?: number }[], dir: string, c: Pick<WorkspaceConfig, 'include' | 'exclude'>, ci = false): TreeEntry[] {
  const pre = dir ? dir.replace(/\/+$/, '') + '/' : '';
  const out: TreeEntry[] = [];
  for (const e of raw) {
    if (e.kind === 'directory') { if (walkable(e.name)) out.push({ name: e.name, path: pre + e.name, kind: 'dir' }); continue; }
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const path = pre + e.name;
    const doc = isDocPath(path, c, ci);
    out.push({ name: e.name, path, kind: 'file', ...(doc ? { doc: true } : {}), ...(e.size != null ? { size: e.size } : {}), ...(e.mtimeMs != null ? { modified: new Date(e.mtimeMs).toISOString() } : {}) });
  }
  return out.sort((a, b) => (a.kind === b.kind ? fileNameOrder.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1));
}

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
    project: { name: c.title, subtitle: c.subtitle || (subtitle !== c.title ? subtitle : ''), links: c.links },
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
