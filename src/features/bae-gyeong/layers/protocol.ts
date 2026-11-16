/**
 * 화면 ↔ 레이어 일꾼(layersWorker.ts) 사이의 말. GPT · 저장소는 일꾼이 화면에게 부탁하고(rpc), 화면이 메인 통로(window.baeLayersAPI)로 보낸다.
 * SAM 은 일꾼이 모델 일꾼과 전용 통로(port)로 직접 이야기한다 (계획 14 3-1 그림의 '전용 통로').
 */
import type { LayerPlan } from './engine/planview';
import type { LayersDoneSummary, LayersProposal, PackedAdded } from './session';

export type LayersRpcMethod = 'pd' | 'edit' | 'storeGet' | 'storeSet';

export type LayersToWorker =
  | { type: 'port' }                                           // ports[0] = 모델 일꾼 전용 통로 (앞 통로는 닫는다)
  | { type: 'sam-gone'; reason: string }                       // 모델 일꾼이 내려감: 기다리던 SAM 요청을 실패로
  | { type: 'plan'; req: number; bytes: ArrayBuffer; pic: string; notes: string }
  | { type: 'add'; req: number; box: number[]; name: string }
  | { type: 'split'; req: number; plan: LayerPlan }
  | { type: 'savePlan'; pic: string; plan: LayerPlan }
  | { type: 'drop' }
  | { type: 'abort' }
  | { type: 'rpc-reply'; id: number; ok: true; value: unknown }
  | { type: 'rpc-reply'; id: number; ok: false; error: string; name?: string };

export type LayersFromWorker =
  | { type: 'step'; step: string; state: string; info: Record<string, unknown> }
  | { type: 'log'; text: string }
  | { type: 'rpc'; id: number; method: LayersRpcMethod; args: Record<string, unknown> }
  | { type: 'decoded'; req: number; w: number; h: number }
  | { type: 'planned'; req: number; proposal: LayersProposal }
  | { type: 'added'; req: number; obj: PackedAdded; usd: number }
  | { type: 'done'; req: number; psd: ArrayBuffer; summary: LayersDoneSummary }
  | { type: 'error'; req: number; step: 'plan' | 'add' | 'split'; name: string; message: string };
