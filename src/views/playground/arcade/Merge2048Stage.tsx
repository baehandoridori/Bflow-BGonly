import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';

import { ARCADE_BALANCE } from '@/features/playground/arcade/constants';
import { gradeProgress } from '@/features/playground/arcade/domain';
import {
  apply2048Move,
  create2048State,
  impactTier2048,
} from '@/features/playground/arcade/games/merge2048/engine';
import type {
  Direction2048,
  ImpactTier2048,
  MoveResult2048,
  State2048,
  TileMotion2048,
} from '@/features/playground/arcade/games/merge2048/types';
import { createSeed, nextRandom } from '@/features/playground/arcade/games/prng';
import type { ArcadeFinishResult } from '@/features/playground/arcade/types';
import { useArcadeStore, type ArcadeFinishInput } from '@/features/playground/arcade/useArcadeStore';
import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import { ArcadeStageChrome, type ArcadeStagePhase } from './ArcadeStageChrome';
import { RunResultOverlay } from './RunResultOverlay';

const MOVE_MS = 150;
const SPAWN_MS = 190;
const MERGE_MS = 270;
const SWIPE_THRESHOLD = 24;

const IMPACT_MS: Record<Exclude<ImpactTier2048, 'none'>, number> = {
  soft: 190,
  medium: 250,
  heavy: 340,
};

const KEY_TO_DIRECTION: Record<string, Direction2048> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

const KEY_HINTS = [
  { key: '← ↑ ↓ →', label: '합치기' },
  { key: 'WASD', label: '합치기' },
  { key: 'Swipe', label: '합치기' },
  { key: 'P', label: '일시정지' },
] as const;

interface DisplayState2048 {
  readonly board: readonly number[];
  readonly score: number;
  readonly maxTile: number;
}

interface PendingPresentation {
  readonly kind: 'move' | 'impact';
  readonly durationMs: number;
  remainingMs: number;
  startedAt: number;
  timer: number | null;
  readonly action: () => void;
}

interface GameWindow extends Window {
  render_game_to_text?: () => string;
  advanceTime?: (ms: number) => void;
}

const EMPTY_DISPLAY: DisplayState2048 = {
  board: Array<number>(16).fill(0),
  score: 0,
  maxTile: 0,
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('button, input, textarea, select, [contenteditable="true"]') !== null;
}

function tileTone(value: number): string {
  if (value <= 4) return 'low';
  if (value <= 16) return 'warm';
  if (value <= 64) return 'bright';
  if (value <= 256) return 'hot';
  if (value <= 1024) return 'super';
  return 'legend';
}

function axisShift(delta: number): string {
  if (delta === 0) return '0px';
  const sign = delta > 0 ? '+' : '-';
  const gaps = Array.from({ length: Math.abs(delta) }, () => ` ${sign} var(--pg-2048-gap)`).join('');
  return `calc(${delta * 100}%${gaps})`;
}

function motionStyle(motion: TileMotion2048): CSSProperties {
  const fromRow = Math.floor(motion.from / 4);
  const fromColumn = motion.from % 4;
  const toRow = Math.floor(motion.to / 4);
  const toColumn = motion.to % 4;
  return {
    gridColumn: fromColumn + 1,
    gridRow: fromRow + 1,
    '--pg-2048-shift-x': axisShift(toColumn - fromColumn),
    '--pg-2048-shift-y': axisShift(toRow - fromRow),
  } as CSSProperties;
}

function boardAriaLabel(board: readonly number[]): string {
  return `4×4 2048 보드. 행 우선 좌표: ${board.map((value, index) => (
    `${Math.floor(index / 4) + 1}행 ${index % 4 + 1}열 ${value || '빈칸'}`
  )).join(', ')}`;
}

