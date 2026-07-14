import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ARCADE_BALANCE } from '@/features/playground/arcade/constants';
import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import { useArcadeStore, type ArcadeFinishInput } from '@/features/playground/arcade/useArcadeStore';
import type { ArcadeFinishResult } from '@/features/playground/arcade/types';
import {
  createTetrisGame,
  applyTetrisInput,
  tickTetris,
  tetrisPieceCells,
  tetrisGhost,
} from '@/features/playground/arcade/games/tetris/engine';
import { PIECE_TONE } from '@/features/playground/arcade/games/tetris/pieces';
import {
  TETRIS_COLS,
  TETRIS_HIDDEN_ROWS,
  TETRIS_ROWS,
  type TetrisPiece,
  type TetrisState,
} from '@/features/playground/arcade/games/tetris/types';
import { createFixedStepLoop, type FixedStepLoop } from '@/features/playground/arcade/games/loop';
import { createHorizontalRepeater } from '@/features/playground/arcade/games/keymap';
import { createSeed } from '@/features/playground/arcade/games/prng';
import { ArcadeStageChrome, type ArcadeStagePhase } from './ArcadeStageChrome';
import { RunResultOverlay } from './RunResultOverlay';

const CELL = 24;
const STEP_MS = 16; // 시뮬레이션 고정 스텝(≈62fps). tickTetris·DAS 클록의 단위.
const VISIBLE_ROWS = TETRIS_ROWS - TETRIS_HIDDEN_ROWS;

const KEY_HINTS = [
  { key: '← →', label: '이동' },
  { key: '↓', label: '소프트' },
  { key: 'Space', label: '하드' },
  { key: 'Z / X', label: '회전' },
  { key: 'C', label: '홀드' },
  { key: 'P', label: '일시정지' },
] as const;

