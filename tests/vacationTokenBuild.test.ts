/**
 * 휴가 연동 토큰이 배포 빌드에 '항상' 들어가는지 지키는 테스트
 *
 * 문제: 토큰(BFLOW_VACATION_TOKEN)은 레포에 커밋하지 않고 `.env.local` 에서 읽어 화면 묶음에 넣는데,
 * 그 파일은 메인 체크아웃에만 있다. v1.127.5·v1.128.0 은 워크트리에서 빌드해 토큰이 빈 채로 배포됐고,
 * 팀 PC 의 휴가 연동이 '인증 토큰이 유효하지 않습니다'로 끊겼다. 빌드는 아무 경고 없이 통과했다.
 *
 * 해결: scripts/vacation-token.cjs 한 곳에서 토큰을 찾는다(환경변수 → 빌드 폴더 → 메인 체크아웃).
 * 배포 빌드(npm run build)는 첫 단계에서 토큰이 없으면 멈추고, 마지막 단계(generate-manifest)는
 * 만들어진 묶음에 토큰이 실제로 들어 있을 때만 배포 신호(manifest.json)를 쓴다.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import vacationToken from '../scripts/vacation-token.cjs';

const {
  parseEnvValue,
  findMainCheckoutRoot,
  resolveVacationToken,
  describeVacationTokenSource,
  checkReleaseVacationToken,
} = vacationToken;

const KEY = 'BFLOW_VACATION_TOKEN';
const TOKEN = 'tok-A1b2C3d4E5f6-main';
const OTHER = 'tok-Z9y8X7w6V5u4-other';
const repoRoot = path.resolve(import.meta.dirname, '..');

// ── 임시 폴더 ─────────────────────────────────────────────────────────
const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bflow-vacation-token-'));
  tempDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tempDirs) {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('bflow-vacation-token-'));
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** 메인 체크아웃 + 그 안의 워크트리 한 개를 흉내 낸다 (git 은 실행하지 않고 파일만 만든다) */
function makeWorktree(options: { relativeGitdir?: boolean } = {}): { main: string; worktree: string } {
  const main = path.join(tempDir(), 'repo');
  const worktree = path.join(main, '.claude', 'worktrees', 'lane');
  const gitDir = path.join(main, '.git', 'worktrees', 'lane');
  write(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  write(path.join(gitDir, 'commondir'), '../..\n');
  const pointer = options.relativeGitdir ? path.relative(worktree, gitDir) : gitDir;
  write(path.join(worktree, '.git'), `gitdir: ${pointer.replace(/\\/g, '/')}\n`);
  return { main, worktree };
}

/** 셸에 실제 토큰이 잡혀 있어도 테스트가 흔들리지 않게 그 키만 뺀 환경 */
function envWithout(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  if (!(KEY in extra)) delete env[KEY];
  return env;
}

// ── .env 읽기 ─────────────────────────────────────────────────────────
test('parseEnvValue — .env 한 줄에서 값을 읽는다', () => {
  assert.equal(parseEnvValue(`${KEY}=${TOKEN}`, KEY), TOKEN);
  assert.equal(parseEnvValue(`﻿${KEY}=${TOKEN}\r\n`, KEY), TOKEN, 'BOM·CRLF');
  assert.equal(parseEnvValue(`  export ${KEY} = ${TOKEN}  `, KEY), TOKEN, 'export·공백');
  assert.equal(parseEnvValue(`${KEY}="${TOKEN}"`, KEY), TOKEN, '큰따옴표');
  assert.equal(parseEnvValue(`${KEY}='${TOKEN}' # 메모`, KEY), TOKEN, '작은따옴표 + 뒤 주석');
  assert.equal(parseEnvValue(`${KEY}=${TOKEN} # 메모`, KEY), TOKEN, '따옴표 없는 값 뒤 주석');
  assert.equal(parseEnvValue(`${KEY}=${TOKEN}#메모`, KEY), TOKEN, '따옴표 없는 값은 # 부터 주석 (vite 가 쓰는 dotenv 와 같다)');
  assert.equal(parseEnvValue(`${KEY}=\`${TOKEN}\``, KEY), TOKEN, '백틱 따옴표');
  assert.equal(parseEnvValue(`${KEY}="ab#cd"`, KEY), 'ab#cd', '따옴표 안의 # 은 값의 일부 (dotenv 와 같다)');
  assert.equal(parseEnvValue(`${KEY}="ab#cd" # 메모 "x"`, KEY), 'ab#cd', '따옴표 뒤 주석 안의 따옴표는 상관없다');
  assert.equal(parseEnvValue(`# ${KEY}=${OTHER}\nOTHER_KEY=x\n${KEY}=${TOKEN}`, KEY), TOKEN, '주석·다른 키는 건너뛴다');
  assert.equal(parseEnvValue(`${KEY}=${OTHER}\n${KEY}=${TOKEN}`, KEY), TOKEN, '같은 키는 마지막 값');
  assert.equal(parseEnvValue(`${KEY}_OLD=${OTHER}\nMY_${KEY}=${OTHER}`, KEY), null, '이름이 일부만 같은 키는 다른 키');
  assert.equal(parseEnvValue(`${KEY}=`, KEY), '', '빈 값');
  assert.equal(parseEnvValue(`${KEY}=""`, KEY), '', '빈 따옴표');
  assert.equal(parseEnvValue('', KEY), null);
  // 다른 키의 값이 받지 않는 꼴이어도 상관하지 않는다 — 토큰 줄만 본다
  assert.equal(parseEnvValue(`OTHER="a b $HOME"\n${KEY}=${TOKEN}`, KEY), TOKEN);
});

test('parseEnvValue — vite 가 풀어서 읽는 꼴은 흉내 내지 않고 거부한다 (코덱스 지적)', () => {
  // vite(dotenv-expand)는 ${VAR} 를 다른 값으로 바꾸고 \" 를 " 로 푼다. 글자 그대로 읽으면 묶음에 다른 값이 들어가는데,
  // 빌드 첫 단계와 묶음 확인이 '그 틀린 값'을 서로 확인해 주므로 전부 통과한다 — 토큰이 틀린 앱이 배포된다.
  const unsupported: Array<[string, string]> = [
    ['변수 확장 ${}', `${KEY}=\${VACATION_SECRET}`],
    ['변수 확장 $', `${KEY}=$VACATION_SECRET`],
    ['값 중간의 확장', `${KEY}=abc\${SUFFIX}`],
    ['따옴표 안 확장', `${KEY}="\${VACATION_SECRET}"`],
    ['이스케이프한 따옴표', `${KEY}="abc\\"def"`],
    ['역슬래시', `${KEY}=abc\\ndef`],
    ['따옴표 안 공백', `${KEY}="abc def"`],
    ['따옴표 없는 공백', `${KEY}=abc def`],
    ['닫히지 않은 따옴표(여러 줄 값)', `${KEY}="abc\ndef"`],
    ['따옴표 뒤에 붙은 글자', `${KEY}="abc"def`],
    ['짝이 안 맞는 따옴표', `${KEY}="abc'`],
  ];
  for (const [label, text] of unsupported) {
    assert.throws(() => parseEnvValue(text, KEY), /그대로 읽을 수 없는 꼴/, label);
  }
  // 오류 글에 값이 새지 않는다
  try {
    parseEnvValue(`${KEY}="${TOKEN} \${X}"`, KEY);
    assert.fail('거부해야 한다');
  } catch (error) {
    assert.ok(!(error as Error).message.includes(TOKEN));
  }
  // 마지막 줄이 기준이다: 앞줄이 이상해도 뒷줄이 멀쩡하면 읽고, 뒷줄이 이상하면 거부한다
  assert.equal(parseEnvValue(`${KEY}=\${OLD}\n${KEY}=${TOKEN}`, KEY), TOKEN);
  assert.throws(() => parseEnvValue(`${KEY}=${TOKEN}\n${KEY}=\${NEW}`, KEY));
});

// ── 메인 체크아웃 찾기 ────────────────────────────────────────────────
test('findMainCheckoutRoot — 워크트리면 메인 체크아웃을, 아니면 null 을 돌려준다', () => {
  const absolute = makeWorktree();
  assert.equal(findMainCheckoutRoot(absolute.worktree), absolute.main);
  const relative = makeWorktree({ relativeGitdir: true });
  assert.equal(findMainCheckoutRoot(relative.worktree), relative.main, 'gitdir 가 상대 경로여도');

  assert.equal(findMainCheckoutRoot(absolute.main), null, '.git 이 폴더면 메인 체크아웃 자신');
  assert.equal(findMainCheckoutRoot(tempDir()), null, 'git 폴더가 아님');

  // 서브모듈: .git 은 파일이지만 가리키는 폴더에 commondir 가 없다
  const sub = tempDir();
  write(path.join(sub, 'modules', 'lib', 'HEAD'), 'ref: refs/heads/main\n');
  write(path.join(sub, 'lib', '.git'), 'gitdir: ../modules/lib\n');
  assert.equal(findMainCheckoutRoot(path.join(sub, 'lib')), null, '서브모듈은 워크트리가 아니다');

  // bare 저장소의 워크트리: 공용 폴더 이름이 .git 이 아니다 → 옆 폴더를 메인으로 착각하지 않는다
  const bare = tempDir();
  write(path.join(bare, 'repo.git', 'worktrees', 'lane', 'commondir'), '../..\n');
  write(path.join(bare, 'lane', '.git'), `gitdir: ${path.join(bare, 'repo.git', 'worktrees', 'lane').replace(/\\/g, '/')}\n`);
  assert.equal(findMainCheckoutRoot(path.join(bare, 'lane')), null);
});

// ── 토큰 찾는 순서 ────────────────────────────────────────────────────
test('resolveVacationToken — 워크트리에 .env.local 이 없으면 메인 체크아웃에서 찾는다 (이번 사고의 원인)', () => {
  const { main, worktree } = makeWorktree();
  write(path.join(main, '.env.local'), `${KEY}=${TOKEN}\n`);

  const resolved = resolveVacationToken({ root: worktree, env: {} });
  assert.equal(resolved.token, TOKEN);
  assert.equal(resolved.source, 'main-checkout');
  assert.equal(resolved.file, path.join(main, '.env.local'));
});

test('resolveVacationToken — 환경변수 > 빌드 폴더 > 메인 체크아웃 순서', () => {
  const { main, worktree } = makeWorktree();
  write(path.join(main, '.env.local'), `${KEY}=main-token\n`);
  write(path.join(worktree, '.env.local'), `${KEY}=worktree-token\n`);

  assert.deepEqual(
    resolveVacationToken({ root: worktree, env: { [KEY]: '  env-token  ' } }),
    { token: 'env-token', source: 'env', file: null, problem: null },
  );
  const fromRoot = resolveVacationToken({ root: worktree, env: {} });
  assert.equal(fromRoot.token, 'worktree-token');
  assert.equal(fromRoot.source, 'root');

  // 빌드 폴더의 값이 비어 있으면 '없음'으로 끝내지 않고 메인 체크아웃까지 본다
  write(path.join(worktree, '.env.local'), `${KEY}=\n`);
  assert.equal(resolveVacationToken({ root: worktree, env: { [KEY]: '   ' } }).token, 'main-token');
});

test('resolveVacationToken — vite 와 같은 .env 파일 순서(뒤 파일이 덮는다), mode 별 파일', () => {
  const root = tempDir();
  write(path.join(root, '.env'), `${KEY}=from-env\n`);
  assert.equal(resolveVacationToken({ root, env: {} }).token, 'from-env');
  write(path.join(root, '.env.local'), `${KEY}=from-local\n`);
  assert.equal(resolveVacationToken({ root, env: {} }).token, 'from-local');
  write(path.join(root, '.env.production.local'), `${KEY}=from-production-local\n`);
  assert.equal(resolveVacationToken({ root, env: {} }).token, 'from-production-local', '기본 mode 는 production');
  assert.equal(resolveVacationToken({ root, env: {}, mode: 'development' }).token, 'from-local');
});

test('resolveVacationToken — 어디에도 없으면 빈 값 (메인 체크아웃은 위 폴더를 뒤지지 않는다)', () => {
  const { main, worktree } = makeWorktree();
  assert.deepEqual(resolveVacationToken({ root: worktree, env: {} }), { token: '', source: 'none', file: null, problem: null });

  // 메인 체크아웃에서 빌드할 때 바깥 폴더의 .env.local 을 끌어오지 않는다
  write(path.join(path.dirname(main), '.env.local'), `${KEY}=${OTHER}\n`);
  assert.equal(resolveVacationToken({ root: main, env: {} }).token, '');
});

test('resolveVacationToken — 읽을 수 없는 꼴로 적힌 값은 건너뛰지 않고 거기서 멈춘다', () => {
  const { main, worktree } = makeWorktree();
  write(path.join(main, '.env.local'), `${KEY}=${TOKEN}\n`);
  write(path.join(worktree, '.env.local'), `${KEY}=\${VACATION_SECRET}\n`);

  // 워크트리에 적어 둔 값이 이상하면 메인 체크아웃 값으로 조용히 넘어가지 않는다 —
  // 넘어가면 '고쳐 적은 토큰'이 아니라 옛 토큰으로 빌드된다
  const blocked = resolveVacationToken({ root: worktree, env: {} });
  assert.equal(blocked.token, '');
  assert.equal(blocked.source, 'none');
  assert.equal(blocked.file, path.join(worktree, '.env.local'));
  assert.match(blocked.problem ?? '', /그대로 읽을 수 없는 꼴/);

  // 메인 체크아웃 쪽이 이상할 때도 같다
  write(path.join(worktree, '.env.local'), '# 비움\n');
  write(path.join(main, '.env.local'), `${KEY}="a b"\n`);
  const blockedMain = resolveVacationToken({ root: worktree, env: {} });
  assert.equal(blockedMain.token, '');
  assert.equal(blockedMain.file, path.join(main, '.env.local'));
  assert.ok(blockedMain.problem);

  // 환경변수로 넘긴 값은 파일을 읽지 않으므로 영향받지 않는다
  assert.equal(resolveVacationToken({ root: worktree, env: { [KEY]: OTHER } }).token, OTHER);

  // 같은 폴더에서 뒤 파일이 멀쩡한 값으로 덮으면 그 값을 쓴다 (vite 와 같은 덮어쓰기 순서)
  write(path.join(main, '.env.production.local'), `${KEY}=${TOKEN}\n`);
  assert.deepEqual(
    resolveVacationToken({ root: worktree, env: {} }),
    { token: TOKEN, source: 'main-checkout', file: path.join(main, '.env.production.local'), problem: null },
  );
});

test('describeVacationTokenSource — 출처만 말하고 토큰 값은 넣지 않는다', () => {
  const { main, worktree } = makeWorktree();
  write(path.join(main, '.env.local'), `${KEY}=${TOKEN}\n`);
  for (const env of [{ [KEY]: TOKEN }, {}]) {
    const text = describeVacationTokenSource(resolveVacationToken({ root: worktree, env }));
    assert.ok(text.length > 0);
    assert.ok(!text.includes(TOKEN), text);
  }
  assert.match(describeVacationTokenSource(resolveVacationToken({ root: worktree, env: {} })), /메인 체크아웃/);
});

// ── 배포 전 확인 (묶음에 토큰이 들어 있는지) ──────────────────────────
function makeBuild(options: { built?: string | null; packaged?: string | null; token?: string | null }): {
  root: string;
  distDir: string;
} {
  const root = tempDir();
  const distDir = path.join(root, 'dist');
  mkdirSync(distDir, { recursive: true });
  if (options.token) write(path.join(root, '.env.local'), `${KEY}=${options.token}\n`);
  const bundle = (token: string) => `const a="x",b="${token}",c=b?"내장 토큰 사용 중":"없음";`;
  if (options.built !== null && options.built !== undefined) {
    write(path.join(distDir, 'assets', 'index-abc.js'), bundle(options.built));
    write(path.join(distDir, 'assets', 'style-abc.css'), '.a{color:red}');
  }
  if (options.packaged !== null && options.packaged !== undefined) {
    write(path.join(distDir, 'win-unpacked', 'resources', 'app', 'dist', 'assets', 'chunks', 'index-abc.js'), bundle(options.packaged));
  }
  return { root, distDir };
}

test('checkReleaseVacationToken — 묶음(빌드 결과·설치 파일용 사본) 모두에 토큰이 있어야 통과', () => {
  const ok = makeBuild({ token: TOKEN, built: TOKEN, packaged: TOKEN });
  const passed = checkReleaseVacationToken({ ...ok, env: {} });
  assert.equal(passed.ok, true, passed.message);
  assert.ok(!passed.message.includes(TOKEN), '통과 메시지에도 토큰 값은 없다');

});

test('checkReleaseVacationToken — 설치 파일용 사본이 없으면 빌드 결과만 보고 통과시키지 않는다 (코덱스 지적)', () => {
  // 예전 빌드의 설치 파일만 남고 win-unpacked 가 없는 상태에서 새 vite 결과만 확인해 배포 신호를 내면,
  // 토큰 없는 옛 설치 파일이 그대로 나간다. 설치 파일은 속을 볼 수 없으니 같은 빌드의 사본이 꼭 있어야 한다.
  const onlyBuilt = checkReleaseVacationToken({ ...makeBuild({ token: TOKEN, built: TOKEN }), env: {} });
  assert.equal(onlyBuilt.ok, false);
  assert.match(onlyBuilt.message, /묶음이 없습니다/);
  assert.match(onlyBuilt.message, /win-unpacked/);
  assert.ok(!onlyBuilt.message.includes(TOKEN));

  // 반대로 사본만 있고 빌드 결과가 없는 것도 한 빌드가 아니다
  const onlyPackaged = checkReleaseVacationToken({ ...makeBuild({ token: TOKEN, packaged: TOKEN }), env: {} });
  assert.equal(onlyPackaged.ok, false);
  assert.match(onlyPackaged.message, /묶음이 없습니다/);
});

test('checkReleaseVacationToken — 토큰이 없거나 묶음에 안 들어갔으면 막는다', () => {
  const noToken = checkReleaseVacationToken({ ...makeBuild({ built: '', packaged: '' }), env: {} });
  assert.equal(noToken.ok, false);
  assert.match(noToken.message, /찾지 못했습니다/);

  // 토큰은 있지만 묶음은 토큰 없이 만들어졌다 (v1.128.0 이 나간 모양)
  const emptyBundle = checkReleaseVacationToken({ ...makeBuild({ token: TOKEN, built: '', packaged: '' }), env: {} });
  assert.equal(emptyBundle.ok, false);
  assert.match(emptyBundle.message, /들어 있지 않습니다/);
  assert.ok(!emptyBundle.message.includes(TOKEN));

  // 빌드 결과에는 있는데 설치 파일로 묶이는 사본이 옛 것
  const stalePackaged = checkReleaseVacationToken({ ...makeBuild({ token: TOKEN, built: TOKEN, packaged: OTHER }), env: {} });
  assert.equal(stalePackaged.ok, false);
  assert.match(stalePackaged.message, /win-unpacked/);

  // 다른 토큰이 들어간 묶음
  const otherToken = checkReleaseVacationToken({ ...makeBuild({ token: TOKEN, built: OTHER, packaged: OTHER }), env: {} });
  assert.equal(otherToken.ok, false);
  assert.match(otherToken.message, /들어 있지 않습니다/);

  // 확인할 묶음이 아예 없다
  const noBundle = checkReleaseVacationToken({ ...makeBuild({ token: TOKEN }), env: {} });
  assert.equal(noBundle.ok, false);
  assert.match(noBundle.message, /묶음이 없습니다/);

  // .js 가 아닌 파일에만 있는 것은 치지 않는다
  const textOnly = makeBuild({ token: TOKEN, built: '', packaged: TOKEN });
  write(path.join(textOnly.distDir, 'assets', 'note.txt'), TOKEN);
  const textOnlyCheck = checkReleaseVacationToken({ ...textOnly, env: {} });
  assert.equal(textOnlyCheck.ok, false);
  assert.match(textOnlyCheck.message, /들어 있지 않습니다/);

  // 토큰이 읽을 수 없는 꼴로 적혀 있으면 묶음을 보기 전에 막는다
  const unreadable = makeBuild({ built: TOKEN, packaged: TOKEN });
  write(path.join(unreadable.root, '.env.local'), `${KEY}=\${VACATION_SECRET}\n`);
  const unreadableCheck = checkReleaseVacationToken({ ...unreadable, env: {} });
  assert.equal(unreadableCheck.ok, false);
  assert.match(unreadableCheck.message, /읽을 수 없습니다/);
  assert.ok(!unreadableCheck.message.includes('VACATION_SECRET'), '적힌 값을 안내에 옮기지 않는다');
});

// ── 빌드 첫 단계 (node scripts/vacation-token.cjs) ────────────────────
function copyScripts(root: string): void {
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const name of ['vacation-token.cjs', 'generate-manifest.js']) {
    copyFileSync(path.join(repoRoot, 'scripts', name), path.join(root, 'scripts', name));
  }
}

