import { useEffect, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';

import type { PlaygroundGameDefinition } from '@/features/playground/catalog';
import { usePlaygroundBackInterceptor } from '../PlaygroundBackProvider';
import './arcade.css';

export type ArcadeStagePhase = 'ready' | 'countdown' | 'running' | 'paused' | 'finishing' | 'result';

export interface ArcadeKeyHint {
  readonly key: string;
  readonly label: string;
}

export interface ArcadeStageChromeProps {
  game: PlaygroundGameDefinition;
  phase: ArcadeStagePhase;
  hud: ReactNode;
  stage: ReactNode;
  result?: ReactNode;
  onStart: () => void;
  onResume: () => void;
  onQuit: () => void;
  onCountdownComplete: () => void;
  startDisabledReason?: string;
  todayRewardedRuns: number;
  entryFee: number;
  dailyRewardCap: number;
  keyHints: readonly ArcadeKeyHint[];
}

const COUNTDOWN_STEP_MS = 700;

// aria-live 로 읽어줄 상태 문구(항상 한 개만 유지).
function statusText(phase: ArcadeStagePhase, game: PlaygroundGameDefinition): string {
  switch (phase) {
    case 'ready': return `${game.koName} 시작 준비`;
    case 'countdown': return '곧 시작해요';
    case 'running': return `${game.koName} 진행 중`;
    case 'paused': return '일시정지';
    case 'finishing': return '결과 계산 중';
    case 'result': return '결과';
    default: return '';
  }
}

export function ArcadeStageChrome(props: ArcadeStageChromeProps) {
  const {
    game, phase, hud, stage, result,
    onStart, onResume, onQuit, onCountdownComplete,
    startDisabledReason, todayRewardedRuns, entryFee, dailyRewardCap, keyHints,
  } = props;

  const prefersReducedMotion = useReducedMotion();
  const [countdown, setCountdown] = useState(3);
  const [confirmingQuit, setConfirmingQuit] = useState(false);

  // 진행/일시정지/카운트다운에서만 뒤로가기를 가로채 종료 확인을 띄운다(ready/result 는 통과).
  const interceptActive = phase === 'running' || phase === 'paused' || phase === 'countdown';
  usePlaygroundBackInterceptor(interceptActive, () => setConfirmingQuit(true));

  // 카운트다운 3→2→1 (각 700ms) 후 시작. reduced-motion 이면 대기 없이 즉시 시작.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (prefersReducedMotion) {
      onCountdownComplete();
      return;
    }
    setCountdown(3);
    let current = 3;
    const timer = setInterval(() => {
      current -= 1;
      if (current <= 0) {
        clearInterval(timer);
        onCountdownComplete();
      } else {
        setCountdown(current);
      }
    }, COUNTDOWN_STEP_MS);
    return () => clearInterval(timer);
  }, [phase, prefersReducedMotion, onCountdownComplete]);

  const rewardsLeft = Math.max(0, dailyRewardCap - todayRewardedRuns);

  return (
    <section className="pg-arcade-stage" aria-label={`${game.koName} 게임`}>
      <p className="pg-arcade-visually-live" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {statusText(phase, game)}
      </p>
      <div className="pg-arcade-stage__frame">
        <div className="pg-arcade-hud">{hud}</div>
        {stage}

        {phase === 'ready' && (
          <div className="pg-arcade-overlay">
            <div className="pg-arcade-overlay__title">{game.koName}</div>
            <p className="pg-arcade-overlay__hint">{game.stageReward}</p>
            <div className="pg-arcade-keyhints">
              {keyHints.map((hint) => (
                <span key={hint.key} className="pg-arcade-keyhint">
                  <span className="pg-arcade-keyhint__key">{hint.key}</span>
                  {hint.label}
                </span>
              ))}
            </div>
            <p className="pg-arcade-overlay__hint">오늘 보상 가능 {rewardsLeft}/{dailyRewardCap}</p>
            <button
              type="button"
              className="pg-arcade-btn"
              onClick={onStart}
              disabled={!!startDisabledReason}
            >
              {entryFee}P 내고 시작
            </button>
            {startDisabledReason && <p className="pg-arcade-overlay__hint">{startDisabledReason}</p>}
          </div>
        )}

        {phase === 'countdown' && (
          <div className="pg-arcade-overlay">
            <div className="pg-arcade-countdown">{countdown}</div>
          </div>
        )}

        {phase === 'paused' && !confirmingQuit && (
          <div className="pg-arcade-overlay">
            <div className="pg-arcade-overlay__title">일시정지</div>
            <button type="button" className="pg-arcade-btn" onClick={onResume}>계속하기</button>
            <button type="button" className="pg-arcade-btn pg-arcade-btn--ghost" onClick={() => setConfirmingQuit(true)}>나가기</button>
          </div>
        )}

        {confirmingQuit && (
          <div className="pg-arcade-overlay">
            <div className="pg-arcade-overlay__title">게임을 종료할까요?</div>
            <p className="pg-arcade-overlay__hint">입장료는 돌려받지 못해요.</p>
            <button type="button" className="pg-arcade-btn" onClick={() => { setConfirmingQuit(false); onQuit(); }}>종료</button>
            <button type="button" className="pg-arcade-btn pg-arcade-btn--ghost" onClick={() => setConfirmingQuit(false)}>계속하기</button>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="pg-arcade-overlay">{result}</div>
        )}
      </div>
    </section>
  );
}
