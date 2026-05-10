/**
 * 리비전 알림 자동 대상자 계산 헬퍼.
 *
 * v1.18.1 — 한솔 정정:
 *   - 컴포지터는 BG/ACT 부서로 나뉘지 않는다 (단일 역할).
 *   - 리비전 등록 시 폼이 자동으로 "모든 컴포지터 + 씬 모든 단계 담당자" 를 미리 체크.
 *   - 등록자 본인은 제외 (자기 알림 X).
 *   - Scene.assignee 는 comma-separated string 으로 다중 담당자를 표현.
 *   - AppUser.isCompositor === true 인 사용자가 컴포지터.
 */

import type { AppUser, Scene } from '@/types';

/**
 * 컴포지터 사용자 목록을 반환 (부서 구분 없음).
 * 폼 UI 에서 "기본 알림 대상" 섹션에 미리 보여주거나, 자동 체크 대상 결정용.
 */
export function findAllCompositors(
  allUsers: readonly AppUser[],
): AppUser[] {
  return allUsers.filter((u) => u.isCompositor === true);
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
 * - 모든 컴포지터 (isCompositor === true) +
 * - 씬 담당자 (scene.assignee comma-separated) 모두
 * - 등록자 본인(excludeUserId) 제외
 * - 중복 제거
 *
 * v1.24.0 한솔 보고: BG sheet 에서 리비전 등록 시 같은 컷의 ACT 작업자도 자동 태그되어야 한다
 *   (반대도 동일). 단일 scene 만 보면 한쪽 부서 작업자가 누락되는 회귀.
 *   → counterpartScene 옵션으로 BG↔ACT 양쪽 scene 의 assignee 모두 수집.
 *
 * @param scene 대상 씬 (assignee 필드 사용) — 보통 등록 부서의 씬
 * @param allUsers 전체 사용자 목록 (AuthStore.users)
 * @param excludeUserId 제외할 사용자 id (보통 등록자 본인)
 * @param counterpartScene v1.24.0: BG↔ACT 같은 컷 반대 부서 scene (assignee 추가 수집용)
 */
export function calcDefaultRecipients(
  scene: Pick<Scene, 'assignee'> | null | undefined,
  allUsers: readonly AppUser[],
  excludeUserId?: string,
  counterpartScene?: Pick<Scene, 'assignee'> | null,
): string[] {
  const ids = new Set<string>();

  // 1) 모든 컴포지터 (부서 무관)
  for (const u of findAllCompositors(allUsers)) {
    if (u.id && u.id !== excludeUserId) ids.add(u.id);
  }

  // 2) 씬 담당자 — 등록 부서 + counterpart 부서 양쪽 모두
  const collectFromScene = (s: Pick<Scene, 'assignee'> | null | undefined) => {
    if (!s) return;
    const assigneeNames = parseAssigneeNames(s.assignee);
    for (const u of namesToUsers(assigneeNames, allUsers)) {
      if (u.id && u.id !== excludeUserId) ids.add(u.id);
    }
  };
  collectFromScene(scene);
  collectFromScene(counterpartScene);

  return Array.from(ids);
}
