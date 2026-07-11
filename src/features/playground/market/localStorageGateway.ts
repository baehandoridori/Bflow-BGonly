import { applyMarketCommand } from './domain.ts';
import {
  fingerprintMarketCommand,
  type MarketPreviewGateway,
} from './previewGateway.ts';
import { createMarketPreviewSeed } from './seed.ts';
import type { MarketCommand, MarketSnapshot } from './types';

const STORAGE_KEY_PREFIX = 'bflow:playground-market:v2:';
const READ_ERROR_MESSAGE = '저장된 시장 정보를 읽지 못했어요. 다시 시도해 주세요.';

interface PersistedMarketPreview {
  version: 2;
  snapshot: MarketSnapshot;
  requestFingerprints: Record<string, string>;
  updatedAtMs: number;
}

export interface MarketLocalStorageGatewayOptions {
  userId: string;
  storage: Storage;
  now: () => number;
  latencyMs?: number;
}

export class MarketStorageReadError extends Error {
  readonly retryable = true;
  readonly cause: unknown;

  constructor(cause?: unknown) {
    super(READ_ERROR_MESSAGE);
    this.name = 'MarketStorageReadError';
    this.cause = cause;
  }
}

function wait(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPersistedSnapshotShape(value: unknown): value is MarketSnapshot {
  if (!isRecord(value) || !isRecord(value.account)) return false;
  const { account } = value;
  return (
    Number.isSafeInteger(value.revision)
    && value.marketOpenLabel === '24시간 열림'
    && Array.isArray(value.stocks)
    && Array.isArray(value.news)
    && Array.isArray(value.favoriteStockIds)
    && ['favorite', 'reason', 'first-order', 'complete'].includes(String(value.beginnerMission))
    && Number.isSafeInteger(account.walletPoints)
    && Number(account.walletPoints) >= 0
    && Number.isSafeInteger(account.lifetimeEarnedPoints)
    && Number(account.lifetimeEarnedPoints) >= 0
    && Number.isSafeInteger(account.cashWon)
    && Number(account.cashWon) >= 0
    && Number.isSafeInteger(account.realizedPnlThisMonthWon)
    && Number.isSafeInteger(account.unrealizedPnlAtMonthStartWon)
    && Array.isArray(account.holdings)
  );
}

function parsePersistedMarketPreview(raw: string): PersistedMarketPreview {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed)
    || parsed.version !== 2
    || !hasPersistedSnapshotShape(parsed.snapshot)
    || !isRecord(parsed.requestFingerprints)
    || !Object.values(parsed.requestFingerprints).every((value) => typeof value === 'string')
    || !Number.isSafeInteger(parsed.updatedAtMs)
  ) {
    throw new Error('invalid market preview storage shape');
  }
  return parsed as unknown as PersistedMarketPreview;
}

function clonePersistedState(state: PersistedMarketPreview): PersistedMarketPreview {
  return structuredClone(state);
}

export function createMarketLocalStorageGateway(
  options: MarketLocalStorageGatewayOptions,
): MarketPreviewGateway {
  const userId = options.userId.trim();
  if (!userId) throw new Error('market preview user id is required');
  const key = `${STORAGE_KEY_PREFIX}${userId}`;
  const latencyMs = options.latencyMs ?? 0;

  function save(
    snapshot: MarketSnapshot,
    requestFingerprints: Record<string, string>,
  ): PersistedMarketPreview {
    const updatedAtMs = options.now();
    if (!Number.isSafeInteger(updatedAtMs)) throw new Error('market preview clock is invalid');
    const persisted: PersistedMarketPreview = {
      version: 2,
      snapshot: structuredClone(snapshot),
      requestFingerprints: { ...requestFingerprints },
      updatedAtMs,
    };
    options.storage.setItem(key, JSON.stringify(persisted));
    return persisted;
  }

  function readOrCreate(): PersistedMarketPreview {
    let raw: string | null;
    try {
      raw = options.storage.getItem(key);
    } catch (error) {
      throw new MarketStorageReadError(error);
    }
    if (raw === null) {
      try {
        return save(createMarketPreviewSeed(), {});
      } catch (error) {
        throw new MarketStorageReadError(error);
      }
    }
    try {
      return parsePersistedMarketPreview(raw);
    } catch (error) {
      throw new MarketStorageReadError(error);
    }
  }

  return {
    async read() {
      await wait(latencyMs);
      return clonePersistedState(readOrCreate()).snapshot;
    },

    async execute(command: MarketCommand) {
      await wait(latencyMs);
      const persisted = readOrCreate();
      const fingerprint = fingerprintMarketCommand(command);
      const hasPrevious = Object.prototype.hasOwnProperty.call(
        persisted.requestFingerprints,
        command.requestId,
      );
      const previousFingerprint = persisted.requestFingerprints[command.requestId];
      if (hasPrevious && previousFingerprint !== fingerprint) {
        throw new Error('request id conflict');
      }
      if (hasPrevious) return structuredClone(persisted.snapshot);

      const snapshot = applyMarketCommand(persisted.snapshot, command);
      const requestFingerprints = {
        ...persisted.requestFingerprints,
        [command.requestId]: fingerprint,
      };
      save(snapshot, requestFingerprints);
      return structuredClone(snapshot);
    },
  };
}
