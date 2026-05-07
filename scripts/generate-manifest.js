#!/usr/bin/env node
/**
 * v1.21.0 자동 업데이트 — 빌드 후 dist/manifest.json 자동 생성.
 * `npm run build` 마지막 step. 한솔 손 거치지 않음.
 *
 * 출력 형식 (spec §3): { "version": "1.21.0", "buildAt": "ISO8601" }
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const allowMissingInstaller = process.argv.includes('--allow-missing-installer');

const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  console.error('[generate-manifest] dist/ 가 없음. vite build 먼저 실행하세요.');
  process.exit(1);
}

/**
 * Codex 9차 P1: win-unpacked의 fileCount + totalBytes 기록.
 * checker가 G드라이브 sync 완전성 검증 (원격 manifest와 실제 파일 트리 비교) +
 * mirror copy 사후 검증 (로컬 pending이 원격과 일치하는지) 두 단계로 사용.
 * partial sync/copy 상태에서 .ready 마커가 잘못 만들어져 broken app swap되는 사고 방지.
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

const releaseNotesPath = path.join(root, 'DEVLOG', 'update-notes.json');
if (fs.existsSync(releaseNotesPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(releaseNotesPath, 'utf-8'));
    if (Array.isArray(parsed)) {
      manifest.releaseNotes = parsed
        .filter((note) => (
          note
          && typeof note === 'object'
          && Array.isArray(note.items)
          && note.items.some((item) => typeof item === 'string' && item.trim())
        ))
        .slice(0, 3)
        .map((note) => ({
          version: typeof note.version === 'string' ? note.version : pkg.version,
          title: typeof note.title === 'string' ? note.title : '',
          items: note.items.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5),
        }));
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
