import { useArcadeStore } from './useArcadeStore.ts';
import type { ArcadeWalletPush } from './types';

let unsubscribe: (() => void) | null = null;

// arcade:wallet-updated push 를 앱에서 1회만 구독한다(중복 등록 가드).
// 콜백은 아케이드 스토어를 갱신하고, 스토어가 다시 플레이그라운드 헤더 잔액을 동기화한다.
export function initArcadeWalletBridge(): () => void {
  if (unsubscribe) return unsubscribe;
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api || typeof api.onArcadeWalletUpdated !== 'function') {
    return () => {};
  }
  const off = api.onArcadeWalletUpdated((update: ArcadeWalletPush) => {
    useArcadeStore.getState().applyWalletPush(update);
  });
  unsubscribe = () => {
    off();
    unsubscribe = null;
  };
  return unsubscribe;
}
