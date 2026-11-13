// BAE경 만들기 통로의 모양 (화면 ↔ 메인 ↔ 테스트 모드). DOM · Electron · '@/' 없이.
import type { OrderMaterials, OrderInputs, StyleMode, LibEntry, BaeOrder, RatioId, TierId } from './order';
import type { BaeJobKind, BaeJobPd, BaeJobSummary } from './jobs';

export interface BaeOrderCall {
  jobId: string;
  kind: 'new' | 'same';
  /** times · calib 은 메인이 설정 책장에서 채운다. */
  materials: Omit<OrderMaterials, 'times' | 'calib'>;
  inputs: OrderInputs;
  styleMode: StyleMode;
  manualIds: string[];
  manualPicks: string[];
  library: LibEntry[];
  libThumbs: Record<string, string>;
  revise: { text: string; label?: string | null; reviewImage?: string | null } | null;
  prevOrder: BaeOrder | null;
  /** 고치기일 때 지금 화면의 영어 주문서 (toMarkers 로 되돌릴 것). */
  prevPrompt: string;
  carry: string[];
  carryExtra: string[];
  dirty?: boolean;
}
export interface BaeOrderOutcome {
  ok: true; order: BaeOrder; promptText: string; picks: string[]; manualPicks: string[]; costUsd: number | null; sec: number;
}
export interface BaeDrawCall {
  jobId: string;
  kind: BaeJobKind;
  parentJobId: string | null;
  promptText: string;
  ratio: RatioId; tier: TierId; tilt: number;
  /** 그림 모델에 보낼 PNG (finalList 순서). */
  images: Uint8Array[];
  /** 기록에 남길 재료 미리보기 (JPEG 데이터 주소): 러프 · 메모 러프 · 레퍼런스. */
  previews: { rough: string | null; roughNotes: string | null; refs: string[] };
  summary: BaeJobSummary;
  pd: BaeJobPd;
  orderCostUsd: number | null;
  name: string | null;
  createdAt: string;
}
export interface BaeDrawOutcome {
  ok: true; jobId: string; png: Uint8Array; w: number; h: number; sec: number; costUsd: number | null; imageUsd: number | null; model: string;
}
export interface BaeFailure { ok: false; aborted: boolean; message: string; code: string | null }
export interface BaeProgress { jobId: string; phase: 'order' | 'draw'; partial?: { index: number | null; dataUrl: string } }

