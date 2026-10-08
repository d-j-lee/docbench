#!/usr/bin/env node
// 테스트용 가짜 `claude -p`. 표준입력의 섹션을 받아 "(제안)" 한 줄을 덧붙인 결과를 Claude Code 와 같은 JSON 모양으로 낸다.
// FAKE_CLAUDE_MODE=error | garbage | drop-heading | slow 로 실패 경로를 흉내 낸다.
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = Buffer.concat(chunks).toString('utf8');
const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE || '';
if (!args.includes('-p') || !args.includes('--json-schema') || !args.includes('--tools')) { process.stderr.write('bad args ' + JSON.stringify(args)); process.exit(2); }
const m = /--- SECTION START ---\n([\s\S]*)\n--- SECTION END ---/.exec(input);
const section = m ? m[1] : '';
if (mode === 'slow') await new Promise((r) => setTimeout(r, 5000));
if (mode === 'garbage') { process.stdout.write('not json'); process.exit(0); }
if (mode === 'error') { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: '사용량 한도' })); process.exit(1); }
const after = mode === 'drop-heading' ? '머리줄 없음' : section.replace(/\n*$/, '') + '\n\n(제안) 한 줄 추가\n';
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { after, rationale: '한 줄을 덧붙였습니다' } }));
