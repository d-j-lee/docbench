/**
 * 팀 규칙 (D90) — 문서 폴더 맨 위의 docbench.json 에 팀이 적은 약속(앞머리 키·폴더 README·이름 규칙·검토 주기·두지 않을 파일·
 * 크기 한도·있어야 할 파일)으로 작업 공간을 점검한다. 개요 화면·`docbench overview`·CI 의 `docbench check` 가 같은 규칙.
 *
 * 규칙 파일은 사람이 쓰는 문서다(git 으로 함께) — DocBench 는 읽기만 한다(사람이 고른 "규칙 파일 만들기" 말고는 쓰지 않는다).
 * 읽는 키는 정해 둔 것뿐이고(purpose·folders·ignore·checks·rules), 실행 명령·사람 같은 이 PC 의 설정은 여기서 읽지 않는다.
 * 남이 만든 폴더를 열어도 안전하게: 경로 패턴은 정규식이 아닌 glob(되돌아가기 없음), 이름 규칙은 정해 둔 것만, 크기·개수에 한도.
 */
import type { BuiltinCheckCode, CheckLevel, InventoryItem, NameStyle, OverviewCheck, RuleKind, RuleProblem, RuleSpec, WorkspaceRules } from '../types';
import { globMatch, matchAny } from './workspace';
import { isMarkdownPath } from './formats';

/** 규칙 파일 이름 — 문서 폴더 맨 위 */
export const RULES_FILE = 'docbench.json';
/** 편집기 자동 완성·검사용 스키마 주소(저장소 main 의 docs/docbench.schema.json) */
export const RULES_SCHEMA_URL = 'https://raw.githubusercontent.com/d-j-lee/docbench/main/docs/docbench.schema.json';
/** 규칙 파일 크기 한도 */
export const RULES_MAX_BYTES = 256 * 1024;
const RULES_MAX = 100;
const PATTERNS_MAX = 50;
const PATTERN_LEN_MAX = 300;

export const RULE_KINDS: readonly RuleKind[] = ['front-matter', 'readme', 'naming', 'review', 'forbid', 'max-size', 'require'];
export const NAME_STYLES: readonly NameStyle[] = ['kebab-case', 'snake_case', 'lowercase', 'no-spaces', 'ascii', 'date-prefix', 'number-prefix', 'no-version-marks'];
export const CHECK_LEVELS: readonly CheckLevel[] = ['risk', 'action', 'tidy', 'info'];
export const BUILTIN_CHECKS: readonly BuiltinCheckCode[] = [
  'secrets', 'huge-files', 'no-readme', 'review-due', 'broken-links', 'version-copies', 'temp-files', 'empty-folders',
  'folder-no-readme', 'same-name', 'long-paths', 'stale-docs', 'orphan-docs', 'git-uncommitted',
];
/** 수준의 무게 — 작을수록 무겁다 (fail-on 비교) */
export const LEVEL_RANK: Record<CheckLevel, number> = { risk: 0, action: 1, tidy: 2, info: 3 };

/** 종류마다 paths 를 주지 않았을 때 */
const DEFAULT_PATHS: Partial<Record<RuleKind, string[]>> = { 'front-matter': ['**'], naming: ['**'], review: ['**'], 'max-size': ['**'] };
/** 종류마다 받는 키(공통 키 말고) */
const KIND_KEYS: Record<RuleKind, string[]> = {
  'front-matter': ['keys', 'values'], readme: ['minFiles'], naming: ['style'], review: ['days', 'field'], forbid: [], 'max-size': ['max'], require: [],
};
const COMMON_KEYS = ['kind', 'paths', 'except', 'name', 'hint', 'level'];
const TOP_KEYS = ['$schema', '$comment', 'purpose', 'folders', 'ignore', 'checks', 'rules'];

// ---------------------------------------------------------------- 경로

/**
 * 파일·폴더 id 가 패턴에 맞나 — 폴더 id 는 끝이 '/'. 폴더는 '/' 로 끝나는 패턴이면 그대로, 아니면 '/' 를 떼고 견준다
 * (`docs/*` 가 docs 폴더 자신을 받지 않게, `archive/**`·`archive` 는 archive 폴더를 받게)
 */
