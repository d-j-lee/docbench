/**
 * 작업 공간 개요 (D88) — 이 공간이 무엇을 위한 곳이고(목적·폴더 역할), 무엇이 들어 있고(구성·메타데이터·AI 협업 파일),
 * 무엇을 살펴야 하는지(점검). 계산은 core/overview — 여기서는 그리고, 점검에서 바로 할 일(README 만들기·Claude 에게 맡길 초안)을 잇는다.
 *
 * 내용은 열지 않는다(메타데이터·README 첫 문단·링크만 — 저장소가 정한 한도 안). 큰 폴더면 훑은 데까지만이라고 밝힌다.
 */
import type { FeedbackCategory, FileGroup, OverviewCheck, WorkspaceOverview } from '../types';
import { formatFor, claudeChanges, formatOf } from '../core/formats';
import { RULES_FILE, rulesTemplate } from '../core/rules';
import { h, icon, fmtBytes, fmtTime, relTime } from './dom';
import { groupIcon } from './viewers';
import type { App } from './app';

/** 점검마다 바로 할 수 있는 일 */
type CheckAction =
  /** 그 문서마다 Claude 에게 맡길 초안(문서 전체 피드백) */
  | { kind: 'draft-each'; body: string; category: FeedbackCategory }
  /** 맨 위 README 에 초안 하나(목록을 담아) */
  | { kind: 'draft-readme'; body: string; category: FeedbackCategory }
  /** README 만들기 (맨 위 · 폴더마다) */
  | { kind: 'create-readme' }
  /** 팀 규칙 파일 열기 (규칙 파일의 문제) */
  | { kind: 'open-rules' };

const GROUP_ORDER: FileGroup[] = ['doc', 'data', 'code', 'office', 'pdf', 'image', 'media', 'archive', 'other'];
/** 펼치기 전에 보일 경로 수 */
const PATHS_SHOWN = 6;

/** 저장소(작업 공간)마다 지난 개요 — 작업 공간을 바꾸면 남의 개요를 보이지 않게 저장소 객체에 묶는다 */
const caches = new WeakMap<object, { at: number; ov: WorkspaceOverview }>();
/** 다시 읽기 전까지 쓰는 시간 — 개요는 폴더 전체를 훑는다 */
const FRESH_MS = 30_000;

export function invalidateOverview(app: App): void { caches.delete(app.ad.docs); }

export async function renderOverview(app: App, force = false): Promise<void> {
  const t = app.t;
  const page = app.els.page;
  if (!app.ad.docs.overview) { page.replaceChildren(h('p', { class: 'db-empty', text: t('overview.none') })); return; }
  let cache = caches.get(app.ad.docs);
  if (!cache || force || Date.now() - cache.at > FRESH_MS) {
    if (!cache) page.replaceChildren(h('p', { class: 'db-loading', text: t('overview.loading') }));
    try {
      const ov = await app.ad.docs.overview();
      if (!ov) { page.replaceChildren(h('p', { class: 'db-empty', text: t('overview.none') })); return; }
      cache = { at: Date.now(), ov };
      caches.set(app.ad.docs, cache);
    } catch (e) {
      page.replaceChildren(h('p', { class: 'db-notice tone-bad', text: t('overview.fail', { msg: (e as Error).message }) }));
      return;
    }
  }
  if (app.view !== 'overview') return;
  paint(app, cache.ov);
}

