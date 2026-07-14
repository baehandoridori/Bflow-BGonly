import {
  getPlaygroundReturnSurface,
  navigatePlayground,
  type PlaygroundAction,
  type PlaygroundReturnSurface,
  type PlaygroundRoute,
  type PreviewGame,
} from '../routes.ts';
import type { Point } from './dotWipeMath';

export type DotWipeTarget = 'playground-entry' | PreviewGame | 'market';

export interface DotWipePresentation {
  eyebrow: string | null;
  label: string;
  accessibleLabel: string;
  palette: { cover: string; text: string; accent: string };
}

export type PlaygroundNavigationTransition =
  | { mode: 'dot'; target: Exclude<DotWipeTarget, 'playground-entry'> }
  | { mode: 'surface' }
  | { mode: 'none' };

export type PlaygroundMovePlan =
  | {
    mode: 'dot';
    request: {
      origin: Point;
      target: Exclude<DotWipeTarget, 'playground-entry'>;
      returnTo: PlaygroundReturnSurface;
    };
  }
  | { mode: 'surface' | 'none'; route: PlaygroundRoute };

const PALETTE = { cover: '#07090d', text: '#ffffff', accent: '#45e0b5' } as const;

const LABELS: Record<DotWipeTarget, { eyebrow: string | null; label: string }> = {
  'playground-entry': { eyebrow: null, label: '지금은 쉬는 시간!' },
  tetris: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING TETRIS' },
  snake: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING SNAKE' },
  '2048': { eyebrow: 'BAE PLAYGROUND', label: 'LOADING 2048' },
  sudoku: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING SUDOKU' },
  market: { eyebrow: 'BAE PLAYGROUND', label: 'OPENING JBBJ MARKET' },
};

export function getDotWipePresentation(target: DotWipeTarget): DotWipePresentation {
  const copy = LABELS[target];
  return {
    ...copy,
    accessibleLabel: copy.eyebrow ? `${copy.eyebrow} / ${copy.label}` : copy.label,
    palette: { ...PALETTE },
  };
}

export function getPlaygroundNavigationTransition(
  action: PlaygroundAction,
): PlaygroundNavigationTransition {
  if (action.kind === 'open-game') return { mode: 'dot', target: action.game };
  if (action.kind === 'open-market') return { mode: 'dot', target: 'market' };
  if (
    action.kind === 'open-house'
    || action.kind === 'go-lobby'
    || action.kind === 'return-to-source'
  ) {
    return { mode: 'surface' };
  }
  return { mode: 'none' };
}

export function getPlaygroundMovePlan(
  route: PlaygroundRoute,
  action: PlaygroundAction,
  origin: Point,
): PlaygroundMovePlan {
  const transition = getPlaygroundNavigationTransition(action);
  if (transition.mode === 'dot') {
    return {
      mode: 'dot',
      request: {
        origin,
        target: transition.target,
        returnTo: getPlaygroundReturnSurface(route),
      },
    };
  }
  return {
    mode: transition.mode,
    route: navigatePlayground(route, action),
  };
}
