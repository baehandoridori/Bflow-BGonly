// 재료 창 그림 고치기의 캔버스 쪽: 처음 그림 → (일 목록을 차례로) → 지금 그림. 셈은 src/shared/bae/imageEdit.ts.
import { baeImgCropRect, type BaeImgOp } from '@/shared/bae/imageEdit';

/** 고치는 동안 들고 있을 처음 그림의 긴 변 (아주 큰 레퍼런스도 손이 느려지지 않게). 다 고친 그림은 재료에 넣을 때 다시 줄인다. */
export const BAE_IMG_WORK_SIDE = 4096;

const canvasOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d') as CanvasRenderingContext2D;

/** 처음 그림을 캔버스로 (긴 변이 크면 줄인다). */
export function baeImgBase(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }, side = BAE_IMG_WORK_SIDE): HTMLCanvasElement {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const k = Math.min(1, side / Math.max(1, w0, h0));
  const c = canvasOf(w0 * k, h0 * k); const x = ctx2d(c);
  x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** 칠하기 한 획을 그림 위에 (그 자리 캔버스를 바꾼다). */
export function baeImgPaint(x: CanvasRenderingContext2D, W: number, H: number, op: Extract<BaeImgOp, { t: 'paint' }>) {
  const lw = Math.max(1, op.size * Math.max(W, H)); const p = op.pts;
  // 앞서 돌리기 · 뒤집기가 남긴 좌표 변환이 있어도 그림 픽셀 그대로 칠한다 (변환이 남으면 획이 돌아간 자리에 칠해진다)
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = op.color; x.strokeStyle = op.color; x.lineWidth = lw; x.lineCap = 'round'; x.lineJoin = 'round';
  if (p.length <= 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) { x.beginPath(); x.arc(p[0] * W, p[1] * H, lw / 2, 0, Math.PI * 2); x.fill(); }
  else { x.beginPath(); x.moveTo(p[0] * W, p[1] * H); for (let i = 2; i + 1 < p.length; i += 2) x.lineTo(p[i] * W, p[i + 1] * H); x.stroke(); }
  x.restore();
}

/** 일 하나: 돌리기 · 뒤집기 · 자르기는 새 캔버스, 칠하기는 받은 캔버스에 그대로 칠하고 그것을 돌려준다. */
export function baeImgApply(c: HTMLCanvasElement, op: BaeImgOp): HTMLCanvasElement {
  const W = c.width, H = c.height;
  if (op.t === 'paint') { baeImgPaint(ctx2d(c), W, H, op); return c; }
  if (op.t === 'rot') {
    const o = canvasOf(H, W); const x = ctx2d(o);
    x.save(); x.translate(op.d === 1 ? H : 0, op.d === 1 ? 0 : W); x.rotate(op.d * Math.PI / 2); x.drawImage(c, 0, 0); x.restore();
    return o;
  }
  if (op.t === 'flip') { const o = canvasOf(W, H); const x = ctx2d(o); x.save(); x.translate(W, 0); x.scale(-1, 1); x.drawImage(c, 0, 0); x.restore(); return o; }
  const r = baeImgCropRect(W, H, op); const o = canvasOf(r.sw, r.sh);
  ctx2d(o).drawImage(c, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw, r.sh);
  return o;
}

/** 처음 그림에 일 목록을 차례로 (처음 그림은 그대로 둔다). */
export function baeImgRender(base: HTMLCanvasElement, ops: readonly BaeImgOp[]): HTMLCanvasElement {
  let c = canvasOf(base.width, base.height); ctx2d(c).drawImage(base, 0, 0);
  for (const op of ops) c = baeImgApply(c, op);
  return c;
}

/** 다 고친 그림을 파일로 (PNG). */
export function baeImgBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('그림을 만들지 못했어요'))), 'image/png'));
}
