import type { Activity, ActionType, ActivityStatRowV2, Department, Stage } from '../../../types/index.ts';
import { DEPARTMENT_CONFIGS } from '../../../types/index.ts';
import { ACTION_TYPE_LABEL } from './constants.ts';
import { GROUP_WINDOW_MS } from './constants.ts';

/**
 * 멀티-씬 액션 — 한 번의 사용자 행위로 여러 씬에 동시에 영향이 가는 액션.
 * 이 화이트리스트에 속하는 액션은 `sameGroup` 에서 sceneId 가 달라도 묶음.
 * 단일-씬 액션(stage 토글, phase 토글, 댓글, 리테이크 등)은 기존 정책대로 sceneId 일치 요구.
 * 향후 새 멀티-씬 액션이 추가되면 여기에 함께 등록할 것.
 */
export const MULTI_SCENE_ACTIONS: ReadonlySet<ActionType> = new Set([
  'assignee_change',
  'layout_change',
  'image_upload_storyboard',
  'image_upload_guide',
]);

/**
 * 리테이크 처리 묶음 — 취합자가 짧은 시간에 여러 씬의 리테이크를 등록/상태 변경하는 경우가 잦다.
 * 댓글 자체는 맥락 보존을 위해 씬/리테이크 단위로 남기고, 등록·상태·담당 처리만 묶는다.
 */
export const RETAKE_BURST_ACTIONS: ReadonlySet<ActionType> = new Set([
  'revision_add',
  'revision_in_progress',
  'revision_resolve',
  'revision_delete',
  'revision_assignee_done',
  'revision_final_resolve',
  'revision_reassign',
]);

const CROSS_SCENE_GROUPABLE_ACTIONS: ReadonlySet<ActionType> = new Set([
  ...MULTI_SCENE_ACTIONS,
  ...RETAKE_BURST_ACTIONS,
]);

/**
 * 활동 동사(verb) 라벨 — stage 활동은 부서별 명칭 + 토글 ON/OFF 구분.
 * - BG: lo='LO', done='완료', review='검수', png='PNG'
 * - 액팅: lo='1원화', done='2원화', review='동화', png='최종'
 * - value=true → "{단계명} 완료", value=false → "{단계명} 해제"
 * - stage 외 활동(메모/댓글/씬 추가 등)은 ACTION_TYPE_LABEL 그대로.
 */
export function getActivityVerb(activity: Activity): string {
  const stageMap: Record<string, Stage> = {
    stage_lo: 'lo', stage_done: 'done', stage_review: 'review', stage_png: 'png',
  };
  const stage = stageMap[activity.actionType];
  if (!stage) return ACTION_TYPE_LABEL[activity.actionType];

  const dept: Department = activity.department === 'acting' ? 'acting' : 'bg';
  const stageName = DEPARTMENT_CONFIGS[dept].stageLabels[stage];
  const value = activity.detail && typeof (activity.detail as { value?: unknown }).value === 'boolean'
    ? (activity.detail as { value: boolean }).value
    : true; // 옛 데이터 호환: detail.value 없으면 완료로 간주
  return `${stageName} ${value ? '완료' : '해제'}`;
}

/** action_type 만으로 빠르게 verb 가 필요한 곳 (필터/통계 등). 부서/value 무시. */
export function getActionLabelGeneric(actionType: ActionType): string {
  return ACTION_TYPE_LABEL[actionType];
}

export type FeedItem =
  | { type: 'item'; activity: Activity }
  | { type: 'group'; key: string; items: Activity[] };

/**
 * 활동 목록을 5분 윈도우 그룹으로 묶는다.
 * 같은 user + 같은 action_type + 같은 episode + 5분 이내 → 한 그룹.
 * 단일 항목은 type='item' 으로 평면화.
 */
