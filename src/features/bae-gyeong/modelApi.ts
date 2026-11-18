/**
 * BAE경 모델 통로의 화면 쪽 모양 (메인: electron/bae/model/modelIpc.ts). preload 가 `window.baeModelAPI` 로 연다.
 *   - 모델 받기 · 상태, 4K 선명하게(A, 모델 일꾼), 화면에서 도는 모델 파일(4K 원본 그대로 B), 이 PC 점검 · 서버 표, 전용 통로.
 *   - 전용 통로(MessagePort)는 preload 가 window.postMessage({ type: 'bae-model-port', nonce }, '*', [port]) 로 넘긴다.
 *     baeModelPort() 가 그것을 받아 준다 → 화면 쪽 일꾼(5단계 레이어)에게 넘겨주면 모델 일꾼과 직접 이야기한다.
 *     모델 일꾼이 쉬어서 내려가면 통로가 닫힌다 (onWorker 의 running:false) — 다음 일 전에 새로 받는다.
 */
import type { BaeModelId, BaeModelProgress, BaeModelState } from '@/shared/bae/models';
import type { BaePcCheck, BaePcCheckRow, BaeWebGpuInfo } from '@/shared/bae/pcCheck';

export interface BaeModelStatus {
  models: BaeModelState[];
  worker: { running: boolean; pid: number | null; starts: number; crashes: number };
}
export interface BaeUpscaleAReply { w: number; h: number; rgba: Uint8Array | Uint8ClampedArray; ep: 'dml' | 'cpu'; ms: number; tiles: number; fellBack: boolean }
export interface BaeUpscaleTick { ticket: string; done: number; total: number }
export interface BaeWorkerState { running: boolean; expected: boolean; reason: string }

/** preload 가 여는 통로 (모든 요청은 지금 로그인 세션의 epoch 를 붙여 메인으로 간다). */
export interface BaeModelGateway {
  status(): Promise<BaeModelStatus>;
  /** 모델을 이 PC 에 준비 (창고 → 인터넷). 받는 중 알림은 onProgress. */
  ensure(id: BaeModelId): Promise<{ id: BaeModelId; sources: Record<string, 'local' | 'warehouse' | 'internet'> }>;
  /** 화면에서 도는 모델(지금은 'up-b')의 파일 바이트. 메인이 확인값까지 본 뒤 준다. */
  files(id: BaeModelId): Promise<{ files: Record<string, Uint8Array> }>;
  /** 4K 선명하게: RGBA 그림 → 2배 RGBA (모델 일꾼). 타일 알림은 onUpscaleProgress (같은 ticket). */
  upscaleA(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, ticket: string): Promise<BaeUpscaleAReply>;
  pcCheck(webgpu: BaeWebGpuInfo | null): Promise<BaePcCheck>;
  /** 마지막 점검을 서버 표에 올린다 (내 줄). */
  pcCheckPut(): Promise<BaePcCheckRow>;
  /** 관리자 · 검수자: 모두의 PC 점검 표 */
  pcCheckList(): Promise<BaePcCheckRow[]>;
  /** 전용 통로를 달라고 한다 → nonce. 통로 자체는 window 'message' 로 온다 (baeModelPort 가 받아 준다). */
  portRequest(): Promise<string>;
  onProgress(callback: (p: BaeModelProgress) => void): () => void;
  onUpscaleProgress(callback: (p: BaeUpscaleTick) => void): () => void;
  onWorker(callback: (s: BaeWorkerState) => void): () => void;
}

declare global {
  interface Window { baeModelAPI?: BaeModelGateway }
}

export function baeModelGateway(): BaeModelGateway {
  if (typeof window !== 'undefined' && window.baeModelAPI) return window.baeModelAPI;
  throw new Error('BAE경 모델 기능이 준비되지 않았어요. 앱을 다시 실행해 주세요.');
}

/** 모델 일꾼으로 가는 전용 통로 하나 (10초 안에 오지 않으면 실패). */
export function baeModelPort(gateway: BaeModelGateway = baeModelGateway(), timeoutMs = 10_000): Promise<MessagePort> {
  return new Promise<MessagePort>((resolve, reject) => {
    const arrived = new Map<string, MessagePort>(); let want: string | null = null; let done = false;
    const finish = (err: Error | null, port?: MessagePort) => {
      if (done) return; done = true; window.removeEventListener('message', onMsg); clearTimeout(timer);
      for (const [n, p] of arrived) if (p !== port) { try { p.close(); } catch { /* ignore */ } arrived.delete(n); }
      if (err) reject(err); else resolve(port!);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; nonce?: unknown } | null;
      if (!d || d.type !== 'bae-model-port' || typeof d.nonce !== 'string' || !e.ports[0]) return;
      arrived.set(d.nonce, e.ports[0]);
      if (want && arrived.has(want)) finish(null, arrived.get(want));
    };
    const timer = setTimeout(() => finish(new Error('모델 일꾼과 통로를 열지 못했어요. 다시 해 주세요.')), timeoutMs);
    window.addEventListener('message', onMsg);
    gateway.portRequest().then((nonce) => { want = nonce; if (arrived.has(nonce)) finish(null, arrived.get(nonce)); }, (e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}
