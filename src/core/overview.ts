/**
 * 작업 공간 개요(D88) — 파일 시스템 전체의 모양·메타데이터·위생 점검을 한 화면에. DOM 없이 돈다(서버·단일 HTML·CLI 가 한 벌로).
 *
 * 작업 공간은 목적이 있고, 그 목적에 맞게 폴더·문서가 놓여야 한다. 개요는 그것을 드러낸다:
 *   목적        함께 쓰는 설정(config.json purpose) 또는 맨 위 README 의 앞머리 description·첫 문단 — README 가 정본
 *   구성        묶음(문서·데이터와 설정·코드·오피스·그림·PDF …)별 파일 수·용량, 맨 위 폴더마다 역할(그 폴더 README 또는 설정)·크기·최근
 *   메타데이터   문서 앞머리의 상태(status)·담당(owner)·꼬리표(tags)·검토일(review·expires …)
 *   AI 협업     CLAUDE.md·AGENTS.md·스킬·프롬프트 파일
 *   점검        비밀로 보이는 파일, 아주 큰 파일, README 없음, 검토 기한 지남, 판 이름 사본(_최종(1)), 임시 파일, 빈 폴더,
 *              README 없는 큰 폴더, 같은 이름 문서, 너무 긴 경로, 오래된 문서, 깨진 링크·어디서도 가리키지 않는 문서, 커밋 안 한 변경
 * 내용은 메타데이터와 앞부분(README·앞머리·링크)만 본다. 점검 문구는 화면 사전이 정한다(code + n) — 서버가 문장을 박지 않는다(D30).
 */
import type { AiFileKind, BuiltinCheckCode, FileGroup, InventoryItem, OverviewCheck, OverviewFolder, RuleProblem, WorkspaceOverview, WorkspaceRules } from '../types';
import { fileGroupOf, formatOf, looksSecret } from './formats';
import { evaluateRules, matchPath, rulesProblemCheck } from './rules';
import { walkable } from './workspace';

export { looksSecret };
import { frontMatterData, frontMatterLength, toLF } from './markdown';

export interface OverviewInput {
  root: string;
  /** 폴더 지도와 같은 항목 (inventory) — 폴더는 id 가 '/' 로 끝난다 */
  items: InventoryItem[];
  complete: boolean;
  reason?: 'big-root' | 'many';
  /** 이 파일이 작업대 문서인가 (설정의 include·exclude 포함) */
  isDoc: (path: string) => boolean;
  /** 문서마다 앞머리 메타데이터 (매니페스트가 앞부분을 읽은 문서만) */
  meta?: Record<string, Record<string, string | string[]> | undefined>;
  config?: { purpose?: string; folders?: Record<string, { role?: string } | undefined> };
  /** README 앞부분 글: 폴더 ('' = 맨 위) → { id, text } */
  readmes?: Record<string, { id: string; text: string }>;
  /** 문서 사이 링크 (훑었을 때만) — 상대 경로를 작업 공간 기준으로 푼 대상 */
  links?: { from: string; to: string[] }[];
  git?: boolean;
  /**
   * 팀 규칙 파일(D90 — 문서 폴더 맨 위 docbench.json). spec 이 null 이면 읽지 못한 것(problems 에 까닭).
   * 목적·폴더 역할은 이것이 config 보다 먼저(함께 쓰는 정본), 그다음 README
   */
  rules?: { file: string; spec: WorkspaceRules | null; problems: RuleProblem[] };
  /** 바뀌지 않은 파일의 마지막 커밋 시각(ms) — git 저장소를 막 받은 폴더는 파일 시각이 받은 때라 오래됨·검토 주기가 틀린다 */
  changed?: Record<string, number>;
  /** 점검마다 담을 경로 수 (기본 40 — CI 는 전부) */
  pathsMax?: number;
  /** 경로 대소문자 무시 (Windows) */
  ci?: boolean;
  now?: number;
}

/** 점검마다 보일 경로 수 */
const PATHS_MAX = 40;
const DAY = 864e5;

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop() || p;
const topOf = (p: string) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '');

