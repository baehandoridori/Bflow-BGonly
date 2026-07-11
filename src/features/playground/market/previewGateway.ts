import { applyMarketCommand } from './domain.ts';
import { createMarketPreviewSeed } from './seed.ts';
import type { MarketAdminEventInput, MarketCommand, MarketSnapshot } from './types';

export interface MarketPreviewGateway {
  read(): Promise<MarketSnapshot>;
  execute(command: MarketCommand): Promise<MarketSnapshot>;
  createAdminEvent(input: MarketAdminEventInput): Promise<MarketSnapshot>;
  deleteAdminEvent(eventId: string): Promise<MarketSnapshot>;
}

export interface MarketPreviewGatewayOptions {
  latencyMs?: number;
  failRequestIds?: Set<string>;
  failRead?: boolean;
}

function wait(ms: number) {
  return ms <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function fingerprintMarketCommand(command: MarketCommand): string {
  switch (command.kind) {
    case 'favorite':
      return JSON.stringify([command.kind, command.stockId, command.wished]);
    case 'read-reason':
      return JSON.stringify([command.kind, command.stockId]);
    case 'transfer':
      return JSON.stringify([command.kind, command.direction, command.points]);
    case 'buy':
      return JSON.stringify([
        command.kind,
        command.stockId,
        command.quantityShares,
        command.quotedPriceWon,
        command.quotedRevision,
      ]);
    case 'sell':
      return JSON.stringify([
        command.kind,
        command.stockId,
        command.quantityShares,
        command.quotedPriceWon,
        command.quotedRevision,
      ]);
  }
  const exhaustive: never = command;
  return exhaustive;
}

export function addPreviewAdminEvent(
  snapshot: MarketSnapshot,
  input: MarketAdminEventInput,
  eventId: string,
): MarketSnapshot {
  const stockExists = snapshot.stocks.some((stock) => stock.id === input.stockId);
  const startsAtMs = Date.parse(input.startsAt);
  const endsAtMs = input.endsAt === null ? null : Date.parse(input.endsAt);
  if (
    !stockExists
    || !input.title.trim()
    || !Number.isSafeInteger(input.impactBps)
    || !Number.isFinite(startsAtMs)
    || (endsAtMs !== null && (!Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs))
  ) {
    throw new Error('시장 이벤트 입력을 확인해 주세요.');
  }
  const next = structuredClone(snapshot);
  next.revision += 1;
  next.adminEvents.push({
    id: eventId,
    stockId: input.stockId,
    kind: input.kind,
    title: input.title.trim(),
    impactBps: input.impactBps,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    revision: next.revision,
  });
  return next;
}

export function removePreviewAdminEvent(
  snapshot: MarketSnapshot,
  eventId: string,
): MarketSnapshot {
  if (!snapshot.adminEvents.some((event) => event.id === eventId)) {
    throw new Error('삭제할 시장 이벤트를 찾지 못했어요.');
  }
  const next = structuredClone(snapshot);
  next.revision += 1;
  next.adminEvents = next.adminEvents.filter((event) => event.id !== eventId);
  return next;
}

export function createMarketPreviewGateway(
  options: MarketPreviewGatewayOptions = {},
): MarketPreviewGateway {
  let snapshot = createMarketPreviewSeed();
  const latencyMs = options.latencyMs ?? 180;
  const fingerprintByRequestId = new Map<string, string>();
  let eventSequence = 0;

  return {
    async read() {
      await wait(latencyMs);
      if (options.failRead) throw new Error('preview gateway read failed');
      return structuredClone(snapshot);
    },
    async execute(command) {
      await wait(latencyMs);
      if (options.failRequestIds?.has(command.requestId)) {
        throw new Error('preview gateway rejected request');
      }

      const fingerprint = fingerprintMarketCommand(command);
      const previousFingerprint = fingerprintByRequestId.get(command.requestId);
      if (previousFingerprint && previousFingerprint !== fingerprint) {
        throw new Error('request id conflict');
      }
      if (previousFingerprint) return structuredClone(snapshot);

      snapshot = applyMarketCommand(snapshot, command);
      fingerprintByRequestId.set(command.requestId, fingerprint);
      return structuredClone(snapshot);
    },
    async createAdminEvent(input) {
      await wait(latencyMs);
      snapshot = addPreviewAdminEvent(snapshot, input, `preview-event-${++eventSequence}`);
      return structuredClone(snapshot);
    },
    async deleteAdminEvent(eventId) {
      await wait(latencyMs);
      snapshot = removePreviewAdminEvent(snapshot, eventId);
      return structuredClone(snapshot);
    },
  };
}
