/**
 * 한솔 결정 (v1.15.5): 알림 catch-up 을 위한 last_seen_at 추적.
 *
 * 사용자가 마지막으로 알림을 처리한 시각을 localStorage 에 사용자별 저장.
 * 로그인 시 그 시각 이후의 멘션 댓글을 Supabase 에서 조회해 알림 패널에 누적.
 *
 * - PC 단위 저장 (PC 간 동기화는 후속 v1.16+ 에서 검토)
 * - 첫 로그인 시 마지막 시각이 없으면 *현재* 시각으로 초기화 (이전 알림 catch-up X)
 */

const KEY_PREFIX = 'bflow_notification_last_seen_';

export function getLastSeenAt(userId: string): string | null {
  try {
    const v = localStorage.getItem(KEY_PREFIX + userId);
    return v || null;
  } catch {
    return null;
  }
}

export function setLastSeenAt(userId: string, isoString: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + userId, isoString);
  } catch { /* 개인정보보호 모드 등 — 무시 */ }
}

/** 한 번도 기록 없으면 현재 시각으로 초기화. 다음 catch-up 부터 의미 가짐. */
export function ensureLastSeenInitialized(userId: string): void {
  if (!getLastSeenAt(userId)) {
    setLastSeenAt(userId, new Date().toISOString());
  }
}

// ─── v1.25.5: 액팅 피드백 catch-up 전용 별도 키 ────────────
//   댓글 멘션 last_seen 과 분리해, 두 catch-up effect 가 서로의 lastSeen 갱신에
//   영향받지 않도록 격리.

const FEEDBACK_KEY_PREFIX = 'bflow_feedback_last_seen_';

export function getFeedbackLastSeenAt(userId: string): string | null {
  try {
    const v = localStorage.getItem(FEEDBACK_KEY_PREFIX + userId);
    return v || null;
  } catch {
    return null;
  }
}

export function setFeedbackLastSeenAt(userId: string, isoString: string): void {
  try {
    localStorage.setItem(FEEDBACK_KEY_PREFIX + userId, isoString);
  } catch { /* 무시 */ }
}

export function ensureFeedbackLastSeenInitialized(userId: string): void {
  if (!getFeedbackLastSeenAt(userId)) {
    setFeedbackLastSeenAt(userId, new Date().toISOString());
  }
}
