/**
 * Claude 자리 — 기록 폴더(D76). 그 폴더에서 Claude Code 를 켜면 DocBench 를 다룰 줄 아는 Claude 가 된다:
 * 플러그인·앱·node 를 설치하지 않는다. Claude Code 는 처음 띄운 폴더를 기준으로
 *   · 그 폴더의 CLAUDE.md(지시)와 .claude/settings.json(권한)을 읽고
 *   · 묻지 않고 읽을 수 있는 범위(작업 폴더)를 정하고
 *   · 대화 기록을 그 폴더 이름으로 남긴다(`claude -c` 로 이어 가기)
 * 그래서 문서 폴더가 아니라 기록 폴더를 Claude 의 자리로 쓴다 — 문서 폴더에는 문서만(D57), 남의 저장소 지시·훅이 섞이지 않고,
 * DocBench 대화가 내 프로젝트 대화와 섞이지 않는다.
 * 단, Claude Code 는 켠 폴더의 **위 폴더들**의 CLAUDE.md 도 읽는다(.claude/settings.json 은 물려받지 않음 — 공식 문서 확인).
 * 기록을 문서 폴더 안(.docbench)에 둔 경우 문서 폴더·저장소의 CLAUDE.md 가 함께 실리므로, 설정의 claudeMdExcludes 로 위 폴더의
 * CLAUDE.md 를 뺀다(경로를 아는 쪽은 절대 경로, 브라우저는 문서 폴더 이름으로). 관리자(managed) CLAUDE.md 는 뺄 수 없다.
 *
 * Claude 는 결과를 runs/<id>.result.json 한 파일로만 쓰고, 반영은 그 계정의 DocBench(화면·앱)가 같은 규칙(apply.ts)으로 한다.
 * 이 파일의 글은 서버·CLI(Workspace)와 단일 HTML(FolderWorkspace)이 같이 쓴다 — 한 벌의 규칙.
 */
import type { RunStartInput } from '../types';
import { REVIEW_SCHEMA, RUN_SCHEMA, runFiles, safeFolderName } from './runs';

/** DocBench 가 만든 파일 표시 — 이 표시가 없으면(사람이 바꿔 썼으면) 덮지 않는다 */
export const ROOM_MARK = '<!-- docbench:room 1 -->';
/** 설정 파일의 표시(_docbench) 판 — 이보다 낮은 판이 쓴 설정만 화면(단일 HTML)이 새로 쓴다. 서버·앱은 표시가 있으면 늘 맞춘다 */
export const ROOM_SETTINGS_VERSION = 1;
/**
 * 자리 설정을 다시 써도 되나 — 표시(_docbench)가 있는 DocBench 의 것만. 읽지 못한 파일·사람이 쓴 파일은 덮지 않는다.
 * full = 경로를 아는 쪽(서버·앱): 내용이 다르면 맞춘다 · 아니면(브라우저): 없거나 예전 판일 때만(서버가 쓴 더 자세한 설정을 덮지 않게)
 */
export function roomSettingsWritable(existing: unknown, exists: boolean, full: boolean, next: string): boolean {
  if (!exists) return true;
  const v = existing && typeof existing === 'object' ? (existing as { _docbench?: unknown })._docbench : undefined;
  if (typeof v !== 'number') return false;
  return full ? JSON.stringify(existing) !== JSON.stringify(JSON.parse(next)) : v < ROOM_SETTINGS_VERSION;
}
export const ROOM_FILES = { claudeMd: 'CLAUDE.md', settings: '.claude/settings.json', instructions: 'instructions.md' } as const;
/** 터미널 Claude 가 스스로 올리는 제안(요청 없이) — runs/inbox-<이름>.result.json */
export const INBOX_RE = /^inbox-[\w.-]{1,60}\.result\.json$/;

export interface RoomInfo {
  /** 문서 폴더 이름(폴더 이름뿐) */
  docsName: string;
  /** 문서 폴더의 절대 경로 — 서버·CLI 만 안다. 있으면 설정의 additionalDirectories 와 편집 금지에 넣는다 */
  docsPath?: string;
  /** 기록 폴더(이 자리)의 절대 경로 — 아는 쪽만. 위 폴더들의 CLAUDE.md 를 빼는 데 쓴다 */
  roomPath?: string;
  /** 기록이 문서 폴더 안(.docbench) — 문서 폴더의 CLAUDE.md 가 위 폴더로 실린다 */
  inside?: boolean;
  locale?: 'ko' | 'en';
}

