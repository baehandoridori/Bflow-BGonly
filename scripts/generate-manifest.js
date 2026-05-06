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

const out = path.join(distDir, 'manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `[generate-manifest] ${out} 생성 — v${manifest.version} @ ${manifest.buildAt} `
  + `(${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`,
);
