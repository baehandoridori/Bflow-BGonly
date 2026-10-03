/**
 * 대시보드 '담당자별 현황' 카드 — 진행률이 오른 사람만 한 번 반짝 (움직임 폴리싱 9번 teammate-live).
 *
 * - 처음 계산은 저장만 한다(화면을 열자마자 반짝이지 않게). 부서 필터·EP 를 바꾸면 처음부터 다시.
 * - 진행률이 오른 사람만 반짝, 한 번에 최대 6명(일괄 변경에서 카드가 한꺼번에 번쩍이지 않게).
 * - 씬을 끝까지 완료한 수가 늘었을 때만 '+N씬' 을 함께 띄운다.
 * - 같은 사람의 연달은 오름은 한 번으로 묶는다: BG 체크 한 번이 단계 수만큼 차례로 저장되며 매번 진행률이 오른다.
 *   직전 오름에서 ASSIGNEE_FLASH_MERGE_MS(씬 카드 묶음과 같은 400ms) 안에 또 오르면 빛을 다시 틀지 않고
 *   '+N씬' 숫자만 더한다(반짝이 최고 밝기에서 0 으로 떨어졌다 다시 켜지는 깜빡임 방지).
 * node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */
import { useEffect, useRef, useState } from 'react';

export const ASSIGNEE_FLASH_LIMIT = 6;
/** 같은 사람의 연달은 오름을 한 번의 반짝으로 묶는 간격(ms, 직전 오름 기준) — 씬 카드 SCENE_FLASH_MERGE_MS 와 같다. */
export const ASSIGNEE_FLASH_MERGE_MS = 400;
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
  /** 반짝을 다시 틀 React key. 묶인 오름에서는 그대로다. */
  seq: number;
  /** 이번 반짝에 묶인 완료 씬 증가 수. 0 이면 '+N씬' 없음. */
  delta: number;
  /** '+N씬' 을 다시 틀 React key — 묶인 오름에서 완료 씬이 늘 때만 바뀐다. */
  deltaSeq: number;
  /** 마지막으로 묶인 오름 시각(묶음 판정). */
  lastAt: number;
}

let assigneeFlashSeq = 0;
const nextAssigneeFlashSeq = () => ++assigneeFlashSeq;

/**
 * 반짝일 사람(hits)을 지금 표시에 더한다. 직전 오름에서 ASSIGNEE_FLASH_MERGE_MS 안이면 빛(seq)은 그대로 두고
 * 완료 씬 수만 더한다 — 그때 '+N씬' 은 숫자가 늘었을 때만 새로 띄운다. 그 밖에는 새 반짝.
 */
export function mergeAssigneeFlashes(
  current: ReadonlyMap<string, AssigneeFlash>,
  hits: ReadonlyArray<AssigneeFlashHit>,
  now: number,
  nextSeq: () => number = nextAssigneeFlashSeq,
): ReadonlyMap<string, AssigneeFlash> {
  if (hits.length === 0) return current;
  const next = new Map(current);
  for (const hit of hits) {
    const previous = current.get(hit.name);
    if (previous && now - previous.lastAt <= ASSIGNEE_FLASH_MERGE_MS) {
      next.set(hit.name, {
        seq: previous.seq,
        delta: previous.delta + hit.delta,
        deltaSeq: hit.delta > 0 ? nextSeq() : previous.deltaSeq,
        lastAt: now,
      });
      continue;
    }
    const seq = nextSeq();
    next.set(hit.name, { seq, delta: hit.delta, deltaSeq: seq, lastAt: now });
  }
  return next;
}

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
    const now = Date.now();
    setFlashes((current) => mergeAssigneeFlashes(current, hits, now));
  }, [rows, resetKey]);

  return flashes;
}
