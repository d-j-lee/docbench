import { defineConfig } from 'vitest/config';
// 연습 공간의 문서(src/welcome/**/*.md)를 빌드(esbuild text 로더)와 같이 글로 싣는다
const mdText = { name: 'docbench-md-text', transform(code: string, id: string) { return id.endsWith('.md') ? { code: `export default ${JSON.stringify(code)};`, map: null } : null; } };
export default defineConfig({ plugins: [mdText], test: { environment: 'jsdom', include: ['test/unit/**/*.test.ts'] } });
