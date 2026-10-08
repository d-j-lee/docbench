// iconv-lite 가 없는 환경: EUC-KR 은 읽기 전용, 사람이 동의하면 UTF-8 로 바꿔 저장
process.env.DOCBENCH_NO_ICONV = '1';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { Workspace } = await import('../../server/workspace.mjs');
const { tempWorkspace, rm } = await import('./helpers.mjs');

test('iconv 없으면 EUC-KR 은 읽기 전용, UTF-8 변환 저장은 가능', async (t) => {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  const ws = await new Workspace(dir).init();
  const d = await ws.readDoc('notes/옛-회의록.md');
  assert.equal(d.readOnly, true);
  assert.equal(d.readOnlyReason, 'encoding');
  assert.ok(d.md.includes('옛 회의록'));
  await assert.rejects(ws.writeDoc(d.id, d.md + 'x\n', { baseVersion: d.version }), { code: 'READ_ONLY' });
  await ws.writeDoc(d.id, d.md, { baseVersion: d.version, convertTo: 'utf-8' });
  assert.equal((await ws.readDoc(d.id)).encoding, 'utf-8');
});
