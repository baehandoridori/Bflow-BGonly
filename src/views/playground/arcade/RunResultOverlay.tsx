import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import type { ArcadeFinishResult, ArcadeGrade } from '@/features/playground/arcade/types';
import type { PreviewGame } from '@/features/playground/routes';
import './arcade.css';

export interface RunResultOverlayProps {
  gameId: PreviewGame;
  result: ArcadeFinishResult;
  scoreLabel: string; // 예: "길이 42" / "32,410점"
  onReplay: () => void;
  onExit: () => void;
  replayDisabledReason?: string;
  returnLabel?: string; // 소스 서페이스 라벨('게임 로비' / 'JBBJ 하우스')
}

const GRADE_LABEL: Record<ArcadeGrade, string> = {
  none: '등급 없음',
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
};

const GRADE_FILL: Record<ArcadeGrade, number> = {
  none: 0.08,
  bronze: 0.3,
  silver: 0.55,
  gold: 0.8,
  platinum: 1,
};

// 보상 포인트 카운트업(0→n). reduced-motion 이면 즉시 최종값.
function useCountUp(target: number, durationMs: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    if (target <= 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (nowMs: number): void => {
      const progress = Math.min(1, (nowMs - start) / durationMs);
      setValue(Math.round(target * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, enabled]);
  return value;
}

export function RunResultOverlay(props: RunResultOverlayProps) {
  const { result, scoreLabel, onReplay, onExit, replayDisabledReason, returnLabel = '로비로' } = props;
  const prefersReducedMotion = useReducedMotion();
  const animate = !prefersReducedMotion;
  const reward = useCountUp(result.rewardPoints, 480, animate);
  const fill = GRADE_FILL[result.grade];

  return (
    <div className="pg-arcade-result" role="group" aria-label="게임 결과">
      <div className="pg-arcade-result__score">{scoreLabel}</div>
      <div className="pg-arcade-result__gauge">
        <motion.div
          className="pg-arcade-result__gauge-fill"
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${Math.round(fill * 100)}%` }}
          transition={{ duration: animate ? 0.56 : 0, ease: 'easeOut' }}
        />
      </div>
      <div className="pg-arcade-result__grade">{GRADE_LABEL[result.grade]}</div>

      {result.rewardCapped ? (
        <p className="pg-arcade-result__reward">오늘 보상 한도에 도달했어요 (5/5)</p>
      ) : (
        <p className="pg-arcade-result__reward">+{reward}P</p>
      )}

      {result.newAlltimeBest && (
        <div className="pg-arcade-result__best">신기록! (내 최고 {result.myBestScore})</div>
      )}

      {result.unlockedAchievements.length > 0 && (
        <div className="pg-arcade-result__ach">
          {result.unlockedAchievements.map((ach, index) => (
            <motion.div
              key={ach.id}
              className="pg-arcade-result__ach-card"
              initial={animate ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: animate ? 0.24 : 0, delay: animate ? index * 0.12 : 0 }}
            >
              <span>도전과제 달성! {ach.name}</span>
              <span className="pg-arcade-result__ach-bonus">+{ach.bonusPoints}P</span>
            </motion.div>
          ))}
        </div>
      )}

      <div className="pg-arcade-keyhints">
        <button type="button" className="pg-arcade-btn" onClick={onReplay} disabled={!!replayDisabledReason}>
          다시 하기
        </button>
        <button type="button" className="pg-arcade-btn pg-arcade-btn--ghost" onClick={onExit}>
          {returnLabel}
        </button>
      </div>
      {replayDisabledReason && <p className="pg-arcade-overlay__hint">{replayDisabledReason}</p>}
    </div>
  );
}
