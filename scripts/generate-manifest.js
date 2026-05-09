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
          items: note.items.map(normalizeReleaseNoteItem).filter(Boolean).slice(0, 5),
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
