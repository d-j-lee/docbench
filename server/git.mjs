// @ts-check
/** git 이 있으면 쓰고, 없으면 조용히 빠진다 (Windows PATH 에 git 이 없는 경우 포함) */
import { execFile } from 'node:child_process';

/** @param {string} cwd @param {string[]} args @param {number} [timeout] @returns {Promise<Buffer | null>} */
function git(cwd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'buffer', timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, out) => resolve(err ? null : out));
  });
}

/** 지금 커밋(HEAD) id — 없으면(커밋 전) null @param {string} root */
export async function gitHead(root) {
  const out = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  return out ? out.toString().trim() || null : null;
}

/**
 * 파일마다 마지막 커밋 시각(ms) — 작업 폴더 기준 상대 경로. 막 받은(clone) 저장소는 파일 시각이 받은 때라
 * 오래됨·검토 주기를 이것으로 잰다(D90). 얕게 받은 저장소(CI 기본)는 이력이 없어 shallow — 부른 쪽이 알린다.
 * 실패·시간 초과면 null
 * @param {string} root @param {string} prefix @param {{ timeout?: number }} [o]
 * @returns {Promise<{ times: Map<string, number>, shallow: boolean } | null>}
 */
export async function gitLastChange(root, prefix, o = {}) {
  const sh = await git(root, ['rev-parse', '--is-shallow-repository']);
  const shallow = !!sh && sh.toString().trim() === 'true';
  // 새것부터 — 파일마다 처음 보이는 커밋이 마지막 변경. 이름은 NUL 로(공백·한글 그대로)
  const out = await git(root, ['-c', 'core.quotepath=off', 'log', '--format=%x01%ct', '--name-only', '-z', '--no-renames', '--', '.'], o.timeout ?? 4000);
  if (!out) return null;
  /** @type {Map<string, number>} */
  const times = new Map();
  let at = 0;
  for (const part of out.toString('utf8').split('\0')) {
    let s = part;
    // 커밋 머리(\x01시각)는 앞 커밋의 마지막 이름 뒤 줄바꿈과 붙어 온다
    const head = s.indexOf('\x01');
    if (head >= 0) { at = Number(s.slice(head + 1).split('\n')[0]) * 1000; s = s.slice(head + 1).split('\n').slice(1).join('\n'); }
    s = s.replace(/^\n+/, '');
    if (!s || !at) continue;
    let file = s;
    if (prefix) { if (!file.startsWith(prefix)) continue; file = file.slice(prefix.length); }
    if (!times.has(file)) times.set(file, at);
  }
  return { times, shallow };
}

/** @param {string} root */
export async function gitInfo(root) {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside || inside.toString().trim() !== 'true') return null;
  const prefix = ((await git(root, ['rev-parse', '--show-prefix'])) || Buffer.from('')).toString().trim();
  return { prefix };
}

/** HEAD 판 바이트. 없으면 null @param {string} root @param {string} prefix @param {string} rel */
export async function gitShowHead(root, prefix, rel) {
  return git(root, ['show', `HEAD:${prefix}${rel}`]);
}

/** 작업 폴더 기준 상대 경로 → 상태 ('modified' | 'untracked' | 'added' ...) @param {string} root @param {string} prefix */
export async function gitStatus(root, prefix) {
  const out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!out) return map;
  const parts = out.toString('utf8').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const xy = p.slice(0, 2);
    let file = p.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // 원래 이름 건너뜀
    if (prefix && file.startsWith(prefix)) file = file.slice(prefix.length);
    map.set(file, xy === '??' ? 'untracked' : xy.includes('A') ? 'added' : 'modified');
  }
  return map;
}
