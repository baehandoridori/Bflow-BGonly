// 레이어 엔진 v0.4.4 (split.js) 의 타입: 3 나누기, 그리고 엔진이 바깥과 닿는 어댑터 모양 (README '어댑터').
import type { BM } from './bm';
import type { LayerPlan } from './planview';
import type { Planned } from './planner';

export interface EngineGpt {
  pd(r: { prompt: string; images: Array<{ label: string; url: string; detail?: string }>; schema: unknown; name: string; signal?: AbortSignal | null }): Promise<{ json: unknown; usd: number }>;
  edit(r: { prompt: string; image: Uint8Array; mask: Uint8Array | null; size: string; signal?: AbortSignal | null }): Promise<{ png: Uint8Array; usd: number }>;
}
export interface EngineCodec {
  encodePng(rgba: Uint8Array, w: number, h: number): Promise<Uint8Array>;
  decodePng(bytes: Uint8Array): Promise<{ w: number; h: number; rgb: Uint8Array }>;
  toDataUrl(rgb: Uint8Array, w: number, h: number, jpeg?: boolean): Promise<string>;
}
export interface EngineSam {
  readonly ep: string;
  setImage(key: string, rgb: Uint8Array, W: number, H: number): Promise<void>;
  predict(o: { box?: number[]; points?: number[][]; labels?: number[]; multimask?: boolean }): Promise<Array<{ mask: BM; conf: number }>>;
  predictAll(o: { box?: number[]; points?: number[][]; labels?: number[] }): Promise<{ multi: Array<{ mask: BM; conf: number }>; single: { mask: BM; conf: number; token?: number } }>;
  dispose(): Promise<void>;
}
export interface EngineStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
export type EngineStep = (id: string, state: string, info?: Record<string, unknown>) => void;

export interface BuiltLayer { box: number[]; rgba: Uint8Array; body: Uint8Array; shadow: Uint8Array | null; vis: BM; vsh: BM | null }
export interface BuildResult {
  W: number; H: number;
  layers: Map<string, BuiltLayer & { rgb?: Uint8Array }>;
  meta: Array<{ key: string; id?: string | null; name: string; [k: string]: unknown }>;
  stackKeys: string[];
  report: { plate?: string; check?: string[]; lost_in_outline?: Record<string, number>; [k: string]: unknown };
}
export interface Built {
  W: number; H: number; orig: Uint8Array; plate: Uint8Array; res: BuildResult;
  far: Array<{ id: string; name: string; box: number[]; mask: BM }>;
  objs: Array<{ id: string; group: string; name: string; en: string; box: number[] }>;
  addedIds: string[]; usd: number; costs: Record<string, number>; sec: number; edits: number;
}
export const hashOf: (s: string) => string;
export function splitWithPlan(o: { P: Planned; plan: LayerPlan; gpt: EngineGpt; codec: EngineCodec; sam: EngineSam; store?: EngineStore | null; onStep?: EngineStep; log?: (t: string) => void; signal?: AbortSignal | null; maxEdits?: number }): Promise<Built>;
