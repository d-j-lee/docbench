/**
 * 여러 형식(D87) — 형식 판별·바닥 규칙, 구조 글의 제목(섹션), 바꿔 끼우기의 바이트 보존, JSON 섹션의 끝.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatOf, formatFor, claudeChanges, fileGroupOf, editableExtensions } from '../../src/core/formats';
import { sectionSources, replaceSection, getSectionText, diffSections } from '../../src/core/source';
import { jsonReadable, stripJsonExtras } from '../../src/core/outline';
import { docFloor, isDocPath, DEFAULT_CONFIG } from '../../src/core/workspace';
import { frontMatterData } from '../../src/core/markdown';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => readFileSync(path.join(here, '../fixtures/formats', n), 'utf8');
const keys = (text: string, id: string) => sectionSources(text, id).map((s) => `${s.level} ${s.key}`);

describe('형식 판별', () => {
  it('확장자·이름으로 정하고, 모르는 것·숨김·잠금 파일은 null', () => {
    expect(formatOf('docs/a.md')?.id).toBe('markdown');
    expect(formatOf('k8s/deploy.YAML')?.id).toBe('yaml');
    expect(formatOf('tsconfig.json')?.kind).toBe('outline');
    expect(formatOf('src/app.ts')).toMatchObject({ id: 'code', lang: 'js', claude: 'propose' });
    expect(formatOf('Dockerfile')?.id).toBe('code');
    expect(formatOf('Dockerfile.dev')?.id).toBe('code');
    expect(formatOf('LICENSE')?.id).toBe('text');
    expect(formatOf('보고서.docx')?.kind).toBe('derived');
    expect(formatOf('shot.PNG')?.kind).toBe('binary');
    expect(formatOf('.env')).toBeNull();
    expect(formatOf('~$보고서.docx')).toBeNull();
    expect(formatOf('id_rsa')).toBeNull();
    expect(formatOf('server.pem')).toBeNull();
    expect(formatOf('archive.zip')).toBeNull();
    // 모르면 화면은 마크다운(확장자 없는 id 를 쓰는 저장소)
    expect(formatFor('plan').id).toBe('markdown');
  });
  it('Claude 가 할 수 있는 처리: 글·표·도식은 고치기, 코드·HTML·설정은 제안만, 로그·뽑은 글·그림은 읽기만', () => {
    expect(claudeChanges(formatFor('a.md'))).toEqual(['edit', 'propose']);
    expect(claudeChanges(formatFor('a.csv'))).toEqual(['edit', 'propose']);
    expect(claudeChanges(formatFor('flow.mmd'))).toEqual(['edit', 'propose']);
    expect(claudeChanges(formatFor('a.yaml'))).toEqual(['propose']);
    expect(claudeChanges(formatFor('package.json'))).toEqual(['propose']);
    expect(claudeChanges(formatFor('a.py'))).toEqual(['propose']);
    expect(claudeChanges(formatFor('index.html'))).toEqual(['propose']);
    expect(claudeChanges(formatFor('app.log'))).toEqual([]);
    expect(claudeChanges(formatFor('a.docx'))).toEqual([]);
    expect(claudeChanges(formatFor('a.png'))).toEqual([]);
  });
  it('개요 묶음: 등록 밖의 파일도 확장자로', () => {
    expect(fileGroupOf('a.md')).toBe('doc');
    expect(fileGroupOf('a.hwp')).toBe('office');
    expect(fileGroupOf('a.mp4')).toBe('media');
    expect(fileGroupOf('a.zip')).toBe('archive');
    expect(fileGroupOf('a.unknown')).toBe('other');
  });
  it('바닥 규칙(D71 갱신): 등록된 형식이고 숨김·node_modules 밖 — include 를 넓혀도 그 밖은 문서가 아니다', () => {
    expect(docFloor('docs/a.yaml')).toBe(true);
    expect(docFloor('.github/workflows/ci.yml')).toBe(false);
    expect(docFloor('node_modules/x/README.md')).toBe(false);
    expect(docFloor('.git/hooks/pre-commit')).toBe(false);
    expect(docFloor('secrets/.env')).toBe(false);
    const wide = { include: ['**/*'], exclude: [] as string[] };
    expect(isDocPath('scripts/run.sh', wide)).toBe(true);
    expect(isDocPath('bin/tool.exe', wide)).toBe(false);
    // 기본 설정은 모든 형식
    expect(isDocPath('data/x.csv', DEFAULT_CONFIG)).toBe(true);
    // 예전 설정(마크다운만)은 그대로 마크다운만
    expect(isDocPath('data/x.csv', { include: ['**/*.md'], exclude: [] })).toBe(false);
  });
  it('터미널 Claude 자리의 막을 확장자에 글 형식이 다 들어 있다', () => {
    const ex = editableExtensions();
    for (const e of ['md', 'yaml', 'json', 'py', 'csv', 'html']) expect(ex).toContain(e);
    expect(ex).not.toContain('docx');
    expect(ex).not.toContain('png');
  });
});

