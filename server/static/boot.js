// 단독 실행(docbench serve) 화면의 부트스트랩. 대시보드에 끼울 때는 이 파일 대신 직접 createDocBench 를 부른다.
(async function () {
  var el = document.getElementById('app');
  var token = new URLSearchParams(location.search).get('token') || undefined;
  var rest = DocBench.createRestAdapters({ base: el.dataset.api || '/api', live: 'sse', token: token });
  var adapters = await DocBench.trimBySession(rest).catch(function () { return rest; });
  window.docbench = DocBench.createDocBench(el, { adapters: adapters, routing: 'hash', shortcuts: 'global', injectStyles: false });
})();
