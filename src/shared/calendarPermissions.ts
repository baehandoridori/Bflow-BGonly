/** 공유 캘린더 권한 판정 순수 함수 (설계서 §5).
 *  메인(IPC 강제 지점)·렌더러(UI 노출)·node --test 3곳 공용.
 *  주의: @/ alias 금지 — node --test 가 직접 임포트 (상대 경로만). */

export interface CalendarPermissionTarget {
  owner_id: string;
  visibility: 'private' | 'members' | 'team';
  is_personal: boolean;
}

export interface CalendarMemberEntry {
  user_id: string;
  can_edit: boolean;
}

export interface PermissionUser {
  id: string;
  role: 'admin' | 'user';
}

/** 캘린더가 이 사용자에게 보이는가 — 소유자 / 팀 전체 / 멤버. */
export function canViewCalendar(
  cal: CalendarPermissionTarget,
  memberUserIds: string[],
  userId: string,
): boolean {
  return cal.owner_id === userId || cal.visibility === 'team' || memberUserIds.includes(userId);
}

/** 이 캘린더의 일정을 만들고/고치고/지울 수 있는가 — 소유자 + can_edit 멤버. */
export function canEditCalendarEvents(
  cal: CalendarPermissionTarget,
  members: CalendarMemberEntry[],
  userId: string,
): boolean {
  return cal.owner_id === userId || members.some((member) => member.user_id === userId && member.can_edit);
}

/** 캘린더 자체(이름·색·공개 범위·멤버·삭제)를 관리할 수 있는가.
 *  개인 캘린더(is_personal)는 admin 특례 없이 소유자 본인만 (설계서 §5). */
export function canManageCalendar(
  cal: CalendarPermissionTarget,
  user: PermissionUser,
): boolean {
  if (cal.is_personal) return cal.owner_id === user.id;
  return cal.owner_id === user.id || user.role === 'admin';
}

/** 이 공개 범위의 캘린더를 만들 수 있는가 — 팀 전체 캘린더는 admin 만 (결정 D2). */
export function canCreateCalendar(
  user: PermissionUser,
  visibility: 'private' | 'members' | 'team',
): boolean {
  return visibility !== 'team' || user.role === 'admin';
}