function paint(app: App, ov: WorkspaceOverview): void {
  const t = app.t;
  const page = app.els.page;
  const keep = app.els.main.scrollTop;
  page.replaceChildren();
  const root = h('section', { class: 'db-ov' });
  page.append(root);

  // ---- 머리: 이름 · 목적 · 기준 시각
  const purposeTodo = !!ov.purpose && !!app.rules.placeholder && new RegExp(app.rules.placeholder.source).test(ov.purpose.text);
  const head = h('header', { class: 'db-dochead' },
    h('div', { class: 'db-eyebrow' }, h('span', { class: 'db-trust tone-accent', text: t('overview.title') })),
    h('h1', { class: 'db-doctitle', text: ov.root || app.manifest.project.name }));
  if (ov.purpose && !purposeTodo) {
    head.append(h('p', { class: 'db-ov-purpose' }, ov.purpose.text,
      ov.purpose.docId ? h('button', { class: 'db-linkbtn', type: 'button', onclick: () => void app.navigate(ov.purpose!.docId!) }, ' ' + t('overview.purpose.from', { doc: ov.purpose.docId })) : h('span', { class: 'db-hint', text: ' · ' + t('overview.purpose.config') })));
  } else {
    head.append(h('div', { class: 'db-notice tone-info db-row' },
      h('span', { text: t(purposeTodo ? 'overview.purpose.todo' : 'overview.purpose.none') }),
      purposeTodo && ov.purpose?.docId ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.navigate(ov.purpose!.docId!) }, t('overview.purpose.fill'))
        : canCreate(app) && !ov.purpose ? h('button', { class: 'db-btn sm primary', type: 'button', onclick: () => void createReadme(app, ov, '') }, t('overview.readme.make')) : null));
  }
  head.append(h('div', { class: 'db-meta' },
    h('span', { text: t('overview.asof', { at: fmtTime(ov.asof) }) }),
    !ov.scope.complete ? h('span', { class: 'db-trust tone-warn', title: t('overview.partial.hint'), text: t('overview.partial', { n: ov.scope.items }) }) : null,
    h('button', { class: 'db-btn ghost sm', type: 'button', onclick: () => void renderOverview(app, true), html: icon('refresh') + ' ' + t('doc.refresh') })));
  root.append(head);

  // ---- 숫자
  const tt = ov.totals;
  root.append(h('div', { class: 'db-cards' },
    stat(tt.files, t('overview.files'), t('overview.dirs', { n: tt.dirs })),
    stat(tt.docs, t('overview.docs'), t('overview.docs.hint')),
    stat(fmtBytes(tt.bytes), t('overview.bytes'), ''),
    stat(tt.recent7, t('overview.recent7'), tt.newest ? relTime(tt.newest, t) : ''),
    ov.git ? stat(ov.git.modified + ov.git.untracked + ov.git.added, t('overview.git'), t('overview.git.hint', { m: ov.git.modified, u: ov.git.untracked, a: ov.git.added })) : null));

  // ---- 구성 (묶음별 파일 수 막대)
  const groups = [...ov.groups].filter((g) => g.files).sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  if (groups.length) {
    const total = groups.reduce((s, g) => s + g.files, 0) || 1;
    root.append(h('h2', { class: 'db-ov-h', text: t('overview.composition') }),
      h('div', { class: 'db-ov-bar', role: 'img', 'aria-label': groups.map((g) => `${t('group.' + g.group)} ${g.files}`).join(', ') },
        ...groups.map((g) => h('span', { class: 'g-' + g.group, style: `flex-grow:${g.files / total}`, title: `${t('group.' + g.group)} · ${g.files} · ${fmtBytes(g.bytes)}` }))),
      h('div', { class: 'db-ov-legend' }, ...groups.map((g) => h('span', { class: 'lg' },
        h('i', { class: 'g-' + g.group }), h('span', { class: 'ic', html: icon(groupIcon(g.group)) }), t('group.' + g.group), ' ', h('b', { text: g.files }), h('small', { text: fmtBytes(g.bytes) })))));
  }

  // ---- 살펴볼 것 (점검) — 팀 규칙(docbench.json, D90)이 있으면 그것으로도
  root.append(h('h2', { class: 'db-ov-h', text: t('overview.checks') }));
  root.append(rulesLine(app, ov));
  if (!ov.checks.length) root.append(h('p', { class: 'db-hint', text: t('overview.checks.none') }));
  else {
    const list = h('div', { class: 'db-notes db-ov-checks' });
    for (const c of ov.checks) list.append(checkRow(app, ov, c));
    root.append(list);
  }

  // ---- 폴더
  if (ov.folders.length) {
    const tb = h('tbody');
    for (const f of ov.folders) {
      const name = f.path ? f.path + '/' : t('overview.folder.top');
      tb.append(h('tr', {},
        h('td', {}, f.path ? h('button', { class: 'db-linkbtn', type: 'button', onclick: () => void app.revealFolder(f.path) }, h('span', { class: 'ic', html: icon('folder') }), name) : h('span', { class: 'db-hint', text: name })),
        h('td', { class: 'role' }, f.role ? h('span', { title: f.roleFrom === 'config' ? t('overview.role.config') : t('overview.role.readme') }, f.role)
          : f.path && canCreate(app) && f.files >= 3 ? h('button', { class: 'db-linkbtn soft', type: 'button', title: t('overview.role.add.hint'), onclick: () => void createReadme(app, ov, f.path) }, t('overview.role.add')) : h('span', { class: 'db-hint', text: '—' })),
        h('td', { class: 'n' }, String(f.files)),
        h('td', { class: 'n' }, String(f.docs)),
        h('td', { class: 'n' }, fmtBytes(f.bytes)),
        h('td', { class: 'n db-hint' }, f.modified ? relTime(f.modified, t) : '')));
    }
    root.append(h('h2', { class: 'db-ov-h', text: t('overview.folders') }),
      h('div', { class: 'db-tw', tabindex: '0' }, h('table', { class: 'db-ov-folders' },
        h('thead', {}, h('tr', {}, h('th', { text: t('overview.col.folder') }), h('th', { text: t('overview.col.role') }), h('th', { class: 'n', text: t('overview.col.files') }), h('th', { class: 'n', text: t('overview.col.docs') }), h('th', { class: 'n', text: t('overview.col.size') }), h('th', { class: 'n', text: t('overview.col.modified') }))),
        tb)));
  }

  // ---- 메타데이터 (앞머리)
  const m = ov.meta;
  root.append(h('h2', { class: 'db-ov-h', text: t('overview.meta') }));
  if (!m.docs) root.append(h('p', { class: 'db-hint', text: t('overview.meta.none') }));
  else {
    const chips = (rec: Record<string, number>, cls: string, prefix = '') => Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 16)
      .map(([k, n]) => h('span', { class: 'db-fm-c ' + cls }, prefix + k, h('b', { text: n })));
    root.append(h('div', { class: 'db-ov-meta' },
      h('p', { class: 'db-hint', text: t('overview.meta.lead', { n: m.docs }) }),
      Object.keys(m.status).length ? h('div', { class: 'row' }, h('span', { class: 'k', text: t('overview.meta.status') }), h('div', { class: 'db-fm' }, ...chips(m.status, 'status'))) : null,
      Object.keys(m.owners).length ? h('div', { class: 'row' }, h('span', { class: 'k', text: t('overview.meta.owners') }), h('div', { class: 'db-fm' }, ...chips(m.owners, 'owner'))) : null,
      Object.keys(m.tags).length ? h('div', { class: 'row' }, h('span', { class: 'k', text: t('overview.meta.tags') }), h('div', { class: 'db-fm' }, ...chips(m.tags, 'tag', '#'))) : null));
  }

  // ---- AI 협업 파일
  root.append(h('h2', { class: 'db-ov-h', text: t('overview.ai') }));
  if (!ov.ai.length) root.append(h('p', { class: 'db-hint', text: t('overview.ai.none') }));
  else root.append(h('div', { class: 'db-ov-files' }, ...ov.ai.map((a) => fileRow(app, a.path, t('overview.ai.' + a.kind)))));

  // ---- 최근 · 큰 파일
  const two = h('div', { class: 'db-ov-two' });
  if (ov.recent.length) two.append(h('div', {}, h('h2', { class: 'db-ov-h', text: t('overview.recent') }), h('div', { class: 'db-ov-files' }, ...ov.recent.map((r) => fileRow(app, r.path, relTime(r.modified, t), r.doc)))));
  if (ov.large.length) two.append(h('div', {}, h('h2', { class: 'db-ov-h', text: t('overview.large') }), h('div', { class: 'db-ov-files' }, ...ov.large.map((r) => fileRow(app, r.path, fmtBytes(r.size), r.doc)))));
  if (two.childNodes.length) root.append(two);

  if (ov.links) root.append(h('p', { class: 'db-hint db-ov-foot', text: t('overview.links', { docs: ov.links.docs, links: ov.links.links }) }));
  app.els.main.scrollTop = keep;
}

