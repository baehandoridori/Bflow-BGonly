/**
 * 사용자 관리 서비스
 * 사용자 정보는 exe 옆(프로덕션) 또는 test-data/(테스트) 에 base64 인코딩 JSON 파일로 저장
 */

import type { AppUser, UsersFile, AuthSession } from '@/types';

const AUTH_FILE = 'auth.json'; // APPDATA 로컬 저장
const DEFAULT_PASSWORD = '1234';

// ─── 최초 사용자 (파일이 없을 때 자동 시드) ────

const SEED_USER: AppUser = {
  id: '00000000-0000-0000-0000-000000000001',
  name: '배한솔',
  slackId: 'U05DFV9UAN5',
  password: '1q2w3e4r!A',
  isInitialPassword: false,
  createdAt: '2025-01-01T00:00:00.000Z',
};

// ─── 사용자 목록 (공유 파일) ─────────────────

export async function loadUsers(): Promise<AppUser[]> {
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

export async function addUser(name: string, slackId: string): Promise<AppUser> {
  const users = await loadUsers();
  const newUser: AppUser = {
    id: crypto.randomUUID(),
    name,
    slackId,
    password: DEFAULT_PASSWORD,
    isInitialPassword: true,
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  await saveUsers(users);
  return newUser;
}

export async function deleteUser(userId: string): Promise<void> {
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
