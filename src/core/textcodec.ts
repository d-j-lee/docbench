/**
 * 바이트 ↔ 글 — 서버(Node)와 브라우저 폴더 어댑터가 같은 규칙을 쓴다. Windows 현업 파일을 망가뜨리지 않는 것이 목적.
 *
 *  - 판별: BOM(UTF-8·UTF-16) → UTF-8 → (깨진 바이트가 조금 섞인 UTF-8) → CP949(EUC-KR 확장).
 *  - 저장 허용 = "다시 인코딩하면 원래 바이트가 그대로 나오는가"(왕복 검사). 아니면 읽기 전용 + 이유.
 *  - 줄바꿈: 화면에는 LF 로 주고, 저장할 때 바뀌지 않은 줄은 원래 줄바꿈 그대로(섞여 있어도), 바뀐 줄은 그 자리 줄바꿈.
 *  - CP949 인코더는 바깥에서 넣는다(LegacyCodec): 서버 = iconv-lite, 브라우저 = 내장 euc-kr 디코더로 만든 역표.
 *    없으면 CP949 문서는 읽기 전용이다.
 */

export type TextEncodingName = 'utf-8' | 'euc-kr' | 'utf-16le' | 'utf-16be';
export type ReadOnlyReason = 'encoding' | 'unrepresentable' | 'invalid-utf8';

export interface LegacyCodec {
  decode(bytes: Uint8Array): string;
  /** CP949 로 쓸 수 없는 글자가 있으면 null */
  encode(text: string): Uint8Array | null;
}

export interface Decoded {
  /** 화면용 — 줄바꿈 LF */
  text: string;
  /** 원래 줄바꿈 그대로 */
  raw: string;
  encoding: TextEncodingName;
  bom: boolean;
  eol: 'lf' | 'crlf';
  mixed: boolean;
  writable: boolean;
  readOnlyReason?: ReadOnlyReason;
}

export interface EncodeMeta {
  encoding: string;
  bom: boolean;
  eol: 'lf' | 'crlf';
  raw?: string;
}

const REASON_MSG: Record<ReadOnlyReason, (enc: string) => string> = {
  encoding: (enc) => `${enc === 'EUC-KR' ? 'CP949(EUC-KR)' : enc} 파일은 이 환경에서 바이트 그대로 저장할 수 없습니다. UTF-8 로 바꿔 저장하세요${enc === 'EUC-KR' ? ' (서버라면 iconv-lite 를 설치하면 그대로 저장됩니다)' : ''}.`,
  unrepresentable: (enc) => `고친 글에 ${enc} 로 쓸 수 없는 글자(— ✅ 등)가 있습니다. UTF-8 로 바꿔 저장하거나 그 글자를 빼세요.`,
  'invalid-utf8': () => 'UTF-8 문서에 깨진 바이트가 섞여 있어 그대로 저장하면 글자가 망가집니다. 원본을 고치거나 UTF-8 로 정리해 저장하세요.',
};

export class EncodingReadOnlyError extends Error {
  readonly code = 'READ_ONLY';
  constructor(public encoding: string, public reason: ReadOnlyReason = 'encoding') {
    super(REASON_MSG[reason](encoding.toUpperCase()));
  }
}

const BOM8 = [0xef, 0xbb, 0xbf];

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function utf16leEncode(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i * 2] = c & 0xff; out[i * 2 + 1] = c >> 8; }
  return out;
}

const utf8 = new TextEncoder();
/** BOM 글자를 떼지 않는다 — 앞에서 BOM 을 한 번 떼어 낸 뒤 또 BOM 이 있는 파일도 바이트 그대로 */
const dec = (label: string, fatal = false) => new TextDecoder(label, { fatal, ignoreBOM: true });