export function groupActivities(items: Activity[]): FeedItem[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const result: FeedItem[] = [];
  let buffer: Activity[] = [sorted[0]];

  const sameGroup = (a: Activity, b: Activity) => {
    if (a.userId !== b.userId) return false;
    if (a.actionType !== b.actionType) return false;
    if (a.episodeNumber !== b.episodeNumber) return false;
    // 기본은 sceneId 일치. 단, 일괄 작업과 리테이크 연속 처리처럼 사용자가 같은 흐름에서
    // 여러 씬을 빠르게 처리하는 액션은 sceneId 가 달라도 5분 묶음으로 정리한다.
    if (!CROSS_SCENE_GROUPABLE_ACTIONS.has(a.actionType) && a.sceneId !== b.sceneId) return false;
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return Math.abs(da - db) <= GROUP_WINDOW_MS;
  };

  const flush = () => {
    if (buffer.length === 1) {
      result.push({ type: 'item', activity: buffer[0] });
    } else {
      result.push({
        type: 'group',
        key: `${buffer[0].userId}:${buffer[0].actionType}:${buffer[0].episodeNumber ?? 'na'}:${buffer[0].id}`,
        items: [...buffer],
      });
    }
    buffer = [];
  };

  for (let i = 1; i < sorted.length; i++) {
    const head = buffer[0];
    const cur = sorted[i];
    if (sameGroup(head, cur)) buffer.push(cur);
    else { flush(); buffer.push(cur); }
  }
  flush();
  return result;
}

/**
 * 그룹별 카운트 묶음 — 한 셀(요일×시간)의 활동을 그룹별로 분해 보관.
 * v1.14.1 추가: 히트맵 셀 호버 툴팁에서 "작업진행 N건 / 메모·댓글 N건 / 씬 N건 / 기타 N건" 표시용.
 * total 은 4개 합과 항상 일치 (서버 RPC FILTER 절에서 보장).
 */
export interface GroupedCount {
  total: number;
  progress: number;
  memo: number;
  scene: number;
  etc: number;
}

export const EMPTY_GROUPED_COUNT: GroupedCount = { total: 0, progress: 0, memo: 0, scene: 0, etc: 0 };

export function addGroupedCount(a: GroupedCount, b: GroupedCount): GroupedCount {
  return {
    total: a.total + b.total,
    progress: a.progress + b.progress,
    memo: a.memo + b.memo,
    scene: a.scene + b.scene,
    etc: a.etc + b.etc,
  };
}

export interface GoldenWindow {
  day: number;
  hour: number;
  count: number;
}

/** 24x7 격자에서 연속 2시간 합이 최대인 슬롯. 동률이면 가장 최근 요일 우선. */
export function pickGoldenWindow(grid: GroupedCount[][]): GoldenWindow | null {
  let best: GoldenWindow | null = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 23; h++) {
      const sum = (grid[d]?.[h]?.total ?? 0) + (grid[d]?.[h + 1]?.total ?? 0);
      if (sum === 0) continue;
      if (!best || sum > best.count || (sum === best.count && d > best.day)) {
        best = { day: d, hour: h, count: sum };
      }
    }
  }
  return best;
}

/** 24시간 합산에서 연속 2시간 정점. */
export function pickGoldenHour(hourTotals: number[]): { hour: number; ratio: number } | null {
  const total = hourTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let bestHour = 0, bestSum = 0;
  for (let h = 0; h < 23; h++) {
    const sum = hourTotals[h] + (hourTotals[h + 1] ?? 0);
    if (sum > bestSum) { bestSum = sum; bestHour = h; }
  }
  return { hour: bestHour, ratio: bestSum / total };
}

/** 7요일 합산에서 정점 요일. */
export function pickGoldenDay(dayTotals: number[]): { day: number; ratio: number } | null {
  const total = dayTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let bestDay = 0, bestCount = 0;
  for (let d = 0; d < 7; d++) {
    if (dayTotals[d] > bestCount) { bestCount = dayTotals[d]; bestDay = d; }
  }
  return { day: bestDay, ratio: bestCount / total };
}

/**
 * stats 결과(PostgreSQL EXTRACT(dow): 0=일~6=토) → 표시용 24x7 격자.
 * 표시 인덱스: 0=월, 1=화, ..., 5=토, 6=일.
 * v1.14.1: 그룹별 카운트(progress/memo/scene/etc) 포함.
 */
export interface ActivityStatRow {
  day_of_week: number;
  hour: number;
  count: number;
  count_progress?: number;
  count_memo?: number;
  count_scene?: number;
  count_etc?: number;
}

