// node --test 에 폴더를 넘기는 대신 파일을 골라 넘긴다 (Windows cmd 는 * 를 펼치지 않는다)
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(3), ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
