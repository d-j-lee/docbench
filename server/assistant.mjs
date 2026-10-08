// @ts-check
/**
 * AI 수정 제안(한 섹션) — 로컬 Claude Code 를 헤드리스로 부른다 (구독 로그인 그대로, API 키 불필요).
 *
 *   claude -p --restricted --safe-mode --output-format json --json-schema <스키마> --tools "" --strict-mcp-config --no-session-persistence
 *
 * 프롬프트는 표준입력으로 넘기고, 결과는 JSON 의 structured_output 에서 읽는다 (docs: code.claude.com/docs/en/headless).
 * --bare 는 쓰지 않는다: bare 모드는 구독 로그인을 읽지 않고 ANTHROPIC_API_KEY 를 요구한다.
 * 도구를 모두 끄므로 이 호출은 파일을 읽거나 고치지 못한다 — 받은 섹션만 보고 제안문을 돌려준다.
 * 실행 위치는 문서 폴더 밖(cfg.cwd = 이 PC 의 설정 폴더 아래 work/)이고 --restricted·--safe-mode 로 설정 파일·훅·CLAUDE.md 를 읽지 않는다 —
 * 문서 폴더 안에서 띄우면 그 폴더의 .claude/settings.json 훅이 실행됐다(실측, server/runs.mjs 머리 주석).
 * 화면은 이제 대개 Claude 작업(server/runs.mjs)으로 제안한다. 이 길은 REST 계약(POST /assistant/propose)을 위해 남긴다.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { core } from './core.mjs';
import { probeClaude, resolveClaudeCommand } from './runs.mjs';

/**
 * command 는 문자열(실행 파일) 또는 배열(앞부분 고정 인자 포함). Windows 예:
 *   "C:/Users/me/.local/bin/claude.exe"   또는   ["node", "C:/…/@anthropic-ai/claude-code/cli.js"]
 * @param {{ command?: string | string[], args?: string[], model?: string, timeoutSec?: number, cwd: string }} cfg
 * @param {any} req ProposeRequest
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ after: string, rationale?: string }>}
 */
export function proposeWithClaudeCli(cfg, req, signal) {
  const prompt = core.buildProposePrompt(req);
  const args = [
    '-p', 'Follow the instructions in the input exactly and reply with the JSON object only.',
    '--restricted', '--safe-mode',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(core.PROPOSAL_SCHEMA),
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    ...(cfg.model ? ['--model', cfg.model] : []),
    ...(cfg.args || []),
  ];
  const cmd = resolveClaudeCommand(cfg.command);
  return probeClaude(cmd, false, cfg.cwd).then((probe) => new Promise((resolve, reject) => {
    if (!probe.ok) { reject(new Error(probe.problem || 'claude 를 쓸 수 없습니다')); return; }
    let child;
    try {
      child = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd: cfg.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { reject(hint(e)); return; }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`시간 초과 (${cfg.timeoutSec || 180}s)`)); }, (cfg.timeoutSec || 180) * 1000);
    const onAbort = () => { child.kill(); reject(new Error('취소됨')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(hint(e)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      let data;
      try { data = JSON.parse(out); } catch { reject(new Error(`claude 응답을 읽지 못했습니다 (exit ${code}): ${(err || out).slice(0, 300)}`)); return; }
      if (data.is_error) { reject(new Error(String(data.result || 'claude 오류').slice(0, 300))); return; }
      let payload = data.structured_output;
      if (!payload && typeof data.result === 'string') { try { payload = JSON.parse(data.result.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* 아래에서 거부 */ } }
      try { resolve(core.checkProposal(req, payload)); } catch (e) { reject(e); }
    });
    child.stdin.end(prompt);
  }));
}

/** 헤드리스 claude 를 띄울 자리 — 문서 폴더 밖, 이 PC 의 설정 폴더 아래 (비어 있다) @param {{ pcConfigFile: string }} ws */
export async function claudeWorkDir(ws) {
  const dir = path.join(path.dirname(ws.pcConfigFile), 'work');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** @param {any} e */
function hint(e) {
  if (e && e.code === 'ENOENT') return new Error('claude 실행 파일을 찾지 못했습니다. 이 PC 의 설정(docbench status 가 위치를 알려 준다)의 assistant.command 에 claude.exe 전체 경로를 적으세요 (npm 설치본 claude.cmd 는 그 안에서 부르는 대상을 배열로).');
  return e instanceof Error ? e : new Error(String(e));
}
