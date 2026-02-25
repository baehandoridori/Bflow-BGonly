/**
 * 사용자 관리 서비스
 *
 * Phase 0-4: Google Sheets _USERS 탭 동기화
 * - 시트 연결 시: _USERS 탭에서 읽기/쓰기
 * - 미연결 시: 로컬 users.dat 폴백
 * - 비밀번호: Base64 인코딩 (양방향 — 비밀번호 찾기 가능)
 */

import type { AppUser, UsersFile, AuthSession } from '@/types';

const AUTH_FILE = 'auth.json'; // APPDATA 로컬 저장
const DEFAULT_PASSWORD = '1234';

// ─── 모드 관리 ──────────────────────────────────

let sheetsMode = false;

export function setUsersSheetsMode(enabled: boolean): void {
  sheetsMode = enabled;
}

// ─── 최초 사용자 (파일이 없을 때 자동 시드) ────

const SEED_USER: AppUser = {
  id: '00000000-0000-0000-0000-000000000001',
  name: '배한솔',
  slackId: 'U05DFV9UAN5',
  password: '1q2w3e4r!A',
  isInitialPassword: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  role: 'admin',
};

// ─── 사용자 목록 ─────────────────────────────────

export async function loadUsers(): Promise<AppUser[]> {
  if (sheetsMode) {
    try {
      const result = await window.electronAPI.sheetsReadUsers();
      if (result.ok && result.data.length > 0) {
        return result.data.map(u => ({
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
      return data.users;
    }
  } catch (err) {
    console.error('[사용자] 로드 실패:', err);
  }
  // 파일 없거나 비어있으면 최초 사용자 시드
  const seeded = [{ ...SEED_USER }];
  await saveUsers(seeded);
  return seeded;
}

export async function saveUsers(users: AppUser[]): Promise<void> {
  const data: UsersFile = { users };
  await window.electronAPI.usersWrite(data);
}

export async function addUser(
  name: string, slackId: string,
  hireDate?: string, birthday?: string,
): Promise<AppUser> {
  const newUser: AppUser = {
    id: crypto.randomUUID(),
    name,
    slackId,
    password: DEFAULT_PASSWORD,
    isInitialPassword: true,
    createdAt: new Date().toISOString(),
    hireDate,
    birthday,
    role: 'user',
  };

  if (sheetsMode) {
    try {
      await window.electronAPI.sheetsAddUser(newUser);
    } catch (err) {
      console.error('[사용자] 시트 추가 실패:', err);
    }
    // 시트에서 다시 로드하여 로컬에 동기화 (중복 방지)
    const users = await loadUsers();
    await saveUsers(users);
    return newUser;
  }

  // 로컬 전용 모드
  const users = await loadUsers();
  users.push(newUser);
  await saveUsers(users);
  return newUser;
}

export async function deleteUser(userId: string): Promise<void> {
  if (sheetsMode) {
    try {
      await window.electronAPI.sheetsDeleteUser(userId);
    } catch (err) {
      console.error('[사용자] 시트 삭제 실패:', err);
    }
  }
  const users = await loadUsers();
  await saveUsers(users.filter((u) => u.id !== userId));
}

export async function changePassword(
  userId: string,
  currentPw: string,
  newPw: string
): Promise<{ ok: boolean; error?: string }> {
  const users = await loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: '사용자를 찾을 수 없습니다.' };
  if (user.password !== currentPw) return { ok: false, error: '현재 비밀번호가 일치하지 않습니다.' };

  user.password = newPw;
  user.isInitialPassword = false;
  await saveUsers(users);

  // 시트에도 반영
  if (sheetsMode) {
    try {
      await window.electronAPI.sheetsUpdateUser(userId, {
        password: newPw,
        isInitialPassword: 'false',
      });
    } catch (err) {
      console.error('[사용자] 시트 비밀번호 변경 실패:', err);
    }
  }

  return { ok: true };
}

// ─── 로그인 / 세션 (APPDATA 로컬) ───────────

export async function login(
  name: string,
  password: string
): Promise<{ ok: boolean; user?: AppUser; error?: string }> {
  const users = await loadUsers();
  const user = users.find((u) => u.name === name);
  if (!user) return { ok: false, error: '등록되지 않은 사용자입니다.' };
  if (user.password !== password) return { ok: false, error: '비밀번호가 일치하지 않습니다.' };

  // 세션 저장
  const session: AuthSession = {
    userId: user.id,
    userName: user.name,
    loggedInAt: new Date().toISOString(),
  };
  await window.electronAPI.writeSettings(AUTH_FILE, session);
  return { ok: true, user };
}

export async function logout(): Promise<void> {
  await window.electronAPI.writeSettings(AUTH_FILE, null);
}

export async function loadSession(): Promise<{ session: AuthSession | null; user: AppUser | null }> {
  try {
    const session = (await window.electronAPI.readSettings(AUTH_FILE)) as AuthSession | null;
    if (!session?.userId) return { session: null, user: null };

    // 사용자 파일에서 해당 유저가 아직 존재하는지 확인
    const users = await loadUsers();
    const user = users.find((u) => u.id === session.userId) ?? null;
    if (!user) {
      // 삭제된 사용자 → 세션 클리어
      await logout();
      return { session: null, user: null };
    }
    return { session, user };
  } catch {
    return { session: null, user: null };
  }
}

export function isInitialPassword(user: AppUser): boolean {
  return user.isInitialPassword;
}

export function getUserNames(users: AppUser[]): string[] {
  return users.map((u) => u.name);
}

/**
 * 로컬 users.dat를 _USERS 탭으로 마이그레이션한다.
 * 시트에 사용자가 없고 로컬에 있을 때 실행.
 */
export async function migrateUsersToSheets(): Promise<void> {
  if (!sheetsMode) return;

  try {
    // 시트에 이미 사용자가 있는지 확인
    const sheetResult = await window.electronAPI.sheetsReadUsers();
    if (sheetResult.ok && sheetResult.data.length > 0) return; // 이미 있으면 무시

    // 로컬 사용자 로드
    const data = await window.electronAPI.usersRead();
    if (!data || !Array.isArray(data.users) || data.users.length === 0) return;

    // 시트에 하나씩 추가
    for (const user of data.users) {
      try {
        await window.electronAPI.sheetsAddUser(user);
      } catch (err) {
        console.warn('[마이그레이션] 사용자 추가 실패:', user.name, err);
      }
    }
    console.log(`[마이그레이션] ${data.users.length}명의 사용자를 _USERS 탭으로 이전 완료`);
  } catch (err) {
    console.error('[마이그레이션] 사용자 마이그레이션 실패:', err);
  }
}
