type UserIdentity = { id: string };

type CanonicalLogoutResult = { ok: boolean; error?: string };

export type AuthoritativeUserDirectoryDeps<T extends UserIdentity> = {
  getCurrentUser(): T | null;
  setUsers(users: T[]): void;
  setCurrentUser(user: T | null): void;
  logoutCanonicalSession(): Promise<CanonicalLogoutResult>;
  onLogoutFailure?(error: unknown): void;
};

/** 이미 성공한 authoritative users 조회 결과만 받는다.
 * 현재 actor가 목록에서 사라졌으면 renderer identity를 await 전에 즉시 비워 store
 * 구독자(캘린더 개인 cache 포함)를 격리한 뒤 main canonical session도 종료한다. */
export async function reconcileAuthoritativeUserDirectory<T extends UserIdentity>(
  users: T[],
  deps: AuthoritativeUserDirectoryDeps<T>,
): Promise<'unchanged' | 'updated' | 'deleted'> {
  deps.setUsers(users);
  const current = deps.getCurrentUser();
  if (!current) return 'unchanged';

  const updated = users.find((candidate) => candidate.id === current.id);
  if (updated) {
    deps.setCurrentUser(updated);
    return 'updated';
  }

  // logout의 personal queue drain이 지연/실패해도 삭제된 actor의 renderer cache는 먼저 비운다.
  deps.setCurrentUser(null);
  try {
    const result = await deps.logoutCanonicalSession();
    if (!result.ok) deps.onLogoutFailure?.(new Error(result.error ?? 'canonical logout failed'));
  } catch (error) {
    deps.onLogoutFailure?.(error);
  }
  return 'deleted';
}
