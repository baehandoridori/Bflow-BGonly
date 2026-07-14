/**
 * 캐릭터 기준 키 드래그 조정(피드백 33) — 머리/바닥 기준선 계산 순수 유틸.
 * node --test 에서 직접 import 하므로 '@/' alias 를 쓰지 않는다 (alias-free).
 */

/** 기준선 위치 — 이미지 세로(0=맨 위, 1=맨 아래)에 대한 비율. top < bottom 을 유지한다. */
export interface HeightGuides {
  topRatio: number;
  bottomRatio: number;
}

/** 편집 시작 기본값 — 이미지 전체 높이(위 0 ~ 아래 1). */
export const DEFAULT_HEIGHT_GUIDES: HeightGuides = { topRatio: 0, bottomRatio: 1 };

/** 기준선 사이 최소 간격(이미지 높이 대비 비율) — 두 선이 겹치거나 뒤집히지 않게 한다. */
export const MIN_GUIDE_GAP_RATIO = 0.02;

/** DB CHECK(chk_characters_reference_height: 0 < v < 5000)와 같은 클램프 범위. */
export const MIN_HEIGHT_PX = 1;
export const MAX_HEIGHT_PX = 4999;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 드래그 결과를 유효한 기준선으로 정규화.
 * - 각 선을 0~1 로 클램프.
 * - which 로 지정한 '방금 움직인 선'이 반대 선을 밀지 않고 최소 간격 앞에서 멈춘다.
 */
export function clampGuides(next: HeightGuides, which: 'top' | 'bottom'): HeightGuides {
  const top = clamp(next.topRatio, 0, 1);
  const bottom = clamp(next.bottomRatio, 0, 1);
  if (bottom - top >= MIN_GUIDE_GAP_RATIO) return { topRatio: top, bottomRatio: bottom };
  if (which === 'top') {
    return { topRatio: clamp(bottom - MIN_GUIDE_GAP_RATIO, 0, 1 - MIN_GUIDE_GAP_RATIO), bottomRatio: bottom };
  }
  return { topRatio: top, bottomRatio: clamp(top + MIN_GUIDE_GAP_RATIO, MIN_GUIDE_GAP_RATIO, 1) };
}

/**
 * 기준선 → 키(px) 환산. baseHeightPx = 이 이미지 '원본' 세로 픽셀(natural_height).
 * 결과는 DB CHECK 범위(1~4999)로 클램프한 정수.
 */
export function guidesToHeightPx(guides: HeightGuides, baseHeightPx: number): number {
  const span = Math.max(0, guides.bottomRatio - guides.topRatio);
  return clamp(Math.round(span * baseHeightPx), MIN_HEIGHT_PX, MAX_HEIGHT_PX);
}

/**
 * 업로드 시 자동 설정값(피드백 33a) — 원본 세로 px 를 DB CHECK 범위로 클램프한 정수.
 * 측정 실패(null·0 이하)면 null 을 돌려 자동 설정을 건너뛴다.
 */
export function autoHeightFromNatural(naturalHeight: number | null | undefined): number | null {
  if (naturalHeight == null || !Number.isFinite(naturalHeight) || naturalHeight <= 0) return null;
  return clamp(Math.round(naturalHeight), MIN_HEIGHT_PX, MAX_HEIGHT_PX);
}
