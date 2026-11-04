/**
 * 스레드 팔로우·알림 끄기 (씬 댓글 B안 §6.4, v1.148.0) — 순수 함수. node --test 로 바로 검사한다.
 *
 * 키: `{씬 대화 키}#{원댓글 id | re:리테이크 id}` — 씬 대화 키는 CommentPanel 의 effectiveSceneThreadKey 와 같은 규칙('EP05:A:a001').
 * 씬 전체 끄기(알림 센터 '이 씬 알림 끄기')는 `#` 없이 씬 대화 키만.
 *  - 'mute'  : 그 스레드(또는 씬)의 자동 알림(담당·참여자)을 빼고, 나를 직접 부른 알림(멘션·답글·리테이크)은 그대로.
 *  - 'follow': 그 스레드의 새 글을 토스트가 뜨는 '댓글' 알림으로(나를 부른 알림보다는 약하게).
 * 원댓글·리테이크 id 는 겹치지 않는 UUID 라, 씬 대화 키가 화면마다 조금 달라도(통합 상세의 merged-/raw- 키) 스레드 id 만으로도 찾는다.
 */

export type ThreadPreference = 'follow' | 'mute';
export type ThreadPreferenceMap = Record<string, ThreadPreference>;

export const MAX_THREAD_PREFERENCES = 500;

/** 댓글이 속한 스레드 id — 리테이크 댓글은 're:{리테이크 id}', 답글은 원댓글 id, 원댓글은 자기 id. */
export function commentThreadIdOf(comment: { commentId?: string | null; id?: string | null; parentCommentId?: string | null; revisionId?: string | null }): string | null {
  if (comment.revisionId) return `re:${comment.revisionId}`;
  return comment.parentCommentId || comment.commentId || comment.id || null;
}

export function buildCommentThreadKey(sceneThreadKey: string, threadId: string): string {
  return `${sceneThreadKey}#${threadId}`;
}

function threadIdOfKey(key: string): string | null {
  const at = key.lastIndexOf('#');
  return at >= 0 ? key.slice(at + 1) || null : null;
}

/** 저장된 값 → 깨끗한 지도(모양이 어긋난 것은 버리고, 넘치면 오래된 것부터). */
export function sanitizeThreadPreferences(raw: unknown, limit = MAX_THREAD_PREFERENCES): ThreadPreferenceMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, ThreadPreference] => typeof entry[0] === 'string' && entry[0].length > 0 && entry[0].length <= 300
      && (entry[1] === 'follow' || entry[1] === 'mute'));
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - limit)));
}

/** 하나 바꾸기(null 이면 지움). 바꾼 것은 맨 뒤로 — 넘치면 가장 오래 안 건드린 것부터 뺀다. */
export function setThreadPreference(
  prefs: ThreadPreferenceMap,
  key: string,
  value: ThreadPreference | null,
  limit = MAX_THREAD_PREFERENCES,
): ThreadPreferenceMap {
  const next: ThreadPreferenceMap = {};
  for (const [k, v] of Object.entries(prefs)) if (k !== key) next[k] = v;
  if (value) next[key] = value;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - limit))) delete next[k];
  return next;
}

/**
 * 이 댓글에 걸린 설정 — 스레드가 씬보다 먼저.
 *  1) `{씬}#{스레드}` 그대로 2) 다른 씬 키로 저장된 같은 스레드(`…#{스레드}`) 3) 씬 전체 `{씬}`.
 */
export function resolveThreadPreference(
  prefs: ThreadPreferenceMap,
  ref: { threadId: string | null; sceneThreadKey: string | null },
): ThreadPreference | null {
  const { threadId, sceneThreadKey } = ref;
  if (threadId) {
    if (sceneThreadKey) {
      const exact = prefs[buildCommentThreadKey(sceneThreadKey, threadId)];
      if (exact) return exact;
    }
    for (const [key, value] of Object.entries(prefs)) {
      if (threadIdOfKey(key) === threadId) return value;
    }
  }
  if (sceneThreadKey && prefs[sceneThreadKey]) return prefs[sceneThreadKey];
  return null;
}

/** 계정마다 따로(같은 PC 다른 계정에 끄기가 번지지 않게) — %APPDATA%\Bflow-BGonly\comment-thread-follow.{계정}.json */
export function threadPreferenceFileName(userId: string): string {
  const safe = userId.trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
  return `comment-thread-follow.${safe}.json`;
}
