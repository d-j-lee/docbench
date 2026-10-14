/**
 * 문서 한 장 — 머리·도구줄·본문, 접기·이름표·찾기, 피드백 앵커, 바뀐 섹션, 목차.
 */
import type { ChangeEntry, DocContent, Feedback } from '../types';
import { diffSections, sectionSources, getSectionText, KEY_SEP, type SectionDiff } from '../core/source';
import { locate, makeSelector } from '../core/selectors';
import { norm } from '../core/markdown';
import { turnOf, countTurns, lensMatch, lensFilters } from '../core/feedback';
import { lineDiff } from '../core/diff';
import { titleFromText, docStem } from '../core/workspace';
import { formatFor, markdownLike, editableFormat, claudeChanges } from '../core/formats';
import { frontMatterData } from '../core/markdown';
import { docMetaOf, resolveRelative } from '../core/overview';
import { RULES_FILE } from '../core/rules';
import { decorate, sectionize, textIndex, selectedSpan, wrapRange, type Section } from './render';
import { renderDoc, releaseDoc, hasSourceToggle, downloadButton } from './viewers';
import { h, $$, icon, fmtBytes, fmtTime, debounce, relTime } from './dom';
import { Editor, renderDiff } from './editor';
import { markSectionChanges, clearChangeMarks } from './track';
import { placeBubbles, clearBubbles } from './bubbles';
import { openLens, lensSummary } from './lens';
import type { App } from './app';

/** 문구 인용으로 남기는 가장 긴 글(공백 정규화 기준) — 넘으면 인용 없이 섹션·문서 전체에 적는다 */
const MAX_QUOTE = 500;
/** 고른 범위의 자리 — 짧으면 범위 전체, 화면 절반보다 길면 고르기를 끝낸 곳(아래 끝이 화면 밖일 수 있다) */
function selRect(sel: Selection, main: HTMLElement): DOMRect {
  const whole = sel.getRangeAt(0).getBoundingClientRect();
  if (whole.height <= main.clientHeight / 2 || !sel.focusNode) return whole;
  const f = document.createRange();
  f.setStart(sel.focusNode, sel.focusOffset);
  const r = f.getClientRects()[0] || (sel.focusNode.nodeType === 1 ? (sel.focusNode as Element) : sel.focusNode.parentElement)?.getBoundingClientRect();
  return r && (r.width || r.height) ? r : whole;
}

/** GitHub 식 제목 이름 — 소문자, 글자·숫자·_·- 만, 빈칸은 - */
export const slugOf = (s: string): string => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const decodeURIComponentSafe = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

export class DocView {
  readonly app: App;
  readonly id: string;
  content!: DocContent;
  secs: Section[] = [];
  article!: HTMLElement;
  editor: Editor | null = null;
  current: Section | null = null;
  private changed: SectionDiff | null = null;
  private changedFrom: string | null = null;
  /** 바뀌기 전 본문 (낱말 표시용) */
  private changedOldMd: string | null = null;
  /** 섹션 키 → 그 섹션을 바꾼 기록 (누가·언제) */
  private changeBy = new Map<string, { who: string; when: string; summary?: string }[]>();
  private changeWho: { who: string; when: string; n: number }[] = [];
  private bigChange = new Set<string>();
  private changeI = -1;
  private freshT: ReturnType<typeof setInterval> | undefined;
  private hits: HTMLElement[] = [];
  private hitI = -1;
  private textCache = new Map<string, string>();
  private outlineBtns = new Map<string, HTMLElement>();
  private cleanup: (() => void)[] = [];
  private els: { head?: HTMLElement; toolbar?: HTMLElement; banner?: HTMLElement; busy?: HTMLElement; fresh?: HTMLElement; diffSlot?: HTMLElement; orphans?: HTMLElement; guide?: HTMLElement; stats?: HTMLElement; seg?: HTMLElement; chips?: HTMLElement; find?: HTMLInputElement; findCnt?: HTMLElement; bub?: HTMLButtonElement; lens?: HTMLButtonElement } = {};
  private destroyed = false;

  constructor(app: App, id: string) {
    this.app = app;
    this.id = id;
  }

  get meta() { return this.app.manifest.docs[this.id]; }
  get t() { return this.app.t; }
  isEditing(): boolean { return !!this.editor?.dirty(); }

  destroy(): void {
    this.destroyed = true;
    this.editor?.close(true);
    releaseDoc(this.article);
    clearInterval(this.freshT);
    for (const c of this.cleanup.splice(0)) c();
  }

  // ------------------------------------------------------------ 불러오기·그리기
  /** 읽었으면 true (없거나 못 읽으면 화면에 알리고 false) */
  async load(compareFrom?: string): Promise<boolean> {
    const page = this.app.els.page;
    page.replaceChildren(h('p', { class: 'db-loading', text: this.t('doc.loading') }));
    try {
      this.content = await this.app.ad.docs.load(this.id);
    } catch (e) {
      page.replaceChildren(h('p', { class: 'db-notice tone-bad', text: this.t('doc.loadFail', { msg: (e as Error).message }) }));
      return false;
    }
    if (this.destroyed) return false;
    // 목록에 이름만 있던 문서(탐색기에서 처음 연 것)는 읽은 김에 제목을 채운다 — 설정에 적은 제목은 그대로
    const meta = this.app.manifest.docs[this.id];
    if (meta && meta.title === docStem(this.id)) meta.title = titleFromText(this.content.md, this.id);
    this.renderAll();
    const st = this.app.docState(this.id);
    const since = compareFrom || (st.lastSeen && st.lastSeen !== this.content.version ? st.lastSeen : null);
    if (since) await this.showChangedSince(since, !!compareFrom);
    // 본 판은 "확인"을 눌러야 넘어간다 — 다시 열거나 새로 고쳐도 바뀐 것 표시가 사라지지 않게
    if (compareFrom) { if (!st.lastSeen) st.lastSeen = this.content.version; } else this.markSeen(this.content.version);
    this.app.changedDocs.delete(this.id);
    this.app.saveState();
    this.showGuide();
    this.bindScroll();
    this.bindSelection();
    this.bindLinks();
    return true;
  }

  private renderAll(): void {
    const page = this.app.els.page;
    page.replaceChildren();
    this.els = {};
    page.append(this.renderHead(), this.renderToolbar());
    this.els.busy = h('div', { class: 'db-busybar', hidden: true });
    this.els.banner = h('div', { class: 'db-banner', hidden: true });
    this.els.diffSlot = h('div', { class: 'db-diffslot' });
    this.els.orphans = h('div', { class: 'db-orphans', hidden: true });
    this.els.guide = h('div', { class: 'db-guide', hidden: true });
    page.append(this.els.busy, this.els.banner, this.els.diffSlot, this.els.guide, this.els.orphans);
    this.renderBusy();
    this.renderBody();
    page.append(this.article);
  }

