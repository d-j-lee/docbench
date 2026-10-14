// 단독 실행(docbench serve) 화면의 부트스트랩. 대시보드에 끼울 때는 이 파일 대신 직접 createDocBench 를 부른다.
// ?lang=en 이면 영어 화면(기본 한국어 — 앱·단일 HTML 은 브라우저 언어를 따른다)
(async function () {
  var el = document.getElementById('app');
  var q = new URLSearchParams(location.search);
  var token = q.get('token') || undefined;
  var locale = q.get('lang') === 'en' ? 'en' : 'ko';
  if (locale === 'en') document.documentElement.lang = 'en';
  var rest = DocBench.createRestAdapters({ base: el.dataset.api || '/api', live: 'sse', token: token });
  var adapters = await DocBench.trimBySession(rest).catch(function () { return rest; });
  window.docbench = DocBench.createDocBench(el, { adapters: adapters, locale: locale, routing: 'hash', shortcuts: 'global', injectStyles: false });
})();
