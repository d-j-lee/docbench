// @vitest-environment node
/**
 * 뽑은 글(D87) — Word·PowerPoint·Excel·한글(HWPX)·Jupyter 에서 마크다운으로. 섹션은 뽑은 글의 마크다운 제목으로 센다.
 */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { deriveText, readZip, DeriveError, mdText, xmlTokens } from '../../src/core/derive';
import { formatOf } from '../../src/core/formats';
import { sectionSources } from '../../src/core/source';
// @ts-expect-error 시험 견본(.mjs)에는 타입이 없다
import { sampleDocx, samplePptx, sampleXlsx, sampleHwpx, sampleIpynb, zipFiles } from '../fixtures/office.mjs';

const inflate = async (b: Uint8Array, max: number) => new Uint8Array(zlib.inflateRawSync(b, { maxOutputLength: max }));
const keysOf = (md: string, id: string) => sectionSources(md, id).map((s) => s.key);

describe('ZIP', () => {
  it('저장·deflate 항목을 읽고, ZIP 이 아니면 not-zip', async () => {
    const z = zipFiles({ 'a.txt': '가나다', 'b/c.xml': '<x/>' }, { deflate: true });
    expect(readZip(z).map((e) => e.name)).toEqual(['a.txt', 'b/c.xml']);
    // 오피스 암호 파일은 ZIP 이 아니다(OLE 컨테이너)
    expect(() => readZip(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).toThrow(DeriveError);
    await expect(deriveText(new Uint8Array([1, 2, 3]), formatOf('a.docx')!)).rejects.toMatchObject({ reason: 'not-zip' });
  });
  it('XML 토큰: 이름공간 접두어를 떼고, 엔티티를 풀고, 속성값 안의 > 를 건넌다', () => {
    const tk = [...xmlTokens('<?xml version="1.0"?><w:p a="x>y"><w:t>A &amp; B</w:t><!-- c --><w:br/></w:p>')];
    expect(tk.map((t) => t.t + ':' + (t.name || t.text))).toEqual(['open:p', 'open:t', 'text:A & B', 'close:t', 'open:br', 'close:p']);
    expect(tk[0].attrs.a).toBe('x>y');
  });
  it('마크다운 기호는 글자 그대로 보이게', () => {
    expect(mdText('# 제목 아님\n*별* [링크] <b> 1. 번호 | 칸')).toBe('\\# 제목 아님\n\\*별\\* \\[링크\\] \\<b\\> 1. 번호 \\| 칸');
  });
});

describe('Word', () => {
  it('제목(스타일 이름·개요 수준)·목록·표·지운 글 빼기·그림 표시·기호 이스케이프 (deflate 는 zlib 로)', async () => {
    const md = await deriveText(sampleDocx({ deflate: true }), formatOf('a.docx')!, { inflate });
    expect(md).toBe([
      '# 배포 계획', '', '## 개요', '', '이 문서는 0.9 판의 \\*배포\\* 계획입니다.', '', '이름 홍길동', '',
      '- 첫 항목', '', '  - 하위 항목', '', '| 단계 | 담당 |', '| --- | --- |', '| 빌드\\|시험 | DJ |', '',
      '### 세부 & 위험', '', '더한 글 [그림]', '', '\\# 제목 아님', '',
    ].join('\n'));
    expect(keysOf(md!, 'a.docx')).toEqual(['배포 계획', '배포 계획 › 개요', '배포 계획 › 개요 › 세부 & 위험']);
  });
  it('압축 풀기를 주지 않으면 DecompressionStream 으로', async () => {
    const md = await deriveText(sampleDocx({ deflate: true }), formatOf('a.docx')!);
    expect(md).toContain('## 개요');
  });
});

describe('PowerPoint · Excel · 한글 · Jupyter', () => {
  it('PowerPoint: 차례는 sldIdLst, 목록 수준, 표, 그림, 발표자 노트', async () => {
    const md = await deriveText(samplePptx(), formatOf('a.pptx')!);
    expect(md).toBe([
      '## 슬라이드 1 — 소개', '', '- 첫째\n  - 둘째', '',
      '## 슬라이드 2 — 마무리', '', '| A | B |\n| --- | --- |\n| 1 | 2 |\n[그림]', '',
      '> 발표자 노트: 노트 글', '',
    ].join('\n'));
  });
  it('Excel: 시트마다 표, 공유 문자열(읽기 표기 빼고)·인라인 글·참거짓·수식 값, 빈 시트', async () => {
    const md = await deriveText(sampleXlsx(), formatOf('a.xlsx')!, { locale: 'en' });
    expect(md).toBe([
      '## 매출', '', '| 월 | 금액 | 메모 |', '| --- | --- | --- |', '| 1월 | 1500 | TRUE |', '| 1월 |   | 1500 |', '',
      '## 빈 시트', '', '_(empty sheet)_', '',
    ].join('\n'));
  });
  it('한글(HWPX): 개요 스타일·문단 모양 개요 수준, 줄 바꿈·탭, 단락 안의 표, 여러 구역', async () => {
    const md = await deriveText(sampleHwpx(), formatOf('a.hwpx')!);
    expect(md).toBe([
      '## 추진 배경', '', '첫 줄\n둘째 줄 끝', '', '### 세부 계획', '', '| 항목 | 일정 |\n| --- | --- |\n| 설계 | 10월 |', '', '둘째 구역', '',
    ].join('\n'));
  });
  it('Jupyter: 마크다운 칸 그대로, 코드 칸·출력(글만), 그림은 표시만, 오류', async () => {
    const md = await deriveText(new TextEncoder().encode(sampleIpynb()), formatOf('a.ipynb')!);
    expect(md).toContain('# 분석\n\n## 데이터 읽기');
    expect(md).toContain('```python\nimport pandas as pd\ndf = pd.read_csv("a.csv")\n```');
    expect(md).toContain('출력:\n\n```text\nrows: 3\n```');
    expect(md).toContain('[그림]');
    expect(md).toContain('ZeroDivisionError: division by zero');
    expect(md).not.toContain('iVBOR');
    expect(keysOf(md!, 'a.ipynb')).toEqual(['분석', '분석 › 데이터 읽기']);
  });
});

describe('압축 폭탄', () => {
  /** 중앙 디렉터리의 풀린 크기를 작게 꾸민 ZIP — 적힌 크기를 믿으면 70 MB 를 다 푼다 */
  const bomb = () => {
    const z = zipFiles({ '[Content_Types].xml': '<Types/>', 'word/document.xml': new Uint8Array(70 * 1024 * 1024) }, { deflate: true });
    for (let i = 0; i + 4 < z.length; i++) {
      if (z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 0x01 && z[i + 3] === 0x02) new DataView(z.buffer, z.byteOffset).setUint32(i + 24, 100, true);
    }
    return z;
  };
  it('서버(zlib maxOutputLength)와 브라우저(DecompressionStream 조각 읽기) 모두 한도에서 멈춘다', async () => {
    const z = bomb();
    expect(readZip(z).find((e) => e.name === 'word/document.xml')!.usize).toBe(100);
    await expect(deriveText(z, formatOf('a.docx')!, { inflate })).rejects.toMatchObject({ reason: 'too-large' });
    await expect(deriveText(z, formatOf('a.docx')!)).rejects.toMatchObject({ reason: 'too-large' });
  });
});

describe('부풀린 목록', () => {
  it('같은 슬라이드를 수백 번 가리켜도 한 번만 풀고, 뽑은 글은 한도 안', async () => {
    const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const ids = Array.from({ length: 400 }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId1"/>`).join('');
    const z = zipFiles({
      'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': `<p:sld ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${'가'.repeat(1_500_000)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    }, { deflate: true });
    const t0 = Date.now();
    const md = (await deriveText(z, formatOf('a.pptx')!, { inflate }))!;
    expect(Date.now() - t0).toBeLessThan(8000);
    expect((md.match(/^## 슬라이드/gm) || []).length).toBe(1);
    expect(md.length).toBeLessThan(2_100_000);
  });
});
