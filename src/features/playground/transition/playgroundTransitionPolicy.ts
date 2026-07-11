import type { PlaygroundAction, PreviewGame } from '../routes';

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

const PALETTE = { cover: '#07090d', text: '#ffffff', accent: '#45e0b5' } as const;

const LABELS: Record<DotWipeTarget, { eyebrow: string | null; label: string }> = {
  'playground-entry': { eyebrow: null, label: '지금은 쉬는 시간!' },
  tetris: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING TETRIS' },
  snake: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING SNAKE' },
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
