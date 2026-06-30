/**
 * Confetti — 모든 할일 완료 축하용 가벼운 1회 버스트 (PR 5 모션, 외부 라이브러리 없음).
 *
 * MyTasksWidget이 '사용자 완료 토글로 진행 0 전이' 시에만 짧게 렌더하고 타이머로 언마운트한다
 * (오발화 방지는 호출부 책임). reduce면 호출부가 아예 렌더하지 않는다.
 * 위젯 상단 중앙에서 조각들이 흩어지며 사라진다. pointer-events 없음.
 */
import { motion } from 'framer-motion';

// 결정적 조각(난수 없음) — 각도·거리·색을 고정 배열로.
const COLORS = ['#74B9FF', '#A29BFE', '#FDCB6E', '#00B894', '#FF8FA3'];
const PIECES = Array.from({ length: 14 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 14 + (i % 2 ? 0.3 : 0);
  const dist = 36 + (i % 4) * 12;
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist - 10, // 살짝 위로
    rotate: (i % 2 ? 1 : -1) * (120 + (i % 3) * 80),
    color: COLORS[i % COLORS.length],
    delay: (i % 5) * 0.012,
  };
});

export function Confetti() {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-6 flex items-center justify-center overflow-visible z-10" aria-hidden>
      {PIECES.map((p, i) => (
        <motion.span
          key={i}
          className="absolute block w-1.5 h-1.5 rounded-[1px]"
          style={{ background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4, rotate: p.rotate }}
          transition={{ duration: 0.85, ease: 'easeOut', delay: p.delay }}
        />
      ))}
    </div>
  );
}
