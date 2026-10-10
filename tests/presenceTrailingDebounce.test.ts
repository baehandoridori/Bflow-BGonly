// tests/presenceTrailingDebounce.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrailingDebounce } from '../electron/presence/trailingDebounce.ts';

interface FakeTimer {
  fn: () => void;
  at: number;
}

// 가짜 시계와 도우미 한 벌. 테스트마다 새로 만든다.
function createHarness() {
  let t = 0;
  let runs = 0;
  const timers: FakeTimer[] = [];
  const debounce = createTrailingDebounce(() => { runs += 1; }, {
    waitMs: 400,
    maxWaitMs: 2000,
    now: () => t,
    setTimer: (fn, ms) => {
      const handle = { fn, at: t + ms };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle as FakeTimer);
      if (index !== -1) timers.splice(index, 1);
    },
  });
  // at <= ms인 타이머를 이른 것부터 그 시각에 맞춰 부른 뒤 시계를 ms에 둔다.
  const advanceTo = (ms: number) => {
    for (;;) {
      const due = timers.filter((timer) => timer.at <= ms).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      t = due.at;
      due.fn();
    }
    t = ms;
  };
  return { debounce, advanceTo, runs: () => runs, pendingTimers: () => timers.length };
}

test('몰아서 온 예약은 마지막 예약에서 400ms 뒤에 한 번만 돈다', () => {
  const { debounce, advanceTo, runs } = createHarness();
  for (const at of [0, 100, 200, 300, 400]) {
    advanceTo(at);
    debounce.schedule();
  }
  advanceTo(799);
  assert.equal(runs(), 0);
  advanceTo(800);
  assert.equal(runs(), 1);

  // 돈 뒤의 예약은 새로 잰다.
  advanceTo(1000);
  debounce.schedule();
  advanceTo(1399);
  assert.equal(runs(), 1);
  advanceTo(1400);
  assert.equal(runs(), 2);

  // 한참 쉰 뒤의 예약도 그 예약에서 400ms 뒤 — 2000ms 상한은 앞서 돈 때가 아니라 새 묶음의 첫 예약에서 센다.
  advanceTo(5000);
  debounce.schedule();
  advanceTo(5399);
  assert.equal(runs(), 2);
  advanceTo(5400);
  assert.equal(runs(), 3);
});

test('예약이 끊이지 않아도 첫 예약에서 2000ms 안에 한 번 돈다', () => {
  const { debounce, advanceTo, runs } = createHarness();
  for (let at = 3000; at <= 4800; at += 300) {
    advanceTo(at);
    debounce.schedule();
  }
  advanceTo(4999);
  assert.equal(runs(), 0);
  advanceTo(5000); // 첫 예약(3000) + 2000
  assert.equal(runs(), 1);

  // 돈 뒤에는 첫 예약 시각을 새로 잡는다 — 6000ms의 마지막 예약에서 400ms 뒤.
  for (let at = 5100; at <= 6000; at += 300) {
    advanceTo(at);
    debounce.schedule();
  }
  advanceTo(6399);
  assert.equal(runs(), 1);
  advanceTo(6400);
  assert.equal(runs(), 2);
});

test('cancel은 예약을 버리고 첫 예약 시각도 지운다', () => {
  const { debounce, advanceTo, runs, pendingTimers } = createHarness();
  debounce.schedule();
  debounce.cancel();
  assert.equal(pendingTimers(), 0);
  advanceTo(3000);
  assert.equal(runs(), 0);

  // cancel이 첫 예약 시각을 지우지 않으면 2000ms 상한을 이미 넘긴 것으로 보고 바로 돈다.
  debounce.schedule();
  advanceTo(3399);
  assert.equal(runs(), 0);
  advanceTo(3400);
  assert.equal(runs(), 1);
});

test('시계를 넘기지 않으면 Date.now·setTimeout·clearTimeout으로 같은 규칙을 지킨다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let runs = 0;
  const debounce = createTrailingDebounce(() => { runs += 1; }, { waitMs: 400, maxWaitMs: 2000 });

  // 0·100·200·300·400ms에 다섯 번 예약 → 마지막 예약에서 400ms 뒤(800ms)에 한 번만.
  for (let i = 0; i < 5; i += 1) {
    debounce.schedule();
    t.mock.timers.tick(100);
  }
  t.mock.timers.tick(299); // 799ms
  assert.equal(runs, 0);
  t.mock.timers.tick(1); // 800ms
  assert.equal(runs, 1);
  t.mock.timers.tick(5000); // 5800ms
  assert.equal(runs, 1);

  // 5800ms부터 300ms마다 일곱 번 예약(마지막은 7600ms) → 첫 예약 + 2000(7800ms)에 한 번.
  for (let i = 0; i < 7; i += 1) {
    if (i > 0) t.mock.timers.tick(300);
    debounce.schedule();
  }
  t.mock.timers.tick(199); // 7799ms
  assert.equal(runs, 1);
  t.mock.timers.tick(1); // 7800ms
  assert.equal(runs, 2);
  t.mock.timers.tick(5000);
  assert.equal(runs, 2);
});
