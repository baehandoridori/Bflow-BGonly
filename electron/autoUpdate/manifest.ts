/**
 * 자동 업데이트 manifest.json 읽기 + 버전 비교.
 *
 * 현재 manifest는 version/buildAt 외에 installer 메타데이터와 releaseNotes를 포함한다.
 * 앱은 이 파일을 최신 버전 감지 신호로 사용하므로 배포 시 반드시 마지막에 갱신한다.
 */
import { promises as fsp, readdirSync, statSync } from 'fs';
import path from 'path';

export interface Manifest {
  version: string;       // semver string
  buildAt: string;       // ISO 8601
  /** Codex 9차 P1: 빌드 시점의 win-unpacked 파일 수 (sync 완전성 검증용). 옛 빌드 호환을 위해 optional. */
  fileCount?: number;
  /** 빌드 시점의 win-unpacked 총 byte 수 (sync 완전성 검증용). optional. */
  totalBytes?: number;
  /** v1.22.14: directory swap 대신 로컬 캐시 후 실행할 NSIS installer 메타데이터. */
  installer?: {
    fileName: string;
    sizeBytes?: number;
  };
  /** 앱 안 업데이트 센터에 표시할 짧은 변경 요약. */
  releaseNotes?: ReleaseNote[];
}

export interface ReleaseNote {
  version: string;
  title: string;
  items: ReleaseNoteItem[];
}

export type ReleaseNoteItem = string | {
  category?: string;
  summary: string;
  description?: string;
};

function normalizeReleaseNoteItem(value: unknown): ReleaseNoteItem | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? text : null;
  }
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  if (!summary && !description) return null;
  return {
    category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : undefined,
    summary: summary || description,
    description,
  };
}

function normalizeReleaseNotes(value: unknown): ReleaseNote[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const notes: ReleaseNote[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const note = entry as Record<string, unknown>;
    if (!Array.isArray(note.items)) continue;
    const items = note.items
      .map(normalizeReleaseNoteItem)
      .filter((item): item is ReleaseNoteItem => item !== null);
    if (items.length === 0) continue;
    notes.push({
      version: typeof note.version === 'string' ? note.version : '',
      title: typeof note.title === 'string' ? note.title : '',
      items,
    });
  }
  return notes.length > 0 ? notes : undefined;
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
      installer: normalizeInstaller(parsed.installer),
      releaseNotes: normalizeReleaseNotes(parsed.releaseNotes),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn('[autoUpdate] manifest 읽기 실패:', filePath, err);
    return null;
  }
}

function normalizeInstaller(value: unknown): Manifest['installer'] {
  if (!value || typeof value !== 'object') return undefined;
  const installer = value as Record<string, unknown>;
  if (typeof installer.fileName !== 'string' || installer.fileName.trim().length === 0) return undefined;
  return {
    fileName: installer.fileName,
    sizeBytes: typeof installer.sizeBytes === 'number' ? installer.sizeBytes : undefined,
  };
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
 * 현재 적용 단위는 installer지만, win-unpacked 배포 산출물 sanity check에 사용한다.
 */
export function countFilesAndBytes(root: string): { fileCount: number; totalBytes: number } {
  let fileCount = 0;
  let totalBytes = 0;
  function walk(dir: string): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
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
