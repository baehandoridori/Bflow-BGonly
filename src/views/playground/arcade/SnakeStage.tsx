import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ARCADE_BALANCE } from '@/features/playground/arcade/constants';
import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import { useArcadeStore, type ArcadeFinishInput } from '@/features/playground/arcade/useArcadeStore';
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
  const [starting, setStarting] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const startingRef = useRef(false); // 동기 가드 — 더블클릭이 첫 렌더 전에 두 번 실행되는 것 방지

  const engineRef = useRef<SnakeState | null>(null);
  const deadStateRef = useRef<SnakeState | null>(null); // 종료 시점 상태 — finishRun 실패 재시도용 보존
  const finishInputRef = useRef<ArcadeFinishInput | null>(null); // 종료 시 1회 고정 — 재시도도 같은 payload(멱등)
  const loopRef = useRef<FixedStepLoop | null>(null);
  const runIdRef = useRef<string | null>(null);
  // 실제 플레이 시간(ms)만 누적한다 — 일시정지·hidden/blur 동안은 스텝이 없어 자연히 제외된다.
  // wall-clock 을 쓰면 오래 멈춘 판이 duration 상한(4시간)을 넘어 game-finish 가 거부된다.
  const activePlayMsRef = useRef(0);
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
    // --pg-* 는 RGB 트리플릿(예: '26 29 39')이라 rgb(...) 로 감싸야 유효한 색이 된다.
    const color = (name: string, fallback: string): string => {
      const triplet = style.getPropertyValue(name).trim();
      return triplet ? `rgb(${triplet})` : fallback;
    };
    const bg = color('--pg-panel', '#1a1d27');
    const accent = color('--pg-accent', '#6c5ce7');
    const yellow = color('--pg-yellow', '#fdcb6e');
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

  // 종료 결과를 서버에 기록한다. game-finish 는 멱등이라, 실패하면 이탈하지 않고 재시도 상태를
  // 유지해(입장료·점수 보존) 사용자가 '다시 시도'로 같은 runId 로 재기록할 수 있게 한다.
  const finalize = useCallback(async () => {
    // 종료 시 고정한 payload 를 그대로 쓴다 — 재시도도 같은 request_id·같은 내용이어야 멱등 재생된다
    // (duration 을 재계산하면 fingerprint 가 달라 다른 요청으로 거부됨).
    const input = finishInputRef.current;
    if (!input) { onExit(); return; }
    setFinishError(false);
    setPhase('finishing');
    const finished = await finishRun(input);
    if (finished) {
      // 새로 해금된 도전과제는 토스트로도 알린다(sonner 는 앱 루트에 렌더).
      finished.unlockedAchievements.forEach((ach) => {
        toast(`도전과제 달성! ${ach.name} +${ach.bonusPoints}P`);
      });
      setResult(finished);
      setPhase('result');
    } else {
      setFinishError(true); // 실패 — 재시도 UI 유지(이탈하지 않는다)
    }
  }, [finishRun, onExit]);

  const beginLoop = useCallback(() => {
    engineRef.current = createSnakeGame(createSeed());
    activePlayMsRef.current = 0;
    setHud({ length: engineRef.current.length, golden: 0 });
    const loop = createFixedStepLoop({
      getStepMs: () => engineRef.current?.tickMs ?? 160,
      onStep: () => {
        const s = engineRef.current;
        // 이미 죽었으면 무시 — 한 프레임의 catch-up 스텝이 stop() 뒤에도 이어져 finalize 가 중복되는 것을 막는다.
        if (!s || s.status !== 'running') return;
        activePlayMsRef.current += s.tickMs; // 이번 스텝이 소비한 활성 게임 시간
        const next = stepSnake(s);
        engineRef.current = next;
        if (next.status === 'dead') {
          loopRef.current?.stop();
          deadStateRef.current = next;
          // 종료 payload 를 이 시점에 1회 고정(재시도도 동일 request_id·내용으로 멱등 재생).
          // duration 은 활성 플레이 시간을 유효 범위(1s~4h)로 클램프한다.
          if (runIdRef.current) {
            finishInputRef.current = {
              runId: runIdRef.current,
              gameId: 'snake',
              score: next.length,
              durationMs: Math.min(14_400_000, Math.max(1000, Math.round(activePlayMsRef.current))),
              meta: { goldenEaten: next.goldenEaten },
            };
          }
          void finalize();
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
    if (startingRef.current) return; // 진행 중이면 무시 — 입장료 중복 차감 방지
    startingRef.current = true;
    setStarting(true);
    try {
      const started = await startRun('snake');
      if (!started) return; // 잔액 부족 등 — 스토어가 에러 처리
      runIdRef.current = started.runId;
      setResult(null);
      setPhase('countdown');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [startRun]);

  const handleReplay = useCallback(() => {
    runIdRef.current = null;
    engineRef.current = null;
    deadStateRef.current = null;
    finishInputRef.current = null;
    setResult(null);
    setFinishError(false);
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
      onPause={() => loopRef.current?.pause()}
      onQuit={handleQuit}
      onCountdownComplete={beginLoop}
      finishError={finishError}
      onRetryFinish={() => void finalize()}
      startDisabledReason={startDisabledReason}
      startPending={starting}
      todayRewardedRuns={todayRewardedRuns}
      entryFee={entryFee}
      dailyRewardCap={ARCADE_BALANCE.dailyRewardedRunsCap}
      keyHints={KEY_HINTS}
    />
  );
}
