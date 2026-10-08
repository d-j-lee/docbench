// @ts-check
/**
 * 텍스트 파일 입출력 (Node). 바이트 ↔ 글 규칙은 브라우저와 같은 src/core/textcodec.ts 를 쓰고,
 * 여기에는 Node 쪽 일만 둔다: CP949 코덱(iconv-lite, 선택 의존성), 판 해시, 원자적 쓰기, JSON 파일.
 *  - 쓰기: 같은 폴더 임시 파일 → rename (Windows 잠금이면 재시도 후 직접 쓰기)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { core } from './core.mjs';

export const { EncodingReadOnlyError, restoreEol } = core;

/** iconv-lite(선택 의존성). 동기로 한 번 불러 둔다 — 없으면 레거시 인코딩은 읽기 전용 */
const iconv = /** @type {any} */ ((() => { if (process.env.DOCBENCH_NO_ICONV === '1') return null; try { return createRequire(import.meta.url)('iconv-lite'); } catch { return null; } })());

/**
 * CP949 코덱. Node 의 TextDecoder('euc-kr') 는 확장 음절(똠·햏)을 다르게 읽으므로 iconv-lite 의 cp949 를 쓴다.
 * iconv 는 못 쓰는 글자를 '?' 로 바꾸므로, 되읽어 같은지 보고 아니면 null(= 쓸 수 없음).
 * @type {import('../dist/core.mjs').LegacyCodec | null}
 */
const cp949 = iconv ? {
  decode: (b) => iconv.decode(Buffer.from(b.buffer, b.byteOffset, b.byteLength), 'cp949'),
  encode: (s) => { const out = iconv.encode(s, 'cp949'); return iconv.decode(out, 'cp949') === s ? new Uint8Array(out.buffer, out.byteOffset, out.byteLength) : null; },
} : null;

/** @param {Uint8Array} u */
const toBuffer = (u) => (Buffer.isBuffer(u) ? u : Buffer.from(u.buffer, u.byteOffset, u.byteLength));

/** @param {Uint8Array} buf */
export function hashBytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * 바이트 → 글. writable 은 "다시 인코딩하면 원래 바이트가 그대로 나오는가"로 정한다.
 * @param {Uint8Array} buf
 */
export function decode(buf) { return core.decodeBytes(buf, cp949); }

export async function canEncodeLegacy() { return !!cp949; }

/**
 * 글 → 바이트 (원래 모양으로).
 * @param {string} text LF 글
 * @param {{ encoding: string, bom: boolean, eol: 'lf'|'crlf', raw?: string }} meta 원래 파일의 모양
 * @param {'utf-8'} [convertTo] 사람이 UTF-8 변환에 동의했을 때
 */
export async function encode(text, meta, convertTo) {
  return toBuffer(core.encodeText(text, meta, convertTo, cp949));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 원자적 쓰기. Windows 에서 다른 프로그램이 파일을 잡고 있으면 rename 이 EPERM/EBUSY 로 실패할 수 있다.
 * @param {string} file
 * @param {Uint8Array | string} data
 */
export async function atomicWrite(file, data) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.docbench-${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`);
  let mode;
  try { mode = (await fs.stat(file)).mode; } catch { /* 새 파일 */ }
  await fs.writeFile(tmp, data, mode ? { mode } : undefined);
  for (let i = 0; i < 6; i++) {
    try { await fs.rename(tmp, file); return; } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(code)) { await fs.rm(tmp, { force: true }); throw e; }
      await sleep(60 * (i + 1));
    }
  }
  // 마지막 수단: 제자리 덮어쓰기 (동기화 도구·백신이 rename 만 계속 막을 때).
  // 원자성은 잃지만 직전 판 본문은 .docbench/blobs 에 이미 있어 되살릴 수 있다. 이것도 막히면 오류로 끝난다.
  try { await fs.writeFile(file, data); } finally { await fs.rm(tmp, { force: true }); }
}

/** @param {string} file */
export async function readJson(file, fallback = null) {
  // BOM(메모장·PowerShell 5.1)이 붙어도 읽는다 — 브라우저 폴더 어댑터와 같은 규칙
  try { return core.parseJsonText(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

/** 사람과 AI 가 같이 읽는 파일이라 들여쓴다 @param {string} file @param {unknown} obj */
export async function writeJson(file, obj) {
  await atomicWrite(file, core.jsonFile(obj));
}