describe('구조 글의 제목', () => {
  it('YAML: 맨 위 키 2단계, 그 아래 블록 키 3단계, 붙은 주석은 그 키에, 여러 줄 글 안은 세지 않음', () => {
    const t = fx('sample.yaml');
    expect(keys(t, 'a.yaml')).toEqual([
      '2 apiVersion', '2 kind', '2 metadata', '3 metadata › labels', '2 spec', '3 spec › template', '3 spec › description', '3 spec › strategy',
      '2 quoted key', '2 single: quoted', '2 apiVersion #2', '2 kind #2', '2 metadata #2',
    ]);
    const meta = sectionSources(t, 'a.yaml').find((s) => s.key === 'metadata')!;
    expect(t.slice(meta.start).startsWith('# 메타데이터')).toBe(true);
    const tpl = getSectionText(t, 'spec › template', 'a.yaml')!;
    expect(tpl.startsWith('  # 컨테이너 목록\n  template:')).toBe(true);
    expect(tpl).toContain('args:');
    expect(tpl).not.toContain('description');
  });
  it('JSON: 맨 위 키 2단계, 그 안 블록 키 3단계, 섹션은 값이 끝나는 줄까지(닫는 } 는 밖)', () => {
    const t = fx('sample.json');
    expect(keys(t, 'a.json')).toEqual(['2 name', '2 version', '2 scripts', '2 nested', '3 nested › deep', '3 nested › list', '2 empty', '2 last']);
    expect(getSectionText(t, 'scripts', 'a.json')).toBe('  "scripts": {\n    "build": "node scripts/build.mjs",\n    "test": "vitest"\n  },\n');
    expect(getSectionText(t, 'last', 'a.json')).toBe('  "last": [1, 2, 3]\n');
    expect(getSectionText(t, 'nested › list', 'a.json')).toBe('    "list": [\n      "x",\n      "y"\n    ],\n');
    // 한 줄로 줄인 JSON 은 섹션이 없다
    expect(sectionSources('{"a": {"b": 1}, "c": 2}\n', 'x.json')).toEqual([]);
    expect(sectionSources('[1, 2]\n', 'x.json')).toEqual([]);
  });
  it('TOML: [표]·[[배열]] (#2), 여러 줄 글·배열 안은 세지 않음 · INI: [섹션]', () => {
    expect(keys(fx('sample.toml'), 'a.toml')).toEqual(['2 server', '2 plugins', '2 plugins #2', '2 database.main']);
    expect(getSectionText(fx('sample.toml'), 'server', 'a.toml')!.startsWith('# 서버 설정\n[server]')).toBe(true);
    expect(keys(fx('sample.ini'), 'a.ini')).toEqual(['2 core', '2 remote "origin"']);
  });
  it('AsciiDoc · rST · Org 제목', () => {
    expect(keys(fx('sample.adoc'), 'a.adoc')).toEqual(['1 문서 제목', '2 문서 제목 › 개요', '3 문서 제목 › 개요 › 세부', '2 문서 제목 › 다음']);
    expect(keys(fx('sample.rst'), 'a.rst')).toEqual(['1 문서 제목', '2 문서 제목 › 개요', '3 문서 제목 › 개요 › 세부', '2 문서 제목 › 다음']);
    expect(keys(fx('sample.org'), 'a.org')).toEqual(['1 첫 장', '2 첫 장 › 세부', '1 둘째 장']);
  });
  it('글·코드·표는 섹션이 없다(문서 전체 하나)', () => {
    expect(sectionSources('# 제목처럼 보여도\n본문\n', 'a.txt')).toEqual([]);
    expect(sectionSources('# comment\nprint(1)\n', 'a.py')).toEqual([]);
    expect(sectionSources('a,b\n1,2\n', 'a.csv')).toEqual([]);
  });
});

