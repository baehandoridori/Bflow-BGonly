import type { Scene, ScenePhaseState, Stage } from '../types';

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

/**
 * 액팅 씬의 단계 4개(LO/완료/검수/PNG) 체크 상태로부터 단계 상태(대기/작업중/피드백/완료)와 차수를 역산한다.
 *
 * 액팅은 단계 상태가 정본이고 4개 체크는 시트뷰 호환용이라, 씬 단위로 체크를 건드리면 단계 상태도 같이 맞춰야 한다.
 * 차수는 이전 상태가 같으면 유지하고 다르면 1차부터 시작한다.
 * 씬 뷰·'나의 할 일' 위젯·컴포지팅 모달이 모두 이 한 곳을 쓴다.
 */
export function deriveActingPhaseFromStages(
  scene: { sceneState?: ScenePhaseState | null; workRound?: number | null; feedbackRound?: number | null },
  patch: SequentialStagePatch,
): { state: ScenePhaseState; workRound: number; feedbackRound: number } {
  const state: ScenePhaseState =
    patch.png ? 'done'
    : patch.review ? 'feedback'
    : patch.done ? 'work'
    : 'wait';
  const prevState: ScenePhaseState = scene.sceneState ?? 'wait';
  return {
    state,
    workRound: state === 'work'
      ? (prevState === 'work' ? Math.max(1, scene.workRound ?? 1) : 1)
      : 0,
    feedbackRound: state === 'feedback'
      ? (prevState === 'feedback' ? Math.max(1, scene.feedbackRound ?? 1) : 1)
      : 0,
  };
}

export function snapshotSequentialStages(scene: SequentialStageSnapshot): SequentialStagePatch {
  return Object.fromEntries(
    SEQUENTIAL_STAGE_ORDER.map((stage) => [stage, Boolean(scene[stage])]),
  ) as SequentialStagePatch;
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
