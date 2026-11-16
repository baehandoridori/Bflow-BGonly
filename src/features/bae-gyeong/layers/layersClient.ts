/**
 * 화면 쪽에서 레이어 일꾼을 부리는 곳. 일꾼은 앱이 켜 있는 동안 하나 (HTML lyWorker 처럼): 창을 닫았다 열어도 같은 그림이면
 * 엔진 한 판이 그대로 남아 있다. 일꾼의 GPT · 저장 부탁은 여기서 메인 통로(BaeLayersGateway)로 보낸다 — 지금 작업 번호를 붙여서.
 * DOM 은 쓰지 않는다 (Worker 와 crypto 만). 시험은 makeWorker 로 가짜 일꾼을 넣는다.
 */
import type { BaeLayersGateway } from '../../../shared/bae/layers';
import type { LayerPlan } from './engine/planview';
import type { LayersFromWorker, LayersToWorker } from './protocol';
import type { LayersDoneSummary, LayersProposal, PackedAdded } from './session';

export interface WorkerLike { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null; onerror: ((e: ErrorEvent) => void) | null; terminate(): void }
export type LayersStepListener = (step: string, state: string, info: Record<string, unknown>) => void;

export class LayersRunError extends Error {
  constructor(message: string, readonly step: 'plan' | 'add' | 'split', readonly aborted: boolean) { super(message); this.name = aborted ? 'AbortError' : 'Error'; }
}

/** 그림 바이트의 SHA-256 (16진수 64자): 저장소의 그림 이름 · 같은 그림인지. */
export async function layersPictureHash(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)); let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

