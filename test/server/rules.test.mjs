// 팀 규칙(D90) — docbench.json 과 `docbench check`(CI): 기록 없이 읽기만, 종료 코드, GitHub 주석·요약, git 커밋 시각
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Workspace } from '../../server/workspace.mjs';
import { startServer } from '../../server/index.mjs';
import { tempWorkspace, rm, pcFileFor, repo } from './helpers.mjs';

const run = promisify(execFile);
const cli = path.join(repo, 'bin/docbench.mjs');
/** CLI 를 부르고 종료 코드까지 — 실패해도 던지지 않는다 */
const db = (cwd, args, env = {}) => run(process.execPath, [cli, ...args], { cwd, env: { ...process.env, DOCBENCH_ACTOR: '', ...env } }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const git = (cwd, args, env = {}) => run('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...env } });
const hasGit = await run('git', ['--version']).then(() => true, () => false);

/** 기록이 없는 문서 폴더 — CI 가 받은 저장소처럼 */
async function plainFolder(t, files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docbench-check-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await fs.writeFile(path.join(dir, p), body);
  }
  return dir;
}
const RULES = {
  purpose: '배포·운영 문서',
  rules: [
    { kind: 'front-matter', paths: 'docs/**', keys: ['owner'] },
    { kind: 'naming', style: 'no-spaces', level: 'tidy' },
  ],
};

test('check: 기록 없이 읽기만 — 아무것도 만들지 않고, 할 일 이상이 있으면 5', async (t) => {
  const dir = await plainFolder(t, {
    'README.md': '# 운영\n\n운영 문서.\n',
    'docs/a.md': '---\nowner: dj\n---\n# A\n',
    'docs/b.md': '# B\n',
    'docs/my notes.md': '---\nowner: kim\n---\n# 메모\n',
    'docbench.json': JSON.stringify(RULES),
  });
  const home = process.env.DOCBENCH_HOME;
  const before = home ? await fs.readdir(home).catch(() => []) : [];
  const r = await db(dir, ['check']);
  assert.equal(r.code, 5, r.stderr);
  assert.match(r.stdout, /팀 규칙: docbench\.json — 규칙 2개/);
  assert.match(r.stdout, /앞머리 규칙\(owner\)에 맞지 않는 문서 1개/);
  assert.match(r.stdout, /docs\/b\.md {2}— owner/);
  assert.match(r.stdout, /실패 — 할 일 이상 1건/);
  // 읽기만: 문서 폴더에 .docbench 가 생기지 않고, 이 PC 의 설정·기록 보관함도 그대로
  assert.deepEqual((await fs.readdir(dir)).sort(), ['README.md', 'docbench.json', 'docs']);
  if (home) assert.deepEqual(await fs.readdir(home).catch(() => []), before);
  // 정리(tidy) 는 기본으로 실패시키지 않는다 · 수준을 낮추면 통과 · never 는 보고만
  const tidy = await db(dir, ['check', '--fail-on', 'risk']);
  assert.equal(tidy.code, 0);
  assert.match(tidy.stdout, /통과/);
  assert.equal((await db(dir, ['check', '--fail-on', 'tidy'])).code, 5);
  assert.equal((await db(dir, ['check', '--fail-on', 'never'])).code, 0);
});

test('check --json · --lang en · --rules (다른 자리의 규칙 파일) · 잘못된 인자', async (t) => {
  const dir = await plainFolder(t, { 'README.md': '# x\n', 'docs/b.md': '# B\n', 'ci/rules.json': JSON.stringify({ rules: [{ kind: 'require', paths: ['CHANGELOG.md'] }] }) });
  const j = await db(dir, ['check', '.', '--json', '--rules', 'ci/rules.json', '--lang', 'en']);
  assert.equal(j.code, 5);
  const o = JSON.parse(j.stdout);
  assert.equal(o.failed, true);
  assert.equal(o.failOn, 'action');
  assert.match(o.rules.file, /ci[\\/]rules\.json$/);
  const c = o.checks.find((x) => x.code === 'rule-require');
  assert.deepEqual([c.paths, c.title], [['CHANGELOG.md'], 'Required files or folders missing: 1']);
  assert.ok(c.hint);
  assert.equal((await db(dir, ['check', '--fail-on', 'loud'])).code, 1);
  assert.equal((await db(dir, ['check', '--format', 'xml'])).code, 1);
  assert.equal((await db(dir, ['check', path.join(dir, 'nope')])).code, 2);
  assert.equal((await db(dir, ['check', '--rules', 'nope.json'])).code, 2);
});

test('check: 규칙 파일이 깨졌으면 그것이 할 일(조용히 통과하지 않는다)', async (t) => {
  const dir = await plainFolder(t, { 'README.md': '# x\n', 'docbench.json': '{ "rules": [ { "kind": "fronmatter" } ] }' });
  const r = await db(dir, ['check']);
  assert.equal(r.code, 5);
  assert.match(r.stdout, /팀 규칙 파일에 문제 1개/);
  assert.match(r.stdout, /rules\[0\]\.kind: 모르는 규칙 종류 "fronmatter"/);
  const bad = await plainFolder(t, { 'README.md': '# x\n', 'docbench.json': '{ nope' });
  assert.match((await db(bad, ['check'])).stdout, /JSON 으로 읽지 못했습니다/);
});

test('check --format github: PR 주석(저장소 기준 경로) · 작업 요약', async (t) => {
  const repoDir = await plainFolder(t, { 'site/README.md': '# s\n', 'site/docs/b.md': '# B\n', 'site/docs/my notes.md': '---\nowner: a\n---\n# n\n', 'site/docbench.json': JSON.stringify(RULES) });
  const summary = path.join(repoDir, 'summary.md');
  const r = await db(repoDir, ['check', 'site', '--format', 'github', '--lang', 'en'], { GITHUB_WORKSPACE: repoDir, GITHUB_STEP_SUMMARY: summary });
  assert.equal(r.code, 5);
  assert.match(r.stdout, /^::error file=site\/docs\/b\.md,title=Documents not meeting the front-matter rule \(owner\)%3A 1::owner — /m);
  assert.match(r.stdout, /^::notice file=site\/docs\/my notes\.md,title=Names not matching the naming rule \(no-spaces\)%3A 1::no-spaces — /m);
  const md = await fs.readFile(summary, 'utf8');
  assert.match(md, /^### DocBench check: site/m);
  assert.match(md, /\| To do \| Documents not meeting the front-matter rule \(owner\): 1 \| 1 \|/);
});

test('개요(서버·REST): 규칙 파일의 목적이 README 보다 먼저, 점검에 팀 규칙', async (t) => {
  const dir = await tempWorkspace();
  t.after(() => rm(dir));
  await fs.writeFile(path.join(dir, 'docbench.json'), JSON.stringify({ ...RULES, folders: { docs: '설계·운영 문서' } }));
  const s = await startServer({ root: dir, port: 0, pcConfigFile: pcFileFor(dir) });
  t.after(() => s.close());
  const ov = await (await fetch(`http://127.0.0.1:${s.port}/api/overview`)).json();
  assert.deepEqual(ov.purpose, { text: '배포·운영 문서', from: 'config', docId: 'docbench.json' });
  assert.equal(ov.folders.find((f) => f.path === 'docs').role, '설계·운영 문서');
  assert.equal(ov.rules.count, 2);
  assert.ok(ov.checks.some((c) => c.code === 'rule-front-matter' && c.rule.index === 0));
  // 규칙 파일도 문서(JSON) — 목록에서 열고 고친다
  assert.ok((await s.ws.manifest()).docs['docbench.json']);
  // 범위(대시보드 탭·넓은 작업 공간 안 폴더) — 그 폴더를 맨 위로, 경로는 작업 공간 기준
  const sc = await (await fetch(`http://127.0.0.1:${s.port}/api/overview?scope=docs`)).json();
  assert.equal(sc.root, 'docs');
  assert.ok(sc.totals.files >= 3 && sc.totals.files < ov.totals.files);
  assert.ok(sc.checks.find((c) => c.code === 'rule-front-matter').paths.every((p) => p.startsWith('docs/')));
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/overview?scope=../x`)).status, 400);
});

test('기록이 없으면 다른 명령은 그대로 거부(2) — 읽기만 여는 것은 check 뿐', async (t) => {
  const dir = await plainFolder(t, { 'README.md': '# x\n' });
  assert.equal((await db(dir, ['overview', '--root', dir])).code, 2);
  await assert.rejects(new Workspace(dir, { create: false, pcConfigFile: pcFileFor(dir) }).init(), { code: 'NO_DATA' });
  const ws = await new Workspace(dir, { create: false, records: 'optional', pcConfigFile: pcFileFor(dir) }).init();
  assert.equal(ws.dataMode, 'none');
  assert.ok(!existsSync(path.join(dir, '.docbench')));
});

test('git: 막 받은 저장소는 커밋 시각으로 검토 주기를 잰다 · 얕게 받았으면 알린다', { skip: !hasGit && 'git 없음' }, async (t) => {
  const src = await plainFolder(t, { 'README.md': '# x\n', 'docs/old.md': '# 오래된\n', 'docbench.json': JSON.stringify({ rules: [{ kind: 'review', paths: 'docs/**', days: 180 }] }) });
  await git(src, ['init', '-q']);
  await git(src, ['add', '-A']);
  const old = '2024-01-02T03:04:05Z';
  await git(src, ['commit', '-qm', 'old'], { GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old });
  await fs.writeFile(path.join(src, 'docs/new.md'), '# 새\n');
  await git(src, ['add', '-A']);
  await git(src, ['commit', '-qm', 'new']);
  // 받은 폴더는 파일 시각이 모두 지금 — 커밋 시각이 아니면 old.md 를 놓친다
  const clone = src + '-clone';
  t.after(() => fs.rm(clone, { recursive: true, force: true }));
  await git(os.tmpdir(), ['clone', '-q', src, clone]);
  const r = await db(clone, ['check', '--json']);
  const c = JSON.parse(r.stdout).checks.find((x) => x.code === 'rule-review');
  assert.deepEqual(c?.paths, ['docs/old.md'], r.stdout);
  assert.match(c.notes['docs/old.md'], /^2024-01-02/);
  // 얕게 받은 저장소(CI 기본 fetch-depth 1) — 이력이 없으니 알린다
  const shallow = src + '-shallow';
  t.after(() => fs.rm(shallow, { recursive: true, force: true }));
  await git(os.tmpdir(), ['clone', '-q', '--depth', '1', 'file://' + src.split(path.sep).join('/'), shallow]);
  const sr = await db(shallow, ['check']);
  assert.match(sr.stdout, /얕게 받은 저장소입니다/);
});

test('CLI overview --scope: 작업 공간 안 그 폴더만 · 밖이면 1', async (t) => {
  const dir = await tempWorkspace();
  t.after(() => rm(dir));
  const o = JSON.parse((await db(dir, ['overview', '--scope', 'docs', '--json'])).stdout);
  assert.equal(o.root, 'docs');
  assert.ok(o.recent.every((r) => r.path.startsWith('docs/')));
  assert.equal((await db(dir, ['overview', '--scope', '../x'])).code, 1);
});

test('독립 검토 고침: 폴더 지도 밖(.github·build)의 글자 그대로 경로 · 큰 저장소의 CI 한도 · 링크로 밖을 가리키는 규칙 파일', async (t) => {
  const many = {};
  for (let i = 0; i < 4100; i++) many[`a/f${String(i).padStart(4, '0')}.txt`] = 'x';
  const dir = await plainFolder(t, {
    ...many, 'README.md': '# x\n', 'z/Bad Name.md': '# b\n', '.github/workflows/ci.yml': 'on: push\n', 'build/out.txt': 'x',
    'docbench.json': JSON.stringify({ rules: [
      { kind: 'require', paths: ['.github/workflows/', 'build/', '.github/CODEOWNERS'] },
      { kind: 'forbid', paths: ['build/'] }, { kind: 'naming', paths: 'z/**', style: 'no-spaces' },
    ] }),
  });
  const o = JSON.parse((await db(dir, ['check', '--json'])).stdout);
  const codes = (c) => o.checks.find((x) => x.code === c);
  assert.equal(o.scope.complete, true, '4000 항목 넘는 저장소도 CI 는 끝까지 훑는다');
  assert.ok(!codes('no-readme'), '맨 위 README 가 있다');
  assert.deepEqual(codes('rule-require').paths, ['.github/CODEOWNERS']);
  assert.deepEqual(codes('rule-forbid').paths, ['build/']);
  assert.deepEqual(codes('rule-naming').paths, ['z/Bad Name.md']);
  // 규칙 파일이 링크로 문서 폴더 밖(비밀)을 가리키면 읽지 않는다 — 값이 CI 로그에 실리지 않게
  const outside = dir + '-outside';
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, 'creds.json'), '{"token":"ghp_SECRET_0123"}');
  await fs.rm(path.join(dir, 'docbench.json'));
  // Windows 는 개발자 모드·관리자가 아니면 링크를 만들 수 없다 — 그때는 이 부분을 건너뛴다
  if (!(await fs.symlink(path.join(outside, 'creds.json'), path.join(dir, 'docbench.json')).then(() => true, (e) => { if (e.code === 'EPERM') return false; throw e; }))) return;
  const r = await db(dir, ['check']);
  assert.ok(!r.stdout.includes('ghp_SECRET'), r.stdout);
  assert.match(r.stdout, /link outside the docs folder/);
});

test('check --format github: 남이 만든 글(파일 이름·규칙 hint)의 줄바꿈이 워크플로 명령·요약 표를 만들지 못한다', async (t) => {
  // 줄바꿈·쌍점이 든 파일 이름은 Windows 에서 만들 수 없다 — 거기서는 규칙의 name·hint 로만
  const evil = process.platform === 'win32' ? { 'docs/Bad Name.md': '# e\n' } : { 'docs/evil\n::warning title=INJECTED::x.md': '# e\n' };
  const dir = await plainFolder(t, {
    'README.md': '# x\n', ...evil,
    'docbench.json': JSON.stringify({ rules: [{ kind: 'naming', paths: 'docs/**', style: 'kebab-case', name: 'n\n| injected | row |', hint: 'h\n::error title=INJECTED::boom' }] }),
  });
  const summary = path.join(dir, 'summary.md');
  const r = await db(dir, ['check', '--format', 'github'], { GITHUB_WORKSPACE: dir, GITHUB_STEP_SUMMARY: summary });
  assert.ok(!/^::(warning|error) title=INJECTED/m.test(r.stdout), r.stdout);
  assert.ok(r.stdout.split('\n').filter((l) => l.startsWith('::')).every((l) => /^::(error|warning|notice) (file=[^,]*,)?title=/.test(l)));
  const md = await fs.readFile(summary, 'utf8');
  assert.ok(!/^\| injected \| row \|/m.test(md), md);
});

test('check: 폴더를 주지 않으면 위로 올라가 팀 규칙 파일이 있는 곳을 점검한다', async (t) => {
  const dir = await plainFolder(t, { 'README.md': '# x\n', 'docs/guide/a.md': '# a\n', 'docbench.json': JSON.stringify({ rules: [{ kind: 'require', paths: ['CHANGELOG.md'] }] }) });
  const r = await db(path.join(dir, 'docs/guide'), ['check', '--json']);
  const o = JSON.parse(r.stdout);
  assert.equal(o.root, dir);
  assert.equal(o.rules.file, 'docbench.json');
});
