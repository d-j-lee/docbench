// @ts-check
/**
 * 텍스트 파일 입출력 — Windows 현업 파일을 망가뜨리지 않는 것이 목적.
 *  - 인코딩: UTF-8(BOM 유무)·UTF-16LE(BOM) 우선, 아니면 CP949(EUC-KR 확장). 다시 인코딩해 원래 바이트가
 *    그대로 나올 때만 저장을 허용한다(아니면 읽기 전용 + 이유). CP949 에 없는 글자가 들어오면 저장을 막는다.
 *  - 줄바꿈: 화면에는 LF 로 주고, 저장할 때 바뀌지 않은 줄은 원래 줄바꿈 그대로(섞여 있어도), 바뀐 줄만 많은 쪽으로.
 *  - 쓰기: 같은 폴더 임시 파일 → rename (Windows 잠금이면 재시도 후 직접 쓰기)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** iconv-lite(선택 의존성). 동기로 한 번 불러 둔다 — 없으면 레거시 인코딩은 읽기 전용 */
const iconv = /** @type {any} */ ((() => { if (process.env.DOCBENCH_NO_ICONV === '1') return null; try { return createRequire(import.meta.url)('iconv-lite'); } catch { return null; } })());

const REASON_MSG = {
  encoding: (enc) => `${enc} 파일은 이 환경에서 바이트 그대로 저장할 수 없습니다. UTF-8 로 바꿔 저장하거나 iconv-lite 를 설치하세요.`,
  unrepresentable: (enc) => `고친 글에 ${enc} 로 쓸 수 없는 글자(— ✅ 등)가 있습니다. UTF-8 로 바꿔 저장하거나 그 글자를 빼세요.`,
  'invalid-utf8': () => 'UTF-8 문서에 깨진 바이트가 섞여 있어 그대로 저장하면 글자가 망가집니다. 원본을 고치거나 UTF-8 로 정리해 저장하세요.',
};

export class EncodingReadOnlyError extends Error {
  /** @param {string} encoding @param {'encoding'|'unrepresentable'|'invalid-utf8'} [reason] */
  constructor(encoding, reason = 'encoding') {
    super(REASON_MSG[reason](encoding.toUpperCase()));
    this.code = 'READ_ONLY';
    this.reason = reason;
    this.encoding = encoding;
  }
}

/** @param {Buffer} buf */
export function hashBytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * @typedef {{ text: string, raw: string, encoding: 'utf-8' | 'euc-kr' | 'utf-16le' | 'utf-16be', bom: boolean,
 *   eol: 'lf' | 'crlf', mixed: boolean, writable: boolean, readOnlyReason?: 'encoding' | 'invalid-utf8' }} Decoded
 */

/**
 * 바이트 → 글. 판별 순서: BOM(UTF-8·UTF-16) → UTF-8 → (깨진 바이트가 조금 섞인 UTF-8) → CP949(EUC-KR 확장).
 * writable 은 "다시 인코딩하면 원래 바이트가 그대로 나오는가"로 정한다 — 아니면 저장을 막는다.
 * @param {Buffer} buf
 * @returns {Decoded}
 */
export function decode(buf) {
  /** @type {Decoded['encoding']} */
  let encoding = 'utf-8';
  let bom = false;
  let body = buf;
  let raw;
  let writable = true;
  /** @type {Decoded['readOnlyReason']} */
  let readOnlyReason;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { bom = true; body = buf.subarray(3); }
  else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) { bom = true; body = buf.subarray(2); encoding = 'utf-16le'; }
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { bom = true; body = buf.subarray(2); encoding = 'utf-16be'; }

  if (encoding === 'utf-16le') {
    raw = body.toString('utf16le');
    writable = Buffer.from(raw, 'utf16le').equals(body);
    if (!writable) readOnlyReason = 'encoding';
  } else if (encoding === 'utf-16be') {
    raw = new TextDecoder('utf-16be').decode(body);
    writable = false; readOnlyReason = 'encoding';
  } else {
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      const loose = new TextDecoder('utf-8').decode(body);
      const bad = (loose.match(/\uFFFD/g) || []).length;
      const good = (loose.match(/[^\x00-\x7F\uFFFD]/g) || []).length;
      if (good > 0 && good >= bad * 4) {
        // 대부분 UTF-8 인데 몇 바이트가 깨졌다 → 보여 주되 저장은 막는다
        raw = loose; writable = false; readOnlyReason = 'invalid-utf8';
      } else {
        encoding = 'euc-kr';
        if (iconv) {
          raw = iconv.decode(body, 'cp949');
          writable = iconv.encode(raw, 'cp949').equals(body);
        } else {
          raw = new TextDecoder('euc-kr').decode(body);
          writable = false;
        }
        if (!writable) readOnlyReason = 'encoding';
      }
    }
  }
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/\n/g) || []).length - crlf;
  return { text: raw.replace(/\r\n?/g, '\n'), raw, encoding, bom, eol: crlf > lf ? 'crlf' : 'lf', mixed: crlf > 0 && lf > 0, writable, readOnlyReason };
}

