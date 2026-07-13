import { useEffect } from 'react';

import { canAccessPlayground } from '@/features/playground/featureFlag';
import { initArcadeWalletBridge } from '@/features/playground/arcade/walletBridge';
import { useArcadeStore } from '@/features/playground/arcade/useArcadeStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';
import { formatHeaderPoints } from './headerPointsFormat';

// 앱 우상단 보유 포인트 배지. 배플레이그라운드 접근 권한이 있을 때만 노출한다.
// 획득 연출(+N 플로팅·펄스)은 PR B 에서 붙이고, 여기서는 정적 배지까지.
export function HeaderPointsBadge() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const walletPoints = useArcadeStore((state) => state.snapshot?.wallet.walletPoints ?? null);
  const load = useArcadeStore((state) => state.load);
  const canAccess = canAccessPlayground(currentUser);
  const userId = currentUser?.id ?? null;

  useEffect(() => {
    if (!canAccess || !userId) return;
    initArcadeWalletBridge();
    void load(userId);
  }, [canAccess, userId, load]);

  if (!canAccess) return null;

  // 캐시된 잔액이 있으면 이후 mutation 오류·재로딩과 무관하게 계속 보여준다.
  // 잔액이 아직 없을 때만(최초 로딩·로드 실패) formatHeaderPoints 가 '— P' 로 대체한다.
  const label = formatHeaderPoints(walletPoints);

  return (
    <button
      type="button"
      onClick={() => useAppStore.getState().setView('playground')}
      aria-label={`보유 포인트 ${label}, 배플레이그라운드 열기`}
      title="배플레이그라운드"
      className={cn(
        'flex items-center rounded-lg px-2.5 py-1.5',
        'bg-bg-card border border-bg-border',
        'text-sm font-semibold text-text-primary tabular-nums',
        'transition-colors hover:border-accent hover:text-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'motion-reduce:transition-none',
      )}
    >
      {label}
    </button>
  );
}
