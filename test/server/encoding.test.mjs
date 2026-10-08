// 인코딩·줄바꿈 보존 — Windows 현업 파일 모양들
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { Workspace } from '../../server/workspace.mjs';
import { decode, encode, restoreEol } from '../../server/textio.mjs';
import { tempWorkspace, rm } from './helpers.mjs';

async function wsWith(t, files) {
  const dir = await tempWorkspace(); t.after(() => rm(dir));
  for (const [name, buf] of Object.entries(files)) await fs.writeFile(path.join(dir, name), buf);
  return { dir, ws: await new Workspace(dir).init() };
}
const editSection = async (ws, id, key, fn) => {
  const d = await ws.readDoc(id);
  const core = await import('../../server/core.mjs').then((m) => m.core);
  const cur = core.getSectionText(d.md, key);
  return ws.writeDoc(id, core.replaceSection(d.md, key, fn(cur)), { baseVersion: d.version });
};

test('CP949 확장 음절(똠·햏·뷁)이 다른 섹션 저장 뒤에도 그대로', async (t) => {
  const src = iconv.encode('# 메뉴\r\n\r\n## 국\r\n\r\n똠양꿍 햏 뷁 샾 갂\r\n\r\n## 밥\r\n\r\n비빔밥\r\n', 'cp949');
  const { dir, ws } = await wsWith(t, { 'cp.md': src });
  const d = await ws.readDoc('cp.md');
  assert.equal(d.encoding, 'euc-kr');
  assert.ok(!d.readOnly, '되돌림이 정확하면 저장 가능');
  assert.ok(d.md.includes('똠양꿍 햏 뷁 샾 갂'));
  await editSection(ws, 'cp.md', '메뉴 › 밥', (s) => s.replace('비빔밥', '김밥'));
  const after = await fs.readFile(path.join(dir, 'cp.md'));
  assert.equal(iconv.decode(after, 'cp949'), '# 메뉴\r\n\r\n## 국\r\n\r\n똠양꿍 햏 뷁 샾 갂\r\n\r\n## 밥\r\n\r\n김밥\r\n');
});

test('CP949 로 못 쓰는 글자(— ✅)는 조용히 ? 가 되지 않고 저장을 막는다, UTF-8 변환은 된다', async (t) => {
  const { dir, ws } = await wsWith(t, { 'cp.md': iconv.encode('# 가\r\n\r\n본문\r\n', 'cp949') });
  const d = await ws.readDoc('cp.md');
  await assert.rejects(ws.writeDoc('cp.md', d.md + '— ✅\n', { baseVersion: d.version }), (e) => e.code === 'READ_ONLY' && e.reason === 'unrepresentable');
  await ws.writeDoc('cp.md', d.md + '— ✅\n', { baseVersion: d.version, convertTo: 'utf-8' });
  assert.equal((await fs.readFile(path.join(dir, 'cp.md'), 'utf8')), '# 가\r\n\r\n본문\r\n— ✅\r\n');
});

test('UTF-16LE(BOM) 문서 읽기·쓰기 (PowerShell 5.1 기본)', async (t) => {
  const src = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# 로그\r\n\r\n한 줄\r\n', 'utf16le')]);
  const { dir, ws } = await wsWith(t, { 'u16.md': src });
  const d = await ws.readDoc('u16.md');
  assert.equal(d.encoding, 'utf-16le');
  assert.equal(d.md, '# 로그\n\n한 줄\n');
  await ws.writeDoc('u16.md', d.md + '두 줄\n', { baseVersion: d.version });
  const after = await fs.readFile(path.join(dir, 'u16.md'));
  assert.deepEqual([...after.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(after.subarray(2).toString('utf16le'), '# 로그\r\n\r\n한 줄\r\n두 줄\r\n');
});

test('깨진 바이트가 섞인 UTF-8 은 보여 주되 저장은 막는다', async (t) => {
  const src = Buffer.concat([Buffer.from('# 제목\n\n한글 본문입니다 가나다라\n', 'utf8'), Buffer.from([0xff]), Buffer.from('\n끝\n', 'utf8')]);
  const { ws } = await wsWith(t, { 'bad.md': src });
  const d = await ws.readDoc('bad.md');
  assert.equal(d.encoding, 'utf-8');
  assert.equal(d.readOnly, true);
  assert.equal(d.readOnlyReason, 'invalid-utf8');
  assert.ok(d.md.includes('한글 본문입니다'));
  await assert.rejects(ws.writeDoc('bad.md', d.md, { baseVersion: d.version }), { code: 'READ_ONLY' });
});

test('줄바꿈이 섞인 파일: 손대지 않은 줄은 원래 줄바꿈 그대로', async (t) => {
  const raw = '# T\r\n\r\n## A\r\n\r\na\r\n\n## B\n\nb\n';
  const { dir, ws } = await wsWith(t, { 'mix.md': Buffer.from(raw) });
  await editSection(ws, 'mix.md', 'T › B', (s) => s.replace('b', 'bb'));
  assert.equal(await fs.readFile(path.join(dir, 'mix.md'), 'utf8'), '# T\r\n\r\n## A\r\n\r\na\r\n\n## B\n\nbb\n');
  assert.equal(restoreEol('x\ny\n', 'x\r\ny\r\n', 'crlf'), 'x\r\ny\r\n');
  assert.equal(restoreEol('x\nz\ny\n', 'x\r\ny\r\n', 'crlf'), 'x\r\nz\r\ny\r\n');
});

test('decode/encode 왕복: UTF-8 BOM·LF·끝 줄바꿈 없음', async () => {
  for (const b of [Buffer.from('﻿# a\r\nb', 'utf8'), Buffer.from('# a\nb', 'utf8'), Buffer.from('')]) {
    const d = decode(b);
    assert.ok(d.writable);
    assert.deepEqual(await encode(d.text, d), b);
  }
});

test('8 KB 넘는 UTF-8 문서 제목이 깨지지 않는다', async (t) => {
  const big = '# 운영 런북 제목\n\n' + '가'.repeat(5000) + '\n';
  for (let cut = 0; cut < 3; cut++) {
    const { ws } = await wsWith(t, { [`big${cut}.md`]: Buffer.from('x'.repeat(cut) + '\n' + big, 'utf8') });
    const m = await ws.manifest();
    assert.match(m.docs[`big${cut}.md`].title, /운영 런북 제목/);
  }
});
