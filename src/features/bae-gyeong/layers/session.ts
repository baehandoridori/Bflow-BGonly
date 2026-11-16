/**
 * 레이어 엔진 한 판 (그림 하나): 1 물건 찾기 → (계획은 화면이 고침) → 3 나누기 → PSD. 엔진 worker/entry.js 의 plan · add · split 을
 * 일꾼 전역 없이 옮겼다 — 화면 쪽 일꾼(layersWorker.ts)과 node 시험이 같은 코드를 돈다.
 *   - 그림 · SAM · 만든 레이어는 다음 말까지 여기 남는다. 그래서 계획만 바뀌면 GPT 없이 몇 초 만에 다시 묶고(again),
 *     윤곽을 바꾸거나 물건을 더했을 때만 나누기를 다시 한다 (그때도 GPT 답은 저장소에 있어 0원).
 *   - 어댑터(gpt · store · sam · codec)는 넣어 준다 (계획 14 3-4). 엔진 코드는 고치지 않는다 — 6단계 BiRefNet 이 split.js 에
 *     표시를 붙여 끼운 한 군데(refineOutlines)만 예외 (birefnet.js).
 *   - 6단계 가장자리 (edges): 나누기의 윤곽 단계에서 화면에게 '가장자리 모델을 쓸 수 있나' 묻고(받는 중이면 화면이 잠시 기다림),
 *     되면 BiRefNet 새 방식, 안 되거나 도중에 실패하면 SAM 윤곽 그대로 끝까지 (지금 방식). 어떤 방식이었는지는 summary.edges.
 */
import { writePsd } from 'ag-psd';
import { planLayers, addObject, packBM, type Planned, type PackedMask, type PlannedObj, type PlannedFar } from './engine/planner.js';
import { splitWithPlan, type Built, type EngineCodec, type EngineGpt, type EngineSam, type EngineStore, type EngineStep, type RefineOutlines } from './engine/split.js';
import { assemblePlan, type AssembleSummary } from './engine/assemble.js';
import type { LayerPlan } from './engine/planview';
import type { LayersThumbs } from './codec';
import { layersBuildKey } from './planModel';
import { createBirefnet, type Birefnet, type BirOutlineRow, type BirEdgeRow } from './birefnet.js';
import { baeLayersEdgesNote, type BaeLayersEdgesMethod, type BaeLayersEdgesWhy } from '../../../shared/bae/layers';

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
  /** (6단계) 가장자리를 어떤 방식으로 땄나 */
  edges: LayersEdges;
}
/** (6단계) 이 나누기의 가장자리: 새 방식(BiRefNet) · 지금 방식(SAM 만)과 그 까닭 (text 는 화면 · 기록에 그대로). */
export interface LayersEdges {
  method: BaeLayersEdgesMethod; why: BaeLayersEdgesWhy | null; text: string;
  /** BiRefNet 윤곽을 쓴 물건 수 / 물건 수 */
  used: number; props: number;
  /** 윤곽 단계 · 가장자리 얹기에 걸린 ms, BiRefNet 을 부른 횟수 */
  outlinesMs: number; edgesMs: number; runs: number;
  /** 물건마다 (시험 · 기록용, poc_main6 의 report 와 같은 칸) */
  outlines: BirOutlineRow[]; soft: BirEdgeRow[];
}
/** (6단계) 가장자리 모델 (BiRefNet). 화면 쪽 일꾼에서는 ready = 화면에게 묻기(rpc), run = 전용 통로로 모델 일꾼에게. */
export interface LayersEdgeModel {
  /** 나누기의 윤곽 단계에 왔을 때 한 번: 모델을 쓸 수 있나 (받는 중이면 화면이 잠시 기다린다). 그만두기면 AbortError. */
  ready(signal: AbortSignal | null): Promise<{ ok: true } | { ok: false; why: BaeLayersEdgesWhy }>;
  /** BiRefNet 한 번: 1×3×1024×1024 → 첫 출력. ep 는 계산한 곳 ('dml' | 'cpu') */
  run(x: Float32Array): Promise<{ data: ArrayLike<number>; ep: string }>;
}
const edgesOf = (method: BaeLayersEdgesMethod, why: BaeLayersEdgesWhy | null, bir: Birefnet | null, props: number): LayersEdges => {
  const s = bir?.state; const used = method === 'birefnet' ? (s?.used ?? 0) : 0;
  return {
    method, why, text: baeLayersEdgesNote(method, why, used, props), used, props,
    outlinesMs: s?.outlinesMs ?? 0, edgesMs: s?.edgesMs ?? 0, runs: s?.runs ?? 0, outlines: s?.outlines ?? [], soft: s?.edges ?? [],
  };
};
const isAbortErr = (e: unknown) => (e as Error)?.name === 'AbortError';

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
  /** (6단계) 가장자리 모델. 없으면 늘 지금 방식 (SAM 만, 엔진 그대로) */
  edges?: LayersEdgeModel | null;
  onStep?: EngineStep;
  log?: (t: string) => void;
  now?: () => number;
}

