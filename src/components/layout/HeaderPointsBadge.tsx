import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';

import { canAccessPlayground } from '@/features/playground/featureFlag';
import { initArcadeWalletBridge } from '@/features/playground/arcade/walletBridge';
import { useArcadeStore } from '@/features/playground/arcade/useArcadeStore';
import {
  createBadgeFloatQueue,
  enqueueBadgeFloat,
  popBadgeFloat,
} from '@/features/playground/arcade/badgeFloatQueue';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';
import { formatHeaderPoints } from './headerPointsFormat';

// 앱 우상단 보유 포인트 배지. 배플레이그라운드 접근 권한이 있을 때만 노출한다.
// 적립이 들어오면(applyWalletPush) 배지가 살짝 펄스하고 "+N P" 라벨이 떠올라 사라진다.
// prefers-reduced-motion 이면 연출을 생략하고 배지 숫자만 즉시 갱신한다.
export function HeaderPointsBadge() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const walletPoints = useArcadeStore((state) => state.snapshot?.wallet.walletPoints ?? null);
  const lastGain = useArcadeStore((state) => state.lastGain);
  const load = useArcadeStore((state) => state.load);
  const canAccess = canAccessPlayground(currentUser);
  const userId = currentUser?.id ?? null;

  const prefersReducedMotion = useReducedMotion();
  const pulseControls = useAnimationControls();
  const [floatQueue, setFloatQueue] = useState(createBadgeFloatQueue);
  const lastProcessedGainId = useRef(0);

  useEffect(() => {
    if (!canAccess || !userId) return;
    initArcadeWalletBridge();
    void load(userId);
  }, [canAccess, userId, load]);

  // 적립 push 마다 한 번씩만 연출을 재생한다(같은 gain id 재처리 방지).
  useEffect(() => {
    if (!lastGain || lastGain.id === lastProcessedGainId.current) return;
    lastProcessedGainId.current = lastGain.id;
    if (prefersReducedMotion) return; // 숫자는 스냅샷으로 이미 갱신됨 — 연출만 생략
    setFloatQueue((queue) => enqueueBadgeFloat(queue, lastGain.delta));
    void pulseControls.start({ scale: [1, 1.06, 1], transition: { duration: 0.4, ease: 'easeOut' } });
  }, [lastGain, prefersReducedMotion, pulseControls]);

  if (!canAccess) return null;

  // 캐시된 잔액이 있으면 이후 mutation 오류·재로딩과 무관하게 계속 보여준다.
  // 잔액이 아직 없을 때만(최초 로딩·로드 실패) formatHeaderPoints 가 '— P' 로 대체한다.
  const label = formatHeaderPoints(walletPoints);

  return (
    <div className="relative">
      <motion.button
        type="button"
        animate={pulseControls}
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
      </motion.button>
      {floatQueue.items.map((item, index) => (
        <motion.span
          key={item.id}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: [0, 1, 1, 0], y: -18 }}
          transition={{ duration: 1.2, times: [0, 0.15, 0.7, 1], ease: 'easeOut' }}
          onAnimationComplete={() => setFloatQueue((queue) => popBadgeFloat(queue))}
          style={{ right: 8 + index * 4 }}
          className="pointer-events-none absolute -top-2 text-xs font-bold text-accent tabular-nums"
          aria-hidden
        >
          +{item.delta}P
        </motion.span>
      ))}
    </div>
  );
}
