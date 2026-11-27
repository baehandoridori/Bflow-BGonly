/**
 * 재료 창 그림 고치기 (2026-11-27 한솔 '재료 창의 이미지를 누르면 이미지 수정 창이 뜰 수 있게'): 레퍼런스 · 기준 배경 한 장을
 * 자르기 · 돌리기 · 뒤집기 · 칠하기로 고친다. 고친 것은 '처음 그림에 차례로 한 일' 목록으로만 들고 있다가
 * (되돌리기 = 마지막 일 빼고 처음부터 다시), 다 되면 한 장으로 굽는다. 여기는 그림 없이 셈만 — 굽는 것은 features 쪽 캔버스.
 * 좌표는 모두 '그 일을 하기 직전 그림'의 가로 · 세로를 0~1 로 본 값이다.
 */
export type BaeImgOp =
  | { t: 'rot'; d: 1 | -1 }                                           // 1 = 오른쪽으로 90°, -1 = 왼쪽으로 90°
  | { t: 'flip' }                                                     // 좌우 뒤집기
  | { t: 'crop'; x0: number; y0: number; x1: number; y1: number }     // 이 네모만 남기기
  | { t: 'paint'; color: string; size: number; pts: number[] };       // 칠하기: size = 긴 변에 대한 붓 굵기, pts = u,v 쌍

/** 자를 때 남길 가장 작은 크기 (그림 픽셀) */
export const BAE_IMG_CROP_MIN = 16;
/** 한 번에 고칠 수 있는 일 수 (되돌리기 목록이 끝없이 길어지지 않게) */
export const BAE_IMG_OPS_MAX = 200;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** 일을 차례로 했을 때 그림 크기 (가로, 세로). 0 이 되지 않는다. */
export function baeImgOpsSize(w: number, h: number, ops: readonly BaeImgOp[]): [number, number] {
  let W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  for (const op of ops) {
    if (op.t === 'rot') [W, H] = [H, W];
    else if (op.t === 'crop') { const r = baeImgCropRect(W, H, op); W = r.sw; H = r.sh; }
  }
  return [W, H];
}

/** 자르기 네모를 그림 픽셀로 (sx, sy, sw, sh). 굽기와 크기 셈이 같은 것을 쓴다. */
export function baeImgCropRect(W: number, H: number, b: { x0: number; y0: number; x1: number; y1: number }): { sx: number; sy: number; sw: number; sh: number } {
  const x0 = Math.min(clamp01(b.x0), clamp01(b.x1)), x1 = Math.max(clamp01(b.x0), clamp01(b.x1));
  const y0 = Math.min(clamp01(b.y0), clamp01(b.y1)), y1 = Math.max(clamp01(b.y0), clamp01(b.y1));
  const sx = Math.min(W - 1, Math.round(x0 * W)), sy = Math.min(H - 1, Math.round(y0 * H));
  return { sx, sy, sw: Math.max(1, Math.min(W - sx, Math.round(x1 * W) - sx)), sh: Math.max(1, Math.min(H - sy, Math.round(y1 * H) - sy)) };
}

/** 끌어 그린 네모(0~1)를 자르기 일로. 너무 작거나 그림 전체와 같으면 null. */
export function baeImgCropOp(d: { u0: number; v0: number; u1: number; v1: number }, W: number, H: number): Extract<BaeImgOp, { t: 'crop' }> | null {
  const x0 = Math.min(clamp01(d.u0), clamp01(d.u1)), x1 = Math.max(clamp01(d.u0), clamp01(d.u1));
  const y0 = Math.min(clamp01(d.v0), clamp01(d.v1)), y1 = Math.max(clamp01(d.v0), clamp01(d.v1));
  if ((x1 - x0) * W < BAE_IMG_CROP_MIN || (y1 - y0) * H < BAE_IMG_CROP_MIN) return null;
  const r = baeImgCropRect(W, H, { x0, y0, x1, y1 });
  if (r.sw >= W && r.sh >= H) return null;
  return { t: 'crop', x0, y0, x1, y1 };
}

/** 모양(크기 · 방향)이 바뀌는 일이 있는지. 기준 배경의 부품 네모는 그림 자리에 붙어 있어서, 그러면 다시 잘라야 한다. */
export const baeImgShapeChanged = (ops: readonly BaeImgOp[]) => ops.some((o) => o.t !== 'paint');

/** 마지막 일 빼기 (되돌리기). 같은 일이 연달아 서로 지우는 것(왼쪽 · 오른쪽 돌리기, 뒤집기 두 번)은 그대로 둔다 — 사람이 한 차례대로. */
export const baeImgUndo = (ops: readonly BaeImgOp[]) => ops.slice(0, -1);

/** 일 하나 더하기 (목록이 너무 길면 더하지 않는다). 점이 없는 칠하기는 버린다. */
export function baeImgPush(ops: readonly BaeImgOp[], op: BaeImgOp): BaeImgOp[] {
  if (ops.length >= BAE_IMG_OPS_MAX) return ops.slice();
  if (op.t === 'paint' && op.pts.length < 2) return ops.slice();
  return [...ops, op];
}

/** 화면 붓 굵기(px)를 그림 긴 변 비율로: 화면에 보이는 그림 긴 변이 viewLong px 일 때. */
export const baeImgBrushSize = (px: number, viewLong: number) => Math.max(0.0005, Math.min(0.5, px / Math.max(1, viewLong)));

/** 바뀐 것 한 줄 (창 아래 안내): '자르기 1 · 돌리기 2 · 칠하기 3획' */
export function baeImgOpsLine(ops: readonly BaeImgOp[]): string {
  const n = { crop: 0, rot: 0, flip: 0, paint: 0 };
  for (const o of ops) n[o.t]++;
  const out: string[] = [];
  if (n.crop) out.push(`자르기 ${n.crop}`);
  if (n.rot) out.push(`돌리기 ${n.rot}`);
  if (n.flip) out.push(`뒤집기 ${n.flip}`);
  if (n.paint) out.push(`칠하기 ${n.paint}획`);
  return out.join(' · ');
}
