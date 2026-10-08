// 대시보드 탭 예 (PORTING §2): 백엔드 언어와 상관없이 DocBench 앱을 대시보드 탭에 끼운다.
// 백엔드가 하는 일은 둘뿐이다 — 이 PC 의 설정 폴더에서 앱 주소(app.json)와 열쇠(app-token)를 읽어 페이지에 넣는다.
// 나머지는 페이지(index.html)가 host.js 의 DocBenchHost.mount(…) 로 한다. 의존성 없음(Node 20+).
//
//   node examples/dashboard-tab/server.mjs <문서 폴더> [<문서 폴더> …] [--port 5190]
//
// 먼저(한 번): docbench app --detach · docbench app --allow-origin http://127.0.0.1:5190
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELP = `대시보드 탭 예 — DocBench 앱을 탭에 끼운다 (PORTING §2)

  node examples/dashboard-tab/server.mjs <문서 폴더> [<문서 폴더> …] [--port 5190]

  폴더 하나가 탭 하나다. 먼저 한 번:
    docbench app --detach                                  DocBench 앱 켜기
    docbench app --allow-origin http://127.0.0.1:<포트>    이 대시보드 출처 허용
  열쇠·주소는 이 PC 의 설정 폴더(DOCBENCH_HOME 으로 옮김)의 app-token·app.json 에서 읽는다.`;

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
let port = 5190;
const roots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i]);
  else roots.push(path.resolve(args[i]));
}
if (!roots.length) { console.error(HELP); process.exit(1); }
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('--port 는 0–65535'); process.exit(1); }
for (const r of roots) if (!(await fs.stat(r).catch(() => null))?.isDirectory()) { console.error('폴더가 없습니다: ' + r); process.exit(1); }

/** 이 PC 의 DocBench 설정 폴더 — CLI·앱과 같은 규칙 (server/workspace.mjs defaultPcConfigFile) */
function pcDir() {
  if (process.env.DOCBENCH_HOME) return process.env.DOCBENCH_HOME;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'docbench');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'docbench');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'docbench');
}

/** 앱 주소·열쇠를 읽고, 앱이 정말 답하는지·이 출처를 허용했는지 본다 (페이지를 그릴 때마다 — 앱 포트가 바뀌어도 따라가게) */
async function appState(origin) {
  const dir = pcDir();
  const rec = JSON.parse(await fs.readFile(path.join(dir, 'app.json'), 'utf8').catch(() => 'null'));
  const key = (await fs.readFile(path.join(dir, 'app-token'), 'utf8').catch(() => '')).trim();
  if (!rec?.url || !key) return { problem: 'DocBench 앱이 꺼져 있습니다 — docbench app --detach' };
  try {
    const r = await fetch(rec.url + 'api/app/info', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(2000) });
    if (r.status === 401) return { problem: '앱 열쇠가 맞지 않습니다 — 앱과 이 서버가 같은 설정 폴더(DOCBENCH_HOME)를 보는지 확인하세요' };
    const info = await r.json();
    if (!info.allowOrigins?.includes(origin)) return { problem: `이 대시보드 출처가 허용되지 않았습니다 — docbench app --allow-origin ${origin}` };
    return { app: rec.url, key, version: info.version };
  } catch {
    return { problem: `DocBench 앱이 답하지 않습니다(${rec.url}) — docbench app --status` };
  }
}

const server = http.createServer(async (req, res) => {
  // 이 페이지에는 앱 열쇠가 실린다 — 이 PC 의 브라우저가 이 주소로 열 때만 내준다(Host 검사: DNS rebinding 막기)
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { res.writeHead(403).end(); return; }
  if (new URL(req.url || '/', 'http://x').pathname !== '/') { res.writeHead(404).end(); return; }
  const cfg = { ...(await appState('http://' + host)), tabs: roots.map((root) => ({ name: path.basename(root) || root, root })) };
  // JSON 을 <script type="application/json"> 에 넣는다 — '<' 를 바꿔 </script> 로 빠져나가지 못하게
  const html = (await fs.readFile(path.join(here, 'index.html'), 'utf8')).replace('"%DOCBENCH_CONFIG%"', JSON.stringify(cfg).replace(/</g, '\\u003c'));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',                          // 열쇠가 든 페이지를 캐시에 남기지 않는다
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "frame-ancestors 'none'",  // 이 페이지 자체는 남이 끼우지 못하게
  }).end(html);
});
server.listen(port, '127.0.0.1', () => {
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  console.log(`대시보드 탭 예: http://127.0.0.1:${addr.port}/  (탭 ${roots.length}개 · DocBench 설정 폴더 ${pcDir()})`);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop); process.on('SIGTERM', stop);
