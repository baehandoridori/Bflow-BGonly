import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { applyMarketCommand, validateMarketCommand } from './domain.ts';
import {
  createMarketPreviewGateway,
  type MarketPreviewGateway,
} from './previewGateway.ts';
import type { MarketCommand, MarketSnapshot } from './types';

interface MarketPreviewState {
  confirmed: MarketSnapshot | null;
  visible: MarketSnapshot | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  load(): Promise<void>;
  execute(command: MarketCommand, currentPriceWon?: number): Promise<boolean>;
  clearError(): void;
}

export function createMarketPreviewStore(
  gateway: MarketPreviewGateway,
): UseBoundStore<StoreApi<MarketPreviewState>> {
  return create<MarketPreviewState>((set, get) => ({
    confirmed: null,
    visible: null,
    loading: false,
    mutating: false,
    error: null,
    async load() {
      set({ loading: true, error: null });
      try {
        const snapshot = await gateway.read();
        set({ confirmed: snapshot, visible: snapshot, loading: false });
      } catch {
        set({ loading: false, error: '시장 정보를 불러오지 못했어요.' });
      }
    },
    async execute(command, currentPriceWon) {
      const { visible, mutating } = get();
      if (!visible || mutating) return false;

      const validation = validateMarketCommand(visible, command, currentPriceWon);
      if (validation) {
        set({ error: validation });
        return false;
      }

      const projected = applyMarketCommand(visible, command, currentPriceWon);
      set({ visible: projected, mutating: true, error: null });
      try {
        const confirmed = await gateway.execute(command);
        set({ confirmed, visible: confirmed, mutating: false });
        return true;
      } catch {
        set({
          visible: get().confirmed,
          mutating: false,
          error: '저장하지 못했어요. 이전 상태로 되돌렸어요.',
        });
        return false;
      }
    },
    clearError() {
      set({ error: null });
    },
  }));
}

export const useMarketPreviewStore = createMarketPreviewStore(createMarketPreviewGateway());
