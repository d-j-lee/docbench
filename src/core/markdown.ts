/**
 * 마크다운 공통 처리 — DOM 없이 돈다(서버·CLI 와 공유).
 */
import { marked, Marked, type Tokens } from 'marked';

/** CRLF·CR 을 LF 로. 화면과 섹션 계산은 LF 만 다룬다 */
export const toLF = (s: string): string => s.replace(/\r\n?/g, '\n');

/**
 * GFM 은 `~x~` 를 취소선으로 읽는다. 한국어 문서의 범위 표기(9/29~10/2)가
 * 한 문단에 둘 있으면 그 사이가 지워져 보인다. 코드 밖의 홑물결만 이스케이프한다.
 * `~~취소선~~` 은 그대로 둔다.
 */
export function protectTildes(md: string): string {
  let fence: string | null = null;
  return md
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        return line;
      }
      if (m) {
        fence = m[1];
        return line;
      }
      return line
        .split(/(`+[^`]*`+)/)
        .map((seg, i) => (i % 2 ? seg : seg.replace(/(^|[^~\\])~(?!~)/g, '$1\\~')))
        .join('');
    })
    .join('\n');
}

/**
 * 문서 맨 앞 YAML 앞머리(`---` … `---` 또는 `...`)의 길이. 없으면 0.
 * 앞머리는 섹션이 아니다 — 그대로 두면 마크다운이 닫는 `---` 위 줄을 h2 제목(setext)으로 읽는다.
 * 원문(core/source)과 화면(toHTML)이 이 함수 하나로 같게 뗀다(섹션 키 패리티). 입력은 LF.
 * 문서가 가로줄로 시작하는 경우를 앞머리로 오인하지 않도록, 안쪽 줄이 모두 YAML 모양(`키: 값`·들여쓴 줄·`- 항목`·주석)이고
 * `키:` 줄이 하나 이상일 때만 앞머리로 본다. 맨 앞 BOM 은 건너뛴다.
 */
export function frontMatterLength(md: string): number {
  const bom = md.charCodeAt(0) === 0xfeff ? 1 : 0;
  const open = /^---[ \t]*\n/.exec(md.slice(bom));
  if (!open) return 0;
  let at = bom + open[0].length;
  let key = false;
  for (let n = 0; n < 200 && at < md.length; n++) {
    const nl = md.indexOf('\n', at);
    const end = nl < 0 ? md.length : nl + 1;
    const line = md.slice(at, nl < 0 ? md.length : nl);
    if (/^(---|\.\.\.)[ \t]*$/.test(line)) return key ? end : 0;
    if (/^[A-Za-z0-9_][\w.-]*[ \t]*:([ \t]|$)/.test(line)) key = true;
    else if (line.trim() && !/^([ \t]|#|-([ \t]|$))/.test(line)) return 0;
    at = end;
  }
  return 0;
}

/**
 * 앞머리 YAML 의 값 — 문서 메타데이터(상태·담당·꼬리표·검토일 …)로 보인다(D88). 간단한 모양만 읽는다:
 * `키: 값`, `키: [가, 나]`, `키:` 아래 `- 항목` 목록. 키는 소문자로, 값은 따옴표를 떼고 200자까지, 키 20개까지.
 * 중첩 매핑·여러 줄 글은 건너뛴다(YAML 파서 없이 — 서버 의존성 0). 앞머리가 없으면 빈 객체.
 */
export function frontMatterData(md: string): Record<string, string | string[]> {
  const lf = toLF(md);
  const fm = frontMatterLength(lf);
  const out: Record<string, string | string[]> = {};
  if (!fm) return out;
  const body = lf.slice(0, fm).replace(/^﻿?---[ \t]*\n/, '').replace(/\n?(---|\.\.\.)[ \t]*\n?$/, '');
  const clean = (v: string) => {
    let s = v.replace(/\s+#.*$/, '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
    return s.slice(0, 200);
  };
  let list: string | null = null;
  for (const line of body.split('\n')) {
    if (Object.keys(out).length >= 20 && !list) break;
    const item = /^[ \t]+-[ \t]+(.+)$/.exec(line) || /^-[ \t]+(.+)$/.exec(line);
    if (item && list) { const arr = out[list] as string[]; if (arr.length < 30) arr.push(clean(item[1])); continue; }
    const m = /^([A-Za-z0-9_][\w.-]*)[ \t]*:(?:[ \t]+(.*))?$/.exec(line);
    list = null;
    if (!m) continue;
    const key = m[1].toLowerCase();
    const v = (m[2] || '').trim();
    if (!v) { out[key] = []; list = key; continue; }
    if (/^[|>]/.test(v)) continue;
    const flow = /^\[(.*)\]$/.exec(v);
    out[key] = flow ? flow[1].split(',').map(clean).filter(Boolean).slice(0, 30) : clean(v);
  }
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && !v.length) delete out[k];
  return out;
}

const escHTML = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** 공백을 한 칸으로 접고 앞뒤를 자른다. 앵커·키 비교의 기준 */
export const norm = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

/**
 * 제목 줄의 화면 글자 — 브라우저가 그 제목을 그렸을 때 textContent 와 같다.
 * (인라인 마크다운을 HTML 로 그린 뒤 태그를 지우고 엔티티를 푼다)
 */
export function headingPlain(text: string): string {
  const html = marked.parseInline(protectTildes(text), { async: false }) as string;
  return norm(decodeEntities(html.replace(/<[^>]*>/g, '')));
}

/**
 * 화면용 렌더러: 마크다운 제목에만 data-md 표시를 붙인다. 문서에 직접 쓴 <h2> 같은 HTML 제목은 섹션이 아니다
 * (원문 쪽 sectionSources 도 heading 토큰만 센다 — 두 쪽 키가 같아야 섹션 편집이 안전하다).
 */
const view = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    heading(this: { parser: { parseInline(t: Tokens.Heading['tokens']): string } }, { tokens, depth }: Tokens.Heading) {
      return `<h${depth} data-md="">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

/** 마크다운 → HTML (정제 전). 화면에서는 반드시 DOMPurify 를 거친다. 앞머리 YAML 은 제목이 아닌 YAML 상자로 그린다 */
export function toHTML(md: string): string {
  const lf = toLF(md);
  const fm = frontMatterLength(lf);
  const body = view.parse(protectTildes(lf.slice(fm)), { async: false }) as string;
  if (!fm) return body;
  const yaml = lf.slice(0, fm).replace(/^﻿?---[ \t]*\n/, '').replace(/\n?(---|\.\.\.)[ \t]*\n?$/, '');
  return `<pre class="db-frontmatter"><code class="language-yaml">${escHTML(yaml)}</code></pre>\n` + body;
}

export { marked };
