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
  onPause: () => void; // 종료 확인을 띄우기 전 진행 중 루프를 멈춘다
  onQuit: () => void;
  onCountdownComplete: () => void;
  finishError?: boolean; // 결과 저장 실패 — 재시도 UI 표시
  onRetryFinish?: () => void;
  onConfirmingChange?: (confirming: boolean) => void; // 종료 확인 모달 표시 여부 — 스테이지가 입력을 막게
  returnLabel?: string; // 소스 서페이스 라벨('게임 로비' / 'JBBJ 하우스')
  startDisabledReason?: string;
  startErrorHint?: string | null; // 시작 실패 안내(재시도 유도) — ready 화면에 표시
  startPending?: boolean; // 입장 요청 진행 중 — 중복 시작(입장료 중복 차감) 방지용 비활성
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
    onStart, onResume, onPause, onQuit, onCountdownComplete, finishError, onRetryFinish,
    onConfirmingChange, returnLabel = '로비로',
    startDisabledReason, startErrorHint, startPending, todayRewardedRuns, entryFee, dailyRewardCap, keyHints,
  } = props;

  const prefersReducedMotion = useReducedMotion();
  const [countdown, setCountdown] = useState(3);
  const [confirmingQuit, setConfirmingQuit] = useState(false);
  const [resumeAfterConfirm, setResumeAfterConfirm] = useState(false);

  // 진행/일시정지/카운트다운, 입장료 정산 중(startPending), 결과 저장 중(finishing·에러 전)에도
  // 뒤로가기를 가로챈다. 정산·저장 중에는 이탈만 막고(모달 없이 — 유료 판이 유실되지 않게),
  // 진행/카운트다운 중이면 먼저 멈춘 뒤 종료 확인을 띄운다. 저장 실패 UI가 뜬 뒤에는 이탈을 허용한다.
  const savingResult = phase === 'finishing' && !finishError;
  const interceptActive = phase === 'running' || phase === 'paused' || phase === 'countdown' || !!startPending || savingResult;
  usePlaygroundBackInterceptor(interceptActive, () => {
    if (startPending || phase === 'finishing') return; // 정산·결과 저장 중 — 이탈만 차단(interceptTop 이 true 반환)
    if (phase === 'running') { onPause(); setResumeAfterConfirm(true); }
    else if (phase === 'countdown') { setResumeAfterConfirm(true); } // 아래 effect 가 confirm 중 멈춘다
    setConfirmingQuit(true);
  });

  // 카운트다운 3→2→1 (각 700ms) 후 시작. 확인 모달 중에는 멈춘다. reduced-motion 이면 즉시 시작.
  useEffect(() => {
    if (phase !== 'countdown' || confirmingQuit) return;
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
  }, [phase, confirmingQuit, prefersReducedMotion, onCountdownComplete]);

  // 종료 확인 모달 표시 여부를 스테이지에 알려, 모달 뒤에서 게임 입력이 처리되지 않게 한다.
  useEffect(() => {
    onConfirmingChange?.(confirmingQuit);
  }, [confirmingQuit, onConfirmingChange]);

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
              disabled={!!startDisabledReason || !!startPending}
            >
              {startPending ? '시작하는 중…' : `${entryFee}P 내고 시작`}
            </button>
            {startDisabledReason && <p className="pg-arcade-overlay__hint">{startDisabledReason}</p>}
            {startErrorHint && <p className="pg-arcade-overlay__hint" role="alert">{startErrorHint}</p>}
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
            <button
              type="button"
              className="pg-arcade-btn pg-arcade-btn--ghost"
              onClick={() => {
                setConfirmingQuit(false);
                if (resumeAfterConfirm) {
                  setResumeAfterConfirm(false);
                  if (phase === 'running') onResume(); // 카운트다운은 위 effect 가 재시작한다
                }
              }}
            >
              계속하기
            </button>
          </div>
        )}

        {phase === 'finishing' && (
          <div className="pg-arcade-overlay">
            {finishError ? (
              <>
                <div className="pg-arcade-overlay__title">결과를 저장하지 못했어요</div>
                <p className="pg-arcade-overlay__hint">잠깐 연결이 불안했어요. 다시 시도하면 이번 점수와 보상이 기록돼요.</p>
                <button type="button" className="pg-arcade-btn" onClick={onRetryFinish}>다시 시도</button>
                <button type="button" className="pg-arcade-btn pg-arcade-btn--ghost" onClick={onQuit}>{returnLabel}</button>
              </>
            ) : (
              <div className="pg-arcade-overlay__title">결과 저장 중…</div>
            )}
          </div>
        )}

        {phase === 'result' && result && (
          <div className="pg-arcade-overlay">{result}</div>
        )}
      </div>
    </section>
  );
}
