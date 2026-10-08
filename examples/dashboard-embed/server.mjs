// 대시보드에 끼우기 예 (PORTING §3-C): 대시보드 백엔드(여기선 Node http) 한 프로세스에 DocBench API 를 끼운다.
//   node examples/dashboard-embed/server.mjs [작업 폴더] [포트]
import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Workspace, createDocBenchHandler } from '../../server/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, '../sample-workspace'));
const port = Number(process.argv[3] || 5180);

const ws = await new Workspace(root).init();
await ws.reconcileAll();
const docbench = createDocBenchHandler(ws, { base: '/docbench/api', ui: false });

const files = {
  '/': [path.join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/vendor/docbench.js': [path.join(here, '../../dist/docbench.js'), 'text/javascript; charset=utf-8'],
  '/vendor/docbench.css': [path.join(here, '../../dist/docbench.css'), 'text/css; charset=utf-8'],
};
const server = http.createServer(async (req, res) => {
  if (docbench(req, res)) return;                       // /docbench/api/* 는 DocBench 가 처리
  const f = files[new URL(req.url || '/', 'http://x').pathname];
  if (!f) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': f[1] }).end(await fs.readFile(f[0]));
});
server.listen(port, '127.0.0.1', () => console.log(`대시보드 예: http://127.0.0.1:${port}/  (문서 ${root})`));
const stop = () => { docbench.close(); server.close(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
