/**
 * 컴포지팅 대시보드 — 카드 1장당 데이터 모델.
 *
 * compositing_states 는 (episodeNumber, sceneId) 단위 1 row.
 * 같은 sceneId 가 BG / ACT 파트에 둘 다 있을 수 있으나, 카드 한 장은 그 페어를 묶어 표시한다.
 * (담당자 2 명, 이미지는 BG storyboardUrl/guideUrl 우선, 없으면 ACT.)
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (8.1~8.3)
 */

import type { Episode, Scene } from '@/types';

export interface CardScene {
  /** 'a001', 'b012' 등 — compositing_states.sceneId 와 매칭. */
  sceneId: string;
  /** 'A' | 'B' | 'C' | 'D' — 대문자 정규화. */
  partId: string;
  episodeNumber: number;
  /** 정렬용 — BG 시트의 no. 없으면 ACT 시트의 no. */
  orderNo: number;
  /** 이미지: BG 우선, fallback ACT. */
  storyboardUrl?: string;
  guideUrl?: string;
  /** 씬 길이 (24fps 기준 프레임). null 이면 룰러 fallback. */
  durationFrames?: number | null;
  bg?: Scene;
  act?: Scene;
  /** BG 시트명 / ACT 시트명 (활동 기록, 모달 등에서 필요). */
  bgSheetName?: string;
  actSheetName?: string;
  /** BG / ACT 파트의 Supabase UUID — 댓글 fetch (`readCommentsForPart`) 에 필요. */
  bgPartUuid?: string;
  actPartUuid?: string;
  /**
   * BG / ACT 시트의 scenes 배열 안 인덱스 (-1 if absent).
   * 한솔 결정 (2026-05-22): "댓글이 가끔 안 불러와지는 문제" 근본 해결을 위해
   * buildCardScenes 1 회 lookup 시점에 인덱스도 함께 저장. CompositingSceneModal 가
   * 별도 lookup 으로 인덱스 재계산하면서 두 패턴이 어긋날 가능성을 원천 차단.
   */
  bgSceneIndex: number;
  actSceneIndex: number;
}

export interface CardSceneGroup {
  partId: string;
  scenes: CardScene[];
}

/** partId 를 'A' / 'B' / ... 대문자로 정규화. */
function normPartId(p: string): string {
  return (p || '').trim().slice(0, 1).toUpperCase();
}

/**
 * sceneId 안의 마지막 숫자 부분을 추출. 정렬에 사용.
 * 'a001' → 1, 'a025' → 25, 'b100' → 100.
 * 사전식 정렬은 'a100' < 'a25' < 'a5' 가 되어버려 — 숫자 정렬로 fix (한솔 보고 2026-05-21).
 */
function sceneIdNumeric(id: string): number {
  const m = (id || '').match(/(\d+)/g);
  if (!m || m.length === 0) return Number.MAX_SAFE_INTEGER;
  // 마지막 숫자 그룹을 우선 사용 (보통 sceneId 의 컷 번호)
  return parseInt(m[m.length - 1], 10);
}

/** 한 EP 의 모든 씬을 (epNum, sceneId) 단위로 묶어 PartId 별 그룹 반환. */
export function buildCardScenes(episode: Episode | undefined): CardSceneGroup[] {
  if (!episode) return [];

  // sceneId → CardScene
  const byScene = new Map<string, CardScene>();

  for (const part of episode.parts) {
    const partId = normPartId(part.partId);
    const isBg = part.department === 'bg';
    part.scenes.forEach((sc, sceneIdx) => {
      const key = sc.sceneId;
      const existing = byScene.get(key);
      const next: CardScene = existing ?? {
        sceneId: sc.sceneId,
        partId,
        episodeNumber: episode.episodeNumber,
        orderNo: sc.no,
        durationFrames: sc.durationFrames ?? null,
        bgSceneIndex: -1,
        actSceneIndex: -1,
      };
      if (isBg) {
        next.bg = sc;
        next.bgSheetName = part.sheetName;
        next.bgPartUuid = part.id;
        next.bgSceneIndex = sceneIdx;
        if (!next.storyboardUrl) next.storyboardUrl = sc.storyboardUrl;
        if (!next.guideUrl) next.guideUrl = sc.guideUrl;
        next.orderNo = sc.no; // BG 우선
        if (next.durationFrames == null) next.durationFrames = sc.durationFrames ?? null;
      } else {
        next.act = sc;
        next.actSheetName = part.sheetName;
        next.actPartUuid = part.id;
        next.actSceneIndex = sceneIdx;
        if (!next.storyboardUrl) next.storyboardUrl = sc.storyboardUrl;
        if (!next.guideUrl) next.guideUrl = sc.guideUrl;
        if (next.bg === undefined) next.orderNo = sc.no;
        if (next.durationFrames == null) next.durationFrames = sc.durationFrames ?? null;
      }
      byScene.set(key, next);
    });
  }

  // partId 별로 그룹핑, 각 그룹 안에서 orderNo 정렬
  const byPart = new Map<string, CardScene[]>();
  for (const cs of byScene.values()) {
    if (!byPart.has(cs.partId)) byPart.set(cs.partId, []);
    byPart.get(cs.partId)!.push(cs);
  }
  // sceneId 안 숫자 부분으로 정렬 (사전식 'a100 < a25 < a5' 문제 fix).
  // orderNo (Scene.no) 는 BG/ACT 시트의 행 인덱스 — 둘이 다르면 어색해질 수 있어,
  // sceneId 의 컷 번호를 1순위로 사용한다. tie 시 orderNo.
  for (const arr of byPart.values()) {
    arr.sort((a, b) => {
      const an = sceneIdNumeric(a.sceneId);
      const bn = sceneIdNumeric(b.sceneId);
      if (an !== bn) return an - bn;
      return a.orderNo - b.orderNo;
    });
  }

  return [...byPart.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([partId, scenes]) => ({ partId, scenes }));
}

/** EP 전체 씬 평탄화 (Timeline 패널 룰러용). partId → sceneId 안 숫자 순. */
export function flattenCardScenes(groups: CardSceneGroup[]): CardScene[] {
  const all: CardScene[] = [];
  for (const g of groups) for (const sc of g.scenes) all.push(sc);
  all.sort((a, b) => {
    if (a.partId !== b.partId) return a.partId.localeCompare(b.partId);
    const an = sceneIdNumeric(a.sceneId);
    const bn = sceneIdNumeric(b.sceneId);
    if (an !== bn) return an - bn;
    return a.orderNo - b.orderNo;
  });
  return all;
}

/** 표시용 담당자 이니셜. 한국어 이름의 첫 글자 가져오기. */
export function nameInitial(name?: string): string {
  return (name ?? '').trim().slice(0, 1) || '?';
}

/** 표시 이름 — 콤마 분리되어 있으면 첫 사람만. */
export function primaryAssignee(name?: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const first = trimmed.split(/[,，·\/]/)[0];
  return first.trim();
}
