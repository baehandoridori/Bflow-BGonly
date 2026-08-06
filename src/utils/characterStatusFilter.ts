/**
 * 캐릭터 현황판 작업자/상태 필터 (피드백 48) — 씬 카드 필터(전체/미착수/진행중/완료)와 같은 의미를
 * 캐릭터 단위로 집계한다. 순수 함수 — node:test 직접 import 대상('@/' alias·비순수 import 금지).
 */
import { parseAssigneeNames } from './assigneeNames.ts';

export type CharacterStatusFilterValue = 'all' | 'not-started' | 'in-progress' | 'done';

type StageLike = {
  designStage: string;
  riggingStage: string;
  designAssignee: string | null;
  riggingAssignee: string | null;
  assignee: string | null;
};

/** 이 사람에게 배정된 트랙의 단계만 모은다. 레거시 assignee 필드는 양 트랙 겸용으로 본다. */
function tracksForAssignee(costumes: StageLike[], assigneeName: string): string[] {
  const stages: string[] = [];
  for (const c of costumes) {
    const legacy = parseAssigneeNames(c.assignee).includes(assigneeName);
    if (legacy || parseAssigneeNames(c.designAssignee).includes(assigneeName)) stages.push(c.designStage);
    if (legacy || parseAssigneeNames(c.riggingAssignee).includes(assigneeName)) stages.push(c.riggingStage);
  }
  return stages;
}

/**
 * 캐릭터 단위 작업 상태.
 * - 완료: 집계 대상 트랙이 1개 이상이고 전부 'done'
 * - 미착수: 집계 대상 트랙이 없거나(복장 0개 포함) 전부 'waiting'
 * - 진행중: 그 외 (하나라도 착수했고 아직 전부 완료는 아님 — 디자인만 끝난 캐릭터 포함)
 * assigneeName 이 있으면 그 사람에게 배정된 트랙만 집계한다.
 */
export function characterWorkStatus(costumes: StageLike[], assigneeName?: string | null): 'not-started' | 'in-progress' | 'done' {
  const stages = assigneeName
    ? tracksForAssignee(costumes, assigneeName)
    : costumes.flatMap((c) => [c.designStage, c.riggingStage]);
  if (stages.length === 0) return 'not-started';
  if (stages.every((s) => s === 'done')) return 'done';
  if (stages.every((s) => s === 'waiting')) return 'not-started';
  return 'in-progress';
}

/** 이 캐릭터에 assigneeName 이 배정돼 있는가 (작업자 필터의 1차 관문). */
export function characterHasAssignee(costumes: StageLike[], assigneeName: string): boolean {
  return tracksForAssignee(costumes, assigneeName).length > 0;
}

/** 필터 통과 여부 — 작업자 선택 시 배정 여부 먼저, 그 다음 상태 판정. */
export function matchesCharacterStatusFilter(
  costumes: StageLike[],
  filter: CharacterStatusFilterValue,
  assigneeName: string | null,
): boolean {
  if (assigneeName && !characterHasAssignee(costumes, assigneeName)) return false;
  if (filter === 'all') return true;
  return characterWorkStatus(costumes, assigneeName) === filter;
}

/** 작업자 드롭다운 옵션 — 전체 복장의 담당자(디자인·리깅·레거시) 유니온, 한국어 정렬. */
export function collectCharacterAssignees(costumes: StageLike[]): string[] {
  const set = new Set<string>();
  for (const c of costumes) {
    for (const n of parseAssigneeNames(c.designAssignee)) set.add(n);
    for (const n of parseAssigneeNames(c.riggingAssignee)) set.add(n);
    for (const n of parseAssigneeNames(c.assignee)) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}