/** 팀 규칙 한 줄 — 있으면 무엇으로 점검했는지와 열기, 없으면 무엇을 할 수 있는지와 만들기 */
function rulesLine(app: App, ov: WorkspaceOverview): HTMLElement {
  const t = app.t;
  const r = ov.rules;
  if (r) {
    const isDoc = r.file in app.manifest.docs;
    return h('div', { class: 'db-ov-rules on' },
      h('span', { text: t('overview.rules.on', { file: r.file, n: r.count }) }),
      r.unchecked ? h('span', { class: 'db-hint', text: ' ' + t('overview.rules.unchecked', { n: r.unchecked }) }) : null,
      isDoc ? h('button', { class: 'db-linkbtn', type: 'button', onclick: () => void app.navigate(r.file) }, t('overview.rules.open')) : null);
  }
  return h('div', { class: 'db-ov-rules' },
    h('span', { class: 'db-hint', text: t('overview.rules.off') }),
    canCreate(app) ? h('button', { class: 'db-btn sm', type: 'button', title: t('overview.rules.make.hint'), onclick: () => void createRules(app) }, t('overview.rules.make')) : null);
}

const stat = (v: string | number, k: string, sub: string) => h('div', { class: 'db-stat' }, h('div', { class: 'v', text: v }), h('div', { class: 'k', text: k }), sub ? h('div', { class: 'k sub', text: sub }) : null);

