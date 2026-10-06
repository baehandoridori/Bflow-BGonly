/**
 * 휴가 연동 토큰(BFLOW_VACATION_TOKEN) 찾기 + 배포 전 확인.
 *
 * 토큰은 레포에 커밋하지 않고(.env* 는 gitignore) 빌드할 때 화면 묶음에 넣는다.
 * 그런데 `.env.local` 은 메인 체크아웃에만 있어서, 워크트리에서 만든 배포 빌드(v1.127.5·v1.128.0)가
 * 토큰 없이 나갔고 팀 PC 의 휴가 연동이 '인증 토큰이 유효하지 않습니다'로 끊겼다. 빌드는 아무 말 없이 통과했다.
 *
 * 그래서 토큰을 찾는 규칙을 이 파일 한 곳에 두고 세 군데가 같이 쓴다.
 *   - vite.config.ts            : 묶음에 넣을 값을 정한다
 *   - npm run build 의 첫 단계  : 이 파일을 그대로 실행 — 토큰이 없으면 긴 빌드를 시작하기 전에 멈춘다
 *   - generate-manifest.js      : 만들어진 묶음에 토큰이 실제로 들어 있을 때만 배포용 manifest 를 쓴다
 *
 * 찾는 순서: 셸 환경변수 → 빌드 폴더의 .env 파일 → (워크트리라면) 메인 체크아웃의 .env 파일.
 * **토큰 값은 어디에도 출력하지 않는다** — 출처(어느 파일에서 왔는지)만 말한다.
 *
 * 첫 줄에 `#!/usr/bin/env node` 를 두지 않는다 — vite 가 설정 파일을 묶을 때 이 파일 맨 앞에
 * 코드를 끼워 넣어서, 그 줄이 문법 오류가 되고 `vite build` 가 설정을 읽지 못한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TOKEN_KEY = 'BFLOW_VACATION_TOKEN';

/** .env 형식 글에서 key 의 값을 읽는다. 없으면 null, 같은 키가 여러 번이면 마지막 값 */
function parseEnvValue(text, key) {
  let value = null;
  for (const rawLine of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    const raw = match[2].trim();
    const quote = raw[0];
    const closing = quote === '"' || quote === "'" || quote === '`' ? raw.indexOf(quote, 1) : -1;
    value = closing > 0
      ? raw.slice(1, closing)
      : raw.replace(/\s+#.*$/, '').trim();
  }
  return value;
}

/** vite 의 loadEnv 가 읽는 파일과 같은 순서 — 뒤 파일이 앞 파일을 덮는다 */
function envFileNames(mode) {
  return ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
}

/** dir 의 .env 파일들에서 토큰을 읽는다. 비어 있지 않은 값을 찾으면 { token, file }, 없으면 null */
function readTokenFromEnvFiles(dir, mode) {
  let found = null;
  for (const name of envFileNames(mode)) {
    const file = path.join(dir, name);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const value = parseEnvValue(text, TOKEN_KEY);
    if (value !== null) found = { token: value.trim(), file };
  }
  return found && found.token ? found : null;
}

/**
 * root 가 git 워크트리면 메인 체크아웃 폴더를 돌려준다. 메인 체크아웃 자신이거나 git 폴더가 아니면 null.
 *
 * 워크트리의 `.git` 은 폴더가 아니라 `gitdir: <메인>/.git/worktrees/<이름>` 한 줄짜리 파일이고,
 * 그 폴더의 `commondir` 파일이 공용 `.git` 위치를 가리킨다. git 을 실행하지 않고 파일만 읽는다.
 */
function findMainCheckoutRoot(root) {
  const dotGit = path.join(root, '.git');
  let pointer;
  try {
    pointer = fs.readFileSync(dotGit, 'utf8');
  } catch {
    return null; // .git 이 폴더(메인 체크아웃 자신)이거나 git 폴더가 아니다
  }
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
  if (!match) return null;
  const gitDir = path.resolve(root, match[1]);
  let commonDir;
  try {
    commonDir = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    return null; // commondir 가 없으면 워크트리가 아니다(서브모듈 등)
  }
  if (path.basename(commonDir) !== '.git') return null;
  const mainRoot = path.dirname(commonDir);
  return path.resolve(mainRoot) === path.resolve(root) ? null : mainRoot;
}

/**
 * 빌드에 넣을 휴가 연동 토큰을 찾는다.
 * @returns {{ token: string, source: 'env' | 'root' | 'main-checkout' | 'none', file: string | null }}
 */
function resolveVacationToken({ root, env = process.env, mode = 'production' }) {
  const fromEnv = typeof env[TOKEN_KEY] === 'string' ? env[TOKEN_KEY].trim() : '';
  if (fromEnv) return { token: fromEnv, source: 'env', file: null };

  const local = readTokenFromEnvFiles(root, mode);
  if (local) return { token: local.token, source: 'root', file: local.file };

  const mainRoot = findMainCheckoutRoot(root);
  const main = mainRoot ? readTokenFromEnvFiles(mainRoot, mode) : null;
  if (main) return { token: main.token, source: 'main-checkout', file: main.file };

  return { token: '', source: 'none', file: null };
}

/** 토큰을 어디서 찾았는지 사람이 읽을 말로 (값은 넣지 않는다) */
function describeVacationTokenSource(resolved) {
  if (resolved.source === 'env') return `셸 환경변수 ${TOKEN_KEY}`;
  if (resolved.source === 'root') return `빌드 폴더의 ${path.basename(resolved.file)}`;
  if (resolved.source === 'main-checkout') return `메인 체크아웃의 ${resolved.file}`;
  return '없음';
}

/** 토큰을 못 찾았을 때 보여 줄 안내 */
function missingVacationTokenMessage(root) {
  const mainRoot = findMainCheckoutRoot(root);
  return [
    `휴가 연동 토큰(${TOKEN_KEY})을 찾지 못했습니다.`,
    "  토큰 없이 만든 앱은 팀 PC 에서 휴가 연동이 '인증 토큰이 유효하지 않습니다'로 끊깁니다.",
    `  찾아본 곳: 셸 환경변수 ${TOKEN_KEY} → ${path.join(root, '.env.local')}`
      + (mainRoot ? ` → ${path.join(mainRoot, '.env.local')}` : ''),
    `  해결: 위 파일 중 하나에 ${TOKEN_KEY}=... 한 줄을 넣거나 환경변수로 넘긴 뒤 다시 빌드하세요.`,
  ].join('\n');
}

/** dir 아래 .js 파일 중 하나라도 토큰 문자열을 담고 있는지 */
function dirContainsToken(dir, token) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dirContainsToken(full, token)) return true;
    } else if (entry.isFile() && entry.name.endsWith('.js') && fs.readFileSync(full).includes(token)) {
      return true;
    }
  }
  return false;
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 배포 전 확인 — 만들어진 화면 묶음에 토큰이 실제로 들어 있는지 본다.
 *
 * 보는 곳: vite 가 만든 dist/assets 와, 설치 파일로 묶이는 dist/win-unpacked/resources/app/dist/assets.
 * 있는 곳은 모두 토큰을 담고 있어야 한다(둘 다 없으면 실패).
 * @returns {{ ok: boolean, message: string }}
 */
