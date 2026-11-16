/**
 * 레이어 계획 창의 상태와 흐름 (HTML v0.4.11 레이어 계획 창의 LP · lpOpen · lpFind · lpPlanned · lpAdded · lpGo · lpDone · lpFail ·
 * lpStop · lpForget 을 옮김). 창(LayersWindow)은 이것을 그리기만 한다.
 *   1 물건 찾기 (창을 열면 바로): 모델 준비(처음 한 번 받기) → 전용 통로 → 일꾼이 PD(저장해 둔 목록이면 0원) + SAM 윤곽
 *   2 계획 고치기 (0원): planModel 의 함수로만 계획을 바꾸고, 0.4초 뒤 그림과 함께 저장 (닫았다 열거나 앱을 다시 켜도 그대로)
 *   3 나누기: 레이어가 기대는 것이 같으면 조립만 다시 (0원, 몇 초), 아니면 GPT 단계 → PSD → 메인이 이 PC 에 저장 · 기록 줄
 * 같은 그림을 다시 열면 (앱을 끄지 않았다면) 일꾼에 남은 엔진 한 판과 이 계획으로 바로 이어 간다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BaeLayersGateway, BaeLayersSummaryLite } from '@/shared/bae/layers';
import type { BaeModelGateway } from '../modelApi';
import { baeModelPort } from '../modelApi';
import { layersClient, layersPictureHash, LayersRunError, type LayersClient } from './layersClient';
import type { LayersDoneSummary, LayersProposal } from './session';
import {
  planFromProposal, planToSaved, planForEngine, planDirty, viewOf, layersBuildKey, addBoxed, wonOf,
  LAYERS_FIND_STEPS, LAYERS_SPLIT_STEPS, LAYERS_AGAIN_STEPS,
  type LayerPlan, type PlanViewResult,
} from './planModel';

export interface LayersPicture {
  /** 나눌 그림 (PNG · JPEG 바이트) */
  bytes: Uint8Array;
  /** 그림 이름 (불러온 파일 이름 · 원래 작업 이름) */
  label: string;
  /** 결과 화면에서 연 그림이면 그 작업 id */
  parentJobId: string | null;
  /** 그 작업의 설명 (PD 가 묶음 · 이름을 짓는 힌트, HTML rec.inputs.notes) */
  notes?: string;
}
export type LayersPhase = 'idle' | 'finding' | 'plan' | 'adding' | 'splitting' | 'done';
export interface LayersStepState { state: '' | 'run' | 'ok' | 'err'; sub?: string; t?: string; t0?: number }

interface S {
  pic: string | null; src: string | null; natW: number; natH: number; label: string; parentJobId: string | null; notes: string;
  jobId: string | null;
  proposal: LayersProposal | null; plan: LayerPlan | null; order: Record<string, number> | null;
  summary: LayersDoneSummary | null; splitPlan: LayerPlan | null; plated: boolean;
  phase: LayersPhase; steps: Array<[string, string]>; st: Record<string, LayersStepState>;
  info: { text: string; kind: '' | 'err' | 'ok' };
  sel: string | null; mode: 'pick' | 'add'; pendBox: number[] | null; psdPath: string | null;
  found: { props: number; far: number; usd: number; sec: number; restored: boolean } | null;
  done: { sec: number; costUsd: number; again: boolean; gptUsd: number } | null;
  startedAt: number;
}
const EMPTY: S = {
  pic: null, src: null, natW: 0, natH: 0, label: '', parentJobId: null, notes: '', jobId: null,
  proposal: null, plan: null, order: null, summary: null, splitPlan: null, plated: false,
  phase: 'idle', steps: [], st: {}, info: { text: '', kind: '' }, sel: null, mode: 'pick', pendBox: null, psdPath: null, found: null, done: null, startedAt: 0,
};
/** 창을 닫았다 열어도 같은 그림이면 이어 가려고 (앱이 켜 있는 동안만). */
const MEMORY = new Map<string, S>();

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, 'sk-…').slice(0, 400);
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError' || (e instanceof LayersRunError && e.aborted);
const epLabel = (ep: string) => (ep === 'dml' ? '그래픽카드' : ep === 'cpu' ? 'CPU (느려요)' : '');
async function sizeOf(src: string): Promise<{ w: number; h: number }> {
  const img = new Image(); img.src = src; await img.decode(); return { w: img.naturalWidth, h: img.naturalHeight };
}
const lite = (s: LayersDoneSummary): BaeLayersSummaryLite => ({
  W: s.W, H: s.H, layers: s.layers, shadows: s.shadows, bins: s.bins, left: s.left, merged: s.merged, stackDiff: s.stack?.mean_diff ?? 0, sec: s.sec, again: s.again, props: s.props,
});

