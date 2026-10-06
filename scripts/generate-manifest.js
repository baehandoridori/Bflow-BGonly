#!/usr/bin/env node
/**
 * 자동 업데이트 manifest 생성.
 *
 * `npm run build` 마지막 step에서 dist/manifest.json을 만든다.
 * 현재 배포 방식은 G드라이브 dist를 배포 채널로 두고, 앱이 manifest를 읽어
 * 로컬 캐시에 BFLOW-Setup.exe를 받아둔 뒤 installer helper로 적용한다.
 */
const fs = require('fs');
const path = require('path');
const { checkReleaseVacationToken } = require('./vacation-token.cjs');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const allowMissingInstaller = process.argv.includes('--allow-missing-installer');

const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  console.error('[generate-manifest] dist/ 가 없음. vite build 먼저 실행하세요.');
  process.exit(1);
}

/**
 * win-unpacked의 fileCount + totalBytes 기록.
 * 지금 적용 단위는 BFLOW-Setup.exe지만, win-unpacked도 배포 산출물이라 배포 상태
 * 검증과 사람이 보는 sanity check에 사용한다.
 */
const winUnpacked = path.join(distDir, 'win-unpacked');
let fileCount = 0;
let totalBytes = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile()) {
      fileCount++;
      totalBytes += fs.statSync(full).size;
    }
  }
}
if (fs.existsSync(winUnpacked)) {
  walk(winUnpacked);
} else {
  console.warn('[generate-manifest] dist/win-unpacked 없음 — fileCount/totalBytes 0으로 기록');
}

const manifest = {
  version: pkg.version,
  buildAt: new Date().toISOString(),
  fileCount,
  totalBytes,
};

const installerFileName = 'BFLOW-Setup.exe';
const installerPath = path.join(distDir, installerFileName);
if (fs.existsSync(installerPath)) {
  manifest.installer = {
    fileName: installerFileName,
    sizeBytes: fs.statSync(installerPath).size,
  };
} else {
  const message = '[generate-manifest] BFLOW-Setup.exe 없음 — 배포용 manifest를 만들 수 없습니다.';
  if (!allowMissingInstaller) {
    console.error(`${message} electron-builder 완료 후 다시 실행하세요.`);
    process.exit(1);
  }
  console.warn(`${message} --allow-missing-installer 플래그로 개발용 manifest만 생성합니다.`);
}

/**
 * 배포용 manifest 는 화면 묶음에 휴가 연동 토큰이 실제로 들어 있을 때만 쓴다.
 * manifest.json 이 업데이트 신호라, 이게 없으면 토큰 빠진 빌드가 팀 PC 로 나가지 않는다.
 * (v1.127.5·v1.128.0 이 토큰 없이 배포돼 휴가 연동이 끊겼다. 개발용 빌드는 토큰 없이도 만든다.)
 */
if (!allowMissingInstaller) {
  const tokenCheck = checkReleaseVacationToken({ root, distDir });
  if (!tokenCheck.ok) {
    console.error(`[generate-manifest] ${tokenCheck.message}`);
    console.error('[generate-manifest] 배포용 manifest를 만들지 않았습니다.');
    process.exit(1);
  }
  console.log(`[generate-manifest] ${tokenCheck.message}`);
}

/**
 * 배포용 manifest 는 설치 파일에 담기는 화면 폴더(win-unpacked/resources/app/dist)에
 * 빌드 산출물이 다시 들어가 있지 않을 때만 쓴다.
 *
 * 화면 묶음 폴더와 electron-builder 출력 폴더가 둘 다 dist 라서, package.json build.files 의
 * "dist 아래 전부" 포함 규칙은 방금 풀어 둔 런타임(dist/win-unpacked)과 이전 설치 파일까지 앱 안으로 다시 담는다.
 * v1.128.1 까지 런타임 한 벌(71개, 268MB)이 앱 안에 더 들어가 설치 파일이 192MB 였다(뺀 뒤 115MB).
 * build.files 의 `!dist/…` 제외 규칙이 이를 막고, 여기서는 결과물에서 직접 확인한다.
 * 화면 폴더에는 vite 가 만드는 것(index.html·assets·public 에서 복사된 항목)만 있어야 한다.
 */
if (!allowMissingInstaller) {
  // 이 폴더가 있다는 것은 위 토큰 확인이 이미 봤다(그 안의 assets 가 없으면 거기서 멈춘다).
  const packagedScreenDir = path.join(winUnpacked, 'resources', 'app', 'dist');
  const publicDir = path.join(root, 'public');
  const viteOutputs = new Set([
    'index.html',
    'assets',
    ...(fs.existsSync(publicDir) ? fs.readdirSync(publicDir) : []),
  ]);
  const leaked = fs.readdirSync(packagedScreenDir).filter((name) => !viteOutputs.has(name)).sort();
  if (leaked.length > 0) {
    console.error('[generate-manifest] 설치 파일에 담기는 화면 폴더에 빌드 산출물이 섞여 있습니다.');
    console.error(`  위치: ${packagedScreenDir}`);
    console.error(`  섞인 항목: ${leaked.join(', ')}`);
    console.error("  package.json build.files 의 '!dist/…' 제외 규칙이 빠지거나 'dist/**/*' 앞으로 옮겨지지 않았는지 확인하세요.");
    console.error('  (vite 가 새로 만드는 항목이라면 이 확인의 허용 목록에 추가합니다.)');
    console.error('[generate-manifest] 배포용 manifest를 만들지 않았습니다.');
    process.exit(1);
  }
  console.log('[generate-manifest] 앱 묶음 확인 — 화면 폴더에 빌드 산출물이 섞이지 않음');
}

const releaseNotesPath = path.join(root, 'DEVLOG', 'update-notes.json');
function normalizeReleaseNoteItem(item) {
  if (typeof item === 'string') {
    const text = item.trim();
    return text ? text : null;
  }
  if (!item || typeof item !== 'object') return null;
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  if (!summary && !description) return null;
  return {
    category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : undefined,
    summary: summary || description,
    description,
  };
}

if (fs.existsSync(releaseNotesPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(releaseNotesPath, 'utf-8'));
    if (Array.isArray(parsed)) {
      manifest.releaseNotes = parsed
        .filter((note) => note && typeof note === 'object' && Array.isArray(note.items))
        .map((note) => ({
          version: typeof note.version === 'string' ? note.version : pkg.version,
          title: typeof note.title === 'string' ? note.title : '',
          items: note.items.map(normalizeReleaseNoteItem).filter(Boolean),
        }))
        .filter((note) => note.items.length > 0);
    }
  } catch (err) {
    console.warn('[generate-manifest] update-notes.json 읽기 실패 — releaseNotes 없이 진행:', err);
  }
}

const out = path.join(distDir, 'manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `[generate-manifest] ${out} 생성 — v${manifest.version} @ ${manifest.buildAt} `
  + `(${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`,
);
