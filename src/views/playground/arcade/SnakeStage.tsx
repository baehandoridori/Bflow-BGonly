import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ARCADE_BALANCE } from '@/features/playground/arcade/constants';
import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import { useArcadeStore } from '@/features/playground/arcade/useArcadeStore';
import type { ArcadeFinishResult } from '@/features/playground/arcade/types';
import {
  createSnakeGame,
  enqueueDirection,
  stepSnake,
} from '@/features/playground/arcade/games/snake/engine';
import type { SnakeDirection, SnakeState } from '@/features/playground/arcade/games/snake/types';
import { createFixedStepLoop, type FixedStepLoop } from '@/features/playground/arcade/games/loop';
import { createSeed } from '@/features/playground/arcade/games/prng';
import { ArcadeStageChrome, type ArcadeStagePhase } from './ArcadeStageChrome';
import { RunResultOverlay } from './RunResultOverlay';

const CELL = 20;
const GRID = 21;

const KEY_TO_DIR: Record<string, SnakeDirection> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

const KEY_HINTS = [
  { key: '← ↑ ↓ →', label: '이동' },
  { key: 'WASD', label: '이동' },
  { key: 'P', label: '일시정지' },
] as const;

export function SnakeStage({ onExit }: { onExit: () => void }) {
  const snapshot = useArcadeStore((s) => s.snapshot);
  const startRun = useArcadeStore((s) => s.startRun);
  const finishRun = useArcadeStore((s) => s.finishRun);

  const [phase, setPhase] = useState<ArcadeStagePhase>('ready');
  const [result, setResult] = useState<ArcadeFinishResult | null>(null);
  const [hud, setHud] = useState({ length: 4, golden: 0 });

  const engineRef = useRef<SnakeState | null>(null);
  const loopRef = useRef<FixedStepLoop | null>(null);
  const runIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const game = GAME_DEFINITIONS.snake;
  const stats = snapshot?.games.snake;
  const entryFee = ARCADE_BALANCE.games.snake.entryFee;
  const myBest = stats?.myBestScore ?? 0;
  const todayRewardedRuns = stats?.todayRewardedRuns ?? 0;
  const walletPoints = snapshot?.wallet.walletPoints ?? 0;
  const startDisabledReason = walletPoints < entryFee
    ? `포인트가 부족해요 (지금 ${walletPoints}P)`
    : undefined;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const s = engineRef.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(canvas);
    const bg = style.getPropertyValue('--pg-panel') || '#1a1d27';
    const accent = style.getPropertyValue('--pg-accent') || '#6c5ce7';
    const yellow = style.getPropertyValue('--pg-yellow') || '#fdcb6e';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 사과
    const apple = s.apple;
    ctx.fillStyle = apple.golden ? yellow : '#e17055';
    ctx.fillRect(apple.pos.x * CELL + 3, apple.pos.y * CELL + 3, CELL - 6, CELL - 6);
    // 몸
    s.body.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? '#ffffff' : accent;
      ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, []);

  const finalize = useCallback(async (dead: SnakeState) => {
    setPhase('finishing');
    const runId = runIdRef.current;
    if (!runId) { onExit(); return; }
    const finished = await finishRun({
      runId,
      gameId: 'snake',
      score: dead.length,
      durationMs: Math.max(1000, Math.round(performance.now() - startedAtRef.current)),
      meta: { goldenEaten: dead.goldenEaten },
    });
    if (finished) {
      // 새로 해금된 도전과제는 토스트로도 알린다(sonner 는 앱 루트에 렌더).
      finished.unlockedAchievements.forEach((ach) => {
        toast(`도전과제 달성! ${ach.name} +${ach.bonusPoints}P`);
      });
      setResult(finished);
      setPhase('result');
    } else {
      onExit();
    }
  }, [finishRun, onExit]);

  const beginLoop = useCallback(() => {
    engineRef.current = createSnakeGame(createSeed());
    startedAtRef.current = performance.now();
    setHud({ length: engineRef.current.length, golden: 0 });
    const loop = createFixedStepLoop({
      getStepMs: () => engineRef.current?.tickMs ?? 160,
      onStep: () => {
        const s = engineRef.current;
        if (!s) return;
        const next = stepSnake(s);
        engineRef.current = next;
        if (next.status === 'dead') {
          loopRef.current?.stop();
          void finalize(next);
        }
      },
      onFrame: () => {
        draw();
        const s = engineRef.current;
        if (s) setHud({ length: s.length, golden: s.goldenEaten });
      },
    });
    loopRef.current = loop;
    loop.start();
    setPhase('running');
  }, [draw, finalize]);

  const handleStart = useCallback(async () => {
    const started = await startRun('snake');
    if (!started) return; // 잔액 부족 등 — 스토어가 에러 처리
    runIdRef.current = started.runId;
    setResult(null);
    setPhase('countdown');
  }, [startRun]);

  const handleReplay = useCallback(() => {
    runIdRef.current = null;
    engineRef.current = null;
    setResult(null);
    setPhase('ready');
  }, []);

  const handleQuit = useCallback(() => {
    loopRef.current?.stop();
    onExit();
  }, [onExit]);

  // 키 입력: 방향(화살표+WASD, preventDefault), P/Esc 일시정지·재개.
  useEffect(() => {
    if (phase !== 'running' && phase !== 'paused') return;
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'running' && KEY_TO_DIR[e.key]) {
        e.preventDefault();
        const s = engineRef.current;
        if (s) engineRef.current = enqueueDirection(s, KEY_TO_DIR[e.key]);
        return;
      }
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        if (phase === 'running') { loopRef.current?.pause(); setPhase('paused'); }
        else { loopRef.current?.resume(); setPhase('running'); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // 언마운트 시 루프 정리.
  useEffect(() => () => loopRef.current?.stop(), []);

  const hud_ = (
    <>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">길이</span><span className="pg-arcade-hud__value">{hud.length}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">골든</span><span className="pg-arcade-hud__value">{hud.golden}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">내 최고</span><span className="pg-arcade-hud__value">{myBest}</span></div>
    </>
  );

  return (
    <ArcadeStageChrome
      game={game}
      phase={phase}
      hud={hud_}
      stage={<canvas ref={canvasRef} width={GRID * CELL} height={GRID * CELL} style={{ display: 'block', width: '100%', maxWidth: GRID * CELL, margin: '0 auto', aspectRatio: '1 / 1' }} aria-hidden />}
      result={result ? (
        <RunResultOverlay
          gameId="snake"
          result={result}
          scoreLabel={`길이 ${hud.length}`}
          onReplay={handleReplay}
          onExit={onExit}
          replayDisabledReason={startDisabledReason}
        />
      ) : undefined}
      onStart={handleStart}
      onResume={() => { loopRef.current?.resume(); setPhase('running'); }}
      onQuit={handleQuit}
      onCountdownComplete={beginLoop}
      startDisabledReason={startDisabledReason}
      todayRewardedRuns={todayRewardedRuns}
      entryFee={entryFee}
      dailyRewardCap={ARCADE_BALANCE.dailyRewardedRunsCap}
      keyHints={KEY_HINTS}
    />
  );
}
