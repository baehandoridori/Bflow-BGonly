import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  COSTUME_WHEEL,
  COSTUME_WHEEL_IDLE,
  costumeWheelStep,
  type CostumeWheelEvent,
  type CostumeWheelState,
} from '../src/utils/costumeWheel.ts';

// v1.132.1: 캐릭터 카드 그림 위에서 Shift 를 누른 채 휠을 굴리면 복장이 넘어간다.
//   v1.74.0 의 휠 넘김은 그냥 휠까지 가로채 카드가 많은 화면에서 스크롤을 막았고, v1.100.0 에서 화살표로 바꿨다.
//   되살리되 "그냥 휠은 절대 먹지 않는다"가 이 파일이 지키는 약속이다.

const here = dirname(fileURLToPath(import.meta.url));
const card = readFileSync(join(here, '../src/components/characters/CharacterCard.tsx'), 'utf8');
const helper = readFileSync(join(here, '../src/utils/costumeWheel.ts'), 'utf8');

function wheel(over: Partial<CostumeWheelEvent>): CostumeWheelEvent {
  return { deltaX: 0, deltaY: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, timeStamp: 1000, ...over };
}

/** 같은 카드 위에서 이어지는 휠을 차례로 흘려보내고 넘긴 방향만 모은다. */
function run(events: CostumeWheelEvent[], count = 3, from: CostumeWheelState = COSTUME_WHEEL_IDLE) {
  let state = from;
  const steps: number[] = [];
  const consumed: boolean[] = [];
  for (const event of events) {
    const result = costumeWheelStep(state, event, count);
    state = result.state;
    consumed.push(result.consume);
    if (result.dir) steps.push(result.dir);
  }
  return { steps, consumed, state };
}

test('그냥 휠은 얼마나 크게 굴려도 가로채지 않는다 — 화면이 평소처럼 내려간다', () => {
  for (const deltaY of [1, 40, 100, 120, 4000, -100, -4000]) {
    const result = costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ deltaY }), 5);
    assert.equal(result.consume, false, `deltaY ${deltaY}`);
    assert.equal(result.dir, 0);
  }
  // 가로 휠(터치패드 옆으로 쓸기)도 Shift 가 없으면 그대로 둔다.
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ deltaX: 300 }), 5).consume, false);
  // 이어서 여러 번 굴려도 마찬가지다.
  const many = run(Array.from({ length: 20 }, (_, i) => wheel({ deltaY: 100, timeStamp: 1000 + i * 200 })));
  assert.deepEqual(many.steps, []);
  assert.ok(many.consumed.every((value) => value === false));
});

test('Shift 를 누른 채 한 칸 굴리면 한 장 넘어간다 — 아래로는 다음, 위로는 이전', () => {
  const down = costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ shiftKey: true, deltaY: 100 }), 3);
  assert.equal(down.consume, true);
  assert.equal(down.dir, 1);
  const up = costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ shiftKey: true, deltaY: -100 }), 3);
  assert.equal(up.consume, true);
  assert.equal(up.dir, -1);
});

test('Shift 를 누르면 세로 휠이 가로 값으로 들어온다 — 그 값도 같은 방향으로 읽는다', () => {
  // Windows 의 Chromium 은 Shift+휠을 deltaX 로 바꿔 보낸다(deltaY 는 0).
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ shiftKey: true, deltaX: 100 }), 3).dir, 1);
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ shiftKey: true, deltaX: -100 }), 3).dir, -1);
  // 두 축이 함께 오면 큰 쪽을 따른다.
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ shiftKey: true, deltaX: -8, deltaY: 90 }), 3).dir, 1);
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ shiftKey: true, deltaX: -90, deltaY: 8 }), 3).dir, -1);
});

test('다른 보조 키가 함께 눌렸거나 넘길 복장이 없으면 가로채지 않는다', () => {
  const shifted = { shiftKey: true, deltaY: 100 };
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ ...shifted, ctrlKey: true }), 3).consume, false);
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ ...shifted, metaKey: true }), 3).consume, false);
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ ...shifted, altKey: true }), 3).consume, false);
  // 그림 있는 복장이 한 벌 이하인 카드는 넘길 것이 없다 — Shift+휠도 건드리지 않는다.
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel(shifted), 1).consume, false);
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel(shifted), 0).consume, false);
  assert.equal(costumeWheelStep(COSTUME_WHEEL_IDLE, wheel(shifted), 2).consume, true);
});

test('작은 휠은 모였다가 한 장을 넘긴다(터치패드) — 모이는 동안에도 화면은 움직이지 않는다', () => {
  const small = (timeStamp: number, deltaY = 10) => wheel({ shiftKey: true, deltaY, timeStamp });
  const result = run([small(1000), small(1016), small(1032), small(1048)]);
  assert.deepEqual(result.steps, [1], `${COSTUME_WHEEL.step} 에 닿는 네 번째에서 한 번`);
  assert.deepEqual(result.consumed, [true, true, true, true]);
  // 방향을 바꾸면 모아 둔 것은 버리고 새로 모은다.
  const turned = run([small(1000, 30), small(1016, -30), small(1032, -9)]);
  assert.deepEqual(turned.steps, []);
  assert.equal(turned.state.carried, -39);
  // 한참 쉬었다가 다시 굴리면 예전에 모아 둔 것이 남아 있지 않다.
  const stale = run([small(1000, 30), small(1000 + COSTUME_WHEEL.idleMs + 1, 30)]);
  assert.deepEqual(stale.steps, []);
  assert.equal(stale.state.carried, 30);
  const kept = run([small(1000, 30), small(1000 + COSTUME_WHEEL.idleMs, 30)]);
  assert.deepEqual(kept.steps, [1]);
});

