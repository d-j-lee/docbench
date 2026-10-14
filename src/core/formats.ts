/**
 * 문서 형식 — 작업대가 여는 파일과 그 형식을 다루는 법(D87). DOM 없이 돈다(서버·CLI·브라우저가 한 벌로 쓴다).
 *
 * 형식은 문서 id(경로)의 확장자·이름만으로 정한다 — 같은 파일을 서버·단일 HTML·CLI·Claude 작업이 같게 다루게.
 * 다섯 갈래:
 *   markdown  제목이 섹션(지금까지의 문서)
 *   outline   구조 글 — YAML 키·TOML/INI 표·JSON 키·AsciiDoc/rST/Org 제목이 섹션. 범위·키·바이트 보존 규칙은 마크다운과 같다(core/outline)
 *   text      문서 전체 하나 — 글·표(CSV)·로그·코드·HTML/XML/SVG
 *   derived   DocBench 가 글을 뽑아 보여 준다 — Word·PowerPoint·Excel·한글(HWPX)·Jupyter. 뽑은 글은 마크다운, 원본은 고치지 않는다(core/derive)
 *   binary    미리보기만 — 그림·PDF
 *
 * 이 목록(허용 목록)에 없는 파일은 문서가 될 수 없다 — 함께 쓰는 config.json 의 include 를 넓혀도(D71 의 바닥 규칙).
 * Claude 가 결과로 문서를 바로 고칠 수 있는지도 여기서 정한다(claude): 글·표·도식은 바로 고치기까지,
 * 실행되거나 도구가 읽는 파일(코드·HTML·SVG·SQL·설정 YAML/JSON/TOML/INI)은 제안만(사람이 차이를 보고 적용 — 무인 실행이 설정을 바꾸지 않게),
 * 증거인 로그와 원본을 고칠 수 없는 형식(뽑은 글·그림·PDF)은 읽고 답만.
 */

import type { FileGroup } from '../types';

export type FormatKind = 'markdown' | 'outline' | 'text' | 'derived' | 'binary';
/** Claude 작업의 결과가 이 형식의 문서에 할 수 있는 일: 바로 고치기까지 · 제안만 · 읽고 답만 */
export type ClaudeWrite = 'edit' | 'propose' | 'read';
/** 글 형식을 화면에 그리는 법 */
export type FormatView = 'markdown' | 'outline' | 'plain' | 'code' | 'table' | 'html' | 'svg' | 'image' | 'pdf';

export interface FormatSpec {
  /** 형식 이름 — markdown · yaml · json · csv · code · docx · image … */
  id: string;
  kind: FormatKind;
  group: FileGroup;
  view: FormatView;
  /** 사람에게 보일 짧은 이름 (YAML · Word …) */
  label: string;
  /** 글자 색 입히기(ui/highlight)의 언어 */
  lang?: string;
  claude: ClaudeWrite;
  /** 바이트로 내줄 때의 형식 (그림·PDF·오피스) */
  mime?: string;
}

const MARKDOWN: FormatSpec = { id: 'markdown', kind: 'markdown', group: 'doc', view: 'markdown', label: 'Markdown', claude: 'edit' };

const F = (id: string, kind: FormatKind, group: FileGroup, view: FormatView, label: string, claude: ClaudeWrite, extra: Partial<FormatSpec> = {}): FormatSpec =>
  ({ id, kind, group, view, label, claude, ...extra });

