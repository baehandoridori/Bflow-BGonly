// 어두운 배경(#0F1117)에서 잘 보이는 색상 팔레트
const USER_COLORS = [
  '#6C5CE7', // 보라
  '#00B894', // 민트
  '#E17055', // 코랄
  '#74B9FF', // 하늘
  '#FDCB6E', // 골드
  '#A29BFE', // 라벤더
  '#FF6B6B', // 로즈
  '#55EFC4', // 청록
  '#FAB1A0', // 살몬
  '#81ECEC', // 시안
  '#DFE6E9', // 실버
  '#FF9FF3', // 핑크
  '#48DBFB', // 아쿠아
  '#FECA57', // 노랑
  '#F368E0', // 마젠타
  '#1DD1A1', // 에메랄드
];

/** 사용자 이름 -> 고유 색상 (이름 해시 기반) */
export function getUserColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}
