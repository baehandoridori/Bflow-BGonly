// 레이어 엔진 v0.4.4 (assemble.js) 의 타입: 계획대로 PSD (ag-psd 문서) 를 묶는다. 0원, 몇 초.
import type { LayerPlan, ViewRow } from './planview';
import type { Built } from './split';

export interface AssembleSummary {
  W: number; H: number; layers: number; shadows: number; extra: string[];
  bins: { OL: number; ML: number; UL: number }; names: { OL: string[]; ML: string[]; UL: string[] };
  left: number; merged: number; stack: { mean_diff: number; share_gt20: number }; check: string[]; lost: Record<string, number>;
}
export interface AssembledItem { row: ViewRow; box: number[]; rgba: Uint8Array; shadow: Uint8Array | null }
export function assemblePlan(built: Built, plan: LayerPlan): { psd: Record<string, unknown>; summary: AssembleSummary; comp: Uint8ClampedArray; bg: Uint8Array; items: AssembledItem[] };
