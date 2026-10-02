import { useEffect, useRef } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import type { FrameLoop } from '@/utils/frameLoop';

/**
 * 계속 움직이는 배경 캔버스(대시보드·로그인 플렉서스, StarNest 두 종)의 루프 문지기. (움직임 폴리싱 바탕 B)
 *
 * 동작 줄이기·움직임 '가볍게'·'최소'면 still=true — 배경을 한 장만 그리고 멈춘다(계속 반복되는 장식).
 * 사용법:
 *   const { stillRef, loopRef } = useBackgroundLoopGate(redrawKey);
 *   useEffect(() => {
 *     ...캔버스 준비...
 *     const loop = createFrameLoop(draw, { still: stillRef.current });
 *     loopRef.current = loop;
 *     // 크기가 바뀌면 캔버스가 지워지므로 resize 끝에 loopRef.current?.invalidate()
 *     return () => { loop.dispose(); loopRef.current = null; };
 *   }, [...]);
 * - still 이 바뀌면 이 훅이 loop.setStill 로 넘긴다(다시 움직이면 루프를 이어 간다).
 * - redrawKey 가 바뀌면(멈춘 동안 설정·색이 바뀜) 한 장을 다시 그린다. 움직이는 중이면 아무것도 하지 않는다.
 */
export function useBackgroundLoopGate(redrawKey?: unknown) {
  const { lite: still } = useMotionPref();
  const stillRef = useRef(still);
  stillRef.current = still;
  const loopRef = useRef<FrameLoop | null>(null);

  useEffect(() => {
    loopRef.current?.setStill(still);
  }, [still]);

  useEffect(() => {
    if (still) loopRef.current?.invalidate();
  }, [still, redrawKey]);

  return { still, stillRef, loopRef };
}
