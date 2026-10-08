// @ts-check
/** 서버 진입점 — 단독 실행(startServer)과 기존 서버에 끼우기(createDocBenchHandler) 둘 다 */
import http from 'node:http';
import { Workspace } from './workspace.mjs';
import { createDocBenchHandler } from './handler.mjs';

export { Workspace, createDocBenchHandler };
export { decode, encode, atomicWrite } from './textio.mjs';

/**
 * @param {{ root: string, port?: number, host?: string, token?: string, allowOrigins?: string[], allowHosts?: string[] }} o
 */
export async function startServer(o) {
  const ws = await new Workspace(o.root).init();
  await ws.reconcileAll();
  const handle = createDocBenchHandler(ws, { token: o.token, allowOrigins: o.allowOrigins, allowHosts: o.allowHosts });
  const server = http.createServer((req, res) => { if (!handle(req, res)) { res.writeHead(404).end(); } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(o.port ?? 4317, o.host || '127.0.0.1', () => resolve(undefined)); });
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    ws, server, port: addr.port,
    url: `http://${o.host && o.host !== '0.0.0.0' ? o.host : '127.0.0.1'}:${addr.port}/`,
    close: () => new Promise((r) => { handle.close(); server.close(() => r(undefined)); server.closeAllConnections?.(); }),
  };
}
