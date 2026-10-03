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
     함께 다시 쓰는 곁 값(완료 기록·액팅 단계와 차수·담당자별 진행)도 그 사이 남의 값이 됐으면 다시 쓰지 않는다
     (planCompletionStampDrop · planSideFieldDrop — 코덱스 2차 지적 4172094264). 칸 패턴이 그대로여도 팀원이 작업·피드백
     차수만 올렸을 수 있다.
   - 끝내 실패(plan*GiveUp): 아직 내 값일 때만 처음 값으로 되돌린다. 남의 값이면 아무것도 건드리지 않는다.
     함께 바꾼 완료 기록·액팅 단계·담당자별 진행도 지금 값이 이 저장이 만든 값일 때만 되돌린다.
   - 넘겨받을 때(carriedSideBases·inheritPhaseBase·inheritCompletion): 앞 저장의 곁 값이 아직 화면에 있을 때만 앞 저장의
     기준·완료 기록을 잇는다. 그 사이 남이 바꿨으면 지금 값이 새 기준이다(칸의 mergePendingStageWrites 와 같은 규칙).

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
  /** 이 저장이 화면에 맞춘 단계·차수 — 다음 칩이 넘겨받을 때 앞 저장의 처음 값을 이을지 본다. */
  mine?: PhaseFields;
  /** 이 저장이 화면에 얹은 담당자별 진행(담당자가 여럿일 때) — 뒤늦은 기록·끝내 실패에서 지금 값이 이것일 때만 손댄다. */
  mineAssigneeProgress?: SceneAssigneeProgressMap;
}

