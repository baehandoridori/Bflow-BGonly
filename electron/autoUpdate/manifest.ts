/**
 * v1.21.0 자동 업데이트 — manifest.json 읽기 + 버전 비교.
 * spec §3 빌드 산출물 형식: { version: "1.21.0", buildAt: "2026-05-07T...Z" }
 */
import { promises as fsp } from 'fs';

export interface Manifest {
  version: string;       // semver string
  buildAt: string;       // ISO 8601
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
    return {
      version: parsed.version,
      buildAt: typeof parsed.buildAt === 'string' ? parsed.buildAt : '',
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
