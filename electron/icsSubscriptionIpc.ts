/**
 * 외부 캘린더(ICS) 구독 IPC 등록.
 *
 * 저장·조회 자체는 icsSubscriptions.ts의 store가 하고, 여기서는 채널 배선과
 * 주기 갱신만 맡는다. store와 마찬가지로 'electron' 의존은 전부 주입으로 받는다.
 */
import type {
  IcsSubscription,
  IcsSubscriptionAddInput,
  IcsSubscriptionEvents,
  IcsSubscriptionUpdateInput,
} from '../src/shared/icsApiContract';
import type { IcsSubscriptionStore } from './icsSubscriptions';

/** 주기 갱신 간격. 외부 캘린더는 실시간성이 낮아 30분이면 충분하다. */
export const ICS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

type IcsIpcHandler = (...args: unknown[]) => unknown;

export interface IcsSubscriptionIpcDeps {
  store: IcsSubscriptionStore;
  /** ipcMain.handle 과 같은 모양. */
  handle(channel: string, handler: IcsIpcHandler): void;
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
  /** 주기 갱신 실패를 남긴다. 실패해도 다음 주기는 계속 돈다. */
  logWarning?(message: string, error: unknown): void;
}

export interface IcsSubscriptionIpcRegistration {
  /** 앱 시작 직후 한 번 채워 넣는다. */
  primeOnStartup(): Promise<void>;
  dispose(): void;
}

function readOptionalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readAddInput(value: unknown): IcsSubscriptionAddInput {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    name: typeof input.name === 'string' ? input.name : '',
    url: typeof input.url === 'string' ? input.url : '',
    color: typeof input.color === 'string' ? input.color : '',
  };
}

function readUpdateInput(value: unknown): IcsSubscriptionUpdateInput {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const patch: IcsSubscriptionUpdateInput = {};
  if (typeof input.name === 'string') patch.name = input.name;
  if (typeof input.color === 'string') patch.color = input.color;
  if (typeof input.enabled === 'boolean') patch.enabled = input.enabled;
  return patch;
}

export function registerIcsSubscriptionIpc(
  deps: IcsSubscriptionIpcDeps,
): IcsSubscriptionIpcRegistration {
  const { store } = deps;

  deps.handle('ics:list', async (): Promise<IcsSubscription[]> => store.list());

  deps.handle('ics:add', async (input: unknown): Promise<IcsSubscription> => (
    store.add(readAddInput(input))
  ));

  deps.handle('ics:update', async (id: unknown, patch: unknown): Promise<IcsSubscription | null> => {
    const subscriptionId = readOptionalId(id);
    if (!subscriptionId) return null;
    return store.update(subscriptionId, readUpdateInput(patch));
  });

  deps.handle('ics:remove', async (id: unknown): Promise<void> => {
    const subscriptionId = readOptionalId(id);
    if (subscriptionId) await store.remove(subscriptionId);
  });

  deps.handle('ics:refresh', async (id: unknown): Promise<void> => {
    await store.refresh(readOptionalId(id));
  });

  deps.handle('ics:events', async (): Promise<IcsSubscriptionEvents[]> => store.events());

  const runScheduledRefresh = (): void => {
    void store.refresh(null).catch((error: unknown) => {
      // 한 주기가 실패해도 다음 주기는 계속 돈다. 사유는 구독별 lastError에도 남는다.
      deps.logWarning?.('[ICS] 주기 갱신 실패', error);
    });
  };

  const timer = deps.setInterval(runScheduledRefresh, ICS_REFRESH_INTERVAL_MS);

  return {
    async primeOnStartup() {
      try {
        await store.refresh(null);
      } catch (error) {
        deps.logWarning?.('[ICS] 시작 시 갱신 실패', error);
      }
    },
    dispose() {
      deps.clearInterval(timer);
    },
  };
}