export function matchPath(id: string, pats: string[] | undefined, ci = false): boolean {
  if (!pats || !pats.length) return false;
  if (!id.endsWith('/')) return matchAny(id, pats, ci);
  const bare = id.slice(0, -1);
  return pats.some((p) => globMatch(p, p.endsWith('/') ? id : bare, ci));
}

// ---------------------------------------------------------------- 읽기

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const show = (v: unknown): string => { try { return (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)).slice(0, 80); } catch { return String(v).slice(0, 80); } };

/** "1 MB"·"500KB"·"2m"·1048576 → 바이트 */
export function parseSize(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib)?\s*$/i.exec(v);
  if (!m) return null;
  const unit = (m[2] || 'b').toLowerCase()[0];
  const n = parseFloat(m[1]) * (unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1);
  return n > 0 ? Math.floor(n) : null;
}
/** 바이트 → 짧은 글 (단위는 말과 상관없다) */
export function bytesLabel(n: number): string {
  const f = (v: number) => (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)));
  return n >= 1 << 30 ? f(n / (1 << 30)) + ' GB' : n >= 1 << 20 ? f(n / (1 << 20)) + ' MB' : n >= 1024 ? f(n / 1024) + ' KB' : n + ' B';
}

/** glob 목록 — 문자열 하나도 받는다. 너무 길거나 많으면 문제로 남기고 자른다 */
function patterns(v: unknown, at: string, problems: RuleProblem[]): string[] | null {
  const list = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null;
  if (!list) { problems.push({ at, code: 'bad-value', value: show(v) }); return null; }
  const out: string[] = [];
  for (const [i, p] of list.entries()) {
    if (typeof p !== 'string' || !p.trim()) { problems.push({ at: `${at}[${i}]`, code: 'bad-value', value: show(p) }); continue; }
    const s = p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (s.length > PATTERN_LEN_MAX || s.startsWith('/') || s.split('/').includes('..')) { problems.push({ at: `${at}[${i}]`, code: 'pattern', value: show(p) }); continue; }
    out.push(s);
  }
  if (out.length > PATTERNS_MAX) { problems.push({ at, code: 'too-many', value: String(PATTERNS_MAX) }); out.length = PATTERNS_MAX; }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 규칙 하나 — 맞지 않는 값은 문제로 남기고 그 규칙은 뺀다(조용히 넓게 읽지 않는다) */
function normalizeRule(raw: unknown, at: string, problems: RuleProblem[]): RuleSpec | null {
  if (!isObj(raw)) { problems.push({ at, code: 'not-object' }); return null; }
  const kind = raw.kind as RuleKind;
  if (typeof raw.kind !== 'string' || !RULE_KINDS.includes(kind)) { problems.push({ at: at + '.kind', code: raw.kind == null ? 'missing' : 'unknown-kind', value: raw.kind == null ? undefined : show(raw.kind) }); return null; }
  for (const k of Object.keys(raw)) if (!COMMON_KEYS.includes(k) && !KIND_KEYS[kind].includes(k)) problems.push({ at: `${at}.${k}`, code: 'unknown-key', value: k });
  const before = problems.length;
  const paths = raw.paths == null ? DEFAULT_PATHS[kind] ?? null : patterns(raw.paths, at + '.paths', problems);
  // 경로가 없거나 하나도 쓸 수 없으면 그 규칙은 뺀다(까닭이 이미 남았으면 그것으로)
  if (!paths || !paths.length) { if (problems.length === before) problems.push({ at: at + '.paths', code: 'missing' }); return null; }
  const base: { paths: string[]; except?: string[]; name?: string; hint?: string; level?: CheckLevel } = { paths };
  if (raw.except != null) { const ex = patterns(raw.except, at + '.except', problems); if (ex?.length) base.except = ex; }
  const name = str(raw.name, 80); if (name) base.name = name;
  const hint = str(raw.hint, 400); if (hint) base.hint = hint;
  if (raw.level != null) {
    if (CHECK_LEVELS.includes(raw.level as CheckLevel)) base.level = raw.level as CheckLevel;
    else { problems.push({ at: at + '.level', code: 'bad-value', value: show(raw.level) }); return null; }
  }
  const bad = (k: string) => { problems.push({ at: `${at}.${k}`, code: raw[k] == null ? 'missing' : 'bad-value', value: raw[k] == null ? undefined : show(raw[k]) }); return null; };
  switch (kind) {
    case 'front-matter': {
      const keys = (typeof raw.keys === 'string' ? [raw.keys] : Array.isArray(raw.keys) ? raw.keys : []).filter((k): k is string => typeof k === 'string' && !!k.trim()).map((k) => k.trim().slice(0, 60)).slice(0, 20);
      let values: Record<string, string[]> | undefined;
      if (raw.values != null) {
        if (!isObj(raw.values)) return bad('values');
        values = {};
        for (const [k, v] of Object.entries(raw.values).slice(0, 20)) {
          const list = (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' ? String(x).trim() : '')).filter(Boolean).slice(0, 50);
          if (!list.length) { problems.push({ at: `${at}.values.${k}`, code: 'bad-value', value: show(v) }); continue; }
          values[k.trim().slice(0, 60)] = list;
        }
      }
      if (!keys.length && !(values && Object.keys(values).length)) return bad('keys');
      return { ...base, kind, keys, ...(values && Object.keys(values).length ? { values } : {}) };
    }
    case 'readme': {
      if (raw.minFiles == null) return { ...base, kind };
      const n = Number(raw.minFiles);
      if (!Number.isInteger(n) || n < 0 || n > 100000) return bad('minFiles');
      return { ...base, kind, minFiles: n };
    }
    case 'naming': {
      const list = typeof raw.style === 'string' ? [raw.style] : Array.isArray(raw.style) ? raw.style : null;
      if (!list || !list.length) return bad('style');
      const style: NameStyle[] = [];
      for (const s of list) {
        if (NAME_STYLES.includes(s as NameStyle)) { if (!style.includes(s as NameStyle)) style.push(s as NameStyle); }
        else problems.push({ at: at + '.style', code: 'bad-value', value: show(s) });
      }
      return style.length === list.length ? { ...base, kind, style } : null;
    }
    case 'review': {
      const days = Number(raw.days);
      if (!Number.isInteger(days) || days < 1 || days > 36500) return bad('days');
      const field = raw.field == null ? undefined : str(raw.field, 60);
      if (raw.field != null && !field) return bad('field');
      return { ...base, kind, days, ...(field ? { field } : {}) };
    }
    case 'max-size': {
      const max = parseSize(raw.max);
      if (max == null) return bad('max');
      return { ...base, kind, max };
    }
    case 'forbid': case 'require':
      return { ...base, kind };
  }
}

/**
 * 규칙 파일 글 → 규칙 + 문제. 문제가 있어도 읽을 수 있는 규칙은 쓴다(점검에 "규칙 파일에 문제"로 함께 보인다).
 * JSON 이 아니면 spec 없이 문제 하나
 */
export function parseRulesText(text: string): { spec: WorkspaceRules | null; problems: RuleProblem[] } {
  const problems: RuleProblem[] = [];
  if (text.length > RULES_MAX_BYTES) return { spec: null, problems: [{ at: RULES_FILE, code: 'too-big', value: bytesLabel(RULES_MAX_BYTES) }] };
  let raw: unknown;
  try { raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch (e) { return { spec: null, problems: [{ at: RULES_FILE, code: 'json', value: String((e as Error).message || e).slice(0, 120) }] }; }
  if (!isObj(raw)) return { spec: null, problems: [{ at: RULES_FILE, code: 'not-object' }] };
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) problems.push({ at: k, code: 'unknown-key', value: k });
  const spec: WorkspaceRules = { ignore: [], checks: {}, rules: [] };
  if (raw.purpose != null) { const p = str(raw.purpose, 400); if (p) spec.purpose = p; else if (typeof raw.purpose !== 'string') problems.push({ at: 'purpose', code: 'bad-value', value: show(raw.purpose) }); }
  if (raw.folders != null) {
    if (!isObj(raw.folders)) problems.push({ at: 'folders', code: 'bad-value', value: show(raw.folders) });
    else {
      spec.folders = {};
      for (const [k, v] of Object.entries(raw.folders).slice(0, 500)) {
        const role = typeof v === 'string' ? str(v, 200) : isObj(v) ? str(v.role, 200) : undefined;
        if (role) spec.folders[k.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '')] = { role };
        else if (!(typeof v === 'string' || (isObj(v) && (v.role == null || v.role === '')))) problems.push({ at: `folders.${k}`, code: 'bad-value', value: show(v) });
      }
    }
  }
  if (raw.ignore != null) spec.ignore = patterns(raw.ignore, 'ignore', problems) || [];
  if (raw.checks != null) {
    if (!isObj(raw.checks)) problems.push({ at: 'checks', code: 'bad-value', value: show(raw.checks) });
    else for (const [k, v] of Object.entries(raw.checks)) {
      if (!BUILTIN_CHECKS.includes(k as BuiltinCheckCode)) { problems.push({ at: `checks.${k}`, code: 'unknown-key', value: k }); continue; }
      if (v === 'off' || v === false || CHECK_LEVELS.includes(v as CheckLevel)) spec.checks[k as BuiltinCheckCode] = v === false ? 'off' : (v as CheckLevel | 'off');
      else problems.push({ at: `checks.${k}`, code: 'bad-value', value: show(v) });
    }
  }
  if (raw.rules != null) {
    if (!Array.isArray(raw.rules)) problems.push({ at: 'rules', code: 'bad-value', value: show(raw.rules) });
    else {
      if (raw.rules.length > RULES_MAX) problems.push({ at: 'rules', code: 'too-many', value: String(RULES_MAX) });
      raw.rules.slice(0, RULES_MAX).forEach((r, i) => { const s = normalizeRule(r, `rules[${i}]`, problems); if (s) spec.rules.push({ ...s, at: i }); });
    }
  }
  return { spec, problems };
}

/**
 * 새 규칙 파일의 틀 — 스키마 주소(편집기 자동 완성), 빈 목적, 큰 폴더의 README 규칙 하나(어떻게 쓰는지 보이게).
 * README 에 적힌 목적·역할은 옮겨 적지 않는다(두 곳이 어긋나지 않게 — 적으면 README 보다 먼저)
 */
export function rulesTemplate(hint: string): string {
  return JSON.stringify({
    $schema: RULES_SCHEMA_URL,
    purpose: '',
    ignore: [],
    checks: {},
    rules: [{ kind: 'readme', paths: ['*'], minFiles: 3, hint }],
  }, null, 2) + '\n';
}

// ---------------------------------------------------------------- 이름 규칙

/** 관례 이름 — 이름 규칙에서 뺀다 */
const CONVENTIONAL = /^(readme|changelog|changes|history|license|licence|copying|notice|authors|contributors|contributing|code_of_conduct|security|support|governance|codeowners|maintainers|agents|claude|gemini|skill|makefile|dockerfile|index|_index|docbench)(\.[^.]+)*$/i;

/** 판·사본 표시 (overview.versionFamily 와 같은 뜻 — 여기서는 이름 하나만 본다) */
export type VersionMarked = (name: string) => boolean;

/** 이름 하나가 규칙들을 따르나 — 어긋난 규칙들 */
export function nameStyleMisses(name: string, styles: NameStyle[], marked: VersionMarked): NameStyle[] {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const miss: NameStyle[] = [];
  for (const s of styles) {
    const ok = s === 'kebab-case' ? /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stem)
      : s === 'snake_case' ? /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(stem)
        : s === 'lowercase' ? stem === stem.toLowerCase()
          : s === 'no-spaces' ? !/\s/.test(name)
            : s === 'ascii' ? /^[\x20-\x7e]*$/.test(name)
              : s === 'date-prefix' ? /^\d{4}-?\d{2}-?\d{2}(?:[-_ .]|$)/.test(stem)
                : s === 'number-prefix' ? /^\d+(?:[-_ .]|$)/.test(stem)
                  : !marked(name);
    if (!ok) miss.push(s);
  }
  return miss;
}

