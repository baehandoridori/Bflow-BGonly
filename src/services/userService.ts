/**
 * 사용자 관리 서비스
 *
 * Phase 0-4: Google Sheets _USERS 탭 동기화
 * - 시트 연결 시: _USERS 탭에서 읽기/쓰기
 * - 미연결 시: 로컬 users.dat 폴백
 * - 비밀번호 검증/변경은 메인 프로세스만 수행하며 렌더러 목록에는 노출하지 않음
 */

import type { AppUser, AuthSession, PublicUserDirectory } from '@/types';
import { createUuid } from '@/utils/createUuid';
import { useAuthStore } from '@/stores/useAuthStore';
import { selectVisibleUsers } from './userDirectoryPolicy';

// ─── 모드 관리 ──────────────────────────────────

let sheetsMode = false;

export function setUsersSheetsMode(enabled: boolean): void {
  sheetsMode = enabled;
}

// ─── 최초 사용자 (파일이 없을 때 자동 시드) ────
// 실 운영은 Supabase 사용자 row가 기준이며, 이 객체는 목록 표시용 fallback일 뿐
// 로그인 자격 증명을 만들거나 변경하지 않는다.

const SEED_USER: AppUser = {
  id: '00000000-0000-0000-0000-000000000001',
  name: '배한솔',
  slackId: 'U05DFV9UAN5',
  isInitialPassword: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  role: 'admin',
};

// ─── 사용자 목록 ─────────────────────────────────

export async function loadUsers(): Promise<AppUser[]> {
  let remoteDirectory: PublicUserDirectory | null = null;
  if (sheetsMode) {
    try {
      remoteDirectory = await window.electronAPI.supabaseReadUsers();
      if (remoteDirectory.status === 'authoritative' || remoteDirectory.users.length > 0) {
        return selectVisibleUsers(remoteDirectory, []).map(u => ({
          ...u,
          hireDate: u.hireDate || undefined,
          birthday: u.birthday || undefined,
          role: u.role || 'user',
        }));
      }
    } catch (err) {
      console.warn('[사용자] 시트 로드 실패, 로컬 폴백:', err);
    }
  }

  // 로컬 폴백
  try {
    const data = await window.electronAPI.usersRead();
    if (data && Array.isArray(data.users) && data.users.length > 0) {
      return selectVisibleUsers(remoteDirectory, data.users);
    }
  } catch (err) {
    console.error('[사용자] 로드 실패:', err);
  }
  // 파일 없거나 비어있으면 최초 사용자 시드
  return [{ ...SEED_USER }];
}

export async function addUser(
  name: string, slackId: string,
  hireDate?: string, birthday?: string,
): Promise<AppUser> {
  const newUser: AppUser = {
    id: createUuid(),
    name,
    slackId,
    isInitialPassword: true,
    createdAt: new Date().toISOString(),
    hireDate,
    birthday,
    role: 'user',
  };

  if (sheetsMode) {
    try {
      await window.electronAPI.supabaseAddUser(newUser);
      return newUser;
    } catch (err) {
      console.error('[사용자] 시트 추가 실패, 로컬 폴백:', err);
    }
  }

  return window.electronAPI.createLocalUser({ name, slackId, hireDate, birthday });
}

export async function deleteUser(userId: string): Promise<void> {
  if (sheetsMode) {
    try {
      await window.electronAPI.supabaseDeleteUser(userId);
      return;
    } catch (err) {
      console.error('[사용자] 시트 삭제 실패, 로컬 폴백:', err);
    }
  }
  await window.electronAPI.deleteLocalUser(userId);
}

export async function changePassword(
  userId: string,
  currentPw: string,
  newPw: string
): Promise<{ ok: boolean; error?: string }> {
  void userId;
  return window.electronAPI.changeOwnPassword({ currentPassword: currentPw, newPassword: newPw });
}

// ─── 로그인 / 세션 (APPDATA 로컬) ───────────

export async function login(
  name: string,
  password: string,
  rememberMe: boolean = true,
): Promise<{ ok: boolean; user?: AppUser; error?: string }> {
  const result = await window.electronAPI.loginCanonicalSession({ name, password, rememberMe });
  const user = result.payload.user;
  return result.ok && user
    ? { ok: true, user }
    : { ok: false, error: result.error ?? '로그인에 실패했습니다.' };
}

export async function logout(): Promise<void> {
  const result = await window.electronAPI.logoutCanonicalSession();
  if (!result.ok) throw new Error(result.error ?? '로그아웃에 실패했습니다.');
}

export async function loadSession(): Promise<{ session: AuthSession | null; user: AppUser | null; error?: string }> {
  const result = await window.electronAPI.restoreCanonicalSession();
  const user = result.payload.user;
  if (!result.ok || !user) return { session: null, user: null, error: result.error };
  return {
    session: result.payload.session,
    user,
  };
}

export function isInitialPassword(user: AppUser): boolean {
  return user.isInitialPassword;
}

export function getUserNames(users: AppUser[]): string[] {
  return users.map((u) => u.name);
}

/**
 * v1.18.1: 어드민 전용 — 컴포지터 지정/해제 (부서 구분 없음, 단일 BOOLEAN).
 * 한솔 정정: 컴포지터는 BG/ACT 로 나뉘지 않는다.
 * supabase users.is_compositor 컬럼 직접 업데이트.
 */
export async function setIsCompositor(
  userId: string,
  value: boolean,
): Promise<void> {
  await window.electronAPI.supabaseUpdateUser(userId, { isCompositor: value });
}