export function createLayersClient(opts: { gateway: () => BaeLayersGateway; makeWorker: () => WorkerLike; abortGraceMs?: number }) {
  let w: WorkerLike | null = null;
  let req = 0; let jobId: string | null = null; let busy: { req: number; step: 'plan' | 'add' | 'split'; reject: (e: Error) => void } | null = null;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; step: 'plan' | 'add' | 'split' }>();
  const stepListeners = new Set<LayersStepListener>();
  const logs: string[] = [];
  let workerPic: string | null = null;

  function worker(): WorkerLike {
    if (w) return w;
    const nw = opts.makeWorker();
    nw.onmessage = (e) => onMsg(e.data as LayersFromWorker);
    nw.onerror = (e) => { failAll('레이어 엔진을 시작하지 못했어요: ' + String(e?.message || e)); };
    w = nw; return nw;
  }
  function failAll(message: string, aborted = false) {
    for (const [r, q] of waiting) { waiting.delete(r); q.reject(new LayersRunError(message, q.step, aborted)); }
    busy = null;
  }
  const post = (m: LayersToWorker, tr: Transferable[] = []) => worker().postMessage(m, tr);

  async function handleRpc(id: number, method: string, a: Record<string, unknown>) {
    const g = opts.gateway();
    const reply = (m: LayersToWorker) => { try { w?.postMessage(m); } catch { /* 일꾼이 없어짐 */ } };
    try {
      let value: unknown;
      if (method === 'pd' || method === 'edit') {
        if (!jobId) throw new Error('레이어 작업이 시작되지 않았어요. 창을 다시 열어 주세요.');
        const r = method === 'pd'
          ? await g.pd({ jobId, name: a.name as never, prompt: String(a.prompt), images: a.images as never, schema: a.schema })
          : await g.edit({ jobId, prompt: String(a.prompt), image: a.image as Uint8Array, mask: (a.mask as Uint8Array | null) ?? null, size: String(a.size) });
        if (!r.ok) { reply({ type: 'rpc-reply', id, ok: false, error: r.message, name: r.aborted ? 'AbortError' : 'Error' }); return; }
        value = method === 'pd' ? { json: (r as { json: unknown }).json, usd: r.usd } : { png: (r as { png: Uint8Array }).png, usd: r.usd };
      } else if (method === 'storeGet') value = await g.storeGet(String(a.pic), String(a.key));
      else if (method === 'storeSet') value = await g.storeSet(String(a.pic), String(a.key), a.value);
      else throw new Error('알 수 없는 부탁: ' + method);
      reply({ type: 'rpc-reply', id, ok: true, value });
    } catch (e) {
      reply({ type: 'rpc-reply', id, ok: false, error: String((e as Error)?.message || e), name: (e as Error)?.name === 'AbortError' ? 'AbortError' : 'Error' });
    }
  }

  function onMsg(m: LayersFromWorker) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'rpc') { void handleRpc(m.id, m.method, m.args); return; }
    if (m.type === 'step') { for (const l of stepListeners) { try { l(m.step, m.state, m.info); } catch { /* 화면 쪽 문제 */ } } return; }
    if (m.type === 'log') { logs.push(m.text); if (logs.length > 200) logs.shift(); return; }
    if (m.type === 'decoded') return;
    const q = waiting.get(m.req); if (!q) return; waiting.delete(m.req); if (busy?.req === m.req) busy = null;
    if (m.type === 'error') { q.reject(new LayersRunError(m.message, m.step, m.name === 'AbortError')); return; }
    if (m.type === 'planned') q.resolve(m.proposal);
    else if (m.type === 'added') q.resolve({ obj: m.obj, usd: m.usd });
    else if (m.type === 'done') q.resolve({ psd: new Uint8Array(m.psd), summary: m.summary });
  }
  function run<T>(step: 'plan' | 'add' | 'split', m: LayersToWorker, tr: Transferable[] = []): Promise<T> {
    if (busy) return Promise.reject(new LayersRunError('다른 일을 하는 중이에요. 잠시 뒤에 다시 해 주세요.', step, false));
    const r = (m as { req: number }).req;
    return new Promise<T>((resolve, reject) => {
      waiting.set(r, { resolve: resolve as (v: unknown) => void, reject, step });
      busy = { req: r, step, reject };
      try { post(m, tr); } catch (e) { waiting.delete(r); busy = null; reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }

  return {
    get busy() { return !!busy; },
    /** 일꾼에 엔진 한 판이 남아 있는 그림 (같은 그림을 다시 열면 물건 찾기를 건너뛴다) */
    get workerPic() { return workerPic; },
    get logs() { return logs.slice(); },
    setJob(id: string | null) { jobId = id; },
    get jobId() { return jobId; },
    onStep(l: LayersStepListener) { stepListeners.add(l); return () => { stepListeners.delete(l); }; },
    usePort(port: MessagePort) { post({ type: 'port' }, [port as unknown as Transferable]); },
    samGone(reason: string) { if (w) post({ type: 'sam-gone', reason }); },
    async plan(bytes: Uint8Array, pic: string, notes = ''): Promise<LayersProposal> {
      const copy = bytes.slice().buffer as ArrayBuffer;
      const p = await run<LayersProposal>('plan', { type: 'plan', req: ++req, bytes: copy, pic, notes }, [copy]);
      workerPic = pic; return p;
    },
    add(box: number[], name = ''): Promise<{ obj: PackedAdded; usd: number }> { return run('add', { type: 'add', req: ++req, box, name }); },
    split(plan: LayerPlan): Promise<{ psd: Uint8Array; summary: LayersDoneSummary }> { return run('split', { type: 'split', req: ++req, plan: JSON.parse(JSON.stringify(plan)) }); },
    savePlan(pic: string, plan: LayerPlan) { post({ type: 'savePlan', pic, plan: JSON.parse(JSON.stringify(plan)) }); },
    drop() { workerPic = null; if (w) post({ type: 'drop' }); },
    /**
     * 그만두기: 일꾼의 지금 일을 끊고, 메인의 GPT 요청도 끊는다. 이 PC 계산이 길게 돌아 말을 못 들으면 잠시 뒤 일꾼을 내린다
     * (HTML 과 같은 2.5초) — 그때는 엔진 한 판도 사라지므로 다음은 물건 찾기부터 (저장해 둔 답이 있어 0원).
     */
    abort() {
      if (!busy || !w) return;
      const b = busy; post({ type: 'abort' });
      if (jobId) void opts.gateway().abort(jobId).catch(() => false);
      setTimeout(() => {
        if (busy !== b || !w) return;
        try { w.terminate(); } catch { /* 이미 끝남 */ }
        w = null; workerPic = null; failAll('그만뒀어요.', true);
      }, opts.abortGraceMs ?? 2500);
    },
  };
}
export type LayersClient = ReturnType<typeof createLayersClient>;

/** 레이어 일꾼 하나를 띄운다 (vite 가 layersWorker.ts 를 따로 묶는다 — 배포판은 클래식 일꾼, 진행 기록 0-2 4번). */
export const makeLayersWorker = (): WorkerLike => new Worker(new URL('./layersWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

let shared: LayersClient | null = null;
/** 앱의 레이어 일꾼 하나 (창이 열릴 때 만든다). */
export function layersClient(gateway: () => BaeLayersGateway): LayersClient {
  shared ??= createLayersClient({ gateway, makeWorker: makeLayersWorker });
  return shared;
}
