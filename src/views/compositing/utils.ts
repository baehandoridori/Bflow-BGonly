// ─── 유틸 ───────────────────────────────────

import type { CompRevision } from '@/types';

/** 이름에서 이니셜 2자 추출 */
export function getInitials(name: string): string {
  if (!name) return '?';
  // 한글이면 첫 2글자, 영어면 이니셜
  if (/[가-힯]/.test(name)) return name.slice(0, 2);
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2);
}

/** sceneKey에서 정보 파싱 */
export function parseSceneKey(sceneKey: string): { ep: string; part: string; sceneId: string } {
  const [ep, part, sceneId] = sceneKey.split(':');
  return { ep: ep || '', part: part || '', sceneId: sceneId || '' };
}

/** 텍스트에서 G: 로 시작하는 경로를 분리 */
export function parsePathsFromText(text: string): { description: string; paths: string[] } {
  // 각 줄에서 G:\로 시작하는 부분을 경로로 인식 (공백 포함, 줄 끝까지)
  const lines = text.split('\n');
  const paths: string[] = [];
  const descLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // 줄 전체가 G:\로 시작하면 경로 (Windows 드라이브 letter 가 case-insensitive 라 g:\ 도 인식)
    if (/^G:\\/i.test(trimmed)) {
      paths.push(trimmed);
    } else {
      // 줄 중간에 G:\ (또는 g:\) 가 있으면 그 앞은 설명, 뒤는 경로
      const m = /G:\\/i.exec(trimmed);
      if (m) {
        const idx = m.index;
        const before = trimmed.slice(0, idx).trim();
        const pathPart = trimmed.slice(idx).trim();
        if (before) descLines.push(before);
        paths.push(pathPart);
      } else {
        descLines.push(line);
      }
    }
  }

  const description = descLines.join('\n').trim();
  return { description, paths };
}

// ─── 씬 정보 매핑 타입 ──────────────────────

export interface SceneInfo {
  sceneKey: string;
  sceneId: string;
  sceneNo: number;
  sceneName: string; // memo
  sheetName: string;
  part: string;
  department: 'bg' | 'acting';
  assignee: string;
  /** v1.19.0: 씬 모달 점프용 — 알려진 경우 정확한 정보 전달, 모르면 sceneKey에서 파싱 폴백 */
  episodeNumber?: number;
  partId?: string;
  sceneUuid?: string;
}

export interface SceneGroup {
  sceneKey: string;
  info: SceneInfo;
  revisions: CompRevision[];
  openCount: number;
  uniqueRequesters: string[];
}

// ─── v1.19.0: 검색 + 정렬 ──────────────────

export type SortMode = 'recent' | 'oldest' | 'sceneNo' | 'comments';

/**
 * 본문/등록자/씬 이름에서 검색어 일치하는 리비전만 필터.
 * 빈 쿼리면 전체 반환.
 */
export function filterRevisionsBySearch(
  revisions: CompRevision[],
  query: string,
  sceneInfoMap: Map<string, SceneInfo>,
): CompRevision[] {
  if (!query.trim()) return revisions;
  const q = query.toLowerCase();
  return revisions.filter((r) => {
    if (r.description?.toLowerCase().includes(q)) return true;
    if (r.requesterName?.toLowerCase().includes(q)) return true;
    const info = sceneInfoMap.get(r.sceneKey);
    if (info?.sceneName?.toLowerCase().includes(q)) return true;
    if (info?.sceneId?.toLowerCase().includes(q)) return true;
    return false;
  });
}

/**
 * 정렬. commentCounts(rev.id → count) 가 없으면 댓글 정렬은 0으로 폴백.
 */
export function sortRevisions(
  revisions: CompRevision[],
  mode: SortMode,
  commentCounts?: Map<string, number>,
): CompRevision[] {
  const sorted = [...revisions];
  switch (mode) {
    case 'recent':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'oldest':
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case 'sceneNo':
      return sorted.sort((a, b) => a.sceneKey.localeCompare(b.sceneKey));
    case 'comments':
      return sorted.sort(
        (a, b) => (commentCounts?.get(b.id) ?? 0) - (commentCounts?.get(a.id) ?? 0),
      );
    default:
      return sorted;
  }
}