/** 파일 한 줄 — 문서면 누르면 열고, 아니면 그 폴더를 펼친다 */
function fileRow(app: App, path: string, note: string, doc?: boolean): HTMLElement {
  const isDoc = doc ?? path in app.manifest.docs;
  const f = formatOf(path);
  return h('button', { class: 'db-ov-file' + (isDoc ? '' : ' nodoc'), type: 'button', title: path, onclick: () => void (isDoc ? app.navigate(path) : app.revealFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')) },
    h('span', { class: 'ic', html: icon(groupIcon(f ? f.group : 'other')) }), h('span', { class: 't', text: path }), h('small', { text: note }));
}

/** 점검 한 줄 — 수준 · 무엇 · 왜 · 경로 · 바로 할 일 */
function checkRow(app: App, ov: WorkspaceOverview, c: OverviewCheck): HTMLElement {
  const t = app.t;
  const tone = c.level === 'risk' ? 'bad' : c.level === 'action' ? 'warn' : c.level === 'tidy' ? 'info' : 'neutral';
  const paths = h('div', { class: 'db-ov-paths' });
  const showPaths = (all: boolean) => {
    if (c.problems) {
      // 규칙 파일의 문제 — 어디가 왜
      paths.replaceChildren(h('ul', { class: 'db-ov-problems' }, ...c.problems.map((p) => h('li', { text: t('overview.rules.problem.' + p.code, { at: p.at, value: p.value ?? '' }) }))));
      return;
    }
    paths.replaceChildren(...(all ? c.paths : c.paths.slice(0, PATHS_SHOWN)).map((p) => {
      const isDoc = p in app.manifest.docs;
      const dir = p.endsWith('/') ? p.slice(0, -1) : null;
      const note = c.notes?.[p];
      return h('button', { class: 'db-chip', type: 'button', title: note ? `${p} — ${note}` : p, onclick: () => void (isDoc ? app.navigate(p) : app.revealFolder(dir ?? (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''))) },
        p, note ? h('small', { class: 'nt', text: note }) : null);
    }));
    if (!all && c.paths.length > PATHS_SHOWN) paths.append(h('button', { class: 'db-chip all', type: 'button', onclick: () => showPaths(true) }, t('overview.paths.more', { n: c.paths.length - PATHS_SHOWN })));
    if (c.n > c.paths.length) paths.append(h('span', { class: 'db-hint', text: t('overview.paths.cut', { n: c.n }) }));
  };
  showPaths(false);
  const act = actionOf(c, t);
  let btn: HTMLElement | null = null;
  if (act?.kind === 'open-rules') {
    btn = ov.rules && ov.rules.file in app.manifest.docs ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.navigate(ov.rules!.file) }, t('overview.rules.open')) : null;
  } else if (act?.kind === 'create-readme' && canCreate(app)) {
    btn = h('button', { class: 'db-btn sm', type: 'button', onclick: () => void (c.code === 'no-readme' ? createReadme(app, ov, '') : createReadme(app, ov, c.paths[0].replace(/\/$/, ''))) }, t(c.code === 'no-readme' ? 'overview.readme.make' : 'overview.readme.makeFolder', { dir: c.paths[0] }));
  } else if (act && (act.kind === 'draft-each' || act.kind === 'draft-readme') && app.can('feedback.create')) {
    const targets = draftTargets(app, ov, c, act);
    if (targets.length) btn = h('button', { class: 'db-btn sm', type: 'button', title: t('overview.draft.hint', { ai: app.ai }), onclick: (e: Event) => void makeDrafts(app, c, act, targets, e.currentTarget as HTMLButtonElement), html: icon('chat') + ' ' }, t(targets.length > 1 ? 'overview.draft.n' : 'overview.draft', { n: targets.length, ai: app.ai }));
  }
  // 팀 규칙에서 온 점검은 규칙 이름·요구(want)·적용 경로
  const title = checkTitle(t, c);
  const scope = c.rule ? h('p', { class: 'db-hint scope', text: t('overview.rule.scope', { i: c.rule.index + 1, scope: c.rule.scope.join(' · ') }) }) : null;
  return h('div', { class: 'db-note db-ov-check', 'data-code': c.code },
    h('span', { class: 'lv tone-' + tone, text: t('overview.level.' + c.level) }),
    h('div', { class: 'nt' }, h('b', { text: title }), h('p', { text: c.rule?.hint || t('overview.check.' + c.code + '.hint') }), scope, paths),
    btn);
}