/**
 * v1.25.4 한솔 보고 fix (저장 안 됨): loadUsers 의 sheetsMode 게이트 우회.
 * sheetsMode=false 거나 Supabase 일시 throw 일 때 silent 로컬 폴백되면
 * 어드민 저장 verify 단계에서 fresh 가 stale 로컬 (is_compositor / is_acting_supervisor 누락)
 * 으로 잡혀 항상 mismatch → toast.error("DB 반영이 확인되지 않았습니다") 만 떴음.
 *
 * 이 함수는 sheetsMode 무시하고 항상 Supabase 직결 IPC 만 사용. 실패 시 throw.
 * 어드민 섹션의 verify 단계에서만 사용 (일반 로딩은 loadUsers 그대로).
 */
export async function fetchFreshUsersFromSupabase(): Promise<AppUser[]> {
  const directory = await window.electronAPI.supabaseReadUsers();
  const users = directory.users;
  return users.map((u) => ({
    ...u,
    hireDate: u.hireDate || undefined,
    birthday: u.birthday || undefined,
    role: u.role || 'user',
  }));
}

/**
 * v1.25.6 한솔 보고 fix: 어드민 저장 verify 단계 강화.
 *
 * 보고: "DB 반영이 확인되지 않았습니다" toast 가 떴지만 실제 DB 는 update 성공 (윤성원
 *   is_acting_supervisor=true 로 한솔님이 저장한 결과 확인). 즉 fresh fetch 시점에
 *   PostgREST schema cache stale 또는 일시적 read-after-write lag 으로 stale 결과.
 *
 * 대응:
 *  1) 1차 fetch → mismatch 면 1초 sleep 후 1차 retry
 *  2) 그래도 mismatch 면 fresh 와 diff 정보 (extra/missing 사용자 이름) 반환
 *     → toast/console 에 어떤 사용자가 어긋나는지 명확히 보여 진단 용이.
 */
export interface VerifyResult {
  fresh: AppUser[];
  mismatched: boolean;
  diff: {
    /** DB 에는 있지만 의도 set 에 없는 사용자 (의도치 않게 추가 저장됨) */
    extra: AppUser[];
    /** 의도 set 에는 있지만 DB 에 없는 사용자 (저장 실패) */
    missing: AppUser[];
  };
}

export async function verifyUserBoolPropAfterSave(
  expectedIds: Set<string>,
  propName: 'isCompositor' | 'isActingSupervisor',
): Promise<VerifyResult> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const fetchAndCompare = async () => {
    const fresh = await fetchFreshUsersFromSupabase();
    const actualIds = new Set(
      fresh.filter((u) => u[propName] === true).map((u) => u.id),
    );
    const mismatched = [...expectedIds].some((id) => !actualIds.has(id))
      || [...actualIds].some((id) => !expectedIds.has(id));
    return { fresh, actualIds, mismatched };
  };

  // 1차 — 즉시
  let res = await fetchAndCompare();
  // 2차 — PostgREST schema cache stale / read-after-write lag 대응
  if (res.mismatched) {
    await sleep(1000);
    res = await fetchAndCompare();
  }

  const extra = res.fresh.filter((u) => res.actualIds.has(u.id) && !expectedIds.has(u.id));
  const missing = res.fresh.filter((u) => expectedIds.has(u.id) && !res.actualIds.has(u.id));
  return { fresh: res.fresh, mismatched: res.mismatched, diff: { extra, missing } };
}

/**
 * v1.25.0~: 어드민 전용 — 액팅 검수자(애니메이팅 수퍼바이저) 지정/해제.
 * 컴포지터와 독립적인 별도 boolean. 한 사람이 둘 다 가능.
 * spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 6)
 */
export async function setIsActingSupervisor(
  userId: string,
  value: boolean,
): Promise<void> {
  await window.electronAPI.supabaseUpdateUser(userId, { isActingSupervisor: value });
}

/**
 * 로컬 users.dat를 _USERS 탭으로 마이그레이션한다.
 * 시트에 사용자가 없고 로컬에 있을 때 실행.
 */
export async function migrateUsersToSheets(): Promise<void> {
  if (!sheetsMode) return;

  try {
    // Supabase에 이미 사용자가 있는지 확인
    const existingUsers = (await window.electronAPI.supabaseReadUsers()).users;
    if (existingUsers.length > 0) return; // 이미 있으면 무시

    // 로컬 사용자 로드
    const data = await window.electronAPI.usersRead();
    if (!data || !Array.isArray(data.users) || data.users.length === 0) return;

    // 비어 있는 DB의 첫 행은 main canonical session과 같은 local admin이어야 한다.
    // 로컬 파일 순서가 달라도 현재 로그인 admin을 먼저 보내고, 첫 insert 뒤에는 DB가
    // 그 actor의 admin role을 잠금 재검증해 나머지 사용자를 순차 추가한다.
    const actorId = useAuthStore.getState().currentUser?.id;
    const orderedUsers = actorId
      ? [...data.users].sort((a, b) => Number(b.id === actorId) - Number(a.id === actorId))
      : data.users;
    for (const user of orderedUsers) {
      try {
        await window.electronAPI.supabaseAddUser(user);
      } catch (err) {
        console.warn('[마이그레이션] 사용자 추가 실패:', user.name, err);
      }
    }
    console.log(`[마이그레이션] ${data.users.length}명의 사용자를 Supabase로 이전 완료`);
  } catch (err) {
    console.error('[마이그레이션] 사용자 마이그레이션 실패:', err);
  }
}
