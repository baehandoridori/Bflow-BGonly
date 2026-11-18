// 레이어 엔진 v0.4.4 (bm.js, 그대로 옮긴 JS) 의 타입. 엔진 코드는 고치지 않는다 (계획 14 3-4) — 여기는 쓰는 쪽만 적는다.
export class BM {
  constructor(x0?: number, y0?: number, w?: number, h?: number, d?: Uint8Array | null);
  x0: number; y0: number; w: number; h: number; d: Uint8Array;
  readonly x1: number; readonly y1: number; readonly empty: boolean;
  box(): [number, number, number, number] | null;
}
export function fromCrop(sub: Uint8Array, box: number[]): BM;
export function fromFull(m: Uint8Array, W: number, H: number): BM;
export function count(a: BM | null | undefined): number;
