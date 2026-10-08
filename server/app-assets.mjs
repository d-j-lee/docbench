// @ts-check
// DocBench 앱 화면 파일 — 저장소 설치본은 dist/·server/static/ 에서 읽고, CLI 파일 하나(release/docbench.mjs)는
// 빌드(scripts/build.mjs)가 이 모듈을 묶어 넣은 글로 바꿔 끼운다(파일 하나만 받아도 앱 화면이 뜨게).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** @type {Record<string, string>} */
const FILES = { 'app.js': '../dist/app.js', 'docbench.css': '../dist/docbench.css', 'host.js': './static/host.js' };

/** @param {string} name @returns {Promise<Buffer | null>} */
export async function appAsset(name) {
  const rel = Object.prototype.hasOwnProperty.call(FILES, name) ? FILES[name] : null;
  if (!rel) return null;
  try { return await fs.readFile(path.join(here, rel)); } catch { return null; }
}
