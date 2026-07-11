import { createElectronMarketGateway, type MarketElectronApi } from './electronGateway.ts';
import { createMarketLocalStorageGateway } from './localStorageGateway.ts';
import type { MarketPreviewGateway } from './previewGateway.ts';

const IPC_ERROR_MESSAGE = '모의투자 계좌 IPC 연결을 불러오지 못했어요. 앱을 업데이트한 뒤 다시 시도해 주세요.';

export interface MarketPreviewContext {
  enabled: boolean;
  userId: string | null;
  storage: Storage;
  now: () => number;
}

export interface MarketGatewayOptions {
  getElectronAPI?: () => Partial<MarketElectronApi> | undefined;
  getPreviewContext?: () => MarketPreviewContext | null | undefined;
}

function defaultElectronAPI(): Partial<MarketElectronApi> | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI;
}

function marketMethodCount(api: Partial<MarketElectronApi> | undefined): number {
  if (!api) return 0;
  return [
    api.marketRead,
    api.marketExecute,
    api.marketCreateAdminEvent,
    api.marketDeleteAdminEvent,
  ].filter((method) => typeof method === 'function').length;
}

function isCompleteMarketApi(api: Partial<MarketElectronApi>): api is MarketElectronApi {
  return marketMethodCount(api) === 4;
}

export function createMarketGateway(
  options: MarketGatewayOptions = {},
): MarketPreviewGateway {
  const getElectronAPI = options.getElectronAPI ?? defaultElectronAPI;
  const previewGateways = new Map<string, MarketPreviewGateway>();

  function resolve(): MarketPreviewGateway {
    const api = getElectronAPI();
    const methodCount = marketMethodCount(api);
    if (api && isCompleteMarketApi(api)) return createElectronMarketGateway(api);
    if (methodCount > 0) throw new Error(IPC_ERROR_MESSAGE);

    const preview = options.getPreviewContext?.();
    if (preview?.enabled) {
      const userId = preview.userId?.trim();
      if (!userId) throw new Error('프리뷰 로그인 사용자를 확인할 수 없어요.');
      let gateway = previewGateways.get(userId);
      if (!gateway) {
        gateway = createMarketLocalStorageGateway({
          userId,
          storage: preview.storage,
          now: preview.now,
        });
        previewGateways.set(userId, gateway);
      }
      return gateway;
    }

    throw new Error(IPC_ERROR_MESSAGE);
  }

  return {
    read: () => Promise.resolve().then(() => resolve().read()),
    execute: (command) => Promise.resolve().then(() => resolve().execute(command)),
    createAdminEvent: (input) => Promise.resolve().then(() => resolve().createAdminEvent(input)),
    deleteAdminEvent: (eventId) => Promise.resolve().then(() => resolve().deleteAdminEvent(eventId)),
  };
}
