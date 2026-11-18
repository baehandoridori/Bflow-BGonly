/**
 * BAE경 모델 일꾼 프로세스(electron/bae/model/modelWorker.ts)와 주고받는 말 (계획 14 3-3).
 * 두 길이 같은 말을 쓴다: 메인이 직접(utilityProcess 의 parentPort) · 화면 쪽 일꾼이 전용 통로(MessagePort)로.
 *   요청 { id, type, ... } → 진행 { id, progress } … → 답 { id, ok: true, ... } 또는 { id, ok: false, error, code }
 * 큰 숫자 배열은 복사로 간다 (utilityProcess · MessagePortMain 의 넘겨주기 목록에는 통로만 들어간다).
 */

export type BaeWorkerEp = 'dml' | 'cpu';

export interface BaeWorkerHello { pid: number; node: string; electron: string; ep: BaeWorkerEp; fakeNoGpu: string | null }

/** DirectML 이 이 PC 에서 되는지: 아주 작은 모델 하나를 그래픽카드로 만들어 한 번 돌려 본다. */
export interface BaeWorkerProbe {
  dml: { ok: boolean; ms: number; error?: string };
  cpu: { ok: boolean; ms: number; error?: string };
}

export interface BaeUpscaleAResult { w: number; h: number; rgba: Uint8ClampedArray | Uint8Array; ep: BaeWorkerEp; ms: number; sessionMs: number; tiles: number; fellBack: boolean }

export type BaeWorkerRequest =
  | { id: number; type: 'hello' }
  | { id: number; type: 'probe' }
  | { id: number; type: 'mem' }
  | { id: number; type: 'release' }
  /** 4K 선명하게: RGBA 그림을 2배로 (HTML enlarge2x, 모델은 4배 → 2×2 평균). */
  | { id: number; type: 'up.a'; W: number; H: number; rgba: Uint8Array | Uint8ClampedArray }
  /** SAM (5단계): 그림 읽기 · 상자/점으로 윤곽 · 내리기. key 는 그림 픽셀의 SHA-256 앞 12자리 (계획 14 3-4 함정 1). */
  | { id: number; type: 'sam.setImage'; key: string; W: number; H: number; rgb?: Uint8Array }
  | { id: number; type: 'sam.run'; key: string; box?: number[]; points?: number[][]; labels?: number[] }
  | { id: number; type: 'sam.dispose' }
  /** 깊이 (다른 각도로) · BiRefNet (6단계): 모델 하나에 1×3×H×W 를 넣고 첫 출력을 받는다. */
  | { id: number; type: 'depth.run'; input: Float32Array; dims: number[] }
  | { id: number; type: 'bir.run'; input: Float32Array }
  /** 시험 전용 (BAE_MODEL_TEST=1 일 때만): 일꾼을 일부러 끝낸다. */
  | { id: number; type: 'crash' };

export type BaeWorkerRequestType = BaeWorkerRequest['type'];
/** 어떤 요청이 어떤 모델을 쓰나 (메인이 보내기 전에 보관함에서 준비한다). */
export const BAE_WORKER_MODEL_OF: Partial<Record<BaeWorkerRequestType, 'sam' | 'depth' | 'birefnet' | 'up-a'>> = {
  'up.a': 'up-a', 'sam.setImage': 'sam', 'sam.run': 'sam', 'depth.run': 'depth', 'bir.run': 'birefnet',
};

export type BaeWorkerReply =
  | ({ id: number; ok: true } & Record<string, unknown>)
  | { id: number; ok: false; error: string; code?: string };

export interface BaeWorkerProgress { id: number; progress: { done: number; total: number } }

/** 일꾼이 메인에게 따로 알리는 것: 준비됨 · 전용 통로로 일이 왔음 (쉬는 시간 재기용). */
export type BaeWorkerNotice = { type: 'ready'; pid: number } | { type: 'activity' };

export function isBaeWorkerProgress(m: unknown): m is BaeWorkerProgress {
  return !!m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'number' && !!(m as { progress?: unknown }).progress;
}
export function isBaeWorkerReply(m: unknown): m is BaeWorkerReply {
  return !!m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'number' && typeof (m as { ok?: unknown }).ok === 'boolean';
}