/** 점검 제목 — 팀 규칙에 이름이 있으면 이름 (CLI 의 checkTitle 과 같은 뜻) */
function checkTitle(t: App['t'], c: OverviewCheck): string {
  const base = t('overview.check.' + c.code, { n: c.n, want: c.rule?.want ?? '' });
  return c.rule?.name ? `${c.rule.name} — ${base}` : base;
}

function actionOf(c: OverviewCheck, t: App['t']): CheckAction | null {
  switch (c.code) {
    case 'no-readme': case 'folder-no-readme': return { kind: 'create-readme' };
    case 'broken-links': return { kind: 'draft-each', body: t('overview.draft.body.broken-links'), category: 'structure' };
    case 'review-due': return { kind: 'draft-each', body: t('overview.draft.body.review-due'), category: 'fact' };
    case 'stale-docs': return { kind: 'draft-each', body: t('overview.draft.body.stale-docs'), category: 'fact' };
    case 'orphan-docs': return { kind: 'draft-readme', body: t('overview.draft.body.orphan-docs', { list: c.paths.map((p) => '- ' + p).join('\n') }), category: 'gap' };
    case 'rule-readme': return { kind: 'create-readme' };
    case 'rule-front-matter': return { kind: 'draft-each', body: t('overview.draft.body.rule-front-matter', { want: c.rule?.want ?? '' }), category: 'gap' };
    case 'rule-review': return { kind: 'draft-each', body: t('overview.draft.body.rule-review', { days: c.rule?.want ?? '' }), category: 'fact' };
    case 'rules-invalid': return { kind: 'open-rules' };
    default: return null;
  }
}

/** 초안을 남길 문서 — Claude 가 고치거나 제안할 수 있는 형식의 문서만(목록에 있는 것), 10개까지 */
function draftTargets(app: App, ov: WorkspaceOverview, c: OverviewCheck, act: CheckAction): string[] {
  if (act.kind !== 'draft-each' && act.kind !== 'draft-readme') return [];
  const ok = (id: string) => id in app.manifest.docs && app.inScope(id) && claudeChanges(formatFor(id)).length > 0;
  if (act.kind === 'draft-readme') {
    const readme = ov.purpose?.docId || Object.keys(app.manifest.docs).find((d) => /^readme\.(md|markdown)$/i.test(d));
    return readme && ok(readme) ? [readme] : [];
  }
  return c.paths.filter(ok).slice(0, 10);
}

