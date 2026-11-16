/**
 * 레이어 엔진 한 판 (그림 하나): 1 물건 찾기 → (계획은 화면이 고침) → 3 나누기 → PSD. 엔진 worker/entry.js 의 plan · add · split 을
 * 일꾼 전역 없이 옮겼다 — 화면 쪽 일꾼(layersWorker.ts)과 node 시험이 같은 코드를 돈다.
 *   - 그림 · SAM · 만든 레이어는 다음 말까지 여기 남는다. 그래서 계획만 바뀌면 GPT 없이 몇 초 만에 다시 묶고(again),
 *     윤곽을 바꾸거나 물건을 더했을 때만 나누기를 다시 한다 (그때도 GPT 답은 저장소에 있어 0원).
 *   - 어댑터(gpt · store · sam · codec)는 넣어 준다 (계획 14 3-4). 엔진 코드는 고치지 않는다.
 */
import { writePsd } from 'ag-psd';
import { planLayers, addObject, packBM, type Planned, type PackedMask, type PlannedObj, type PlannedFar } from './engine/planner.js';
import { splitWithPlan, type Built, type EngineCodec, type EngineGpt, type EngineSam, type EngineStore, type EngineStep } from './engine/split.js';
import { assemblePlan, type AssembleSummary } from './engine/assemble.js';
import type { LayerPlan } from './engine/planview';
import type { LayersThumbs } from './codec';
import { layersBuildKey } from './planModel';

export { layersBuildKey };

export type PackedObj = Omit<PlannedObj, 'cands'> & { cands: Array<PackedMask | null> };
export type PackedFar = Omit<PlannedFar, 'cands'> & { cands: Array<PackedMask | null> };
/** 네모로 더한 물건 (PD 가 이름을 붙임) */
export interface PackedAdded { name: string; group: string; en: string; see_through: boolean; box: number[]; cands: Array<PackedMask | null> }
/** 1 물건 찾기의 결과 (화면으로 가는 것: 윤곽 후보는 1비트로 접어서). */
export interface LayersProposal {
  W: number; H: number; scale: number; objs: PackedObj[]; far: PackedFar[];
  groups: Planned['groups']; background_en: string; usd: number; costs: Record<string, number>; sec: number; ep: string;
  /** 이 그림에 저장해 둔 계획 (닫았다 열거나 앱을 다시 켜도 그대로) */
  saved: LayerPlan | null;
  /** 빈 방을 이미 그려 둔 그림인지 (그러면 나누기 비용이 줄어든다) */
  plated: boolean;
}
export interface LayersSummaryRow { key: string; name: string; bin: string; shadow: boolean; thumb: string }
export interface LayersDoneSummary extends AssembleSummary {
  usd: number; costs: Record<string, number>; again: boolean; sec: number; ep: string; edits: number; props: number;
  rows: LayersSummaryRow[]; order: Record<string, number>; buildKey: string; thumbs: { plate: string; stack: string }; plate: string | undefined;
}

function packObj<T extends { cands: Array<PlannedObj['cands'][number]> }>(o: T, tr: ArrayBuffer[]) {
  const cands = o.cands.map(packBM); for (const c of cands) if (c) tr.push(c.bits.buffer as ArrayBuffer);
  return Object.assign({}, o, { cands });
}

export interface LayersSessionDeps {
  gpt: EngineGpt;
  /** 그림마다의 저장소 (pic = 그림 SHA-256) */
  storeFor(pic: string): EngineStore;
  sam: EngineSam;
  codec: EngineCodec;
  thumbs: LayersThumbs | null;
  onStep?: EngineStep;
  log?: (t: string) => void;
  now?: () => number;
}

