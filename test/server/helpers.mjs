// 테스트 도우미 — 예제 작업 폴더를 임시 폴더에 복사해 쓴다 (원본은 건드리지 않는다)
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sample = path.join(repo, 'examples/sample-workspace');
export const fakeClaude = path.join(repo, 'test/fixtures/fake-claude.mjs');

export async function tempWorkspace(patchConfig) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docbench-'));
  await fs.cp(sample, dir, { recursive: true, filter: (src) => !/[\\/]\.docbench[\\/](blobs|inbox|viewstate|state\.json|changes\.jsonl|\.gitignore)/.test(src) });
  if (patchConfig) {
    const f = path.join(dir, '.docbench/config.json');
    const c = JSON.parse(await fs.readFile(f, 'utf8'));
    await fs.writeFile(f, JSON.stringify(patchConfig(c), null, 2));
  }
  return dir;
}
export const rm = (d) => fs.rm(d, { recursive: true, force: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 4000, step = 50) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await sleep(step); }
}