function run(root: string, script: string, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
    env: envWithout(env),
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test('빌드 첫 단계 — 토큰이 없으면 실패하고, 있으면 출처만 알리고 통과한다', () => {
  const root = tempDir();
  copyScripts(root);

  const missing = run(root, 'vacation-token.cjs');
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /찾지 못했습니다/);
  assert.match(missing.output, /BFLOW_VACATION_TOKEN/);

  write(path.join(root, '.env.local'), `${KEY}=${TOKEN}\n`);
  const found = run(root, 'vacation-token.cjs');
  assert.equal(found.status, 0, found.output);
  assert.match(found.output, /\.env\.local/);
  assert.ok(!found.output.includes(TOKEN), '토큰 값을 출력하지 않는다');

  const fromEnv = run(tempDirWithScripts(), 'vacation-token.cjs', [], { [KEY]: OTHER });
  assert.equal(fromEnv.status, 0, fromEnv.output);
  assert.ok(!fromEnv.output.includes(OTHER));

  // 읽을 수 없는 꼴로 적힌 값: 실패하고, 어느 파일인지와 이유만 말한다
  const unreadableRoot = tempDirWithScripts();
  write(path.join(unreadableRoot, '.env.local'), `${KEY}="\${VACATION_SECRET}"\n`);
  const unreadable = run(unreadableRoot, 'vacation-token.cjs');
  assert.equal(unreadable.status, 1, unreadable.output);
  assert.match(unreadable.output, /읽을 수 없습니다/);
  assert.match(unreadable.output, /\.env\.local/);
  assert.ok(!unreadable.output.includes('VACATION_SECRET'));
});

