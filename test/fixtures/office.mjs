// @ts-check
/**
 * 시험용 오피스·한글 파일 — 아주 작은 ZIP 쓰개(저장·deflate)와 Word·PowerPoint·Excel·HWPX 견본.
 * 실제 프로그램이 만든 파일과 같은 모양(이름공간 접두어·관계 파일·공유 문자열)을 갖추되, 뽑기 규칙의 까다로운 경우를 넣었다.
 */
import zlib from 'node:zlib';

/** @param {Uint8Array} b */
function crc32(b) {
  let crc = 0xffffffff;
  for (const x of b) { crc ^= x; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 파일 묶음 → ZIP 바이트
 * @param {Record<string, string | Uint8Array>} files @param {{ deflate?: boolean }} [o]
 */
export function zipFiles(files, o = {}) {
  const enc = new TextEncoder();
  /** @type {Uint8Array[]} */
  const parts = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let off = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const v = files[name];
    const data = typeof v === 'string' ? enc.encode(v) : v;
    const nameB = enc.encode(name);
    const comp = o.deflate ? new Uint8Array(zlib.deflateRawSync(data)) : data;
    const method = o.deflate ? 8 : 0;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, method, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(lh.buffer), nameB, comp);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(10, method, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nameB.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    off += 30 + nameB.length + comp.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, names.length, true); end.setUint16(10, names.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Word 견본 — 제목 스타일(이름은 styles.xml 의 heading n), 탭 멈춤 정의, 목록, 표(| 포함), 지운 글·더한 글, 그림, 들여쓴 '# ' */
export function sampleDocx(o = {}) {
  return zipFiles({
    '[Content_Types].xml': XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/styles.xml': XML + `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`,
    'word/document.xml': XML + `<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>배포 계획</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>개요</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">이 문서는 </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>0.9</w:t></w:r><w:r><w:t xml:space="preserve"> 판의 *배포* 계획입니다.</w:t></w:r></w:p>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>이름</w:t></w:r><w:r><w:tab/><w:t>홍길동</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>첫 항목</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>하위 항목</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>단계</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>담당</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>빌드|시험</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>DJ</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:pPr><w:pStyle w:val="2"/></w:pPr><w:r><w:t>세부 &amp; 위험</w:t></w:r></w:p>
<w:p><w:r><w:delText>지운 글</w:delText></w:r><w:ins><w:r><w:t>더한 글</w:t></w:r></w:ins><w:r><w:drawing/></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">    # 제목 아님</w:t></w:r></w:p>
</w:body></w:document>`,
  }, o);
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

/** PowerPoint 견본 — 슬라이드 차례는 파일 번호와 반대(sldIdLst 가 정한다), 수준 있는 목록, 표, 그림, 발표자 노트 */
export function samplePptx() {
  return zipFiles({
    'ppt/presentation.xml': XML + `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': XML + `<Relationships ${REL}><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/></Relationships>`,
    'ppt/slides/slide2.xml': XML + `<p:sld ${P}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>소개</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>첫째</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>둘째</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`,
    'ppt/slides/slide1.xml': XML + `<p:sld ${P}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>마무리</a:t></a:r></a:p></p:txBody></p:sp>
<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
<p:pic/>
</p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': XML + `<Relationships ${REL}><Relationship Id="rId1" Type="notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    'ppt/notesSlides/notesSlide1.xml': XML + `<p:notes ${P}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>노트 글</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`,
  });
}

const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Excel 견본 — 공유 문자열(읽기 표기 rPh 포함), 숫자·참거짓·인라인 글, 빈 칸 건너뛰기(C 열), 빈 시트 */
export function sampleXlsx() {
  return zipFiles({
    'xl/workbook.xml': XML + `<workbook ${X}><sheets><sheet name="매출" sheetId="1" r:id="rId1"/><sheet name="빈 시트" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': XML + `<Relationships ${REL}><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    'xl/sharedStrings.xml': XML + `<sst ${X} count="3"><si><t>월</t></si><si><t>금액</t></si><si><r><t>1</t></r><r><t>월</t></r><rPh sb="0" eb="1"><t>いち</t></rPh></si></sst>`,
    'xl/worksheets/sheet1.xml': XML + `<worksheet ${X}><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>메모</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500</v></c><c r="C2" t="b"><v>1</v></c></row>
<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><f>SUM(B2)</f><v>1500</v></c></row>
</sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': XML + `<worksheet ${X}><sheetData/></worksheet>`,
  });
}

const H = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"';

/** 한글(HWPX) 견본 — 스타일 "개요 1", 문단 모양의 개요 수준, 단락 안에 든 표, 줄 바꿈·탭 */
export function sampleHwpx() {
  return zipFiles({
    'mimetype': 'application/hwp+zip',
    'Contents/header.xml': XML + `<hh:head ${H}><hh:refList><hh:paraProperties><hh:paraPr id="7"><hh:heading type="OUTLINE" idRef="0" level="1"/></hh:paraPr></hh:paraProperties><hh:styles><hh:style id="0" type="PARA" name="바탕글" engName="Normal"/><hh:style id="2" type="PARA" name="개요 1" engName="Outline 1"/></hh:styles></hh:refList></hh:head>`,
    'Contents/section0.xml': XML + `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ${H}>
<hp:p styleIDRef="2"><hp:run><hp:t>추진 배경</hp:t></hp:run></hp:p>
<hp:p styleIDRef="0"><hp:run><hp:t>첫 줄<hp:lineBreak/>둘째 줄<hp:tab/>끝</hp:t></hp:run></hp:p>
<hp:p styleIDRef="0" paraPrIDRef="7"><hp:run><hp:t>세부 계획</hp:t></hp:run></hp:p>
<hp:p styleIDRef="0"><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>항목</hp:t></hp:run></hp:p></hp:subList></hp:tc><hp:tc><hp:subList><hp:p><hp:run><hp:t>일정</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>설계</hp:t></hp:run></hp:p></hp:subList></hp:tc><hp:tc><hp:subList><hp:p><hp:run><hp:t>10월</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
</hs:sec>`,
    'Contents/section1.xml': XML + `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ${H}><hp:p styleIDRef="0"><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>`,
  });
}

/** Jupyter 견본 */
export function sampleIpynb() {
  return JSON.stringify({
    metadata: { kernelspec: { language: 'python' }, language_info: { name: 'python' } },
    nbformat: 4,
    cells: [
      { cell_type: 'markdown', source: ['# 분석\n', '\n', '## 데이터 읽기'] },
      { cell_type: 'code', source: 'import pandas as pd\ndf = pd.read_csv("a.csv")', outputs: [{ output_type: 'stream', name: 'stdout', text: ['rows: 3\n'] }] },
      { cell_type: 'code', source: ['df.plot()'], outputs: [{ output_type: 'display_data', data: { 'image/png': 'iVBOR…', 'text/plain': ['<Figure>'] } }] },
      { cell_type: 'code', source: '1/0', outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: [] }] },
    ],
  }, null, 1);
}
