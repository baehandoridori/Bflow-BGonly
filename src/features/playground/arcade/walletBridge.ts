import { useArcadeStore } from './useArcadeStore.ts';
import { useMarketPreviewStore } from '../market/useMarketPreviewStore.ts';
import type { ArcadeWalletPush } from './types';

let unsubscribe: (() => void) | null = null;

// 지갑(playground_wallet_accounts)은 아케이드와 모의투자가 공유한다.
// 아케이드 → 마켓은 스토어가 직접 동기화하고, 여기서는 그 반대(마켓 → 아케이드)와
// main 의 arcade:wallet-updated push 를 앱에서 1회만 묶어 구독한다(중복 등록 가드).
export function initArcadeWalletBridge(): () => void {
  if (unsubscribe) return unsubscribe;

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const offPush = api && typeof api.onArcadeWalletUpdated === 'function'
    ? api.onArcadeWalletUpdated((update: ArcadeWalletPush) => {
        useArcadeStore.getState().applyWalletPush(update);
      })
    : () => {};

  // 모의투자 지갑 이동(transfer 등)으로 지갑이 바뀌면 아케이드 스냅샷도 맞춘다.
  let lastWalletPoints: number | null = null;
  let lastLifetime: number | null = null;
  const offMarket = useMarketPreviewStore.subscribe((state) => {
    const account = state.visible?.account;
    if (!account) return;
    if (account.walletPoints === lastWalletPoints && account.lifetimeEarnedPoints === lastLifetime) return;
    lastWalletPoints = account.walletPoints;
    lastLifetime = account.lifetimeEarnedPoints;
    useArcadeStore.getState().applyMarketWallet({
      walletPoints: account.walletPoints,
      lifetimeEarnedPoints: account.lifetimeEarnedPoints,
    });
  });

  unsubscribe = () => {
    offPush();
    offMarket();
    unsubscribe = null;
  };
  return unsubscribe;
}