/** 담당자 한 명의 버튼 묶음. */
export interface AssigneeSaveSlotCarry {
  prevScene: Scene;
  completion: { nextCompletedBy: string; nextCompletedAt: string } | null;
  cells: string[];
  /** 이 저장이 화면에 얹은 이 담당자 값 — 다음 버튼이 넘겨받을 때 앞 저장의 처음 값을 이을지 본다. */
  mineEntry?: SceneAssigneeProgress;
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

/** 담당자별 진행 전체가 지금 어떤가(judgePending 과 같은 뜻). 진행이 아직 없는 것(undefined)도 하나의 값으로 본다. */
export function judgeAssigneeProgressMap(
  current: SceneAssigneeProgressMap | null | undefined,
  mine: SceneAssigneeProgressMap | null | undefined,
  base: SceneAssigneeProgressMap | null | undefined,
): PendingVerdict {
  if (sameAssigneeProgressMap(current, mine)) return 'mine';
  if (sameAssigneeProgressMap(current, base)) return 'reverted';
  return 'other';
}

/**
 * 이 저장이 쓰려는 완료 기록(mine)을 그 사이 남의 기록이 앞질렀는가 — 지금 화면의 기록이 내 것도 처음 값(base)도 아니다
 * (팀원이 완료를 풀었다 다시 찍음 등). 그러면 늦게 나가는 저장은 그 기록을 덮지 않는다.
 */
export function completionOvertaken(
  current: { completedBy?: string | null; completedAt?: string | null } | null | undefined,
  mine: CompletionStamp,
  base: CompletionStamp,
): boolean {
  return judgePending(current ? completionOf(current) : null, mine, base, sameCompletion) === 'other';
}

/**
 * 저장 확인 전에 같은 묶음을 또 눌렀다 — 새 클릭이 완료를 바꾸지 않으면 앞 저장이 정한 완료 기록(carried)을 이어 쓸지 정한다.
 * 새 저장의 첫 요청은 이 기록을 확인 없이 쓰므로, 다음 둘 중 하나면 잇지 않는다(null):
 * - 그 사이 남의 기록이 왔다(지금 화면 기록이 앞 저장의 것도 처음 값(base)도 아님).
 * - 이 클릭 뒤 씬의 완료 여부와 맞지 않는다(도장인데 완료가 아님 · 지우기인데 완료임) — 앞 클릭 뒤에 남이 완료를 바꿨다는 뜻이다
 *   (내 클릭으로 완료가 바뀌었으면 이 클릭이 새 기록을 정했을 것이다).
 * completeAfterClick: 이번 클릭을 반영한 뒤 씬이 모두 완료인가.
 */
export function inheritCompletion(
  carried: CompletionStamp | null | undefined,
  base: CompletionStamp,
  current: { completedBy?: string | null; completedAt?: string | null },
  completeAfterClick: boolean,
): CompletionStamp | null {
  if (!carried) return null;
  const stamp = Boolean(carried.completedBy && carried.completedAt);
  const clear = !carried.completedBy && !carried.completedAt;
  if ((stamp && !completeAfterClick) || (clear && completeAfterClick)) return null;
  return completionOvertaken(current, carried, base) ? null : carried;
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
  // 다시 보내기 직전에 액팅 단계를 뺐으면(carry.minePhase 를 지움 — 그 사이 남이 단계·차수를 바꿈) 다시 얹지 않는다.
  if (phase && carry.minePhase && carry.basePhase && samePhase(phaseFieldsOf(incoming), carry.basePhase)) {
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
 * 다시 보내기 직전 — 이 저장의 완료 기록(도장 또는 지우기)을 그대로 쓸지 본다.
 * - 그 사이 다른 완료 기록이 왔으면(지금 화면 기록이 내 것도 처음 값도 아님 — 팀원이 완료를 풀었다 다시 찍음 등) 씬이 아직
 *   완료여도 쓰지 않는다. 화면도 그 값 그대로(코덱스 2차 지적 4172094264).
 * - 도장(누가·언제 모두 완료)은 지금 씬이 완료가 아니면 쓰지 않는다(칸을 빼고 남은 칸만 보낼 때, 또는 이 저장이 보내지 않는
 *   칸이 그 사이 바뀌었을 때). 완료 기록은 저장의 맨 끝에 쓰므로 다시 보낸다는 것은 아직 도장을 쓰지 않았다는 뜻이다.
 * - 지우기('')는 지금 씬이 다시 완료면 쓰지 않는다(다른 사람이 다시 완료함 — 그 도장이 곧 온다).
 * null: 그대로 · { screen }: 이 기록을 거둔다. screen 은 화면이 아직 내 도장일 때 되돌릴 완료 기록(남의 값이면 null — 건드리지 않는다).
 */
export function planCompletionStampDrop(
  carry: StageSaveSlotCarry,
  scene: StageSceneNow,
): { screen: CompletionStamp | null } | null {
  const stamp = carry.completion;
  if (!stamp) return null;
  if (completionOvertaken(scene, stamp, carry.baseCompletion)) return { screen: null };
  if (!stamp.completedBy && !stamp.completedAt) return isSequentialStageComplete(scene) ? { screen: null } : null;
  if (!stamp.completedBy || !stamp.completedAt) return null;
  if (isSequentialStageComplete(scene)) return null;
  return { screen: sameCompletion(completionOf(scene), stamp) ? carry.baseCompletion : null };
}

/**
 * 다시 보내기 직전 — 이 저장이 함께 다시 쓰는 액팅 단계·차수와 담당자별 진행이 그 사이 남의 값이 되었는지 본다
 * (완료 기록은 planCompletionStampDrop). 지금 값이 이 저장이 만든 값이거나 처음 값(받아오기가 아직 내 저장을 모르는
 * 서버 값을 읽어 옴)이면 그대로 보낸다. 그 밖의 값이면 뺀다 — 단계 칸 패턴이 그대로여도(팀원이 작업·피드백 차수만 올림) 덮지 않는다.
 * - phase: 액팅 단계·차수를 이번 재전송에서 뺀다(호출자가 carry.minePhase 를 지운다 — 끝내 실패해도 되돌리지 않고, 받아오기 위에도 얹지 않는다).
 * - assigneeProgress: 담당자별 진행에 이 클릭의 변경을 더는 그대로 얹을 수 없다 — 진행을 남이 바꿨거나, 액팅 단계를 뺐거나,
 *   BG 칸 패턴(assigneePattern)이 그 사이 달라졌다. 담당자가 여럿인 씬은 이 진행이 다음 받아오기 때 모두에게 보일 값을 정하므로
 *   (칸은 담당자 진행에서 다시 계산된다) 호출자는 칸만 따로 쓰지 않고 이 저장을 멈춘다.
 * assigneePattern: BG 씬이 담당자별 진행에 다시 적용할 칸 패턴(클릭 직후 화면 값). 액팅 씬(단계로 적용)·담당자 진행이 없으면 null.
 */
export function planSideFieldDrop(
  carry: StageSaveSlotCarry,
  scene: StageSceneNow,
  assigneePattern: Partial<Record<Stage, boolean>> | null,
): { phase: boolean; assigneeProgress: boolean } {
  const phase = carry.minePhase !== null
    && judgePending(phaseFieldsOf(scene), carry.minePhase, carry.basePhase, samePhase) === 'other';
  if (!carry.assigneeTouched) return { phase, assigneeProgress: false };
  // 액팅 씬의 담당자별 진행은 단계 그 자체다 — 단계를 이번에 뺐거나 이미 뺐으면 진행도 다시 쓰지 않는다.
  const phaseGone = carry.basePhase !== null && (phase || carry.minePhase === null);
  const patternStale = assigneePattern !== null
    && (Object.keys(assigneePattern) as Stage[]).some((stage) => Boolean(scene[stage]) !== (assigneePattern[stage] === true));
  const mapOther = judgeAssigneeProgressMap(scene.assigneeProgress, carry.mineAssigneeProgress, carry.baseAssigneeProgress) === 'other';
  return { phase, assigneeProgress: phaseGone || patternStale || mapOther };
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

/**
 * 저장 확인 전에 같은 칸 묶음을 또 눌렀다 — 새 저장의 되돌릴 기준(완료 기록·액팅 단계·담당자별 진행)과 이어 쓸 완료 기록을 정한다.
 * 앞 저장의 값이 아직 화면에 있으면(지금 값 = 앞 저장이 만든 값) 앞 저장의 기준을 잇는다(끝내 실패하면 맨 처음 값까지 되돌린다).
 * 그 사이 남이 바꿨거나 앞 저장이 다시 보내기 직전에 뺀 값이면 지금 값이 새 기준이다 — 칸(mergePendingStageWrites)과 같은 규칙.
 * 이어 쓸 완료 기록(completion)은 새 클릭이 완료를 바꾸지 않을 때 쓴다 — 남의 기록이 왔거나 완료 여부와 맞지 않으면 잇지 않는다(inheritCompletion).
 * scene: 이번 클릭을 화면에 반영하기 직전의 씬. acting: 액팅 씬(단계를 함께 맞춘다)인가. completeAfterClick: 이 클릭 뒤 모두 완료인가.
 */
export function carriedSideBases(
  carried: StageSaveSlotCarry | undefined,
  scene: StageSceneNow,
  options: { acting: boolean; completeAfterClick: boolean },
): Pick<StageSaveSlotCarry, 'baseCompletion' | 'basePhase' | 'baseAssigneeProgress' | 'completion'> {
  const nowCompletion = completionOf(scene);
  const nowPhase = phaseFieldsOf(scene);
  return {
    baseCompletion: carried?.completion && sameCompletion(nowCompletion, carried.completion) ? carried.baseCompletion : nowCompletion,
    basePhase: options.acting
      ? carried?.minePhase && carried.basePhase && samePhase(nowPhase, carried.minePhase) ? carried.basePhase : nowPhase
      : null,
    baseAssigneeProgress: carried?.assigneeTouched && sameAssigneeProgressMap(scene.assigneeProgress, carried.mineAssigneeProgress)
      ? carried.baseAssigneeProgress
      : scene.assigneeProgress,
    completion: carried ? inheritCompletion(carried.completion, carried.baseCompletion, scene, options.completeAfterClick) : null,
  };
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

/**
 * 저장 확인 전에 같은 칩 묶음을 또 눌렀다 — 앞 저장의 단계가 아직 화면에 있으면 앞 저장의 처음 값(base)을 잇는다.
 * 그 사이 남이 단계·차수를 바꿨으면 잇지 않는다(null — 호출자가 지금 값을 새 기준으로 삼는다. 끝내 실패해도 옛 값으로 되돌리지 않게).
 * scene: 이번 클릭을 화면에 반영하기 직전의 씬.
 */
export function inheritPhaseBase(carried: PhaseSaveSlotCarry | undefined, scene: PhaseLike): PhaseSaveSlotCarry['base'] | null {
  if (!carried) return null;
  if (carried.mine && !samePhase(phaseFieldsOf(scene), carried.mine)) return null;
  return carried.base;
}

/**
 * 끝내 실패한 액팅 단계 칩 — 되돌릴 처음 값(base)에서, 같은 클릭이 함께 바꾼 완료 기록·담당자별 진행 중 지금 화면 값이
 * 이 저장이 만든 값이 아닌 것(그 사이 새 값이 옴 — 받아오기·실시간·다른 담당자 버튼)은 뺀다. 이 저장이 바꾸지 않은 곁 값도 뺀다.
 * 단계·차수·체크 4개는 planPhaseGiveUp 이 단계가 내 값일 때만 되돌린다.
 */
export function phaseGiveUpBase(
  carry: PhaseSaveSlotCarry,
  current: Partial<Pick<Scene, 'completedBy' | 'completedAt' | 'assigneeProgress'>> | null | undefined,
): PhaseSaveSlotCarry['base'] {
  const { completedBy, completedAt, assigneeProgress, ...phase } = carry.base;
  const base: PhaseSaveSlotCarry['base'] = { ...phase };
  if (current && carry.completion && sameCompletion(completionOf(current), carry.completion)) {
    base.completedBy = completedBy;
    base.completedAt = completedAt;
  }
  if (current && carry.mineAssigneeProgress && sameAssigneeProgressMap(current.assigneeProgress, carry.mineAssigneeProgress)) {
    base.assigneeProgress = assigneeProgress;
  }
  return base;
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

/**
 * 저장 확인 전에 같은 담당자 버튼을 또 눌렀다 — 앞 저장의 이 담당자 값이 아직 화면에 있으면 앞 저장의 처음 값(prevScene)을 잇는다.
 * 그 사이 남이 이 담당자 값을 바꿨으면 잇지 않는다(null — 호출자가 지금 씬을 새 기준으로 삼는다. 끝내 실패해도 옛 값으로 되돌리지 않게).
 * current: 이번 클릭을 화면에 반영하기 직전의 이 담당자 값.
 */
export function inheritAssigneeBase(
  carried: AssigneeSaveSlotCarry | undefined,
  current: SceneAssigneeProgress | undefined,
): Scene | null {
  if (!carried) return null;
  if (carried.mineEntry && !(current && sameAssigneeProgress(current, carried.mineEntry))) return null;
  return carried.prevScene;
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
