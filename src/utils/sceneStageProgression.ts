import type { Scene, Stage } from '../types';

export type SequentialStageSnapshot = Pick<Scene, Stage>;
export type SequentialStagePatch = Record<Stage, boolean>;

export const SEQUENTIAL_STAGE_ORDER: Stage[] = ['lo', 'done', 'review', 'png'];

export function buildSequentialStagePatch(
  scene: SequentialStageSnapshot,
  targetStage: Stage,
): SequentialStagePatch {
  const targetIndex = SEQUENTIAL_STAGE_ORDER.indexOf(targetStage);
  const shouldAdvance = !scene[targetStage];

  return Object.fromEntries(
    SEQUENTIAL_STAGE_ORDER.map((stage, index) => [
      stage,
      shouldAdvance ? index <= targetIndex : index < targetIndex,
    ]),
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
