// BAE경 6단계 BiRefNet 새 방식 (birefnet.js) 의 타입.
import type { Built, RefineOutlines } from './engine/split';

export const BIR_SIZE: 1024;
/** 잘라 낸 그림 (RGB) → 1×3×1024×1024 (늘여서, ImageNet 정규화) */
export function prepCrop(rgb: Uint8Array, cw: number, ch: number): Float32Array;
/** 1024×1024 답 → 잘라 낸 크기, 0..1 */
export function back(o: ArrayLike<number>, cw: number, ch: number): Float32Array;
export function cropOf(box: number[], W: number, H: number): [number, number, number, number];

/** 물건 하나의 윤곽 결과 (poc_main6 의 report 와 같은 칸) */
export interface BirOutlineRow {
  name: string; crop: number[]; painted_px: number; widened: number[] | null; iou: number; used: 'birefnet' | 'sam';
  px_sam?: number; px_birefnet?: number; shared_px_kept?: number; thin_px_dropped?: number; kept_from_sam_px?: number;
  /** 두 물건의 SAM 윤곽이 이미 함께 가졌던 픽셀이라 나누지 않고 엔진(앞뒤)에 맡긴 수 (poc_main6 에서 바꾼 한 가지) */
  shared_px_engine?: number;
}
export interface BirEdgeRow { key: string; name: string; iou?: number; soft: string; changed_px?: number }
export interface BirState {
  /** 윤곽 단계까지 왔나 (나누기에서 refineOutlines 가 불렸나) */
  tried: boolean;
  /** BiRefNet 이 실패했으면 그 오류 (그 그림은 SAM 윤곽 그대로) */
  failed: Error | null;
  /** BiRefNet 윤곽을 쓴 물건 수 / 물건 수 */
  used: number; props: number;
  outlinesMs: number; edgesMs: number; runs: number;
  outlines: BirOutlineRow[]; edges: BirEdgeRow[];
}
export interface Birefnet {
  refineOutlines: RefineOutlines;
  softEdges(built: Built): BirEdgeRow[];
  readonly state: BirState;
}
export function createBirefnet(o: {
  /** BiRefNet 한 번: 1×3×1024×1024 → 첫 출력 (1024×1024) */
  run(x: Float32Array): Promise<ArrayLike<number>>;
  /** 물건 done / total */
  onProgress?(done: number, total: number): void;
  log?(t: string): void;
  signal?: AbortSignal | null;
}): Birefnet;
