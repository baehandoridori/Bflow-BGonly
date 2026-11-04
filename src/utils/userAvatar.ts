/**
 * 사람 아바타 — 이니셜과 사람마다 고정된 색 (씬 댓글 B안 §5.2, v1.147.0).
 * 예전 RevisionCommentThread 의 avatarColor(같은 해시·같은 8색)를 공용으로 올렸다. 색은 하드코딩하지 않고
 * CSS 변수(--avatar-1 … --avatar-8, styles/comment-panel.css — 다크·라이트 따로)를 가리킨다.
 * node --test 로 바로 검사한다.
 */

export const AVATAR_PALETTE_SIZE = 8;

/** 같은 사람은 언제나 같은 칸(1~8). 예전 avatarColor 와 같은 해시. */
export function avatarSlot(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % AVATAR_PALETTE_SIZE) + 1;
}

/** style={{ background: avatarColor(id) }} 에 바로 쓰는 색. */
export function avatarColor(seed: string): string {
  return `var(--avatar-${avatarSlot(seed)})`;
}

/** 이니셜 — 이름 뒤 두 글자('배한솔' → '한솔'). 두 글자 이하는 그대로, 비면 '?'. */
export function avatarInitials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const chars = Array.from(trimmed);
  return chars.length <= 2 ? trimmed : chars.slice(-2).join('');
}
