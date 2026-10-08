/**
 * Confetti — 모든 할일 완료 축하용 가벼운 1회 버스트 (PR 5 모션, 외부 라이브러리 없음).
 *
 * MyTasksWidget이 '사용자 완료 토글로 진행 0 전이' 시에만 짧게 렌더하고 타이머로 언마운트한다
 * (오발화 방지는 호출부 책임). reduce면 호출부가 아예 렌더하지 않는다.
 * 위젯 상단 중앙에서 조각들이 흩어지며 사라진다. pointer-events 없음.
 *
 * 움직임 폴리싱 17번: 씬 완료 꽃가루와 같은 방식으로 — 조각마다 WAAPI transform 문자열 + opacity 라
 * 합성 스레드에서 돈다(예전 framer 개별 x/y/scale/rotate 값은 메인 스레드가 매 프레임 계산했다).
 */
import { useLayoutEffect, useRef } from 'react';

// 결정적 조각(난수 없음) — 각도·거리·색을 고정 배열로.
const COLORS = ['#74B9FF', '#A29BFE', '#FDCB6E', '#00B894', '#FF8FA3'];
const DURATION_MS = 850;
const PIECES = Array.from({ length: 14 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 14 + (i % 2 ? 0.3 : 0);
  const dist = 36 + (i % 4) * 12;
  const x = Math.round(Math.cos(angle) * dist * 10) / 10;
  const y = Math.round((Math.sin(angle) * dist - 10) * 10) / 10; // 살짝 위로
  const rotate = (i % 2 ? 1 : -1) * (120 + (i % 3) * 80);
  return {
    color: COLORS[i % COLORS.length],
    delay: (i % 5) * 12,
    keyframes: [
      { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)' },
      { opacity: 0, transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(0.4)` },
    ] as Keyframe[],
  };
});

export function Confetti() {
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const animations = Array.from(layer.children, (el, i) =>
      typeof el.animate === 'function' && PIECES[i]
        ? el.animate(PIECES[i].keyframes, { duration: DURATION_MS, delay: PIECES[i].delay, easing: 'ease-out', fill: 'both' })
        : null,
    );
    return () => animations.forEach((animation) => animation?.cancel());
  }, []);

  return (
    <div ref={layerRef} className="pointer-events-none absolute left-0 right-0 top-6 flex items-center justify-center overflow-visible z-10" aria-hidden>
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="absolute block w-1.5 h-1.5 rounded-[1px]"
          style={{ background: p.color }}
        />
      ))}
    </div>
  );
}
