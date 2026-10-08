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

/** 마크다운 → HTML (정제 전). 화면에서는 반드시 DOMPurify 를 거친다 */
export function toHTML(md: string): string {
  return view.parse(protectTildes(toLF(md)), { async: false }) as string;
}

export { marked };
