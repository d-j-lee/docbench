/**
 * <doc-bench> 웹 컴포넌트 — React·Vue·Angular·서버 렌더 어디에든 태그 하나로 넣는다.
 *
 *   <doc-bench api="/api" theme="auto" style="height:100%"></doc-bench>
 *
 * 속성: api (REST 기준 경로), token, theme, locale, doc (처음 열 문서), routing ('hash'|'none'), shortcuts
 * 다른 어댑터를 쓰려면 element.adapters = {...} 를 연결 전에 넣는다.
 */
import type { DocBenchAdapters, DocBenchOptions } from './types';
import { App } from './ui/app';
import { createRestAdapters, trimBySession } from './adapters/rest';

export function defineElement(tag = 'doc-bench'): void {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;
  class DocBenchElement extends HTMLElement {
    adapters?: DocBenchAdapters;
    options?: Partial<DocBenchOptions>;
    private app: App | null = null;
    static get observedAttributes() { return ['doc', 'theme']; }

    async connectedCallback() {
      if (this.app) return;
      // 사용자 정의 요소는 기본이 inline 이라 무언가 정해야 한다 — 작업대 뿌리(.docbench)와 같은 flex 로.
      // block 으로 두면 .docbench 의 flex 를 덮어 패널 높이를 못 채우고 긴 문서가 안에서 스크롤되지 않았다(시험 이식에서 발견)
      if (!this.style.display) this.style.display = 'flex';
      let adapters = this.adapters;
      if (!adapters) {
        const rest = createRestAdapters({ base: this.getAttribute('api') || '/api', token: this.getAttribute('token') || undefined });
        adapters = await trimBySession(rest).catch(() => rest);
      }
      // 기다리는 사이 떼어졌거나(React StrictMode·재배치) 이미 붙었으면 두 번 만들지 않는다
      if (!this.isConnected || this.app) return;
      this.app = new App(this, {
        adapters,
        theme: (this.getAttribute('theme') as DocBenchOptions['theme']) || 'auto',
        locale: (this.getAttribute('locale') as DocBenchOptions['locale']) || 'ko',
        routing: (this.getAttribute('routing') as DocBenchOptions['routing']) || 'none',
        initialDoc: this.getAttribute('doc') || undefined,
        shortcuts: (this.getAttribute('shortcuts') as DocBenchOptions['shortcuts']) || 'scoped',
        onEvent: (ev) => this.dispatchEvent(new CustomEvent('docbench-event', { detail: ev })),
        ...this.options,
      });
      await this.app.start();
    }
    disconnectedCallback() { this.app?.destroy(); this.app = null; }
    attributeChangedCallback(name: string, _old: string | null, val: string | null) {
      if (!this.app) return;
      if (name === 'doc' && val) void this.app.navigate(val);
      if (name === 'theme') this.dataset.theme = val || 'auto';
    }
    navigate(view: string, opts?: { section?: string }) { return this.app?.navigate(view, opts); }
  }
  customElements.define(tag, DocBenchElement);
}
