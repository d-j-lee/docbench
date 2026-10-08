/** 변경 이력 — 저장마다 한 줄. 누르면 그 변경만 차이로 보여 준다 */
import { h, fmtTime } from './dom';
import type { App } from './app';

export async function renderChanges(app: App): Promise<void> {
  const t = app.t;
  const page = app.els.page;
  page.replaceChildren(h('p', { class: 'db-loading', text: t('doc.loading') }));
  const list = app.ad.docs.changes ? await app.ad.docs.changes(300).catch(() => []) : [];
  if (app.view !== 'changes') return;
  page.replaceChildren(h('header', { class: 'db-dochead' },
    h('h1', { class: 'db-doctitle', text: t('changes.title') }),
    h('p', { class: 'db-docrole', text: t('changes.role') })));
  const log = h('div', { class: 'db-log' });
  if (!list.length) log.append(h('div', { class: 'db-empty', text: t('changes.empty') }));
  for (const c of list.slice().sort((a, b) => b.at.localeCompare(a.at))) {
    const by = app.personLabel(c.by);
    log.append(h('div', { class: 'db-logi' },
      h('div', { class: 'when', text: [fmtTime(c.at), app.docTitle(c.docId), by].filter(Boolean).join(' · ') }),
      c.summary ? h('div', { text: c.summary }) : null,
      c.sections?.length ? h('div', { class: 'db-hint', text: t('changes.sections', { list: c.sections.slice(0, 6).map((k) => k.split(' › ').pop()).join(', ') + (c.sections.length > 6 ? ' …' : '') }) }) : null,
      c.removed?.length ? h('div', { class: 'db-hint', text: t('changes.removed', { list: c.removed.slice(0, 6).map((k) => k.split(' › ').pop()).join(', ') + (c.removed.length > 6 ? ' …' : '') }) }) : null,
      c.feedbackIds?.length ? h('div', { class: 'db-hint', text: t('changes.fb', { n: c.feedbackIds.length }) }) : null,
      app.manifest.docs[c.docId] ? h('div', { class: 'db-row', style: 'margin-top:4px' },
        h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.navigate(c.docId) }, t('changes.open')),
        c.fromVersion && app.ad.docs.loadVersion ? h('button', { class: 'db-btn sm', type: 'button', onclick: () => void app.navigate(c.docId, { compareFrom: c.fromVersion }) }, t('changes.diff')) : null) : null));
  }
  page.append(log);
}