export function TetrisStage({ onExit, returnLabel }: { onExit: () => void; returnLabel: string }) {
  const snapshot = useArcadeStore((s) => s.snapshot);
  const startRun = useArcadeStore((s) => s.startRun);
  const finishRun = useArcadeStore((s) => s.finishRun);

  const [phase, setPhase] = useState<ArcadeStagePhase>('ready');
  const [result, setResult] = useState<ArcadeFinishResult | null>(null);
  const [hud, setHud] = useState({ score: 0, level: 1, lines: 0, combo: 0 });
  const [starting, setStarting] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const engineRef = useRef<TetrisState | null>(null);
  const deadStateRef = useRef<TetrisState | null>(null);
  const finishedRef = useRef(false); // 이 판을 이미 마감(finalize)했는지 — onStep·키입력 양쪽에서 한 번만 실행되게 가드
  const finishInputRef = useRef<ArcadeFinishInput | null>(null);
  const activePlayMsRef = useRef(0); // 시뮬레이션 클록(활성 시간만 — 일시정지/hidden 제외)
  const hudRef = useRef({ score: 0, level: 1, lines: 0, combo: 0 });
  const loopRef = useRef<FixedStepLoop | null>(null);
  const runIdRef = useRef<string | null>(null);
  const repeaterRef = useRef(createHorizontalRepeater());
  const startingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const game = GAME_DEFINITIONS.tetris;
  const stats = snapshot?.games.tetris;
  const entryFee = ARCADE_BALANCE.games.tetris.entryFee;
  const myBest = stats?.myBestScore ?? 0;
  const todayRewardedRuns = stats?.todayRewardedRuns ?? 0;
  const walletPoints = snapshot?.wallet.walletPoints ?? 0;
  const startDisabledReason = walletPoints < entryFee ? `포인트가 부족해요 (지금 ${walletPoints}P)` : undefined;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const s = engineRef.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(canvas);
    const color = (name: string, fallback: string): string => {
      const triplet = style.getPropertyValue(name).trim();
      return triplet ? `rgb(${triplet})` : fallback;
    };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color('--pg-panel', '#1a1d27');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const drawCell = (x: number, boardY: number, piece: TetrisPiece, alpha: number): void => {
      const vy = boardY - TETRIS_HIDDEN_ROWS;
      if (vy < 0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color(`--pg-${PIECE_TONE[piece]}`, '#6c5ce7');
      ctx.fillRect(x * CELL + 1, vy * CELL + 1, CELL - 2, CELL - 2);
      ctx.globalAlpha = 1;
    };
    for (let y = 0; y < TETRIS_ROWS; y += 1) {
      for (let x = 0; x < TETRIS_COLS; x += 1) {
        const cell = s.board[y][x];
        if (cell) drawCell(x, y, cell, 1);
      }
    }
    tetrisPieceCells(tetrisGhost(s)).forEach((c) => drawCell(c.x, c.y, s.active.piece, 0.25)); // 고스트
    tetrisPieceCells(s.active).forEach((c) => drawCell(c.x, c.y, s.active.piece, 1));
  }, []);

  const syncHud = useCallback((s: TetrisState) => {
    const combo = Math.max(0, s.combo);
    if (
      s.score !== hudRef.current.score || s.level !== hudRef.current.level
      || s.lines !== hudRef.current.lines || combo !== hudRef.current.combo
    ) {
      hudRef.current = { score: s.score, level: s.level, lines: s.lines, combo };
      setHud(hudRef.current);
    }
  }, []);

  const finalize = useCallback(async () => {
    const input = finishInputRef.current;
    if (!input) { onExit(); return; }
    setFinishError(false);
    setPhase('finishing');
    const finished = await finishRun(input);
    if (finished) {
      finished.unlockedAchievements.forEach((ach) => toast(`도전과제 달성! ${ach.name} +${ach.bonusPoints}P`));
      setResult(finished);
      setPhase('result');
    } else {
      setFinishError(true);
    }
  }, [finishRun, onExit]);

  // 판 종료 처리 — onStep(중력·자동이동 락)과 키입력(하드드롭·홀드 락)이 둘 다 죽음을 만들 수 있어
  // 한 곳으로 모으고 finishedRef 로 정확히 한 번만 실행한다. 사망 시점의 점수·통계를 payload 로 고정한다.
  const finalizeDead = useCallback((dead: TetrisState) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    loopRef.current?.stop();
    deadStateRef.current = dead;
    if (runIdRef.current) {
      finishInputRef.current = {
        runId: runIdRef.current,
        gameId: 'tetris',
        score: dead.score,
        durationMs: Math.min(14_400_000, Math.max(1000, Math.round(activePlayMsRef.current))),
        meta: { lines: dead.lines, levelReached: dead.stats.levelReached, maxLineClear: dead.stats.maxLineClear },
      };
    }
    void finalize();
  }, [finalize]);

  const beginLoop = useCallback(() => {
    engineRef.current = createTetrisGame(createSeed());
    activePlayMsRef.current = 0;
    finishedRef.current = false;
    repeaterRef.current.reset();
    hudRef.current = { score: 0, level: 1, lines: 0, combo: 0 };
    setHud(hudRef.current);
    const loop = createFixedStepLoop({
      getStepMs: () => STEP_MS,
      onStep: () => {
        let s = engineRef.current;
        if (!s || s.status !== 'running') return;
        activePlayMsRef.current += STEP_MS;
        s = tickTetris(s, STEP_MS);
        const moves = repeaterRef.current.advance(activePlayMsRef.current);
        const dir = repeaterRef.current.activeDir();
        for (let i = 0; i < moves && s.status === 'running'; i += 1) {
          s = applyTetrisInput(s, dir === -1 ? 'left' : 'right');
        }
        engineRef.current = s;
        if (s.status === 'dead') finalizeDead(s);
      },
      onFrame: () => {
        draw();
        const s = engineRef.current;
        if (s) syncHud(s);
      },
    });
    loopRef.current = loop;
    loop.start();
    setPhase('running');
  }, [draw, finalize, finalizeDead, syncHud]);

  const handleStart = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      const started = await startRun('tetris');
      if (!started) {
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
    finishedRef.current = false;
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

  // 키 입력: DAS/ARR 좌우, 소프트/하드/회전/홀드/일시정지.
  useEffect(() => {
    if (phase !== 'running' && phase !== 'paused') return;
    if (confirmOpen) return;
    const apply = (input: Parameters<typeof applyTetrisInput>[1]): void => {
      const s = engineRef.current;
      if (!s) return;
      const next = applyTetrisInput(s, input);
      engineRef.current = next;
      // 하드드롭·홀드로 조각이 락되며 스폰이 막히면(블록아웃) 여기서 바로 죽는다.
      // onStep 은 다음 프레임에 running 이 아니라 조기 return 하므로, 입력이 만든 죽음은 여기서 마감한다.
      if (next.status === 'dead') finalizeDead(next);
    };
    const onKey = (e: KeyboardEvent): void => {
      const now = activePlayMsRef.current;
      if (phase === 'running') {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          if (e.repeat) return;
          if (repeaterRef.current.press(-1, now) > 0) apply('left');
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          if (e.repeat) return;
          if (repeaterRef.current.press(1, now) > 0) apply('right');
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
          e.preventDefault();
          if (e.repeat) return;
          apply('softDropOn');
          return;
        }
        if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); if (!e.repeat) apply('hardDrop'); return; }
        if (e.key === 'ArrowUp' || e.key === 'x' || e.key === 'X') { e.preventDefault(); if (!e.repeat) apply('rotateCw'); return; }
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (!e.repeat) apply('rotateCcw'); return; }
        if (e.key === 'c' || e.key === 'C') { e.preventDefault(); if (!e.repeat) apply('hold'); return; }
      }
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        if (e.repeat) return;
        if (phase === 'running') { loopRef.current?.pause(); setPhase('paused'); }
        else { loopRef.current?.resume(); setPhase('running'); }
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      const now = activePlayMsRef.current;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') repeaterRef.current.release(-1, now);
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') repeaterRef.current.release(1, now);
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') apply('softDropOff');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [phase, confirmOpen, finalizeDead]);

  useEffect(() => () => loopRef.current?.stop(), []);

  const pieceChip = (piece: TetrisPiece | null, key: string) => (
    <span
      key={key}
      className="pg-arcade-piece-chip"
      style={{ background: piece ? `rgb(var(--pg-${PIECE_TONE[piece]}))` : 'transparent' }}
    >
      {piece ?? '·'}
    </span>
  );

  const hud_ = (
    <>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">점수</span><span className="pg-arcade-hud__value">{hud.score.toLocaleString('ko-KR')}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">레벨</span><span className="pg-arcade-hud__value">{hud.level}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">라인</span><span className="pg-arcade-hud__value">{hud.lines}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">콤보</span><span className="pg-arcade-hud__value">{hud.combo}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">내 최고</span><span className="pg-arcade-hud__value">{myBest.toLocaleString('ko-KR')}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">홀드</span>{pieceChip(engineRef.current?.hold ?? null, 'hold')}</div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">다음</span><span className="pg-arcade-piece-next">{(engineRef.current?.queue ?? []).slice(0, 5).map((p, i) => pieceChip(p, `next-${i}`))}</span></div>
    </>
  );

  return (
    <ArcadeStageChrome
      game={game}
      phase={phase}
      hud={hud_}
      stage={<canvas ref={canvasRef} width={TETRIS_COLS * CELL} height={VISIBLE_ROWS * CELL} style={{ display: 'block', margin: '0 auto', maxWidth: '100%', height: 'auto' }} aria-hidden />}
      result={result ? (
        <RunResultOverlay
          gameId="tetris"
          result={result}
          scoreLabel={`${hud.score.toLocaleString('ko-KR')}점`}
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
