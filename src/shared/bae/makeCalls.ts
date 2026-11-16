// BAE경 만들기 통로의 모양 (화면 ↔ 메인 ↔ 테스트 모드). DOM · Electron · '@/' 없이.
import type { OrderMaterials, OrderInputs, StyleMode, LibEntry, BaeOrder, RatioId, TierId } from './order';
import type { BaeJobImages, BaeJobKind, BaeJobPd, BaeJobResult, BaeJobSummary } from './jobs';

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
  /** 기록에 남길 재료 미리보기 (JPEG 데이터 주소): 러프 · 메모 러프 · 레퍼런스 · 기준 배경(통째로) · 부품 시트. */
  previews: { rough: string | null; roughNotes: string | null; refs: string[]; bases?: string[]; sheet?: string | null };
  summary: BaeJobSummary;
  pd: BaeJobPd;
  orderCostUsd: number | null;
  name: string | null;
  createdAt: string;
  /**
   * 그린 뒤 화면이 마무리한다 (HTML finishPicture: 기울기 되돌리기 · 기준 배경 색 맞춤). 참이면 메인은 gpt.png 만 남기고 작업을 끝내지 않은 채
   * GPT 그림을 돌려준다. 화면이 마무리한 그림을 'bae:draw-finish' 로 보내면 그때 끝난다.
   */
  finish?: boolean;
}
export interface BaeDrawOutcome {
  ok: true; jobId: string; png: Uint8Array; w: number; h: number; sec: number; costUsd: number | null; imageUsd: number | null; model: string;
  /** 참이면 png 는 GPT 가 준 그대로이고, 화면이 마무리해서 drawFinish 로 보내야 끝난다. */
  finish?: boolean;
}
/** 화면이 마무리한 그림 (bae:draw-finish). 마무리를 못 했으면 png = GPT 그림 그대로, note 에 까닭. */
export interface BaeDrawFinishCall {
  jobId: string;
  png: Uint8Array;
  /** 색 맞춤 전 그림 (색 맞춤으로 옮긴 면이 있을 때만). 기울기가 없으면 null 이어도 된다 — GPT 그림과 같다. */
  alt: Uint8Array | null;
  /** 옮긴 넓은 면 수 (색 맞춤을 안 했거나 못 했으면 0) */
  moved: number;
  /** 되돌린 기울기 (도) */
  tilt: number;
  note: string;
}
export interface BaeDrawFinishOutcome {
  ok: true; jobId: string; w: number; h: number; sec: number; costUsd: number | null; imageUsd: number | null; model: string;
}
/** 결과 판 바꾸기 (색 맞춤 켜고 끄기 · 노이즈 제거와 되돌리기). png 는 아직 이 PC 에 없는 판을 처음 만들 때만. */
export interface BaeResultSetCall {
  jobId: string;
  variant: { alt: boolean; noise: boolean };
  png: Uint8Array | null;
  /** 노이즈 제거에 걸린 초 */
  sec?: number;
}
export interface BaeResultSetOutcome { ok: true; jobId: string; w: number; h: number; result: BaeJobResult; images: BaeJobImages }
/** 도구만 쓴 작업 (노이즈 제거 창): 불러온 그림과 결과를 이 PC 에 두고 기록 한 줄. 0원. */
export interface BaeToolJobCall {
  jobId: string;
  kind: 'denoise';
  parentJobId: string | null;
  createdAt: string;
  /** 불러온 그림 (PNG) */
  source: Uint8Array;
  /** 결과 (PNG) */
  png: Uint8Array;
  sec: number;
  /** 그림 이름 (불러온 파일 이름 · 원래 작업 이름). 경로에는 쓰지 않는다. */
  label: string;
}
export interface BaeToolJobOutcome { ok: true; jobId: string; w: number; h: number }
export interface BaeFailure { ok: false; aborted: boolean; message: string; code: string | null }
export interface BaeProgress { jobId: string; phase: 'order' | 'draw'; partial?: { index: number | null; dataUrl: string } }

