import { applyMarketCommand } from './domain.ts';
import { createMarketPreviewSeed } from './seed.ts';
import type { MarketCommand, MarketSnapshot } from './types';

export interface MarketPreviewGateway {
  read(): Promise<MarketSnapshot>;
  execute(command: MarketCommand): Promise<MarketSnapshot>;
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

function fingerprintMarketCommand(command: MarketCommand): string {
  switch (command.kind) {
    case 'favorite':
      return JSON.stringify([command.kind, command.stockId, command.wished]);
    case 'read-reason':
      return JSON.stringify([command.kind, command.stockId]);
    case 'transfer':
      return JSON.stringify([command.kind, command.direction, command.points]);
    case 'buy':
      return JSON.stringify([command.kind, command.stockId, command.points]);
    case 'sell':
      return JSON.stringify([command.kind, command.stockId, command.ratioBps]);
  }
  const exhaustive: never = command;
  return exhaustive;
}

export function createMarketPreviewGateway(
  options: MarketPreviewGatewayOptions = {},
): MarketPreviewGateway {
  let snapshot = createMarketPreviewSeed();
  const latencyMs = options.latencyMs ?? 180;
  const fingerprintByRequestId = new Map<string, string>();

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
  };
}
