import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { applyMarketCommand, validateMarketCommand } from './domain.ts';
import { createMarketGateway } from './gateway.ts';
import {
  isMarketValueCommand,
  sameMarketValueCommand,
  type MarketValueCommand,
} from './pendingValueRequest.ts';
import {
  addPreviewAdminEvent,
  removePreviewAdminEvent,
  type MarketPreviewGateway,
} from './previewGateway.ts';
import type {
  MarketAdminEvent,
  MarketAdminEventInput,
  MarketCommand,
  MarketSnapshot,
} from './types';

export const MARKET_QUOTE_CHANGED_MESSAGE = '가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.';
export const MARKET_TRADING_HALTED_MESSAGE = '현재 거래가 정지되어 주문할 수 없어요.';
export const ADMIN_WRITE_UNCERTAIN_MESSAGE = '저장 결과를 확인할 수 없어 같은 작업을 다시 할 수 없어요. 시장 정보를 다시 불러와 확인해 주세요.';
export const VALUE_WRITE_AMBIGUOUS_MESSAGE = '거래 결과를 확인하지 못했어요. 같은 요청으로 결과를 다시 확인하거나 시장 정보를 다시 불러와 주세요.';
export const VALUE_PENDING_BLOCK_MESSAGE = '이전 거래 결과를 먼저 확인해야 새 거래를 시작할 수 있어요.';
export const VALUE_REFRESH_REQUIRED_MESSAGE = '최신 시장 정보를 다시 불러오기 전에는 새 거래를 시작할 수 없어요.';

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof error.message === 'string'
  ) return error.message;
  return String(error);
}

export function marketCommandFailureMessage(error: unknown): string {
  const message = errorText(error);
  if (message.includes(MARKET_QUOTE_CHANGED_MESSAGE)) return MARKET_QUOTE_CHANGED_MESSAGE;
  if (/market trading is halted|현재 거래가 정지|거래.*정지/i.test(message)) {
    return MARKET_TRADING_HALTED_MESSAGE;
  }
  return '저장하지 못했어요. 이전 상태로 되돌렸어요.';
}

export function isKnownMarketValueRejection(error: unknown): boolean {
  const message = errorText(error);
  return message.includes(MARKET_QUOTE_CHANGED_MESSAGE)
    || /market trading is halted|현재 거래가 정지|거래.*정지/i.test(message)
    || /request id conflict|같은 요청이 다른 내용/i.test(message)
    || /배한솔 계정|잔액이나 보유 수량|입력한 거래 내용|포인트 지갑 잔액|예수금이 부족|보유.*부족/i.test(message);
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  return Date.parse(left) === Date.parse(right);
}

function adminEventMatchesInput(
  event: MarketAdminEvent,
  input: MarketAdminEventInput,
): boolean {
  return event.stockId === input.stockId
    && event.kind === input.kind
    && event.title === input.title.trim()
    && event.impactBps === input.impactBps
    && sameInstant(event.startsAt, input.startsAt)
    && sameInstant(event.endsAt, input.endsAt);
}

function matchingAdminEventCount(
  snapshot: MarketSnapshot,
  input: MarketAdminEventInput,
): number {
  return snapshot.adminEvents.filter((event) => adminEventMatchesInput(event, input)).length;
}

interface MarketPreviewState {
  confirmed: MarketSnapshot | null;
  visible: MarketSnapshot | null;
  loading: boolean;
  mutating: boolean;
  adminWriteUncertain: boolean;
  valueRefreshRequired: boolean;
  pendingValueCommand: MarketValueCommand | null;
  error: string | null;
  sessionKey: string | null;
  load(sessionKey?: string): Promise<void>;
  execute(command: MarketCommand, currentPriceWon?: number): Promise<boolean>;
  createAdminEvent(input: MarketAdminEventInput): Promise<boolean>;
  deleteAdminEvent(eventId: string): Promise<boolean>;
  clearError(): void;
}

