export const COMMENT_READ_STATE_EVENT = 'bflow:comment-read-state-changed';

const FIRST_RETRY_DELAY_MS = 10_000;
const REPEATED_RETRY_DELAY_MS = 30_000;
const MAX_AUTO_RETRY_ATTEMPTS = 2;

type CommentTimestampLike = {
  createdAt?: string | null;
};

type CommentAuthorTimestampLike = CommentTimestampLike & {
  userId?: string | null;
};

type CommentReadState = Record<string, string>;

type MarkSceneThreadReadInput = {
  userId: string;
  sceneThreadKey: string;
  readAt: string;
};

type CommentReadStateRowLike = {
  userId?: string;
  sceneThreadKey: string;
  lastReadAt: string;
  updatedAt?: string;
};

export type CommentReadStatePersistence = {
  read: (userId: string) => Promise<CommentReadStateRowLike[]>;
  upsert: (userId: string, sceneThreadKey: string, lastReadAt: string) => Promise<void>;
};

type PendingWrite = MarkSceneThreadReadInput & {
  autoRetryAttempts: number;
  failureCount: number;
  timer: ReturnType<typeof setTimeout> | null;
  version: number;
};

type PendingWriteSnapshot = MarkSceneThreadReadInput & {
  version: number;
};

type SupabaseServiceModule = typeof import('./supabaseService.ts');

const cacheByUser = new Map<string, CommentReadState>();
const pendingWrites = new Map<string, PendingWrite>();

let persistenceOverride: CommentReadStatePersistence | null = null;
let pendingVersionSequence = 0;

async function getDefaultPersistence(): Promise<CommentReadStatePersistence> {
  if (typeof window === 'undefined') {
    throw new Error('Comment read state persistence is unavailable outside the renderer process.');
  }

  const module: SupabaseServiceModule = await import('./supabaseService.ts');
  return {
    read: module.readCommentReadStatesFromSupabase,
    upsert: module.upsertCommentReadStateInSupabase,
  };
}

async function getPersistence(): Promise<CommentReadStatePersistence> {
  if (persistenceOverride) return persistenceOverride;
  return getDefaultPersistence();
}

function getPendingKey(userId: string, sceneThreadKey: string): string {
  return `${userId}\u0000${sceneThreadKey}`;
}

function normalizeTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isNewerThanExisting(nextAt: string, existingAt?: string | null): boolean {
  if (!existingAt) return true;
  const nextMs = Date.parse(nextAt);
  const existingMs = Date.parse(existingAt);
  if (!Number.isFinite(nextMs)) return false;
  if (!Number.isFinite(existingMs)) return true;
  return nextMs > existingMs;
}

function isAfter(at: string, baseline: string): boolean {
  return Date.parse(at) > Date.parse(baseline);
}

function getMutableUserCache(userId: string): CommentReadState {
  const existing = cacheByUser.get(userId);
  if (existing) return existing;

  const state: CommentReadState = {};
  cacheByUser.set(userId, state);
  return state;
}

function dispatchReadStateChanged(userId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COMMENT_READ_STATE_EVENT, { detail: { userId } }));
}

function clearPendingTimer(pending: PendingWrite): void {
  if (!pending.timer) return;
  clearTimeout(pending.timer);
  pending.timer = null;
}

function scheduleRetry(pending: PendingWrite): void {
  clearPendingTimer(pending);

  if (pending.autoRetryAttempts >= MAX_AUTO_RETRY_ATTEMPTS) return;

  pending.autoRetryAttempts += 1;
  const delay = pending.autoRetryAttempts === 1 ? FIRST_RETRY_DELAY_MS : REPEATED_RETRY_DELAY_MS;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void flushPendingWrite(pending, { scheduleOnFailure: true });
  }, delay);

  const timerWithUnref = pending.timer as ReturnType<typeof setTimeout> & { unref?: () => void };
  timerWithUnref.unref?.();
}

function snapshotPendingWrite(pending: PendingWrite): PendingWriteSnapshot {
  return {
    userId: pending.userId,
    sceneThreadKey: pending.sceneThreadKey,
    readAt: pending.readAt,
    version: pending.version,
  };
}

