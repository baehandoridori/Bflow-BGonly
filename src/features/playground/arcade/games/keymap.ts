// 좌우 이동의 DAS(Delayed Auto Shift)/ARR(Auto Repeat Rate) 상태기.
// keydown 즉시 1회 이동, dasMs 유지 시 arrMs 간격 반복. 좌우 동시엔 나중 키 우선.
// 프레임 루프에서 advance(nowMs) 를 호출해 반복 이동 수를 받는다. 순수 로직(테스트 가능).

export type HorizontalDir = -1 | 1;

export interface HorizontalRepeater {
  press(dir: HorizontalDir, nowMs: number): number; // 즉시 이동 수(0 또는 1)
  release(dir: HorizontalDir, nowMs: number): void;
  advance(nowMs: number): number; // 이번 프레임에 발생한 반복 이동 수
  activeDir(): -1 | 0 | 1;
  reset(): void;
}

export function createHorizontalRepeater(opts?: { dasMs?: number; arrMs?: number }): HorizontalRepeater {
  const das = opts?.dasMs ?? 160;
  const arr = opts?.arrMs ?? 40;
  let leftHeld = false;
  let rightHeld = false;
  let dir: -1 | 0 | 1 = 0;
  let nextRepeatAt = 0;

  const activate = (d: -1 | 0 | 1, nowMs: number): void => {
    dir = d;
    if (d !== 0) nextRepeatAt = nowMs + das;
  };

  return {
    press(d, nowMs) {
      if (d === -1) leftHeld = true; else rightHeld = true;
      if (dir === d) return 0; // 이미 그 방향이면(반복 keydown 등) 무시
      activate(d, nowMs); // 나중 키 우선
      return 1; // 즉시 1회
    },
    release(d, nowMs) {
      if (d === -1) leftHeld = false; else rightHeld = false;
      if (dir !== d) return; // 활성 방향이 아니면 무시
      if (d === -1 && rightHeld) activate(1, nowMs); // 반대 키가 아직 눌려 있으면 전환
      else if (d === 1 && leftHeld) activate(-1, nowMs);
      else activate(0, nowMs);
    },
    advance(nowMs) {
      if (dir === 0) return 0;
      let moves = 0;
      while (nowMs >= nextRepeatAt) {
        moves += 1;
        nextRepeatAt += arr;
      }
      return moves;
    },
    activeDir() { return dir; },
    reset() {
      leftHeld = false;
      rightHeld = false;
      dir = 0;
      nextRepeatAt = 0;
    },
  };
}
