/**
 * 탐색기 — 왼쪽 목록의 폴더 나무를 **펼친 폴더만** 읽어 그린다(DocSource.tree, D64).
 * 드라이브 전체를 열어도 맨 위만 읽어 바로 뜬다. 폴더 안은 문서(.md) 먼저, 그다음 폴더, 다른 파일은 흐리게(많으면 접어서).
 * 고정(핀)한 폴더·문서와 최근에 연 문서는 위쪽 "작업 중"에 늘 보인다 — 큰 폴더에서도 자주 쓰는 곳으로 바로 간다.
 *
 * 범위(scope): 대시보드가 지금 프로젝트 폴더를 주면 그 폴더를 맨 위로 그린다(기록은 작업 공간 하나에 그대로).
 */
import type { TreeEntry } from '../types';
import { h, icon } from './dom';
import type { App } from './app';

/** 한 폴더에서 처음 보일 "문서가 아닌 파일" 수 — 더 있으면 "나머지 n개"로 접는다 */
const FILES_SHOWN = 30;

type Loaded = { items: TreeEntry[] } | 'loading' | 'missing';

export class Explorer {
  private cache = new Map<string, Loaded>();
  /** 문서 아닌 파일을 모두 펼친 폴더 */
  private allFiles = new Set<string>();

  constructor(private app: App) {}

  get root(): string { return this.app.scope; }
  private get t() { return this.app.t; }
  private openSet(): Set<string> { return new Set(this.app.state.open || []); }
  private setOpen(dir: string, v: boolean): void {
    const s = this.openSet();
    if (v) s.add(dir); else s.delete(dir);
    this.app.state.open = [...s].slice(-400);
    this.app.saveState();
  }
  isOpen(dir: string): boolean { return dir === this.root || this.openSet().has(dir); }

  /** 다시 읽기 — 목록이 바뀌었을 때(문서 추가·삭제). 펼친 상태는 그대로 */
  invalidate(): void {
    for (const [k, v] of this.cache) if (v !== 'loading') this.cache.delete(k);
  }

  private async load(dir: string): Promise<void> {
    const hit = this.cache.get(dir);
    if (hit && hit !== 'missing') return;
    this.cache.set(dir, 'loading');
    let items: TreeEntry[] | null = null;
    try { items = await this.app.ad.docs.tree!(dir); } catch { items = null; }
    this.cache.set(dir, items ? { items } : 'missing');
    this.app.renderRail();
  }

  /** 이 문서·폴더가 보이게 위 폴더들을 펼친다 */
  reveal(path: string): void {
    const segs = path.split('/');
    segs.pop();
    let acc = '';
    const s = this.openSet();
    let changed = false;
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (this.root && !(acc === this.root || acc.startsWith(this.root + '/'))) continue;
      if (!s.has(acc)) { s.add(acc); changed = true; }
    }
    if (changed) { this.app.state.open = [...s].slice(-400); this.app.saveState(); }
  }

  /**
   * 나무를 그린다. docRow = 앱의 문서 줄(차례 점·개요 포함), dirDots = 그 폴더 아래 피드백 수
   */
  render(docRow: (id: string, depth: number) => HTMLElement[], dirDots: (dir: string) => HTMLElement | null): HTMLElement {
    const box = h('div', { class: 'db-ftree db-explorer', role: 'tree' });
    const walk = (dir: string, depth: number) => {
      const got = this.cache.get(dir);
      if (!got || got === 'loading') {
        if (!got) void this.load(dir);
        box.append(h('div', { class: 'db-tree-note', style: `--d:${depth}`, text: this.t('tree.loading') }));
        return;
      }
      if (got === 'missing') { box.append(h('div', { class: 'db-tree-note', style: `--d:${depth}`, text: this.t('tree.missing') })); return; }
      const docs = got.items.filter((x) => x.kind === 'file' && x.doc);
      const dirs = got.items.filter((x) => x.kind === 'dir');
      const files = got.items.filter((x) => x.kind === 'file' && !x.doc);
      // README 먼저, 그다음 이름순 (항목은 이미 이름순)
      docs.sort((a, b) => Number(!/^readme\.(md|markdown)$/i.test(a.name)) - Number(!/^readme\.(md|markdown)$/i.test(b.name)));
      // 탐색기 순서: 폴더 → 문서 → 다른 파일
      for (const d of dirs) {
        const open = this.isOpen(d.path);
        const pinned = this.app.isPinned(d.path + '/');
        box.append(h('div', { class: 'db-tree-row', style: `--d:${depth}` },
          h('button', {
            class: 'db-dir', type: 'button', style: `--d:${depth}`, title: d.path + '/', role: 'treeitem', 'aria-expanded': String(open),
            onclick: () => { this.setOpen(d.path, !open); if (!open) void this.load(d.path); this.app.renderRail(); },
          },
            h('span', { class: 'car', 'aria-hidden': 'true', text: open ? '▾' : '▸' }),
            h('span', { class: 'ic', html: icon(open ? 'folderOpen' : 'folder') }),
            h('span', { class: 't', text: d.name }),
            dirDots(d.path)),
          this.pinButton(d.path + '/', pinned)));
        if (open) walk(d.path, depth + 1);
      }
      for (const d of docs) box.append(...docRow(d.path, depth));
      if (files.length) {
        const all = this.allFiles.has(dir) || files.length <= FILES_SHOWN + 5;
        for (const f of all ? files : files.slice(0, FILES_SHOWN)) {
          box.append(h('div', { class: 'db-file', style: `--d:${depth}`, title: this.t('tree.notDoc', { name: f.name }) },
            h('span', { class: 'ic', html: icon('file') }), h('span', { class: 't', text: f.name })));
        }
        if (!all) box.append(h('button', { class: 'db-tree-more', type: 'button', style: `--d:${depth}`, onclick: () => { this.allFiles.add(dir); this.app.renderRail(); } }, this.t('tree.moreFiles', { n: files.length - FILES_SHOWN })));
      }
      if (!got.items.length) box.append(h('div', { class: 'db-tree-note', style: `--d:${depth}`, text: this.t('tree.empty') }));
    };
    walk(this.root, 0);
    return box;
  }

  pinButton(key: string, pinned: boolean): HTMLElement {
    return h('button', {
      class: 'db-pin' + (pinned ? ' on' : ''), type: 'button', 'aria-pressed': String(pinned),
      title: this.t(pinned ? 'pin.off' : 'pin.on'), 'aria-label': this.t(pinned ? 'pin.off' : 'pin.on'),
      onclick: (e: Event) => { e.stopPropagation(); this.app.togglePin(key); }, html: icon('pin'),
    });
  }
}
