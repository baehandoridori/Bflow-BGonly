import {
  applyArcadePreviewCommand,
  fingerprintArcadeCommand,
  type ArcadePreviewGateway,
} from './previewGateway.ts';
import { createArcadePreviewSeed } from './seed.ts';
import type { ArcadeExecuteCommand, ArcadeExecuteResult, ArcadeSnapshot } from './types';

const STORAGE_KEY_PREFIX = 'bflow-arcade-preview-v1:';

interface PersistedArcadePreview {
  version: 1;
  snapshot: ArcadeSnapshot;
  requestFingerprints: Record<string, string>;
  requestResponses: Record<string, ArcadeExecuteResult>;
  updatedAtMs: number;
}

export interface ArcadeLocalStorageGatewayOptions {
  userId: string;
  storage: Storage;
  now: () => number;
  latencyMs?: number;
}

function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPersistedShape(value: unknown): value is PersistedArcadePreview {
  return isRecord(value) && value.version === 1 && isRecord(value.snapshot);
}

export function createArcadeLocalStorageGateway(
  options: ArcadeLocalStorageGatewayOptions,
): ArcadePreviewGateway {
  const userId = options.userId.trim();
  if (!userId) throw new Error('arcade preview user id is required');
  const key = `${STORAGE_KEY_PREFIX}${userId}`;
  const latencyMs = options.latencyMs ?? 0;

  function save(state: PersistedArcadePreview): void {
    options.storage.setItem(key, JSON.stringify(state));
  }

  function readOrCreate(): PersistedArcadePreview {
    let raw: string | null;
    try {
      raw = options.storage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (hasPersistedShape(parsed)) return parsed;
      } catch {
        /* 손상된 프리뷰 저장본은 시드로 되돌린다. */
      }
    }
    const seeded: PersistedArcadePreview = {
      version: 1,
      snapshot: createArcadePreviewSeed(userId),
      requestFingerprints: {},
      requestResponses: {},
      updatedAtMs: options.now(),
    };
    save(seeded);
    return seeded;
  }

  return {
    async read() {
      await wait(latencyMs);
      return structuredClone(readOrCreate().snapshot);
    },
    async execute(command: ArcadeExecuteCommand): Promise<ArcadeExecuteResult> {
      await wait(latencyMs);
      const persisted = readOrCreate();
      const fingerprint = fingerprintArcadeCommand(command);
      const hasPrevious = Object.prototype.hasOwnProperty.call(
        persisted.requestFingerprints,
        command.requestId,
      );
      if (hasPrevious) {
        if (persisted.requestFingerprints[command.requestId] !== fingerprint) {
          throw new Error('같은 요청이 다른 내용으로 이미 처리되었어요');
        }
        const stored = persisted.requestResponses[command.requestId];
        return { ...(stored ?? {}), replayed: true } as ArcadeExecuteResult;
      }

      const applied = applyArcadePreviewCommand(persisted.snapshot, command, {
        now: options.now(),
        userId,
      });
      save({
        version: 1,
        snapshot: applied.snapshot,
        requestFingerprints: applied.persistKey
          ? { ...persisted.requestFingerprints, [command.requestId]: fingerprint }
          : { ...persisted.requestFingerprints },
        requestResponses: applied.persistKey
          ? { ...persisted.requestResponses, [command.requestId]: applied.result }
          : { ...persisted.requestResponses },
        updatedAtMs: options.now(),
      });
      return applied.result;
    },
  };
}
