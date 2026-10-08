// node --test 에 폴더를 넘기는 대신 파일을 골라 넘긴다 (Windows cmd 는 * 를 펼치지 않는다)
import { readdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
// 시험은 개발자 PC 의 실제 PC 설정을 읽지 않는다 — 빈 임시 폴더를 DOCBENCH_HOME 으로
const home = mkdtempSync(path.join(os.tmpdir(), 'docbench-home-'));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(3), ...files], { stdio: 'inherit', env: { ...process.env, DOCBENCH_HOME: home } });
process.exit(r.status ?? 1);