// ---------------------------------------------------------------- 점검

const DAY = 864e5;
/** 마지막 검토일로 읽는 앞머리 키 (검토 기한 review·due 와 다르다 — 그것은 앞으로의 날짜) */
const LAST_FIELDS = ['reviewed', 'last_reviewed', 'last-reviewed', 'lastReviewed', 'reviewed_at', 'reviewed-at', 'updated', 'last_updated', 'last-updated', 'lastUpdated', 'updated_at', 'lastmod', 'last_modified', 'modified', 'date', '최종검토일', '검토한날', '수정일', '갱신일'];

export interface RulesContext {
  spec: WorkspaceRules;
  files: InventoryItem[];
  dirs: InventoryItem[];
  complete: boolean;
  isDoc: (p: string) => boolean;
  meta: Record<string, Record<string, string | string[]> | undefined>;
  /** 마지막 변경 시각(ms) — git 커밋(바뀌지 않은 파일) 또는 파일 시각 */
  changedAt: (f: InventoryItem) => number;
  dateMs: (v: string) => number | null;
  isIndexName: (name: string) => boolean;
  marked: VersionMarked;
  ci: boolean;
  now: number;
  pathsMax: number;
  ignored: (p: string) => boolean;
  /** 범위로 계산할 때 앞에 붙일 경로('<범위>/') — 규칙의 패턴은 작업 공간 기준이다 */
  prefix?: string;
}

