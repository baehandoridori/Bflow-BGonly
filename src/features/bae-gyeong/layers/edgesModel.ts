/**
 * 6단계 가장자리 모델(BiRefNet full fp16, 약 490MB) 받기 상태 — 앱이 켜 있는 동안 하나 (창마다가 아님).
 *   idle → getting → ready | failed. 처음 레이어를 쓸 때 SAM 다음에 이어서 받기 시작한다 (계획 14 9-1, useLayersSession 의 물건 찾기).
 *   나누기가 윤곽 단계에 오면 레이어 일꾼이 '쓸 수 있나'(edgesReady)를 묻고, 받는 중이면 EDGES_WAIT_MS 까지 기다린다.
 *   못 쓰면 일꾼은 지금 방식(SAM 만)으로 끝까지 간다 — 까닭(why)은 창과 기록에 쉬운 말로.
 *   broken = 이번에 켠 동안 가장자리를 다듬다가 모델 일꾼이 멈춘 적이 있음 (그래픽카드 메모리 등 — 다시 해도 또 멈출 수 있어 지금 방식으로).
 * React · DOM 없음 (node 시험이 그대로 부른다).
 */
import type { BaeLayersEdgesWhy } from '../../../shared/bae/layers';
import type { BaeModelId } from '../../../shared/bae/models';

export interface LayersEdgesModelState { phase: 'idle' | 'getting' | 'ready' | 'failed'; done: number; total: number; message: string; broken: boolean }
type Ensure = { ensure(id: BaeModelId): Promise<unknown> };

const EDGES: LayersEdgesModelState & { promise: Promise<void> | null } = { phase: 'idle', done: 0, total: 0, message: '', broken: false, promise: null };
/** 나누기가 윤곽 단계에 왔는데 모델을 아직 받는 중이면 이만큼까지 기다린다 (창고에서 복사면 보통 그 안에 끝남, 인터넷이면 지금 방식으로). */
export const EDGES_WAIT_MS = 90_000;
const listeners = new Set<() => void>();
const changed = () => { for (const l of listeners) { try { l(); } catch { /* 화면 쪽 문제 */ } } };

/** 지금 상태 (읽기만) */
export function layersEdgesState(): LayersEdgesModelState { return { phase: EDGES.phase, done: EDGES.done, total: EDGES.total, message: EDGES.message, broken: EDGES.broken }; }
/** 상태가 바뀔 때마다 (창의 안내 줄) */
export function onLayersEdges(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** 가장자리 모델 받기 시작 (이미 받는 중 · 받았으면 그대로, 실패했으면 다시). 기다리지 않는다. */
export function startLayersEdges(mg: Ensure): void {
  if (EDGES.phase === 'getting' || EDGES.phase === 'ready') return;
  EDGES.phase = 'getting'; EDGES.message = ''; changed();
  let p: Promise<unknown>;
  try { p = mg.ensure('birefnet'); } catch (e) { p = Promise.reject(e); }
  EDGES.promise = p.then(
    () => { EDGES.phase = 'ready'; EDGES.done = EDGES.total; changed(); },
    (e) => { EDGES.phase = 'failed'; EDGES.message = String((e as Error)?.message || e).slice(0, 300); changed(); throw e; },
  );
  EDGES.promise.catch(() => { /* 기다리는 쪽이 본다 */ });
}
/** 받는 중 알림 (메인의 bae:model-progress 중 birefnet) */
export function layersEdgesProgress(done: number, total: number): void { EDGES.done = done; EDGES.total = total || EDGES.total; changed(); }
/** 가장자리를 다듬다가 모델 일꾼이 멈췄다 (받아 둔 모델로 돌던 중일 때만) */
export function markLayersEdgesBroken(): boolean { if (EDGES.phase !== 'ready') return false; EDGES.broken = true; changed(); return true; }

/** 레이어 일꾼의 '가장자리 모델을 쓸 수 있나' (나누기의 윤곽 단계에서 한 번). */
export async function layersEdgesReady(mg: Ensure, waitMs = EDGES_WAIT_MS): Promise<{ ok: true } | { ok: false; why: BaeLayersEdgesWhy }> {
  if (EDGES.broken) return { ok: false, why: 'crashed' };
  startLayersEdges(mg);
  if (EDGES.phase === 'ready') return { ok: true };
  if (EDGES.phase === 'failed' || !EDGES.promise) return { ok: false, why: 'missing' };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<'late'>((res) => { timer = setTimeout(() => res('late'), waitMs); });
  const r = await Promise.race([EDGES.promise.then(() => 'ok' as const, () => 'fail' as const), late]);
  if (timer) clearTimeout(timer);
  return r === 'ok' ? { ok: true } : { ok: false, why: r === 'late' ? 'downloading' : 'missing' };
}

const mb = (n: number) => Math.round(n / 1e6);
/** 받는 중 글 (단계 줄 · 안내) */
export function edgesGetText(s: Pick<LayersEdgesModelState, 'done' | 'total'> = EDGES): string {
  return s.total ? `가장자리 모델 받는 중 ${mb(s.done)}/${mb(s.total)}MB (처음 한 번)` : '가장자리 모델 확인 중';
}
const WHY_SHORT: Record<BaeLayersEdgesWhy, string> = { off: '모델 없이', missing: '모델 없음', downloading: '모델 받는 중', failed: '모델 실패', cpu: '그래픽카드 없음', crashed: '앞서 멈춤', nomatch: '윤곽이 안 맞음' };
/** 단계 줄에 붙이는 짧은 까닭 */
export const edgesWhyShort = (w: BaeLayersEdgesWhy) => WHY_SHORT[w] || '';
/** 시험용: 처음 상태로 */
export function resetLayersEdgesForTest(): void { EDGES.phase = 'idle'; EDGES.done = 0; EDGES.total = 0; EDGES.message = ''; EDGES.broken = false; EDGES.promise = null; changed(); }
