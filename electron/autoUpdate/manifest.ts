/**
 * v1.21.0 자동 업데이트 — manifest.json 읽기 + 버전 비교.
 * spec §3 빌드 산출물 형식: { version: "1.21.0", buildAt: "2026-05-07T...Z" }
 */
import { promises as fsp, statSync } from 'fs';
import path from 'path';

export interface Manifest {
  version: string;       // semver string
  buildAt: string;       // ISO 8601
  /** Codex 9차 P1: 빌드 시점의 win-unpacked 파일 수 (sync 완전성 검증용). 옛 빌드 호환을 위해 optional. */
  fileCount?: number;
  /** 빌드 시점의 win-unpacked 총 byte 수 (sync 완전성 검증용). optional. */
  totalBytes?: number;
}

/**
 * 안전 read — 파일 없으면 null. JSON 깨졌으면 null + console.warn.
 * G드라이브 sync 진행 중에 파일이 한순간 partial일 수 있어 throw 안 함.
 */
export async function readManifest(filePath: string): Promise<Manifest | null> {
  try {
    const text = await fsp.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(text);
    if (typeof parsed?.version !== 'string') return null;
    // Codex 10차 P1: fileCount/totalBytes도 parse — 9차 통합성 검증이 silent 비활성되던 문제.
    // 옛 manifest(필드 없음)는 undefined로 두고 checker에서 호환 폴백.
    return {
      version: parsed.version,
      buildAt: typeof parsed.buildAt === 'string' ? parsed.buildAt : '',
      fileCount: typeof parsed.fileCount === 'number' ? parsed.fileCount : undefined,
      totalBytes: typeof parsed.totalBytes === 'number' ? parsed.totalBytes : undefined,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn('[autoUpdate] manifest 읽기 실패:', filePath, err);
    return null;
  }
}

/**
 * semver 문자열 비교. major.minor.patch만 — pre-release 태그 무시.
 * a > b면 1, a == b면 0, a < b면 -1.
 *
 * 예: compareVersions("1.21.0", "1.20.5") === 1
 *     compareVersions("1.20.0", "1.20.0") === 0
 *     compareVersions("1.19.7", "1.20.0") === -1
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/**
 * 디렉토리 안 모든 파일을 재귀로 세고 총 byte 합 계산.
 * Codex 9차 P1: G드라이브 sync 완전성 검증 + mirror copy 사후 검증에 사용.
 */
export function countFilesAndBytes(root: string): { fileCount: number; totalBytes: number } {
  let fileCount = 0;
  let totalBytes = 0;
  function walk(dir: string): void {
    let entries;
    try { entries = require('fs').readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          fileCount++;
          totalBytes += statSync(full).size;
        } catch { /* skip 잠금/race */ }
      }
    }
  }
  walk(root);
  return { fileCount, totalBytes };
}
