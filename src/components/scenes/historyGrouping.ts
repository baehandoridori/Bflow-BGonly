import type { Activity } from '@/types';

/**
 * 활동 행 — 단일 활동 또는 단계 토글 그룹.
 * 같은 user + 같은 부서 + windowMs 안에 인접한 단계 토글들은 1개 그룹으로.
 *
 * 한솔 결정 (2026-05-02): windowMs = 5분. 시각적 압도 완화 + 정보 보존.
 */
export type HistoryRow = SingleRow | StageGroupRow;

export interface SingleRow {
  kind: 'single';
  activity: Activity;
}

export interface StageGroupRow {
  kind: 'group';
  /** 안정적 key — 첫 항목 id 기반 */
  id: string;
  userName: string;
  department: 'bg' | 'acting' | null;
  /** 그룹 안 단계 토글 (시간 오름차순) */
  items: Activity[];
  /** 그룹 시간 범위 — 가장 오래된 (시작) ~ 가장 최신 (끝) */
  firstAt: string;
  lastAt: string;
}

const STAGE_TYPES = new Set(['stage_lo', 'stage_done', 'stage_review', 'stage_png']);

/**
 * 활동 배열(최신 → 오래된) 을 받아 row 배열로 변환.
 * 단계 토글이 같은 user+부서+windowMs 안에 인접하면 그룹으로 묶음.
 *
 * 인접성 판정: 시간순 정렬 후 직전 항목과 비교 — group last item 시각으로부터 windowMs 안에 들어오면 합류.
 *
 * @param activities  최신 → 오래된 정렬된 활동
 * @param windowMs    그룹 윈도우 (default 5분 = 300_000ms)
 */
export function groupStageToggles(activities: Activity[], windowMs = 5 * 60 * 1000): HistoryRow[] {
  if (activities.length === 0) return [];

  // 시간 오름차순으로 변환해 그룹화 — 같은 user+부서 연속 stage 토글 하나로.
  const asc = [...activities].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const rowsAsc: HistoryRow[] = [];
  for (const a of asc) {
    const isStage = STAGE_TYPES.has(a.actionType);
    const last = rowsAsc[rowsAsc.length - 1];

    if (isStage && last && last.kind === 'group' &&
        last.userName === a.userName &&
        last.department === a.department) {
      const lastTs = new Date(last.lastAt).getTime();
      const curTs = new Date(a.createdAt).getTime();
      if (curTs - lastTs <= windowMs) {
        last.items.push(a);
        last.lastAt = a.createdAt;
        continue;
      }
    }
    if (isStage && last && last.kind === 'single' && STAGE_TYPES.has(last.activity.actionType) &&
        last.activity.userName === a.userName &&
        last.activity.department === a.department) {
      const lastTs = new Date(last.activity.createdAt).getTime();
      const curTs = new Date(a.createdAt).getTime();
      if (curTs - lastTs <= windowMs) {
        // 단일 → 그룹으로 승격
        const idx = rowsAsc.length - 1;
        rowsAsc[idx] = {
          kind: 'group',
          id: `grp:${last.activity.id}`,
          userName: last.activity.userName,
          department: last.activity.department,
          items: [last.activity, a],
          firstAt: last.activity.createdAt,
          lastAt: a.createdAt,
        };
        continue;
      }
    }

    rowsAsc.push({ kind: 'single', activity: a });
  }

  // 그룹 항목이 1개면 다시 단일로 환원 (보기 깔끔)
  const collapsed: HistoryRow[] = rowsAsc.map((r) =>
    r.kind === 'group' && r.items.length === 1
      ? { kind: 'single', activity: r.items[0] }
      : r,
  );

  // 다시 최신 → 오래된 (UI 가 expects)
  return collapsed.reverse();
}
