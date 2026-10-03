/* ═══════════════════════════════════════════════════════════════
   씬 단계 저장 재전송 묶음(carry)의 판단 (움직임 폴리싱 20번 safety-net — 한솔 결정 2026-10-03)

   씬 목록의 세 저장 경로(씬 단위 LO/완료/검수/PNG 칸 · 액팅 단계 칩 · 담당자별 버튼)가 같은 판단을 쓰도록
   화면 코드(ScenesView)에서 떼어 낸 순수 함수들이다.

   - 넘겨받기: 같은 칸 묶음을 저장 확인 전에 또 누르면 새 저장이 앞 저장을 넘겨받는다. 앞 저장의 요청이 그 뒤에
     서버에 닿으면(advance*) 새 저장의 되돌릴 기준값을 앞 저장이 실제로 쓴 값으로 앞당긴다. 그래야 새 저장이
     끝내 실패해도 이미 저장된 앞 클릭까지 되돌리지 않는다.
   - 받아오기 덮기 막기(*RepaintPatch): 저장을 기다리는 동안 받아오기(15초 주기·새로고침·실시간 재로드·재연결)가
     옛 서버 값, 곧 처음 값을 읽어 오면 내 값을 다시 얹는다(마지막에 보낸 사람이 이긴다). 처음 값도 내 값도 아닌
     값이면 얹지 않는다 — 다시 보내기 직전에 그 칸을 빼고 멈춘다.
   - 다시 보내기 직전(narrowStageWritesForRetry): 아직 내 값인 칸만 보낸다. 다른 값이 된 칸은 덮지 않는다.
     그 결과 씬이 완료가 아니면 완료 도장도 쓰지 않는다(planCompletionStampDrop).
   - 끝내 실패(plan*GiveUp): 아직 내 값일 때만 처음 값으로 되돌린다. 남의 값이면 아무것도 건드리지 않는다.
     함께 바꾼 완료 기록·액팅 단계·담당자별 진행도 지금 값이 이 저장이 만든 값일 때만 되돌린다.

   node --test 가 그대로 import 하도록 @/ 별칭·외부 패키지를 쓰지 않는다(공용 모듈은 .ts 확장자까지 적은 상대 경로).
   ═══════════════════════════════════════════════════════════════ */

import type { Scene, SceneAssigneeProgress, SceneAssigneeProgressMap, ScenePhaseState, Stage } from '../types';
import {
  isSequentialStageComplete,
  stagesRevertedToBaseline,
  stagesStillMine,
  type PendingStageWrites,
  type SequentialStageSnapshot,
} from './sceneStageProgression.ts';

export type CompletionStamp = { completedBy: string; completedAt: string };

export interface PhaseFields {
  sceneState: ScenePhaseState;
  workRound: number;
  feedbackRound: number;
}

/** 씬 단위 LO/완료/검수/PNG 칸 묶음. */
export interface StageSaveSlotCarry {
  writes: PendingStageWrites;
  /** 되돌릴 완료 기록·액팅 단계·담당자별 진행 — 첫 저장 전 값(앞 저장이 서버에 닿으면 그 결과로 앞당긴다). */
  baseCompletion: CompletionStamp;
  basePhase: PhaseFields | null;
  baseAssigneeProgress: Scene['assigneeProgress'];
  /** 마지막으로 정한 완료 기록(묶음 안에서 한 번이라도 바뀌었으면). */
  completion: CompletionStamp | null;
  /** 이 저장이 화면에 맞춘 액팅 단계(액팅 씬만) — 끝내 실패할 때 지금 단계가 이 값일 때만 되돌린다. */
  minePhase: PhaseFields | null;
  assigneeTouched: boolean;
  /** 이 저장이 화면에 얹은 담당자별 진행 — 끝내 실패할 때 지금 값이 이것과 같을 때만 되돌린다. */
  mineAssigneeProgress: SceneAssigneeProgressMap | undefined;
}

/** 액팅 단계 칩 묶음. */
export interface PhaseSaveSlotCarry {
  base: Pick<Scene, 'sceneState' | 'workRound' | 'feedbackRound' | Stage | 'completedBy' | 'completedAt' | 'assigneeProgress'>;
  completion: CompletionStamp | null;
}

