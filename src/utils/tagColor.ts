/**
 * 태그별 고유색 — 캐릭터 현황판 / 에피소드 에셋 보드 공유.
 * 태그 문자열을 해시해 팔레트에서 결정적 색을 고른다. 같은 태그 = 항상 같은 색.
 */

const TAG_PALETTE = [
  '#74B9FF', '#A29BFE', '#FDCB6E', '#00B894', '#FF7675', '#FD79A8',
  '#55EFC4', '#E17055', '#81ECEC', '#FAB1A0', '#6C5CE7', '#00CEC9',
];

export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}
