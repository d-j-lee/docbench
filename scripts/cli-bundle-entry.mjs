// release/docbench.mjs (CLI 파일 하나)의 진입점 — scripts/build.mjs 가 esbuild 로 묶는다.
// iconv-lite 를 함께 넣어 CP949 문서도 바이트 그대로 쓴다. 서버 화면(serve)·스킬 원본(init --claude)은 들어 있지 않다.
import iconv from 'iconv-lite';

globalThis.__docbenchIconv = iconv;
globalThis.__DOCBENCH_BUNDLE__ = true;
await import('../bin/docbench.mjs');
