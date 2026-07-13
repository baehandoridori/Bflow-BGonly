// 결정론 PRNG (mulberry32). 게임 엔진은 Math.random()/Date.now() 를 쓰지 않고,
// crypto 로 1회 발급한 시드에서 이 순수 함수로 난수열을 재현한다(같은 시드 → 같은 결과).
// 상태를 값으로 넘겨 불변 엔진과 결합한다.

export interface RandomDraw {
  readonly value: number; // [0, 1)
  readonly next: number; // 다음 호출에 넘길 상태
}

export function nextRandom(state: number): RandomDraw {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: a };
}

// 앱 런타임에서 시드 1개를 발급한다(엔진 밖에서 1회만 호출). 테스트/엔진은 숫자 시드를 직접 넘긴다.
export function createSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] | 0;
}