export function buildHeatmapGrid(stats: ActivityStatRow[]): GroupedCount[][] {
  const grid: GroupedCount[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ ...EMPTY_GROUPED_COUNT })),
  );
  for (const s of stats) {
    // pg dow 0=일,1=월,...,6=토 → 표시 0=월,...,6=일
    const displayDay = (s.day_of_week + 6) % 7;
    if (displayDay >= 0 && displayDay < 7 && s.hour >= 0 && s.hour < 24) {
      grid[displayDay][s.hour] = {
        total: s.count,
        progress: s.count_progress ?? 0,
        memo: s.count_memo ?? 0,
        scene: s.count_scene ?? 0,
        etc: s.count_etc ?? 0,
      };
    }
  }
  return grid;
}

export function intensityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

export function intensityBg(level: 0 | 1 | 2 | 3 | 4): string {
  // 테마 색상 따라가게 — --color-accent (RGB 값) 변수 사용. 테마 변경 시 자동 반영.
  return [
    'rgb(var(--color-accent) / 0.06)',
    'rgb(var(--color-accent) / 0.18)',
    'rgb(var(--color-accent) / 0.36)',
    'rgb(var(--color-accent) / 0.58)',
    'rgb(var(--color-accent) / 0.85)',
  ][level];
}

/** 히트맵 정점 셀 glow (lv 4) */
export function intensityGlow(level: 0 | 1 | 2 | 3 | 4): string {
  return level === 4 ? '0 0 8px rgb(var(--color-accent) / 0.3)' : '';
}

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
export function dayLabel(idx: number): string {
  return DAY_LABELS[idx] ?? '';
}

/**
 * v1.23.0: granularity 별 격자 빌드.
 * - hour-of-day-x-dow: bucket1=dow(0=일), bucket2=hour. 표시용 7×24 (월=0).
 * - month-x-dow: bucket1=month(1~12), bucket2=dow. 표시용 12×7 (월=0).
 * - month-totals: bucket1=month, 12×1.
 */
export function buildHeatmapGridV2(
  stats: ActivityStatRowV2[],
  granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals',
): GroupedCount[][] {
  if (granularity === 'hour-of-day-x-dow') {
    const grid: GroupedCount[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ ...EMPTY_GROUPED_COUNT })),
    );
    for (const s of stats) {
      const displayDay = (s.bucket1 + 6) % 7;
      if (displayDay >= 0 && displayDay < 7 && s.bucket2 >= 0 && s.bucket2 < 24) {
        grid[displayDay][s.bucket2] = {
          total: s.total,
          progress: s.count_progress ?? 0,
          memo: s.count_memo ?? 0,
          scene: s.count_scene ?? 0,
          etc: s.count_etc ?? 0,
        };
      }
    }
    return grid;
  }
  if (granularity === 'month-x-dow') {
    const grid: GroupedCount[][] = Array.from({ length: 12 }, () =>
      Array.from({ length: 7 }, () => ({ ...EMPTY_GROUPED_COUNT })),
    );
    for (const s of stats) {
      const monthIdx = s.bucket1 - 1;
      const displayDow = (s.bucket2 + 6) % 7;
      if (monthIdx >= 0 && monthIdx < 12 && displayDow >= 0 && displayDow < 7) {
        grid[monthIdx][displayDow] = {
          total: s.total,
          progress: s.count_progress ?? 0,
          memo: s.count_memo ?? 0,
          scene: s.count_scene ?? 0,
          etc: s.count_etc ?? 0,
        };
      }
    }
    return grid;
  }
  // month-totals — 12×1
  const grid: GroupedCount[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 1 }, () => ({ ...EMPTY_GROUPED_COUNT })),
  );
  for (const s of stats) {
    const monthIdx = s.bucket1 - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      grid[monthIdx][0] = {
        total: s.total,
        progress: s.count_progress ?? 0,
        memo: s.count_memo ?? 0,
        scene: s.count_scene ?? 0,
        etc: s.count_etc ?? 0,
      };
    }
  }
  return grid;
}

/** 상대 시간 표시 — 24시간 미만 상대, 이상 절대 */
export function formatRelativeTime(isoString: string, now: number = Date.now()): string {
  const then = new Date(isoString).getTime();
  const diff = now - then;
  if (diff < 0) return '방금';
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  // 24시간 이상 — 절대 시간 (간단 KST 변환)
  const dt = new Date(isoString);
  const kst = new Date(dt.getTime() + 9 * 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  if (days === 1) return `어제 ${hh}:${mm}`;
  if (days < 7) return `${days}일 전 ${hh}:${mm}`;
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${mo}/${dd} ${hh}:${mm}`;
}
