// 동시 쓰기: 같은 판에서 출발한 두 저장 중 하나만 이기고, 피드백 회신도 잃지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Workspace } from '../../server/workspace.mjs';
import { tempWorkspace, rm } from './helpers.mjs';

test('같은 baseVersion 두 저장 → 하나는 충돌', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const a = await new Workspace(dir).init();
  const b = await new Workspace(dir).init();           // 다른 프로세스(서버·CLI)를 흉내: 인스턴스 둘
  const d = await a.readDoc('docs/운영-런북.md');
  const rs = await Promise.allSettled([
    a.writeDoc(d.id, d.md + '\nA\n', { baseVersion: d.version }),
    b.writeDoc(d.id, d.md + '\nB\n', { baseVersion: d.version }),
  ]);
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(rs.filter((r) => r.status === 'rejected' && r.reason.code === 'CONFLICT').length, 1);
});

test('같은 판 피드백 회신 둘 → 하나는 충돌 (말없이 사라지지 않음)', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  const f = await ws.createFeedback({ docId: 'README.md', target: { kind: 'doc' }, body: 'x' });
  const msg = (text) => ({ thread: [...f.thread, { author: { kind: 'human' }, text, at: new Date().toISOString() }] });
  const rs = await Promise.allSettled([ws.updateFeedback(f.id, msg('하나'), 1), ws.updateFeedback(f.id, msg('둘'), 1)]);
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(rs.filter((r) => r.status === 'rejected' && r.reason.code === 'CONFLICT').length, 1);
});

test('대소문자만 다른 id 는 같은 문서로', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  const d = await ws.readDoc('DOCS/운영-런북.md');
  assert.equal(d.id, 'docs/운영-런북.md');
});

test('예전 판으로 되돌린 외부 편집도 기록된다', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  await ws.reconcileAll();
  const d = await ws.readDoc('README.md');
  await ws.writeDoc(d.id, d.md + '\n추가\n', { baseVersion: d.version });
  await fs.writeFile(path.join(dir, 'README.md'), d.md);     // 밖에서 원래대로 되돌림
  assert.equal(await ws.reconcile('README.md'), true);
  const last = (await ws.changes()).at(-1);
  assert.equal(last.by.kind, 'external');
  assert.equal(last.toVersion, d.version);
});
