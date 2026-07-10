export interface Point { x: number; y: number }
export interface RectLike { left: number; top: number; width: number; height: number }
export type DotWipePhase = 'covering' | 'revealing' | 'finished';

export interface TransitionFrame {
  phase: DotWipePhase;
  progress: number;
  shouldCommit: boolean;
}

export const COVER_MS = 500;
export const TOTAL_MS = 1200;

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
