/**
 * React 래퍼 예 — 대시보드가 React 일 때. 웹 컴포넌트를 써도 되지만, 어댑터를 직접 넘기고 싶으면 이 방식.
 *
 *   <DocBenchPanel api="/docbench/api" doc="docs/runbook.md" theme={theme} onEvent={(e) => …} />
 */
import { useEffect, useRef } from 'react';
import { createDocBench, createRestAdapters, trimBySession, type DocBenchEvent, type DocBenchHandle } from 'docbench';
import 'docbench/style.css';

export interface DocBenchPanelProps {
  api?: string;
  token?: string;
  doc?: string;
  theme?: 'auto' | 'light' | 'dark';
  onEvent?: (e: DocBenchEvent) => void;
  className?: string;
}

export function DocBenchPanel({ api = '/docbench/api', token, doc, theme = 'auto', onEvent, className }: DocBenchPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const bench = useRef<DocBenchHandle | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // 연결은 api·token 이 바뀔 때만 새로 만든다
  useEffect(() => {
    let alive = true;
    const el = host.current!;
    (async () => {
      const rest = createRestAdapters({ base: api, token });
      const adapters = await trimBySession(rest).catch(() => rest);
      if (!alive) return;
      bench.current = createDocBench(el, {
        adapters, theme, initialDoc: doc, routing: 'none', shortcuts: 'scoped', injectStyles: false,
        onEvent: (e) => onEventRef.current?.(e),
      });
    })();
    return () => { alive = false; bench.current?.destroy(); bench.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, token]);

  useEffect(() => { if (doc) void bench.current?.navigate(doc); }, [doc]);
  useEffect(() => { if (host.current) host.current.dataset.theme = theme; }, [theme]);

  return <div ref={host} className={className} style={{ height: '100%' }} />;
}
