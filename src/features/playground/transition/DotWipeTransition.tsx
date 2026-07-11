import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import {
  FrameCadenceSampler,
  TransitionCallbackGate,
  getOrCreateParticleBuffers,
  getHiddenTransitionAction,
  getParticleBudget,
  getReducedMotionFrame,
  getTransitionFrame,
} from './dotWipeMath';
import type { ParticleBufferCache } from './dotWipeMath';
import { getDotWipePresentation } from './playgroundTransitionPolicy';
import type { DotWipeRequest } from './usePlaygroundEntryStore';

export interface DotWipeTransitionProps {
  request: DotWipeRequest;
  onCovered: () => void;
  onFinished: () => void;
}

const MAX_DPR = 1.5;
const SAFETY_TIMEOUT_MS = 1800;
const TRANSITION_LAYER_Z_INDEX = 2147483647;

export function DotWipeTransition({
  request,
  onCovered,
  onFinished,
}: DotWipeTransitionProps) {
  const presentation = getDotWipePresentation(request.target);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(false);
  const finishedRef = useRef(false);
  const initializedRequestIdRef = useRef<number | null>(null);
  const particleBuffersRef = useRef<ParticleBufferCache | null>(null);
  const callbackGateRef = useRef<{ requestId: number; gate: TransitionCallbackGate } | null>(null);
  const onCoveredRef = useRef(onCovered);
  const onFinishedRef = useRef(onFinished);

  onCoveredRef.current = onCovered;
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (initializedRequestIdRef.current !== request.id) {
      initializedRequestIdRef.current = request.id;
      committedRef.current = false;
      finishedRef.current = false;
    }
    if (callbackGateRef.current?.requestId !== request.id) {
      callbackGateRef.current = { requestId: request.id, gate: new TransitionCallbackGate() };
    }
    const callbackGate = callbackGateRef.current.gate;
    if (finishedRef.current || callbackGate.hasFinished) return;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const budget = getParticleBudget(
      Math.max(1, window.innerWidth),
      Math.max(1, window.innerHeight),
      reducedMotion,
    );
    const buffers = getOrCreateParticleBuffers(particleBuffersRef.current, request.id, budget);
    particleBuffersRef.current = buffers;
    const { xs, ys, sizes, delays } = buffers;
    const context = canvas.getContext('2d');

    const fillColor = presentation.palette.cover;

    let width = Math.max(1, window.innerWidth);
    let height = Math.max(1, window.innerHeight);
    let dpr = 1;
    let particleCount = 0;
    let activeBudget = 0;
    let degradedMode = false;

    const updateParticleLayout = () => {
      if (reducedMotion || budget === 0) {
        particleCount = 0;
        activeBudget = 0;
        return;
      }

      const rows = Math.max(1, Math.floor(Math.sqrt((budget * height) / width)));
      const columns = Math.max(1, Math.floor(budget / rows));
      particleCount = rows * columns;
      const cellWidth = width / columns;
      const cellHeight = height / rows;
      const particleSize = Math.max(cellWidth, cellHeight) * 1.5;
      const maxDistance = Math.max(
        Math.hypot(request.origin.x, request.origin.y),
        Math.hypot(width - request.origin.x, request.origin.y),
        Math.hypot(request.origin.x, height - request.origin.y),
        Math.hypot(width - request.origin.x, height - request.origin.y),
        1,
      );

      for (let index = 0; index < particleCount; index += 1) {
        const row = Math.floor(index / columns);
        const column = index - row * columns;
        const x = (column + 0.5) * cellWidth;
        const y = (row + 0.5) * cellHeight;
        xs[index] = x;
        ys[index] = y;
        sizes[index] = particleSize;
        delays[index] = Math.min(
          0.82,
          (Math.hypot(x - request.origin.x, y - request.origin.y) / maxDistance) * 0.68
            + Math.random() * 0.08,
        );
      }
      activeBudget = degradedMode ? Math.max(1, Math.floor(particleCount / 2)) : particleCount;
    };

    const updateCanvasLayout = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (context) context.fillStyle = fillColor;
      updateParticleLayout();
    };

    updateCanvasLayout();

    let rafId = 0;
    let disposed = false;

    const commitOnce = () => {
      if (!callbackGate.tryCommit()) return;
      committedRef.current = true;
      onCoveredRef.current();
    };

    const finishOnce = () => {
      if (!callbackGate.tryFinish()) return;
      finishedRef.current = true;
      onFinishedRef.current();
    };

    const cancelActiveFrame = () => {
      if (!rafId) return;
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const fastForward = () => {
      cancelActiveFrame();
      commitOnce();
      finishOnce();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      cancelActiveFrame();
      const action = getHiddenTransitionAction(committedRef.current);
      if (action.commit) commitOnce();
      if (action.finish) finishOnce();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      fastForward();
    };

    const handleViewportChange = () => {
      if (disposed || finishedRef.current) return;
      updateCanvasLayout();
    };

    let resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const handleResolutionChange = () => {
      resolutionQuery.removeEventListener('change', handleResolutionChange);
      handleViewportChange();
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolutionQuery.addEventListener('change', handleResolutionChange);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    resolutionQuery.addEventListener('change', handleResolutionChange);

    const safetyTimeout = window.setTimeout(() => {
      if (disposed) return;
      fastForward();
    }, SAFETY_TIMEOUT_MS);

    if (document.visibilityState === 'hidden') {
      handleVisibilityChange();
    } else if (reducedMotion) {
      overlay.style.backgroundColor = fillColor;
      overlay.style.opacity = '0';
      const startedAt = performance.now();

      const renderReducedMotionFrame = () => {
        if (disposed || finishedRef.current) return;
        const frame = getReducedMotionFrame(performance.now() - startedAt);
        overlay.style.opacity = String(frame.opacity);
        if (frame.shouldCommit) commitOnce();
        if (frame.shouldFinish) {
          finishOnce();
          return;
        }
        rafId = window.requestAnimationFrame(renderReducedMotionFrame);
      };

      rafId = window.requestAnimationFrame(renderReducedMotionFrame);
    } else if (!context) {
      fastForward();
    } else {
      context.fillStyle = fillColor;
      const startedAt = performance.now();
      const cadenceSampler = new FrameCadenceSampler(startedAt);

      const renderFrame = (now: number) => {
        if (disposed || finishedRef.current) return;
        rafId = 0;
        const frame = getTransitionFrame(Math.max(0, now - startedAt));
        if (frame.shouldCommit) commitOnce();
        if (frame.phase === 'finished') {
          context.clearRect(0, 0, width, height);
          commitOnce();
          finishOnce();
          return;
        }

        if (cadenceSampler.sample(now)) {
          degradedMode = true;
          activeBudget = Math.max(1, Math.floor(activeBudget / 2));
        }

        const degraded = activeBudget < particleCount;
        const stride = degraded ? 2 : 1;
        const sizeBoost = degraded ? 2.15 : 1;
        context.clearRect(0, 0, width, height);

        for (let drawIndex = 0; drawIndex < activeBudget; drawIndex += 1) {
          const index = drawIndex * stride;
          const delay = delays[index];
          const localProgress = frame.phase === 'covering'
            ? Math.max(0, Math.min(1, (frame.progress - delay) / (1 - delay)))
            : 1 - Math.max(0, Math.min(1, (frame.progress - delay * 0.55) / (1 - delay * 0.55)));
          if (localProgress <= 0) continue;
          const eased = localProgress * localProgress * (3 - 2 * localProgress);
          const size = sizes[index] * eased * sizeBoost;
          context.fillRect(xs[index] - size / 2, ys[index] - size / 2, size, size);
        }

        rafId = window.requestAnimationFrame(renderFrame);
      };

      rafId = window.requestAnimationFrame(renderFrame);
    }

    return () => {
      disposed = true;
      cancelActiveFrame();
      window.clearTimeout(safetyTimeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      resolutionQuery.removeEventListener('change', handleResolutionChange);
    };
  }, [
    presentation.palette.accent,
    presentation.palette.cover,
    presentation.palette.text,
    request.id,
    request.origin.x,
    request.origin.y,
    request.target,
  ]);

  return createPortal(
    <div
      ref={overlayRef}
      className="pointer-events-auto fixed inset-0 isolate overflow-hidden"
      style={{ zIndex: TRANSITION_LAYER_Z_INDEX }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="fixed inset-0 h-full w-full"
      />
      <div
        role="status"
        aria-live="polite"
        aria-label={presentation.accessibleLabel}
        className="pointer-events-none absolute inset-0 z-10 grid place-content-center text-center"
      >
        {presentation.eyebrow && (
          <span
            className="font-mono text-[10px] font-bold tracking-[0.16em]"
            style={{ color: presentation.palette.accent }}
          >
            {presentation.eyebrow}
          </span>
        )}
        <strong
          className="mt-2 text-2xl tracking-[-0.04em]"
          style={{ color: presentation.palette.text }}
        >
          {presentation.label}
        </strong>
      </div>
    </div>,
    document.body,
  );
}
