/**
 * BAE경 '다른 각도로' 통로의 화면 쪽 모양 (메인: electron/bae/baeAngleIpc.ts). preload 가 `window.baeAngleAPI` 로 연다.
 *   draw(call)    → 'bae:angle-draw'  (call, epoch)  — PD메모 읽기 · 주문서 · 그림 부르기 · 기록 · 장부까지 메인이 한다
 *   abort(jobId)  → 'bae:angle-abort' (jobId, epoch)
 * 진행 알림(중간 그림, 'PD가 메모 읽는 중')은 'bae:progress' 와 같은 모양으로 메인의 progress 가 보낸다 (memo: 'reading' | 'done' | 'raw').
 * 테스트 모드는 previewAngle.ts 의 흉내를 같은 모양으로 쓴다.
 */
import type { BaeAngleDrawCall, BaeAngleDrawOutcome } from '@/shared/bae/angle/calls';
import type { BaeFailure } from '@/shared/bae/makeCalls';

export interface BaeAngleGateway {
  draw(call: BaeAngleDrawCall): Promise<BaeAngleDrawOutcome | BaeFailure>;
  abort(jobId: string): Promise<boolean>;
}
declare global {
  interface Window { baeAngleAPI?: BaeAngleGateway }
}
export function baeAngleGateway(): BaeAngleGateway {
  if (typeof window !== 'undefined' && window.baeAngleAPI) return window.baeAngleAPI;
  throw new Error('BAE경 다른 각도로 기능이 준비되지 않았어요. 앱을 다시 실행해 주세요.');
}
