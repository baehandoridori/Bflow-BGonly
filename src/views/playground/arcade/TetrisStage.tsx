import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
import { gradeProgress } from '@/features/playground/arcade/domain';
import { ArcadeStageChrome, type ArcadeStagePhase } from './ArcadeStageChrome';
import { RunResultOverlay } from './RunResultOverlay';
import { drawNeonCell, drawNeonOutline, paintNeonBackground } from './neonBoard';

const CELL = 24;
const STEP_MS = 16; // 시뮬레이션 고정 스텝(≈62fps). tickTetris·DAS 클록의 단위.
const VISIBLE_ROWS = TETRIS_ROWS - TETRIS_HIDDEN_ROWS;
const NEXT_PREVIEW = 5;

interface TetrisHud {
  score: number;
  level: number;
  lines: number;
  combo: number;
  hold: TetrisPiece | null;
  next: TetrisPiece[];
}

const EMPTY_HUD: TetrisHud = { score: 0, level: 1, lines: 0, combo: 0, hold: null, next: [] };

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
  // hold·next 도 HUD 상태에 포함한다 — 이들은 점수 변화 없이(홀드 스왑·조각 락) 바뀌므로
  // score/level/lines/combo 만 보고 리렌더하면 홀드/넥스트 칩이 stale 로 남는다.
  const [hud, setHud] = useState<TetrisHud>(EMPTY_HUD);
  const [starting, setStarting] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const engineRef = useRef<TetrisState | null>(null);
  const deadStateRef = useRef<TetrisState | null>(null);
  const finishedRef = useRef(false); // 이 판을 이미 마감(finalize)했는지 — onStep·키입력 양쪽에서 한 번만 실행되게 가드
  const finishInputRef = useRef<ArcadeFinishInput | null>(null);
  const activePlayMsRef = useRef(0); // 시뮬레이션 클록(활성 시간만 — 일시정지/hidden 제외)
  const hudRef = useRef<TetrisHud>(EMPTY_HUD);
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
    const colorA = (name: string, alpha: number, fallback: string): string => {
      const triplet = style.getPropertyValue(name).trim();
      return triplet ? `rgb(${triplet} / ${alpha})` : fallback;
    };
    const bg = color('--pg-bg', '#0f1117');
    const grid = colorA('--pg-line', 0.32, 'rgba(45,48,65,.32)');
    paintNeonBackground(ctx, canvas.width, canvas.height, CELL, bg, grid);
    const cellColor = (piece: TetrisPiece) => color(`--pg-${PIECE_TONE[piece]}`, '#6c5ce7');
    const visible = (boardY: number) => boardY - TETRIS_HIDDEN_ROWS >= 0;
    const px = (x: number) => x * CELL;
    const py = (boardY: number) => (boardY - TETRIS_HIDDEN_ROWS) * CELL;
    // 쌓인 블록 — 네온 픽셀
    for (let y = 0; y < TETRIS_ROWS; y += 1) {
      for (let x = 0; x < TETRIS_COLS; x += 1) {
        const cell = s.board[y][x];
        if (cell && visible(y)) drawNeonCell(ctx, px(x), py(y), CELL, cellColor(cell), { glow: CELL * 0.42 });
      }
    }
    // 고스트(착지 자리) — 채움 없는 네온 윤곽
    tetrisPieceCells(tetrisGhost(s)).forEach((c) => {
      if (visible(c.y)) drawNeonOutline(ctx, px(c.x), py(c.y), CELL, cellColor(s.active.piece));
    });
    // 현재 조각 — 더 강한 글로우
    tetrisPieceCells(s.active).forEach((c) => {
      if (visible(c.y)) drawNeonCell(ctx, px(c.x), py(c.y), CELL, cellColor(s.active.piece), { glow: CELL * 0.5 });
    });
  }, []);

  const syncHud = useCallback((s: TetrisState) => {
    const combo = Math.max(0, s.combo);
    const next = s.queue.slice(0, NEXT_PREVIEW);
    const prev = hudRef.current;
    if (
      s.score !== prev.score || s.level !== prev.level
      || s.lines !== prev.lines || combo !== prev.combo
      || s.hold !== prev.hold || next.join(',') !== prev.next.join(',')
    ) {
      hudRef.current = { score: s.score, level: s.level, lines: s.lines, combo, hold: s.hold, next };
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
    // 루프를 멈추기 전에 최종 상태로 HUD 를 맞춘다 — 키입력 사망(하드드롭)은 다음 onFrame 이
    // 오기 전에 멈추므로, 이걸 안 하면 결과 화면 점수가 저장 점수보다 낮게 보인다.
    syncHud(dead);
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
  }, [finalize, syncHud]);

  const beginLoop = useCallback(() => {
    engineRef.current = createTetrisGame(createSeed());
    activePlayMsRef.current = 0;
    finishedRef.current = false;
    repeaterRef.current.reset();
    hudRef.current = EMPTY_HUD;
    setHud(EMPTY_HUD);
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
    // 눌려 있던 좌우 DAS·소프트드롭 상태를 비운다. 확인창/블러/탭 전환처럼 keyup 을 못 받는 상황에서
    // 이걸 안 하면 복귀 후 조각이 저절로 움직이거나 계속 빨리 떨어진다.
    const clearHeldKeys = (): void => {
      repeaterRef.current.reset();
      const s = engineRef.current;
      if (s) engineRef.current = applyTetrisInput(s, 'softDropOff');
    };
    if (confirmOpen) {
      clearHeldKeys();
      return;
    }
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
    // 창이 포커스를 잃거나(alt-tab) 탭이 숨으면 keyup 이 다른 창으로 가버려 눌린 키 상태가 남는다.
    // 루프는 공용 loop 의 blur 처리로 멈추지만, 입력 상태는 여기서 함께 비워야 복귀 시 안 움직인다.
    const onBlur = (): void => clearHeldKeys();
    const onVisibility = (): void => { if (document.hidden) clearHeldKeys(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase, confirmOpen, finalizeDead]);

  useEffect(() => () => loopRef.current?.stop(), []);

  const pieceChip = (piece: TetrisPiece | null, key: string) => (
    <span
      key={key}
      className={`pg-arcade-piece-chip${piece ? ' pg-arcade-piece-chip--filled' : ''}`}
      style={piece
        ? ({ background: `rgb(var(--pg-${PIECE_TONE[piece]}))`, '--pg-chip-glow': `rgb(var(--pg-${PIECE_TONE[piece]}))` } as CSSProperties)
        : { background: 'transparent' }}
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
    </>
  );

  // 보드 옆 사이드보드: 홀드 + 다음 5개
  const sideboard = (
    <div className="pg-arcade-sideboard">
      <div className="pg-arcade-side-box"><div className="pg-arcade-side-box__label">홀드</div>{pieceChip(hud.hold, 'hold')}</div>
      <div className="pg-arcade-side-box">
        <div className="pg-arcade-side-box__label">다음</div>
        <span className="pg-arcade-piece-next">{hud.next.map((p, i) => pieceChip(p, `next-${i}`))}</span>
      </div>
    </div>
  );

  return (
    <ArcadeStageChrome
      game={game}
      phase={phase}
      hud={hud_}
      eyebrow="FALLING BLOCKS · ENDLESS"
      accentToken="--pg-blue"
      gradeProgress={gradeProgress('tetris', hud.score)}
      stage={(
        <div className="pg-arcade-boardwrap">
          <canvas ref={canvasRef} className="pg-arcade-board" width={TETRIS_COLS * CELL} height={VISIBLE_ROWS * CELL} style={{ maxWidth: '100%', height: 'auto' }} aria-hidden />
          {sideboard}
        </div>
      )}
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