async function makeDrafts(app: App, c: OverviewCheck, act: CheckAction, ids: string[], btn: HTMLButtonElement): Promise<void> {
  if (act.kind !== 'draft-each' && act.kind !== 'draft-readme') return;
  const t = app.t;
  btn.disabled = true;
  let n = 0;
  for (const docId of ids) {
    // 같은 점검으로 이미 남긴 초안이 그 문서에 있으면 또 만들지 않는다
    if (app.fb.some((f) => f.docId === docId && f.status === 'draft' && f.body === act.body)) continue;
    try {
      const f = await app.ad.feedback.create({ docId, target: { kind: 'doc' }, body: act.body, category: act.category, status: 'draft', waitingOn: 'owner', author: app.me });
      app.noteFeedback(f);
      app.emit({ type: 'feedback:created', feedback: f });
      n++;
    } catch (e) { app.toast(t('fb.saveFail', { msg: (e as Error).message })); break; }
  }
  app.panel.render();
  app.renderRail();
  btn.textContent = t('overview.draft.done', { n });
  app.toast(t(n ? 'overview.draft.saved' : 'overview.draft.already', { n, code: checkTitle(t, c) }), { action: t('fb.draft.see'), onAction: () => app.panel.open(undefined, 'draft') });
}

const canCreate = (app: App) => !!app.ad.docs.create && app.can('doc.edit');

/**
 * README 만들기 — 맨 위면 목적·폴더 표, 폴더면 그 폴더가 하는 일. 빈칸([작업 후 기입]/TODO)으로 두어 채울 곳이 보이게,
 * 만들고 나면 그 문서를 열어 편집기로
 */
async function createReadme(app: App, ov: WorkspaceOverview, dir: string): Promise<void> {
  const t = app.t;
  const id = (dir ? dir + '/' : '') + 'README.md';
  let md: string;
  if (!dir) {
    const rows = ov.folders.filter((f) => f.path).map((f) => `| \`${f.path}/\` | ${f.role || t('overview.readme.roleTodo')} |`);
    md = `# ${ov.root || app.manifest.project.name}\n\n${t('overview.readme.purposeTodo')}\n` +
      (rows.length ? `\n## ${t('overview.readme.folders')}\n\n| ${t('overview.col.folder')} | ${t('overview.col.role')} |\n|---|---|\n${rows.join('\n')}\n` : '') +
      `\n## ${t('overview.readme.rules')}\n\n- ${t('overview.readme.rulesTodo')}\n`;
  } else {
    md = `# ${dir.split('/').pop()}\n\n${t('overview.readme.folderTodo')}\n`;
  }
  try {
    await app.ad.docs.create!(id, md, { summary: t('overview.readme.summary') });
    invalidateOverview(app);
    app.toast(t('overview.readme.made', { id }));
    await app.reloadManifest();
    await app.navigate(id);
    app.doc?.openEditor(null);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'CONFLICT') { app.toast(t('overview.readme.exists', { id })); await app.navigate(id); return; }
    app.toast(t('err.generic', { msg: (e as Error).message }), { sticky: true });
  }
}

/** 팀 규칙 파일 만들기 — 스키마 주소와 규칙 하나(쓰는 법이 보이게). 만들고 나면 연다 */
async function createRules(app: App): Promise<void> {
  const t = app.t;
  try {
    await app.ad.docs.create!(RULES_FILE, rulesTemplate(t('overview.rules.templateHint')), { summary: t('overview.rules.summary') });
    invalidateOverview(app);
    app.toast(t('overview.rules.made', { file: RULES_FILE }));
    await app.reloadManifest();
    await app.navigate(RULES_FILE);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'CONFLICT') { app.toast(t('overview.readme.exists', { id: RULES_FILE })); await app.navigate(RULES_FILE); return; }
    app.toast(t('err.generic', { msg: (e as Error).message }), { sticky: true });
  }
}