function completePendingWriteAfterSuccessfulSave(attempted: MarkSceneThreadReadInput): void {
  const key = getPendingKey(attempted.userId, attempted.sceneThreadKey);
  const current = pendingWrites.get(key);
  if (!current) return;

  if (isAfter(current.readAt, attempted.readAt)) {
    if (!current.timer) {
      scheduleRetry(current);
    }
    return;
  }

  clearPendingTimer(current);
  pendingWrites.delete(key);
}

function queuePendingWrite(input: MarkSceneThreadReadInput): void {
  const key = getPendingKey(input.userId, input.sceneThreadKey);
  const existing = pendingWrites.get(key);

  if (existing) {
    if (!isNewerThanExisting(input.readAt, existing.readAt)) {
      scheduleRetry(existing);
      return;
    }

    existing.readAt = input.readAt;
    existing.autoRetryAttempts = 0;
    existing.failureCount = 0;
    existing.version = ++pendingVersionSequence;
    scheduleRetry(existing);
    return;
  }

  const pending: PendingWrite = {
    ...input,
    autoRetryAttempts: 0,
    failureCount: 0,
    timer: null,
    version: ++pendingVersionSequence,
  };
  pendingWrites.set(key, pending);
  scheduleRetry(pending);
}

async function saveReadState(input: MarkSceneThreadReadInput): Promise<void> {
  const persistence = await getPersistence();
  await persistence.upsert(input.userId, input.sceneThreadKey, input.readAt);
}

async function flushPendingWrite(
  pending: PendingWrite,
  options: { scheduleOnFailure: boolean },
): Promise<void> {
  const attempted = snapshotPendingWrite(pending);
  const key = getPendingKey(attempted.userId, attempted.sceneThreadKey);

  try {
    await saveReadState(attempted);
    completePendingWriteAfterSuccessfulSave(attempted);
  } catch (err) {
    console.warn('[댓글 읽음] Supabase 저장 실패:', err);

    const current = pendingWrites.get(key);
    if (!current) return;

    if (!isAfter(current.readAt, attempted.readAt)) {
      current.failureCount += 1;
    }

    if (options.scheduleOnFailure) {
      scheduleRetry(current);
    }
  }
}

async function flushPendingWritesForUser(userId: string): Promise<void> {
  const writes = [...pendingWrites.values()].filter((pending) => pending.userId === userId);
  await Promise.all(writes.map((pending) => flushPendingWrite(pending, { scheduleOnFailure: false })));
}

function applyReadStateToCache(userId: string, sceneThreadKey: string, readAt: string): boolean {
  const normalizedReadAt = normalizeTimestamp(readAt);
  if (!userId || !sceneThreadKey || !normalizedReadAt) return false;

  const userState = getMutableUserCache(userId);
  if (!isNewerThanExisting(normalizedReadAt, userState[sceneThreadKey])) return false;

  userState[sceneThreadKey] = normalizedReadAt;
  return true;
}

export function getLatestOtherUserCommentCreatedAt(
  comments: readonly CommentAuthorTimestampLike[],
  currentUserId: string,
): string | null {
  let latestAt: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const comment of comments) {
    if (comment.userId && comment.userId === currentUserId) continue;

    const normalizedCreatedAt = normalizeTimestamp(comment.createdAt);
    if (!normalizedCreatedAt) continue;

    const createdMs = Date.parse(normalizedCreatedAt);
    if (createdMs > latestMs) {
      latestMs = createdMs;
      latestAt = normalizedCreatedAt;
    }
  }

  return latestAt;
}

export function getLatestCommentCreatedAt(comments: readonly CommentTimestampLike[]): string | null {
  let latestAt: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const comment of comments) {
    const normalizedCreatedAt = normalizeTimestamp(comment.createdAt);
    if (!normalizedCreatedAt) continue;

    const createdMs = Date.parse(normalizedCreatedAt);
    if (createdMs > latestMs) {
      latestMs = createdMs;
      latestAt = normalizedCreatedAt;
    }
  }

  return latestAt;
}