export async function canEncodeLegacy() { return !!iconv; }

/**
 * 새 LF 글에 원래 줄바꿈을 되살린다. 앞뒤로 그대로인 줄은 원래 줄바꿈(섞여 있어도)을 그대로 두고,
 * 바뀐 가운데 줄은 그 자리 원래 줄의 줄바꿈을 따른다 — 손대지 않은 섹션의 바이트가 바뀌지 않는다.
 * @param {string} next LF 글 @param {string | undefined} oldRaw 원래 글(줄바꿈 그대로) @param {'lf'|'crlf'} eol
 */
export function restoreEol(next, oldRaw, eol) {
  const nl = eol === 'crlf' ? '\r\n' : '\n';
  if (oldRaw == null || /\r(?!\n)/.test(oldRaw)) return eol === 'crlf' ? next.replace(/\n/g, '\r\n') : next;
  const a = oldRaw.split(/(?<=\n)/);
  const aLF = a.map((l) => (l.endsWith('\r\n') ? l.slice(0, -2) + '\n' : l));
  const b = next.split(/(?<=\n)/);
  let p = 0;
  while (p < a.length && p < b.length && aLF[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && aLF[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // 바뀐 줄은 그 자리에 있던 원래 줄(없으면 바로 앞·뒤 줄)의 줄바꿈을 따른다 — 섞인 파일에서도 그 구역의 관례대로
  const oldMid = a.slice(p, a.length - s);
  const eolOf = (l) => (l == null ? null : l.endsWith('\r\n') ? '\r\n' : l.endsWith('\n') ? '\n' : null);
  const mid = b.slice(p, b.length - s).map((l, i) => {
    if (!l.endsWith('\n')) return l;
    const e = eolOf(oldMid[Math.min(i, oldMid.length - 1)]) || eolOf(a[p - 1]) || eolOf(a[a.length - s]) || nl;
    return l.slice(0, -1) + e;
  });
  return a.slice(0, p).join('') + mid.join('') + a.slice(a.length - s).join('');
}

/**
 * 글 → 바이트 (원래 모양으로).
 * @param {string} text LF 글
 * @param {{ encoding: string, bom: boolean, eol: 'lf'|'crlf', raw?: string }} meta 원래 파일의 모양
 * @param {'utf-8'} [convertTo] 사람이 UTF-8 변환에 동의했을 때
 */
export async function encode(text, meta, convertTo) {
  const body = restoreEol(text, meta.raw, meta.eol);
  const enc = convertTo || meta.encoding;
  if (enc === 'utf-8') {
    const b = Buffer.from(body, 'utf8');
    return meta.bom && !convertTo && meta.encoding === 'utf-8' ? Buffer.concat([BOM, b]) : b;
  }
  if (enc === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]);
  if (enc === 'euc-kr') {
    if (!iconv) throw new EncodingReadOnlyError(enc);
    const out = iconv.encode(body, 'cp949');
    // CP949 에 없는 글자는 iconv 가 '?' 로 바꾼다 — 조용히 망가뜨리지 않게 되읽어 비교한다
    if (iconv.decode(out, 'cp949') !== body) throw new EncodingReadOnlyError(enc, 'unrepresentable');
    return out;
  }
  throw new EncodingReadOnlyError(enc);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 원자적 쓰기. Windows 에서 다른 프로그램이 파일을 잡고 있으면 rename 이 EPERM/EBUSY 로 실패할 수 있다.
 * @param {string} file
 * @param {Buffer | string} data
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
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

/** 사람과 AI 가 같이 읽는 파일이라 키 순서를 고정하고 들여쓴다 @param {string} file @param {unknown} obj */
export async function writeJson(file, obj) {
  await atomicWrite(file, JSON.stringify(obj, null, 2) + '\n');
}