export function createLayersSession(deps: LayersSessionDeps) {
  const now = deps.now ?? Date.now;
  const onStep: EngineStep = (id, state, info) => deps.onStep?.(id, state, info);
  const log = (t: string) => deps.log?.(t);
  let J: { pic: string; P: Planned; built: Built | null; builtKey: string | null; edges: LayersEdges | null } | null = null;

  /**
   * (6단계) 나누기 한 번의 BiRefNet 새 방식. 엔진 split.js 의 끼운 자리가 refine 을 부른다 (SAM 윤곽 · 빈 배경이 나온 뒤).
   * 모델을 쓸 수 없거나 도중에 실패하면 SAM 윤곽을 그대로 돌려준다 — 엔진은 같은 윤곽으로 같은 셈을 다시 하므로 SAM 만과 같은 결과.
   */
  function edgesRun(signal: AbortSignal | null) {
    const em = deps.edges ?? null;
    const r = { bir: null as Birefnet | null, why: (em ? null : 'off') as BaeLayersEdgesWhy | null, refine: null as RefineOutlines | null };
    if (!em) return r;
    r.refine = async (o) => {
      onStep('edges', 'run', { done: 0, total: o.objs.length });
      let ok: Awaited<ReturnType<LayersEdgeModel['ready']>>;
      try { ok = await em.ready(signal); } catch (e) { if (isAbortErr(e) || signal?.aborted) throw e; log('가장자리 모델 확인 실패: ' + String((e as Error)?.message || e)); ok = { ok: false, why: 'missing' }; }
      if (!ok.ok) { r.why = ok.why; onStep('edges', 'ok', { method: 'sam', why: r.why }); return { ms: o.ms, report: [] }; }
      let cpu = false;
      r.bir = createBirefnet({
        signal, log,
        onProgress: (done, total) => onStep('edges', 'run', { done, total }),
        run: async (x) => {
          const a = await em.run(x);
          // 계획 14 9-1: 그래픽카드가 모자라면 SAM 만 (CPU 로는 물건마다 몇 초 — 교실이면 몇 분이 늘어난다)
          if (a.ep === 'cpu') { cpu = true; throw new Error('가장자리 모델이 그래픽카드가 아닌 CPU 에서 돌았어요.'); }
          return a.data;
        },
      });
      const res = await r.bir.refineOutlines(o);
      const st = r.bir.state;
      if (st.failed) r.why = cpu ? 'cpu' : 'failed';
      else if (!st.used) r.why = 'nomatch';
      onStep('edges', 'ok', { method: r.why ? 'sam' : 'birefnet', why: r.why, used: st.used, props: st.props });
      // 어느 물건과도 맞지 않았으면 SAM 윤곽 그대로 (겹친 픽셀 나누기도 하지 않음 = 지금 방식과 같게)
      return r.why ? { ms: o.ms, report: res.report } : res;
    };
    return r;
  }

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
      J = { pic: o.pic, P, built: null, builtKey: null, edges: null };
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
        const E = edgesRun(o.signal ?? null);
        const built = await splitWithPlan({ P: J.P, plan: o.plan, gpt: deps.gpt, codec: deps.codec, sam: deps.sam, store: deps.storeFor(J.pic), onStep, log, signal: o.signal ?? null, refineOutlines: E.refine });
        // BiRefNet 윤곽을 쓴 물건의 레이어에 부드러운 가장자리 (조립 전에 한 번 — 조립만 다시 할 때는 이 레이어를 그대로 쓴다)
        if (E.bir && !E.why) E.bir.softEdges(built);
        J.built = built; J.builtKey = key; J.edges = edgesOf(E.why || !E.bir ? 'sam' : 'birefnet', E.why ?? (E.bir ? null : 'off'), E.bir, built.objs.length);
        usd = built.usd; costs = built.costs;
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
        thumbs, plate: r.report.plate, edges: J.edges ?? edgesOf('sam', 'off', null, J.built.objs.length),
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
