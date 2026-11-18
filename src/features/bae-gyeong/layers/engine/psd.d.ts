// 레이어 엔진 v0.4.4 (psd.js) 의 타입 — 쓰는 함수만.
export function tightLayer(L: { box: number[]; rgba: Uint8Array }): { left: number; top: number; right: number; bottom: number; data: Uint8ClampedArray; w: number; h: number } | null;
