import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../../server/index.mjs';
import { tempWorkspace, rm, until, fakeClaude, pcFileFor } from './helpers.mjs';

async function boot(t, opts = {}, patch, pc) {
  const dir = await tempWorkspace(patch, pc);
  const s = await startServer({ root: dir, port: 0, pcConfigFile: pcFileFor(dir), ...opts });
  t.after(async () => { await s.close(); await rm(dir); });
  const base = `http://127.0.0.1:${s.port}`;
  const api = async (method, p, body, headers = {}) => {
    const r = await fetch(base + '/api' + p, { method, headers: { ...(method !== 'GET' ? { 'X-DocBench': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, data: text ? JSON.parse(text) : null, headers: r.headers };
  };
  return { dir, s, base, api };
}
const q = (id) => encodeURIComponent(id);

test('세션·매니페스트·문서·UI 정적 파일', async (t) => {
  const { api, base } = await boot(t);
  const ses = await api('GET', '/session');
  assert.equal(ses.status, 200);
  assert.ok(ses.data.permissions.includes('doc.edit'));
  assert.equal(ses.data.assistant, null);
  assert.equal((await api('GET', '/manifest')).data.schema, 2);
  const d = await api('GET', '/doc?id=' + q('notes/옛-회의록.md'));
  assert.equal(d.data.encoding, 'euc-kr');
  const ui = await fetch(base + '/');
  assert.equal(ui.status, 200);
  assert.match(ui.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await ui.text(), /data-api="\/api"/);
  assert.equal((await fetch(base + '/assets/docbench.iife.js')).status, 200);
  assert.equal((await fetch(base + '/assets/../../package.json')).status, 404);
});

test('보안: Host 검사·CSRF 헤더·토큰', async (t) => {
  const { api, s } = await boot(t, { token: 'sekret' });
  assert.equal((await api('GET', '/session')).status, 401);
  assert.equal((await api('GET', '/session', null, { Authorization: 'Bearer sekret' })).status, 200);
  assert.equal((await api('GET', '/session?token=sekret')).status, 200);
  const put = await fetch(`http://127.0.0.1:${s.port}/api/doc?id=README.md`, { method: 'PUT', headers: { Authorization: 'Bearer sekret', 'Content-Type': 'application/json' }, body: '{"md":"x"}' });
  assert.equal(put.status, 403, 'X-DocBench 없는 쓰기 거부');
  const host = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: s.port, path: '/api/session', headers: { Host: 'evil.example', Authorization: 'Bearer sekret' } }, (r) => { r.resume(); resolve(r.statusCode); });
  });
  assert.equal(host, 403, '낯선 Host 거부 (DNS rebinding)');
  assert.equal((await api('GET', '/doc?id=' + q('../../etc/passwd'), null, { Authorization: 'Bearer sekret' })).status, 400);
});

test('문서 저장: 409 충돌 본문, 422 읽기 전용, 이벤트', async (t) => {
  const { api } = await boot(t, {}, (c) => ({ ...c, docs: { ...c.docs } }));
  const id = 'docs/운영-런북.md';
  const d = (await api('GET', '/doc?id=' + q(id))).data;
  const ok = await api('PUT', '/doc?id=' + q(id), { md: d.md + '\n끝\n', baseVersion: d.version, summary: 's' });
  assert.equal(ok.status, 200);
  const stale = await api('PUT', '/doc?id=' + q(id), { md: d.md, baseVersion: d.version });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.current.version, ok.data.version);
  assert.ok(stale.data.current.md.endsWith('끝\n'));
  const ch = await api('GET', '/changes');
  assert.equal(ch.data.items.at(-1).summary, 's');
});

test('읽기 전용 작업 폴더면 422', async (t) => {
  const { api } = await boot(t, {}, (c) => ({ ...c, readOnly: true }));
  const d = (await api('GET', '/doc?id=README.md')).data;
  const r = await api('PUT', '/doc?id=README.md', { md: 'x', baseVersion: d.version });
  assert.equal(r.status, 422);
  assert.equal(r.data.reason, 'config');
  assert.ok(!(await api('GET', '/session')).data.permissions.includes('doc.edit'));
});