const baseOf = (p: string) => p.replace(/\/$/, '').split('/').pop() || p;
const parentOf = (p: string) => { const q = p.replace(/\/$/, ''); return q.includes('/') ? q.slice(0, q.lastIndexOf('/')) : ''; };
const fmValue = (fm: Record<string, string | string[]>, key: string): string | string[] | undefined => {
  if (key in fm) return fm[key];
  const lo = key.toLowerCase();
  const k = Object.keys(fm).find((x) => x.toLowerCase() === lo);
  return k ? fm[k] : undefined;
};
const filled = (v: string | string[] | undefined) => (Array.isArray(v) ? v.some((x) => String(x).trim()) : typeof v === 'string' && !!v.trim());

/** 규칙마다 점검 하나(걸린 것이 있을 때만) + 앞머리를 아직 읽지 않아 빠진 문서 수 */
export function evaluateRules(ctx: RulesContext): { checks: OverviewCheck[]; unchecked: number } {
  const out: OverviewCheck[] = [];
  const unread = new Set<string>();
  const pre = ctx.prefix || '';
  const inRule = (r: RuleSpec, id: string) => !ctx.ignored(id) && matchPath(pre + id, r.paths, ctx.ci) && !matchPath(pre + id, r.except, ctx.ci);
  ctx.spec.rules.forEach((r, i) => {
    const index = r.at ?? i;
    const paths: string[] = [];
    const notes: Record<string, string> = {};
    const hit = (p: string, note?: string) => { paths.push(p); if (note && Object.keys(notes).length < ctx.pathsMax) notes[p] = note; };
    let want = '';
    switch (r.kind) {
      case 'front-matter': {
        want = [...r.keys, ...Object.entries(r.values || {}).filter(([k]) => !r.keys.includes(k)).map(([k]) => k)].join(', ');
        for (const f of ctx.files) {
          if (!isMarkdownPath(f.id) || !ctx.isDoc(f.id) || !inRule(r, f.id)) continue;
          const fm = ctx.meta[f.id];
          if (!fm) { unread.add(f.id); continue; }
          const why: string[] = r.keys.filter((k) => !filled(fmValue(fm, k)));
          for (const [k, allowed] of Object.entries(r.values || {})) {
            const v = fmValue(fm, k);
            if (!filled(v)) continue;
            const vals = (Array.isArray(v) ? v : [v as string]).map((x) => String(x).trim()).filter(Boolean);
            const badv = vals.filter((x) => !allowed.some((a) => a.toLowerCase() === x.toLowerCase()));
            if (badv.length) why.push(`${k}=${badv.join(',').slice(0, 40)}`);
          }
          if (why.length) hit(f.id, why.join(' · '));
        }
        break;
      }
      case 'readme': {
        if (!ctx.complete) break;
        const direct = new Map<string, string[]>();
        for (const f of ctx.files) { const p = parentOf(f.id); const arr = direct.get(p) || []; arr.push(baseOf(f.id)); direct.set(p, arr); }
        const min = r.minFiles ?? 1;
        for (const d of ctx.dirs) {
          const p = d.id.replace(/\/$/, '');
          if (!p || !inRule(r, p + '/')) continue;
          const names = direct.get(p) || [];
          if (names.length < Math.max(min, 1) || names.some(ctx.isIndexName)) continue;
          hit(p + '/');
        }
        break;
      }
      case 'naming': {
        want = r.style.join(' + ');
        for (const it of [...ctx.dirs, ...ctx.files]) {
          const name = baseOf(it.id);
          if (name.startsWith('.') || CONVENTIONAL.test(name) || !inRule(r, it.id)) continue;
          const miss = nameStyleMisses(name, r.style, ctx.marked);
          if (miss.length) hit(it.id, miss.join(' + '));
        }
        break;
      }
      case 'review': {
        want = String(r.days);
        const fields = r.field ? [r.field] : LAST_FIELDS;
        for (const f of ctx.files) {
          if (!ctx.isDoc(f.id) || !inRule(r, f.id)) continue;
          let last = ctx.changedAt(f);
          let from = '';
          const fm = ctx.meta[f.id];
          if (fm) for (const k of fields) {
            const v = fmValue(fm, k);
            const ms = typeof v === 'string' ? ctx.dateMs(v) : null;
            if (ms != null) { if (!(ms <= last)) { last = ms; from = k; } break; }
          }
          if (!Number.isFinite(last)) continue;
          if (ctx.now - last > r.days * DAY) hit(f.id, new Date(last).toISOString().slice(0, 10) + (from ? ' · ' + from : ''));
        }
        break;
      }
      case 'forbid': {
        // 폴더가 걸리면 그 폴더 하나로 — 안의 파일을 하나하나 늘어놓지 않는다
        const taken: string[] = [];
        for (const it of [...ctx.dirs, ...ctx.files].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
          if (taken.some((d) => it.id.startsWith(d))) continue;
          if (!inRule(r, it.id)) continue;
          hit(it.id);
          if (it.folder) taken.push(it.id.endsWith('/') ? it.id : it.id + '/');
        }
        break;
      }
      case 'max-size': {
        want = bytesLabel(r.max);
        for (const f of ctx.files) if ((f.size || 0) > r.max && inRule(r, f.id)) hit(f.id, bytesLabel(f.size || 0));
        break;
      }
      case 'require': {
        // 일부만 훑었으면 없다고 말할 수 없다
        if (!ctx.complete) break;
        const all = [...ctx.dirs, ...ctx.files];
        for (const pat of r.paths) {
          if (r.except && matchAny(pat, r.except, ctx.ci)) continue;
          // 범위로 볼 때는 그 범위 안의 패턴만 — 작업 공간 다른 곳의 약속은 여기서 말할 수 없다
          if (pre && !pat.startsWith(pre)) continue;
          const found = all.some((it) => matchPath(pre + it.id, [pat], ctx.ci));
          if (!found) hit(pre ? pat.slice(pre.length) : pat);
        }
        break;
      }
    }
    if (!paths.length) return;
    const keep = paths.slice(0, ctx.pathsMax);
    const kept: Record<string, string> = {};
    for (const p of keep) if (notes[p]) kept[p] = notes[p];
    out.push({
      code: `rule-${r.kind}`, level: r.level || 'action', n: paths.length, paths: keep,
      rule: { index, kind: r.kind, ...(r.name ? { name: r.name } : {}), ...(r.hint ? { hint: r.hint } : {}), want, scope: r.paths.slice(0, 8) },
      ...(Object.keys(kept).length ? { notes: kept } : {}),
    });
  });
  return { checks: out, unchecked: unread.size };
}

/** 규칙 파일의 문제 → 점검 하나 */
export function rulesProblemCheck(file: string, problems: RuleProblem[]): OverviewCheck | null {
  return problems.length ? { code: 'rules-invalid', level: 'action', n: problems.length, paths: [file], problems: problems.slice(0, 40) } : null;
}

/** 이 수준 이상(risk 가 가장 무겁다)의 점검이 있나 — CI 의 실패 기준 */
export const failsAt = (checks: OverviewCheck[], level: CheckLevel): OverviewCheck[] => checks.filter((c) => LEVEL_RANK[c.level] <= LEVEL_RANK[level]);