/** 담당자 한 명의 버튼 묶음. */
export interface AssigneeSaveSlotCarry {
  prevScene: Scene;
  completion: { nextCompletedBy: string; nextCompletedAt: string } | null;
  cells: string[];
}

/* ─── 값 비교 ─── */

type PhaseLike = { sceneState?: ScenePhaseState | null; workRound?: number | null; feedbackRound?: number | null };

export function phaseFieldsOf(scene: PhaseLike): PhaseFields {
  return {
    sceneState: scene.sceneState ?? 'wait',
    workRound: scene.workRound ?? 0,
    feedbackRound: scene.feedbackRound ?? 0,
  };
}

export function samePhase(a: PhaseFields, b: PhaseFields): boolean {
  return a.sceneState === b.sceneState && a.workRound === b.workRound && a.feedbackRound === b.feedbackRound;
}

export function completionOf(scene: { completedBy?: string | null; completedAt?: string | null }): CompletionStamp {
  return { completedBy: scene.completedBy ?? '', completedAt: scene.completedAt ?? '' };
}

export function sameCompletion(a: CompletionStamp, b: CompletionStamp): boolean {
  return a.completedBy === b.completedBy && a.completedAt === b.completedAt;
}

/** 담당자 한 명의 진행 값이 같은가(저장 시각·저장한 사람은 빼고). */
export function sameAssigneeProgress(a: SceneAssigneeProgress, b: SceneAssigneeProgress): boolean {
  return (['lo', 'done', 'review', 'png', 'sceneState', 'workRound', 'feedbackRound'] as const)
    .every((key) => (a[key] ?? null) === (b[key] ?? null));
}

/** 담당자별 진행 전체가 같은가(담당자마다 sameAssigneeProgress). 한쪽에만 있는 담당자는 빈 진행과 비교한다. */
export function sameAssigneeProgressMap(
  a: SceneAssigneeProgressMap | null | undefined,
  b: SceneAssigneeProgressMap | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((name) => sameAssigneeProgress(a[name] ?? {}, b[name] ?? {}));
}

export type PendingVerdict = 'mine' | 'reverted' | 'other';

/**
 * 저장을 기다리는 값이 지금 어떤가.
 * 'mine': 아직 내 값 · 'reverted': 처음 값으로 돌아감(받아오기가 옛 서버 값을 읽어 옴 등) · 'other': 그 밖의 값(또는 씬이 사라짐).
 */
export function judgePending<T>(current: T | null | undefined, mine: T, base: T | null | undefined, same: (a: T, b: T) => boolean): PendingVerdict {
  if (current == null) return 'other';
  if (same(current, mine)) return 'mine';
  if (base != null && same(current, base)) return 'reverted';
  return 'other';
}

/* ─── 씬 단위 칸 ─── */

/** 다시 보내기 직전 — 아직 내 값인 칸만 남긴다. 다른 값이 된 칸은 빼고(덮지 않는다) dropped 로 돌려준다. */
export function narrowStageWritesForRetry(
  writes: PendingStageWrites,
  scene: SequentialStageSnapshot,
): { writes: PendingStageWrites; dropped: Stage[] } {
  const mine = stagesStillMine(writes, scene);
  const dropped = writes.stages.filter((stage) => !mine.includes(stage));
  return { writes: dropped.length > 0 ? { ...writes, stages: mine } : writes, dropped };
}

/**
 * 받아오기가 이 씬을 옛 서버 값으로 덮을 때 — 처음 값으로 돌아간 내 칸을 다시 칠할 패치(없으면 null).
 * current(받아오기 직전 화면 값)에서 아직 내 값인 칸만 다시 칠한다. 화면에서 이미 다른 값으로 바뀐 칸
 * (내 다른 버튼·팀원의 실시간 변경)은 받아오기 값을 그대로 둔다.
 * 칸을 다시 칠할 때는 같은 클릭이 함께 바꾼 완료 기록·액팅 단계도, 그것이 처음 값으로 돌아가 있으면 다시 얹는다.
 * (담당자별 진행은 이 씬의 최신 값에 같은 변경을 다시 적용해야 해서 호출자가 붙인다.)
 * phase: 이 클릭이 액팅 단계를 함께 맞췄으면 그 값.
 */
