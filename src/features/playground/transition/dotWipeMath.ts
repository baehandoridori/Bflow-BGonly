export interface Point { x: number; y: number }
export interface RectLike { left: number; top: number; width: number; height: number }
export type DotWipePhase = 'covering' | 'revealing' | 'finished';

export interface TransitionFrame {
  phase: DotWipePhase;
  progress: number;
  shouldCommit: boolean;
}

export interface ParticleBufferCache {
  requestId: number;
  budget: number;
  xs: Float32Array;
  ys: Float32Array;
  sizes: Float32Array;
  delays: Float32Array;
}

export const COVER_MS = 500;
export const TOTAL_MS = 1200;
const SLOW_FRAME_THRESHOLD_MS = 24;

export class FrameCadenceSampler {
  private previousTimestamp: number;
  private sampleCount = 0;
  private consecutiveSlowFrames = 0;

  constructor(startedAt: number) {
    this.previousTimestamp = startedAt;
  }

  sample(timestamp: number): boolean {
    if (this.sampleCount >= 3) return false;

    const interval = Math.max(0, timestamp - this.previousTimestamp);
    this.previousTimestamp = timestamp;
    this.sampleCount += 1;
    this.consecutiveSlowFrames = interval > SLOW_FRAME_THRESHOLD_MS
      ? this.consecutiveSlowFrames + 1
      : 0;

    return this.sampleCount === 3 && this.consecutiveSlowFrames === 3;
  }
}

export class TransitionCallbackGate {
  private committed = false;
  private finished = false;

  get hasCommitted(): boolean {
    return this.committed;
  }

  get hasFinished(): boolean {
    return this.finished;
  }

  tryCommit(): boolean {
    if (this.committed) return false;
    this.committed = true;
    return true;
  }

  tryFinish(): boolean {
    if (this.finished) return false;
    this.finished = true;
    return true;
  }
}

export function getOrCreateParticleBuffers(
  current: ParticleBufferCache | null,
  requestId: number,
  budget: number,
): ParticleBufferCache {
  if (current?.requestId === requestId && current.budget === budget) return current;

  const xs = new Float32Array(budget);
  const ys = new Float32Array(budget);
  const sizes = new Float32Array(budget);
  const delays = new Float32Array(budget);
  return { requestId, budget, xs, ys, sizes, delays };
}

export function originFromRect(rect: RectLike): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function originFromActivation(
  clientX: number,
  clientY: number,
  detail: number,
  rect: RectLike,
): Point {
  return detail === 0 ? originFromRect(rect) : { x: clientX, y: clientY };
}

export function getParticleBudget(width: number, height: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.max(4000, Math.min(12000, Math.round((width * height) / 220)));
}

export function getTransitionFrame(elapsedMs: number): TransitionFrame {
  if (elapsedMs >= TOTAL_MS) return { phase: 'finished', progress: 1, shouldCommit: false };
  if (elapsedMs >= COVER_MS) {
    return {
      phase: 'revealing',
      progress: (elapsedMs - COVER_MS) / (TOTAL_MS - COVER_MS),
      shouldCommit: true,
    };
  }
  return { phase: 'covering', progress: Math.max(0, elapsedMs / COVER_MS), shouldCommit: false };
}

export function getHiddenTransitionAction(alreadyCommitted: boolean) {
  return { commit: !alreadyCommitted, finish: true } as const;
}
