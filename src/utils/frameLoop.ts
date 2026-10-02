/* ═══════════════════════════════════════════════════════════════
   계속 움직이는 배경(캔버스) 루프 — 멈춤 상태를 지원하는 requestAnimationFrame 루프
   (움직임 폴리싱 바탕 B, 2026-10)

   대시보드·로그인 배경(플렉서스·StarNest 두 종)은 '계속 반복되는 장식'이다. 동작 줄이기·움직임 '가볍게'·'최소'
   에서는 한 장만 그리고 멈춘다(still). 멈춘 동안에도 크기·설정·색이 바뀌면 invalidate() 로 한 장을 다시 그린다.

   - draw(now) 가 false 를 돌려주면 '아직 다 못 그렸다'는 뜻 — 멈춤 상태라도 다음 프레임에 다시 부른다
     (예: 캔버스 크기가 아직 0, 입자 수를 프레임마다 조금씩 맞추는 중).
   - 루프를 만드는 즉시 첫 프레임을 예약한다(멈춤 상태면 그 한 장으로 끝).
   - setStill(false) 로 풀리면 루프를 이어 간다. setStill(true) 이면 지금 예약된 프레임까지만 그린다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다.
   ═══════════════════════════════════════════════════════════════ */

export interface FrameLoop {
  /** 멈춤 여부를 바꾼다. 다시 움직이게 되면 루프를 이어 간다. */
  setStill(still: boolean): void;
  /** 한 장을 (다시) 그리게 한다. 움직이는 중이면 다음 프레임이 어차피 그리므로 추가로 예약하지 않는다. */
  invalidate(): void;
  /** 예약된 프레임을 취소하고 더는 그리지 않는다. */
  dispose(): void;
  /** 다음 프레임이 예약돼 있는지(테스트·점검용). */
  isScheduled(): boolean;
}

export interface FrameLoopOptions {
  still: boolean;
  requestFrame?: (callback: (now: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export function createFrameLoop(draw: (now: number) => boolean | void, options: FrameLoopOptions): FrameLoop {
  const requestFrame = options.requestFrame ?? ((callback: (now: number) => void) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  let still = options.still;
  let handle: number | null = null;
  let disposed = false;

  const schedule = () => {
    if (disposed || handle !== null) return;
    handle = requestFrame(frame);
  };

  function frame(now: number) {
    handle = null;
    if (disposed) return;
    const settled = draw(now) !== false;
    if (!still || !settled) schedule();
  }

  schedule();

  return {
    setStill(next) {
      if (next === still) return;
      still = next;
      if (!still) schedule();
    },
    invalidate() {
      schedule();
    },
    dispose() {
      disposed = true;
      if (handle !== null) cancelFrame(handle);
      handle = null;
    },
    isScheduled() {
      return handle !== null;
    },
  };
}
