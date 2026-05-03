/**
 * 리비전 알림 자동 대상자 계산 헬퍼.
 *
 * v1.18.0 — 한솔 결정:
 *   - 리비전 등록 시 폼이 자동으로 "그 부서 컴포지터 + 씬 모든 단계 담당자" 를 미리 체크해서 보여준다.
 *   - 등록자 본인은 제외 (자기 알림 X).
 *   - Scene.assignee 는 comma-separated string 으로 다중 담당자를 표현한다.
 *     (단계별 분리 필드는 없음 — assignee 하나로 LO/완료/검수/PNG 모두 담당)
 *   - AppUser.compositorDept 가 'BG' 또는 'ACT' 인 사용자가 그 부서 컴포지터.
 */

import type { AppUser, Scene } from '@/types';

type RevisionDept = 'bg' | 'acting';

/**
 * 부서 enum 을 compositorDept 라벨('BG'|'ACT') 로 변환.
 */
function deptToCompositorLabel(dept: RevisionDept): 'BG' | 'ACT' {
  return dept === 'bg' ? 'BG' : 'ACT';
}

/**
 * 그 부서의 컴포지터 사용자 목록을 반환.
 * 폼 UI 에서 "기본 알림 대상" 섹션에 미리 보여주거나, 자동 체크 대상 결정용.
 */
export function findCompositorsForDept(
  dept: RevisionDept,
  allUsers: readonly AppUser[],
): AppUser[] {
  const target = deptToCompositorLabel(dept);
  return allUsers.filter((u) => u.compositorDept === target);
}

/**
 * Scene.assignee (comma-separated 이름 문자열) → 이름 배열.
 * 빈 문자열/공백 제거.
 */
function parseAssigneeNames(assignee: string | undefined | null): string[] {
  if (!assignee) return [];
  return assignee
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 이름 배열 → 사용자 객체 배열 (allUsers 에서 매칭).
 * 매칭 안 되는 이름은 제외 (사용자 등록 안 된 외부 이름은 알림 못 받으므로).
 */
function namesToUsers(names: readonly string[], allUsers: readonly AppUser[]): AppUser[] {
  if (names.length === 0) return [];
  const nameSet = new Set(names);
  return allUsers.filter((u) => nameSet.has(u.name));
}

/**
 * 리비전 알림 기본 대상자 user.id 배열 계산.
 *
 * - 부서 컴포지터 (compositorDept === 'BG'|'ACT') 모두 +
 * - 씬 담당자 (scene.assignee comma-separated) 모두
 * - 등록자 본인(excludeUserId) 제외
 * - 중복 제거
 *
 * @param dept 리비전 부서 ('bg' | 'acting')
 * @param scene 대상 씬 (assignee 필드 사용)
 * @param allUsers 전체 사용자 목록 (AuthStore.users)
 * @param excludeUserId 제외할 사용자 id (보통 등록자 본인)
 */
export function calcDefaultRecipients(
  dept: RevisionDept,
  scene: Pick<Scene, 'assignee'> | null | undefined,
  allUsers: readonly AppUser[],
  excludeUserId?: string,
): string[] {
  const ids = new Set<string>();

  // 1) 부서 컴포지터
  for (const u of findCompositorsForDept(dept, allUsers)) {
    if (u.id && u.id !== excludeUserId) ids.add(u.id);
  }

  // 2) 씬 담당자
  if (scene) {
    const assigneeNames = parseAssigneeNames(scene.assignee);
    for (const u of namesToUsers(assigneeNames, allUsers)) {
      if (u.id && u.id !== excludeUserId) ids.add(u.id);
    }
  }

  return Array.from(ids);
}
