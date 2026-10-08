import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, encode, hashBytes } from '../../server/textio.mjs';

const roundtrip = async (buf) => { const d = decode(buf); return encode(d.text, d); };

test('UTF-8 LF 왕복', async () => {
  const b = Buffer.from('# 제목\n\n본문\n', 'utf8');
  assert.deepEqual(await roundtrip(b), b);
});
test('UTF-8 BOM + CRLF 왕복, 화면 글은 LF', async () => {
  const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# 제목\r\n\r\n본문\r\n', 'utf8')]);
  const d = decode(b);
  assert.equal(d.bom, true); assert.equal(d.eol, 'crlf'); assert.equal(d.text, '# 제목\n\n본문\n');
  assert.deepEqual(await roundtrip(b), b);
});
test('EUC-KR(CP949) 감지·왕복', async () => {
  const iconv = (await import('iconv-lite')).default;
  const b = iconv.encode('# 회의록\r\n\r\n결정: 메일로만\r\n', 'cp949');
  const d = decode(b);
  assert.equal(d.encoding, 'euc-kr'); assert.equal(d.text, '# 회의록\n\n결정: 메일로만\n');
  assert.deepEqual(await roundtrip(b), b);
});
test('UTF-8 로 바꿔 저장하면 BOM 없이 UTF-8', async () => {
  const iconv = (await import('iconv-lite')).default;
  const d = decode(iconv.encode('# 가\r\n', 'cp949'));
  const out = await encode(d.text, d, 'utf-8');
  assert.equal(out.toString('utf8'), '# 가\r\n');
});
test('판 번호는 바이트 해시 16자', () => {
  assert.match(hashBytes(Buffer.from('x')), /^[0-9a-f]{16}$/);
  assert.notEqual(hashBytes(Buffer.from('a\n')), hashBytes(Buffer.from('a\r\n')));
});
