import { createElectronArcadeGateway, type ArcadeElectronApi } from './electronGateway.ts';
import { createArcadeLocalStorageGateway } from './localStorageGateway.ts';
import type { ArcadePreviewGateway } from './previewGateway.ts';

const IPC_ERROR_MESSAGE = '아케이드 IPC 연결을 불러오지 못했어요. 앱을 업데이트한 뒤 다시 시도해 주세요.';

export interface ArcadePreviewContext {
  enabled: boolean;
  userId: string | null;
  storage: Storage;
  now: () => number;
}

export interface ArcadeGatewayOptions {
  getElectronAPI?: () => Partial<ArcadeElectronApi> | undefined;
  getPreviewContext?: () => ArcadePreviewContext | null | undefined;
}

function defaultElectronAPI(): Partial<ArcadeElectronApi> | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI;
}

function arcadeMethodCount(api: Partial<ArcadeElectronApi> | undefined): number {
  if (!api) return 0;
  return [api.arcadeRead, api.arcadeExecute, api.onArcadeWalletUpdated].filter(
    (method) => typeof method === 'function',
  ).length;
}

function isCompleteArcadeApi(api: Partial<ArcadeElectronApi>): api is ArcadeElectronApi {
  return arcadeMethodCount(api) === 3;
}

export function createArcadeGateway(options: ArcadeGatewayOptions = {}): ArcadePreviewGateway {
  const getElectronAPI = options.getElectronAPI ?? defaultElectronAPI;
  const previewGateways = new Map<string, ArcadePreviewGateway>();

  function resolve(): ArcadePreviewGateway {
    const api = getElectronAPI();
    const methodCount = arcadeMethodCount(api);
    if (api && isCompleteArcadeApi(api)) return createElectronArcadeGateway(api);
    if (methodCount > 0) throw new Error(IPC_ERROR_MESSAGE);

    const preview = options.getPreviewContext?.();
    if (preview?.enabled) {
      const userId = preview.userId?.trim();
      if (!userId) throw new Error('프리뷰 로그인 사용자를 확인할 수 없어요.');
      let gateway = previewGateways.get(userId);
      if (!gateway) {
        gateway = createArcadeLocalStorageGateway({
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
  };
}