export interface UseLayersOptions {
  picture: LayersPicture;
  gateway: BaeLayersGateway;
  modelGateway: BaeModelGateway;
  /** 시험 · 미리보기용 (없으면 앱의 레이어 일꾼 하나) */
  client?: LayersClient;
  /** 원/달러 (안내 금액) */
  rate?: number;
}

export function useLayersSession(o: UseLayersOptions) {
  const [s, setS] = useState<S>(EMPTY);
  // 흐름은 비동기라 ref 가 늘 마지막 상태 (모든 바꾸기는 set 하나로): 바꾼 직후에 읽어도 새 값이다.
  const ref = useRef<S>(EMPTY);
  const set = useCallback((patch: Partial<S> | ((cur: S) => Partial<S>)) => {
    const cur = ref.current; const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    ref.current = next; setS(next);
  }, []);
  const gw = useRef(o.gateway); gw.current = o.gateway;
  const mg = useRef(o.modelGateway); mg.current = o.modelGateway;
  const client = useMemo(() => o.client ?? layersClient(() => gw.current), [o.client]);
  const rate = o.rate ?? 1400;
  const saveTimer = useRef<number | null>(null);
  const portStale = useRef(true);
  const [picture, setPicture] = useState<LayersPicture>(o.picture);
  const bytesRef = useRef<Uint8Array | null>(null);
  const begun = useRef<string | null>(null);
  const [tick, setTick] = useState(0);

  // 일꾼의 단계 알림 → 진행 줄 (HTML lpStep)
  useEffect(() => client.onStep((id, state, info) => {
    set((cur) => {
      if (!cur.steps.some((x) => x[0] === id)) return {};
      const prev = cur.st[id] || { state: '' as const }; const nx: LayersStepState = { ...prev };
      if (state === 'run' && prev.state !== 'run') nx.t0 = performance.now();
      nx.state = state === 'ok' ? 'ok' : state === 'run' ? 'run' : prev.state;
      const i = info as { props?: number; far?: number; done?: number; total?: number; pairs?: number; added?: number; ep?: string };
      if (id === 'engine' && state === 'ok') nx.sub = epLabel(String(i.ep || '')) || prev.sub;
      else if (id === 'inventory' && state === 'ok') nx.sub = '물건 ' + i.props + '개' + (i.far ? ' · 원경 ' + i.far + '곳' : '');
      else if (id === 'outlines' && i.total) nx.sub = i.done + '/' + i.total;
      else if (id === 'outlines' && state === 'ok') nx.sub = i.pairs != null ? '맞닿은 쌍 ' + i.pairs + '개' : '';
      else if (id === 'plate' && state === 'ok') nx.sub = i.added ? '추가한 물건 ' + i.added + '개 자리만 다시' : '';
      else if (id === 'edits' && i.total != null) nx.sub = state === 'ok' ? (i.total ? i.total + '장' : '겹친 곳 없음') : (i.done || 0) + '/' + i.total + '장';
      if (state === 'ok' && nx.t0) nx.t = Math.round((performance.now() - nx.t0) / 1000) + '초';
      return { st: { ...cur.st, [id]: nx } };
    });
  }), [client, set]);
  // 모델 일꾼이 내려가면 기다리던 SAM 요청을 실패로, 다음 일 전에 통로를 새로 받는다
  useEffect(() => {
    const off = mg.current.onWorker((w) => { if (!w.running) { portStale.current = true; client.samGone(w.expected ? '모델 일꾼을 쉬게 했어요. 다시 해 주세요.' : '모델 일꾼이 멈췄어요. 다시 누르면 새로 띄워서 해요.'); } });
    return off;
  }, [client]);
  // 바쁜 동안 '진행 중 n초'
  const busy = s.phase === 'finding' || s.phase === 'adding' || s.phase === 'splitting';
  useEffect(() => { if (!busy) return; const t = window.setInterval(() => setTick((x) => x + 1), 500); return () => window.clearInterval(t); }, [busy]);

  const view: PlanViewResult | null = useMemo(() => (s.plan && s.proposal ? viewOf(s.plan, s.proposal, s.order) : null), [s.plan, s.proposal, s.order]);
  const dirty = planDirty(s.plan, s.splitPlan);

  /** 모델(처음 한 번 받기) → 전용 통로. engine 단계에 받는 양을 적는다. */
  async function ensureSam() {
    const off = mg.current.onProgress((p) => {
      if (p.id !== 'sam' || p.phase === 'done') return;
      const sub = p.phase === 'download' || p.phase === 'copy' ? `모델 받는 중 ${Math.round(p.doneBytes / 1e6)}/${Math.round(p.totalBytes / 1e6)}MB (처음 한 번)` : p.phase === 'verify' ? '모델 확인 중' : '';
      if (sub) set((cur) => ({ st: { ...cur.st, engine: { ...(cur.st.engine || { state: 'run' }), sub } } }));
    });
    try { await mg.current.ensure('sam'); } finally { off(); }
    if (portStale.current || !client.workerPic) {
      const port = await baeModelPort(mg.current);
      client.usePort(port); portStale.current = false;
    }
  }
  function steps(list: Array<[string, string]>, first?: string) {
    const st: Record<string, LayersStepState> = {}; if (first) st[first] = { state: 'run', t0: performance.now() };
    set({ steps: list, st, startedAt: performance.now() });
  }
  function failRun(e: unknown, where: 'find' | 'add' | 'split') {
    const aborted = isAbort(e);
    set((cur) => {
      const st = { ...cur.st }; for (const [id] of cur.steps) if (st[id]?.state === 'run') st[id] = { ...st[id], state: 'err' };
      const text = aborted ? '그만뒀어요. 이미 보낸 GPT 요청은 비용이 들 수 있어요.'
        : (where === 'add' ? '물건을 더하지 못했어요: ' : where === 'find' ? '물건을 찾지 못했어요: ' : '레이어로 나누지 못했어요: ') + errText(e) + (/모델|받지 못|창고|인터넷/.test(errText(e)) ? ' · 처음 한 번은 윤곽 모델(약 157MB)을 받아야 해요.' : '');
      return { st, phase: cur.plan ? (cur.summary && !planDirty(cur.plan, cur.splitPlan) ? 'done' : 'plan') : 'idle', pendBox: null, info: { text, kind: aborted ? '' : 'err' } };
    });
    const jobId = ref.current.jobId;
    if (jobId && where !== 'add') void gw.current.end(jobId, aborted ? 'stopped' : 'failed', aborted ? '그만뒀어요.' : errText(e)).catch(() => false);
  }

  /** 작업 시작 (메인: 나눌 그림을 이 PC 작업 폴더에). 실패했으면 다음 '물건 다시 찾기'에서 다시 한다. */
  async function beginJob(): Promise<boolean> {
    const c = ref.current; const bytes = bytesRef.current;
    if (!c.jobId || !bytes) return false;
    if (begun.current === c.jobId) return true;
    const r = await gw.current.begin({ jobId: c.jobId, createdAt: new Date().toISOString(), parentJobId: c.parentJobId, label: c.label, source: bytes, w: c.natW, h: c.natH });
    if (!r.ok) { set({ phase: 'idle', info: { text: '레이어 작업을 시작하지 못했어요: ' + r.message, kind: 'err' } }); return false; }
    begun.current = c.jobId; return true;
  }

  /** 1 물건 찾기 (HTML lpFind). */
  const find = useCallback(async () => {
    const cur = ref.current; const bytes = bytesRef.current;
    if (!cur.pic || !bytes || client.busy) return;
    if (!(await beginJob())) return;
    steps(LAYERS_FIND_STEPS, 'engine');
    set({ phase: 'finding', info: { text: '', kind: '' }, proposal: null, plan: null, summary: null, splitPlan: null, order: null, sel: null, found: null, done: null, psdPath: null });
    try {
      await ensureSam();
      const p = await client.plan(bytes, cur.pic, cur.notes);
      const { plan, restored } = planFromProposal(p);
      set((c) => ({
        phase: 'plan', proposal: p, plan, plated: p.plated, order: null, sel: null,
        st: { ...c.st, engine: { ...(c.st.engine || { state: 'ok' }), state: 'ok', sub: epLabel(p.ep) || c.st.engine?.sub } },
        found: { props: p.objs.length, far: p.far.length, usd: p.usd, sec: p.sec, restored },
        info: { text: '물건 ' + p.objs.length + '개' + (p.far.length ? '와 원경 ' + p.far.length + '곳을' : '를') + ' 찾았어요 · ' + (p.usd ? 'PD ' + wonOf(p.usd, rate) : '저장해 둔 목록이라 0원') + ' · ' + p.sec + '초' + (restored ? ' · 지난번 계획을 불러왔어요' : ''), kind: 'ok' },
      }));
    } catch (e) { failRun(e, 'find'); }
  }, [client, rate]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 그림 열기 (HTML lpOpen): 같은 그림이면 계획 그대로, 아니면 작업을 시작하고 물건 찾기. alive 가 거짓이 되면 (창을 닫음 · 개발 모드의 두 번 띄우기) 그만둔다. */
  const open = useCallback(async (pc: LayersPicture, alive: () => boolean) => {
    const bytes = pc.bytes;
    const src = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const drop = () => { URL.revokeObjectURL(src); };
    let pic = '';
    try { pic = await layersPictureHash(bytes); } catch (e) { if (!alive()) return drop(); set({ ...EMPTY, src, info: { text: '그림을 읽지 못했어요: ' + errText(e), kind: 'err' } }); return; }
    if (!alive()) return drop();
    bytesRef.current = bytes;
    const mem = MEMORY.get(pic);
    if (mem && client.workerPic === pic && mem.plan) {
      client.setJob(mem.jobId); begun.current = mem.jobId;
      set({ ...mem, src, sel: null, mode: 'pick', pendBox: null, info: { text: '이 그림의 계획을 그대로 이어서 고쳐요.', kind: '' } });
      return;
    }
    let nat = { w: 0, h: 0 };
    try { nat = await sizeOf(src); } catch { if (!alive()) return drop(); set({ ...EMPTY, src, label: pc.label, info: { text: '그림을 열 수 없어요.', kind: 'err' } }); return; }
    if (!alive()) return drop();
    const jobId = crypto.randomUUID(); client.setJob(jobId);
    set({ ...EMPTY, pic, src, natW: nat.w, natH: nat.h, label: pc.label, parentJobId: pc.parentJobId, notes: pc.notes || '', jobId });
    await find();
  }, [client, find, set]);

  useEffect(() => { let alive = true; void open(picture, () => alive); return () => { alive = false; }; }, [picture]); // eslint-disable-line react-hooks/exhaustive-deps
  // 창이 닫히면 이 그림의 계획을 기억 (같은 그림을 다시 열면 이어 간다)
  useEffect(() => () => { const c = ref.current; if (c.pic && c.plan) MEMORY.set(c.pic, { ...c, phase: c.summary && !planDirty(c.plan, c.splitPlan) ? 'done' : 'plan', steps: c.steps, info: { text: '', kind: '' } }); if (saveTimer.current) { window.clearTimeout(saveTimer.current); flushSave(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (s.src) URL.revokeObjectURL(s.src); }, [s.src]);

  function flushSave() {
    const c = ref.current; saveTimer.current = null;
    if (c.pic && c.plan) void gw.current.storeSet(c.pic, 'p4.plan', planToSaved(c.plan)).catch(() => false);
  }
  /** 계획 바꾸기 (0원): 바로 보이고, 0.4초 뒤 그림과 함께 저장 (HTML lpChanged). */
  const edit = useCallback((fn: (plan: LayerPlan, view: PlanViewResult) => LayerPlan, delay = 400) => {
    const c = ref.current; if (!c.plan || !c.proposal || client.busy) return;
    const v = viewOf(c.plan, c.proposal, c.order);
    const next = fn(c.plan, v); if (next === c.plan) return;
    set({ plan: next, phase: c.phase === 'done' ? 'plan' : c.phase });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, delay);
  }, [client, set]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 빠진 물건 네모로 추가 (HTML lpAdded): PD 가 이름 (약 5원), 이 PC 가 윤곽. */
  const addBox = useCallback(async (box: number[]) => {
    const c = ref.current; if (!c.plan || client.busy) return;
    set({ phase: 'adding', pendBox: box, info: { text: 'PD가 네모 안의 물건에 이름을 붙이는 중… (약 5원)', kind: '' } });
    try {
      await ensureSam();
      const r = await client.add(box, '');
      const id = 'a' + Date.now().toString(36);
      const c2 = ref.current;
      const plan = addBoxed(c2.plan!, id, r.obj);
      set({ plan, sel: id, pendBox: null, mode: 'pick', phase: c2.summary ? 'plan' : 'plan',
        info: { text: '"' + r.obj.name + '"을 더했어요 · 이름 붙이기 ' + wonOf(r.usd, rate) + (c2.plated || c2.summary ? ' · 나눌 때 그 자리만 빈 배경을 다시 그려요 (약 80원)' : '') + ' · 이름과 층은 아래에서 바꿔요', kind: 'ok' } });
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, 400);
    } catch (e) { failRun(e, 'add'); }
  }, [client, rate, set]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 3 나누기 (HTML lpGo · lpDone). */
  const split = useCallback(async () => {
    const c = ref.current; if (!c.plan || !c.proposal || !c.jobId || client.busy || c.pendBox) return;
    const again = !!c.summary && !!c.splitPlan && layersBuildKey(c.plan) === layersBuildKey(c.splitPlan);
    steps(again ? LAYERS_AGAIN_STEPS : LAYERS_SPLIT_STEPS, again ? 'psd' : 'plate');
    const sending = structuredClone(c.plan);
    set({ phase: 'splitting', info: { text: again ? '계획만 바뀌어서 GPT 없이 다시 조립해요.' : 'GPT가 빈 배경과 가려진 부분을 그리고, 이 PC가 레이어를 조립해요. 보통 1~3분 걸려요.', kind: '' } });
    try {
      if (!again) await ensureSam();
      const r = await client.split(planForEngine(sending));
      const d = await gw.current.done({ jobId: c.jobId, psd: r.psd, summary: lite(r.summary) });
      if (!d.ok) throw new Error(d.message);
      const sm = r.summary;
      set((cur) => ({
        phase: 'done', summary: sm, splitPlan: sending, order: sm.order || null, plated: true, psdPath: d.psdPath,
        done: { sec: sm.sec, costUsd: d.costUsd, again: sm.again, gptUsd: sm.usd },
        info: {
          text: 'PSD로 저장했어요 · 레이어 ' + (sm.layers + 1) + '장' + (sm.shadows ? ' + 그림자 ' + sm.shadows + '장' : '') + ' (' + ([['OL', sm.bins.OL], ['ML', sm.bins.ML + 1], ['UL', sm.bins.UL]] as Array<[string, number]>).filter((x) => x[1]).map((x) => x[0] + ' ' + x[1]).join(' · ') + ') · ' + sm.sec + '초 · ' +
            (sm.again ? '조립만 다시라 0원' : sm.usd ? 'GPT ' + wonOf(sm.usd, rate) : '저장해 둔 GPT 단계를 써서 0원') + (sm.check && sm.check.length ? ' · 확인해 주세요: ' + sm.check.map((n) => n + ' (윤곽의 ' + Math.round(((sm.lost || {})[n] || 0) * 100) + '%가 빈 배경으로 감)').join(', ') : ''),
          kind: 'ok',
        },
        st: cur.st,
      }));
    } catch (e) { failRun(e, 'split'); }
  }, [client, rate, set]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 그만두기 (HTML lpStop): 일꾼의 일을 끊고 메인의 GPT 요청도 끊는다. */
  const stop = useCallback(() => { client.abort(); set({ info: { text: '멈추는 중…', kind: '' } }); }, [client, set]);

  /** '저장해 둔 단계 지우기' (HTML lpForget): 물건 목록 · 빈 방 · 계획을 다음부터 쓰지 않고 처음부터 (PD 약 10원). */
  const forget = useCallback(async () => {
    const c = ref.current; if (!c.pic || client.busy) return;
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    await gw.current.storeForget(c.pic).catch(() => false);
    client.drop(); MEMORY.delete(c.pic);
    set({ plated: false, summary: null, splitPlan: null, psdPath: null, done: null });
    await find();
  }, [client, find, set]);

  /** 창 닫기 (HTML lpDlg cancel): 바쁘면 닫지 않는다. 나누지 않고 닫으면 돈이 나간 작업만 '그만둠'으로 남는다. */
  const close = useCallback((): boolean => {
    const c = ref.current;
    if (client.busy) { set({ info: { text: "진행 중이에요. 그만두려면 '그만두기'를 눌러 주세요.", kind: '' } }); return false; }
    if (c.jobId && !(c.summary && !planDirty(c.plan, c.splitPlan))) void gw.current.end(c.jobId, 'closed', '').catch(() => false);
    return true;
  }, [client, set]);

  const showPsd = useCallback(() => { const c = ref.current; if (c.jobId) void gw.current.showPsd(c.jobId).catch(() => false); }, []);
  const replace = useCallback(async (file: File) => {
    if (client.busy) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const c = ref.current; if (c.jobId && !(c.summary && !planDirty(c.plan, c.splitPlan))) void gw.current.end(c.jobId, 'closed', '').catch(() => false);
    if (c.pic && c.plan) MEMORY.set(c.pic, { ...c, info: { text: '', kind: '' } });
    setPicture({ bytes, label: file.name, parentJobId: null });
  }, [client]);

  const elapsed = busy && s.startedAt ? Math.round((performance.now() - s.startedAt) / 1000) : 0;
  return {
    s, view, dirty, busy, elapsed, tick,
    select: (id: string | null) => set({ sel: id }),
    setMode: (mode: 'pick' | 'add') => set({ mode }),
    /** 나눈 뒤 '계획 다시 고치기': 계획 화면으로 (바꾸면 '바꾼 계획으로 다시 나누기') */
    reopenPlan: () => set((c) => (c.phase === 'done' ? { phase: 'plan' } : {})),
    edit, addBox, split, stop, forget, close, showPsd, replace, find,
  };
}
export type LayersSessionApi = ReturnType<typeof useLayersSession>;