export function stageRepaintPatch(
  carry: StageSaveSlotCarry,
  incoming: Scene,
  current: SequentialStageSnapshot,
  phase: PhaseFields | null,
): Partial<Scene> | null {
  const stillMine = stagesStillMine(carry.writes, current);
  const reverted = stagesRevertedToBaseline(carry.writes, incoming).filter((stage) => stillMine.includes(stage));
  if (reverted.length === 0) return null;
  const patch: Partial<Scene> = {};
  for (const stage of reverted) patch[stage] = carry.writes.expected[stage] === true;
  if (carry.completion && sameCompletion(completionOf(incoming), carry.baseCompletion)) {
    Object.assign(patch, carry.completion);
  }
  if (phase && carry.basePhase && samePhase(phaseFieldsOf(incoming), carry.basePhase)) {
    Object.assign(patch, phase);
  }
  return patch;
}

/** 끝내 실패·다시 보내기 직전에 보는 지금 씬 — 단계 칸과 함께 바꾼 완료 기록·액팅 단계·담당자별 진행. */
export type StageSceneNow = SequentialStageSnapshot &
  Partial<Pick<Scene, 'completedBy' | 'completedAt' | 'sceneState' | 'workRound' | 'feedbackRound' | 'assigneeProgress'>>;

/**
 * 끝내 실패 — 아직 내 값인 칸만 되돌린다. 내 칸이 하나도 없으면(모두 다른 값) null: 아무것도 건드리지 않는다.
 * 같은 클릭이 함께 바꾼 완료 기록·액팅 단계·담당자별 진행도 지금 값이 이 저장이 만든 값과 같을 때만 되돌린다
 * (그 사이 받아오기·실시간이 새 값을 가져왔으면 그 값을 덮지 않는다).
 * rolled: 되돌리는 칸(서버에도 처음 값을 다시 쓴다) · shown: 그중 화면 값이 실제로 바뀌는 칸(표시·안내용) · patch: 화면에 얹을 값.
 */
export function planStageGiveUp(
  carry: StageSaveSlotCarry,
  scene: StageSceneNow,
): { rolled: Stage[]; shown: Stage[]; patch: Partial<Scene> } | null {
  const rolled = stagesStillMine(carry.writes, scene);
  if (rolled.length === 0) return null;
  const { baseline, expected } = carry.writes;
  const patch: Partial<Scene> = {};
  for (const stage of rolled) patch[stage] = baseline[stage] === true;
  if (carry.completion && sameCompletion(completionOf(scene), carry.completion)) {
    Object.assign(patch, carry.baseCompletion);
  }
  if (carry.basePhase && carry.minePhase && samePhase(phaseFieldsOf(scene), carry.minePhase)) {
    Object.assign(patch, carry.basePhase);
  }
  if (carry.assigneeTouched && sameAssigneeProgressMap(scene.assigneeProgress, carry.mineAssigneeProgress)) {
    patch.assigneeProgress = carry.baseAssigneeProgress;
  }
  const changed = rolled.filter((stage) => expected[stage] !== (baseline[stage] === true));
  return { rolled, shown: changed.length > 0 ? changed : rolled, patch };
}

/**
 * 다시 보내기 직전 — 지금 씬이 완료가 아니면 이 저장의 완료 도장(누가·언제 모두 완료)을 쓰지 않는다.
 * (칸을 빼고 남은 칸만 보낼 때, 또는 이 저장이 보내지 않는 칸이 그 사이 바뀌었을 때. 완료 기록은 저장의 맨 끝에 쓰므로
 * 다시 보낸다는 것은 이 저장이 아직 도장을 쓰지 않았다는 뜻이다.) 완료 해제('')는 그대로 둔다.
 * null: 그대로 · { screen }: 도장을 거둔다. screen 은 화면이 아직 내 도장일 때 되돌릴 완료 기록(남의 값이면 null — 건드리지 않는다).
 */
