import { useCallback, useEffect, useRef } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import type { FrameLoop, FrameLoopOptions } from '@/utils/frameLoop';
import {
  BACKGROUND_LOOP_MAX_FPS,
  withEntryCurtainHold,
  readBackgroundActivity,
  subscribeBackgroundActivity,
} from '@/utils/backgroundActivity';
import { entryCurtain } from '@/utils/firstEntryMotion';

export interface BackgroundLoopGateOptions {
  /**
   * 첫 진입 덮개 아래에 미리 그리는 대시보드 배경이면 true — 덮개가 내려와 있는 동안 첫 장만 그리고 쉬다가,
   * 걷히기 시작하면 서서히 이어 간다. 덮개 안의 로그인 배경(보이는 배경)은 쓰지 않는다.
   */
  holdUnderEntryCurtain?: boolean;
}

/**
 * 계속 움직이는 배경 캔버스(대시보드·로그인 플렉서스, StarNest 두 종, 설정 미리보기)의 루프 문지기.
 * (움직임 폴리싱 바탕 B·C)
 *
 * - 동작 줄이기·움직임 '가볍게'·'최소'면 still=true — 배경을 한 장만 그리고 멈춘다(계속 반복되는 장식).
 * - 초당 30장까지만 그린다.
 * - 다른 프로그램을 쓰는 동안(창 포커스 없음)·창이 가려졌을 때·위젯을 끄는 동안(holdBackgroundLoops)은
 *   서서히 멈췄다가, 돌아오면 서서히 이어 간다(src/utils/backgroundActivity.ts).
 * - holdUnderEntryCurtain: 'Bflow.' 첫 화면 덮개 아래에 미리 그린 대시보드 배경은 덮개가 걷힐 때까지 쉰다.
 * 사용법:
 *   const { loopRef, loopOptions } = useBackgroundLoopGate(redrawKey);
 *   useEffect(() => {
 *     ...캔버스 준비...
 *     const draw = (now, info) => { ...info.dtMs 만큼 움직이고, 반복 무늬는 info.time 으로... };
 *     const loop = createFrameLoop(draw, loopOptions());
 *     loopRef.current = loop;
 *     // 크기가 바뀌면 캔버스가 지워지므로 resize 끝에 loopRef.current?.invalidate()
 *     return () => { loop.dispose(); loopRef.current = null; };
 *   }, [...]);
 * - still 이 바뀌면 이 훅이 loop.setStill 로, 창 상태가 바뀌면 loop.setActive 로 넘긴다.
 * - redrawKey 가 바뀌면(멈춘 동안 설정·색이 바뀜) 한 장을 다시 그린다. 움직이는 중이면 아무것도 하지 않는다.
 */
export function useBackgroundLoopGate(redrawKey?: unknown, options: BackgroundLoopGateOptions = {}) {
  const holdUnderCurtain = options.holdUnderEntryCurtain === true;
  const { lite: still } = useMotionPref();
  const stillRef = useRef(still);
  stillRef.current = still;
  const loopRef = useRef<FrameLoop | null>(null);
  const holdRef = useRef(holdUnderCurtain);
  holdRef.current = holdUnderCurtain;

  useEffect(() => {
    loopRef.current?.setStill(still);
  }, [still]);

  // 창 포커스·가시성·끌기(+ 첫 진입 덮개) → 서서히 멈춤/이어 감
  useEffect(() => {
    const sync = () => {
      const { active, fadeMs } = withEntryCurtainHold(readBackgroundActivity(), holdUnderCurtain && entryCurtain.state === 'down');
      loopRef.current?.setActive(active, fadeMs);
    };
    const offWindow = subscribeBackgroundActivity(sync);
    const offCurtain = holdUnderCurtain ? entryCurtain.subscribe(sync) : null;
    return () => {
      offWindow();
      offCurtain?.();
    };
  }, [holdUnderCurtain]);

  // 멈춘 동안(움직임 설정 또는 서서히 멈춘 뒤) 설정·색이 바뀌면 한 장을 다시 그린다.
  // 움직이는 중이면 다음 장이 이미 예약돼 있어 아무 일도 없다.
  useEffect(() => {
    loopRef.current?.invalidate();
  }, [still, redrawKey]);

  /**
   * createFrameLoop 에 넘길 옵션 — 지금의 멈춤·움직임 여부와 초당 장 수 상한.
   * 한 번 만들어진 뒤 바뀌지 않는 함수라, 루프를 만드는 effect 의 의존성에 넣지 않는다
   * (테마·밝기 모드가 바뀌어도 루프를 다시 시작하지 않는 기존 규칙 유지).
   * 덮개 아래에서 만들어진 루프는 active:false — 첫 장만 그리고 잠든다.
   */
  const loopOptions = useCallback((): FrameLoopOptions => ({
    still: stillRef.current,
    active: withEntryCurtainHold(readBackgroundActivity(), holdRef.current && entryCurtain.state === 'down').active,
    maxFps: BACKGROUND_LOOP_MAX_FPS,
  }), []);

  return { still, stillRef, loopRef, loopOptions };
}
