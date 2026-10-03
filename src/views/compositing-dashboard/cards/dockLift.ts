/**
 * 컴포지팅 카드 줄의 호버 dock-lift 계산 (PartCardRow).
 *
 * 마우스 (X, Y) 와 카드 중심 거리로 한 줄 안 인접 카드만 들어 올린다.
 * 거리는 반드시 '들리지 않는 원래 자리 칸'의 사각형으로 잰다. 들린 카드 자신의 사각형으로 재면
 * 카드가 오를수록 중심이 위로 옮겨 가 같은 줄 판정 경계를 넘나들며 들썩인다(가장자리 떨림, 2026-05-21 보고).
 * hover 판정(원래 자리)과 들리는 요소(카드 shell)를 분리하는 것이 이 모듈의 계약이다.
 *
 * node --test 가 직접 import 하므로 런타임 '@/' import 를 두지 않는다.
 */

export const DOCK_MAX_DIST = 200; // px — 마우스 중심에서 이 거리 안 카드만 lift (한솔 보고: 변화 폭 더 넓게 → 떨림 줄임)
export const DOCK_LIFT = -10; // px (이전 -14 → -10 으로 lift 폭 줄임, 떨림 안정)
export const DOCK_SCALE = 0.05; // scale = 1 + DOCK_SCALE * lift
/** 같은 행으로 인정하는 수직 허용치 */
export const SAME_ROW_Y_THRESHOLD = 110;

/** smoothstep — 거리 → lift 곡선을 부드럽게 (가장자리 효과 약화 → 떨림 fix) */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export interface DockSlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 원래 자리 칸(slot) 사각형과 커서 위치로 카드 shell 의 transform 을 돌려준다.
 * 같은 행이 아니거나 거리 밖이면 '' (제자리).
 */
export function dockTransform(slot: DockSlotRect, x: number, y: number): string {
  const cx = slot.left + slot.width / 2;
  const cy = slot.top + slot.height / 2;
  if (Math.abs(y - cy) > SAME_ROW_Y_THRESHOLD) return '';
  const raw = Math.max(0, 1 - Math.abs(x - cx) / DOCK_MAX_DIST);
  const lift = smoothstep(raw);
  if (lift <= 0) return '';
  const dy = lift * DOCK_LIFT;
  const scale = 1 + lift * DOCK_SCALE;
  return `translateY(${dy.toFixed(2)}px) scale(${scale.toFixed(3)})`;
}
