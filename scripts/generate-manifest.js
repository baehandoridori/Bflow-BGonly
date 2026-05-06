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

const manifest = {
  version: pkg.version,
  buildAt: new Date().toISOString(),
};

const out = path.join(distDir, 'manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[generate-manifest] ${out} 생성 — v${manifest.version} @ ${manifest.buildAt}`);