/** 바이트 → 글. legacy 가 없으면 CP949 문서는 보여 주되 읽기 전용 */
export function decodeBytes(buf: Uint8Array, legacy?: LegacyCodec | null): Decoded {
  let encoding: TextEncodingName = 'utf-8';
  let bom = false;
  let body = buf;
  let raw: string;
  let writable = true;
  let readOnlyReason: ReadOnlyReason | undefined;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { bom = true; body = buf.subarray(3); }
  else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) { bom = true; body = buf.subarray(2); encoding = 'utf-16le'; }
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { bom = true; body = buf.subarray(2); encoding = 'utf-16be'; }

  if (encoding === 'utf-16le') {
    raw = dec('utf-16le').decode(body);
    // 홀수 바이트·짝 없는 서로게이트는 디코더가 � 로 바꾼다 → 왕복이 안 되므로 읽기 전용
    writable = bytesEqual(utf16leEncode(raw), body);
    if (!writable) readOnlyReason = 'encoding';
  } else if (encoding === 'utf-16be') {
    raw = dec('utf-16be').decode(body);
    writable = false; readOnlyReason = 'encoding';
  } else {
    try {
      raw = dec('utf-8', true).decode(body);
    } catch {
      const loose = dec('utf-8').decode(body);
      const bad = (loose.match(/�/g) || []).length;
      const good = (loose.match(/[^\x00-\x7F�]/g) || []).length;
      if (good > 0 && good >= bad * 4) {
        // 대부분 UTF-8 인데 몇 바이트가 깨졌다 → 보여 주되 저장은 막는다
        raw = loose; writable = false; readOnlyReason = 'invalid-utf8';
      } else {
        encoding = 'euc-kr';
        if (legacy) {
          raw = legacy.decode(body);
          const back = legacy.encode(raw);
          writable = !!back && bytesEqual(back, body);
        } else {
          raw = dec('euc-kr').decode(body);
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

/**
 * 새 LF 글에 원래 줄바꿈을 되살린다. 앞뒤로 그대로인 줄은 원래 줄바꿈(섞여 있어도)을 그대로 두고,
 * 바뀐 가운데 줄은 그 자리 원래 줄의 줄바꿈을 따른다 — 손대지 않은 섹션의 바이트가 바뀌지 않는다.
 */
export function restoreEol(next: string, oldRaw: string | undefined, eol: 'lf' | 'crlf'): string {
  const nl = eol === 'crlf' ? '\r\n' : '\n';
  if (oldRaw == null) return eol === 'crlf' ? next.replace(/\n/g, '\r\n') : next;
  // 원래 줄을 줄바꿈(\r\n · 홀로 \r · \n)째로 나눈다 — 홀로 있는 \r 도 손대지 않은 줄에서는 그대로 남는다
  const a = oldRaw.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
  const aLF = a.map((l) => l.replace(/(?:\r\n|\r)$/, '\n'));
  const b = next.split(/(?<=\n)/);
  let p = 0;
  while (p < a.length && p < b.length && aLF[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && aLF[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // 바뀐 줄은 그 자리에 있던 원래 줄(없으면 바로 앞·뒤 줄)의 줄바꿈을 따른다 — 섞인 파일에서도 그 구역의 관례대로
  const oldMid = a.slice(p, a.length - s);
  const eolOf = (l: string | undefined) => (l == null ? null : l.endsWith('\r\n') ? '\r\n' : l.endsWith('\n') ? '\n' : l.endsWith('\r') ? '\r' : null);
  const mid = b.slice(p, b.length - s).map((l, i) => {
    if (!l.endsWith('\n')) return l;
    const e = eolOf(oldMid[Math.min(i, oldMid.length - 1)]) || eolOf(a[p - 1]) || eolOf(a[a.length - s]) || nl;
    return l.slice(0, -1) + e;
  });
  return a.slice(0, p).join('') + mid.join('') + a.slice(a.length - s).join('');
}

/**
 * 글 → 바이트 (원래 모양으로). 못 쓰면 EncodingReadOnlyError.
 * @param text LF 글 @param meta 원래 파일의 모양 @param convertTo 사람이 UTF-8 변환에 동의했을 때
 */
export function encodeText(text: string, meta: EncodeMeta, convertTo?: 'utf-8', legacy?: LegacyCodec | null): Uint8Array {
  const body = restoreEol(text, meta.raw, meta.eol);
  const enc = convertTo || meta.encoding;
  if (enc === 'utf-8') {
    const b = utf8.encode(body);
    // 원래 UTF-8+BOM 이면 깨진 바이트를 정리해 저장할 때도 BOM 은 남긴다. 다른 인코딩에서 바꿀 때는 BOM 없이
    return meta.bom && meta.encoding === 'utf-8' ? concat(BOM8, b) : b;
  }
  if (enc === 'utf-16le') return concat([0xff, 0xfe], utf16leEncode(body));
  if (enc === 'euc-kr') {
    if (!legacy) throw new EncodingReadOnlyError(enc);
    const out = legacy.encode(body);
    // CP949 에 없는 글자는 조용히 '?' 로 바꾸지 않는다 — 되읽어 같은지까지 본다
    if (!out || legacy.decode(out) !== body) throw new EncodingReadOnlyError(enc, 'unrepresentable');
    return out;
  }
  throw new EncodingReadOnlyError(enc);
}

/**
 * 브라우저용 CP949 코덱 — 내장 TextDecoder('euc-kr')(WHATWG = windows-949, 확장 음절 포함)로 2바이트 전부를
 * 한 번 풀어 역표를 만든다. 표를 따로 싣지 않는다. Node 의 'euc-kr' 디코더는 확장 음절을 다르게 읽으므로
 * 서버는 이것 대신 iconv-lite 를 쓴다.
 */
export function createBrowserCp949(): LegacyCodec | null {
  let decoder: TextDecoder;
  try { decoder = new TextDecoder('euc-kr', { fatal: false }); } catch { return null; }
  let table: Map<number, number> | null = null;
  const build = () => {
    const map = new Map<number, number>();
    // 바이트 쌍마다 사이에 줄바꿈을 넣어 한 번에 푼다 — 쌍 하나가 글자 하나(또는 �)
    const pairs: number[] = [];
    for (let lead = 0x81; lead <= 0xfe; lead++) for (let trail = 0x41; trail <= 0xfe; trail++) pairs.push(lead, trail, 0x0a);
    const parts = decoder.decode(new Uint8Array(pairs)).split('\n');
    let i = 0;
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x41; trail <= 0xfe; trail++, i++) {
        const s = parts[i];
        if (!s || s === '�' || s.length !== 1) continue;
        const cp = s.charCodeAt(0);
        if (!map.has(cp)) map.set(cp, (lead << 8) | trail); // 처음 나온 자리(표준 인코더와 같은 규칙)
      }
    }
    return map;
  };
  return {
    decode: (b) => decoder.decode(b),
    encode(text) {
      table ||= build();
      const out: number[] = [];
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x80) { out.push(c); continue; }
        const v = table.get(c);
        if (v == null) return null;
        out.push(v >> 8, v & 0xff);
      }
      return new Uint8Array(out);
    },
  };
}
