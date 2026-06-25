import type { Scene, Stage } from '../types';

export type SequentialStageSnapshot = Pick<Scene, Stage>;
export type SequentialStagePatch = Record<Stage, boolean>;

export const SEQUENTIAL_STAGE_ORDER: Stage[] = ['lo', 'done', 'review', 'png'];

export function buildSequentialStagePatch(
  scene: SequentialStageSnapshot,
  targetStage: Stage,
): SequentialStagePatch {
  const targetIndex = SEQUENTIAL_STAGE_ORDER.indexOf(targetStage);
  const targetWasDone = Boolean(scene[targetStage]);

  return Object.fromEntries(
    SEQUENTIAL_STAGE_ORDER.map((stage, index) => {
      const stageIsDone = targetWasDone
        ? index < targetIndex
        : index <= targetIndex;
      return [stage, stageIsDone];
    }),
  ) as SequentialStagePatch;
}

export function getChangedSequentialStages(
  scene: SequentialStageSnapshot,
  patch: SequentialStagePatch,
): Stage[] {
  return SEQUENTIAL_STAGE_ORDER.filter((stage) => Boolean(scene[stage]) !== patch[stage]);
}

export function isSequentialStageComplete(scene: SequentialStageSnapshot): boolean {
  return SEQUENTIAL_STAGE_ORDER.every((stage) => Boolean(scene[stage]));
}

export async function persistSequentialStagePatchWithRollback(
  changedStages: Stage[],
  patch: SequentialStagePatch,
  previous: SequentialStageSnapshot,
  writeStage: (stage: Stage, value: boolean) => Promise<void>,
): Promise<void> {
  try {
    for (const changedStage of changedStages) {
      await writeStage(changedStage, patch[changedStage]);
    }
  } catch (err) {
    await Promise.allSettled(
      changedStages.map((changedStage) =>
        writeStage(changedStage, Boolean(previous[changedStage])),
      ),
    );
    throw err;
  }
}

export function enqueueSequentialStageSave(
  queue: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = queue.get(key) ?? Promise.resolve();
  let next: Promise<void>;
  next = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (queue.get(key) === next) {
        queue.delete(key);
      }
    });
  queue.set(key, next);
  return next;
}