  private renderHead(): HTMLElement {
    const m = this.meta;
    const app = this.app;
    const grp = app.manifest.groups.find((g) => g.docs.includes(this.id));
    const tr = m.trust ? app.manifest.trust?.[m.trust] : undefined;
    const head = h('header', { class: 'db-dochead' },
      h('div', { class: 'db-eyebrow' },
        grp ? h('span', { text: grp.label }) : null,
        tr ? h('span', { class: 'db-trust tone-' + (tr.tone || 'neutral'), title: tr.desc || '', text: tr.label }) : null,
        m.audience ? h('span', { text: '· ' + m.audience }) : null),
      h('h1', { class: 'db-doctitle', text: m.title }),
      m.role ? h('p', { class: 'db-docrole', text: m.role }) : null);
    const src = m.source;
    const c = this.content;
    const meta = h('div', { class: 'db-meta' });
    if (src?.path) meta.append(h('code', { text: src.path }));
    if (src?.size != null) meta.append(h('span', { text: fmtBytes(src.size) }));
    const mod = c.updatedAt || src?.modified;
    if (mod) meta.append(h('span', { text: fmtTime(mod) + (c.updatedBy?.name ? ' · ' + c.updatedBy.name : '') }));
    const enc = c.encoding || src?.encoding;
    if (enc && enc !== 'utf-8') meta.append(h('span', { text: enc.toUpperCase() }));
    if (src?.eol === 'crlf') meta.append(h('span', { text: 'CRLF' }));
    if (src?.label) meta.append(h('span', { class: 'ok', text: src.label }));
    if (src?.url) meta.append(h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', text: this.t('doc.open') }));
    if (c.readOnly) meta.append(h('span', { class: 'db-trust tone-warn', title: c.readOnlyReason === 'format' ? this.t('doc.readonly.format.hint') : '', text: this.t('doc.readonly') }));
    // 형식과 Claude 가 이 형식에 할 수 있는 일(D87) — 바로 고치기 · 제안만 · 읽기만
    const f = this.fmt;
    if (f.kind !== 'markdown') meta.append(h('span', { class: 'db-fmt', text: f.label }));
    const cc = claudeChanges(f);
    if (cc.length < 2 && this.app.ad.runs) meta.append(h('span', { class: 'db-fmt claude', title: this.t(cc.length ? 'doc.claude.propose.hint' : 'doc.claude.read.hint', { ai: this.app.ai }), text: this.t(cc.length ? 'doc.claude.propose' : 'doc.claude.read', { ai: this.app.ai }) }));
    // 디스크와 맞춰 본 때 + 다시 읽기 — 도구 밖(에디터·터미널의 Claude)에서 고쳐도 화면이 최신인지 보이게
    this.els.fresh = h('span', { class: 'db-fresh' });
    meta.append(this.els.fresh, h('button', { class: 'db-btn ghost sm db-refresh', type: 'button', title: this.t('doc.refresh.hint'), onclick: () => void this.refresh(), html: icon('refresh') + ' ' + this.t('doc.refresh') }));
    this.paintFresh();
    clearInterval(this.freshT);
    this.freshT = setInterval(() => this.paintFresh(), 4000);
    if (meta.childNodes.length) head.append(meta);
    // 앞머리 메타데이터 — 상태·담당·꼬리표·기한 (개요와 같은 규칙)
    if (markdownLike(this.fmt) && c.md.startsWith('---')) {
      const dm = docMetaOf(frontMatterData(c.md));
      const chips = h('div', { class: 'db-fm' });
      if (dm.status) chips.append(h('span', { class: 'db-fm-c status', title: 'status', text: dm.status }));
      for (const o of dm.owners) chips.append(h('span', { class: 'db-fm-c owner', html: icon('user') }, o));
      for (const tg of dm.tags) chips.append(h('span', { class: 'db-fm-c tag', text: '#' + tg }));
      for (const d of dm.dates) chips.append(h('span', { class: 'db-fm-c date' + (d.past ? ' past' : ''), title: d.past ? this.t('doc.meta.past') : '', html: icon('clock') }, `${d.field} ${d.date}`));
      if (chips.childNodes.length) head.append(chips);
    }
    if (m.notice) head.append(h('p', { class: 'db-notice tone-' + (m.notice.tone || 'warn'), text: m.notice.text }));
    // 팀 규칙 파일(D90) — 무엇인지와 점검 결과로 가는 길
    if (this.id === RULES_FILE) head.append(h('div', { class: 'db-notice tone-info db-row' }, h('span', { text: this.t('doc.rules') }),
      this.app.hasOverview() ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void this.app.navigate('overview') }, this.t('doc.rules.see')) : null));
    // 뽑은 글·잘린 글·못 뽑은 글 — 무엇을 보고 있는지 + 원본 내려받기
    const dl = () => (this.app.ad.docs.loadBytes ? downloadButton(this.id, { t: this.t, loadBytes: (id) => this.app.ad.docs.loadBytes!(id) }, head, this.t('view.download.original')) : null);
    if (f.kind === 'derived' && c.deriveError) head.append(h('div', { class: 'db-notice tone-warn db-row' }, h('span', { text: this.t('doc.derive.fail.' + (['too-large', 'not-zip', 'unsupported'].includes(c.deriveError) ? c.deriveError : 'broken'), { fmt: f.label }) }), dl()));
    else if (f.kind === 'derived') head.append(h('div', { class: 'db-notice tone-info db-row' }, h('span', { text: this.t('doc.derived', { fmt: f.label }) }), dl()));
    else if (c.truncated) head.append(h('div', { class: 'db-notice tone-warn db-row' }, h('span', { text: this.t('doc.truncated', { shown: fmtBytes(c.truncated.bytes), total: fmtBytes(c.truncated.total) }) }), dl()));
    else if (f.kind === 'binary' && f.view === 'image') meta.append(dl() || '');
    if (c.readOnly && (c.readOnlyReason === 'encoding' || c.readOnlyReason === 'invalid-utf8')) head.append(h('p', { class: 'db-notice tone-warn', text: this.t('doc.readonly.' + c.readOnlyReason, { enc: (enc || '').toUpperCase() }) }));
    this.els.head = head;
    return head;
  }

  private renderToolbar(): HTMLElement {
    const tb = h('div', { class: 'db-toolbar' });
    this.els.toolbar = tb;
    this.els.seg = h('div', { class: 'db-seg', role: 'group', 'aria-label': this.t('doc.depth') });
    this.els.chips = h('div', { class: 'db-chips' });
    const fi = h('input', { type: 'search', placeholder: this.t('doc.find'), 'aria-label': this.t('doc.find') }) as HTMLInputElement;
    const cnt = h('span', { class: 'cnt' });
    this.els.find = fi; this.els.findCnt = cnt;
    const run = debounce(() => this.runFind(fi.value), 220);
    fi.addEventListener('input', run);
    fi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.nextHit(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { fi.value = ''; this.clearFind(); fi.blur(); } });
    tb.append(h('span', { class: 'db-lbl', text: this.t('doc.depth') }), this.els.seg, this.els.chips, h('label', { class: 'db-find' }, fi, cnt));
    if (this.app.ad.docs.loadBase) {
      tb.append(h('button', { class: 'db-btn sm', type: 'button', onclick: (e: Event) => void this.toggleBase(e.currentTarget as HTMLButtonElement) }, this.t('doc.base', { label: '…' })));
      void this.app.ad.docs.loadBase(this.id).then((b) => {
        const btn = tb.querySelector<HTMLButtonElement>('.db-btn.sm');
        if (!btn) return;
        if (!b) btn.remove(); else btn.textContent = this.t('doc.base', { label: b.label });
      }).catch(() => tb.querySelector('.db-btn.sm')?.remove());
    }
    if (this.canEdit()) tb.append(h('button', { class: 'db-btn sm', type: 'button', onclick: () => this.openEditor(null), html: icon('edit') }, this.t('doc.editAll')));
    // 표·HTML·SVG: 원문 보기 ↔ 그려 보기
    if (hasSourceToggle(this.fmt)) tb.append(h('button', { class: 'db-btn sm db-srcbtn', type: 'button', 'aria-pressed': String(this.sourceView), onclick: (e: Event) => {
      this.sourceView = !this.sourceView;
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(this.sourceView));
      this.rerender(this.content, undefined, true);
    }, html: icon('code') }, this.t('doc.source')));
    // 양방향: 내가 다 읽기 전에 Claude 에게 먼저 — 제안·질문 받기, 읽기 정리(접기·먼저 볼 곳)
    if (this.app.canReview()) tb.append(h('button', { class: 'db-btn sm db-review-btn', type: 'button', title: this.t('review.btn.hint'), onclick: () => void this.app.reviewMenu(), html: icon('spark') }, this.t('review.btn')));
    if (this.app.can('feedback.create')) tb.append(h('button', { class: 'db-btn sm', type: 'button', title: this.t('doc.feedback.whole.hint'), onclick: (e: Event) => this.app.composer.open({ docId: this.id, whole: true }, e.currentTarget as HTMLElement), html: icon('chat') }, this.t('doc.feedback.whole')));
    // 피드백을 그 자리에 말풍선으로 · 중요도·종류로 골라 보기(D85) — 말풍선과 검토 패널이 같은 조건을 따른다
    this.els.bub = h('button', { class: 'db-btn sm db-bub-btn', type: 'button', title: this.t('lens.bubbles.hint'), onclick: () => this.app.setLens({ bubbles: !this.app.lens?.bubbles }) }) as HTMLButtonElement;
    this.els.lens = h('button', { class: 'db-btn sm db-lens-btn', type: 'button', 'data-lens': 'doc', 'aria-expanded': 'false', 'aria-haspopup': 'dialog', title: this.t('lens.btn.hint'), onclick: (e: Event) => openLens(this.app, e.currentTarget as HTMLElement) }) as HTMLButtonElement;
    tb.append(this.els.bub, this.els.lens);
    this.paintLens();
    this.els.stats = h('span', { class: 'db-stats' });
    tb.append(this.els.stats);
    return tb;
  }

  /** 인코딩 때문에 읽기 전용인 문서는 편집을 열어 두고, 저장 때 UTF-8 변환 동의를 받는다 */
  canEdit(): boolean {
    // 뽑은 글·미리보기·앞부분만 보인 큰 글은 고치지 않는다(D87)
    if (!editableFormat(this.fmt) || this.content?.truncated) return false;
    return this.app.can('doc.edit') && !this.meta.readOnly && !(this.content?.readOnly && !['encoding', 'invalid-utf8'].includes(this.content.readOnlyReason || ''));
  }
  /** 이 문서의 형식 (core/formats) */
  get fmt() { return formatFor(this.id); }
  /** 표·HTML·SVG 를 원문으로 보는 중 */
  private sourceView = false;

  private renderedVersion = '';
  private renderBody(): void {
    this.renderedVersion = this.content.version;
    releaseDoc(this.article);
    const docs = this.app.ad.docs;
    const art = renderDoc(this.content, { t: this.t, loadBytes: docs.loadBytes ? (id) => docs.loadBytes!(id) : undefined, source: this.sourceView });
    decorate(art, this.app.rules);
    this.secs = sectionize(art);
    this.article = art as unknown as HTMLElement;
    this.textCache.clear();
    for (const s of this.secs) {
      s.head.querySelector('.db-caret')!.addEventListener('click', () => this.toggle(s));
      s.heading.addEventListener('dblclick', () => this.toggle(s));
      const acts = s.head.querySelector('.db-sec-acts')!;
      if (this.app.can('feedback.create')) acts.append(h('button', { class: 'db-act', type: 'button', title: this.t('doc.feedback'), onclick: (e: Event) => { e.stopPropagation(); this.app.composer.open({ docId: this.id, sec: s }, s.head); }, html: icon('chat') }, this.t('doc.feedback')));
      if (this.canEdit()) acts.append(h('button', { class: 'db-act', type: 'button', title: this.t('doc.edit'), onclick: (e: Event) => { e.stopPropagation(); this.openEditor(s); }, html: icon('edit') }, this.t('doc.edit')));
    }
    // 깊이 버튼
    const st = this.app.docState(this.id);
    if (st.depth == null) st.depth = this.meta.depth ?? (this.secs.length > 24 ? 3 : 9);
    const seg = this.els.seg!;
    seg.replaceChildren();
    for (const o of this.depthOptions()) seg.append(h('button', { type: 'button', 'data-d': o.d, 'aria-pressed': String(st.depth === o.d), onclick: () => this.setDepth(o.d) }, o.t));
    seg.hidden = seg.childNodes.length <= 1;
    (seg.previousElementSibling as HTMLElement).hidden = seg.hidden;
    // 이름표
    const counts: Record<string, number> = {};
    for (const li of $$('li[data-label]', art)) counts[li.dataset.label!] = (counts[li.dataset.label!] || 0) + 1;
    const labels = Object.entries(counts).filter(([, c]) => c >= this.app.rules.labelMinRepeat).map(([l]) => l);
    const chips = this.els.chips!;
    chips.replaceChildren();
    if (labels.length) {
      chips.append(h('span', { class: 'db-lbl', text: this.t('doc.labels') }),
        h('button', { class: 'db-chip all', type: 'button', 'aria-pressed': 'true', onclick: () => { st.hiddenLabels = []; this.app.saveState(); this.applyLabels(); } }, this.t('doc.labels.all')));
      for (const l of labels) chips.append(h('button', { class: 'db-chip', type: 'button', 'data-l': l, title: this.t('doc.labels.hint'), onclick: () => {
        const hid = new Set(st.hiddenLabels || []);
        if (hid.size === 0) labels.forEach((x) => x !== l && hid.add(x));
        else if (hid.has(l)) hid.delete(l); else hid.add(l);
        if (hid.size >= labels.length) hid.clear();
        st.hiddenLabels = [...hid]; this.app.saveState(); this.applyLabels();
      } }, l));
    }
    this.applyFolds();
    this.applyLabels();
    this.anchorFeedback();
    this.renderStats();
  }

  private renderStats(): void {
    const s = this.els.stats!;
    s.replaceChildren(h('span', {}, this.t('doc.sections') + ' ', h('b', { text: this.secs.length })));
    // 빈칸 수는 레일·섹션과 같은 기준: 본문 글자만 센다 (인라인 코드로 쓴 `[작업 후 기입]` 은 표기 설명이지 빈칸이 아니다)
    const todo = this.article.querySelectorAll('mark.db-todo').length;
    if (todo) s.append(h('span', {}, this.t('doc.todos') + ' ', h('b', { text: todo })));
  }

  /**
   * 저장·외부 변경 뒤 다시 그린다. 접힘·스크롤·현재 섹션을 지킨다.
   * own = 내가 이 화면에서 저장한 것(바뀜 표시를 하지 않는다). { mine } 이면 그 섹션들만 내 것 —
   * 더 새 판 위에 끼워 저장했을 때 함께 들어온 남의 변경은 표시한다.
   */
  rerender(content: DocContent, focusIndex?: number, own: boolean | { mine: Set<string> } = false): void {
    const prev = this.content;
    const main = this.app.els.main;
    const keepTop = main.scrollTop;
    const curIdx = focusIndex ?? this.current?.index;
    this.content = content;
    const old = this.article;
    this.renderBody();
    old.replaceWith(this.article);
    if (!own && prev && prev.md !== content.md && !this.changed) {
      this.changed = diffSections(prev.md, content.md, this.id);
      this.changedFrom = prev.version;
      this.changedOldMd = prev.md;
    }
    if (typeof own === 'object' && prev && prev.md !== content.md) {
      const d = diffSections(prev.md, content.md, this.id);
      const theirs = [...d.changed, ...d.added, ...d.removed].some((k) => !own.mine.has(k));
      if (theirs && (!this.changed || this.changedOldMd == null)) { this.changedFrom = prev.version; this.changedOldMd = prev.md; }
      if (this.changedOldMd != null && (theirs || this.changed)) {
        const all = diffSections(this.changedOldMd, content.md, this.id);
        const keep = (ks: string[]) => ks.filter((k) => !own.mine.has(k));
        this.changed = { ...all, changed: keep(all.changed), added: keep(all.added), removed: keep(all.removed) };
      }
    } else if (own && this.changed && this.changedOldMd != null) {
      // 내가 고친 섹션은 표시에서 뺀다 — 남이 바꾼 것만 남는다
      const mine = diffSections(prev?.md || '', content.md, this.id);
      const drop = new Set([...mine.changed, ...mine.added]);
      this.changed = { ...this.changed, changed: this.changed.changed.filter((k) => !drop.has(k)), added: this.changed.added.filter((k) => !drop.has(k)) };
    }
    this.markChanged();
    main.scrollTop = keepTop;
    if (curIdx != null && this.secs[curIdx]) this.reveal(this.secs[curIdx].key, focusIndex == null);
    this.app.renderRail();
  }

  async onExternalChange(manual = false): Promise<void> {
    try {
      const fresh = await this.app.ad.docs.load(this.id);
      // 내 저장이 돌아온 알림이면(판이 같으면) 아무것도 하지 않는다 — 편집 중에 "방금 바뀜" 거짓 경고를 띄우지 않게
      if (fresh.version === this.content.version) { if (manual) this.app.toast(this.t('doc.refresh.same')); return; }
      if (this.editor) { this.editor.externalChanged(fresh); return; }
      await this.showFresh(fresh);
    } catch { /* 다음 이벤트 때 다시 */ }
  }

  /** 바깥에서 바뀐 판을 그린다 — 바뀐 글 표시·누가·언제와 함께 */
  async showFresh(fresh: DocContent): Promise<void> {
    // 편집기에서 "그쪽 글 받기"를 했으면 판은 같아도 본문 그림이 예전 것이다
    if (fresh.version === this.content.version) { if (this.renderedVersion !== fresh.version) this.rerender(fresh, undefined, true); return; }
    try {
      const prev = this.content;
      // 이미 보여 주던 바뀜이 있으면 그 기준(마지막으로 본 판)을 지킨다 — 두 번 바뀌어도 "본 뒤로 바뀐 것" 전부가 보이게
      if (!this.changed || this.changedOldMd == null) { this.changedFrom = prev.version; this.changedOldMd = prev.md; }
      this.changed = this.dropAcked(diffSections(this.changedOldMd, fresh.md, this.id), fresh.md);
      this.rerender(fresh);
      this.markSeen(fresh.version);
      await this.loadChangeInfo();
      this.showBanner();
      this.app.toast(this.t('doc.reloaded'), { weak: true });
    } catch { /* 다음 이벤트 때 다시 */ }
  }

  /** 다시 읽기: 디스크와 맞춰 보고(바깥 편집이면 이력에 남김) 바뀐 것을 보여 준다 */
  async refresh(): Promise<void> {
    try { await this.app.ad.docs.refresh?.(this.id); } catch { /* 읽기만 해 본다 */ }
    await this.onExternalChange(true);
    this.paintFresh();
  }

  private paintFresh(): void {
    const el = this.els.fresh;
    if (!el) return;
    const at = this.app.ad.docs.checkedAt?.(this.id);
    const live = this.app.fbMode === 'live';
    // 확인 시각을 모르는 저장소(연습 공간 등)는 "확인 중"을 띄워 두지 않는다 — 끝나지 않는 표시로 보였다(주인 폰 실사용)
    el.hidden = !live && !this.app.ad.docs.checkedAt;
    el.textContent = live ? this.t('doc.fresh.live') : at ? this.t('doc.fresh.at', { ago: relTime(new Date(at).toISOString(), this.t) }) : this.t('doc.fresh.pending');
    el.title = this.t(live ? 'doc.fresh.live.hint' : 'doc.fresh.poll.hint');
    el.classList.toggle('live', live);
  }

  /** Claude 가 이 문서의 피드백을 처리하는 중이면 위에 한 줄 */
  renderBusy(): void {
    const b = this.els.busy;
    if (!b) return;
    const dock = this.app.dock;
    const busy = dock?.busyDocs().has(this.id);
    // 터미널을 기다리는 요청은 "처리 중"이 아니다 — 사람이 한 줄을 쳐야 시작한다
    const waiting = !busy ? dock?.waitingDocs().get(this.id) : undefined;
    b.hidden = !busy && !waiting;
    if (busy) b.replaceChildren(h('span', { class: 'db-spin' }), this.t('doc.busy'), h('button', { class: 'db-btn ghost sm', type: 'button', onclick: () => dock?.setOpen(true) }, this.t('run.open')));
    else if (waiting) b.replaceChildren(h('span', { class: 'ic', html: icon('clock') }), this.t('doc.waitingTerminal'), h('button', { class: 'db-btn ghost sm', type: 'button', onclick: () => dock?.showTerminal(waiting) }, this.t('sent.terminal.show')));
  }

  // ------------------------------------------------------------ 바뀐 섹션
  async showChangedSince(version: string, openDiff: boolean): Promise<void> {
    if (!this.app.ad.docs.loadVersion || version === this.content.version) return;
    let old: DocContent | null = null;
    try { old = await this.app.ad.docs.loadVersion(this.id, version); } catch { old = null; }
    if (!old || this.destroyed) return;
    this.changed = this.dropAcked(diffSections(old.md, this.content.md, this.id), this.content.md);
    this.changedFrom = version;
    this.changedOldMd = old.md;
    this.markChanged();
    await this.loadChangeInfo();
    this.showBanner(openDiff ? old.md : undefined);
  }

  /** 이력에서 "본 뒤로" 이 문서를 바꾼 기록을 찾아 섹션마다 누가·언제 */
  private async loadChangeInfo(): Promise<void> {
    this.changeBy.clear();
    this.changeWho = [];
    if (!this.changedFrom || !this.app.ad.docs.changes) return;
    let list: ChangeEntry[] = [];
    try { list = (await this.app.ad.docs.changes(300)).filter((c) => c.docId === this.id); } catch { return; }
    // 마지막으로 본 판에서 지금 판까지 이어지는 기록 (뒤에서부터 거슬러 올라간다)
    const chain: ChangeEntry[] = [];
    let want = this.content.version;
    for (let i = list.length - 1; i >= 0 && want !== this.changedFrom; i--) {
      const c = list[i];
      if (c.toVersion !== want) continue;
      chain.unshift(c);
      if (!c.fromVersion) break;
      want = c.fromVersion;
    }
    const who = (c: ChangeEntry) => this.app.personLabel(c.by) || this.t('fb.by.me');
    const tally = new Map<string, { who: string; when: string; n: number }>();
    for (const c of chain) {
      const w = who(c);
      const when = fmtTime(c.at).slice(11) || relTime(c.at, this.t);
      const entry = { who: w + (c.feedbackIds?.length ? ' · ' + this.t('changes.fb', { n: c.feedbackIds.length }) : ''), when, summary: c.summary };
      for (const k of [...(c.sections || []), ...(c.removed || [])]) (this.changeBy.get(k) || this.changeBy.set(k, []).get(k)!).unshift(entry);
      const tw = tally.get(w) || { who: w, when, n: 0 };
      tw.n++; tw.when = when;
      tally.set(w, tw);
    }
    this.changeWho = [...tally.values()];
    this.updateBadges();
  }

  /** 마우스를 올린 바뀐 섹션의 누가·언제 (hover.ts) */
  changeInfo(key: string): { kind: 'new' | 'changed'; by: { who: string; when: string; summary?: string }[] } | null {
    const s = this.findSec(key);
    if (!s || !s.el.dataset.changed) return null;
    return { kind: s.el.dataset.changed === 'new' ? 'new' : 'changed', by: this.changeBy.get(key) || [] };
  }

  private markChanged(): void {
    if (!this.changed) return;
    const set = new Set([...this.changed.changed, ...this.changed.added]);
    for (const s of this.secs) s.el.dataset.changed = set.has(s.key) ? (this.changed.added.includes(s.key) ? 'new' : 'changed') : '';
    this.paintChangeMarks();
    this.updateBadges();
  }

  /** 바뀐 섹션 안에 더한 글·지운 글을 그린다 (끄면 걷는다) */
  private paintChangeMarks(): void {
    if (!this.article) return;
    clearChangeMarks(this.article);
    this.bigChange.clear();
    this.article.classList.toggle('db-show-chg', this.app.state.showChanges !== false);
    if (!this.changed || this.changedOldMd == null || this.app.state.showChanges === false) return;
    // 글 안의 더한·지운 글 표시는 마크다운 화면에서만 — 구조 글·글·표는 섹션(·문서) 단위 표시와 차이 보기로
    if (!markdownLike(this.fmt)) return;
    const oldMd = this.changedOldMd.replace(/\r\n?/g, '\n');
    const olds = new Map(sectionSources(oldMd, this.id).map((x) => [x.key, oldMd.slice(x.start, x.bodyEnd)]));
    for (const key of this.changed.changed) {
      const s = this.secs.find((x) => x.key === key);
      const before = olds.get(key);
      if (!s || before == null) continue;
      try {
        const r = markSectionChanges(s.el, before, this.app.rules);
        if (r.big) { this.bigChange.add(key); s.el.dataset.changed = 'big'; }
      } catch { /* 표시만 못 한다 */ }
    }
    this.textCache.clear();
  }

  private toggleChangeMarks(): void {
    this.app.state.showChanges = this.app.state.showChanges === false;
    this.app.saveState();
    this.markChanged();
    this.showBanner();
  }

  /** 다음·이전 바뀐 곳으로 */
  private stepChange(dir: number): void {
    const list = this.secs.filter((s) => s.el.dataset.changed);
    if (!list.length) return;
    this.changeI = (this.changeI + dir + list.length) % list.length;
    const s = list[this.changeI];
    this.openTo(s);
    this.setCurrent(s);
    const first = s.el.querySelector('ins.db-chg-ins, del.db-chg-del') as HTMLElement | null;
    (first || s.head).scrollIntoView({ block: first ? 'center' : 'start', behavior: 'smooth' });
    s.head.classList.add('db-flash');
    setTimeout(() => s.head.classList.remove('db-flash'), 1400);
    const cnt = this.els.banner?.querySelector('.db-chg-pos');
    if (cnt) cnt.textContent = `${this.changeI + 1}/${list.length}`;
  }

  private ackChanges(): void {
    const b = this.els.banner!;
    b.hidden = true;
    this.changed = null;
    this.changedOldMd = null;
    this.changeBy.clear();
    for (const s of this.secs) s.el.dataset.changed = '';
    clearChangeMarks(this.article);
    this.textCache.clear();
    this.updateBadges();
    this.els.diffSlot!.replaceChildren();
    this.markSeen(this.content.version);
    this.app.renderRail();
  }

  /** 아직 확인하지 않은 바뀜이 있으나 */
  private pendingChanges(): boolean {
    const c = this.changed;
    return !!c && this.changedOldMd != null && (c.changed.length + c.added.length + c.removed.length + (c.preamble ? 1 : 0)) > 0;
  }
  /** 섹션 글의 지문(확인한 섹션을 다시 열어도 기억 — 글이 또 바뀌면 지문이 달라 다시 보인다) */
  private static mark(md: string, key: string, id?: string): string {
    const s = getSectionText(md, key, id) ?? '';
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return s.length.toString(36) + '.' + x.toString(36);
  }
  /** 하나씩 확인한 섹션(그 뒤로 그대로인 것)은 바뀐 표시에서 뺀다 */
  private dropAcked(d: SectionDiff, md: string): SectionDiff {
    const acked = this.app.docState(this.id).acked;
    if (!acked) return d;
    const keep = (ks: string[]) => ks.filter((k) => acked[k] == null || acked[k] !== DocView.mark(md, k, this.id));
    return { ...d, changed: keep(d.changed), added: keep(d.added) };
  }
  /** 아직 확인하지 않은 바뀐 섹션 키 — 읽기 정리가 이 섹션(과 그 위 섹션)은 접지 않는다 */
  changedKeys(): string[] {
    return this.pendingChanges() && this.changed ? [...this.changed.changed, ...this.changed.added] : [];
  }
  /** 본 판 적기 — 확인 전의 바뀜이 있으면 그 기준(마지막으로 확인한 판)을 지킨다 */
  markSeen(version: string): void {
    const st = this.app.docState(this.id);
    const pending = this.pendingChanges() && this.changedFrom;
    st.lastSeen = pending ? this.changedFrom! : version;
    // 본 판이 지금으로 넘어가면 하나씩 확인한 기억은 필요 없다
    if (!pending) delete st.acked;
    this.app.saveState();
  }

  /** 화면 밖 단추(되돌리기 등)로 내가 저장한 판 — 바뀜 표시 없이 그린다 */
  ownSave(docId: string, content: DocContent): void {
    if (docId !== this.id || this.destroyed) return;
    if (this.editor) { this.editor.externalChanged(content); return; }
    this.rerender(content, undefined, true);
    this.refreshBanner();
    this.markSeen(content.version);
  }

  /**
   * 이 섹션들의 바뀜은 봤다 — 볼 것에서 Claude 의 고침을 확인하면 문서의 표시에서도 뺀다(같은 것을 두 번 확인하지 않게).
   * '*' = 문서 전체. 하위 섹션도 함께. 남은 바뀜(남이 고친 것)은 그대로
   */
  ackSections(keys: string[] | '*'): void {
    if (!this.changed || this.destroyed) return;
    if (keys === '*') { this.ackChanges(); return; }
    const hit = (k: string) => keys.some((x) => k === x || k.startsWith(x + KEY_SEP));
    // 다시 열어도 기억 — 본 판(lastSeen)은 남은 바뀜 때문에 그대로라 섹션마다 지문을 남긴다
    const st = this.app.docState(this.id);
    const acked = { ...(st.acked || {}) };
    for (const k of [...this.changed.changed, ...this.changed.added]) if (hit(k)) acked[k] = DocView.mark(this.content.md, k, this.id);
    st.acked = acked;
    this.changed = { ...this.changed, changed: this.changed.changed.filter((k) => !hit(k)), added: this.changed.added.filter((k) => !hit(k)) };
    this.markChanged();
    this.refreshBanner();
    this.markSeen(this.content.version);
    this.app.renderRail();
  }

  /** 바뀐 섹션 수가 달라졌을 때 머리 띠를 다시 센다 — 남은 게 없으면 닫는다(문서를 옮기지 않는다) */
  private refreshBanner(): void {
    if (!this.changed || !this.els.banner || this.els.banner.hidden) return;
    if (!this.pendingChanges() && !this.changed.removed.length) { this.ackChanges(); return; }
    this.showBanner(undefined, false);
  }

  /** Claude 의 읽기 정리 안내 — 문서는 그대로, 내 화면의 접기만 바꿨다 */
  showGuide(): void {
    const el = this.els.guide;
    if (!el) return;
    const st = this.app.docState(this.id);
    const t = this.t;
    if (!st.guide && !st.foldsBefore) { el.hidden = true; el.replaceChildren(); return; }
    el.replaceChildren(
      h('div', { class: 'db-guide-t' },
        h('b', { html: icon('eye') + ' ' + t('view.guide') }),
        st.guide ? h('p', { text: st.guide }) : null),
      h('div', { class: 'db-guide-a' },
        st.foldsBefore ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => this.app.undoReadingPlan(this.id) }, t('view.undo')) : null,
        h('button', { class: 'db-btn sm ghost', type: 'button', onclick: () => { delete st.guide; delete st.foldsBefore; this.app.saveState(); this.showGuide(); } }, t('view.keep'))));
    el.hidden = false;
  }

  private showBanner(oldMd?: string, jump = true): void {
    const b = this.els.banner!;
    const c = this.changed;
    if (!c) return;
    const n = c.changed.length + c.added.length + (c.preamble ? 1 : 0);
    if (!n && !c.removed.length) { b.hidden = true; return; }
    const t = this.t;
    const on = this.app.state.showChanges !== false;
    const who = this.changeWho.length ? this.changeWho.map((w) => `${w.who} ${w.when}`).join(', ') : '';
    b.replaceChildren(
      h('div', { class: 'db-banner-t' },
        h('b', { text: t('doc.changedSince', { n }) }),
        c.removed.length ? h('span', { title: c.removed.map((k) => k.split(KEY_SEP).pop()).join(', '), text: ' ' + t('doc.changedSince.removed', { n: c.removed.length }) }) : null,
        who ? h('span', { class: 'db-hint', text: ' — ' + who }) : null,
        h('div', { class: 'db-hint', text: on ? t('doc.change.legend') : t('doc.change.off') })),
      h('div', { class: 'db-banner-a' },
        h('button', { class: 'db-btn sm', type: 'button', title: t('doc.change.prev'), onclick: () => this.stepChange(-1) }, '‹'),
        h('span', { class: 'db-chg-pos db-hint', text: '' }),
        h('button', { class: 'db-btn sm', type: 'button', title: t('doc.change.next'), onclick: () => this.stepChange(1) }, t('doc.change.next') + ' ›'),
        h('button', { class: 'db-btn sm', type: 'button', 'aria-pressed': String(on), onclick: () => this.toggleChangeMarks(), html: icon('eye') + ' ' + (on ? t('doc.change.hide') : t('doc.change.show')) }),
        h('button', { class: 'db-btn sm', type: 'button', onclick: () => void this.toggleSinceDiff() }, t('doc.changedSince.diff')),
        h('button', { class: 'db-btn sm ghost', type: 'button', title: t('doc.change.ok.hint'), onclick: () => this.ackChanges() }, t('doc.changedSince.ok'))),
    );
    b.hidden = false;
    if (oldMd != null) this.els.diffSlot!.replaceChildren(renderDiff(lineDiff(oldMd, this.content.md), this.t));
    this.changeI = -1;
    const first = jump ? this.secs.find((s) => s.el.dataset.changed) : undefined;
    if (first) this.openTo(first);
  }

  private async toggleSinceDiff(): Promise<void> {
    const slot = this.els.diffSlot!;
    if (slot.childNodes.length) { slot.replaceChildren(); return; }
    if (!this.changedFrom || !this.app.ad.docs.loadVersion) return;
    const old = await this.app.ad.docs.loadVersion(this.id, this.changedFrom).catch(() => null);
    if (old) slot.replaceChildren(renderDiff(lineDiff(old.md, this.content.md), this.t));
  }

  private async toggleBase(btn: HTMLButtonElement): Promise<void> {
    const slot = this.els.diffSlot!;
    if (slot.dataset.base === '1') { slot.replaceChildren(); slot.dataset.base = ''; btn.setAttribute('aria-pressed', 'false'); return; }
    const b = await this.app.ad.docs.loadBase!(this.id).catch(() => null);
    if (!b) return;
    slot.replaceChildren(renderDiff(lineDiff(b.md, this.content.md), this.t, b.label));
    slot.dataset.base = '1';
    btn.setAttribute('aria-pressed', 'true');
  }

  // ------------------------------------------------------------ 접기
  private depthOptions(): { d: number; t: string }[] {
    const lv = [...new Set(this.secs.filter((s) => s.level >= 2).map((s) => s.level))].sort((a, b) => a - b).slice(0, 3);
    const out = lv.map((d, i) => ({ d, t: i === 0 ? this.t('doc.depth.toc') : this.t('doc.depth.n', { n: i + 1 }) }));
    if (out.length) out.push({ d: 9, t: this.t('doc.depth.all') });
    return out;
  }
  setDepth(d: number): void {
    const st = this.app.docState(this.id);
    st.depth = d; st.folds = {};
    this.app.saveState();
    this.applyFolds();
    for (const b of Array.from(this.els.seg!.children)) b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.d) === d));
  }
  setDepthIndex(i: number): void { const o = this.depthOptions()[i]; if (o) this.setDepth(o.d); }

  private hasBody(s: Section): boolean { return Array.from(s.body.childNodes).some((n) => n.nodeType === 1 || (n.nodeType === 3 && (n as Text).data.trim())); }
  isCollapsed(s: Section): boolean {
    if (s.level === 1) return false;
    const st = this.app.docState(this.id);
    if (st.folds && s.key in st.folds) return !!st.folds[s.key];
    return s.level >= (st.depth ?? 9) && this.hasBody(s);
  }
  applyFolds(): void { for (const s of this.secs) this.setCollapsed(s, this.isCollapsed(s)); this.updateBadges(); }
  private setCollapsed(s: Section, c: boolean): void {
    s.el.dataset.collapsed = String(c);
    s.head.querySelector('.db-caret')!.setAttribute('aria-expanded', String(!c));
    if (c) {
      const subs = s.body.querySelectorAll('.db-sec').length;
      const todo = s.body.querySelectorAll('mark.db-todo').length;
      const parts = [this.t('doc.collapsed')];
      if (subs) parts.push(this.t('doc.sub', { n: subs }));
      if (todo) parts.push(this.t('doc.todos') + ' ' + todo);
      s.head.querySelector('.db-sec-sum')!.textContent = parts.join(' · ');
    }
  }
  toggle(s: Section): void {
    if (s.level === 1) return;
    const c = !this.isCollapsed(s);
    (this.app.docState(this.id).folds ||= {})[s.key] = c;
    this.app.saveState();
    this.setCollapsed(s, c);
    this.updateBadges();
  }
  openTo(s: Section): void {
    const st = this.app.docState(this.id);
    st.folds ||= {};
    for (const a of this.secs) if (a !== s && a.el.contains(s.el) && this.isCollapsed(a)) { st.folds[a.key] = false; this.setCollapsed(a, false); }
    if (this.isCollapsed(s)) { st.folds[s.key] = false; this.setCollapsed(s, false); }
    this.app.saveState();
    this.updateBadges();
  }

  findSec(key: string): Section | null {
    return this.secs.find((s) => s.key === key)
      || this.secs.find((s) => s.path.join(KEY_SEP) === key.replace(/ #\d+$/, ''))
      || this.secs.find((s) => s.title === key.split(KEY_SEP).pop())
      || null;
  }

  reveal(key: string, smooth = true): void {
    const s = this.findSec(key);
    if (!s) return;
    this.openTo(s);
    this.setCurrent(s);
    s.head.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    s.head.classList.add('db-flash');
    setTimeout(() => s.head.classList.remove('db-flash'), 1400);
  }

  // ------------------------------------------------------------ 이름표
  applyLabels(): void {
    const hid = new Set(this.app.docState(this.id).hiddenLabels || []);
    for (const li of $$('li[data-label]', this.article)) li.classList.toggle('db-off', hid.has(li.dataset.label!));
    for (const c of $$('.db-chip', this.els.chips!)) c.setAttribute('aria-pressed', c.classList.contains('all') ? String(hid.size === 0) : String(!hid.has(c.dataset.l!)));
  }

  // ------------------------------------------------------------ 찾기
  focusFind(): void { this.els.find?.focus(); this.els.find?.select(); }
  private clearFind(): void {
    for (const m of $$('mark.db-hit', this.article)) m.replaceWith(...Array.from(m.childNodes));
    this.article.normalize();
    this.hits = []; this.hitI = -1;
    if (this.els.findCnt) this.els.findCnt.textContent = '';
  }
  private runFind(q: string): void {
    this.clearFind();
    q = q.trim();
    if (q.length < 2) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const w = document.createTreeWalker(this.article, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement as Element).closest('button,.db-sec-side,.db-editor,.db-noindex') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const ns: Text[] = [];
    while (w.nextNode()) ns.push(w.currentNode as Text);
    for (const n of ns) {
      re.lastIndex = 0;
      if (!re.test(n.data)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0; let m: RegExpExecArray | null;
      while ((m = re.exec(n.data))) {
        frag.append(n.data.slice(last, m.index));
        const mk = h('mark', { class: 'db-hit', text: m[0] });
        this.hits.push(mk); frag.append(mk);
        last = m.index + m[0].length;
      }
      frag.append(n.data.slice(last));
      n.replaceWith(frag);
    }
    this.textCache.clear();
    this.els.findCnt!.textContent = this.hits.length ? String(this.hits.length) : this.t('doc.find.none');
    if (this.hits.length) this.nextHit(1);
  }
  private nextHit(dir: number): void {
    if (!this.hits.length) return;
    if (this.hitI >= 0) this.hits[this.hitI].classList.remove('cur');
    this.hitI = (this.hitI + dir + this.hits.length) % this.hits.length;
    const m = this.hits[this.hitI];
    m.classList.add('cur');
    const s = this.secs.filter((x) => x.el.contains(m)).pop();
    if (s) this.openTo(s);
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.els.findCnt!.textContent = `${this.hitI + 1}/${this.hits.length}`;
  }

  // ------------------------------------------------------------ 피드백 앵커
  private secText(s: Section): string {
    if (!this.textCache.has(s.key)) this.textCache.set(s.key, textIndex(s.el).s);
    return this.textCache.get(s.key)!;
  }
  sectionOf(f: Feedback): Section | null {
    if (f.target.kind !== 'section') return null;
    const tg = f.target;
    const key = tg.path.join(KEY_SEP);
    const exact = f.selector ? norm(f.selector.exact) : '';
    let cands = this.secs.filter((s) => s.path.join(KEY_SEP) === key);
    if (!cands.length) cands = this.secs.filter((s) => s.title === norm(tg.heading));
    // 같은 이름 제목이 여럿이면: 적어 둔 순번 → 인용문이 들어 있는 곳 → 첫째
    const nth = tg.occurrence && tg.occurrence > 1 ? cands[tg.occurrence - 1] : cands.length > 1 ? cands[0] : undefined;
    if (cands.length > 1 && nth && (!exact || this.secText(nth).includes(exact))) return nth;
    if (cands.length > 1 && exact) { const c2 = cands.filter((s) => this.secText(s).includes(exact)); if (c2.length) cands = c2; }
    if (cands.length) return cands[0];
    if (exact) { const inner = this.secs.filter((s) => this.secText(s).includes(exact)); if (inner.length) return inner[inner.length - 1]; }
    return null;
  }
  private secOfFb = new Map<string, string>();
  anchorFeedback(): void {
    if (!this.article) return;
    clearBubbles(this.article);
    for (const m of $$('mark.db-fbq', this.article)) m.replaceWith(...Array.from(m.childNodes));
    this.article.normalize();
    this.textCache.clear();
    this.secOfFb.clear();
    const lens = this.app.lens;
    const rows = this.app.fb.filter((f) => f.docId === this.id && (f.target.kind === 'section' || (f.target.kind === 'doc' && f.selector)));
    let orphans = 0;
    for (const f of rows) {
      const s = f.target.kind === 'section' ? this.sectionOf(f) : null;
      if (f.target.kind === 'section' && !s) { orphans++; continue; }
      if (s) this.secOfFb.set(f.id, s.key);
      // 골라 보기에 들지 않는 것은 문구 표시도 하지 않는다(섹션 옆 수는 그대로 — 어디에 무엇이 남았는지는 보이게)
      if (!f.selector || !lensMatch(f, lens)) continue;
      const idx = textIndex(s ? s.el : this.article);
      const at = locate(idx.s, f.selector);
      if (!at) continue;
      const t = turnOf(f);
      const cls = 'db-fbq' + (t === 'draft' ? ' draft' : t === 'owner' ? ' owner' : t === 'assistant' ? '' : ' closed');
      for (const mk of wrapRange(idx.map, at.start, at.end, () => h('mark', { class: cls, 'data-fb': f.id }))) {
        mk.addEventListener('click', () => this.app.panel.focus(f.id));
      }
    }
    this.textCache.clear();
    const o = this.els.orphans!;
    o.hidden = !orphans;
    o.textContent = orphans ? this.t('doc.orphans', { n: orphans }) : '';
    placeBubbles(this.app, this.article, this.id, (f) => this.sectionOf(f)?.el || null);
    this.updateBadges();
  }

  /** 위 도구줄의 말풍선·골라 보기 단추 */
  paintLens(): void {
    const lens = this.app.lens;
    const b = this.els.bub, l = this.els.lens;
    if (b) { b.setAttribute('aria-pressed', String(!!lens?.bubbles)); b.innerHTML = icon('bubble') + ' '; b.append(this.t('lens.bubbles')); }
    if (l) { l.classList.toggle('on', lensFilters(lens)); l.innerHTML = icon('filter') + ' '; l.append(lensFilters(lens) ? lensSummary(this.t, lens) : this.t('lens.title')); }
  }
  sectionKeyOf(fid: string): string | undefined { return this.secOfFb.get(fid); }

  updateBadges(): void {
    if (!this.secs.length) return;
    const rows = this.app.fb.filter((f) => f.docId === this.id && this.secOfFb.has(f.id));
    for (const s of this.secs) {
      const collapsed = s.el.dataset.collapsed === 'true';
      const mine = rows.filter((f) => { const k = this.secOfFb.get(f.id)!; return k === s.key || (collapsed && k.startsWith(s.key + KEY_SEP)); });
      const c = countTurns(mine);
      const box = s.head.querySelector('.db-sec-badges')!;
      box.replaceChildren();
      const ch = s.el.dataset.changed;
      const by = this.changeBy.get(s.key)?.[0];
      if (ch) box.append(h('span', { class: 'db-badge chg', tabindex: '0', text: (ch === 'new' ? this.t('doc.newBadge') : ch === 'big' ? this.t('doc.bigBadge') : this.t('doc.changedBadge')) + (by ? ' · ' + by.who.split(' · ')[0] : '') }));
      else if (collapsed && s.body.querySelector('.db-sec[data-changed="changed"], .db-sec[data-changed="new"]')) box.append(h('span', { class: 'db-badge chg', text: '•' }));
      const open = (n: number, cls: string, title: string) => n && box.append(h('button', { class: 'db-badge ' + cls, type: 'button', title, onclick: () => this.app.panel.focus(mine.find((f) => turnOf(f) === (cls === 'closed' ? turnOf(f) : cls))?.id || mine[0].id), text: n }));
      open(c.draft, 'draft', this.t('turn.draft'));
      open(c.owner, 'owner', this.t('turn.owner'));
      open(c.assistant, 'assistant', this.t('turn.assistant'));
      if (!c.assistant && !c.owner && !c.draft) open(c.resolved + c.declined, 'closed', this.t('fb.f.closed'));
    }
  }

  // ------------------------------------------------------------ 목차(레일)
  outline(): HTMLElement | null {
    if (!this.secs.length) return null;
    const lvls = [...new Set(this.secs.map((s) => s.level).filter((l) => l >= 2))].sort((a, b) => a - b);
    if (!lvls.length) return null;
    const top = lvls[0], sub = lvls[1];
    const curTop = this.current ? this.secs.filter((s) => s.level === top && s.el.contains(this.current!.el)).pop() : null;
    const box = h('div', { class: 'db-outline' });
    this.outlineBtns.clear();
    const fbBy = new Map<string, number>();
    for (const f of this.app.fb) if (f.docId === this.id && (f.status === 'open' || f.status === 'draft')) { const k = this.secOfFb.get(f.id); if (k) fbBy.set(k, (fbBy.get(k) || 0) + 1); }
    const item = (s: Section, cls: string) => {
      let n = 0;
      for (const [k, v] of fbBy) if (k === s.key || k.startsWith(s.key + KEY_SEP)) n += v;
      const b = h('button', { class: 'db-ol ' + cls + (this.current === s ? ' cur' : ''), type: 'button', title: s.title, onclick: () => this.reveal(s.key) },
        h('span', { class: 't', text: s.title }),
        s.el.dataset.changed || s.el.querySelector('[data-changed="changed"],[data-changed="new"]') ? h('i', { class: 'chg' }) : null,
        n ? h('span', { class: 'db-dot owner', text: n }) : null);
      this.outlineBtns.set(s.key, b);
      box.append(b);
    };
    for (const s of this.secs) {
      if (s.level === top) item(s, 'h2');
      else if (sub && s.level === sub && curTop && curTop.el.contains(s.el)) item(s, 'h3');
    }
    return box;
  }

  // ------------------------------------------------------------ 현재 섹션·스크롤
  private setCurrent(s: Section | null): void {
    if (this.current === s) return;
    const prevTop = this.topOf(this.current);
    this.current?.el.classList.remove('cur');
    this.current = s;
    s?.el.classList.add('cur');
    if (this.topOf(s) !== prevTop) this.app.renderRail();
    else {
      for (const [k, b] of this.outlineBtns) b.classList.toggle('cur', k === s?.key);
    }
  }
  private topOf(s: Section | null): Section | null {
    if (!s) return null;
    const lv = Math.min(...this.secs.map((x) => x.level).filter((l) => l >= 2));
    return this.secs.filter((x) => x.level === lv && x.el.contains(s.el)).pop() || null;
  }
  private visibleSecs(): Section[] {
    return this.secs.filter((s) => s.level > 1 && !this.secs.some((a) => a !== s && a.el.contains(s.el) && a.el.dataset.collapsed === 'true'));
  }
  private bindScroll(): void {
    const main = this.app.els.main;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const top = main.getBoundingClientRect().top + 72;
        let cur: Section | null = null;
        for (const s of this.visibleSecs()) { if (s.head.getBoundingClientRect().top <= top) cur = s; else break; }
        this.setCurrent(cur);
      });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    this.cleanup.push(() => main.removeEventListener('scroll', onScroll));
  }
  step(dir: number): void {
    const vs = this.visibleSecs();
    if (!vs.length) return;
    const i = this.current ? vs.indexOf(this.current) : -1;
    const next = vs[Math.max(0, Math.min(vs.length - 1, i + dir))];
    this.setCurrent(next);
    next.head.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  toggleCurrent(): boolean { if (!this.current) return false; this.toggle(this.current); return true; }
  editCurrent(): void { if (this.canEdit()) this.openEditor(this.current); }
  commentCurrent(): void { this.app.composer.open(this.current ? { docId: this.id, sec: this.current } : { docId: this.id, whole: true }, this.current?.head || null); }

  // ------------------------------------------------------------ 문구 선택 → 피드백
  private bindSelection(): void {
    const btn = this.app.els.selbtn;
    const main = this.app.els.main;
    let ctx: { sec: Section | null; selector?: { exact: string; prefix?: string; suffix?: string } } | null = null;
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !this.app.can('feedback.create')) { btn.hidden = true; return; }
      const rg = sel.getRangeAt(0);
      const anc = rg.commonAncestorContainer;
      const ancEl = anc.nodeType === 1 ? (anc as Element) : anc.parentElement!;
      // 문서 밖에서부터(제목 위·목차) 끌어 고른 경우도 문서에 걸쳐 있으면 받는다 — 문서 전체에 적기
      const inside = this.article.contains(anc);
      if ((!inside && !rg.intersectsNode(this.article)) || ancEl.closest('.db-editor') || $$('.db-editor', this.article).some((e) => rg.intersectsNode(e))) { btn.hidden = true; return; }
      if (norm(sel.toString()).length < 2) { btn.hidden = true; return; }
      // 고른 범위를 다 담는 가장 안쪽 섹션(두 섹션에 걸치면 그 위 섹션, 그것도 없으면 문서 전체)
      const secEl = inside ? ancEl.closest('.db-sec') : null;
      const sec = this.secs.find((s) => s.el === secEl) || null;
      // 고른 글은 문서 글자로만 다시 읽는다 — sel.toString() 은 제목 옆 단추(적기·편집)·지운 글 표시까지 담아
      // 문서에서 다시 찾지 못하는 인용이 된다(제목부터 본문까지 고른 경우)
      const span = selectedSpan(textIndex(sec ? sec.el : this.article), rg);
      if (!span || span.exact.length < 2) { btn.hidden = true; return; }
      // 인용은 짧을 때만. 길게(섹션 여럿·문서 대부분) 고르면 인용 없이 그 섹션 또는 문서 전체에 적는다
      const selector = span.exact.length <= MAX_QUOTE ? makeSelector(span.text, span.start, span.end) : undefined;
      // 긴 범위가 맨 위 제목(H1) 섹션에 걸리면 — 문서 하나를 감싼 제목이 흔하다 — 그 섹션이 아니라 문서 전체에
      ctx = { sec: !selector && sec?.level === 1 ? null : sec, selector };
      const r = selRect(sel, main);
      const mr = main.getBoundingClientRect();
      btn.hidden = false;
      const bw = btn.offsetWidth;
      btn.style.left = Math.max(8, Math.min(r.left - mr.left + r.width / 2 - bw / 2, mr.width - bw - 8)) + 'px';
      btn.style.top = (r.bottom - mr.top + main.scrollTop + 8) + 'px';
    };
    const later = () => setTimeout(onSel, 10);
    this.article.addEventListener('mouseup', later);
    this.article.addEventListener('keyup', (e) => { if (e.shiftKey) later(); });
    const onChange = debounce(onSel, 300);
    document.addEventListener('selectionchange', onChange);
    const onDown = (e: Event) => e.preventDefault();
    const onClick = () => {
      if (!ctx) return;
      const sel = window.getSelection();
      const rect = sel && sel.rangeCount ? selRect(sel, main) : btn.getBoundingClientRect();
      btn.hidden = true;
      this.app.composer.open(ctx.sec || ctx.selector ? { docId: this.id, sec: ctx.sec, selector: ctx.selector } : { docId: this.id, whole: true }, rect);
    };
    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('click', onClick);
    this.cleanup.push(() => { document.removeEventListener('selectionchange', onChange); btn.removeEventListener('mousedown', onDown); btn.removeEventListener('click', onClick); btn.hidden = true; });
  }

  // ------------------------------------------------------------ 문서 안 링크
  /**
   * 문서 안 상대 링크는 작업대 안에서 연다 — 그대로 두면 화면 주소 기준으로 나가 작업대를 떠난다(단일 HTML 은 file:// 로).
   * `#제목` 은 그 섹션으로(GitHub 식 이름), `다른.md#제목` 은 그 문서를 열고 그 섹션으로. 바깥 주소는 새 창(decorate)
   */
  private bindLinks(): void {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !this.article.contains(a) || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const href = a.getAttribute('href') || '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return;
      e.preventDefault();
      const hash = href.includes('#') ? decodeURIComponentSafe(href.slice(href.indexOf('#') + 1)) : '';
      const path = href.startsWith('#') ? null : resolveRelative(this.id, href);
      if (path == null && hash) { this.revealSlug(hash); return; }
      if (!path) return;
      if (path.endsWith('/')) { void this.app.revealFolder(path.slice(0, -1)); return; }
      void this.app.openPath(path, hash);
    };
    // 본문은 다시 그릴 때마다 바뀐다 — 문서 화면(page)에 건다
    const page = this.app.els.page;
    page.addEventListener('click', onClick);
    this.cleanup.push(() => page.removeEventListener('click', onClick));
  }

  /** GitHub 식 제목 이름(#설치-방법)으로 섹션 찾아 보이기 — 없으면 아무것도 하지 않는다 */
  revealSlug(slug: string): boolean {
    const want = slugOf(slug);
    const s = this.secs.find((x) => slugOf(x.title) === want);
    if (s) this.reveal(s.key);
    return !!s;
  }

  // ------------------------------------------------------------ 편집
  openEditor(s: Section | null, init?: ConstructorParameters<typeof Editor>[2]): Editor | null {
    if (!this.canEdit()) return null;
    if (this.editor) { this.editor.focus(); return this.editor; }
    this.editor = new Editor(this, s, init);
    return this.editor;
  }
  editorClosed(): void { this.editor = null; }
}
