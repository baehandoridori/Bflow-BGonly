/* ═══════════════════════════════════════════════════════════════
   축하 꽃가루 움직임 (움직임 폴리싱 17번 celebrate-done)

   위로 톡 터졌다가(0→45%) 중력처럼 110px 떨어지며 돌고 사라진다 — 총 0.9초.
   조각마다 transform 문자열 하나 + opacity 키프레임이라 WAAPI 로 넘기면 합성 스레드에서 돈다.
   (예전 framer 개별 x/y/scale/rotate 값은 메인 스레드가 매 프레임 계산해, 체크 직후 화면이 다시 그려지는
    순간과 겹치면 느린 PC 에서 뚝뚝 끊겼다.)

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 총 길이(ms). ScenesView 의 1600ms 축하 해제보다 짧아야 한다. */
export const CONFETTI_MS = 900;
export const CONFETTI_COUNT = 20;
/** 위로 튀는 구간이 끝나는 지점(전체의 45%). */
export const CONFETTI_PEAK_OFFSET = 0.45;
/** 꼭대기에서 떨어지는 거리(px). */
export const CONFETTI_FALL_PX = 110;
/** 보라·살구·초록. */
export const CONFETTI_COLORS = ['#6C5CE7', '#FDCB6E', '#00B894'] as const;
/** 위로 튈 때 — 빠르게 솟았다 꼭대기에서 멈칫. */
export const CONFETTI_RISE_EASE = 'cubic-bezier(0.2, 0.8, 0.4, 1)';
/** 떨어질 때 — 천천히 출발해 점점 빨라진다(중력). */
export const CONFETTI_FALL_EASE = 'cubic-bezier(0.5, 0, 0.9, 0.6)';
/** 동작 줄이기에서 꽃가루 대신 칸 테두리가 한 번 빛나는 길이(ms). */
export const CELEBRATE_GLOW_MS = 400;

export interface ConfettiPiece {
  /** 끝났을 때 가로 위치(px, 가운데 기준). */
  dx: number;
  /** 꼭대기까지 솟는 높이(px). */
  rise: number;
  /** 끝났을 때 회전(deg). */
  rotate: number;
  /** 조각 크기(6~9px). */
  size: number;
  round: boolean;
  color: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 터질 때마다 새 조각을 만든다. random 을 넘기면 결과가 정해진다(테스트용). */
export function buildConfettiPieces(count: number = CONFETTI_COUNT, random: () => number = Math.random): ConfettiPiece[] {
  return Array.from({ length: count }, (_, index) => ({
    dx: round1((random() - 0.5) * 180),
    rise: round1(40 + random() * 60),
    rotate: round1((random() < 0.5 ? -1 : 1) * (180 + random() * 360)),
    size: 6 + Math.round(random() * 3),
    round: random() > 0.5,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  }));
}

/** 조각 하나의 WAAPI 키프레임 — transform 문자열 + opacity 만. */
export function confettiKeyframes(piece: ConfettiPiece): Keyframe[] {
  const peakX = round1(piece.dx * 0.7);
  const peakY = round1(-piece.rise);
  const endY = round1(-piece.rise + CONFETTI_FALL_PX);
  return [
    { offset: 0, opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(0.6)', easing: CONFETTI_RISE_EASE },
    {
      offset: CONFETTI_PEAK_OFFSET,
      opacity: 1,
      transform: `translate(${peakX}px, ${peakY}px) rotate(${round1(piece.rotate * 0.4)}deg) scale(1)`,
      easing: CONFETTI_FALL_EASE,
    },
    { offset: 1, opacity: 0, transform: `translate(${piece.dx}px, ${endY}px) rotate(${piece.rotate}deg) scale(0.9)` },
  ];
}

/** 조각 모양(둥근 점 또는 납작한 띠). */
export function confettiPieceBox(piece: ConfettiPiece): { width: number; height: number; borderRadius: string } {
  return piece.round
    ? { width: piece.size, height: piece.size, borderRadius: '50%' }
    : { width: piece.size, height: Math.max(3, Math.round(piece.size * 0.6)), borderRadius: '1px' };
}
