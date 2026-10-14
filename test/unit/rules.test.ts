/**
 * 팀 규칙(D90) — docbench.json 읽기·점검, glob(되돌아가기 없음), 점검 문구 한 벌(core/checktext), 스키마와 코드의 목록이 같은지.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globMatch, matchAny } from '../../src/core/workspace';
import { parseRulesText, rulesTemplate, nameStyleMisses, failsAt, parseSize, bytesLabel, RULE_KINDS, NAME_STYLES, BUILTIN_CHECKS, CHECK_LEVELS, RULES_SCHEMA_URL } from '../../src/core/rules';
import { computeOverview, type OverviewInput } from '../../src/core/overview';
import { CHECK_TEXT, checkText } from '../../src/core/checktext';
import type { InventoryItem, RuleProblem } from '../../src/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 14);

/** 예전 glob(정규식) — 바꾼 뒤에도 흔한 패턴의 뜻이 같은지 견준다 */
function oldGlob(pat: string): RegExp {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') { i++; if (pat[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = pat.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += '(?:' + pat.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

describe('glob', () => {
  const pats = ['**/*.md', '*.md', 'docs/**', 'docs/**/*.md', '**/drafts/**', 'node_modules/**', '.git/**', '**/.*/**', 'a/*/b.md', '**/*.{md,txt}', 'docs/{a,b}/*.md', '?.md', 'README', '**/{AUTHORS,README}', '{docs/a,notes}/**'];
  const paths = ['a.md', 'docs/a.md', 'docs/x/y/z.md', 'docs/', 'notes/a.txt', 'x/drafts/y.md', 'drafts/y.md', 'node_modules/p/i.js', 'a/.cache/x', '.git/HEAD', 'a/q/b.md', 'docs/a/k.md', 'docs/c/k.md', 'b.md', 'README', 'x/README', 'docs/a/', 'docsx/a.md'];
  it('흔한 패턴은 예전(정규식)과 같은 뜻 — 다른 곳은 "docs/**" 가 docs 자신도 받는 것 하나', () => {
    for (const p of pats) for (const s of paths) {
      if (p.endsWith('/**') && s === p.slice(0, -3)) continue;
      expect(globMatch(p, s), `${p} ~ ${s}`).toBe(oldGlob(p).test(s));
    }
    expect(globMatch('docs/**', 'docs')).toBe(true);
  });
  it('긴 갈래 목록({md,…130개})도 — 기본 include 가 그런 모양', () => {
    const exts = Array.from({ length: 130 }, (_, i) => 'e' + i).concat('md');
    expect(globMatch(`**/*.{${exts.join(',')}}`, 'docs/a.md')).toBe(true);
    expect(globMatch(`**/*.{${exts.join(',')}}`, 'docs/a.mdx')).toBe(false);
  });
  it('폴더 id(끝 /) — "docs/*" 는 docs 자신을 받지 않고, "archive/**"·"archive" 는 archive 폴더를 받는다', async () => {
    const { matchPath } = await import('../../src/core/rules');
    expect([matchPath('docs/', ['docs/*']), matchPath('docs/a/', ['docs/*']), matchPath('archive/', ['archive/**']), matchPath('archive/', ['archive']), matchPath('archive/', ['archive/']), matchPath('archive/x.md', ['archive'])])
      .toEqual([false, true, true, true, true, false]);
  });
  it('대소문자 무시(Windows) · 폴더는 끝 /', () => {
    expect(globMatch('Docs/*.MD', 'docs/a.md', true)).toBe(true);
    expect(globMatch('Docs/*.MD', 'docs/a.md')).toBe(false);
    expect(matchAny('docs/a/', ['docs/*/'])).toBe(true);
  });
  it('되돌아가기로 멈추지 않는다 — 남이 만든 규칙 파일의 *a*a*a… · **/**/**…', () => {
    const t0 = Date.now();
    const long = 'a'.repeat(4000);
    expect(globMatch('*a*a*a*a*a*a*a*a*a*a*a*a*b', long)).toBe(false);
    expect(globMatch('**/**/**/**/**/**/**/**/x', Array(200).fill('d').join('/') + '/y')).toBe(false);
    expect(globMatch('{a,aa,aaa}{a,aa,aaa}{a,aa,aaa}{a,aa,aaa}b', long.slice(0, 300))).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('규칙 파일 읽기', () => {
  it('정상 — 문자열 하나도 목록으로, 크기 글, 끈 점검', () => {
    const { spec, problems } = parseRulesText(JSON.stringify({
      $schema: RULES_SCHEMA_URL, purpose: ' 팀 문서 ', folders: { 'docs/': { role: '설계' }, notes: '회의' },
      ignore: 'archive/**', checks: { 'stale-docs': 'off', 'huge-files': 'risk', 'temp-files': false },
      rules: [
        { kind: 'front-matter', paths: 'docs/**', keys: 'owner', values: { status: ['draft', 'done'] } },
        { kind: 'naming', style: 'kebab-case' },
        { kind: 'max-size', max: '1.5 MB' },
        { kind: 'review', days: 90, paths: ['policies/**'], level: 'risk', name: '정책 검토', hint: '분기마다' },
      ],
    }));
    expect(problems).toEqual([]);
    expect(spec!.purpose).toBe('팀 문서');
    expect(spec!.folders).toEqual({ docs: { role: '설계' }, notes: { role: '회의' } });
    expect(spec!.ignore).toEqual(['archive/**']);
    expect(spec!.checks).toEqual({ 'stale-docs': 'off', 'huge-files': 'risk', 'temp-files': 'off' });
    expect(spec!.rules.map((r) => r.kind)).toEqual(['front-matter', 'naming', 'max-size', 'review']);
    expect(spec!.rules[0]).toMatchObject({ paths: ['docs/**'], keys: ['owner'], values: { status: ['draft', 'done'] } });
    expect(spec!.rules[1]).toMatchObject({ paths: ['**'], style: ['kebab-case'] });
    expect(spec!.rules[2]).toMatchObject({ max: Math.floor(1.5 * 1024 * 1024) });
    expect(spec!.rules[3]).toMatchObject({ level: 'risk', name: '정책 검토', hint: '분기마다', days: 90 });
  });
  it('문제는 자리(at)와 함께 — 읽을 수 있는 규칙은 쓰고, 틀린 규칙은 뺀다(조용히 넓게 읽지 않는다)', () => {
    const { spec, problems } = parseRulesText(JSON.stringify({
      extra: 1, checks: { nope: 'off', secrets: 'loud' }, ignore: ['../x', 'ok/**'],
      rules: [
        { kind: 'fronmatter' }, { paths: ['a'] }, { kind: 'naming', style: ['kebab-case', 'camel'] },
        { kind: 'review', days: 0 }, { kind: 'max-size', max: 'big' }, { kind: 'forbid' }, { kind: 'readme', paths: [] },
        { kind: 'forbid', paths: ['/abs', 'x/**'], level: 'loud' }, { kind: 'forbid', paths: '**/*.tmp', typo: 1 }, 'x',
      ],
    }));
    const at = (p: RuleProblem) => `${p.at}:${p.code}`;
    expect(problems.map(at)).toEqual([
      'extra:unknown-key', 'ignore[0]:pattern', 'checks.nope:unknown-key', 'checks.secrets:bad-value',
      'rules[0].kind:unknown-kind', 'rules[1].kind:missing', 'rules[2].style:bad-value', 'rules[3].days:bad-value', 'rules[4].max:bad-value',
      'rules[5].paths:missing', 'rules[6].paths:missing', 'rules[7].paths[0]:pattern', 'rules[7].level:bad-value', 'rules[8].typo:unknown-key', 'rules[9]:not-object',
    ]);
    expect(spec!.ignore).toEqual(['ok/**']);
    expect(spec!.rules).toEqual([{ kind: 'forbid', paths: ['**/*.tmp'], at: 8 }]);
  });
  it('JSON 이 아니면 · 너무 크면 · BOM', () => {
    expect(parseRulesText('{ "rules": [ }').problems[0].code).toBe('json');
    expect(parseRulesText('[]').problems[0].code).toBe('not-object');
    expect(parseRulesText(' '.repeat(300 * 1024)).problems[0].code).toBe('too-big');
    expect(parseRulesText('﻿{"purpose":"x"}').spec!.purpose).toBe('x');
  });
  it('틀(규칙 파일 만들기)은 문제 없이 읽힌다', () => {
    const r = parseRulesText(rulesTemplate('README 를 둔다'));
    expect(r.problems).toEqual([]);
    expect(r.spec!.rules[0]).toMatchObject({ kind: 'readme', paths: ['*'], minFiles: 3, hint: 'README 를 둔다' });
  });
  it('크기 글', () => {
    expect([parseSize('500KB'), parseSize('2 m'), parseSize(10), parseSize('1.5GiB'), parseSize('x'), parseSize(-1)]).toEqual([512000, 2097152, 10, 1610612736, null, null]);
    expect([bytesLabel(1434), bytesLabel(12 * 1024), bytesLabel(3 * 1024 * 1024)]).toEqual(['1.4 KB', '12 KB', '3 MB']);
  });
});

describe('이름 규칙', () => {
  const marked = (n: string) => /_v\d|최종/.test(n);
  it.each([
    ['design-notes.md', ['kebab-case', 'lowercase', 'no-spaces', 'ascii'], []],
    ['Design Notes.md', ['kebab-case', 'lowercase', 'no-spaces'], ['kebab-case', 'lowercase', 'no-spaces']],
    ['설계-노트.md', ['ascii', 'no-spaces', 'lowercase'], ['ascii']],
    ['2026-10-14-retro.md', ['date-prefix'], []],
    ['20261014_retro.md', ['date-prefix', 'snake_case'], []],
    ['retro.md', ['date-prefix', 'number-prefix'], ['date-prefix', 'number-prefix']],
    ['0007-use-queue.md', ['number-prefix', 'kebab-case'], []],
    ['plan_v2.docx', ['no-version-marks'], ['no-version-marks']],
  ] as const)('%s', (name, styles, miss) => {
    expect(nameStyleMisses(name, [...styles], marked)).toEqual(miss);
  });
});

// ---------------------------------------------------------------- 개요와 함께

const file = (id: string, o: Partial<InventoryItem> = {}): InventoryItem => ({ id, parent: id.includes('/') ? id.slice(0, id.lastIndexOf('/') + 1) : '', name: id.split('/').pop()!, folder: false, size: 100, modified: new Date(NOW - DAY).toISOString(), ...o });
const dir = (p: string): InventoryItem => ({ id: p + '/', parent: p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '', name: p.split('/').pop()!, folder: true });
function overview(rules: unknown, extra: Partial<OverviewInput> = {}, items?: InventoryItem[]) {
  const its = items ?? [
    file('README.md'), dir('docs'), file('docs/plan.md'), file('docs/Old Notes.md'), file('docs/spec_v2.md'), dir('docs/adr'), file('docs/adr/0001-queue.md'),
    dir('archive'), file('archive/2019.md'), file('archive/old.docx'), dir('assets'), file('assets/big.png', { size: 3 * 1024 * 1024 }), file('assets/a.png'), file('assets/b.png'),
  ];
  const meta: OverviewInput['meta'] = {
    'README.md': {}, 'docs/plan.md': { owner: 'dj', status: 'draft', reviewed: '2026-01-01' }, 'docs/Old Notes.md': { status: 'wip' }, 'docs/spec_v2.md': {},
    'docs/adr/0001-queue.md': { owner: 'kim', status: 'done' }, 'archive/2019.md': {},
  };
  return computeOverview({
    root: 'ws', items: its, complete: true, isDoc: (p) => /\.(md|docx|png)$/.test(p), meta, now: NOW,
    rules: { file: 'docbench.json', ...parseRulesText(typeof rules === 'string' ? rules : JSON.stringify(rules)) }, ...extra,
  });
}
const pick = (ov: ReturnType<typeof computeOverview>, code: string) => ov.checks.find((c) => c.code === code);

describe('팀 규칙 점검', () => {
  it('앞머리 — 빠진 키·목록 밖 값, 아직 읽지 않은 문서는 unchecked', () => {
    const ov = overview({ rules: [{ kind: 'front-matter', paths: ['docs/**'], keys: ['owner', 'status'], values: { status: ['draft', 'review', 'done'] } }] }, { meta: { 'docs/plan.md': { owner: 'dj', status: 'Draft' }, 'docs/Old Notes.md': { status: 'wip' } } });
    const c = pick(ov, 'rule-front-matter')!;
    expect(c.paths).toEqual(['docs/Old Notes.md']);
    expect(c.notes).toEqual({ 'docs/Old Notes.md': 'owner · status=wip' });
    expect(c.rule).toMatchObject({ index: 0, kind: 'front-matter', want: 'owner, status', scope: ['docs/**'] });
    expect(ov.rules).toEqual({ file: 'docbench.json', count: 1, problems: 0, unchecked: 2 });
  });
  it('README — 파일이 minFiles 이상인 폴더만, 하위 폴더 패턴', () => {
    const ov = overview({ rules: [{ kind: 'readme', paths: ['*'], minFiles: 2 }, { kind: 'readme', paths: ['docs/*'] }] });
    expect(ov.checks.filter((c) => c.code === 'rule-readme').map((c) => c.paths.sort())).toEqual([['archive/', 'assets/', 'docs/'], ['docs/adr/']]);
  });
  it('이름 — 관례 이름(README)·숨김 파일은 빼고, 폴더도 본다', () => {
    const ov = overview({ rules: [{ kind: 'naming', style: ['no-spaces', 'no-version-marks'] }, { kind: 'naming', paths: ['docs/adr/**'], except: ['docs/adr/'], style: 'number-prefix' }] }, {}, [
      file('README.md'), file('.env.example'), dir('My Folder'), file('My Folder/a.md'), file('docs/spec_v2.md'), file('docs/x (1).md'), dir('docs/adr'), file('docs/adr/0001-q.md'), file('docs/adr/q.md'),
    ]);
    const [a, b] = ov.checks.filter((c) => c.code === 'rule-naming');
    expect(a.paths.sort()).toEqual(['My Folder/', 'docs/spec_v2.md', 'docs/x (1).md']);
    expect(a.notes!['docs/x (1).md']).toBe('no-spaces + no-version-marks');
    expect(b.paths).toEqual(['docs/adr/q.md']);
  });
  it('검토 주기 — 앞머리 검토일과 마지막 변경 중 늦은 것, git 커밋 시각(바뀌지 않은 파일)', () => {
    const old = new Date(NOW - 400 * DAY).toISOString();
    const items = [file('README.md'), file('docs/plan.md', { modified: old }), file('docs/b.md', { modified: old }), file('docs/c.md'), file('docs/d.md', { flags: ['modified'] })];
    const ov = overview({ rules: [{ kind: 'review', paths: ['docs/**'], days: 180 }] }, {
      meta: { 'docs/plan.md': { reviewed: '2026-09-01' }, 'docs/b.md': { updated: '2025-01-02' } },
      // c.md 는 막 받아 파일 시각이 새것이지만 커밋은 오래 — 커밋 시각으로. d.md 는 고친 중이라 파일 시각
      changed: { 'docs/c.md': NOW - 300 * DAY, 'docs/d.md': NOW - 300 * DAY },
    }, items);
    const c = pick(ov, 'rule-review')!;
    expect(c.paths.sort()).toEqual(['docs/b.md', 'docs/c.md']);
    expect(c.notes!['docs/b.md']).toBe(new Date(Date.parse(old)).toISOString().slice(0, 10));
    expect(c.rule!.want).toBe('180');
    // 늘 하는 "오래된 문서"도 커밋 시각으로
    expect(pick(ov, 'stale-docs')!.paths.sort()).toEqual(['docs/b.md', 'docs/plan.md']);
  });
  it('검토 주기 field — 그 앞머리 날짜만(고친 시각은 검토가 아니다), 없으면 걸린다', () => {
    const items = [file('README.md'), file('p/a.md'), file('p/b.md'), file('p/c.md'), file('p/d.md')];
    const ov = overview({ rules: [{ kind: 'review', paths: 'p/**', days: 90, field: 'reviewed' }] }, {
      meta: { 'p/a.md': { reviewed: '2026-09-01' }, 'p/b.md': { reviewed: '2025-01-01' }, 'p/c.md': { updated: '2026-10-01' } },
    }, items);
    const c = pick(ov, 'rule-review')!;
    expect(c.paths.sort()).toEqual(['p/b.md', 'p/c.md']);
    expect(c.notes).toEqual({ 'p/b.md': '2025-01-01 · reviewed', 'p/c.md': 'reviewed ?' });
    expect(ov.rules!.unchecked).toBe(1);
  });
  it('두지 않기(폴더는 하나로) · 크기 한도 · 있어야 할 것', () => {
    const ov = overview({ rules: [{ kind: 'forbid', paths: ['archive', '**/*.docx'] }, { kind: 'max-size', paths: '**/*.png', max: '1 MB' }, { kind: 'require', paths: ['CHANGELOG.md', 'docs/adr/', 'docs/*.md'] }] });
    expect(pick(ov, 'rule-forbid')!.paths).toEqual(['archive/']);
    expect(pick(ov, 'rule-max-size')!).toMatchObject({ paths: ['assets/big.png'], notes: { 'assets/big.png': '3 MB' }, rule: { want: '1 MB' } });
    expect(pick(ov, 'rule-require')!.paths).toEqual(['CHANGELOG.md']);
  });
  it('일부만 훑었으면 README·있어야 할 것은 말하지 않는다', () => {
    const ov = overview({ rules: [{ kind: 'readme', paths: ['*'] }, { kind: 'require', paths: ['NOPE.md'] }] }, { complete: false });
    expect(ov.checks.filter((c) => c.code.startsWith('rule-'))).toEqual([]);
  });
  it('ignore 는 모든 점검에서 빼고, checks 는 수준을 바꾸거나 끈다', () => {
    const items = [file('README.md'), file('docs/spec_v2.md'), file('docs/spec_v3.md'), dir('archive'), file('archive/old.docx'), file('big.bin', { size: 60 * 1024 * 1024 })];
    const base = overview({ rules: [{ kind: 'forbid', paths: '**/*.docx' }] }, {}, items);
    expect(pick(base, 'version-copies')!.paths).toEqual(['docs/spec_v2.md', 'docs/spec_v3.md']);
    expect(pick(base, 'rule-forbid')!.paths).toEqual(['archive/old.docx']);
    const ov = overview({ ignore: ['docs/spec_v2.md', 'archive/**'], checks: { 'version-copies': 'risk', 'huge-files': 'off' }, rules: [{ kind: 'forbid', paths: '**/*.docx' }] }, {}, items);
    expect(pick(ov, 'version-copies')).toMatchObject({ level: 'risk', paths: ['docs/spec_v3.md'], n: 1 });
    expect(pick(ov, 'huge-files')).toBeUndefined();
    expect(pick(ov, 'rule-forbid')).toBeUndefined();
  });
  it('목적·폴더 역할은 규칙 파일이 먼저(README 보다)', () => {
    const ov = overview({ purpose: '팀 설계 문서', folders: { docs: '설계와 결정' } }, { readmes: { '': { id: 'README.md', text: '# x\n\nREADME 목적\n' } }, config: { purpose: '설정 목적' } });
    expect(ov.purpose).toEqual({ text: '팀 설계 문서', from: 'config', docId: 'docbench.json' });
    expect(ov.folders.find((f) => f.path === 'docs')).toMatchObject({ role: '설계와 결정', roleFrom: 'config' });
  });
  it('규칙 파일의 문제는 점검 하나(할 일) — 규칙 번호는 파일의 자리 그대로', () => {
    const ov = overview({ rules: [{ kind: 'nope' }, { kind: 'forbid', paths: '**/*.docx' }] });
    expect(pick(ov, 'rules-invalid')).toMatchObject({ level: 'action', n: 1, paths: ['docbench.json'], problems: [{ at: 'rules[0].kind', code: 'unknown-kind', value: 'nope' }] });
    expect(pick(ov, 'rule-forbid')!.rule!.index).toBe(1);
    const broken = overview('{ nope');
    expect(broken.rules).toMatchObject({ count: 0, problems: 1 });
    expect(pick(broken, 'rules-invalid')!.problems![0].code).toBe('json');
  });
  it('수준·경로 수 — CI 는 전부(pathsMax), fail-on 은 그 수준 이상', () => {
    const items = [file('README.md'), ...Array.from({ length: 60 }, (_, i) => file(`t/f ${i}.md`))];
    const ov = overview({ rules: [{ kind: 'naming', style: 'no-spaces', level: 'tidy' }] }, { pathsMax: Infinity }, items);
    const c = pick(ov, 'rule-naming')!;
    expect([c.n, c.paths.length, c.level]).toEqual([60, 60, 'tidy']);
    expect(failsAt(ov.checks, 'action').map((x) => x.code)).not.toContain('rule-naming');
    expect(failsAt(ov.checks, 'tidy').map((x) => x.code)).toContain('rule-naming');
  });
  it('깨진 링크의 n 은 문서 수(문구가 문서를 센다) · 폴더 지도가 들어가지 않는 폴더(.docbench·node_modules) 안은 깨졌다고 하지 않는다', () => {
    const ov = computeOverview({ root: 'w', items: [file('README.md'), file('a.md'), file('b.md')], complete: true, isDoc: () => true, links: [{ from: 'a.md', to: ['x.md', 'y.md', 'z.md'] }, { from: 'b.md', to: ['ex/.docbench/config.json', 'node_modules/p/README.md', '.github/'] }] });
    expect(pick(ov, 'broken-links')).toMatchObject({ n: 1, paths: ['a.md'] });
  });
});

describe('점검 문구 한 벌 (화면·CLI)', () => {
  const codes = [...BUILTIN_CHECKS, ...RULE_KINDS.map((k) => 'rule-' + k), 'rules-invalid'];
  it.each(['ko', 'en'] as const)('%s: 점검마다 제목·까닭, 문제마다 한 줄, 수준 이름', (lang) => {
    for (const c of codes) {
      expect(CHECK_TEXT[lang]['overview.check.' + c], c).toBeTruthy();
      expect(CHECK_TEXT[lang]['overview.check.' + c + '.hint'], c).toBeTruthy();
    }
    for (const p of ['json', 'not-object', 'too-big', 'unknown-key', 'unknown-kind', 'missing', 'bad-value', 'pattern', 'too-many']) expect(CHECK_TEXT[lang]['overview.rules.problem.' + p], p).toBeTruthy();
    for (const l of CHECK_LEVELS) expect(CHECK_TEXT[lang]['overview.level.' + l]).toBeTruthy();
  });
  it('두 말의 낱말이 같다 · 값 채우기', () => {
    expect(Object.keys(CHECK_TEXT.en).sort()).toEqual(Object.keys(CHECK_TEXT.ko).sort());
    expect(checkText('en', 'overview.check.rule-review', { n: 2, want: 90 })).toBe('Documents past their 90-day review cycle: 2');
    expect(checkText('fr', 'overview.check.no-readme')).toBe(CHECK_TEXT.ko['overview.check.no-readme']);
  });
});

describe('스키마(docs/docbench.schema.json)와 코드의 목록이 같다', () => {
  const schema = JSON.parse(readFileSync(path.join(here, '../../docs/docbench.schema.json'), 'utf8'));
  it('규칙 종류 · 이름 규칙 · 늘 하는 점검 · 수준 · 주소', () => {
    expect(schema.definitions.rule.properties.kind.enum).toEqual([...RULE_KINDS]);
    expect(schema.definitions.style.enum).toEqual([...NAME_STYLES]);
    expect(schema.properties.checks.propertyNames.enum).toEqual([...BUILTIN_CHECKS]);
    expect(schema.definitions.level.enum).toEqual([...CHECK_LEVELS]);
    expect(schema.$id).toBe(RULES_SCHEMA_URL);
    // 종류마다 then 이 하나씩
    expect(schema.definitions.rule.allOf.slice(1).map((x: { if: { properties: { kind: { const: string } } } }) => x.if.properties.kind.const)).toEqual([...RULE_KINDS]);
  });
});

describe('범위 개요 (대시보드 탭·넓은 작업 공간 안의 폴더)', () => {
  const items = [
    file('README.md'), dir('projects'), dir('projects/a'), file('projects/a/README.md'), dir('projects/a/docs'), file('projects/a/docs/plan.md'), file('projects/a/docs/spec_v2.md'),
    file('projects/a/docs/spec_v3.md'), file('projects/a/.env'), dir('projects/b'), file('projects/b/x.md'), file('shared/glossary.md'),
  ];
  const base = { root: 'ws', items, complete: true, isDoc: (p: string) => /\.md$/.test(p), now: NOW };
  it('그 폴더를 맨 위로 계산하고 경로는 작업 공간 기준으로 돌린다', () => {
    const ov = computeOverview({
      ...base, base: 'projects/a',
      readmes: { '': { id: 'projects/a/README.md', text: '# A\n\n알림 서비스 A 의 문서.\n' } },
      meta: { 'projects/a/docs/plan.md': { status: 'review' }, 'projects/b/x.md': { status: 'done' } },
      links: [{ from: 'projects/a/docs/plan.md', to: ['shared/glossary.md', 'shared/none.md', 'projects/a/docs/spec_v3.md', 'projects/a/.docbench/x.json'] }],
      rules: { file: 'docbench.json', ...parseRulesText(JSON.stringify({ purpose: '작업 공간 전체 목적', rules: [
        { kind: 'front-matter', paths: 'projects/a/docs/**', keys: ['owner'] }, { kind: 'front-matter', paths: 'docs/**', keys: ['nope'] },
        { kind: 'require', paths: ['projects/a/CHANGELOG.md', 'CHANGELOG.md'] }, { kind: 'nope' },
      ] })) },
    });
    expect(ov.root).toBe('a');
    expect(ov.purpose).toEqual({ text: '알림 서비스 A 의 문서.', from: 'readme', docId: 'projects/a/README.md' });
    expect(ov.totals.files).toBe(5);
    expect(ov.folders.map((f) => f.path)).toEqual(['projects/a/docs', '']);
    expect(ov.meta.status).toEqual({ review: 1 });
    expect(pick(ov, 'secrets')!.paths).toEqual(['projects/a/.env']);
    expect(pick(ov, 'version-copies')!.paths).toEqual(['projects/a/docs/spec_v2.md', 'projects/a/docs/spec_v3.md']);
    // 범위 밖을 가리키는 링크: 있으면 깨지지 않았고, 없으면 깨졌다 · 기록 폴더 안은 모른다
    expect(pick(ov, 'broken-links')).toMatchObject({ n: 1, paths: ['projects/a/docs/plan.md'] });
    // 팀 규칙은 작업 공간 기준 패턴으로 — 범위 안 패턴만, 문제 점검의 경로(규칙 파일)는 그대로
    expect(ov.checks.filter((c) => c.code === 'rule-front-matter').map((c) => c.paths)).toEqual([['projects/a/docs/plan.md']]);
    expect(pick(ov, 'rule-front-matter')!.notes).toEqual({ 'projects/a/docs/plan.md': 'owner' });
    expect(ov.rules!.unchecked).toBe(2);
    expect(pick(ov, 'rule-require')!.paths).toEqual(['projects/a/CHANGELOG.md']);
    expect(pick(ov, 'rules-invalid')!.paths).toEqual(['docbench.json']);
  });
  it('README 가 없으면 그 폴더의 역할(팀 규칙 folders)이 목적 · pickReadmes 의 키는 그 폴더 기준', async () => {
    const { pickReadmes } = await import('../../src/core/overview');
    expect(pickReadmes(items, 'projects/a')).toEqual({ '': 'projects/a/README.md' });
    expect(pickReadmes(items, 'projects')).toEqual({ a: 'projects/a/README.md' });
    const ov = computeOverview({ ...base, base: 'projects/b', rules: { file: 'docbench.json', ...parseRulesText('{"folders":{"projects/b":"B 팀 메모"}}') } });
    expect(ov.purpose).toEqual({ text: 'B 팀 메모', from: 'config' });
    expect(pick(ov, 'no-readme')).toBeTruthy();
  });
});
