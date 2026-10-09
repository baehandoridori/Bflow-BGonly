// 캐릭터 카드 그림 위의 휠을 복장 넘김으로 읽는다 (v1.132.1).
//
// 그냥 휠은 절대 가로채지 않는다. v1.74.0 의 휠 넘김은 휠을 통째로 먹어서 카드가 많은 화면에서 아래로 내려가려던
// 휠까지 복장을 넘겼고, 그래서 v1.100.0 에서 화살표로 바꿨다. Shift 를 누른 때만 넘김으로 읽는다.
//
// 테스트가 이 파일을 바로 읽으므로 다른 모듈을 끌어오지 않는다.

/** WheelEvent 에서 판정에 쓰는 값만. */
export interface CostumeWheelEvent {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  timeStamp: number;
}

export interface CostumeWheelState {
  /** 아직 한 장을 넘기지 못하고 모여 있는 휠 양. */
  carried: number;
  /** 마지막으로 한 장을 넘긴 때. */
  steppedAt: number;
  /** 마지막으로 넘김 휠이 온 때. */
  seenAt: number;
}

export interface CostumeWheelResult {
  /** true 일 때만 화면 스크롤을 막는다(preventDefault). */
  consume: boolean;
  /** 넘길 방향. 0 이면 넘기지 않는다. */
  dir: 1 | -1 | 0;
  state: CostumeWheelState;
}

export const COSTUME_WHEEL = {
  /** 이만큼 모이면 한 장 넘긴다. 마우스 휠 한 칸(약 100)은 한 번에 넘고, 터치패드의 작은 값은 모인다. */
  step: 40,
  /** 한 장 넘긴 뒤 쉬는 시간. 관성으로 쏟아지는 휠이 여러 장을 건너뛰지 않게 한다. */
  cooldownMs: 120,
  /** 이보다 오래 쉬었다 굴리면 모아 둔 것을 버린다. */
  idleMs: 250,
} as const;

export const COSTUME_WHEEL_IDLE: CostumeWheelState = Object.freeze({ carried: 0, steppedAt: -Infinity, seenAt: -Infinity });

/**
 * 휠 한 번을 읽는다. `imagedCount` 는 그림이 있는 복장 수.
 * Shift 만 누른 휠이고 넘길 복장이 두 벌 이상일 때만 `consume` 이 true 다.
 */
export function costumeWheelStep(state: CostumeWheelState, event: CostumeWheelEvent, imagedCount: number): CostumeWheelResult {
  const claimed = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && imagedCount > 1;
  if (!claimed) return { consume: false, dir: 0, state: state.carried === 0 ? state : { ...state, carried: 0 } };

  // Shift 를 누르면 Chromium 은 세로 휠을 가로 값(deltaX)으로 바꿔 보낸다. 터치패드는 두 축이 함께 올 수 있어 큰 쪽을 읽는다.
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  const stale = event.timeStamp - state.seenAt > COSTUME_WHEEL.idleMs;
  const turned = delta * state.carried < 0;
  const carried = (stale || turned ? 0 : state.carried) + delta;
  const seen = { ...state, seenAt: event.timeStamp };

  if (Math.abs(carried) < COSTUME_WHEEL.step) return { consume: true, dir: 0, state: { ...seen, carried } };
  if (event.timeStamp - state.steppedAt < COSTUME_WHEEL.cooldownMs) return { consume: true, dir: 0, state: { ...seen, carried: 0 } };
  return { consume: true, dir: carried > 0 ? 1 : -1, state: { carried: 0, steppedAt: event.timeStamp, seenAt: event.timeStamp } };
}
