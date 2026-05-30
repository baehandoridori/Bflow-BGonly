export const COMMENT_READ_STATE_EVENT = 'bflow:comment-read-state-changed';

const FIRST_RETRY_DELAY_MS = 10_000;
const REPEATED_RETRY_DELAY_MS = 30_000;

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

type PendingWrite = MarkSceneThreadReadInput & {
  failureCount: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type SupabaseServiceModule = typeof import('./supabaseService.ts');

const cacheByUser = new Map<string, CommentReadState>();
const pendingWrites = new Map<string, PendingWrite>();

async function getSupabaseService(): Promise<SupabaseServiceModule> {
  return import('./supabaseService.ts');
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

  const delay = pending.failureCount <= 1 ? FIRST_RETRY_DELAY_MS : REPEATED_RETRY_DELAY_MS;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void flushPendingWrite(pending);
  }, delay);

  pending.timer.unref?.();
}

function queuePendingWrite(input: MarkSceneThreadReadInput, failureCount = 1): void {
  const key = getPendingKey(input.userId, input.sceneThreadKey);
  const existing = pendingWrites.get(key);

  if (existing) {
    if (isNewerThanExisting(input.readAt, existing.readAt)) {
      existing.readAt = input.readAt;
    }
    existing.failureCount = Math.max(existing.failureCount, failureCount);
    scheduleRetry(existing);
    return;
  }

  const pending: PendingWrite = { ...input, failureCount, timer: null };
  pendingWrites.set(key, pending);
  scheduleRetry(pending);
}

async function saveReadStateToSupabase(input: MarkSceneThreadReadInput): Promise<void> {
  const { upsertCommentReadStateInSupabase } = await getSupabaseService();
  await upsertCommentReadStateInSupabase(input.userId, input.sceneThreadKey, input.readAt);
}

async function flushPendingWrite(pending: PendingWrite): Promise<void> {
  try {
    await saveReadStateToSupabase(pending);
    pendingWrites.delete(getPendingKey(pending.userId, pending.sceneThreadKey));
  } catch (err) {
    console.warn('[댓글 읽음] Supabase 저장 재시도 예약:', err);
    pending.failureCount += 1;
    scheduleRetry(pending);
  }
}

async function flushPendingWritesForUser(userId: string): Promise<void> {
  const writes = [...pendingWrites.values()].filter((pending) => pending.userId === userId);
  await Promise.all(writes.map((pending) => flushPendingWrite(pending)));
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
    const { readCommentReadStatesFromSupabase } = await getSupabaseService();
    const rows = await readCommentReadStatesFromSupabase(userId);
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
    await saveReadStateToSupabase(normalizedInput);
    pendingWrites.delete(getPendingKey(normalizedInput.userId, normalizedInput.sceneThreadKey));
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

export function __resetCommentReadStateServiceForTests(): void {
  cacheByUser.clear();

  for (const pending of pendingWrites.values()) {
    clearPendingTimer(pending);
  }
  pendingWrites.clear();
}