/** 기록 폴더의 CLAUDE.md */
export function roomClaudeMd(r: RoomInfo): string {
  const name = safeFolderName(r.docsName);
  if (r.locale === 'en') return [
    ROOM_MARK,
    `# DocBench — Claude's room for "${name}"`,
    '',
    `This folder holds DocBench records (feedback, history, requests) for the document folder "${name}". Start Claude Code here to work with DocBench. DocBench writes this file — edit the standing instructions in instructions.md (or in DocBench) instead.`,
    '',
    '## Requests',
    '- People review documents in DocBench and send feedback in batches. Each batch is a request in `runs/`.',
    '- Pending requests: `runs/*.req.json` whose `runner` starts with "terminal" and that have no `.result.json`, no status file (`<id>.json`) and no `.cancel` yet. When the person names a request id, handle only that one.',
    '- If the person just says "next", "go", "handle it" (no id), handle the pending requests oldest first, one result file each. If pending requests have different `runner` values (several people share this folder), handle only the ones with the same `runner` as the request you handled earlier in this conversation — or ask whose to handle.',
    '- For each request read `runs/<id>.prompt.md` to the end and follow it. Write the result as ONE JSON value to `runs/<id>.result.json` exactly in the schema given there. Do not edit any other file — DocBench applies the result to the documents with version checks.',
    '- Then tell the person in one or two sentences what you did; the open DocBench screen applies it within seconds.',
    '',
    '## Talking first',
    '- If the person asks you to review documents first or to suggest something, write suggestions/questions to `runs/inbox-<short-name>.result.json` in the review schema of any recent `runs/*.prompt.md` that has one (or the shape: {"overview": "...", "items": [{"docId", "section", "kind": "suggest"|"question", "title", "message", "text"}], "view": []}). They appear on the person\'s screen as items to review.',
    `- To read the documents you need the document folder in this session. If it is not available, ask the person to run \`/add-dir "<path to ${name}>"\`.`,
    '',
    '## Other instructions',
    '- If CLAUDE.md files from parent folders or the document folder also appear, they belong to other projects — for DocBench requests follow this file, the request file and the standing instructions below.',
    '',
    '## Standing instructions',
    '@instructions.md',
    '',
  ].join('\n');
  return [
    ROOM_MARK,
    `# DocBench — "${name}" 의 Claude 자리`,
    '',
    `이 폴더는 문서 폴더 "${name}" 의 DocBench 기록(피드백·이력·요청)입니다. 여기서 Claude Code 를 켜면 DocBench 와 함께 일합니다. 이 파일은 DocBench 가 씁니다 — 늘 지킬 지시는 instructions.md(또는 DocBench 화면)에서 고치세요.`,
    '',
    '## 요청 처리',
    '- 사람은 DocBench 화면에서 문서를 읽고 피드백을 묶어 보냅니다. 보낸 묶음 하나가 `runs/` 의 요청 하나입니다.',
    '- 처리할 요청: `runs/*.req.json` 중 `runner` 가 "terminal" 로 시작하고, 같은 id 의 `.result.json`·상태 파일(`<id>.json`)·`.cancel` 이 아직 없는 것. 사람이 요청 id 를 말하면 그것만.',
    '- 사람이 id 없이 "다음", "처리해 줘", "이어서"라고만 하면 처리할 요청을 오래된 것부터 하나씩(요청마다 결과 파일 하나). `runner` 가 서로 다른 요청이 섞여 있으면(여럿이 함께 쓰는 폴더) 이 대화에서 앞서 처리한 요청과 같은 `runner` 의 것만 — 그런 요청이 없었으면 누구 것을 할지 묻습니다.',
    '- 요청마다 `runs/<id>.prompt.md` 를 끝까지 읽고 그대로 따릅니다. 결과는 그 안에 적힌 모양(JSON Schema)대로 JSON 하나를 `runs/<id>.result.json` 에만 씁니다. 다른 파일은 고치지 않습니다 — 문서 반영은 DocBench 가 판을 비교해 합니다.',
    '- 쓰고 나면 무엇을 했는지 한두 줄로 말해 줍니다. 열려 있는 DocBench 화면이 몇 초 안에 반영합니다.',
    '',
    '## 먼저 말 걸기',
    '- 사람이 "먼저 검토해 줘", "이 문서 어때"처럼 말하면, 제안·질문을 `runs/inbox-<짧은이름>.result.json` 에 씁니다. 모양은 최근 `runs/*.prompt.md` 의 선제안 모양, 없으면 {"overview": "...", "items": [{"docId", "section", "kind": "suggest"|"question", "title", "message", "text"}], "view": []}. 사람 화면에 "볼 것"으로 올라갑니다.',
    `- 문서를 읽으려면 이 세션에 문서 폴더가 있어야 합니다. 없으면 사람에게 \`/add-dir "<${name} 의 경로>"\` 를 부탁합니다.`,
    '',
    '## 다른 지시',
    '- 위 폴더나 문서 폴더의 CLAUDE.md 가 함께 보이더라도 그것은 다른 프로젝트의 지시입니다 — DocBench 요청에서는 이 파일·요청 파일·아래 늘 지킬 지시를 따릅니다.',
    '',
    '## 늘 지킬 지시',
    '@instructions.md',
    '',
  ].join('\n');
}

