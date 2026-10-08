/**
 * DocBench — 사람과 AI가 같은 문서를 이해·피드백·수정·관리하는 작업대.
 *
 *   import { createDocBench, createRestAdapters } from 'docbench';
 *   const bench = createDocBench(el, { adapters: createRestAdapters({ base: '/api' }) });
 *   bench.navigate('docs/runbook.md');
 */
import type { DocBenchOptions } from './types';
import { App } from './ui/app';

export * from './types';
export { createMemoryAdapters } from './adapters/memory';
export { createRestAdapters, trimBySession, HttpError } from './adapters/rest';
export { createArtifactAdapters } from './adapters/claude-artifact';
export { normalizeFeedback, turnOf, countTurns } from './core/feedback';
export { sectionSources, getSectionText, replaceSection, diffSections, KEY_SEP } from './core/source';
export { buildProposePrompt, checkProposal, PROPOSAL_SCHEMA } from './core/prompt';
export { defineElement } from './element';

export interface DocBenchHandle {
  /** 문서 id, 'map', 'changes' 중 하나로 이동. section 은 섹션 키 */
  navigate(view: string, opts?: { section?: string; feedbackId?: string }): Promise<void>;
  /** 이벤트 구독. 반환값을 부르면 해제 */
  on(type: string, fn: (ev: CustomEvent) => void): () => void;
  destroy(): void;
  readonly ready: Promise<void>;
}

export function createDocBench(el: HTMLElement, opts: DocBenchOptions): DocBenchHandle {
  const app = new App(el, opts);
  const ready = app.start();
  return {
    navigate: (v, o) => app.navigate(v, o),
    on(type, fn) {
      const name = type.startsWith('docbench:') ? type : 'docbench:' + type;
      el.addEventListener(name, fn as EventListener);
      return () => el.removeEventListener(name, fn as EventListener);
    },
    destroy: () => app.destroy(),
    ready,
  };
}

export const version = '0.1.0';
