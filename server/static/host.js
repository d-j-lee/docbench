/*! DocBench host bridge (MIT) — 대시보드 탭에 DocBench 앱을 끼운다.
 *
 *   <script src="http://127.0.0.1:4317/host.js"></script>
 *   const bench = DocBenchHost.mount(document.getElementById('docs-tab'), {
 *     root: 'D:\\work\\proj',        // 이 탭이 보여 줄 폴더 (지금 프로젝트)
 *     key: '<앱 열쇠>',               // %LOCALAPPDATA%\docbench\app-token — 대시보드 백엔드가 읽어 넘긴다
 *     theme: 'dark',                 // 'auto' | 'light' | 'dark' — 바뀌면 bench.setTheme()
 *     onTodo: (c) => setBadge(c.owner),                      // 탭 배지 — 볼 것(c.draft 초안 · c.assistant 보냄)
 *     onHandoff: async (req) => { terminal.send(req.command || req.prompt); return { handled: true }; },
 *       // 보내기를 대시보드 터미널로 — req.command = 셸 한 줄(설치 없이 새 Claude Code), req.prompt = 이미 켜진 Claude 대화에 넣을 한 줄(플러그인)
 *     onEvent: (ev) => console.log(ev),
 *   });
 *
 * 대시보드 출처는 먼저 허용해야 끼울 수 있다: docbench app --allow-origin http://localhost:3000
 * 메시지는 앱 출처(이 스크립트를 받은 곳)와만 주고받는다. 문서 내용·피드백 본문은 넘어오지 않는다(id·상태만).
 */
(function () {
  'use strict';
  var me = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src).origin : 'http://127.0.0.1:4317';
  function mount(el, o) {
    o = o || {};
    var app = String(o.app || me).replace(/\/+$/, '');
    var origin = new URL(app).origin;
    var qs = new URLSearchParams();
    qs.set('root', o.root || '');
    if (o.key) qs.set('t', o.key);
    if (o.scope) qs.set('scope', o.scope);
    if (o.theme) qs.set('theme', o.theme);
    if (o.lang) qs.set('lang', o.lang);
    var f = document.createElement('iframe');
    f.src = app + '/embed?' + qs.toString();
    f.title = o.title || 'DocBench';
    f.setAttribute('allow', 'clipboard-read; clipboard-write');
    f.style.cssText = 'border:0;width:100%;height:100%;display:block;background:transparent';
    el.appendChild(f);
    var theme = o.theme || 'auto';
    function post(msg) { msg.docbench = 1; if (f.contentWindow) f.contentWindow.postMessage(msg, origin); }
    function onMsg(e) {
      if (e.origin !== origin || e.source !== f.contentWindow || !e.data || e.data.docbench !== 1) return;
      var d = e.data;
      if (d.type === 'hello') post({ type: 'init', theme: theme, handoff: typeof o.onHandoff === 'function', view: o.view || null, tokens: o.tokens || null });
      else if (d.type === 'event') {
        if (o.onEvent) o.onEvent(d.event);
        if (d.event && d.event.type === 'todo' && o.onTodo) o.onTodo({ owner: d.event.owner, assistant: d.event.assistant, draft: d.event.draft || 0 });
      } else if (d.type === 'handoff') {
        Promise.resolve(o.onHandoff ? o.onHandoff({ feedbackIds: d.feedbackIds, docs: d.docs, prompt: d.prompt, command: typeof d.command === 'string' ? d.command : undefined }) : { handled: false }).then(
          function (r) { post({ type: 'handoff:result', id: d.id, handled: !!(r && r.handled), message: r && r.message }); },
          function (err) { post({ type: 'handoff:result', id: d.id, handled: false, message: String((err && err.message) || err) }); });
      }
    }
    window.addEventListener('message', onMsg);
    return {
      iframe: f,
      setTheme: function (t) { theme = t; post({ type: 'theme', theme: t }); },
      setTokens: function (tokens) { post({ type: 'tokens', tokens: tokens }); },
      navigate: function (view) { post({ type: 'navigate', view: view }); },
      destroy: function () { window.removeEventListener('message', onMsg); if (f.parentNode) f.parentNode.removeChild(f); },
    };
  }
  window.DocBenchHost = { mount: mount, version: '1' };
})();