/**
 * 기록 폴더의 .claude/settings.json — 결과 파일만 묻지 않고 쓰게 하고, DocBench 기록과 문서 폴더는 직접 고치지 못하게.
 * 허용(allow)은 Claude Code 의 작업 공간 신뢰 창에서 사람이 한 번 확인한 뒤에야 쓰인다.
 */
export function roomSettings(r: RoomInfo): string {
  // 문서 폴더는 문서(.md·.markdown)만 막는다 — 기록이 문서 폴더 안(.docbench)이면 폴더째 막는 규칙이 결과 파일까지 막는다
  // (거부가 허용보다 먼저이고 허용으로 예외를 낼 수 없다). 경로 규칙의 절대 경로는 '//' + 유닉스 꼴(Windows 는 //c/…)
  const docs = r.docsPath ? '/' + ruleAbs(r.docsPath) : '';
  const excludes = parentClaudeMd(r);
  const s = {
    _docbench: ROOM_SETTINGS_VERSION,
    ...(excludes.length ? { claudeMdExcludes: excludes } : {}),
    permissions: {
      allow: ['Edit(/runs/*.result.json)'],
      // 기록과 요청(지시·맥락)은 Claude 가 고치지 못한다 — 맥락을 고쳐 허용 처리를 넓히거나 다른 요청을 꾸미지 않게
      deny: ['Edit(/feedback/**)', 'Edit(/changes.jsonl)', 'Edit(/blobs/**)', 'Edit(/state.json)', 'Edit(/runners/**)', 'Edit(/CLAUDE.md)', 'Edit(/.claude/**)', 'Edit(/instructions.md)',
        'Edit(/runs/*.req.json)', 'Edit(/runs/*.ctx.json)', 'Edit(/runs/*.prompt.md)', 'Edit(/runs/*.log.jsonl)', 'Edit(/config.json)', 'Edit(/docbench-data.json)',
        ...(docs ? [`Edit(${docs}/**/*.md)`, `Edit(${docs}/**/*.markdown)`] : [])],
      ...(r.docsPath ? { additionalDirectories: [r.docsPath] } : {}),
    },
  };
  return JSON.stringify(s, null, 2) + '\n';
}

/** 절대 경로 → 권한 규칙의 유닉스 꼴(앞 '/' 하나). Windows `C:\\x` → `/c/x` (Claude Code 가 그렇게 맞춘다) */
function ruleAbs(p: string): string {
  const u = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const m = /^([A-Za-z]):(\/.*)?$/.exec(u);
  return m ? `/${m[1].toLowerCase()}${m[2] || ''}` : '/' + u.replace(/^\/+/, '');
}

/**
 * 이 자리 위 폴더들의 CLAUDE.md·CLAUDE.local.md·규칙(.claude/rules) — 이 자리의 지시만 쓰게 뺀다.
 * 경로를 알면 위 폴더마다 절대 경로로(앞으로 사슬, '/' 로), 모르면(브라우저) 기록이 문서 폴더 안일 때 문서 폴더 이름으로만.
 */
export function parentClaudeMd(r: RoomInfo): string[] {
  const files = (dir: string) => [`${dir}/CLAUDE.md`, `${dir}/CLAUDE.local.md`, `${dir}/.claude/CLAUDE.md`, `${dir}/.claude/rules/**`];
  // 경로의 글로브 기호는 한 글자 자리(?)로 — "Projects [old]" 같은 이름도 맞게
  const g = (x: string) => x.replace(/[*?[\]{}!]/g, '?');
  if (r.roomPath) {
    const u = r.roomPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const win = /^[A-Za-z]:/.test(u);
    const parts = u.split('/');
    const out: string[] = [];
    for (let i = parts.length - 1; i >= 1; i--) {
      const dir = g(parts.slice(0, i).join('/'));
      // '' = 유닉스 맨 위(/), 'C:' = 드라이브 맨 위. Windows 는 어떤 꼴로 맞추는지 확인하지 못해 두 꼴 다([미확인])
      if (!dir) { out.push('/CLAUDE.md', '/CLAUDE.local.md'); continue; }
      out.push(...files(dir));
      if (win) out.push(...files('/' + dir[0].toLowerCase() + dir.slice(2)));
    }
    return out.slice(0, 120);
  }
  // 이름의 글로브 기호는 한 글자 자리(?)로 — 그 이름만 맞게
  if (r.inside) return files('**/' + g(r.docsName.replace(/[\\/\r\n]/g, '')).slice(0, 120));
  return [];
}

