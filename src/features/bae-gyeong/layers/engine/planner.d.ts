// 레이어 엔진 v0.4.4 (planner.js) 의 타입: 1 물건 찾기.
import type { BM } from './bm';
import type { PlanObj, PlanFarArea } from './planview';
import type { EngineGpt, EngineCodec, EngineSam, EngineStore, EngineStep } from './split';

export const DEFAULT_PICK: number;
export interface PackedMask { x0: number; y0: number; w: number; h: number; bits: Uint8Array }
export interface PlannedObj extends PlanObj { cands: BM[] }
export interface PlannedFar extends PlanFarArea { cands: BM[] }
export interface Planned {
  W: number; H: number; pw: number; ph: number; scale: number; orig: Uint8Array; pdUrl: string;
  inventory: unknown; groups: Array<{ group: string; en: string; see_through: boolean }>; background_en: string;
  objs: PlannedObj[]; far: PlannedFar[]; usd: number; costs: Record<string, number>; sec: number;
}
export function planLayers(o: { image: { w: number; h: number; rgb: Uint8Array }; notes?: string; gpt: EngineGpt; codec: EngineCodec; sam: EngineSam; store?: EngineStore | null; onStep?: EngineStep; log?: (t: string) => void; signal?: AbortSignal | null }): Promise<Planned>;
export function addObject(o: { P: Planned; box: number[]; name?: string; gpt: EngineGpt; sam: EngineSam; signal?: AbortSignal | null }): Promise<{ obj: { name: string; group: string; en: string; see_through: boolean; box: number[]; cands: BM[] }; usd: number }>;
export function outlineCands(sam: EngineSam, box: number[], W: number, H: number): Promise<BM[]>;
export function packBM(m: BM | null | undefined): PackedMask | null;
export function unpackBM(p: PackedMask | null): BM;