test('피드백 REST 와 판 충돌', async (t) => {
  const { api } = await boot(t);
  const c = await api('POST', '/feedback', { docId: 'README.md', target: { kind: 'doc' }, body: '안내 보강' });
  assert.equal(c.status, 201);
  const u = await api('PATCH', '/feedback/' + c.data.id, { patch: { status: 'resolved' }, version: 1 });
  assert.equal(u.data.version, 2);
  const stale = await api('PATCH', '/feedback/' + c.data.id, { patch: { status: 'open' }, version: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.current.status, 'resolved');
  assert.equal((await api('GET', '/feedback')).data.items.length, 1);
  // null = 그 값을 지운다(★ 끄기·바꿀 글 지우기) — JSON 에서 undefined 는 사라져 지울 수 없다
  const s1 = await api('PATCH', '/feedback/' + c.data.id, { patch: { severity: 'high', suggestion: '새 글' }, version: 2 });
  assert.deepEqual([s1.data.severity, s1.data.suggestion], ['high', '새 글']);
  const s2 = await api('PATCH', '/feedback/' + c.data.id, { patch: { severity: null, suggestion: null }, version: 3 });
  assert.equal(s2.status, 200);
  assert.deepEqual([s2.data.severity, s2.data.suggestion, s2.data.body], [undefined, undefined, '안내 보강']);
  assert.equal((await api('DELETE', '/feedback/' + c.data.id)).status, 204);
});

test('실시간: 파일을 직접 고치면 SSE 로 doc·changes 이벤트', async (t) => {
  const { base, dir } = await boot(t);
  const events = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  const res = await fetch(base + '/api/events', { signal: ac.signal });
  (async () => { try { for await (const chunk of res.body) events.push(Buffer.from(chunk).toString('utf8')); } catch { /* 끊김 */ } })();
  await new Promise((r) => setTimeout(r, 150));
  // 안 연 문서: 알리기만(이력 없음)
  await fs.appendFile(path.join(dir, 'README.md'), '\n외부 편집.\n');
  await until(() => events.join('').includes('event: doc\ndata: {"type":"doc","id":"README.md"}'), 5000);
  // 연 문서: 외부 편집으로 기록하고 doc·changes
  await fetch(base + '/api/doc?id=' + q('docs/설계-노트.md'));
  await fs.appendFile(path.join(dir, 'docs/설계-노트.md'), '\n## 부록\n\n외부 편집.\n');
  await until(() => events.join('').includes('설계-노트.md') && events.join('').includes('event: changes'), 5000);
  const ch = await (await fetch(base + '/api/changes')).json();
  assert.deepEqual(ch.items.filter((c) => c.by?.kind === 'external').map((c) => c.docId), ['docs/설계-노트.md']);
  await fs.writeFile(path.join(dir, '.docbench/feedback/fb-x.json'), JSON.stringify({ docId: 'README.md', body: 'cli', target: { kind: 'doc' } }));
  await until(() => events.join('').includes('event: feedback'), 5000);
});

test('알림: 요청함 파일', async (t) => {
  const { api, dir } = await boot(t);
  const r = await api('POST', '/notify', { count: 2, docs: ['README.md'], feedbackIds: ['a', 'b'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.delivered, false);
  const inbox = await fs.readdir(path.join(dir, '.docbench/inbox'));
  assert.equal(inbox.length, 1);
});

test('AI 제안: 헤드리스 claude 호출 (가짜 실행 파일)', async (t) => {
  const { api } = await boot(t, {}, null, { assistant: { command: [process.execPath, fakeClaude], timeoutSec: 20 } });
  assert.ok((await api('GET', '/session')).data.permissions.includes('assistant.propose'));
  const f = (await api('POST', '/feedback', { docId: 'docs/설계-노트.md', target: { kind: 'section', path: ['알림 서비스 설계 노트', '구조', '메모'], heading: '메모' }, body: '근거 보강' })).data;
  const r = await api('POST', '/assistant/propose', { feedbackId: f.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.after.startsWith('### 메모\n'));
  assert.ok(r.data.after.includes('(제안) 한 줄 추가'));
  assert.equal(r.data.rationale, '한 줄을 덧붙였습니다');
  const docOnly = (await api('POST', '/feedback', { docId: 'README.md', target: { kind: 'doc' }, body: 'x' })).data;
  assert.equal((await api('POST', '/assistant/propose', { feedbackId: docOnly.id })).status, 400);
});

test('AI 제안 실패: 응답 깨짐·머리줄 누락은 500 과 이유', async (t) => {
  for (const mode of ['garbage', 'drop-heading', 'error']) {
    process.env.FAKE_CLAUDE_MODE = mode;
    try {
      const { api } = await boot(t, {}, null, { assistant: { command: [process.execPath, fakeClaude], timeoutSec: 20 } });
      const f = (await api('POST', '/feedback', { docId: 'docs/설계-노트.md', target: { kind: 'section', path: ['알림 서비스 설계 노트', '배경'], heading: '배경' }, body: 'x' })).data;
      const r = await api('POST', '/assistant/propose', { feedbackId: f.id });
      assert.ok(r.status >= 400, mode + ' ' + r.status);
      assert.ok(r.data.message, mode);
    } finally { delete process.env.FAKE_CLAUDE_MODE; }
  }
});

test('AI 제안: 6만 자 넘는 섹션은 잘라 보내지 않고 413', async (t) => {
  const { api, dir } = await boot(t, {}, null, { assistant: { command: [process.execPath, fakeClaude], timeoutSec: 20 } });
  await fs.writeFile(path.join(dir, 'docs/큰문서.md'), '# 큰 문서\n\n## 본문\n\n' + '가나다라마바사 '.repeat(9000) + '\n');
  await api('GET', '/manifest');
  const f = (await api('POST', '/feedback', { docId: 'docs/큰문서.md', target: { kind: 'section', path: ['큰 문서', '본문'], heading: '본문' }, body: '줄여 줘' })).data;
  const r = await api('POST', '/assistant/propose', { feedbackId: f.id });
  assert.equal(r.status, 413);
  assert.match(r.data.message, /하위 섹션/);
});

test('넘기기 명령을 못 찾으면 넘겼다고 하지 않고 이유를 말한다', async (t) => {
  const { api, dir } = await boot(t, {}, null, { notify: { command: ['/없는/명령/claude-xyz'] } });
  const r = await api('POST', '/notify', { count: 1, docs: ['README.md'], feedbackIds: ['a'] });
  assert.equal(r.data.delivered, false);
  assert.match(r.data.message, /시작하지 못했습니다/);
  assert.equal((await fs.readdir(path.join(dir, '.docbench/inbox'))).filter((n) => n.endsWith('.json')).length, 1, '요청함에는 남는다');
});

test('실시간: CLI 가 쓴 이력 줄은 doc 이벤트, 반쯤 쓴 줄은 완성될 때, 서버 자신의 저장은 한 번만', async (t) => {
  const { api, dir, base } = await boot(t);
  const events = [];
  const ctl = new AbortController();
  t.after(() => ctl.abort());
  void fetch(base + '/api/events', { signal: ctl.signal }).then(async (r) => { for await (const c of r.body) events.push(...new TextDecoder().decode(c).split('\n\n').filter((x) => x.startsWith('event: doc'))); }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const file = path.join(dir, '.docbench/changes.jsonl');
  const line = JSON.stringify({ at: new Date().toISOString(), docId: 'README.md', toVersion: 'aaaaaaaaaaaaaaaa' }) + '\n';
  await fs.appendFile(file, line.slice(0, 20));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(events.filter((e) => e.includes('README.md')).length, 0, '반쯤 쓴 줄은 아직');
  await fs.appendFile(file, line.slice(20));
  await until(() => events.some((e) => e.includes('README.md')), 4000);
  // 서버 자신의 저장: PUT 뒤 handler 가 한 번 알리고, 이력 감시는 다시 알리지 않는다
  events.length = 0;
  const d = (await api('GET', '/doc?id=' + q('docs/설계-노트.md'))).data;
  assert.equal((await api('PUT', '/doc?id=' + q('docs/설계-노트.md'), { md: d.md + '\n추가\n', baseVersion: d.version })).status, 200);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(events.filter((e) => e.includes('설계-노트')).length, 1, events.join('|'));
});
