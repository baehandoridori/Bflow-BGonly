/**
 * 레이어 통로의 화면 쪽 모양 (메인: electron/bae/baeLayersIpc.ts). preload 가 `window.baeLayersAPI` 로 연다.
 * 모양은 src/shared/bae/layers.ts 의 BaeLayersGateway — 모든 요청은 preload 가 지금 로그인 세션의 epoch 를 붙인다.
 */
import type { BaeLayersGateway } from '@/shared/bae/layers';

export type { BaeLayersGateway };

declare global {
  interface Window { baeLayersAPI?: BaeLayersGateway }
}

export function baeLayersGateway(): BaeLayersGateway {
  if (typeof window !== 'undefined' && window.baeLayersAPI) return window.baeLayersAPI;
  throw new Error('BAE경 레이어 기능이 준비되지 않았어요. 앱을 다시 실행해 주세요.');
}

/** 통로가 없을 때 (테스트 모드 · preload 연결 전): 창은 뜨고, 일을 시키면 이 글로 실패한다. */
export function unavailableLayersGateway(message: string): BaeLayersGateway {
  const no = async () => ({ ok: false as const, aborted: false, message, code: 'UNAVAILABLE' });
  return {
    begin: no, pd: no, edit: no, done: no,
    end: async () => false, abort: async () => false,
    storeGet: async () => null, storeSet: async () => false, storeForget: async () => false, showPsd: async () => false,
  };
}
