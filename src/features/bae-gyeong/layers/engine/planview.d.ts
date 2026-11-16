// 레이어 엔진 v0.4.4 (planview.js) 의 타입: 계획과 그 계획이 만드는 PSD 미리보기. 화면과 엔진이 같은 함수를 쓴다.
export type LayerBin = 'OL' | 'ML' | 'UL';
export type ObjectBin = 'OL' | 'ML';
/** 윤곽 후보: 'auto' (나눌 때 빈 배경과 가장 맞는 것) 또는 0~2 = SAM 의 세 답, 3 = 한 장짜리 답 */
export type PlanPick = 'auto' | number;
export interface PlanObject { name: string; bin: ObjectBin; shadow: boolean; split: boolean; merge: string | null; mergeTo: string | null; pick: PlanPick }
export interface PlanFar { name: string; split: boolean; pick: PlanPick }
export interface PlanBundle { mode: 'one' | 'each'; name?: string }
export interface PlanAdded { id: string; name: string; group: string; en: string; see_through: boolean; box: number[]; cands?: unknown }
export interface LayerPlan {
  v: 1;
  objects: Record<string, PlanObject>;
  bundles: Record<string, PlanBundle>;
  far: Record<string, PlanFar>;
  added: PlanAdded[];
}
/** PD 가 찾은 물건 (작업 크기 픽셀의 상자). layer = PD 가 제안한 층, on = 올라앉은 큰 물건 이름 */
export interface PlanObj { id: string; group: string; name: string; box: number[]; en?: string; layer?: ObjectBin; on?: string; see_through?: boolean }
export interface PlanFarArea { id: string; name: string; box: number[]; en?: string }
export interface ViewRow {
  key: string; bin: LayerBin; kind: 'bundle' | 'object' | 'far'; bundle?: string | null; group?: string; name: string; head: string;
  members: string[]; merged: string[]; shadow: boolean; rank?: number; folder?: string | null;
}
export interface ViewBundle { key: string; group: string; bin: ObjectBin; ids: string[]; mode: 'one' | 'each'; name: string }
export interface PlanViewResult {
  rows: ViewRow[]; farRows: ViewRow[]; skipped: string[]; bundles: ViewBundle[];
  merges: Map<string, string[]>; byId: Map<string, PlanObj>;
}
export const BINS: LayerBin[];
export const BIN_INFO: Record<LayerBin, { color: string; psd: string; ko: string }>;
export const ONE_FROM: number;
export function commonName(names: string[], fallback: string): string;
export function defaultPlan(objs: PlanObj[], far: PlanFarArea[]): LayerPlan;
export function planView(plan: LayerPlan, objs: PlanObj[], far?: PlanFarArea[], order?: Record<string, number> | null): PlanViewResult;