/** 처음 쓸 때의 instructions.md */
export const roomInstructionsSeed = (locale?: 'ko' | 'en'): string => locale === 'en'
  ? '<!-- Standing instructions for Claude in this workspace — tone, terms, things never to change. DocBench adds them to every request. -->\n'
  : '<!-- 이 작업 공간에서 Claude 가 늘 지킬 지시 — 문체·용어·바꾸면 안 되는 것. DocBench 가 요청마다 붙입니다. -->\n';

/** instructions.md 에서 사람이 쓴 지시만 (주석 뺌) */
export const standingInstructions = (text: string | null | undefined): string => (text || '').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 4000);

/** 터미널 Claude 가 읽을 요청 파일(runs/<id>.prompt.md) */
export function terminalPromptFile(id: string, req: RunStartInput, prompt: string, locale?: 'ko' | 'en', o: { noFolder?: boolean } = {}): string {
  const f = runFiles(id);
  const schema = req.kind === 'review' ? REVIEW_SCHEMA : RUN_SCHEMA;
  const ko = locale !== 'en';
  const what = req.kind === 'review' ? (req.goal === 'view' ? (ko ? '읽기 정리' : 'reading plan') : (ko ? '먼저 검토(선제안)' : 'review first')) : (ko ? `보낸 피드백 ${req.feedbackIds.length}건` : `${req.feedbackIds.length} feedback item(s)`);
  return [
    `# DocBench ${ko ? '요청' : 'request'} ${id} — ${what}`,
    '',
    ko
      ? `결과: \`runs/${f.result}\` 에 아래 "결과 모양"에 맞는 JSON 하나만 쓴다. 다른 파일은 고치지 않는다(문서 반영은 DocBench 가 한다). 아래 지시의 "structured result"는 이 결과 파일을 뜻한다.`
      : `Result: write ONE JSON value matching "Result schema" below to \`runs/${f.result}\`. Do not edit any other file (DocBench applies it). "Structured result" in the instructions below means this file.`,
    // 브라우저에서 만든 요청: 이 Claude 는 문서 폴더의 경로를 모른다 — 필요한 글은 아래에 다 넣었다
    ...(o.noFolder ? ['', ko
      ? '문서 폴더는 열지 않는다 — 이 자리에서는 경로를 모르고, 필요한 글(섹션·문서)은 아래에 다 들어 있다. 폴더를 찾아 드라이브를 뒤지지 말고, 맥락이 더 필요하면 그 항목을 되묻는다(ask). 아래 지시의 "read the folder"는 이 경우 해당하지 않는다.'
      : 'Do not open the document folder — its path is not known here and every text you need (sections, documents) is included below. Do not search drives for it; if you need more context, ask on that item. Instructions below about reading the folder do not apply here.'] : []),
    '',
    `## ${ko ? '지시' : 'Instructions'}`,
    '',
    prompt,
    '',
    `## ${ko ? '결과 모양' : 'Result schema'} (JSON Schema)`,
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    '',
  ].join('\n');
}

/**
 * 터미널에서 칠 한 줄. room = 기록 폴더의 절대 경로(아는 쪽만 — 서버·앱). 모르면 그 폴더에서 치라고 안내한다.
 * shell: pwsh(Windows 기본) | sh
 */
/** Claude 에게 할 말 — 칠 줄과 deep link 가 같은 말 */
const terminalAsk = (id: string, locale?: 'ko' | 'en') => (locale === 'en' ? `Handle DocBench request ${id} (runs/${id}.prompt.md).` : `DocBench 요청 ${id} 를 처리해 줘 (runs/${id}.prompt.md).`);

/** 기록 폴더의 절대 경로로 쓸 수 있나 — Windows 드라이브 경로나 유닉스 경로. 네트워크(UNC)·'..'·제어 문자는 안 된다(deep link 도 거부) */
export function isRoomPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 1000) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(p)) return false;
  if (/^[\\/]{2}/.test(p)) return false;
  if (p.split(/[\\/]/).includes('..')) return false;
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/');
}

