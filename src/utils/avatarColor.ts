/**
 * 사용자 ID → 일관된 아바타 색 (테마 무관 개인 식별색).
 *
 * RevisionRecipientPicker 의 알림 칩과 리테이크 카드의 담당 칩이 공유한다 —
 * 같은 사용자는 어디서나 동일한 아바타 색으로 식별된다.
 */

const AVATAR_COLORS = [
  '#6C5CE7', '#74B9FF', '#FDCB6E', '#E17055',
  '#A29BFE', '#00B894', '#FF6B6B', '#F9A8D4',
];

export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
