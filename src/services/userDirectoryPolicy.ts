export type PublicUserDirectoryStatus = 'authoritative' | 'fallback' | 'remote-unavailable';

export interface PublicUserDirectory<T> {
  status: PublicUserDirectoryStatus;
  users: T[];
}

/**
 * A successful authoritative response wins even when it is empty. Local users
 * are only a connectivity fallback and must never repopulate an intentionally
 * empty remote directory.
 */
export function selectVisibleUsers<T>(
  remote: PublicUserDirectory<T> | null,
  localUsers: T[],
): T[] {
  if (remote?.status === 'authoritative') return remote.users;
  if (remote && remote.users.length > 0) return remote.users;
  return localUsers;
}
