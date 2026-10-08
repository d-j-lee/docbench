// 테스트 도우미 — 예제 작업 폴더를 임시 폴더에 복사해 쓴다 (원본은 건드리지 않는다)
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sample = path.join(repo, 'examples/sample-workspace');
export const fakeClaude = path.join(repo, 'test/fixtures/fake-claude.mjs');

/** 이 작업 폴더용 PC 설정 파일(문서 폴더 밖) — 시험마다 따로 @param {string} dir */
export const pcFileFor = (dir) => dir + '.pc.json';

/** @param {(c: any) => any} [patchConfig] 문서 폴더 config.json 고치기 @param {any} [pc] 이 PC 의 설정(실행 명령·이름) — pcFileFor(dir) 에 */
export async function tempWorkspace(patchConfig, pc) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docbench-'));
  await fs.cp(sample, dir, { recursive: true, filter: (src) => !/[\\/]\.docbench[\\/](blobs|inbox|viewstate|state\.json|changes\.jsonl|\.gitignore)/.test(src) });
  if (patchConfig) {
    const f = path.join(dir, '.docbench/config.json');
    const c = JSON.parse(await fs.readFile(f, 'utf8'));
    await fs.writeFile(f, JSON.stringify(patchConfig(c), null, 2));
  }
  if (pc) await fs.writeFile(pcFileFor(dir), JSON.stringify({ workspaces: { [dir]: pc } }, null, 2));
  return dir;
}
export const rm = async (d) => { await fs.rm(d, { recursive: true, force: true }); await fs.rm(pcFileFor(d), { force: true }); };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 4000, step = 50) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await sleep(step); }
}