const SPECS = {
  markdown: MARKDOWN,
  // 구조 글 — 섹션이 있다
  // 설정 파일은 도구가 읽어 실행한다(package.json scripts · docker-compose · CI) — Claude 는 제안만, 사람이 차이를 보고 적용
  yaml: F('yaml', 'outline', 'data', 'outline', 'YAML', 'propose', { lang: 'yaml' }),
  json: F('json', 'outline', 'data', 'outline', 'JSON', 'propose', { lang: 'json' }),
  toml: F('toml', 'outline', 'data', 'outline', 'TOML', 'propose', { lang: 'toml' }),
  ini: F('ini', 'outline', 'data', 'outline', 'INI', 'propose', { lang: 'ini' }),
  asciidoc: F('asciidoc', 'outline', 'doc', 'outline', 'AsciiDoc', 'edit'),
  rst: F('rst', 'outline', 'doc', 'outline', 'reStructuredText', 'edit'),
  org: F('org', 'outline', 'doc', 'outline', 'Org', 'edit'),
  // 글 — 문서 전체 하나
  text: F('text', 'text', 'doc', 'plain', 'Text', 'edit'),
  log: F('log', 'text', 'data', 'code', 'Log', 'read', { lang: 'log' }),
  csv: F('csv', 'text', 'data', 'table', 'CSV', 'edit'),
  tsv: F('tsv', 'text', 'data', 'table', 'TSV', 'edit'),
  jsonl: F('jsonl', 'text', 'data', 'code', 'JSON Lines', 'edit', { lang: 'json' }),
  html: F('html', 'text', 'doc', 'html', 'HTML', 'propose', { lang: 'xml' }),
  xml: F('xml', 'text', 'data', 'code', 'XML', 'propose', { lang: 'xml' }),
  svg: F('svg', 'text', 'image', 'svg', 'SVG', 'propose', { lang: 'xml', mime: 'image/svg+xml' }),
  mermaid: F('mermaid', 'text', 'doc', 'code', 'Mermaid', 'edit', { lang: 'mermaid' }),
  plantuml: F('plantuml', 'text', 'doc', 'code', 'PlantUML', 'edit', { lang: 'plantuml' }),
  dot: F('dot', 'text', 'doc', 'code', 'Graphviz', 'edit', { lang: 'c' }),
  diff: F('diff', 'text', 'code', 'code', 'Diff', 'propose', { lang: 'diff' }),
  sql: F('sql', 'text', 'code', 'code', 'SQL', 'propose', { lang: 'sql' }),
  // 뽑은 글 — 원본은 고치지 않는다
  ipynb: F('ipynb', 'derived', 'code', 'markdown', 'Jupyter', 'read'),
  docx: F('docx', 'derived', 'office', 'markdown', 'Word', 'read', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  pptx: F('pptx', 'derived', 'office', 'markdown', 'PowerPoint', 'read', { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
  xlsx: F('xlsx', 'derived', 'office', 'markdown', 'Excel', 'read', { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  hwpx: F('hwpx', 'derived', 'office', 'markdown', '한글(HWPX)', 'read', { mime: 'application/hwp+zip' }),
  // 미리보기
  pdf: F('pdf', 'binary', 'pdf', 'pdf', 'PDF', 'read', { mime: 'application/pdf' }),
} satisfies Record<string, FormatSpec>;

/**
 * 이름으로 정하는 예외 — 글·마크다운 모양이지만 도구·에이전트가 읽어 실행하거나 지시로 따르는 파일은 제안만(독립 검토):
 * 의존성 목록(pip install -r)·코드 소유자·MDX(문서 사이트 빌드가 import·JSX 를 실행) · AI 지시 파일(CLAUDE.md·AGENTS.md·SKILL.md … —
 * 무인 실행이 고치면 다음 세션의 지시가 된다)
 */
const DEP_LIST: FormatSpec = F('text', 'text', 'data', 'code', 'Dependency list', 'propose', { lang: 'hash' });
const AI_DOC: FormatSpec = { ...MARKDOWN, claude: 'propose' };
const MDX: FormatSpec = { ...MARKDOWN, label: 'MDX', claude: 'propose' };
const AI_NAMES = /^(claude(\.local)?|agents|gemini|skill|copilot-instructions)\.md$/i;
const DEP_NAMES = /^(requirements|constraints)([-_.][\w.-]*)?\.(txt|in)$/i;

/** 코드 — 언어마다 이름과 색 입히기만 다르다. 실행되는 파일이라 Claude 는 제안만 */
const code = (label: string, lang: string): FormatSpec => F('code', 'text', 'code', 'code', label, 'propose', { lang });
const image = (label: string, mime: string): FormatSpec => F('image', 'binary', 'image', 'image', label, 'read', { mime });

const EXT: Record<string, FormatSpec> = {
  md: MARKDOWN, markdown: MARKDOWN, mdx: MDX, mdown: MARKDOWN, mkd: MARKDOWN, mkdn: MARKDOWN,
  yaml: SPECS.yaml, yml: SPECS.yaml, json: SPECS.json, jsonc: SPECS.json, toml: SPECS.toml,
  ini: SPECS.ini, cfg: SPECS.ini, conf: SPECS.ini, properties: SPECS.ini,
  adoc: SPECS.asciidoc, asciidoc: SPECS.asciidoc, rst: SPECS.rst, org: SPECS.org,
  txt: SPECS.text, text: SPECS.text, log: SPECS.log, csv: SPECS.csv, tsv: SPECS.tsv, tab: SPECS.tsv, jsonl: SPECS.jsonl, ndjson: SPECS.jsonl,
  html: SPECS.html, htm: SPECS.html, xhtml: SPECS.html, xml: SPECS.xml, xsd: SPECS.xml, xsl: SPECS.xml, xslt: SPECS.xml, plist: SPECS.xml, svg: SPECS.svg,
  mmd: SPECS.mermaid, mermaid: SPECS.mermaid, puml: SPECS.plantuml, plantuml: SPECS.plantuml, dot: SPECS.dot, gv: SPECS.dot,
  diff: SPECS.diff, patch: SPECS.diff, sql: SPECS.sql,
  js: code('JavaScript', 'js'), mjs: code('JavaScript', 'js'), cjs: code('JavaScript', 'js'), jsx: code('JSX', 'js'),
  ts: code('TypeScript', 'js'), mts: code('TypeScript', 'js'), cts: code('TypeScript', 'js'), tsx: code('TSX', 'js'),
  vue: code('Vue', 'xml'), svelte: code('Svelte', 'xml'),
  css: code('CSS', 'css'), scss: code('SCSS', 'css'), sass: code('Sass', 'css'), less: code('Less', 'css'),
  py: code('Python', 'python'), pyi: code('Python', 'python'), rb: code('Ruby', 'ruby'), r: code('R', 'hash'), pl: code('Perl', 'hash'), pm: code('Perl', 'hash'),
  ex: code('Elixir', 'hash'), exs: code('Elixir', 'hash'), lua: code('Lua', 'lua'), hs: code('Haskell', 'lua'),
  sh: code('Shell', 'sh'), bash: code('Shell', 'sh'), zsh: code('Shell', 'sh'), ksh: code('Shell', 'sh'), fish: code('Shell', 'sh'),
  ps1: code('PowerShell', 'ps'), psm1: code('PowerShell', 'ps'), psd1: code('PowerShell', 'ps'), bat: code('Batch', 'bat'), cmd: code('Batch', 'bat'),
  java: code('Java', 'c'), kt: code('Kotlin', 'c'), kts: code('Kotlin', 'c'), scala: code('Scala', 'c'), groovy: code('Groovy', 'c'), gradle: code('Gradle', 'c'),
  cs: code('C#', 'c'), go: code('Go', 'c'), rs: code('Rust', 'c'), swift: code('Swift', 'c'), dart: code('Dart', 'c'), php: code('PHP', 'c'),
  c: code('C', 'c'), h: code('C', 'c'), cpp: code('C++', 'c'), cc: code('C++', 'c'), cxx: code('C++', 'c'), hpp: code('C++', 'c'), hh: code('C++', 'c'), m: code('Objective-C', 'c'), mm: code('Objective-C', 'c'),
  proto: code('Protocol Buffers', 'c'), graphql: code('GraphQL', 'hash'), gql: code('GraphQL', 'hash'), tf: code('Terraform', 'hash'), hcl: code('HCL', 'hash'),
  cmake: code('CMake', 'hash'), mk: code('Makefile', 'make'),
  ipynb: SPECS.ipynb, docx: SPECS.docx, pptx: SPECS.pptx, xlsx: SPECS.xlsx, hwpx: SPECS.hwpx,
  pdf: SPECS.pdf,
  png: image('PNG', 'image/png'), jpg: image('JPEG', 'image/jpeg'), jpeg: image('JPEG', 'image/jpeg'), gif: image('GIF', 'image/gif'),
  webp: image('WebP', 'image/webp'), bmp: image('BMP', 'image/bmp'), ico: image('ICO', 'image/x-icon'), avif: image('AVIF', 'image/avif'),
};

/** 확장자 없이 이름으로 아는 파일 (대소문자 그대로 — 운영체제가 쓰는 관례 이름) */
const NAMES: Record<string, FormatSpec> = {
  Dockerfile: code('Dockerfile', 'sh'), Containerfile: code('Dockerfile', 'sh'), Makefile: code('Makefile', 'make'), GNUmakefile: code('Makefile', 'make'),
  Jenkinsfile: code('Jenkinsfile', 'c'), Vagrantfile: code('Ruby', 'ruby'), Gemfile: code('Ruby', 'ruby'), Rakefile: code('Ruby', 'ruby'), Procfile: code('Procfile', 'sh'),
  LICENSE: SPECS.text, LICENCE: SPECS.text, NOTICE: SPECS.text, AUTHORS: SPECS.text, COPYING: SPECS.text, CHANGELOG: SPECS.text, README: SPECS.text,
  CODEOWNERS: { ...DEP_LIST, label: 'CODEOWNERS' }, 'CMakeLists.txt': code('CMake', 'hash'),
};

/** 비밀(키·인증 정보)로 보이는 파일 — 이름만 본다(내용은 열지 않는다). 이런 파일은 형식이 맞아도 문서가 되지 않는다(formatOf → null — 화면·Claude 에 내용이 가지 않게, 개요는 이름으로 짚는다) */
export function looksSecret(name: string, size?: number): boolean {
  const n = name.toLowerCase();
  if (/^\.env(\..+)?$/.test(n)) return !/\.(example|sample|template|dist|defaults?)$/.test(n);
  if (/\.(pem|p12|pfx|jks|keystore|ppk|kdbx|asc|gpg)$/.test(n)) return true;
  // macOS Keynote 도 .key — 작은 파일만 키로 본다
  if (/\.key$/.test(n)) return (size ?? 0) < 16 * 1024;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(n)) return true;
  if (/^(credentials?|secrets?|service[-_]?account[\w-]*|client[-_]secret[\w-]*)(\.(json|ya?ml|txt|ini|toml|env))?$/.test(n)) return true;
  if (/^\.(npmrc|pypirc|netrc|git-credentials)$/.test(n)) return true;
  return false;
}

/**
 * 작업대가 여는 형식인가 — 등록된 확장자·이름만(허용 목록). 점으로 시작하는 파일(.env 등)·오피스 잠금 파일(~$)·확장자 없는 낯선 파일은 null.
 * 경로는 '/' 구분 상대 경로여도, 파일 이름만이어도 된다.
 */
export function formatOf(path: string): FormatSpec | null {
  const name = String(path || '').split('/').pop() || '';
  if (!name || name.startsWith('.') || name.startsWith('~$')) return null;
  if (looksSecret(name)) return null;
  if (NAMES[name]) return NAMES[name];
  if (AI_NAMES.test(name)) return AI_DOC;
  if (DEP_NAMES.test(name)) return DEP_LIST;
  if (/^(Dockerfile|Containerfile)\.[\w.-]+$/.test(name)) return NAMES.Dockerfile;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXT[name.slice(dot + 1).toLowerCase()] || null;
}

/**
 * 화면·섹션 계산에 쓸 형식 — 모르면 마크다운. 확장자 없는 id 를 쓰는 저장소(아티팩트·호스트 어댑터)는 지금처럼 마크다운으로 돈다.
 * 문서가 될 수 있는지(바닥 규칙)는 formatOf 로 본다.
 */
export const formatFor = (id: string | undefined | null): FormatSpec => (id ? formatOf(id) : null) || MARKDOWN;

export const isMarkdownPath = (path: string): boolean => formatOf(path)?.kind === 'markdown';

/** 섹션을 마크다운 규칙으로 세는 형식인가 — 마크다운과 뽑은 글(뽑은 글은 마크다운이다) */
export const markdownLike = (f: FormatSpec): boolean => f.kind === 'markdown' || f.kind === 'derived';

/** 사람이 화면에서 글을 고칠 수 있는 형식인가 (뽑은 글·미리보기는 원본을 고칠 수 없다) */
export const editableFormat = (f: FormatSpec): boolean => f.kind === 'markdown' || f.kind === 'outline' || f.kind === 'text';

/** 이 형식에서 Claude 결과가 할 수 있는 처리 — 고치기·제안 (읽기만이면 빈 목록) */
export function claudeChanges(f: FormatSpec): ('edit' | 'propose')[] {
  if (!editableFormat(f) || f.claude === 'read') return [];
  return f.claude === 'propose' ? ['propose'] : ['edit', 'propose'];
}

/** 파일 이름 → 확장자(소문자, 없으면 '') */
export const extOf = (name: string): string => {
  const n = String(name || '').split('/').pop() || '';
  const dot = n.lastIndexOf('.');
  return dot > 0 ? n.slice(dot + 1).toLowerCase() : '';
};

const GROUP_EXT: Record<string, FileGroup> = {};
for (const [g, list] of Object.entries({
  office: 'doc docm dot xls xlsm xlsb ppt pptm pps hwp hwt cell show odt ods odp rtf key numbers pages vsd vsdx one msg eml',
  image: 'tif tiff heic heif psd ai sketch fig xd eps raw cr2 nef dng',
  media: 'mp3 wav m4a aac flac ogg oga opus mp4 m4v mov avi mkv webm wmv flv',
  archive: 'zip 7z rar tar gz tgz bz2 xz zst lz jar war apk dmg iso',
  data: 'parquet avro orc feather arrow db sqlite sqlite3 mdb accdb sav dta xpt npy npz h5 hdf5 pkl pickle',
  code: 'class o obj so dll dylib exe pyc wasm',
} as Record<string, string>)) for (const e of list.split(' ')) GROUP_EXT[e] = g as FileGroup;

/** 어떤 파일이든 개요의 묶음으로 — 열 수 있는 형식은 그 형식의 묶음, 아니면 확장자로 짐작 */
export function fileGroupOf(path: string): FileGroup {
  const f = formatOf(path);
  if (f) return f.group;
  return GROUP_EXT[extOf(path)] || 'other';
}

/** 한 번에 통째로 읽는 글의 한도 — 넘으면 앞부분만 보여 주고 읽기 전용(too-large) */
export const TEXT_MAX_BYTES = 5 * 1024 * 1024;
/** 한도를 넘은 글에서 보여 줄 앞부분 */
export const TEXT_PREVIEW_BYTES = 512 * 1024;
/** 바이트로 내주는(그림·PDF·원본 내려받기) 한도 */
export const BYTES_MAX = 40 * 1024 * 1024;
/**
 * 통째로 읽지 않는 큰 파일(앞부분만 보이는 글, BYTES_MAX 를 넘는 원본)의 판 — 크기·고친 시각(ms)으로.
 * 서버와 단일 HTML 이 같은 판을 내야 한다(판은 기록 폴더의 state 로 함께 쓴다 — 다르면 서로 "바깥 편집"으로 본다)
 */
export const bigVersion = (size: number, mtimeMs: number): string => `z${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}`;
/** 글을 뽑는 원본의 한도 (Word·Excel …) — 넘으면 뽑지 않고 파일 정보만 */
export const DERIVE_MAX_BYTES = 40 * 1024 * 1024;

/**
 * 제목을 앞부분 글에서 찾을 수 있는 형식인가 (매니페스트가 앞 8 KB 를 읽는다) — 아니면 파일 이름이 제목
 */
export const titledFormat = (f: FormatSpec): boolean => f.kind === 'markdown' || f.id === 'asciidoc' || f.id === 'rst' || f.id === 'org' || f.id === 'html';

/** 글로 고칠 수 있는 형식의 확장자 (마크다운·구조 글·글) */
export function editableExtensions(): string[] {
  return Object.entries(EXT).filter(([, f]) => editableFormat(f)).map(([e]) => e).sort();
}

/**
 * 문서가 될 수 있는 파일의 확장자·이름 전부 — 터미널 Claude 의 자리 설정이 문서 폴더에서 막는다(결과 파일로만 고친다, D76).
 * 편집 거부 규칙은 Write 에도 걸리므로 그림·오피스 원본도 넣는다
 */
export function documentPatterns(): { exts: string[]; names: string[] } {
  return { exts: Object.keys(EXT).sort(), names: Object.keys(NAMES).sort() };
}

/**
 * 설정에 include 가 없을 때 문서가 되는 파일 — 등록된 형식에서 프로그램 소스(코드)만 뺀다(D87).
 * 코드까지 문서로 다루려면 config.json 에 `"include": ["**\/*"]`. 확장자는 소문자·대문자 둘 다(사진기·스캐너의 `.JPG`·`.PDF`)
 */
export function defaultIncludePatterns(): string[] {
  const exts = [...new Set(Object.entries(EXT).filter(([, f]) => f.id !== 'code').flatMap(([e]) => [e, e.toUpperCase()]))].sort();
  const names = Object.entries(NAMES).filter(([, f]) => f.id !== 'code').map(([n]) => n).sort();
  return [`**/*.{${exts.join(',')}}`, `**/{${names.join(',')}}`];
}
