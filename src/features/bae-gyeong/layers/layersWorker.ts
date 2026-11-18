/**
 * BAE경 레이어 일꾼 (화면 쪽 Web Worker, 계획 14 3-2 '레이어 나누기 · 조립 · PSD 쓰기'). 엔진 worker/entry.js 의 자리.
 *   - 엔진 한 판(session.ts)을 여기 둔다: 그림 · SAM · 만든 레이어가 말 사이에 남아, 계획만 바뀌면 몇 초 만에 다시 묶는다.
 *   - SAM 은 모델 일꾼에게 전용 통로로 (remoteSam.ts). GPT · 저장소는 화면에게 부탁한다(rpc) — 화면이 메인으로 보낸다 (키는 메인만).
 *   - 그만두기: 지금 하는 일의 AbortController 를 끊는다. 기다리던 GPT · 저장 부탁도 바로 그만둔다.
 *   - 6단계 가장자리(BiRefNet): 쓸 수 있나는 화면에게 묻고(edgesReady), 계산은 SAM 과 같은 전용 통로로 (bir.run).
 */
import { createLayersSession, type LayersEdgeModel } from './session';
import { BAE_LAYERS_EDGES_WHY, type BaeLayersEdgesWhy } from '../../../shared/bae/layers';
import { remoteSam } from './remoteSam';
import { browserCodec, browserThumbs } from './codec';
import type { EngineGpt, EngineStore } from './engine/split';
import type { LayersFromWorker, LayersRpcMethod, LayersToWorker } from './protocol';

interface WorkerScope { onmessage: ((e: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
const scope = self as unknown as WorkerScope;
const post = (m: LayersFromWorker, tr: Transferable[] = []) => scope.postMessage(m, tr);
const log = (text: string) => post({ type: 'log', text: String(text).slice(0, 2000) });

let rpcSeq = 0;
const rpcs = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
function rpc(method: LayersRpcMethod, args: Record<string, unknown>, signal?: AbortSignal | null): Promise<unknown> {
  return new Promise((res, rej) => {
    const abortErr = () => Object.assign(new Error('그만뒀어요'), { name: 'AbortError' });
    if (signal?.aborted) { rej(abortErr()); return; }
    const id = ++rpcSeq;
    const onAbort = () => { if (rpcs.delete(id)) rej(abortErr()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    rpcs.set(id, { res: (v) => { signal?.removeEventListener('abort', onAbort); res(v); }, rej: (e) => { signal?.removeEventListener('abort', onAbort); rej(e); } });
    post({ type: 'rpc', id, method, args });
  });
}

const gpt: EngineGpt = {
  async pd(r) { return (await rpc('pd', { name: r.name, prompt: r.prompt, images: r.images, schema: r.schema }, r.signal)) as { json: unknown; usd: number }; },
  async edit(r) { return (await rpc('edit', { prompt: r.prompt, image: r.image, mask: r.mask, size: r.size }, r.signal)) as { png: Uint8Array; usd: number }; },
};
/** 그림마다의 저장소. HTML jobStore 처럼 읽기 실패는 '없음', 쓰기 실패는 나누기를 막지 않는다. */
const storeFor = (pic: string): EngineStore => ({
  async get(key) { try { return await rpc('storeGet', { pic, key }); } catch (e) { log('저장소 읽기 실패 ' + key + ': ' + String((e as Error)?.message || e)); return undefined; } },
  async set(key, value) { try { await rpc('storeSet', { pic, key, value }); } catch (e) { log('저장소 쓰기 실패 ' + key + ': ' + String((e as Error)?.message || e)); } },
});

const sam = remoteSam(null, { log });
/** 6단계 가장자리 모델: 쓸 수 있나는 화면에게 (모델 받기는 화면 · 메인의 일), 계산은 SAM 과 같은 전용 통로로 모델 일꾼에게. */
const edges: LayersEdgeModel = {
  async ready(signal) {
    const r = (await rpc('edgesReady', {}, signal)) as { ok?: unknown; why?: unknown } | null;
    if (r && r.ok === true) return { ok: true };
    const why = r && typeof r.why === 'string' && (BAE_LAYERS_EDGES_WHY as readonly string[]).includes(r.why) ? (r.why as BaeLayersEdgesWhy) : 'missing';
    return { ok: false, why };
  },
  async run(x) {
    const r = await sam.call({ type: 'bir.run', input: x });
    return { data: r.data as Float32Array, ep: String(r.ep || '') };
  },
};
const session = createLayersSession({
  gpt, storeFor, sam, codec: browserCodec, thumbs: browserThumbs, log, edges,
  onStep: (step, state, info) => post({ type: 'step', step, state, info: info || {} }),
});
let ctl: AbortController | null = null;
const errOf = (req: number, step: 'plan' | 'add' | 'split', e: unknown): LayersFromWorker => {
  const err = e as { name?: string; message?: string } | null;
  return { type: 'error', req, step, name: (err && err.name) || 'Error', message: String((err && err.message) || e).slice(0, 1200) };
};

scope.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as LayersToWorker;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'rpc-reply') {
    const q = rpcs.get(m.id); if (!q) return; rpcs.delete(m.id);
    if (m.ok) q.res(m.value); else q.rej(Object.assign(new Error(m.error), { name: m.name || 'Error' }));
    return;
  }
  if (m.type === 'port') { if (ev.ports[0]) sam.usePort(ev.ports[0] as unknown as Parameters<typeof sam.usePort>[0]); return; }
  if (m.type === 'sam-gone') { sam.gone(m.reason); return; }
  if (m.type === 'abort') { ctl?.abort(); return; }
  if (m.type === 'drop') { session.drop(); return; }
  if (m.type === 'savePlan') { try { await session.savePlan(m.pic, m.plan); } catch (e) { log('계획 저장 실패: ' + String((e as Error)?.message || e)); } return; }

  if (m.type === 'plan') {
    ctl = new AbortController();
    try {
      post({ type: 'step', step: 'engine', state: 'run', info: {} });
      const img = await browserCodec.decodePng(new Uint8Array(m.bytes));
      post({ type: 'decoded', req: m.req, w: img.w, h: img.h });
      const { proposal, transfer } = await session.plan({ image: { w: img.w, h: img.h, rgb: img.rgb }, notes: m.notes, pic: m.pic, signal: ctl.signal });
      post({ type: 'planned', req: m.req, proposal }, transfer);
    } catch (e) { post(errOf(m.req, 'plan', e)); }
    finally { ctl = null; }
    return;
  }
  if (m.type === 'add') {
    ctl = new AbortController();
    try { const r = await session.add({ box: m.box, name: m.name, signal: ctl.signal }); post({ type: 'added', req: m.req, obj: r.obj, usd: r.usd }, r.transfer); }
    catch (e) { post(errOf(m.req, 'add', e)); }
    finally { ctl = null; }
    return;
  }
  if (m.type === 'split') {
    ctl = new AbortController();
    try {
      const r = await session.split({ plan: m.plan, signal: ctl.signal });
      const buf = r.psd.buffer.byteLength === r.psd.byteLength ? r.psd.buffer as ArrayBuffer : r.psd.slice().buffer as ArrayBuffer;
      post({ type: 'done', req: m.req, psd: buf, summary: r.summary }, [buf]);
    } catch (e) { post(errOf(m.req, 'split', e)); }
    finally { ctl = null; }
  }
};