export function isCommentKeyUnread(latestCommentAt?: string | null, seenAt?: string | null): boolean {
  const normalizedLatestAt = normalizeTimestamp(latestCommentAt);
  if (!normalizedLatestAt) return false;

  const normalizedSeenAt = normalizeTimestamp(seenAt);
  if (!normalizedSeenAt) return true;

  return Date.parse(normalizedLatestAt) > Date.parse(normalizedSeenAt);
}

export function primeCommentReadStateForUser(userId: string, state: Record<string, string>): void {
  if (!userId) return;

  const userState = getMutableUserCache(userId);
  for (const [sceneThreadKey, readAt] of Object.entries(state)) {
    applyReadStateToCache(userId, sceneThreadKey, readAt);
  }

  cacheByUser.set(userId, userState);
}

export async function getCommentReadStateForUser(userId: string): Promise<Record<string, string>> {
  if (!userId) return {};

  try {
    await flushPendingWritesForUser(userId);
  } catch (err) {
    console.warn('[댓글 읽음] 대기 중인 저장 반영 실패:', err);
  }

  try {
    const persistence = await getPersistence();
    const rows = await persistence.read(userId);
    for (const row of rows) {
      applyReadStateToCache(userId, row.sceneThreadKey, row.lastReadAt);
    }
  } catch (err) {
    console.warn('[댓글 읽음] Supabase 상태 로드 실패, 캐시를 사용합니다:', err);
  }

  return { ...(cacheByUser.get(userId) ?? {}) };
}

export async function markSceneThreadReadForUser(input: MarkSceneThreadReadInput): Promise<void> {
  const normalizedReadAt = normalizeTimestamp(input.readAt);
  if (!input.userId || !input.sceneThreadKey || !normalizedReadAt) return;

  const normalizedInput: MarkSceneThreadReadInput = {
    userId: input.userId,
    sceneThreadKey: input.sceneThreadKey,
    readAt: normalizedReadAt,
  };

  const changed = applyReadStateToCache(
    normalizedInput.userId,
    normalizedInput.sceneThreadKey,
    normalizedInput.readAt,
  );
  if (!changed) return;

  dispatchReadStateChanged(normalizedInput.userId);

  try {
    await saveReadState(normalizedInput);
    completePendingWriteAfterSuccessfulSave(normalizedInput);
  } catch (err) {
    console.warn('[댓글 읽음] Supabase 저장 실패, 재시도 예약:', err);
    queuePendingWrite(normalizedInput);
  }
}

export async function markCommentKeysSeen(
  userId: string,
  latestBySceneKey: Record<string, string | null | undefined>,
): Promise<void> {
  if (!userId) return;

  await Promise.all(
    Object.entries(latestBySceneKey).map(([sceneThreadKey, readAt]) =>
      markSceneThreadReadForUser({ userId, sceneThreadKey, readAt: readAt ?? '' }),
    ),
  );
}

export function __setCommentReadStatePersistenceForTests(
  persistence: CommentReadStatePersistence | null,
): void {
  persistenceOverride = persistence;
}

export async function __flushPendingCommentReadStateForTests(userId: string): Promise<void> {
  await flushPendingWritesForUser(userId);
}

export function __getPendingCommentReadStateForTests(
  userId: string,
  sceneThreadKey: string,
): { autoRetryAttempts: number; failureCount: number; hasTimer: boolean; readAt: string; version: number } | null {
  const pending = pendingWrites.get(getPendingKey(userId, sceneThreadKey));
  if (!pending) return null;

  return {
    autoRetryAttempts: pending.autoRetryAttempts,
    failureCount: pending.failureCount,
    hasTimer: !!pending.timer,
    readAt: pending.readAt,
    version: pending.version,
  };
}

export function __hasCommentReadStatePersistenceOverrideForTests(): boolean {
  return !!persistenceOverride;
}

export function __resetCommentReadStateServiceForTests(): void {
  cacheByUser.clear();
  persistenceOverride = null;
  pendingVersionSequence = 0;

  for (const pending of pendingWrites.values()) {
    clearPendingTimer(pending);
  }
  pendingWrites.clear();
}
