/**
 * 나의 할일 위젯 통계 순수 함수 (DonutHero 용).
 *
 * useMyTasksData 의 stats useMemo 가 이 함수를 호출한다. 순수 함수로 분리해
 * UI 없이 산식(단계 누적·완료 씬·오늘 마친 씬)을 단위 테스트로 회귀 보호한다.
 *
 * ⚠️ 런타임 의존성 0 — 타입만 import(`import type`)해 node:test(type-strip)에서
 * `@/` alias 해석 없이 그대로 실행되게 한다. 단계 필드(lo/done/review/png)는
 * 구조적으로 직접 접근한다.
 */
import type { CharacterTaskItem, FlatScene, PersonalTodo } from './types';

export interface MyTasksStats {
  /** 씬 + 개인 할일 + 캐릭터 작업 총 개수 */
  total: number;
  /** 완전 완료된 항목 수 = 완료 씬 + 완료 개인 할일 + 완료 캐릭터 작업 */
  fullyDone: number;
  /** 씬 4단계 + 개인/캐릭터 1단계 가중 평균 진행률 */
  pct: number;
  /** 내 씬 총 개수 */
  sceneTotal: number;
  /** 4단계 모두 끝난 씬 수 */
  doneSceneCount: number;
  /** 진행 중(미완료) 씬 수 */
  pendingSceneCount: number;
  /** 단계별 체크된 씬 수 */
  stageCounts: { lo: number; done: number; review: number; png: number };
  /** 씬 단계 누적 진행률 = 체크된 단계 / (씬수 × 4) × 100 (도넛 채움 정도) */
  stageProgressPct: number;
  /** 개인 할일 총 개수 */
  personalTotal: number;
  /** 캐릭터 디자인/리깅 작업 총 개수 */
  characterTotal: number;
  /** 완료된 캐릭터 디자인/리깅 작업 수 */
  doneCharacterCount: number;
  /** 오늘(로컬) 마친 씬 수 — completedAt 기준, 완료자 무관 */
  todayCompletedScenes: number;
}

/** 단계 4개 중 체크된 개수 */
function checkedStageCount(s: FlatScene['scene']): number {
  return (s.lo ? 1 : 0) + (s.done ? 1 : 0) + (s.review ? 1 : 0) + (s.png ? 1 : 0);
}

/**
 * 내 할일 위젯 통계 계산.
 *
 * @param scenes 내 씬(할당 + 수동 추가) 전체 — 완료/진행 분리는 내부에서 한다.
 * @param personalTodos 내 개인 할일 전체.
 * @param now '오늘' 판정 기준 시각(테스트 주입용).
 * @param characterTasks 내 캐릭터 디자인/리깅 작업 전체.
 */
export function computeMyTasksStats(
  scenes: FlatScene[],
  personalTodos: PersonalTodo[],
  now: Date,
  characterTasks: CharacterTaskItem[] = [],
): MyTasksStats {
  const sceneTotal = scenes.length;
  const stageCounts = { lo: 0, done: 0, review: 0, png: 0 };
  let doneSceneCount = 0;
  let todayCompletedScenes = 0;
  const todayStr = now.toDateString();

  for (const f of scenes) {
    const s = f.scene;
    if (s.lo) stageCounts.lo++;
    if (s.done) stageCounts.done++;
    if (s.review) stageCounts.review++;
    if (s.png) stageCounts.png++;

    if (checkedStageCount(s) === 4) {
      doneSceneCount++;
      // 오늘 마친 씬: completedAt 이 유효하고 로컬 오늘인 경우만. 레거시 미기록 씬은 제외(의도).
      const c = s.completedAt;
      if (c) {
        const d = new Date(c);
        if (!Number.isNaN(d.getTime()) && d.toDateString() === todayStr) {
          todayCompletedScenes++;
        }
      }
    }
  }

  const pendingSceneCount = sceneTotal - doneSceneCount;
  const checkedStages = stageCounts.lo + stageCounts.done + stageCounts.review + stageCounts.png;
  const stageSlots = sceneTotal * 4;
  const stageProgressPct = stageSlots > 0 ? (checkedStages / stageSlots) * 100 : 0;

  const personalTotal = personalTodos.length;
  const personalDone = personalTodos.reduce((n, t) => n + (t.status === 'done' ? 1 : 0), 0);
  const characterTotal = characterTasks.length;
  const doneCharacterCount = characterTasks.reduce((n, task) => n + (task.done ? 1 : 0), 0);

  // 씬은 4단계, 개인 할일과 캐릭터 작업은 각 1단계로 계산한다.
  const total = sceneTotal + personalTotal + characterTotal;
  const fullyDone = doneSceneCount + personalDone + doneCharacterCount;
  const totalWeight = stageSlots + personalTotal + characterTotal;
  const checkedWeight = checkedStages + personalDone + doneCharacterCount;
  const pct = totalWeight > 0 ? (checkedWeight / totalWeight) * 100 : 0;

  return {
    total,
    fullyDone,
    pct,
    sceneTotal,
    doneSceneCount,
    pendingSceneCount,
    stageCounts,
    stageProgressPct,
    personalTotal,
    characterTotal,
    doneCharacterCount,
    todayCompletedScenes,
  };
}