export function createLayersSession(deps: LayersSessionDeps) {
  const now = deps.now ?? Date.now;
  const onStep: EngineStep = (id, state, info) => deps.onStep?.(id, state, info);
  const log = (t: string) => deps.log?.(t);
  let J: { pic: string; P: Planned; built: Built | null; builtKey: string | null } | null = null;

  return {
    get pic() { return J?.pic ?? null; },
    get planned() { return J?.P ?? null; },

    /** 1 물건 찾기: PD 가 물건 목록(저장해 둔 것이 있으면 0원), SAM 이 상자마다 윤곽 후보 넷. */
    async plan(o: { image: { w: number; h: number; rgb: Uint8Array }; notes?: string; pic: string; signal?: AbortSignal }): Promise<{ proposal: LayersProposal; transfer: ArrayBuffer[] }> {
      const t0 = now();
      if (J && J.pic !== o.pic) J = null;
      onStep('engine', 'ok', { ep: deps.sam.ep });
      const store = deps.storeFor(o.pic);
      const P = await planLayers({ image: o.image, notes: o.notes || '', gpt: deps.gpt, codec: deps.codec, sam: deps.sam, store, onStep, log, signal: o.signal ?? null });
      J = { pic: o.pic, P, built: null, builtKey: null };
      const saved = (await store.get('p4.plan')) as LayerPlan | null | undefined;
      const tr: ArrayBuffer[] = [];
      const objs = P.objs.map((x) => packObj(x, tr)) as PackedObj[];
      const far = P.far.map((x) => packObj(x, tr)) as PackedFar[];
      return {
        proposal: { W: P.W, H: P.H, scale: P.scale, objs, far, groups: P.groups, background_en: P.background_en, usd: P.usd, costs: P.costs,
          sec: Math.round((now() - t0) / 1000), ep: deps.sam.ep, saved: saved || null, plated: !!(await store.get('p4.plate.ids')) },
        transfer: tr,
      };
    },

    /** 사람이 네모로 더한 물건: SAM 윤곽 + PD 이름 (약 5원). */
    async add(o: { box: number[]; name?: string; signal?: AbortSignal }) {
      if (!J) throw new Error('물건 찾기를 먼저 해 주세요');
      const r = await addObject({ P: J.P, box: o.box, name: o.name || '', gpt: deps.gpt, sam: deps.sam, signal: o.signal ?? null });
      const tr: ArrayBuffer[] = [];
      return { obj: packObj(r.obj, tr) as PackedAdded, usd: r.usd, transfer: tr };
    },

    /** 3 나누기 (+ 조립 · PSD). 레이어가 기대는 것이 같으면 조립만 다시 (0원, 몇 초). */
    async split(o: { plan: LayerPlan; signal?: AbortSignal }): Promise<{ psd: Uint8Array; summary: LayersDoneSummary }> {
      if (!J) throw new Error('물건 찾기를 먼저 해 주세요');
      const t0 = now(); const key = layersBuildKey(o.plan); let usd = 0, costs: Record<string, number> = {}, again = false;
      if (!J.built || J.builtKey !== key) {
        J.built = await splitWithPlan({ P: J.P, plan: o.plan, gpt: deps.gpt, codec: deps.codec, sam: deps.sam, store: deps.storeFor(J.pic), onStep, log, signal: o.signal ?? null });
        J.builtKey = key; usd = J.built.usd; costs = J.built.costs;
      } else again = true;
      onStep('psd', 'run');
      const a = assemblePlan(J.built, o.plan);
      const psd = new Uint8Array(writePsd(a.psd as never, { noBackground: true }));
      const W = J.built.W, H = J.built.H, N = W * H; const r = J.built.res;
      const rows: LayersSummaryRow[] = [];
      for (const it of a.items) rows.push({ key: it.row.key, name: it.row.name, bin: it.row.bin, shadow: !!it.shadow, thumb: deps.thumbs ? await deps.thumbs.layer(it) : '' });
      let thumbs = { plate: '', stack: '' };
      if (deps.thumbs) {
        const crgb = new Uint8Array(N * 3), brgb = new Uint8Array(N * 3);
        for (let i = 0; i < N; i++) { const al = a.bg[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) { crgb[i * 3 + c] = a.comp[i * 4 + c]; const chk = ((((i % W) >> 4) + ((i / W | 0) >> 4)) & 1) ? 236 : 210; brgb[i * 3 + c] = Math.round(a.bg[i * 4 + c] * al + chk * (1 - al)); } }
        thumbs = { plate: await deps.thumbs.picture(brgb, W, H), stack: await deps.thumbs.picture(crgb, W, H) };
      }
      onStep('psd', 'ok');
      const order: Record<string, number> = {}; r.stackKeys.forEach((k, i) => { const mm = r.meta.find((x) => x.key === k); if (mm && mm.id != null) order[mm.id] = i; });
      const summary: LayersDoneSummary = Object.assign({}, a.summary, {
        usd, costs, again, sec: Math.round((now() - t0) / 1000), ep: deps.sam.ep, edits: J.built.edits, props: J.built.objs.length, rows, order, buildKey: key,
        thumbs, plate: r.report.plate,
      });
      return { psd, summary };
    },

    /** 계획을 그림과 함께 저장 (닫았다 열거나 앱을 다시 켜도 그대로). */
    async savePlan(pic: string, plan: LayerPlan) { await deps.storeFor(pic).set('p4.plan', plan); },
    /** 다른 그림으로 가거나 '저장해 둔 단계 지우기' */
    drop() { J = null; },
  };
}
export type LayersSession = ReturnType<typeof createLayersSession>;
