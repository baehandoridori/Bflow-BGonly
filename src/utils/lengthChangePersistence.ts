export type LengthChangeValue = 'LD' | 'SD' | null;

export interface LengthChangeTarget {
  uuid: string;
  prev: LengthChangeValue;
}

export interface LengthChangePersistenceOptions {
  updateScene: (uuid: string, value: LengthChangeValue) => void;
  saveSceneField: (uuid: string, value: string) => Promise<void> | void;
  logPrefix?: string;
  logError?: (message: string, reason: unknown) => void;
}

export interface LengthChangePersistenceResult {
  ok: boolean;
  failedUuids: string[];
  reversedUuids: string[];
}

function valueToStorage(value: LengthChangeValue): string {
  return value ?? '';
}

export function saveLengthChangeField(uuid: string, value: string): Promise<void> {
  return window.electronAPI?.supabaseUpdateSceneField?.(uuid, 'lengthChange', value) ?? Promise.resolve();
}

export async function persistLengthChangeAtomic(
  targets: LengthChangeTarget[],
  value: LengthChangeValue,
  { updateScene, saveSceneField, logPrefix = 'lengthChange', logError = console.error }: LengthChangePersistenceOptions,
): Promise<LengthChangePersistenceResult> {
  if (targets.length === 0) return { ok: true, failedUuids: [], reversedUuids: [] };

  const valueStr = valueToStorage(value);
  for (const target of targets) updateScene(target.uuid, value);

  const results = await Promise.allSettled(
    targets.map((target) => Promise.resolve(saveSceneField(target.uuid, valueStr))),
  );
  const failedIndexes = results
    .map((result, index) => result.status === 'rejected' ? index : -1)
    .filter((index) => index >= 0);

  if (failedIndexes.length === 0) return { ok: true, failedUuids: [], reversedUuids: [] };

  for (const target of targets) updateScene(target.uuid, target.prev);

  const reversedUuids: string[] = [];
  await Promise.allSettled(
    results.map(async (result, index) => {
      const target = targets[index];
      if (result.status === 'rejected') {
        logError(`[${logPrefix}] ${target.uuid} 저장 실패`, result.reason);
        return;
      }
      await Promise.resolve(saveSceneField(target.uuid, valueToStorage(target.prev)));
      reversedUuids.push(target.uuid);
    }),
  );

  return {
    ok: false,
    failedUuids: failedIndexes.map((index) => targets[index].uuid),
    reversedUuids,
  };
}

export async function persistLengthChangeIndependent(
  targets: LengthChangeTarget[],
  value: LengthChangeValue,
  { updateScene, saveSceneField, logPrefix = 'lengthChange', logError = console.error }: LengthChangePersistenceOptions,
): Promise<LengthChangePersistenceResult> {
  if (targets.length === 0) return { ok: true, failedUuids: [], reversedUuids: [] };

  const valueStr = valueToStorage(value);
  for (const target of targets) updateScene(target.uuid, value);

  const results = await Promise.allSettled(
    targets.map((target) => Promise.resolve(saveSceneField(target.uuid, valueStr))),
  );
  const failedUuids: string[] = [];

  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const target = targets[index];
    failedUuids.push(target.uuid);
    updateScene(target.uuid, target.prev);
    logError(`[${logPrefix}] ${target.uuid} 저장 실패`, result.reason);
  });

  return { ok: failedUuids.length === 0, failedUuids, reversedUuids: [] };
}
