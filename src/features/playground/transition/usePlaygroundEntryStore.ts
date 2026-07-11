import { create } from 'zustand';
import type { PlaygroundReturnSurface } from '../routes';
import type { Point } from './dotWipeMath';
import type { DotWipeTarget } from './playgroundTransitionPolicy';

export interface DotWipeRequest {
  id: number;
  origin: Point;
  target: DotWipeTarget;
  returnTo: PlaygroundReturnSurface;
}

interface PlaygroundEntryState {
  active: DotWipeRequest | null;
  request(origin: Point): void;
  finish(id: number): void;
}

export const usePlaygroundEntryStore = create<PlaygroundEntryState>((set, get) => ({
  active: null,
  request(origin) {
    if (get().active) return;
    set({
      active: {
        id: Date.now(),
        origin,
        target: 'playground-entry',
        returnTo: 'lobby',
      },
    });
  },
  finish(id) {
    if (get().active?.id === id) set({ active: null });
  },
}));