describe('바꿔 끼우기 — 섹션 밖 바이트는 그대로', () => {
  it('YAML 3단계 섹션', () => {
    const t = fx('sample.yaml');
    const old = getSectionText(t, 'metadata › labels', 'a.yaml')!;
    const next = replaceSection(t, 'metadata › labels', '  labels:\n    app: docbench\n    tier: back\n', 'a.yaml')!;
    expect(next.replace('    tier: back\n', '    tier: "web: front"\n')).toBe(t);
    expect(old).toBe('  labels:\n    app: docbench\n    tier: "web: front"\n');
    const d = diffSections(t, next, 'a.yaml');
    expect(d.changed).toEqual(['metadata › labels']);
    expect(d.preamble).toBe(false);
  });
  it('JSON 섹션을 바꿔도 문서가 읽힌다 · 닫는 괄호(꼬리)가 바뀌면 섹션 밖 변화로', () => {
    const t = fx('sample.json');
    const next = replaceSection(t, 'scripts', '  "scripts": {\n    "build": "node build.mjs"\n  },\n', 'a.json')!;
    expect(jsonReadable(next)).toBe(true);
    expect(JSON.parse(next).scripts).toEqual({ build: 'node build.mjs' });
    expect(diffSections(t, next, 'a.json').changed).toEqual(['scripts']);
    expect(diffSections(t, t.replace(/}\n$/, '}  \n') + '\n', 'a.json').preamble).toBe(false);
    expect(diffSections(t, t + '// tail\n', 'a.json').preamble).toBe(true);
  });
  it('주석·끝 쉼표를 허용하는 JSON 읽기', () => {
    expect(jsonReadable('{\n  // c\n  "a": 1, /* x */\n}\n')).toBe(true);
    expect(stripJsonExtras('{"a": "//not", "b": [1,],}')).toBe('{"a": "//not", "b": [1]}');
    expect(jsonReadable('{"a": 1')).toBe(false);
  });
});

describe('앞머리 메타데이터', () => {
  it('키: 값 · [목록] · - 목록, 따옴표 떼기, 중첩은 건너뜀', () => {
    const md = '---\ntitle: "설계 노트"\nstatus: review\nowner: 김철수\ntags: [api, 보안]\nreviewers:\n  - 이영희\n  - 박민수\nnested:\n  a: 1\ndesc: |\n  여러 줄\n---\n# 본문\n';
    expect(frontMatterData(md)).toEqual({ title: '설계 노트', status: 'review', owner: '김철수', tags: ['api', '보안'], reviewers: ['이영희', '박민수'] });
    expect(frontMatterData('# 앞머리 없음\n')).toEqual({});
  });
});

describe('기본 include — 코드는 빠지고(D87), 문서·데이터·오피스·그림은 든다', () => {
  it('대소문자 확장자(.JPG·.PDF)도', () => {
    for (const p of ['a.md', 'docs/b.yaml', 'c.csv', 'd/e.docx', 'scan/IMG_0001.JPG', 'SCAN.PDF', 'LICENSE', 'q.sql', 'n.ipynb']) expect(isDocPath(p, DEFAULT_CONFIG), p).toBe(true);
    for (const p of ['src/a.ts', 'run.sh', 'Dockerfile', 'Makefile', 'x.py', '.env', 'a.exe']) expect(isDocPath(p, DEFAULT_CONFIG), p).toBe(false);
  });
});

