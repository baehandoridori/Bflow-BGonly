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

/* ─── 저장 실패 자동 재전송 (움직임 폴리싱 20번 safety-net) ─────────────── */

/**
 * 아직 저장이 확인되지 않은 칸들.
 * - stages: 함께 보낼 칸(LO→PNG 순) · desired: 보낼 값 · baseline: 되돌릴 값(첫 저장 전 값)
 * - expected: 클릭 직후 화면에 보이던 값. 보통 desired 와 같지만, 액팅 씬은 단계 상태가 체크 4개를 다시 맞춰
 *   달라질 수 있다(예: '대기' 칸만 켜면 단계가 대기라 체크가 모두 꺼진다). '아직 내 값인가'는 이 값으로 본다.
 */
export interface PendingStageWrites {
  stages: Stage[];
  desired: Partial<Record<Stage, boolean>>;
  baseline: Partial<Record<Stage, boolean>>;
  expected: Partial<Record<Stage, boolean>>;
}

/** 화면 값이 아직 내 클릭 직후 값인 칸만. 그 사이 바뀐 칸(다른 사람·주기 동기화)은 빠진다 — 덮지도 되돌리지도 않는다. */
export function stagesStillMine(writes: PendingStageWrites, scene: SequentialStageSnapshot): Stage[] {
  return writes.stages.filter((stage) => Boolean(scene[stage]) === writes.expected[stage]);
}

/** 내 값이 아니게 된 칸 중 처음 값으로 돌아간 칸 — 내 클릭이 저장되지 않은 채 화면에서 사라진 칸이다. */
export function stagesRevertedToBaseline(writes: PendingStageWrites, scene: SequentialStageSnapshot): Stage[] {
  return writes.stages.filter(
    (stage) => Boolean(scene[stage]) !== writes.expected[stage] && Boolean(scene[stage]) === writes.baseline[stage],
  );
}

/**
 * 보내는 중이거나 다시 보낼 차례를 기다리던 칸에 새 클릭을 얹는다. 새 저장은 앞 저장의 칸까지 마지막 값으로 함께 보낸다
 * (앞 저장의 재전송은 취소된다). 되돌릴 값은 가장 처음 저장 전 값을 지킨다.
 * scene 은 이번 클릭을 화면에 반영하기 직전 값이다. expected 는 desired 로 채워 두고, 호출자가 클릭 직후 화면 값으로 고친다.
 */
export function mergePendingStageWrites(
  pending: PendingStageWrites | undefined,
  scene: SequentialStageSnapshot,
  patch: SequentialStagePatch,
  changedStages: readonly Stage[],
): PendingStageWrites {
  const carried = pending ? stagesStillMine(pending, scene) : [];
  const stages = SEQUENTIAL_STAGE_ORDER.filter((stage) => changedStages.includes(stage) || carried.includes(stage));
  const desired: Partial<Record<Stage, boolean>> = {};
  const baseline: Partial<Record<Stage, boolean>> = {};
  for (const stage of stages) {
    desired[stage] = changedStages.includes(stage) ? patch[stage] : pending?.desired[stage];
    baseline[stage] = carried.includes(stage) ? pending?.baseline[stage] : Boolean(scene[stage]);
  }
  return { stages, desired, baseline, expected: { ...desired } };
}

/** 클릭을 화면에 다 반영한 뒤의 값으로 expected 를 맞춘다. */
export function withExpectedStages(writes: PendingStageWrites, scene: SequentialStageSnapshot): PendingStageWrites {
  return {
    ...writes,
    expected: Object.fromEntries(writes.stages.map((stage) => [stage, Boolean(scene[stage])])) as Partial<Record<Stage, boolean>>,
  };
}
