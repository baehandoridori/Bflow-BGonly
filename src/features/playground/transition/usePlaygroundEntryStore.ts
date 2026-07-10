import { create } from 'zustand';
import type { Point } from './dotWipeMath';

export interface DotWipeRequest { id: number; origin: Point }

interface PlaygroundEntryState {
  active: DotWipeRequest | null;
  request(origin: Point): void;
  finish(id: number): void;
}

export const usePlaygroundEntryStore = create<PlaygroundEntryState>((set, get) => ({
  active: null,
  request(origin) {
    if (get().active) return;
    set({ active: { id: Date.now(), origin } });
  },
  finish(id) {
    if (get().active?.id === id) set({ active: null });
  },
}));