function tempDirWithScripts(): string {
  const root = tempDir();
  copyScripts(root);
  return root;
}

// ── 배포 신호 파일 (generate-manifest.js) ─────────────────────────────
function makeRelease(options: { built?: string | null; packaged?: string | null; token?: string | null }): string {
  const { root, distDir } = makeBuild(options);
  copyScripts(root);
  write(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  write(path.join(distDir, 'BFLOW-Setup.exe'), 'installer');
  return root;
}

test('generate-manifest — 배포용은 묶음에 토큰이 있을 때만 manifest.json 을 쓴다', () => {
  const good = makeRelease({ token: TOKEN, built: TOKEN, packaged: TOKEN });
  const ok = run(good, 'generate-manifest.js');
  assert.equal(ok.status, 0, ok.output);
  assert.equal(JSON.parse(readFileSync(path.join(good, 'dist', 'manifest.json'), 'utf8')).version, '9.9.9');
  assert.ok(!ok.output.includes(TOKEN), '토큰 값을 출력하지 않는다');
  assert.ok(!readFileSync(path.join(good, 'dist', 'manifest.json'), 'utf8').includes(TOKEN), 'manifest 에도 토큰은 없다');

  for (const [label, options] of [
    ['토큰을 못 찾음', { built: '', packaged: '' }],
    ['묶음이 토큰 없이 만들어짐', { token: TOKEN, built: '', packaged: '' }],
    ['설치 파일용 사본에 토큰 없음', { token: TOKEN, built: TOKEN, packaged: '' }],
    // 예전 빌드의 설치 파일만 남고 win-unpacked 가 없는데 새 vite 결과에는 토큰이 있다 (코덱스 지적)
    ['설치 파일용 사본이 없음(옛 설치 파일만 남음)', { token: TOKEN, built: TOKEN }],
  ] as const) {
    const root = makeRelease(options);
    const blocked = run(root, 'generate-manifest.js');
    assert.notEqual(blocked.status, 0, `${label}: ${blocked.output}`);
    assert.equal(existsSync(path.join(root, 'dist', 'manifest.json')), false, `${label}: manifest 를 쓰면 안 된다`);
    assert.ok(!blocked.output.includes(TOKEN), label);
  }
});

test('generate-manifest — 개발용(--allow-missing-installer)은 토큰이 없어도 만든다', () => {
  const root = makeRelease({ built: '' });
  const dev = run(root, 'generate-manifest.js', ['--allow-missing-installer']);
  assert.equal(dev.status, 0, dev.output);
  assert.equal(existsSync(path.join(root, 'dist', 'manifest.json')), true);
});

// ── 연결 (스크립트·빌드 설정이 위 규칙을 실제로 쓰는지) ───────────────
test('package.json — 배포 빌드만 토큰 확인으로 시작한다', () => {
  const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts as Record<string, string>;
  assert.ok(scripts.build.startsWith('node scripts/vacation-token.cjs && '), scripts.build.slice(0, 80));
  assert.ok(scripts.build.endsWith(' && node scripts/generate-manifest.js'));
  assert.ok(!scripts['build:vite'].includes('vacation-token'), '개발용 빌드는 토큰 없이도 돈다(CI·다른 PC)');
  assert.ok(scripts['build:vite'].endsWith('node scripts/generate-manifest.js --allow-missing-installer'));
  assert.ok(scripts['test:vacation'].includes('./tests/vacationTokenBuild.test.ts'));
});

test('vite.config.ts — 묶음에 넣는 토큰은 같은 규칙(resolveVacationToken)으로 찾는다', () => {
  const config = readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
  assert.match(config, /from '\.\/scripts\/vacation-token\.cjs'/);
  assert.match(config, /resolveVacationToken\(\{ root: __dirname, mode \}\)/);
  assert.match(config, /__BFLOW_VACATION_TOKEN__: JSON\.stringify\(vacationTokenFor\(mode\)\)/);
  assert.doesNotMatch(config, /loadEnv/, 'vite 의 loadEnv 로 따로 읽으면 메인 체크아웃을 못 본다');
});

test('vite.config.ts — vite 가 실제로 읽을 수 있고, 찾은 토큰이 define 으로 들어간다', async () => {
  // 처음 만든 판은 단위 테스트를 다 통과하고도 실제 빌드에서 멈췄다: vite 가 설정을 묶으며
  // scripts/vacation-token.cjs 앞에 코드를 끼워 넣어 첫 줄의 `#!` 가 문법 오류가 됐다.
  // 그래서 문자열 확인만 하지 않고 vite 가 읽는 방식 그대로 설정을 읽어 본다.
  const { loadConfigFromFile } = await import('vite');
  const previous = process.env[KEY];
  process.env[KEY] = TOKEN;
  try {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      path.join(repoRoot, 'vite.config.ts'),
      repoRoot,
      'silent',
    );
    assert.ok(loaded, 'vite.config.ts 를 읽지 못했다');
    assert.equal(loaded.config.define?.__BFLOW_VACATION_TOKEN__, JSON.stringify(TOKEN));
  } finally {
    if (previous === undefined) delete process.env[KEY];
    else process.env[KEY] = previous;
  }
});