test('연달아 굴리면 한 장씩 넘어가되, 관성으로 쏟아지는 휠이 여러 장을 건너뛰지는 않는다', () => {
  const notch = (timeStamp: number, deltaY = 100) => wheel({ shiftKey: true, deltaY, timeStamp });
  // 또각또각 굴리면 칸마다 한 장.
  assert.deepEqual(run([notch(1000), notch(1000 + COSTUME_WHEEL.cooldownMs), notch(1000 + COSTUME_WHEEL.cooldownMs * 2)]).steps, [1, 1, 1]);
  // 쉬는 시간 안에 온 휠은 버린다 — 그래도 화면은 움직이지 않는다.
  const burst = run([notch(1000), notch(1010), notch(1020), notch(1000 + COSTUME_WHEEL.cooldownMs - 1)]);
  assert.deepEqual(burst.steps, [1]);
  assert.deepEqual(burst.consumed, [true, true, true, true]);
  assert.equal(burst.state.carried, 0);
  // 넘기자마자 반대로 굴려도 쉬는 시간은 지킨다.
  assert.deepEqual(run([notch(1000), notch(1050, -100)]).steps, [1]);
  assert.deepEqual(run([notch(1000), notch(1000 + COSTUME_WHEEL.cooldownMs, -100)]).steps, [1, -1]);
});

test('Shift 를 떼면 모아 둔 휠을 버린다 — 그 휠은 화면 몫이다', () => {
  const held = costumeWheelStep(COSTUME_WHEEL_IDLE, wheel({ shiftKey: true, deltaY: 30, timeStamp: 1000 }), 3);
  assert.equal(held.state.carried, 30);
  const released = costumeWheelStep(held.state, wheel({ deltaY: 30, timeStamp: 1016 }), 3);
  assert.equal(released.consume, false);
  assert.equal(released.state.carried, 0);
  const again = costumeWheelStep(released.state, wheel({ shiftKey: true, deltaY: 30, timeStamp: 1032 }), 3);
  assert.equal(again.dir, 0, '떼기 전에 모은 30 이 이어지지 않는다');
});

test('판정은 받은 상태를 고치지 않는다', () => {
  const state: CostumeWheelState = { carried: 30, steppedAt: 0, seenAt: 990 };
  const frozen = Object.freeze({ ...state });
  costumeWheelStep(frozen, wheel({ shiftKey: true, deltaY: 30 }), 3);
  costumeWheelStep(frozen, wheel({ deltaY: 30 }), 3);
  assert.deepEqual(frozen, state);
  assert.ok(Object.isFrozen(COSTUME_WHEEL_IDLE));
});

test('카드: 그림 칸에 휠을 걸되, 넘김이 아닌 휠은 막기 전에 돌려보낸다', () => {
  // React 의 onWheel 은 막을 수 없는(passive) 등록이라 그림 칸에 직접 건다.
  assert.match(card, /import \{ COSTUME_WHEEL_IDLE, costumeWheelStep \} from '@\/utils\/costumeWheel';/);
  assert.match(card, /ref=\{imageBoxRef\}/);
  assert.match(card, /box\.addEventListener\('wheel', onWheel, \{ passive: false \}\);/);
  assert.match(card, /return \(\) => box\.removeEventListener\('wheel', onWheel\);/);
  assert.doesNotMatch(card, /onWheel=\{/);
  const start = card.indexOf('const onWheel = (event: WheelEvent) => {');
  const end = card.indexOf("box.addEventListener('wheel'");
  assert.ok(start > 0 && end > start, '휠 처리 함수를 찾는다');
  const body = card.slice(start, end);
  const judged = body.indexOf('costumeWheelStep(state, event, imagedCount)');
  const leave = body.indexOf('if (!result.consume) return;');
  const block = body.indexOf('event.preventDefault();');
  const step = body.indexOf('if (result.dir) stepCostume(result.dir);');
  assert.ok(judged > 0 && leave > judged && block > leave && step > block, '판정 → 돌려보내기 → 막기 → 넘기기 순서');
  assert.equal(body.split('preventDefault').length, 2, '막는 곳은 한 군데뿐이다');
  // 휠 처리 안에서 막는 것 말고는 화면 스크롤을 건드리지 않는다.
  assert.doesNotMatch(body, /stopPropagation|scrollTop|scrollBy/);
  // 복장 수가 바뀌거나 그림 칸이 생겼다 없어지면 다시 건다.
  assert.match(card, /\}, \[imagedCount, compact\]\);/);
  // 화살표는 그대로 있고, 올려 두면 Shift+휠을 알려 준다.
  assert.match(card, /aria-label="이전 복장"\s+title="이전 복장 · Shift\+휠로도 넘겨요"/);
  assert.match(card, /aria-label="다음 복장"\s+title="다음 복장 · Shift\+휠로도 넘겨요"/);
});

test('판정 함수는 테스트가 바로 읽을 수 있게 다른 모듈을 끌어오지 않는다', () => {
  assert.doesNotMatch(helper, /^import /m);
  assert.match(helper, /export function costumeWheelStep\(/);
});