/** README 인가 (어느 형식이든) */
export const isReadmeName = (name: string): boolean => /^readme(\.[\w]+)?$/i.test(name);
const isIndexName = (name: string): boolean => isReadmeName(name) || /^(index|_index|00[-_ ]?index)\.(md|markdown|txt|html?)$/i.test(name);

// ---------------------------------------------------------------- README 요약

/** 마크다운 한 줄을 글자만 — 링크·강조·코드 표시를 뗀다 */
const plain = (s: string) => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/[*_`~]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * README 의 한두 문장 요약 — 앞머리 description·summary·purpose, 없으면 제목 다음 첫 문단(배지·그림·주석·표·코드 블록은 건너뛴다). 200자까지
 */
export function readmeSummary(text: string): string {
  const md = toLF(text || '');
  const fm = frontMatterData(md);
  for (const k of ['description', 'summary', 'purpose', '목적', '설명']) { const v = fm[k]; if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200); }
  const body = md.slice(frontMatterLength(md)).replace(/<!--[\s\S]*?-->/g, '');
  let fence = false;
  const para: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; if (para.length) break; continue; }
    if (fence) continue;
    if (!line) { if (para.length) break; continue; }
    if (/^(#{1,6}\s|=+$|-+$|\||>|!\[|\[!\[|<)/.test(line) || /^[-*+]\s|^\d+[.)]\s/.test(line) && !para.length) { if (para.length) break; continue; }
    para.push(line);
  }
  const s = plain(para.join(' '));
  return s.length > 200 ? s.slice(0, 199) + '…' : s;
}

// ---------------------------------------------------------------- 링크

/**
 * 마크다운 문서의 상대 링크 → 작업 공간 기준 경로(#·? 는 뗀다). 바깥 주소·메일·앵커만인 링크·절대 경로는 뺀다.
 * 코드 블록·인라인 코드 안은 보지 않는다.
 */
export function relativeLinks(md: string, fromId: string): string[] {
  const text = toLF(md).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');
  const out = new Set<string>();
  const add = (raw: string) => { const p = resolveRelative(fromId, raw); if (p) out.add(p); };
  for (const m of text.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+["'(][^)]*)?\)/g)) add(m[1]);
  for (const m of text.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/gm)) add(m[1]);
  return [...out];
}

/**
 * 문서 안 상대 주소 → 작업 공간 기준 경로 (#·? 는 떼고 %·./·../ 를 푼다). 바깥 주소·메일·앵커만·절대 경로·맨 위 밖이면 null.
 * 폴더를 가리키면 끝에 '/'. 화면이 그림·링크를 작업 공간 파일로 잇는 데도 쓴다
 */
export function resolveRelative(fromId: string, raw: string): string | null {
  let t = String(raw || '').trim().replace(/^<|>$/g, '');
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('#') || t.startsWith('/') || t.startsWith('//') || t.startsWith('\\')) return null;
  t = t.split('#')[0].split('?')[0];
  if (!t) return null;
  try { t = decodeURIComponent(t); } catch { /* 그대로 */ }
  const segs: string[] = [];
  for (const s of (parentOf(fromId) ? parentOf(fromId) + '/' : '').concat(t).split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (!segs.length) return null; segs.pop(); continue; }
    segs.push(s);
  }
  return segs.length ? segs.join('/') + (t.endsWith('/') ? '/' : '') : null;
}

// ---------------------------------------------------------------- 이름 규칙


/** 임시·잠금·OS 부산물 파일 */
export const looksTemp = (name: string): boolean =>
  /^~\$/.test(name) || /^\.~lock\..*#$/.test(name) || /\.(tmp|temp|crdownload|part|partial|swp|swo)$/i.test(name) || /^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(name) || /^~.*\.tmp$/i.test(name);

/**
 * 판·사본 표시 — 이름 끝의 (1)·(최종)·_v2·-final·_old·.bak·최종본·복사본 … 영어 낱말은 구분자(공백 _ . -) 뒤에서만
 * (bold·prev 의 old·rev 를 판 표시로 읽지 않게). 한국어 표시는 붙여 써도 읽는다(보고서최종본)
 */
const VERSION_TOKEN = /(?:\s*\(\d+\)|\s*\((?:최종|최최종|수정|수정본|사본|복사본|초안|final|copy)\)|[\s_.-]+(?:copy(?:\s*\d+)?|final|old|bak|backup|v\d+(?:\.\d+)*|rev\d*|r\d+|draft\d*)|[\s_.-]*(?:최최종|최종본?|수정본|복사본|사본|초안|백업)|\s*-\s*복사본(?:\s*\(\d+\))?)+$/i;
/** 하나만 있어도 사본으로 보이는 이름 (copyright 의 copy 는 아니다) */
const COPY_ALONE = /\(\d+\)(\.[^.]+)?$|복사본|(^|[\s_-])사본|^copy of |[\s_-]copy(\s*\d+)?(\.[^.]+)?$|최최종|\.(bak|orig)$/i;

/** 판·사본 표시를 뗀 이름(소문자 + 확장자) — 같은 폴더에서 같은 문서의 여러 판을 묶는다 */
export function versionFamily(name: string): { base: string; marked: boolean } {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  const s = stem.replace(/^(copy of\s+|사본\s*-\s*)/i, '');
  const base = s.replace(VERSION_TOKEN, '').trim();
  return { base: (base || s).toLowerCase() + ext, marked: base !== s || s !== stem || /\.(bak|orig|old)$/i.test(name) };
}

/** 어디에나 흔한 이름 — 같은 이름 점검에서 뺀다 */
const COMMON_NAME = /^(readme|index|_index|changelog|license|licence|notice|todo|notes?|contributing|claude|agents|gemini|skill|summary|overview|intro|introduction|목차|개요|소개|readme\.ko|readme\.en)\.[\w]+$/i;

// ---------------------------------------------------------------- 앞머리 메타데이터

/** 문서 하나의 앞머리에서 읽는 것 — 개요의 모음과 문서 머리의 칩이 같은 규칙을 쓴다 */
export interface DocFrontMeta { status?: string; owners: string[]; tags: string[]; dates: { field: string; date: string; past: boolean }[] }

const STATUS_KEYS = ['status', 'state', '상태'];
const OWNER_KEYS = ['owner', 'owners', 'author', 'authors', 'assignee', '담당', '담당자', '작성자'];
const TAG_KEYS = ['tags', 'tag', 'keywords', 'labels', 'categories', '꼬리표', '태그'];

/** 앞머리(frontMatterData) → 상태·담당·꼬리표·기한. past = 오늘보다 하루 넘게 지난 날짜 */
export function docMetaOf(fm: Record<string, string | string[]>, now = Date.now()): DocFrontMeta {
  const out: DocFrontMeta = { owners: [], tags: [], dates: [] };
  for (const k of STATUS_KEYS) { const v = fm[k]; const x = typeof v === 'string' ? v : Array.isArray(v) ? v[0] : ''; if (x) { out.status = x.trim().slice(0, 40); break; } }
  for (const k of OWNER_KEYS) {
    const v = fm[k];
    if (typeof v === 'string' && v.trim()) { out.owners = [v.trim().slice(0, 40)]; break; }
    if (Array.isArray(v) && v.length) { out.owners = v.slice(0, 5).map((x) => x.trim().slice(0, 40)).filter(Boolean); break; }
  }
  for (const k of TAG_KEYS) {
    const v = fm[k];
    const list = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(/[,\s]+/) : [];
    for (const x of list.slice(0, 12)) { const tg = x.trim().slice(0, 40); if (tg && !out.tags.includes(tg)) out.tags.push(tg); }
  }
  for (const k of DUE_FIELDS) {
    const v = fm[k];
    const ms = typeof v === 'string' ? dateMs(v) : null;
    if (ms != null) out.dates.push({ field: k, date: (v as string).trim().slice(0, 10), past: ms < now - DAY });
  }
  return out;
}

// ---------------------------------------------------------------- 날짜

const DUE_FIELDS = ['review', 'review_by', 'review-by', 'reviewby', 'review_date', 'next_review', 'next-review', 'expires', 'expiry', 'expire', 'due', 'deadline', 'valid_until', '검토일', '검토기한', '만료일', '기한'];
/** 앞머리 날짜 값 → ms (YYYY-MM-DD · YYYY.MM.DD · YYYY/MM/DD) */
function dateMs(v: string): number | null {
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(v.trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------- 계산

/** 개요를 만든다 — 입력은 메타데이터와 앞부분 글뿐 */
export function computeOverview(input: OverviewInput): WorkspaceOverview {
  const now = input.now ?? Date.now();
  const files = input.items.filter((i) => !i.folder);
  const dirs = input.items.filter((i) => i.folder);
  const pathOf = (i: InventoryItem) => i.id.replace(/\/$/, '');
  const mtime = (i: InventoryItem) => (i.modified ? Date.parse(i.modified) : NaN);
  /** 마지막 변경 — 커밋 뒤 손대지 않은 파일은 커밋 시각, 아니면 파일 시각 */
  const changedAt = (i: InventoryItem) => {
    const c = input.changed?.[i.id];
    return c != null && !(i.flags || []).some((x) => x === 'modified' || x === 'untracked' || x === 'added') ? c : mtime(i);
  };
  const isDoc = (p: string) => { try { return input.isDoc(p); } catch { return false; } };
  const spec = input.rules?.spec || null;
  const ci = !!input.ci;
  const pathsMax = input.pathsMax ?? PATHS_MAX;
  const ignored = (p: string) => !!spec?.ignore.length && matchPath(p, spec.ignore, ci);

  // 묶음
  const groups = new Map<FileGroup, { files: number; bytes: number }>();
  let bytes = 0, docs = 0, recent7 = 0, newest = 0;
  for (const f of files) {
    const g = fileGroupOf(f.id);
    const cur = groups.get(g) || { files: 0, bytes: 0 };
    cur.files++; cur.bytes += f.size || 0;
    groups.set(g, cur);
    bytes += f.size || 0;
    if (isDoc(f.id)) docs++;
    const t = mtime(f);
    if (t > newest) newest = t;
    if (now - t <= 7 * DAY) recent7++;
  }

  // 맨 위 폴더
  const readmes = input.readmes || {};
  const folderMap = new Map<string, OverviewFolder>();
  const ensureFolder = (p: string) => { let f = folderMap.get(p); if (!f) { f = { path: p, files: 0, docs: 0, bytes: 0 }; folderMap.set(p, f); } return f; };
  for (const d of dirs) if (!pathOf(d).includes('/')) ensureFolder(pathOf(d));
  for (const f of files) {
    const top = topOf(f.id);
    const fo = ensureFolder(top);
    fo.files++; fo.bytes += f.size || 0;
    if (isDoc(f.id)) fo.docs++;
    if (f.modified && (!fo.modified || f.modified > fo.modified)) fo.modified = f.modified;
  }
  for (const fo of folderMap.values()) {
    const cfg = spec?.folders?.[fo.path]?.role || input.config?.folders?.[fo.path]?.role;
    const rd = readmes[fo.path];
    if (rd) fo.readme = rd.id;
    if (cfg && cfg.trim()) { fo.role = cfg.trim().slice(0, 200); fo.roleFrom = 'config'; }
    else if (rd && fo.path) { const s = readmeSummary(rd.text); if (s) { fo.role = s; fo.roleFrom = 'readme'; } }
  }
  const folders = [...folderMap.values()].sort((a, b) => (a.path === '' ? 1 : b.path === '' ? -1 : a.path.localeCompare(b.path, 'ko')));

  // 목적 — 팀 규칙 파일 → 기록 폴더 설정 → 맨 위 README
  let purpose: WorkspaceOverview['purpose'];
  if (spec?.purpose) purpose = { text: spec.purpose, from: 'config', docId: input.rules!.file };
  else if (input.config?.purpose?.trim()) purpose = { text: input.config.purpose.trim().slice(0, 400), from: 'config' };
  else if (readmes['']) { const s = readmeSummary(readmes[''].text); if (s) purpose = { text: s, from: 'readme', docId: readmes[''].id }; }

  // 최근·큰 파일
  const recent = files.filter((f) => f.modified).sort((a, b) => (b.modified! < a.modified! ? -1 : b.modified! > a.modified! ? 1 : 0)).slice(0, 8)
    .map((f) => ({ path: f.id, modified: f.modified!, size: f.size, ...(isDoc(f.id) ? { doc: true } : {}) }));
  const large = files.filter((f) => (f.size || 0) > 0).sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 5)
    .map((f) => ({ path: f.id, size: f.size || 0, ...(isDoc(f.id) ? { doc: true } : {}) }));

  // 앞머리 메타데이터
  const meta: WorkspaceOverview['meta'] = { docs: 0, status: {}, owners: {}, tags: {}, due: [] };
  const bump = (m: Record<string, number>, k: string) => { const key = k.trim().slice(0, 40); if (key) m[key] = (m[key] || 0) + 1; };
  for (const [id, fm] of Object.entries(input.meta || {})) {
    if (!fm || !Object.keys(fm).length) continue;
    meta.docs++;
    const d = docMetaOf(fm, now);
    if (d.status) bump(meta.status, d.status.toLowerCase());
    d.owners.forEach((x) => bump(meta.owners, x));
    d.tags.forEach((x) => bump(meta.tags, x));
    for (const x of d.dates) if (x.past) meta.due.push({ docId: id, field: x.field, date: x.date });
  }
  meta.due.sort((a, b) => a.date.localeCompare(b.date));

  // AI 협업 파일 (숨김 파일은 맨 위만 — 폴더 지도는 숨김 폴더에 들어가지 않는다)
  const ai: WorkspaceOverview['ai'] = [];
  for (const f of files) {
    const n = baseOf(f.id);
    const lo = n.toLowerCase();
    const kind: AiFileKind | null = /^claude(\.local)?\.md$/.test(lo) ? 'claude' : lo === 'agents.md' ? 'agents' : lo === 'gemini.md' ? 'gemini'
      : lo === '.cursorrules' || lo === '.windsurfrules' ? 'cursor' : lo === 'copilot-instructions.md' ? 'copilot' : lo === '.mcp.json' || lo === 'mcp.json' ? 'mcp'
        : lo === 'skill.md' ? 'skill' : /\.prompt(\.md)?$/.test(lo) || /(^|\/)prompts?\//i.test(f.id) && formatOf(f.id) ? 'prompt' : null;
    if (kind) ai.push({ path: f.id, kind });
  }
  ai.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));

  // git
  let git: WorkspaceOverview['git'];
  if (input.git) {
    git = { modified: 0, untracked: 0, added: 0 };
    for (const f of files) for (const fl of f.flags || []) if (fl === 'modified' || fl === 'untracked' || fl === 'added') git[fl]++;
  }

  // ---- 점검
  const checks: OverviewCheck[] = [];
  /** 늘 하는 점검 하나 — 팀 규칙의 ignore 경로는 빼고, checks 가 정한 수준(또는 끔)으로. n 은 뺀 뒤의 수 */
  const push = (code: BuiltinCheckCode, level: OverviewCheck['level'], paths: string[], n?: number) => {
    const lv = spec?.checks[code] ?? level;
    if (lv === 'off') return;
    const kept = spec?.ignore.length ? paths.filter((p) => !ignored(p)) : paths;
    const count = n == null || kept.length !== paths.length ? kept.length : n;
    if (count > 0) checks.push({ code, level: lv, n: count, paths: kept.slice(0, pathsMax) });
  };

  push('secrets', 'risk', files.filter((f) => looksSecret(baseOf(f.id), f.size)).map((f) => f.id));
  const huge = files.filter((f) => (f.size || 0) >= 50 * 1024 * 1024);
  push('huge-files', input.git ? 'action' : 'info', huge.map((f) => f.id));
  const rootReadme = files.some((f) => !f.id.includes('/') && isReadmeName(baseOf(f.id)));
  const noReadme = spec?.checks['no-readme'] ?? 'action';
  if (!rootReadme && files.length && noReadme !== 'off') checks.push({ code: 'no-readme', level: noReadme, n: 1, paths: [] });
  push('review-due', 'action', meta.due.map((d) => d.docId));

  // 링크
  let linksInfo: WorkspaceOverview['links'];
  if (input.links) {
    const fileSet = new Set(files.map((f) => f.id.toLowerCase()));
    const dirSet = new Set(dirs.map((d) => pathOf(d).toLowerCase()));
    const broken: string[] = [];
    const linked = new Set<string>();
    let count = 0;
    for (const l of input.links) {
      for (const to of l.to) {
        count++;
        const t = to.replace(/\/$/, '').toLowerCase();
        if (fileSet.has(t)) linked.add(t);
        // 폴더 지도가 들어가지 않는 폴더(.docbench·node_modules·dist …) 안은 있는지 알 수 없다 — 깨졌다고 하지 않는다
        else if (!dirSet.has(t) && input.complete && to.split('/').slice(0, -1).every((seg) => walkable(seg))) broken.push(l.from);
      }
    }
    linksInfo = { docs: input.links.length, links: count };
    // n = 깨진 링크가 있는 문서 수 (문구가 문서를 센다)
    push('broken-links', 'action', [...new Set(broken)]);
    // 어디서도 가리키지 않는 문서 — 문서끼리 링크로 잇는 작업 공간에서만(링크가 거의 없으면 뜻이 없다)
    if (count >= Math.max(5, input.links.length / 2)) {
      const orphans = input.links.map((l) => l.from).filter((id) => !isIndexName(baseOf(id)) && id.includes('/') && !linked.has(id.toLowerCase()) && !COMMON_NAME.test(baseOf(id)));
      push('orphan-docs', 'info', orphans);
    }
  }

  // 판 이름 사본: 판 표시가 붙은 이름이거나, 같은 폴더에 같은 문서의 판이 둘 이상
  const fam = new Map<string, string[]>();
  for (const f of files) { const v = versionFamily(baseOf(f.id)); const k = parentOf(f.id) + '/' + v.base; const arr = fam.get(k) || []; arr.push(f.id); fam.set(k, arr); }
  const copies: string[] = [];
  for (const arr of fam.values()) {
    if (arr.length > 1) { if (arr.some((p) => versionFamily(baseOf(p)).marked)) copies.push(...arr); }
    else if (COPY_ALONE.test(baseOf(arr[0]))) copies.push(arr[0]);
  }
  push('version-copies', 'tidy', copies);
  push('temp-files', 'tidy', files.filter((f) => looksTemp(baseOf(f.id))).map((f) => f.id));

  // 빈 폴더 · README 없는 큰 폴더 (다 훑었을 때만 — 일부만 훑으면 비어 보인다)
  if (input.complete) {
    const count = new Map<string, number>();
    for (const f of files) { let p = parentOf(f.id); while (p) { count.set(p, (count.get(p) || 0) + 1); p = parentOf(p); } }
    push('empty-folders', 'tidy', dirs.map(pathOf).filter((p) => !count.get(p)));
    const direct = new Map<string, string[]>();
    for (const f of files) { const p = parentOf(f.id); const arr = direct.get(p) || []; arr.push(baseOf(f.id)); direct.set(p, arr); }
    push('folder-no-readme', 'tidy', folders.filter((fo) => fo.path && fo.files >= 8 && !(direct.get(fo.path) || []).some(isIndexName)).map((fo) => fo.path + '/'));
  }

  // 같은 이름 문서 (다른 폴더) — 흔한 이름(README·index …)은 빼고 문서 묶음만
  const byName = new Map<string, string[]>();
  for (const f of files) {
    const n = baseOf(f.id);
    if (COMMON_NAME.test(n) || !['doc', 'office', 'pdf'].includes(fileGroupOf(n))) continue;
    const arr = byName.get(n.toLowerCase()) || [];
    arr.push(f.id);
    byName.set(n.toLowerCase(), arr);
  }
  push('same-name', 'tidy', [...byName.values()].filter((a) => new Set(a.map(parentOf)).size > 1).flat());
  // 너무 긴 경로 — Windows(260자)·동기화 도구가 다루지 못할 수 있다. 작업 공간 위 경로가 더해지므로 넉넉히 160자
  push('long-paths', 'tidy', input.items.filter((i) => i.id.length > 160).map((i) => i.id));
  push('stale-docs', 'info', files.filter((f) => isDoc(f.id) && Number.isFinite(changedAt(f)) && now - changedAt(f) > 365 * DAY).map((f) => f.id));
  if (git && git.modified + git.untracked + git.added) push('git-uncommitted', 'info', files.filter((f) => (f.flags || []).some((x) => x === 'modified' || x === 'untracked' || x === 'added')).map((f) => f.id));

  // 팀 규칙 (D90)
  let rulesInfo: WorkspaceOverview['rules'];
  if (input.rules) {
    const bad = rulesProblemCheck(input.rules.file, input.rules.problems);
    if (bad) checks.push(bad);
    let unchecked = 0;
    if (spec) {
      const r = evaluateRules({
        spec, files, dirs, complete: input.complete, isDoc, meta: input.meta || {}, changedAt, dateMs, isIndexName,
        marked: (n) => versionFamily(n).marked || COPY_ALONE.test(n), ci, now, pathsMax, ignored,
      });
      checks.push(...r.checks);
      unchecked = r.unchecked;
    }
    rulesInfo = { file: input.rules.file, count: spec?.rules.length || 0, problems: input.rules.problems.length, unchecked };
  }

  const order = { risk: 0, action: 1, tidy: 2, info: 3 };
  checks.sort((a, b) => order[a.level] - order[b.level]);

  return {
    asof: new Date(now).toISOString(),
    root: input.root,
    ...(purpose ? { purpose } : {}),
    scope: { complete: input.complete, items: input.items.length, ...(input.reason ? { reason: input.reason } : {}) },
    totals: { files: files.length, dirs: dirs.length, bytes, docs, recent7, ...(newest ? { newest: new Date(newest).toISOString() } : {}) },
    groups: [...groups.entries()].map(([group, v]) => ({ group, ...v })).sort((a, b) => b.files - a.files),
    folders,
    recent,
    large,
    meta,
    ai,
    ...(git ? { git } : {}),
    ...(linksInfo ? { links: linksInfo } : {}),
    ...(rulesInfo ? { rules: rulesInfo } : {}),
    checks,
  };
}

/** 링크를 훑어도 되는 크기 — 마크다운 문서 수·총 바이트 */
export const OVERVIEW_LINK_LIMITS = { docs: 400, bytes: 8 * 1024 * 1024 };
/** README 를 읽을 맨 위 폴더 수 */
export const OVERVIEW_README_MAX = 60;

/**
 * 개요에 넣을 README 를 고른다 — 맨 위와 맨 위 폴더마다 하나(README.md 먼저). 항목 목록에서
 */
export function pickReadmes(items: InventoryItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  const rank = (n: string) => (/\.md$/i.test(n) ? 0 : /\.(markdown|txt|rst|adoc)$/i.test(n) ? 1 : !n.includes('.') ? 2 : 3);
  for (const f of items) {
    if (f.folder) continue;
    const n = baseOf(f.id);
    // 글로 읽는 README 만(README.md · .txt · .rst · .adoc · .org · 확장자 없음) — README.pdf·README.docx 같은 것의 바이트를 목적으로 읽지 않게
    if (!isReadmeName(n) || !/^readme(\.(md|markdown|txt|text|rst|adoc|asciidoc|org))?$/i.test(n)) continue;
    const dir = parentOf(f.id);
    if (dir.includes('/')) continue;
    if (!out[dir] || rank(n) < rank(baseOf(out[dir]))) out[dir] = f.id;
  }
  const keys = Object.keys(out).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).slice(0, OVERVIEW_README_MAX + 1);
  return Object.fromEntries(keys.map((k) => [k, out[k]]));
}