/**
 * Claude Code 의 deep link — 새 터미널 창에 Claude Code 를 기록 폴더에서 켜고 요청을 입력해 둔다(보내기는 사람이 Enter).
 * Claude Code 가 처음 대화형으로 쓰일 때 OS 에 등록한다(Windows: HKCU\Software\Classes\claude-cli). 공식: code.claude.com/docs/en/deep-links
 * 모델·노력은 실을 수 없다 — 그 PC 의 Claude Code 기본값
 */
export function terminalDeepLink(o: { id: string; room: string; locale?: 'ko' | 'en' }): string | null {
  if (!isRoomPath(o.room)) return null;
  return `claude-cli://open?cwd=${encodeURIComponent(o.room)}&q=${encodeURIComponent(terminalAsk(o.id, o.locale))}`;
}

export function terminalCommand(o: { id: string; room?: string; shell: 'pwsh' | 'sh'; model?: string; effort?: string; resume?: boolean; locale?: 'ko' | 'en' }): string {
  const ask = terminalAsk(o.id, o.locale);
  // PowerShell 은 ‘ ’ ‚ ‛ 도 작은따옴표로 친다 — 모두 두 번 써서 글자로. sh 는 '\'' 로
  const q = (s: string) => o.shell === 'pwsh' ? `'${s.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'` : `'${s.replace(/'/g, `'\\''`)}'`;
  const flags = [o.resume ? '-c' : '', o.model ? `--model ${q(o.model)}` : '', o.effort ? `--effort ${o.effort}` : ''].filter(Boolean).join(' ');
  const claude = `claude ${flags ? flags + ' ' : ''}${q(ask)}`;
  if (!o.room) return claude;
  return o.shell === 'pwsh' ? `Set-Location -LiteralPath ${q(o.room)}; ${claude}` : `cd ${q(o.room)} && ${claude}`;
}

/** 터미널 안내에 줄 두 벌(새 대화 · 지난 대화 이어서 -c) × 두 셸 — 서버·앱·단일 HTML 이 같은 모양으로 */
export function terminalCommands(o: { id: string; room?: string; model?: string; effort?: string; locale?: 'ko' | 'en' }): { command: { pwsh: string; sh: string }; resume: { pwsh: string; sh: string }; link?: string } {
  const c = (shell: 'pwsh' | 'sh', resume: boolean) => terminalCommand({ ...o, shell, resume });
  const link = o.room ? terminalDeepLink({ id: o.id, room: o.room, locale: o.locale }) : null;
  return { command: { pwsh: c('pwsh', false), sh: c('sh', false) }, resume: { pwsh: c('pwsh', true), sh: c('sh', true) }, ...(link ? { link } : {}) };
}

// ---------------------------------------------------------------- 결과 파일 받기 (서버·화면 공통 규칙)

/** 반영 중(running)이 이보다 오래 그대로면 멈춘 것 — 실패로 닫는다(다시 보내면 된다) */
export const TERMINAL_STALE_MS = 3 * 60_000;
/** 결과 파일이 아직 JSON 이 아니면(쓰는 중·Windows 공유 위반) 이만큼은 기다린다 */
export const RESULT_SETTLE_MS = 60_000;

/**
 * 결과 파일이 있는 터미널 요청을 지금 어떻게 할지. 화면(단일 HTML)과 앱·서버가 같은 규칙으로 — 잠금(lockKey.run) 안에서 부른다.
 *  apply = 반영 · cancel = 멈춤 요청이 있어 반영하지 않고 닫음 · stale = 반영 중에 멈춤 → 실패로 · skip = 이미 끝났거나 다른 쪽이 반영 중
 */
export function terminalStep(status: { state?: unknown; startedAt?: unknown } | null | undefined, cancel: boolean, now = Date.now()): 'apply' | 'cancel' | 'stale' | 'skip' {
  const state = status && typeof status.state === 'string' ? status.state : 'queued';
  if (state === 'queued') return cancel ? 'cancel' : 'apply';
  if (state === 'running') {
    const t = typeof status?.startedAt === 'string' ? Date.parse(status.startedAt) : NaN;
    return isFinite(t) && now - t > TERMINAL_STALE_MS ? 'stale' : 'skip';
  }
  return 'skip';
}

/** 결과 파일 글 → 값 (BOM·```json 울타리를 벗긴다). 모양이 아니면 null */
export function parseResultText(text: string | null | undefined): unknown {
  if (text == null) return null;
  try { return JSON.parse(text.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
}
