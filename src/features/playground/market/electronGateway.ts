import { createMarketPreviewSeed } from './seed.ts';
import type { MarketPreviewGateway } from './previewGateway.ts';
import type {
  MarketAdminEventInput,
  MarketCommand,
  MarketRemoteState,
  MarketSnapshot,
} from './types';

export interface MarketElectronApi {
  marketRead(): Promise<MarketRemoteState>;
  marketExecute(command: MarketCommand): Promise<MarketRemoteState>;
  marketCreateAdminEvent(input: MarketAdminEventInput): Promise<MarketRemoteState>;
  marketDeleteAdminEvent(eventId: string): Promise<MarketRemoteState>;
}

function hydrateMarketSnapshot(remote: MarketRemoteState): MarketSnapshot {
  const seed = createMarketPreviewSeed();
  return {
    ...seed,
    revision: remote.revision,
    account: structuredClone(remote.account),
    favoriteStockIds: [...remote.favoriteStockIds],
    beginnerMission: remote.beginnerMission,
    adminEvents: structuredClone(remote.adminEvents),
  };
}

export function createElectronMarketGateway(api: MarketElectronApi): MarketPreviewGateway {
  return {
    async read() {
      return hydrateMarketSnapshot(await api.marketRead());
    },
    async execute(command) {
      return hydrateMarketSnapshot(await api.marketExecute(command));
    },
    async createAdminEvent(input) {
      return hydrateMarketSnapshot(await api.marketCreateAdminEvent(input));
    },
    async deleteAdminEvent(eventId) {
      return hydrateMarketSnapshot(await api.marketDeleteAdminEvent(eventId));
    },
  };
}
