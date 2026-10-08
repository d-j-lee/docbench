// @vitest-environment node
// 바이트 ↔ 글 공통 규칙 (서버·브라우저가 같이 쓴다). CP949 역표는 실제 브라우저에서 따로 확인한다(e2e).
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { decodeBytes, encodeText, restoreEol, EncodingReadOnlyError, type LegacyCodec } from '../../src/core/textcodec';
import { sha256Hex } from '../../src/adapters/folder';
import { pcSettingsFor, mergeGitignore, mergeConfig } from '../../src/core/workspace';

const u8 = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'utf8')] : p)));
const cp949: LegacyCodec = {
  decode: (b) => iconv.decode(Buffer.from(b), 'cp949'),
  encode: (s) => { const o = iconv.encode(s, 'cp949'); return iconv.decode(o, 'cp949') === s ? new Uint8Array(o) : null; },
};
const round = (b: Uint8Array, legacy?: LegacyCodec) => { const d = decodeBytes(b, legacy); return encodeText(d.text, d, undefined, legacy); };

describe('decodeBytes / encodeText 왕복', () => {
  it('UTF-8 BOM + CRLF, 화면 글은 LF', () => {
    const b = u8([0xef, 0xbb, 0xbf], '# 제목\r\n\r\n본문\r\n');
    const d = decodeBytes(b);
    expect([d.bom, d.eol, d.text, d.writable]).toEqual([true, 'crlf', '# 제목\n\n본문\n', true]);
    expect(round(b)).toEqual(b);
  });
  it('BOM 이 두 번 있는 파일도 바이트 그대로 (디코더가 둘째 BOM 을 삼키지 않는다)', () => {
    const b = u8([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], '# 가\n');
    expect(round(b)).toEqual(b);
  });
  it('UTF-16LE(BOM) 왕복, 홀수 바이트는 읽기 전용', () => {
    const body = Buffer.from('# 메모\r\n본문\r\n', 'utf16le');
    const b = new Uint8Array([0xff, 0xfe, ...body]);
    expect(decodeBytes(b).encoding).toBe('utf-16le');
    expect(round(b)).toEqual(b);
    const odd = new Uint8Array([...b, 0x41]);
    expect(decodeBytes(odd).writable).toBe(false);
  });
  it('CP949 확장 음절 왕복, 못 쓰는 글자는 막는다', () => {
    const b = new Uint8Array(iconv.encode('# 메뉴\r\n\r\n똠양꿍 햏 뷁\r\n', 'cp949'));
    const d = decodeBytes(b, cp949);
    expect([d.encoding, d.writable]).toEqual(['euc-kr', true]);
    expect(round(b, cp949)).toEqual(b);
    expect(() => encodeText(d.text + '— ✅\n', d, undefined, cp949)).toThrowError(EncodingReadOnlyError);
    expect(new TextDecoder().decode(encodeText(d.text, d, 'utf-8', cp949))).toBe('# 메뉴\r\n\r\n똠양꿍 햏 뷁\r\n');
  });
  it('코덱이 없으면 CP949 는 읽기 전용(이유: encoding)', () => {
    const d = decodeBytes(new Uint8Array(iconv.encode('# 가\n', 'cp949')), null);
    expect([d.writable, d.readOnlyReason]).toEqual([false, 'encoding']);
    expect(() => encodeText(d.text, d)).toThrowError(EncodingReadOnlyError);
  });
  it('깨진 바이트가 섞인 UTF-8 은 읽기 전용, 정리 저장 때 원래 BOM 은 남긴다', () => {
    const b = u8([0xef, 0xbb, 0xbf], '# 한글 문서 본문입니다 ', [0xff], '\n');
    const d = decodeBytes(b);
    expect(d.readOnlyReason).toBe('invalid-utf8');
    const out = encodeText(d.text, d, 'utf-8');
    expect([...out.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
  it('섞인 줄바꿈: 손대지 않은 줄은 원래대로', () => {
    const raw = 'a\r\nb\nc\r\n';
    expect(restoreEol('a\nB\nc\n', raw, 'crlf')).toBe('a\r\nB\nc\r\n');
  });
  it('홀로 있는 \\r 도 손대지 않은 줄에서는 그대로 (독립 검토 재현)', () => {
    const b = u8('a\rb\n# T\n\nx\n');
    const d = decodeBytes(b);
    const out = new TextDecoder().decode(encodeText(d.text.replace('x\n', 'y\n'), d));
    expect(out).toBe('a\rb\n# T\n\ny\n');
  });
  it('줄바꿈 무작위 섞기: 안 고치면 바이트 그대로, 한 줄 고치면 그 줄만', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    for (let k = 0; k < 3000; k++) {
      const lines = Array.from({ length: 1 + rnd(8) }, (_, i) => 'L' + i + ['', '\r\n', '\n', '\r'][rnd(4)] + (rnd(5) === 0 ? '\r' : ''));
      const raw = lines.join('') + ['', '\n', '\r\n'][rnd(3)];
      const d = decodeBytes(u8(raw));
      expect(new TextDecoder().decode(encodeText(d.text, d))).toBe(raw);
      const t2 = d.text.replace('L0', 'Z0');
      const got = new TextDecoder().decode(encodeText(t2, d));
      expect(got.replace('Z0', 'L0')).toBe(raw);
    }
  });
});

describe('순수 JS SHA-256 (crypto.subtle 이 없는 환경용)', () => {
  it('Node crypto 와 같다 — 블록 경계·빈 입력·큰 입력', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      expect(sha256Hex(b)).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });
});

describe('PC 설정·.gitignore', () => {
  it('맨 위 기본값 + 폴더별, 경로는 / 와 끝 / 무시, Windows 는 대소문자 무시', () => {
    const f = { user: 'a', assistant: { command: 'claude' }, workspaces: { 'D:\\Work\\Docs\\': { notify: { command: ['x'] } } } };
    expect(pcSettingsFor(f, ['d:/work/docs'], true)).toEqual({ user: 'a', assistant: { command: 'claude' }, notify: { command: ['x'] } });
    expect(pcSettingsFor(f, ['d:/work/docs'], false).notify).toEqual({});
  });
  it('mergeConfig: 폴더의 명령·이름은 버리고 PC 의 것만', () => {
    const c = mergeConfig({ user: 'x', assistant: { command: 'evil' }, notify: { command: ['evil'], message: 'm' } }, 'f', { notify: { command: ['ok'] } });
    expect([c.user, c.assistant, c.notify.command, c.notify.message, c.warnings?.length]).toEqual(['', null, ['ok'], 'm', 3]);
  });
  it('mergeGitignore: 빠진 줄만 덧붙이고 사람이 더한 줄은 그대로', () => {
    expect(mergeGitignore('blobs/\nmine/')).toBe('blobs/\nmine/\nviewstate/\ninbox/\nlocks/\nstate.json\n*.tmp\n');
    expect(mergeGitignore('blobs/\nviewstate/\ninbox/\nlocks/\nstate.json\n*.tmp\n')).toBeNull();
  });
});
