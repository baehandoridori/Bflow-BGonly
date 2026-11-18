/**
 * BAE경 '다른 각도로' 통로 (화면 → 메인). 응답은 요청 때의 로그인 세션(epoch)과 같을 때만 돌려준다 (baeJobsIpc 와 같은 규칙).
 *   bae:angle-draw  (call, epoch) → BaeAngleDrawOutcome | BaeFailure   (오류를 던지지 않는다: '그만둠'을 구분하려고)
 *   bae:angle-abort (jobId, epoch) → boolean
 * 진행 알림은 deps.progress 로 ('bae:progress' 와 같은 모양 + memo: 'reading' | 'done' | 'raw').
 */
import { isBaeJobId } from '../../src/shared/bae/jobs';
import { createBaeAngle, type BaeAngle, type BaeAngleDeps, type BaeAngleDrawCall } from './baeAngle';

export const BAE_ANGLE_CHANNELS = ['bae:angle-draw', 'bae:angle-abort'] as const;
const MAX_CALL_BYTES = 96 * 1024 * 1024;

export interface BaeAngleIpcDeps extends BaeAngleDeps {
  ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  canUse(actorId: string): Promise<boolean>;
}

/** 통로를 열고 작업 흐름을 돌려준다 (main 이 로그아웃 · 끄기에 abortAll 을 부르게). */
export function registerBaeAngleIpc(deps: BaeAngleIpcDeps): BaeAngle {
  const angle = createBaeAngle(deps);
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 바뀌었어요. 화면을 다시 열어 주세요.');
    return origin;
  }
  const same = (origin: { userId: string; epoch: number }) => {
    try { const n = deps.getSessionOriginOrThrow(); return n.userId === origin.userId && n.epoch === origin.epoch; } catch { return false; }
  };
  const gone = { ok: false as const, aborted: false, message: '로그인 세션이 바뀌어 BAE경 응답을 버렸어요.', code: 'SESSION' };

  deps.ipc.handle('bae:angle-draw', async (_e, call, epoch) => {
    const origin = originFor(epoch);
    const q = call as BaeAngleDrawCall;
    if (!q || typeof q !== 'object' || !isBaeJobId(q.jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const bytes = Array.isArray(q.images) ? q.images.reduce((n, b) => n + (b instanceof Uint8Array ? b.byteLength : 0), 0) : 0;
    if (bytes > MAX_CALL_BYTES) throw new Error('보낼 그림이 너무 커요. 같은 공간 그림 수를 줄여 주세요.');
    if (!(await deps.canUse(origin.userId))) throw new Error('BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.');
    const r = await angle.draw(origin, q);
    return same(origin) ? r : gone;
  });
  deps.ipc.handle('bae:angle-abort', async (_e, jobId, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeJobId(jobId)) return false;
    return angle.abort(jobId, origin.userId);
  });
  return angle;
}
