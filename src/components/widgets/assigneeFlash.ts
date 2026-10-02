/**
 * 대시보드 '담당자별 현황' 카드 — 진행률이 오른 사람만 한 번 반짝 (움직임 폴리싱 9번 teammate-live).
 *
 * - 처음 계산은 저장만 한다(화면을 열자마자 반짝이지 않게). 부서 필터·EP 를 바꾸면 처음부터 다시.
 * - 진행률이 오른 사람만 반짝, 한 번에 최대 6명(일괄 변경에서 카드가 한꺼번에 번쩍이지 않게).
 * - 씬을 끝까지 완료한 수가 늘었을 때만 '+N씬' 을 함께 띄운다.
 * node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */
import { useEffect, useRef, useState } from 'react';

export const ASSIGNEE_FLASH_LIMIT = 6;
/** 소수 첫째 자리로 보여 주므로 그보다 작은 흔들림은 무시한다. */
const PCT_EPSILON = 0.05;

export interface AssigneeProgressRow {
  name: string;
  pct: number;
  completedScenes: number;
}

export interface AssigneeSnapshot {
  pct: number;
  completed: number;
}

export interface AssigneeFlashHit {
  name: string;
  /** 완료 씬이 늘어난 수. 0 이면 '+N씬' 없이 반짝만. */
  delta: number;
}

export function snapshotAssignees(rows: ReadonlyArray<AssigneeProgressRow>): Map<string, AssigneeSnapshot> {
  return new Map(rows.map((row) => [row.name, { pct: row.pct, completed: row.completedScenes }]));
}

/** 직전 값과 비교해 반짝일 사람을 고른다. prev 가 null 이면 첫 계산 — 아무도 반짝이지 않는다. */
export function diffAssigneeProgress(
  prev: ReadonlyMap<string, AssigneeSnapshot> | null,
  rows: ReadonlyArray<AssigneeProgressRow>,
  limit: number = ASSIGNEE_FLASH_LIMIT,
): AssigneeFlashHit[] {
  if (!prev) return [];
  const hits: AssigneeFlashHit[] = [];
  for (const row of rows) {
    if (hits.length >= limit) break;
    const before = prev.get(row.name);
    if (!before) continue;
    if (row.pct - before.pct <= PCT_EPSILON) continue;
    hits.push({ name: row.name, delta: Math.max(0, row.completedScenes - before.completed) });
  }
  return hits;
}

export interface AssigneeFlash {
  /** 반짝·'+N씬' 을 다시 틀 React key. */
  seq: number;
  delta: number;
}

let assigneeFlashSeq = 0;

/**
 * 카드 목록이 바뀔 때마다 반짝일 사람을 고른다. resetKey(부서 필터·EP)가 바뀌면 직전 값을 버린다.
 * 돌려준 Map 의 항목은 다음 반짝 전까지 남는다(애니메이션이 끝난 층은 opacity 0 이라 보이지 않는다).
 */
export function useAssigneeFlashes(rows: ReadonlyArray<AssigneeProgressRow>, resetKey: string): ReadonlyMap<string, AssigneeFlash> {
  const prevRef = useRef<Map<string, AssigneeSnapshot> | null>(null);
  const resetRef = useRef(resetKey);
  const [flashes, setFlashes] = useState<ReadonlyMap<string, AssigneeFlash>>(() => new Map());

  useEffect(() => {
    if (resetRef.current !== resetKey) {
      resetRef.current = resetKey;
      prevRef.current = null;
      setFlashes((current) => (current.size === 0 ? current : new Map()));
    }
    const hits = diffAssigneeProgress(prevRef.current, rows);
    prevRef.current = snapshotAssignees(rows);
    if (hits.length === 0) return;
    setFlashes((current) => {
      const next = new Map(current);
      for (const hit of hits) next.set(hit.name, { seq: ++assigneeFlashSeq, delta: hit.delta });
      return next;
    });
  }, [rows, resetKey]);

  return flashes;
}
