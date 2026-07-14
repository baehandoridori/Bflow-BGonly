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
import { gradeProgress } from '@/features/playground/arcade/domain';
import { ArcadeStageChrome, type ArcadeStagePhase } from './ArcadeStageChrome';
import { RunResultOverlay } from './RunResultOverlay';
import { drawNeonCell, drawNeonDot, paintNeonBackground } from './neonBoard';

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

export function SnakeStage({ onExit, returnLabel }: { onExit: () => void; returnLabel: string }) {
  const snapshot = useArcadeStore((s) => s.snapshot);
  const startRun = useArcadeStore((s) => s.startRun);
  const finishRun = useArcadeStore((s) => s.finishRun);

  const [phase, setPhase] = useState<ArcadeStagePhase>('ready');
  const [result, setResult] = useState<ArcadeFinishResult | null>(null);
  const [hud, setHud] = useState({ length: 4, golden: 0 });
  const [starting, setStarting] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false); // 종료 확인 모달 표시 중 — 게임 입력 차단
  const [startError, setStartError] = useState<string | null>(null); // 시작 실패 안내(재시도 유도)
  const startingRef = useRef(false); // 동기 가드 — 더블클릭이 첫 렌더 전에 두 번 실행되는 것 방지

  const engineRef = useRef<SnakeState | null>(null);
  const deadStateRef = useRef<SnakeState | null>(null); // 종료 시점 상태 — finishRun 실패 재시도용 보존
  const finishInputRef = useRef<ArcadeFinishInput | null>(null); // 종료 시 1회 고정 — 재시도도 같은 payload(멱등)
  const loopRef = useRef<FixedStepLoop | null>(null);
  const runIdRef = useRef<string | null>(null);
  // 실제 플레이 시간(ms)만 누적한다 — 일시정지·hidden/blur 동안은 스텝이 없어 자연히 제외된다.
  // wall-clock 을 쓰면 오래 멈춘 판이 duration 상한(4시간)을 넘어 game-finish 가 거부된다.
  const activePlayMsRef = useRef(0);
  const hudRef = useRef({ length: 4, golden: 0 }); // 마지막 HUD 값 — 변할 때만 setHud(매 프레임 리렌더 방지)
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
    const colorA = (name: string, alpha: number, fallback: string): string => {
      const triplet = style.getPropertyValue(name).trim();
      return triplet ? `rgb(${triplet} / ${alpha})` : fallback;
    };
    const bg = color('--pg-bg', '#0f1117');
    const grid = colorA('--pg-line', 0.32, 'rgba(45,48,65,.32)');
    const green = color('--pg-green', '#00b894');
    const mint = color('--pg-mint', '#45e0b5');
    const yellow = color('--pg-yellow', '#fdcb6e');
    paintNeonBackground(ctx, canvas.width, canvas.height, CELL, bg, grid);
    // 사과 — 둥근 네온 비콘(골든=노랑, 일반=붉은 네온)
    const apple = s.apple;
    drawNeonDot(ctx, apple.pos.x * CELL, apple.pos.y * CELL, CELL, apple.golden ? yellow : '#ff6b81');
    // 몸통(초록) 먼저, 머리(민트·더 밝은 글로우) 나중에 위로.
    s.body.forEach((p, i) => {
      if (i === 0) return;
      drawNeonCell(ctx, p.x * CELL, p.y * CELL, CELL, green, { glow: CELL * 0.42 });
    });
    const head = s.body[0];
    if (head) drawNeonCell(ctx, head.x * CELL, head.y * CELL, CELL, mint, { glow: CELL * 0.7 });
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
    hudRef.current = { length: engineRef.current.length, golden: 0 };
    setHud(hudRef.current);
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
        // HUD 는 값이 바뀔 때(사과 취식)만 갱신한다 — 매 프레임 setHud 로 리렌더가 쌓이지 않게.
        const s = engineRef.current;
        if (s && (s.length !== hudRef.current.length || s.goldenEaten !== hudRef.current.golden)) {
          hudRef.current = { length: s.length, golden: s.goldenEaten };
          setHud(hudRef.current);
        }
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
    setStartError(null);
    try {
      const started = await startRun('snake');
      if (!started) {
        // 실패를 화면에 알린다 — 유료 시작이 조용히 방치되지 않게(다시 시작하면 같은 runId 로 멱등 재시도).
        setStartError(useArcadeStore.getState().error ?? '게임을 시작하지 못했어요. 다시 시도해 주세요.');
        return;
      }
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
    setStartError(null);
    setPhase('ready');
  }, []);

  const handleQuit = useCallback(() => {
    loopRef.current?.stop();
    onExit();
  }, [onExit]);

  // 키 입력: 방향(화살표+WASD, preventDefault), P/Esc 일시정지·재개.
  useEffect(() => {
    if (phase !== 'running' && phase !== 'paused') return;
    if (confirmOpen) return; // 종료 확인 모달이 떠 있으면 게임 키 입력을 처리하지 않는다
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'running' && KEY_TO_DIR[e.key]) {
        e.preventDefault();
        if (e.repeat) return; // 키 홀드 반복 이벤트는 방향 큐(2칸)를 중복으로 채우지 않는다
        const s = engineRef.current;
        if (s) engineRef.current = enqueueDirection(s, KEY_TO_DIR[e.key]);
        return;
      }
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        if (e.repeat) return; // 홀드 반복으로 일시정지 토글이 연타되지 않게
        if (phase === 'running') { loopRef.current?.pause(); setPhase('paused'); }
        else { loopRef.current?.resume(); setPhase('running'); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, confirmOpen]);

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
      eyebrow="GROW & SURVIVE"
      accentToken="--pg-green"
      gradeProgress={gradeProgress('snake', hud.length)}
      stage={<canvas ref={canvasRef} className="pg-arcade-board" width={GRID * CELL} height={GRID * CELL} style={{ width: '100%', maxWidth: GRID * CELL, aspectRatio: '1 / 1' }} aria-hidden />}
      result={result ? (
        <RunResultOverlay
          gameId="snake"
          result={result}
          scoreLabel={`길이 ${hud.length}`}
          onReplay={handleReplay}
          onExit={onExit}
          replayDisabledReason={startDisabledReason}
          returnLabel={returnLabel}
        />
      ) : undefined}
      onStart={handleStart}
      onResume={() => { loopRef.current?.resume(); setPhase('running'); }}
      onPause={() => loopRef.current?.pause()}
      onQuit={handleQuit}
      onCountdownComplete={beginLoop}
      finishError={finishError}
      onRetryFinish={() => void finalize()}
      onConfirmingChange={setConfirmOpen}
      returnLabel={returnLabel}
      startDisabledReason={startDisabledReason}
      startErrorHint={startError}
      startPending={starting}
      todayRewardedRuns={todayRewardedRuns}
      entryFee={entryFee}
      dailyRewardCap={ARCADE_BALANCE.dailyRewardedRunsCap}
      keyHints={KEY_HINTS}
    />
  );
}
