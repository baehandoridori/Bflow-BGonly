import { applyMarketCommand } from './domain.ts';
import {
  fingerprintMarketCommand,
  type MarketPreviewGateway,
} from './previewGateway.ts';
import { createMarketPreviewSeed } from './seed.ts';
import type {
  Holding,
  MarketCommand,
  MarketNews,
  MarketSnapshot,
  MarketStock,
  PricePoint,
} from './types';

const STORAGE_KEY_PREFIX = 'bflow:playground-market:v2:';
const READ_ERROR_MESSAGE = '저장된 시장 정보를 읽지 못했어요. 다시 시도해 주세요.';
const MARKET_PERIODS = ['today', 'week', 'month', 'all'] as const;
const BEGINNER_MISSIONS = new Set(['favorite', 'reason', 'first-order', 'complete']);

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isPricePoint(value: unknown): value is PricePoint {
  return (
    isRecord(value)
    && isNonEmptyString(value.at)
    && isPositiveSafeInteger(value.priceWon)
    && (value.newsId === undefined || isNonEmptyString(value.newsId))
  );
}

function isMarketStock(value: unknown): value is MarketStock {
  const series = isRecord(value) ? value.series : undefined;
  if (
    !isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.symbol)
    || !isNonEmptyString(value.character)
    || !isNonEmptyString(value.description)
    || !isNonEmptyString(value.reason)
    || !isPositiveSafeInteger(value.referencePriceWon)
    || !isPositiveSafeInteger(value.previousCloseWon)
    || !isRecord(series)
  ) return false;
  return MARKET_PERIODS.every((period) => (
    Array.isArray(series[period])
    && series[period].every(isPricePoint)
  ));
}

function isMarketNews(value: unknown): value is MarketNews {
  return (
    isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.stockId)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.summary)
    && isNonEmptyString(value.publishedAt)
  );
}

function isHolding(value: unknown, stockIds: ReadonlySet<string>): value is Holding {
  return (
    isRecord(value)
    && isNonEmptyString(value.stockId)
    && stockIds.has(value.stockId)
    && isPositiveSafeInteger(value.quantityShares)
    && isNonNegativeSafeInteger(value.costBasisWon)
  );
}

function hasValidAccount(value: unknown, stockIds: ReadonlySet<string>): boolean {
  if (
    !isRecord(value)
    || !isNonNegativeSafeInteger(value.walletPoints)
    || !isNonNegativeSafeInteger(value.lifetimeEarnedPoints)
    || !isNonNegativeSafeInteger(value.cashWon)
    || !isSafeInteger(value.realizedPnlThisMonthWon)
    || !isSafeInteger(value.unrealizedPnlAtMonthStartWon)
    || !Array.isArray(value.holdings)
    || !value.holdings.every((holding) => isHolding(holding, stockIds))
  ) return false;
  return hasUniqueValues(value.holdings.map((holding) => holding.stockId));
}

function hasPersistedSnapshotShape(value: unknown): value is MarketSnapshot {
  if (
    !isRecord(value)
    || !isNonNegativeSafeInteger(value.revision)
    || value.marketOpenLabel !== '24시간 열림'
    || !Array.isArray(value.stocks)
    || value.stocks.length === 0
    || !value.stocks.every(isMarketStock)
    || !Array.isArray(value.news)
    || !value.news.every(isMarketNews)
    || !Array.isArray(value.favoriteStockIds)
    || !value.favoriteStockIds.every(isNonEmptyString)
    || typeof value.beginnerMission !== 'string'
    || !BEGINNER_MISSIONS.has(value.beginnerMission)
  ) return false;

  const stockIds = value.stocks.map((stock) => stock.id);
  if (!hasUniqueValues(stockIds)) return false;
  const stockIdSet = new Set(stockIds);
  const newsIds = value.news.map((news) => news.id);
  if (
    !hasUniqueValues(newsIds)
    || value.news.some((news) => !stockIdSet.has(news.stockId))
    || !hasUniqueValues(value.favoriteStockIds)
    || value.favoriteStockIds.some((stockId) => !stockIdSet.has(stockId))
  ) return false;

  return hasValidAccount(value.account, stockIdSet);
}

function hasStringFingerprintPairs(value: unknown): value is Record<string, string> {
  return (
    isRecord(value)
    && Object.entries(value).every(([key, fingerprint]) => (
      typeof key === 'string' && typeof fingerprint === 'string'
    ))
  );
}

function parsePersistedMarketPreview(raw: string): PersistedMarketPreview {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed)
    || parsed.version !== 2
    || !hasPersistedSnapshotShape(parsed.snapshot)
    || !hasStringFingerprintPairs(parsed.requestFingerprints)
    || !isNonNegativeSafeInteger(parsed.updatedAtMs)
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