export function createMarketPreviewStore(
  gateway: MarketPreviewGateway,
): UseBoundStore<StoreApi<MarketPreviewState>> {
  let loadGeneration = 0;
  let pendingAdminSequence = 0;
  return create<MarketPreviewState>((set, get) => ({
    confirmed: null,
    visible: null,
    loading: false,
    mutating: false,
    adminWriteUncertain: false,
    valueRefreshRequired: false,
    pendingValueCommand: null,
    error: null,
    sessionKey: null,
    async load(requestedSessionKey = '__default-market-session__') {
      const generation = ++loadGeneration;
      const sessionChanged = get().sessionKey !== requestedSessionKey;
      set({
        loading: true,
        mutating: false,
        error: null,
        sessionKey: requestedSessionKey,
        ...(sessionChanged ? {
          confirmed: null,
          visible: null,
          mutating: false,
          adminWriteUncertain: false,
          valueRefreshRequired: false,
          pendingValueCommand: null,
        } : {}),
      });
      try {
        const snapshot = await gateway.read();
        if (generation !== loadGeneration || get().sessionKey !== requestedSessionKey) return;
        set({
          confirmed: snapshot,
          visible: snapshot,
          loading: false,
          mutating: false,
          adminWriteUncertain: false,
          valueRefreshRequired: false,
          pendingValueCommand: null,
        });
      } catch {
        if (generation !== loadGeneration || get().sessionKey !== requestedSessionKey) return;
        set({
          loading: false,
          mutating: false,
          error: get().adminWriteUncertain
            ? ADMIN_WRITE_UNCERTAIN_MESSAGE
            : get().pendingValueCommand
              ? VALUE_WRITE_AMBIGUOUS_MESSAGE
              : '시장 정보를 불러오지 못했어요.',
        });
      }
    },
    async execute(command, currentPriceWon) {
      const { visible, mutating, pendingValueCommand, valueRefreshRequired } = get();
      if (!visible || mutating) return false;
      if (valueRefreshRequired) {
        set({ error: VALUE_REFRESH_REQUIRED_MESSAGE });
        return false;
      }
      const valueCommand = isMarketValueCommand(command) ? command : null;
      const retryingPending = pendingValueCommand !== null
        && valueCommand !== null
        && sameMarketValueCommand(pendingValueCommand, valueCommand);

      if (pendingValueCommand && !retryingPending) {
        set({ error: VALUE_PENDING_BLOCK_MESSAGE });
        return false;
      }

      if (!retryingPending) {
        const validation = validateMarketCommand(visible, command, currentPriceWon);
        if (validation) {
          set({ error: validation });
          return false;
        }
      }

      const projected = retryingPending
        ? visible
        : applyMarketCommand(visible, command, currentPriceWon);
      const operationSessionKey = get().sessionKey;
      const operationLoadGeneration = loadGeneration;
      set({
        visible: projected,
        mutating: true,
        pendingValueCommand: valueCommand
          ? structuredClone(pendingValueCommand ?? valueCommand)
          : null,
        error: null,
      });
      try {
        const confirmed = await gateway.execute(command);
        if (
          get().sessionKey !== operationSessionKey
          || loadGeneration !== operationLoadGeneration
        ) return false;
        set({
          confirmed,
          visible: confirmed,
          mutating: false,
          valueRefreshRequired: false,
          pendingValueCommand: null,
        });
        return true;
      } catch (error) {
        if (
          get().sessionKey !== operationSessionKey
          || loadGeneration !== operationLoadGeneration
        ) return false;
        const knownValueRejection = valueCommand !== null && isKnownMarketValueRejection(error);
        const rejectionMessage = marketCommandFailureMessage(error);
        if (knownValueRejection) {
          let authoritative: MarketSnapshot;
          try {
            authoritative = await gateway.read();
          } catch {
            if (
              get().sessionKey !== operationSessionKey
              || loadGeneration !== operationLoadGeneration
            ) return false;
            set({
              visible: get().confirmed,
              mutating: false,
              valueRefreshRequired: true,
              pendingValueCommand: null,
              error: rejectionMessage,
            });
            return false;
          }
          if (
            get().sessionKey !== operationSessionKey
            || loadGeneration !== operationLoadGeneration
          ) return false;
          set({
            confirmed: authoritative,
            visible: authoritative,
            mutating: false,
            valueRefreshRequired: false,
            pendingValueCommand: null,
            error: rejectionMessage,
          });
          return false;
        }
        set({
          visible: get().confirmed,
          mutating: false,
          pendingValueCommand: valueCommand
            ? structuredClone(pendingValueCommand ?? valueCommand)
            : null,
          error: valueCommand
            ? VALUE_WRITE_AMBIGUOUS_MESSAGE
            : rejectionMessage,
        });
        return false;
      }
    },
    async createAdminEvent(input) {
      const { visible, confirmed, mutating, adminWriteUncertain } = get();
      if (adminWriteUncertain) {
        set({ error: ADMIN_WRITE_UNCERTAIN_MESSAGE });
        return false;
      }
      if (!visible || mutating) return false;
      const baseline = confirmed ?? visible;
      const baselineMatchCount = matchingAdminEventCount(baseline, input);

      let projected: MarketSnapshot;
      try {
        pendingAdminSequence += 1;
        projected = addPreviewAdminEvent(
          visible,
          input,
          `pending-event-${pendingAdminSequence}`,
        );
      } catch {
        set({ error: '시장 이벤트 입력을 확인해 주세요.' });
        return false;
      }

      const operationSessionKey = get().sessionKey;
      const operationLoadGeneration = loadGeneration;
      set({
        visible: projected,
        mutating: true,
        adminWriteUncertain: false,
        error: null,
      });
      try {
        // 관리자 RPC에는 request id가 없으므로 응답 유실 시 자동 재시도하지 않는다.
        const confirmed = await gateway.createAdminEvent(input);
        if (get().sessionKey !== operationSessionKey) return false;
        set({
          confirmed,
          visible: confirmed,
          mutating: false,
          adminWriteUncertain: false,
        });
        return true;
      } catch {
        if (
          get().sessionKey !== operationSessionKey
          || loadGeneration !== operationLoadGeneration
        ) return false;
        let authoritative: MarketSnapshot;
        try {
          authoritative = await gateway.read();
        } catch {
          if (
            get().sessionKey !== operationSessionKey
            || loadGeneration !== operationLoadGeneration
          ) return false;
          set({
            visible: get().confirmed,
            mutating: false,
            adminWriteUncertain: true,
            error: ADMIN_WRITE_UNCERTAIN_MESSAGE,
          });
          return false;
        }
        if (
          get().sessionKey !== operationSessionKey
          || loadGeneration !== operationLoadGeneration
        ) return false;
        const applied = matchingAdminEventCount(authoritative, input) > baselineMatchCount;
        set({
          confirmed: authoritative,
          visible: authoritative,
          mutating: false,
          adminWriteUncertain: false,
          error: applied
            ? null
            : '시장 이벤트가 서버에 반영되지 않았어요. 내용을 확인하고 다시 시도해 주세요.',
        });
        return applied;
      }
    },
    async deleteAdminEvent(eventId) {
      const { visible, mutating, adminWriteUncertain } = get();
      if (adminWriteUncertain) {
        set({ error: ADMIN_WRITE_UNCERTAIN_MESSAGE });
        return false;
      }
      if (!visible || mutating) return false;

      let projected: MarketSnapshot;
      try {
        projected = removePreviewAdminEvent(visible, eventId);
      } catch {
        set({ error: '종료할 시장 이벤트를 찾지 못했어요.' });
        return false;
      }

      const operationSessionKey = get().sessionKey;
      const operationLoadGeneration = loadGeneration;
      set({
        visible: projected,
        mutating: true,
        adminWriteUncertain: false,
        error: null,
      });
      try {
        // 삭제 역시 비멱등 RPC이므로 호출은 한 번만 수행한다.
        const confirmed = await gateway.deleteAdminEvent(eventId);
        if (get().sessionKey !== operationSessionKey) return false;
        set({
          confirmed,
          visible: confirmed,
          mutating: false,
          adminWriteUncertain: false,
        });
        return true;
      } catch {
        if (
          get().sessionKey !== operationSessionKey
          || loadGeneration !== operationLoadGeneration
        ) return false;
        let authoritative: MarketSnapshot;
        try {
          authoritative = await gateway.read();
        } catch {
          if (
            get().sessionKey !== operationSessionKey
            || loadGeneration !== operationLoadGeneration
          ) return false;
          set({
            visible: get().confirmed,
            mutating: false,
            adminWriteUncertain: true,
            error: ADMIN_WRITE_UNCERTAIN_MESSAGE,
          });
          return false;
        }
        if (
          get().sessionKey !== operationSessionKey
          || loadGeneration !== operationLoadGeneration
        ) return false;
        const applied = !authoritative.adminEvents.some((event) => event.id === eventId);
        set({
          confirmed: authoritative,
          visible: authoritative,
          mutating: false,
          adminWriteUncertain: false,
          error: applied
            ? null
            : '시장 이벤트가 서버에서 종료되지 않았어요. 내용을 확인하고 다시 시도해 주세요.',
        });
        return applied;
      }
    },
    clearError() {
      set({ error: null });
    },
  }));
}

export const useMarketPreviewStore = createMarketPreviewStore(createMarketGateway());
