/**
 * v1.29.0 — 댓글 이모지 반응 알림에서 누적 이모지 배열을 표시용 문자열로 포맷팅.
 *
 * 5개 이하면 전부 이어 붙임, 초과하면 첫 5개 + "+N" 으로 truncate.
 * UI 의 좁은 알림 행에서 폭이 너무 늘어나는 것을 막기 위함.
 *
 * spec: docs/superpowers/specs/2026-05-21-comment-reaction-notifications-design.md
 */
export function formatReactionEmojiList(
  emojis: string[],
  maxVisible: number = 5,
): string {
  if (emojis.length === 0) return '';
  if (emojis.length <= maxVisible) return emojis.join('');
  return emojis.slice(0, maxVisible).join('') + `+${emojis.length - maxVisible}`;
}

/**
 * derived `lastEmoji` — 알림 좌측 아이콘에 표시할 가장 최근 이모지.
 * 비어 있으면 fallback ('💬').
 */
export function lastReactionEmoji(emojis: string[], fallback: string = '💬'): string {
  return emojis.length > 0 ? emojis[emojis.length - 1] : fallback;
}

/** v1.29.0: 알림 패널/토스트 표시용 한 줄 title. */
export function buildReactionNotificationTitle(actorName: string, emojis: string[]): string {
  const text = formatReactionEmojiList(emojis);
  return text
    ? `${actorName}가 회원님 댓글에 ${text} 반응을 남겼어요`
    : `${actorName}가 회원님 댓글에 반응을 남겼어요`;
}
