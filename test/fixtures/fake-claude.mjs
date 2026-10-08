#!/usr/bin/env node
// 테스트용 가짜 `claude`. 실제 Claude Code 와 같은 모양으로 답한다.
//  --version · --help              판 확인 (FAKE_CLAUDE_OLD=1 이면 안전 플래그가 없는 옛 판)
//  -p --output-format json         섹션 제안: 표준입력의 섹션에 "(제안)" 한 줄을 덧붙인다
//      FAKE_CLAUDE_MODE=error | garbage | drop-heading | slow
//  -p --output-format stream-json  Claude 작업: 프롬프트의 항목마다 결과를 낸다 (stream-json 줄)
//      FAKE_CLAUDE_RUN=edit(기본) | propose | answer | ask | decline | bad-text | slow | error | garbage | none | mixed
//      (slow 는 FAKE_CLAUDE_SLOW_MS 만큼 기다린 뒤 FAKE_CLAUDE_AFTER(기본 edit)로)
//      FAKE_CLAUDE_ARGS=<파일>  받은 인자·실행 위치를 그 파일에 남긴다 (시험이 확인)
import { writeFileSync, appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_ARGS) appendFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify({ args, cwd: process.cwd() }) + '\n');
const probe = !args.includes('-p');
if (probe && args.includes('--version')) { process.stdout.write('9.9.9 (Claude Code)\n'); process.exit(0); }
if (probe && args.includes('--help')) {
  const flags = ['--add-dir', '--effort', '--json-schema', '--permission-mode', '--tools', '--model', '--output-format'];
  if (process.env.FAKE_CLAUDE_OLD !== '1') flags.push('--restricted', '--safe-mode');
  process.stdout.write('Usage: claude [options]\n' + flags.map((f) => '  ' + f).join('\n') + '\n');
  process.exit(0);
}
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = Buffer.concat(chunks).toString('utf8');
if (!args.includes('-p') || !args.includes('--json-schema') || !args.includes('--tools')) { process.stderr.write('bad args ' + JSON.stringify(args)); process.exit(2); }
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (process.env.FAKE_CLAUDE_PROMPT) writeFileSync(process.env.FAKE_CLAUDE_PROMPT, input);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args[args.indexOf('--output-format') + 1] === 'stream-json') {
  const mode = process.env.FAKE_CLAUDE_RUN || 'edit';
  const root = args[args.indexOf('--add-dir') + 1];
  out({ type: 'system', subtype: 'init', claude_code_version: '9.9.9', model: 'fake-model', tools: ['Read', 'Grep', 'Glob'], permissionMode: 'dontAsk' });
  out({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.12, resetsAt: 1791453600 } } } });
  out({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 42 });
  const items = [];
  const re = /### Item \d+ · feedbackId (\S+)\n([\s\S]*?)(?=\n### Item |\s*$)/g;
  let m;
  while ((m = re.exec(input))) {
    const body = m[2];
    const sec = /<<<SECTION\n([\s\S]*?)\nSECTION>>>/.exec(body);
    const file = /, file ([^)]+)\)/.exec(body);
    const keys = [...body.matchAll(/^- (.+)$/gm)].map((x) => x[1]);
    items.push({ id: m[1], section: sec ? sec[1] : null, file: file ? file[1] : null, keys, allowed: (/Allowed: (.+)/.exec(body) || [])[1] || '' });
  }
  if (items[0]?.file) out({ type: 'assistant', message: { content: [{ type: 'text', text: '문서를 읽어 보겠습니다.' }, { type: 'tool_use', name: 'Read', input: { file_path: items[0].file } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: '1\t# …' }] } });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/etc/passwd' } }] } });
  out({ type: 'system', subtype: 'permission_denied', tool_name: 'Read', decision_reason: '--restricted: path outside the working directory' });
  if (mode === 'slow') await sleep(Number(process.env.FAKE_CLAUDE_SLOW_MS || 6000));
  if (mode === 'error') { out({ type: 'result', subtype: 'error', is_error: true, result: '사용량 한도에 닿았습니다' }); process.exit(1); }
  if (mode === 'garbage') { process.stdout.write('not json\n'); process.exit(0); }
  if (mode === 'none') process.exit(3);
  const act = mode === 'slow' ? process.env.FAKE_CLAUDE_AFTER || 'edit' : mode;
  const pick = (i) => (act === 'mixed' ? ['edit', 'propose', 'answer', 'ask', 'decline'][i % 5] : act);
  const res = items.map((it, i) => {
    // 고치기가 허용되지 않은 항목(제안 작업)에는 제안으로 답한다 — 진짜 Claude 처럼
    const a = pick(i) === 'edit' && !it.allowed.split(', ').includes('edit') ? 'propose' : pick(i);
    const base = it.section ?? (it.keys[0] ? `## ${it.keys[0].split(' › ').pop()}\n\n본문` : '');
    if (a === 'edit' || a === 'propose') {
      if (!it.section && !it.keys.length) return { feedbackId: it.id, action: 'answer', message: '문서 전체에 대한 답입니다.' };
      return { feedbackId: it.id, action: a, ...(it.section ? {} : { section: it.keys[0] }), text: base.replace(/\n*$/, '') + `\n\n(${a === 'edit' ? '고침' : '제안'}) 한 줄 추가\n`, message: a === 'edit' ? '한 줄을 덧붙였습니다.' : '이렇게 바꾸면 어떨까요?' };
    }
    if (a === 'bad-text') return { feedbackId: it.id, action: 'edit', text: '머리줄 없는 글', message: '고쳤습니다' };
    return { feedbackId: it.id, action: a, message: a === 'answer' ? '답: 그대로 두면 됩니다.' : a === 'ask' ? '어느 수치를 말씀하시는지요?' : '이번 범위가 아니라 두겠습니다.' };
  });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: {} }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: '', duration_ms: 1234, num_turns: 3, total_cost_usd: 0.01, usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 50 }, modelUsage: { 'fake-model': {} }, structured_output: { items: res, summary: `${res.length}건 처리` } });
  if (process.env.FAKE_CLAUDE_ROOT_SEEN) writeFileSync(process.env.FAKE_CLAUDE_ROOT_SEEN, String(root));
  process.exit(0);
}

const mode = process.env.FAKE_CLAUDE_MODE || '';
const m2 = /--- SECTION START ---\n([\s\S]*)\n--- SECTION END ---/.exec(input);
const section = m2 ? m2[1] : '';
if (mode === 'slow') await sleep(5000);
if (mode === 'garbage') { process.stdout.write('not json'); process.exit(0); }
if (mode === 'error') { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: '사용량 한도' })); process.exit(1); }
const after = mode === 'drop-heading' ? '머리줄 없음' : section.replace(/\n*$/, '') + '\n\n(제안) 한 줄 추가\n';
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { after, rationale: '한 줄을 덧붙였습니다' } }));
