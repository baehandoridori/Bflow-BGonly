// 그림 크게 보기(ImageViewer)의 셈 — 배율 · 위치 · 맞추기 · 커서 둘레 확대 · 옮기기 한계 · 길잡이 상자.
// 화면 없이 숫자만 다룬다(node --test 가 바로 읽는다, 값 import 없음).
// 위치(x, y)는 보는 칸 왼쪽 위에서 그림 왼쪽 위까지의 거리(px), 배율 s 는 그림 1px 이 화면 몇 px 인지.

export interface IvSize { w: number; h: number }
export interface IvView { s: number; x: number; y: number }

/** 맞출 때 가장자리에 남기는 여백(px). */
export const IV_FIT_PAD = 24;
/** 가장 크게 (800%). */
export const IV_MAX_SCALE = 8;
/** 이 배율부터 픽셀을 뭉개지 않고 네모로 보인다 (200%). */
export const IV_PIXEL_SCALE = 2;
/** +/− 버튼과 키가 거치는 배율 단계. */
export const IV_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8] as const;

const ok = (n: number) => Number.isFinite(n) && n > 0;

/** 보는 칸 안에 그림 전체가 들어가는 배율 (작은 그림은 키워서 맞춘다). */
export function ivFitScale(img: IvSize, box: IvSize, pad = IV_FIT_PAD): number {
  if (!ok(img.w) || !ok(img.h) || !ok(box.w) || !ok(box.h)) return 1;
  const s = Math.min((box.w - pad * 2) / img.w, (box.h - pad * 2) / img.h);
  return ok(s) ? s : Math.min(box.w / img.w, box.h / img.h) || 1;
}

/** 가장 작게: 맞춘 배율(또는 100%) 중 작은 쪽의 절반. */
export function ivMinScale(img: IvSize, box: IvSize): number {
  return Math.min(ivFitScale(img, box), 1) / 2;
}

export function ivClampScale(s: number, img: IvSize, box: IvSize): number {
  const lo = ivMinScale(img, box);
  const hi = Math.max(IV_MAX_SCALE, ivFitScale(img, box));
  return Math.min(hi, Math.max(lo, s));
}

/** 그림이 칸보다 작은 쪽은 가운데, 큰 쪽은 가장자리가 칸 안으로 들어오지 않게. */
export function ivClamp(v: IvView, img: IvSize, box: IvSize): IvView {
  const sw = img.w * v.s;
  const sh = img.h * v.s;
  const x = sw <= box.w ? (box.w - sw) / 2 : Math.min(0, Math.max(box.w - sw, v.x));
  const y = sh <= box.h ? (box.h - sh) / 2 : Math.min(0, Math.max(box.h - sh, v.y));
  return { s: v.s, x, y };
}

export function ivFit(img: IvSize, box: IvSize): IvView {
  return ivClamp({ s: ivFitScale(img, box), x: 0, y: 0 }, img, box);
}

/** 배율을 s 로 바꾸되 칸 안의 한 점(cx, cy)이 가리키는 그림 자리는 그대로 둔다 (커서 둘레 확대). */
export function ivZoomTo(v: IvView, s: number, cx: number, cy: number, img: IvSize, box: IvSize): IvView {
  const next = ivClampScale(s, img, box);
  const k = next / v.s;
  return ivClamp({ s: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, img, box);
}

/** 휠 한 번의 배율 곱 (아래로 굴리면 작게). 줄 · 쪽 단위 휠도 픽셀로 바꿔 센다. */
export function ivWheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-300, Math.min(300, px));
  return Math.exp(-clamped * 0.0015);
}

/** +/− 의 다음 단계. 지금 배율에서 한 단계 위(아래), 끝이면 끝. */
export function ivStep(s: number, dir: 1 | -1, img: IvSize, box: IvSize): number {
  const steps = [...IV_STEPS];
  const next = dir > 0 ? steps.find((t) => t > s * 1.01) : [...steps].reverse().find((t) => t < s * 0.99);
  return ivClampScale(next ?? (dir > 0 ? IV_MAX_SCALE : ivMinScale(img, box)), img, box);
}

/** 맞춘 배율과 거의 같은가 (두 번 누르기: 맞춤 ↔ 100%). */
export function ivIsFit(v: IvView, img: IvSize, box: IvSize): boolean {
  const f = ivFitScale(img, box);
  return Math.abs(v.s - f) <= f * 0.01;
}

/** 그림 전체가 칸에 보이는가 (길잡이를 숨긴다). */
export function ivAllVisible(v: IvView, img: IvSize, box: IvSize): boolean {
  return img.w * v.s <= box.w + 1 && img.h * v.s <= box.h + 1;
}

/** 길잡이 그림 크기 (가로 maxW · 세로 maxH 안에 비율대로). */
export function ivNavSize(img: IvSize, maxW = 200, maxH = 136): IvSize & { k: number } {
  if (!ok(img.w) || !ok(img.h)) return { w: maxW, h: maxH, k: 0 };
  const k = Math.min(maxW / img.w, maxH / img.h);
  return { w: Math.round(img.w * k), h: Math.round(img.h * k), k };
}

/** 길잡이 위의 '지금 보이는 곳' 네모 (길잡이 px). */
export function ivNavRect(v: IvView, img: IvSize, box: IvSize, k: number): { left: number; top: number; width: number; height: number } {
  const x0 = Math.max(0, -v.x / v.s);
  const y0 = Math.max(0, -v.y / v.s);
  const x1 = Math.min(img.w, (box.w - v.x) / v.s);
  const y1 = Math.min(img.h, (box.h - v.y) / v.s);
  return { left: x0 * k, top: y0 * k, width: Math.max(0, x1 - x0) * k, height: Math.max(0, y1 - y0) * k };
}

/** 길잡이의 한 점(nx, ny, 길잡이 px)이 칸 가운데에 오게. */
export function ivCenterOn(v: IvView, nx: number, ny: number, k: number, img: IvSize, box: IvSize): IvView {
  if (!ok(k)) return v;
  const ix = nx / k;
  const iy = ny / k;
  return ivClamp({ s: v.s, x: box.w / 2 - ix * v.s, y: box.h / 2 - iy * v.s }, img, box);
}

/** 칸 크기가 바뀌어도 보던 가운데를 지킨다. */
export function ivResize(v: IvView, from: IvSize, to: IvSize, img: IvSize): IvView {
  return ivClamp({ s: v.s, x: v.x + (to.w - from.w) / 2, y: v.y + (to.h - from.h) / 2 }, img, to);
}

/** 배율 글 ('42%'). */
export function ivPercent(s: number): string {
  return `${Math.round(s * 100)}%`;
}