export function Merge2048Stage({ onExit, returnLabel }: { onExit: () => void; returnLabel: string }) {
  const snapshot = useArcadeStore((state) => state.snapshot);
  const startRun = useArcadeStore((state) => state.startRun);
  const finishRun = useArcadeStore((state) => state.finishRun);
  const prefersReducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<ArcadeStagePhase>('ready');
  const [displayState, setDisplayState] = useState<DisplayState2048>(EMPTY_DISPLAY);
  const [motions, setMotions] = useState<readonly TileMotion2048[]>([]);
  const [mergedIndices, setMergedIndices] = useState<readonly number[]>([]);
  const [spawnedIndex, setSpawnedIndex] = useState<number | null>(null);
  const [impact, setImpact] = useState<ImpactTier2048>('none');
  const [presentationEpoch, setPresentationEpoch] = useState(0);
  const [motionEpoch, setMotionEpoch] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [queuedDirection, setQueuedDirection] = useState<Direction2048 | null>(null);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState('2048 시작 준비');
  const [result, setResult] = useState<ArcadeFinishResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const phaseRef = useRef<ArcadeStagePhase>('ready');
  const displayStateRef = useRef<DisplayState2048>(EMPTY_DISPLAY);
  const engineRef = useRef<State2048 | null>(null);
  const pendingMoveRef = useRef<MoveResult2048 | null>(null);
  const pendingPresentationRef = useRef<PendingPresentation | null>(null);
  const animatingRef = useRef(false);
  const queuedDirectionRef = useRef<Direction2048 | null>(null);
  const milestoneOpenRef = useRef(false);
  const milestoneAfterImpactRef = useRef(false);
  const confirmOpenRef = useRef(false);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const finishedRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const rngStateRef = useRef(0);
  const finishInputRef = useRef<ArcadeFinishInput | null>(null);
  const activePlayMsRef = useRef(0);
  const activeSegmentStartedAtRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const continueButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusBeforeMilestoneRef = useRef<HTMLElement | null>(null);
  const requestMoveRef = useRef<(direction: Direction2048) => void>(() => undefined);
  const milestoneTitleId = useId();

  const game = GAME_DEFINITIONS['2048'];
  const stats = snapshot?.games['2048'];
  const entryFee = ARCADE_BALANCE.games['2048'].entryFee;
  const walletPoints = snapshot?.wallet.walletPoints ?? 0;
  const myBest = stats?.myBestScore ?? 0;
  const todayRewardedRuns = stats?.todayRewardedRuns ?? 0;
  const emptyCells = displayState.board.filter((value) => value === 0).length;
  const startDisabledReason = walletPoints < entryFee
    ? `포인트가 부족해요 (지금 ${walletPoints}P)`
    : undefined;

  const next2048Random = useCallback((): number => {
    const draw = nextRandom(rngStateRef.current);
    rngStateRef.current = draw.next;
    return draw.value;
  }, []);

  const transitionPhase = useCallback((next: ArcadeStagePhase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updateDisplay = useCallback((next: DisplayState2048): void => {
    displayStateRef.current = next;
    setDisplayState(next);
  }, []);

  const setQueued = useCallback((direction: Direction2048 | null): void => {
    queuedDirectionRef.current = direction;
    setQueuedDirection(direction);
  }, []);

  const startActiveClock = useCallback((): void => {
    if (activeSegmentStartedAtRef.current === null) {
      activeSegmentStartedAtRef.current = performance.now();
    }
  }, []);

  const stopActiveClock = useCallback((): void => {
    const startedAt = activeSegmentStartedAtRef.current;
    if (startedAt === null) return;
    activePlayMsRef.current += Math.max(0, performance.now() - startedAt);
    activeSegmentStartedAtRef.current = null;
  }, []);

  const clearPresentationTimer = useCallback((): void => {
    const pending = pendingPresentationRef.current;
    if (pending?.timer !== null && pending?.timer !== undefined) {
      window.clearTimeout(pending.timer);
      pending.timer = null;
    }
  }, []);

  const firePendingPresentation = useCallback((): void => {
    const pending = pendingPresentationRef.current;
    if (!pending) return;
    if (pending.timer !== null) window.clearTimeout(pending.timer);
    pendingPresentationRef.current = null;
    pending.action();
  }, []);

  const armPendingPresentation = useCallback((pending: PendingPresentation): void => {
    pending.startedAt = performance.now();
    pending.timer = window.setTimeout(firePendingPresentation, pending.remainingMs);
    pendingPresentationRef.current = pending;
  }, [firePendingPresentation]);

  const schedulePresentation = useCallback((
    kind: PendingPresentation['kind'],
    durationMs: number,
    action: () => void,
  ): void => {
    clearPresentationTimer();
    armPendingPresentation({
      kind,
      durationMs,
      remainingMs: durationMs,
      startedAt: performance.now(),
      timer: null,
      action,
    });
  }, [armPendingPresentation, clearPresentationTimer]);

  const suspendPendingPresentation = useCallback((): void => {
    const pending = pendingPresentationRef.current;
    if (!pending || pending.timer === null) return;
    pending.remainingMs = Math.max(0, pending.remainingMs - (performance.now() - pending.startedAt));
    clearPresentationTimer();
  }, [clearPresentationTimer]);

  const resumePendingPresentation = useCallback((): void => {
    const pending = pendingPresentationRef.current;
    if (!pending || pending.timer !== null) return;
    // CSS 애니메이션도 처음부터 다시 보여 상태와 화면이 어긋나지 않게 한다.
    pending.remainingMs = pending.durationMs;
    if (pending.kind === 'move') setMotionEpoch((value) => value + 1);
    else setPresentationEpoch((value) => value + 1);
    armPendingPresentation(pending);
  }, [armPendingPresentation]);

  const finalize = useCallback(async (): Promise<void> => {
    const input = finishInputRef.current;
    if (!input) { onExit(); return; }
    setFinishError(false);
    transitionPhase('finishing');
    const finished = await finishRun(input);
    if (!mountedRef.current) return;
    if (finished) {
      finished.unlockedAchievements.forEach((achievement) => {
        toast(`도전과제 달성! ${achievement.name} +${achievement.bonusPoints}P`);
      });
      setResult(finished);
      transitionPhase('result');
    } else {
      setFinishError(true);
    }
  }, [finishRun, onExit, transitionPhase]);

  const finishGame = useCallback((finalState: State2048): void => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopActiveClock();
    clearPresentationTimer();
    pendingPresentationRef.current = null;
    animatingRef.current = false;
    setAnimating(false);
    setLiveMessage(`게임 종료. 최종 점수 ${finalState.score.toLocaleString('ko-KR')}점`);
    if (runIdRef.current) {
      finishInputRef.current = {
        runId: runIdRef.current,
        gameId: '2048',
        score: finalState.score,
        durationMs: Math.min(14_400_000, Math.max(1000, Math.round(activePlayMsRef.current))),
        meta: seedRef.current === null ? {} : { seed: seedRef.current },
      };
    }
    void finalize();
  }, [clearPresentationTimer, finalize, stopActiveClock]);

  const openMilestone = useCallback((): void => {
    focusBeforeMilestoneRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : boardRef.current;
    milestoneOpenRef.current = true;
    setMilestoneOpen(true);
    setQueued(null);
    stopActiveClock();
    setLiveMessage('2048 타일을 완성했어요. 계속 합치기를 선택할 수 있어요.');
  }, [setQueued, stopActiveClock]);

  const completePresentation = useCallback((): void => {
    animatingRef.current = false;
    setAnimating(false);
    if (milestoneAfterImpactRef.current) {
      milestoneAfterImpactRef.current = false;
      openMilestone();
      return;
    }
    const current = engineRef.current;
    if (current?.status === 'over') {
      finishGame(current);
      return;
    }
    const queued = queuedDirectionRef.current;
    setQueued(null);
    if (queued && mountedRef.current) requestMoveRef.current(queued);
  }, [finishGame, openMilestone, setQueued]);

  const finishImpact = useCallback((): void => {
    setImpact('none');
    completePresentation();
  }, [completePresentation]);

  const commitMove = useCallback((): void => {
    const move = pendingMoveRef.current;
    if (!move) return;
    pendingMoveRef.current = null;
    updateDisplay({
      board: move.state.board,
      score: move.state.score,
      maxTile: move.state.maxTile,
    });
    setMotions([]);
    setMergedIndices(move.transition.mergedIndices);
    setSpawnedIndex(move.spawnedIndex);
    setPresentationEpoch((value) => value + 1);
    const tier = impactTier2048(move.transition.maxMerged);
    setImpact(tier);
    setLiveMessage(move.transition.scoreGained > 0
      ? `${move.transition.scoreGained.toLocaleString('ko-KR')}점 합성`
      : '새 타일이 나타났어요.');

    const postMotionMs = Math.max(
      move.spawnedIndex !== null ? SPAWN_MS : 0,
      move.transition.mergedIndices.length > 0 ? MERGE_MS : 0,
      tier !== 'none' ? IMPACT_MS[tier] : 0,
    );
    if (postMotionMs > 0 && !prefersReducedMotion) {
      schedulePresentation('impact', postMotionMs, finishImpact);
    } else {
      completePresentation();
    }
  }, [completePresentation, finishImpact, prefersReducedMotion, schedulePresentation, updateDisplay]);

  const requestMove = useCallback((direction: Direction2048): void => {
    if (
      phaseRef.current !== 'running'
      || confirmOpenRef.current
      || milestoneOpenRef.current
      || finishedRef.current
    ) return;
    if (animatingRef.current) {
      queuedDirectionRef.current = direction;
      setQueuedDirection(direction);
      return;
    }
    const current = engineRef.current;
    if (!current) return;
    const move = apply2048Move(current, direction, next2048Random);
    engineRef.current = move.state;
    if (!move.transition.changed) {
      if (move.state.status === 'over') finishGame(move.state);
      else setLiveMessage('그 방향으로는 움직일 수 없어요.');
      return;
    }

    milestoneAfterImpactRef.current = !current.reached2048
      && move.state.reached2048
      && move.transition.maxMerged >= 2048;
    pendingMoveRef.current = move;
    animatingRef.current = true;
    setAnimating(true);
    setImpact('none');
    setMergedIndices([]);
    setSpawnedIndex(null);
    setMotions(move.transition.motions);
    setMotionEpoch((value) => value + 1);
    setLiveMessage(`${direction} 방향으로 이동 중`);
    if (prefersReducedMotion) commitMove();
    else schedulePresentation('move', MOVE_MS, commitMove);
  }, [commitMove, finishGame, next2048Random, prefersReducedMotion, schedulePresentation]);
  requestMoveRef.current = requestMove;

  const advancePresentation = useCallback((milliseconds: number): void => {
    let remaining = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
    let guard = 0;
    while (pendingPresentationRef.current && guard < 4) {
      guard += 1;
      const pending = pendingPresentationRef.current;
      if (pending.timer !== null) {
        pending.remainingMs = Math.max(0, pending.remainingMs - (performance.now() - pending.startedAt));
        clearPresentationTimer();
      }
      if (remaining < pending.remainingMs) {
        pending.remainingMs -= remaining;
        if (phaseRef.current === 'running' && !confirmOpenRef.current && !milestoneOpenRef.current) {
          armPendingPresentation(pending);
        }
        return;
      }
      remaining -= pending.remainingMs;
      pendingPresentationRef.current = null;
      pending.action();
    }
  }, [armPendingPresentation, clearPresentationTimer]);

  const suspendGameplay = useCallback((): void => {
    pointerStartRef.current = null;
    stopActiveClock();
    suspendPendingPresentation();
  }, [stopActiveClock, suspendPendingPresentation]);

  const resumeGameplay = useCallback((): void => {
    transitionPhase('running');
    if (milestoneOpenRef.current) return;
    startActiveClock();
    resumePendingPresentation();
  }, [resumePendingPresentation, startActiveClock, transitionPhase]);

  const pauseToOverlay = useCallback((): void => {
    if (phaseRef.current !== 'running') return;
    suspendGameplay();
    transitionPhase('paused');
  }, [suspendGameplay, transitionPhase]);

  const handleStart = useCallback(async (): Promise<void> => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      const started = await startRun('2048');
      if (!started) {
        setStartError(useArcadeStore.getState().error ?? '게임을 시작하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      runIdRef.current = started.runId;
      setResult(null);
      transitionPhase('countdown');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [startRun, transitionPhase]);

  const beginGame = useCallback((): void => {
    const seed = createSeed();
    seedRef.current = seed;
    rngStateRef.current = seed;
    const initial = create2048State(next2048Random);
    engineRef.current = initial;
    finishedRef.current = false;
    finishInputRef.current = null;
    activePlayMsRef.current = 0;
    milestoneOpenRef.current = false;
    milestoneAfterImpactRef.current = false;
    setMilestoneOpen(false);
    setQueued(null);
    updateDisplay({ board: initial.board, score: 0, maxTile: initial.maxTile });
    setSpawnedIndex(null);
    setMergedIndices(initial.board.flatMap((value, index) => (value ? [index] : [])));
    setPresentationEpoch((value) => value + 1);
    transitionPhase('running');
    startActiveClock();
    setLiveMessage('2048 게임을 시작합니다.');
    boardRef.current?.focus();
  }, [next2048Random, setQueued, startActiveClock, transitionPhase, updateDisplay]);

  const handleReplay = useCallback((): void => {
    clearPresentationTimer();
    pendingPresentationRef.current = null;
    pendingMoveRef.current = null;
    engineRef.current = null;
    runIdRef.current = null;
    seedRef.current = null;
    rngStateRef.current = 0;
    finishInputRef.current = null;
    finishedRef.current = false;
    animatingRef.current = false;
    activePlayMsRef.current = 0;
    activeSegmentStartedAtRef.current = null;
    updateDisplay(EMPTY_DISPLAY);
    setMotions([]);
    setMergedIndices([]);
    setSpawnedIndex(null);
    setImpact('none');
    setAnimating(false);
    setQueued(null);
    setResult(null);
    setFinishError(false);
    setStartError(null);
    transitionPhase('ready');
  }, [clearPresentationTimer, setQueued, transitionPhase, updateDisplay]);

  const handleQuit = useCallback((): void => {
    stopActiveClock();
    clearPresentationTimer();
    pendingPresentationRef.current = null;
    pointerStartRef.current = null;
    onExit();
  }, [clearPresentationTimer, onExit, stopActiveClock]);

  const handleContinueMilestone = useCallback((): void => {
    milestoneOpenRef.current = false;
    setMilestoneOpen(false);
    setLiveMessage('계속 합치기에 도전합니다.');
    const current = engineRef.current;
    if (current?.status === 'over') {
      finishGame(current);
      return;
    }
    startActiveClock();
    (focusBeforeMilestoneRef.current ?? boardRef.current)?.focus();
  }, [finishGame, startActiveClock]);

  const handleMilestoneKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') {
      event.preventDefault();
      continueButtonRef.current?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      handleContinueMilestone();
    }
  }, [handleContinueMilestone]);

  const handleConfirmingChange = useCallback((confirming: boolean): void => {
    confirmOpenRef.current = confirming;
    setConfirmOpen(confirming);
    if (confirming) suspendGameplay();
  }, [suspendGameplay]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (phaseRef.current !== 'running' || milestoneOpenRef.current || confirmOpenRef.current) return;
    pointerStartRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    requestMoveRef.current(Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up'));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isInteractiveTarget(event.target)) return;
      if (event.repeat) return;
      if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') {
        if (phaseRef.current !== 'running' && phaseRef.current !== 'paused') return;
        event.preventDefault();
        if (phaseRef.current === 'running') pauseToOverlay();
        else resumeGameplay();
        return;
      }
      const direction = KEY_TO_DIRECTION[event.key];
      if (!direction || phaseRef.current !== 'running') return;
      event.preventDefault();
      requestMoveRef.current(direction);
    };
    const onBlur = (): void => pauseToOverlay();
    const onVisibility = (): void => { if (document.hidden) pauseToOverlay(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pauseToOverlay, resumeGameplay]);

  useEffect(() => {
    if (milestoneOpen) continueButtonRef.current?.focus();
  }, [milestoneOpen]);

  useEffect(() => {
    const gameWindow = window as GameWindow;
    const renderGame = (): string => JSON.stringify({
      coordinateSystem: 'row-major 4x4; origin top-left; x right; y down',
      board: displayStateRef.current.board,
      score: displayStateRef.current.score,
      maxTile: displayStateRef.current.maxTile,
      phase: phaseRef.current,
      animating: animatingRef.current,
      queuedDirection: queuedDirectionRef.current,
      milestoneOpen: milestoneOpenRef.current,
    });
    const advance = (milliseconds: number): void => advancePresentation(milliseconds);
    gameWindow.render_game_to_text = renderGame;
    gameWindow.advanceTime = advance;
    return () => {
      if (gameWindow.render_game_to_text === renderGame) delete gameWindow.render_game_to_text;
      if (gameWindow.advanceTime === advance) delete gameWindow.advanceTime;
    };
  }, [advancePresentation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopActiveClock();
      clearPresentationTimer();
      pendingPresentationRef.current = null;
    };
  }, [clearPresentationTimer, stopActiveClock]);

  const boardLabel = useMemo(() => boardAriaLabel(displayState.board), [displayState.board]);
  const controlsDisabled = phase !== 'running' || milestoneOpen || confirmOpen || finishedRef.current;
  const directionButton = (direction: Direction2048, label: string) => (
    <button
      type="button"
      className={`pg-2048-control pg-2048-control--${direction}`}
      aria-label={`${label}으로 이동`}
      disabled={controlsDisabled}
      onClick={() => requestMove(direction)}
    >
      {label}
    </button>
  );

  const stage = (
    <div className="pg-2048-playfield">
      <div
        ref={boardRef}
        className="pg-2048-board"
        tabIndex={0}
        role="application"
        aria-label={boardLabel}
        aria-busy={animating}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pointerStartRef.current = null; }}
      >
        <div
          key={presentationEpoch}
          className={`pg-2048-impact-layer${impact !== 'none' ? ` is-impact-${impact}` : ''}`}
        >
          <div className="pg-2048-grid" aria-hidden>
            {Array.from({ length: 16 }, (_, index) => <i key={index} />)}
          </div>
          {motions.length > 0 ? (
            <div key={motionEpoch} className="pg-2048-motion-layer" aria-hidden>
              {motions.map((motion, index) => (
                <span
                  key={`${motion.from}-${motion.to}-${index}`}
                  className={`pg-2048-tile pg-2048-tile--${tileTone(motion.value)} pg-2048-motion-tile`}
                  style={motionStyle(motion)}
                >
                  {motion.value}
                </span>
              ))}
            </div>
          ) : (
            <div className="pg-2048-tile-layer" aria-hidden>
              {displayState.board.map((value, index) => value > 0 && (
                <span
                  key={`${presentationEpoch}-${index}`}
                  className={[
                    'pg-2048-tile',
                    `pg-2048-tile--${tileTone(value)}`,
                    mergedIndices.includes(index) ? 'is-merged' : '',
                    spawnedIndex === index ? 'is-spawned' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ gridColumn: index % 4 + 1, gridRow: Math.floor(index / 4) + 1 }}
                >
                  {value}
                </span>
              ))}
            </div>
          )}
        </div>

        {milestoneOpen && (
          <div
            className="pg-2048-milestone"
            role="dialog"
            aria-modal="true"
            aria-labelledby={milestoneTitleId}
            onKeyDown={handleMilestoneKeyDown}
          >
            <span className="pg-2048-milestone__eyebrow">MILESTONE</span>
            <h3 id={milestoneTitleId}>2048 완성!</h3>
            <p>여기서 끝내지 않고 더 큰 숫자에 도전할 수 있어요.</p>
            <button ref={continueButtonRef} type="button" className="pg-arcade-btn" onClick={handleContinueMilestone}>
              계속 합치기
            </button>
          </div>
        )}
      </div>

      <p className="pg-2048-live" aria-live="polite">{liveMessage}</p>
      <div className="pg-2048-controls" aria-label="2048 방향 조작">
        {directionButton('up', '↑')}
        {directionButton('left', '←')}
        {directionButton('down', '↓')}
        {directionButton('right', '→')}
      </div>
      <span className="pg-2048-motion-spec" aria-hidden>{SPAWN_MS} / {MERGE_MS}</span>
    </div>
  );

  const hud = (
    <>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">점수</span><span className="pg-arcade-hud__value">{displayState.score.toLocaleString('ko-KR')}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">최고 타일</span><span className="pg-arcade-hud__value">{displayState.maxTile}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">빈 칸</span><span className="pg-arcade-hud__value">{emptyCells}</span></div>
      <div className="pg-arcade-hud__item"><span className="pg-arcade-hud__label">내 최고</span><span className="pg-arcade-hud__value">{myBest.toLocaleString('ko-KR')}</span></div>
    </>
  );

  return (
    <ArcadeStageChrome
      game={game}
      phase={phase}
      hud={hud}
      stage={stage}
      eyebrow="SLIDE · MERGE · REPEAT"
      accentToken="--pg-yellow"
      gradeProgress={gradeProgress('2048', displayState.score)}
      result={result ? (
        <RunResultOverlay
          gameId="2048"
          result={result}
          scoreLabel={`${displayState.score.toLocaleString('ko-KR')}점`}
          onReplay={handleReplay}
          onExit={onExit}
          replayDisabledReason={startDisabledReason}
          returnLabel={returnLabel}
        />
      ) : undefined}
      onStart={() => void handleStart()}
      onResume={resumeGameplay}
      onPause={suspendGameplay}
      onQuit={handleQuit}
      onCountdownComplete={beginGame}
      finishError={finishError}
      onRetryFinish={() => void finalize()}
      onConfirmingChange={handleConfirmingChange}
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
