/**
 * BAE경을 누가 쓰고 누가 보나 (계획 14의 7장). 실제로 막는 것은 서버 함수다 — 이 파일은 서버의 답을 읽는 모양과
 * 명단 값 검사만 한다. node --test 가 바로 읽으므로 '@/' 별칭을 쓰지 않는다.
 */

/** 서버가 정한 이 사람의 권리. */
export interface BaeAccess {
  canUse: boolean;      // BAE경 메뉴를 쓰기 (관리자 + 'BAE경 사용자' + '모두에게 열기'가 켜졌으면 로그인한 누구나)
  canReview: boolean;   // 팀 기록 · 비용 보기, 도장 · 코멘트 (관리자 + 'BAE경 검수자')
  isAdmin: boolean;     // 키 · 매뉴얼 · 가격표 · 명단 고치기 (Bflow 관리자)
  open: boolean;        // '모두에게 열기' 스위치
}

export const BAE_NO_ACCESS: BaeAccess = Object.freeze({ canUse: false, canReview: false, isAdmin: false, open: false });

export type BaeMemberRole = 'user' | 'reviewer';
export interface BaeMember { userId: string; role: BaeMemberRole }

export function parseBaeAccess(data: unknown): BaeAccess {
  const v = data as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !['canUse', 'canReview', 'isAdmin', 'open'].every((k) => typeof v[k] === 'boolean')) {
    throw new Error('BAE경 권한 응답이 올바르지 않아요.');
  }
  return { canUse: v.canUse as boolean, canReview: v.canReview as boolean, isAdmin: v.isAdmin as boolean, open: v.open as boolean };
}

export function parseBaeMembers(data: unknown): BaeMember[] {
  if (!Array.isArray(data) || data.length > 1000) throw new Error('BAE경 명단이 올바르지 않아요.');
  return data.map((item) => {
    const m = item as Record<string, unknown> | null;
    if (!m || typeof m.userId !== 'string' || !m.userId || m.userId.length > 200 || (m.role !== 'user' && m.role !== 'reviewer')) throw new Error('BAE경 명단 항목이 올바르지 않아요.');
    return { userId: m.userId, role: m.role };
  });
}

/** 명단 한 사람을 바꾸는 값: role 이 null 이면 명단에서 뺀다. */
export function baeMemberChangeProblem(userId: unknown, role: unknown): string | null {
  if (typeof userId !== 'string' || !userId || userId.length > 200) return 'BAE경 명단에 넣을 사람이 올바르지 않아요.';
  if (role !== null && role !== 'user' && role !== 'reviewer') return 'BAE경 명단의 역할이 올바르지 않아요.';
  return null;
}