function checkReleaseVacationToken({ root, distDir, env = process.env, mode = 'production' }) {
  const resolved = resolveVacationToken({ root, env, mode });
  if (!resolved.token) return { ok: false, message: missingVacationTokenMessage(root) };

  const bundleDirs = [
    path.join(distDir, 'assets'),
    path.join(distDir, 'win-unpacked', 'resources', 'app', 'dist', 'assets'),
  ].filter(isDirectory);
  if (bundleDirs.length === 0) {
    return { ok: false, message: `휴가 연동 토큰을 확인할 화면 묶음이 없습니다 (${path.join(distDir, 'assets')}).` };
  }

  const missing = bundleDirs.filter((dir) => !dirContainsToken(dir, resolved.token));
  if (missing.length > 0) {
    return {
      ok: false,
      message: [
        '빌드된 화면 묶음에 휴가 연동 토큰이 들어 있지 않습니다.',
        ...missing.map((dir) => `  토큰 없음: ${dir}`),
        `  토큰 출처: ${describeVacationTokenSource(resolved)}`,
        '  토큰을 넣기 전에 만든 묶음일 수 있습니다 — npm run build 를 처음부터 다시 돌리세요.',
      ].join('\n'),
    };
  }

  return {
    ok: true,
    message: `휴가 연동 토큰 확인 — 화면 묶음 ${bundleDirs.length}곳에 들어 있음 (출처: ${describeVacationTokenSource(resolved)})`,
  };
}

module.exports = {
  TOKEN_KEY,
  parseEnvValue,
  findMainCheckoutRoot,
  resolveVacationToken,
  describeVacationTokenSource,
  missingVacationTokenMessage,
  checkReleaseVacationToken,
};

// `node scripts/vacation-token.cjs` — 배포 빌드 첫 단계. 토큰이 없으면 여기서 멈춘다.
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const resolved = resolveVacationToken({ root });
  if (!resolved.token) {
    console.error(`[vacation-token] ${missingVacationTokenMessage(root)}`);
    process.exit(1);
  }
  console.log(`[vacation-token] 휴가 연동 토큰 확인 — 출처: ${describeVacationTokenSource(resolved)}`);
}
