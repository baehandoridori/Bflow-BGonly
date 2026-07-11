import { fingerprintMarketCommand } from './previewGateway.ts';
import type { MarketCommand } from './types.ts';

export type MarketValueCommand = Extract<
  MarketCommand,
  { kind: 'buy' | 'sell' | 'transfer' }
>;

export interface PendingMarketValueRequest<TDetails> {
  command: MarketValueCommand;
  details: TDetails;
  fingerprint: string;
}

export function isMarketValueCommand(command: MarketCommand): command is MarketValueCommand {
  return command.kind === 'buy' || command.kind === 'sell' || command.kind === 'transfer';
}

export function sameMarketValueCommand(
  left: MarketValueCommand,
  right: MarketValueCommand,
): boolean {
  return left.requestId === right.requestId
    && fingerprintMarketCommand(left) === fingerprintMarketCommand(right);
}

export function createPendingMarketValueRequest<TDetails>(
  command: MarketValueCommand,
  details: TDetails,
): PendingMarketValueRequest<TDetails> {
  return {
    command: structuredClone(command),
    details: structuredClone(details),
    fingerprint: fingerprintMarketCommand(command),
  };
}

export function retryPendingMarketValueCommand<TDetails>(
  pending: PendingMarketValueRequest<TDetails>,
): MarketValueCommand {
  return structuredClone(pending.command);
}
