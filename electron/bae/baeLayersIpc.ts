/**
 * BAE경 '레이어로 나누기' 통로 (화면 → 메인, 5단계). 다른 BAE경 통로처럼 요청 때의 로그인 세션(epoch)을 보고, BAE경을 쓸 권한이 있을 때만,
 * 응답은 그 세션이 그대로일 때만 돌려준다. 키 · 토큰은 이 통로를 지나지 않는다. GPT 답과 오류는 { ok:false, aborted, message } 로 돌려준다.
 *   bae:layers-begin        (call, epoch)                → { ok, jobId }            나눌 그림을 이 PC 작업 폴더에
 *   bae:layers-pd           (call, epoch)                → { ok, json, usd }        PD (물건 찾기 · 앞뒤 · 네모 안 물건 이름)
 *   bae:layers-edit         (call, epoch)                → { ok, png, usd }         GPT Image (빈 방 · 더한 자리 · 앞 지우고 뒤)
 *   bae:layers-done         (call, epoch)                → { ok, jobId, psdPath, costUsd, sec }
 *   bae:layers-end          (jobId, how, message, epoch) → boolean                  'failed' | 'stopped' | 'closed'
 *   bae:layers-abort        (jobId, epoch)               → boolean
 *   bae:layers-store-get    (pic, key, epoch)            → 저장한 값 | null
 *   bae:layers-store-set    (pic, key, value, epoch)     → true
 *   bae:layers-store-forget (pic, epoch)                 → true
 *   bae:layers-show-psd     (jobId, epoch)               → boolean                  PSD 가 있는 폴더 열기
 * baeMain.ts 는 registerBaeLayersIpc 하나만 부르면 된다 (만들기 흐름과 같은 보관함 · 줄 · 설정 · 키 · 그림 기억을 넘긴다).
 */
import { createBaeLayers, type BaeLayersDeps } from './baeLayers';
import type { BaeLayersBeginCall, BaeLayersDoneCall, BaeLayersEditCall, BaeLayersPdCall } from '../../src/shared/bae/layers';

export interface BaeLayersIpcDeps extends BaeLayersDeps {
  ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  canUse(actorId: string): Promise<boolean>;
}

export const BAE_LAYERS_CHANNELS = [
  'bae:layers-begin', 'bae:layers-pd', 'bae:layers-edit', 'bae:layers-done', 'bae:layers-end', 'bae:layers-abort',
  'bae:layers-store-get', 'bae:layers-store-set', 'bae:layers-store-forget', 'bae:layers-show-psd',
] as const;

export function registerBaeLayersIpc(deps: BaeLayersIpcDeps) {
  const layers = createBaeLayers(deps);
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 바뀌었어요. 화면을 다시 열어 주세요.');
    return origin;
  }
  const same = (origin: { userId: string; epoch: number }) => {
    try { const n = deps.getSessionOriginOrThrow(); return n.userId === origin.userId && n.epoch === origin.epoch; } catch { return false; }
  };
  const gone = { ok: false as const, aborted: false, message: '로그인 세션이 바뀌어 BAE경 응답을 버렸어요.', code: 'SESSION' };
  async function useOrThrow(userId: string) {
    if (!(await deps.canUse(userId))) throw new Error('BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.');
  }
  /** 권한을 본 뒤 일하고, 세션이 그대로일 때만 답한다. */
  const handle = (channel: string, epochAt: number, fn: (origin: { userId: string; epoch: number }, args: unknown[]) => Promise<unknown>, whenGone: unknown = gone) => {
    deps.ipc.handle(channel, async (_e, ...args) => {
      const origin = originFor(args[epochAt]);
      await useOrThrow(origin.userId);
      const r = await fn(origin, args);
      if (same(origin)) return r;
      if (whenGone === gone) layers.abort(origin.userId, (args[0] as { jobId?: unknown } | null)?.jobId);
      return whenGone;
    });
  };

  handle('bae:layers-begin', 1, (o, a) => layers.begin(o.userId, a[0] as BaeLayersBeginCall));
  handle('bae:layers-pd', 1, (o, a) => layers.pd(o, a[0] as BaeLayersPdCall));
  handle('bae:layers-edit', 1, (o, a) => layers.edit(o, a[0] as BaeLayersEditCall));
  handle('bae:layers-done', 1, (o, a) => layers.done(o.userId, a[0] as BaeLayersDoneCall));
  handle('bae:layers-end', 3, (o, a) => layers.end(o.userId, a[0], a[1], a[2]), false);
  handle('bae:layers-abort', 1, async (o, a) => layers.abort(o.userId, a[0]), false);
  handle('bae:layers-store-get', 2, (o, a) => layers.storeGet(o.userId, a[0], a[1]), null);
  handle('bae:layers-store-set', 3, (o, a) => layers.storeSet(o.userId, a[0], a[1], a[2]), false);
  handle('bae:layers-store-forget', 1, (o, a) => layers.storeForget(o.userId, a[0]), false);
  handle('bae:layers-show-psd', 1, async (o, a) => layers.showPsd(o.userId, a[0]), false);

  return {
    /** 로그아웃 · 앱 끄기 (baeMain 의 stop 에서) */
    abortAll() { layers.abortAll(); },
    layers,
  };
}
export type BaeLayersIpc = ReturnType<typeof registerBaeLayersIpc>;
