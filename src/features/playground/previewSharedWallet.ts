// 프리뷰 공유 지갑 — 프로덕션에선 지갑(playground_wallet_accounts)이 아케이드·모의투자가
// 공유하는 한 행이다. 프리뷰는 두 기능이 각자 저장소 스냅샷을 갖고 있어, 한쪽의 지갑
// 변경이 다른 쪽 재로딩 때 되돌아간다. 이 공유 키를 단일 진실로 두어, 주입된 storage 어댑터로
// 두 게이트웨이가 같은 지갑 잔액을 읽고 쓰게 한다.
export interface PreviewWallet {
  walletPoints: number;
  lifetimeEarnedPoints: number;
}

const SHARED_WALLET_KEY_PREFIX = 'bflow-preview-shared-wallet:v1:';

function keyFor(userId: string): string {
  return `${SHARED_WALLET_KEY_PREFIX}${userId}`;
}

export function readSharedPreviewWallet(storage: Storage, userId: string): PreviewWallet | null {
  try {
    const raw = storage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === 'object'
      && typeof (parsed as PreviewWallet).walletPoints === 'number'
      && typeof (parsed as PreviewWallet).lifetimeEarnedPoints === 'number'
    ) {
      const wallet = parsed as PreviewWallet;
      return { walletPoints: wallet.walletPoints, lifetimeEarnedPoints: wallet.lifetimeEarnedPoints };
    }
  } catch {
    /* 손상된 값은 없는 것으로 본다. */
  }
  return null;
}

export function writeSharedPreviewWallet(storage: Storage, userId: string, wallet: PreviewWallet): void {
  try {
    storage.setItem(keyFor(userId), JSON.stringify({
      walletPoints: wallet.walletPoints,
      lifetimeEarnedPoints: wallet.lifetimeEarnedPoints,
    }));
  } catch {
    /* private browsing 등에서 저장 실패는 무시 */
  }
}

// 공유 지갑이 있으면 그것을 단일 진실로 덮어쓰고, 없으면 현재 값을 시드로 기록한다.
// 반환값은 반영해야 할 최종 지갑.
export function reconcileSharedPreviewWallet(
  storage: Storage,
  userId: string,
  current: PreviewWallet,
): PreviewWallet {
  const shared = readSharedPreviewWallet(storage, userId);
  if (shared) return shared;
  writeSharedPreviewWallet(storage, userId, current);
  return current;
}
