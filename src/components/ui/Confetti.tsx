import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import {
  CELEBRATE_GLOW_MS,
  CONFETTI_MS,
  buildConfettiPieces,
  confettiKeyframes,
  confettiPieceBox,
} from './confettiMotion';

interface ConfettiProps {
  active: boolean;
  onComplete?: () => void;
}

/**
 * 씬 완료 꽃가루 (움직임 폴리싱 17번).
 *
 * - 위로 톡 터졌다가 중력처럼 떨어지며 돌고 0.9초 안에 사라진다(키프레임은 confettiMotion.ts).
 * - 조각마다 WAAPI transform 문자열 + opacity 라 합성 스레드에서 돈다 — 화면이 바빠도 끊기지 않는다.
 * - 터지지 않을 때는 아무것도 그리지 않는다(카드 수백 장에 빈 조각을 두지 않는다).
 * - 동작 줄이기: 꽃가루를 그리지 않는다. 대신 카드의 SceneCompletionFx 가 칸 테두리를 한 번 빛내고,
 *   끝 알림(onComplete)은 그 빛이 끝날 때 보낸다.
 */
export function Confetti({ active, onComplete }: ConfettiProps) {
  const { reduce } = useMotionPref();
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const completeRef = useRef(onComplete);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  // 켜질 때마다 새 조각. 같은 축하 안에서 다시 렌더돼도 조각은 그대로다.
  const pieces = useMemo(() => (active && !reduceRef.current ? buildConfettiPieces() : null), [active]);

  // 그리기 전에 움직임을 건다 — 첫 화면부터 키프레임 첫 모습(가운데·작게)으로 보인다.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!pieces || !layer) return;
    const animations = Array.from(layer.children, (el, index) =>
      typeof el.animate === 'function' && pieces[index]
        ? el.animate(confettiKeyframes(pieces[index]), { duration: CONFETTI_MS })
        : null,
    );
    return () => animations.forEach((animation) => animation?.cancel());
  }, [pieces]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      completeRef.current?.();
    }, reduceRef.current ? CELEBRATE_GLOW_MS : CONFETTI_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!pieces) return null;
  return (
    <div ref={layerRef} aria-hidden="true" className="bf-confetti">
      {pieces.map((piece, index) => {
        const box = confettiPieceBox(piece);
        return (
          <span
            key={index}
            className="bf-confetti-piece"
            style={{
              width: box.width,
              height: box.height,
              marginLeft: -box.width / 2,
              marginTop: -box.height / 2,
              borderRadius: box.borderRadius,
              backgroundColor: piece.color,
            }}
          />
        );
      })}
    </div>
  );
}