describe('Claude 작업의 형식 규칙 (D87) — 앱의 Claude 작업이 CLI 와 같게', async () => {
  const { buildRunContext } = await import('../../src/core/apply');
  const { planRun } = await import('../../src/core/runs');
  const { normalizeFeedback } = await import('../../src/core/feedback');
  const docs: Record<string, { md: string; readOnly?: boolean; readOnlyReason?: string }> = {
    'a.md': { md: '# A\n\n## 배포\n\n글\n' },
    'c.yaml': { md: 'server:\n  port: 80\nretry:\n  max: 5\n' },
    'w.docx': { md: '# 계획\n\n## 개요\n\n글\n', readOnly: true, readOnlyReason: 'format' },
    'x.log': { md: 'INFO a\n' },
  };
  const fbs = [
    normalizeFeedback({ id: 'f-md', docId: 'a.md', target: { kind: 'section', path: ['A', '배포'], heading: '배포' }, body: 'x', status: 'open', waitingOn: 'assistant' }, 'f-md'),
    normalizeFeedback({ id: 'f-y', docId: 'c.yaml', target: { kind: 'section', path: ['retry'], heading: 'retry' }, body: '3회로', status: 'open', waitingOn: 'assistant' }, 'f-y'),
    normalizeFeedback({ id: 'f-w', docId: 'w.docx', target: { kind: 'doc' }, body: '요약', status: 'open', waitingOn: 'assistant' }, 'f-w'),
    normalizeFeedback({ id: 'f-l', docId: 'x.log', target: { kind: 'doc' }, body: '원인?', status: 'open', waitingOn: 'assistant' }, 'f-l'),
  ];
  const host = {
    readDoc: async (id: string) => ({ id, version: 'v1', ...docs[id] }),
    getFeedback: async (id: string) => fbs.find((f) => f.id === id)!,
  } as never;
  const { ctx } = await buildRunContext(host, { id: 'r', kind: 'handoff', feedbackIds: fbs.map((f) => f.id) }, { root: '/w' });
  const allowed = Object.fromEntries(ctx.items.map((it) => [it.feedback.id, it.allowed]));
  it('글은 고치기까지, 설정은 제안만, 뽑은 글·로그는 답만', () => {
    expect(allowed['f-md']).toEqual(['edit', 'propose', 'answer', 'ask', 'decline']);
    expect(allowed['f-y']).toEqual(['propose', 'answer', 'ask', 'decline']);
    expect(allowed['f-w']).toEqual(['answer', 'ask', 'decline']);
    expect(allowed['f-l']).toEqual(['answer', 'ask', 'decline']);
    expect(ctx.items.find((x) => x.feedback.id === 'f-w')!.docText).toContain('# 계획');
  });
  it('YAML 고침은 제안으로 바뀌고, 키가 바뀌면 거부', () => {
    const plan = planRun(ctx, { items: [
      { feedbackId: 'f-y', action: 'edit', section: 'retry', text: 'retry:\n  max: 3\n', message: '3회' },
      { feedbackId: 'f-l', action: 'edit', section: '*', text: 'x', message: '' },
    ] });
    expect(plan.actions[0]).toMatchObject({ action: 'propose', note: 'not-allowed', sectionKey: 'retry' });
    expect(plan.actions[1]).toMatchObject({ action: 'ask', note: 'not-allowed' });
    const bad = planRun(ctx, { items: [{ feedbackId: 'f-y', action: 'propose', section: 'retry', text: 'retries:\n  max: 3\n', message: '' }] });
    expect(bad.actions[0].failed).toBe('bad-text');
  });
});

describe('이름으로 정하는 예외 (독립 검토)', () => {
  it('의존성 목록·코드 소유자·MDX·AI 지시 파일은 Claude 가 제안만, CMake 는 코드', () => {
    for (const p of ['requirements.txt', 'requirements-dev.txt', 'constraints.in', 'CODEOWNERS', 'site/a.mdx', 'CLAUDE.md', 'sub/AGENTS.md', 'skills/x/SKILL.md', 'GEMINI.md', 'CLAUDE.local.md']) {
      expect(claudeChanges(formatOf(p)!), p).toEqual(['propose']);
    }
    expect(formatOf('CMakeLists.txt')!.id).toBe('code');
    expect(formatOf('CLAUDE.md')!.kind).toBe('markdown');
    expect(claudeChanges(formatOf('notes.txt')!)).toEqual(['edit', 'propose']);
  });
  it('비밀로 보이는 이름은 형식이 맞아도 문서가 아니다', () => {
    for (const p of ['credentials.json', 'config/secrets.yaml', 'service-account-prod.json', 'client_secret_x.json']) {
      expect(formatOf(p), p).toBeNull();
      expect(isDocPath(p, { include: ['**/*'], exclude: [] }), p).toBe(false);
    }
    expect(formatOf('secret-sauce.md')?.id).toBe('markdown');
  });
});
