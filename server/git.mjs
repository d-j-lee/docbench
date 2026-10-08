// @ts-check
/** git 이 있으면 쓰고, 없으면 조용히 빠진다 (Windows PATH 에 git 이 없는 경우 포함) */
import { execFile } from 'node:child_process';

/** @param {string} cwd @param {string[]} args @returns {Promise<Buffer | null>} */
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'buffer', timeout: 4000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, out) => resolve(err ? null : out));
  });
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