export function planCompletionStampDrop(
  carry: StageSaveSlotCarry,
  scene: StageSceneNow,
): { screen: CompletionStamp | null } | null {
  const stamp = carry.completion;
  if (!stamp || !stamp.completedBy || !stamp.completedAt) return null;
  if (isSequentialStageComplete(scene)) return null;
  return { screen: sameCompletion(completionOf(scene), stamp) ? carry.baseCompletion : null };
}

/** 앞 저장이 서버에 실제로 쓴 값. 쓰지 못한 부분은 null. */
export interface SavedStageResult {
  stages: readonly Stage[];
  desired: Partial<Record<Stage, boolean>>;
  completion: CompletionStamp | null;
  phase: PhaseFields | null;
  assigneeProgress: SceneAssigneeProgressMap | null;
}

/**
 * 넘겨준 앞 저장이 서버에 닿았다 — 뒤 저장(next)의 되돌릴 기준값을 앞 저장이 쓴 값으로 앞당긴다(next 를 고친다).
 * 뒤 저장이 함께 보내는 칸만 앞당긴다. 뒤 저장이 이미 빼 버린 칸(다른 값이 됨)은 건드리지 않는다.
 */
export function advanceStageCarry(next: StageSaveSlotCarry, saved: SavedStageResult): void {
  const baseline = { ...next.writes.baseline };
  let moved = false;
  for (const stage of saved.stages) {
    if (!next.writes.stages.includes(stage)) continue;
    baseline[stage] = saved.desired[stage] === true;
    moved = true;
  }
  if (moved) next.writes = { ...next.writes, baseline };
  if (saved.completion) next.baseCompletion = saved.completion;
  if (saved.phase && next.basePhase) next.basePhase = saved.phase;
  if (saved.assigneeProgress && next.assigneeTouched) next.baseAssigneeProgress = saved.assigneeProgress;
}

/* ─── 액팅 단계 칩 ─── */

/** 끝내 실패 — 지금 단계가 아직 내 값일 때만 처음 값(base)을 돌려준다. 다른 값이면 null(그대로 둔다). */
export function planPhaseGiveUp(
  current: PhaseLike | null | undefined,
  mine: PhaseFields,
  base: PhaseSaveSlotCarry['base'],
): PhaseSaveSlotCarry['base'] | null {
  return current && samePhase(phaseFieldsOf(current), mine) ? base : null;
}

/** 넘겨준 앞 저장의 단계가 서버에 닿았다 — 뒤 저장의 되돌릴 단계를 그 값으로 앞당긴다(완료 기록·담당자 진행은 앞 저장이 쓰지 않았다). */
export function advancePhaseCarry(next: PhaseSaveSlotCarry, saved: PhaseFields & Pick<Scene, Stage>): void {
  next.base = { ...next.base, ...saved };
}

/* ─── 담당자별 버튼 ─── */

/** 끝내 실패 — 이 담당자 몫만 처음 값으로. 그 사이 저장된 다른 담당자의 값은 그대로 둔다. */
export function restoreAssigneeEntry(
  latest: SceneAssigneeProgressMap | undefined,
  assigneeName: string,
  baseEntry: SceneAssigneeProgress | undefined,
): SceneAssigneeProgressMap {
  return { ...(latest ?? {}), [assigneeName]: baseEntry ?? {} };
}

/** 넘겨준 앞 저장이 서버에 닿았다 — 뒤 저장의 되돌릴 기준(이 담당자 몫·완료 기록)을 앞 저장이 쓴 값으로 앞당긴다. */
export function advanceAssigneeCarry(
  next: AssigneeSaveSlotCarry,
  assigneeName: string,
  savedEntry: SceneAssigneeProgress,
  savedCompletion: CompletionStamp | null,
): void {
  next.prevScene = {
    ...next.prevScene,
    assigneeProgress: { ...(next.prevScene.assigneeProgress ?? {}), [assigneeName]: savedEntry },
    ...(savedCompletion ?? {}),
  };
}
