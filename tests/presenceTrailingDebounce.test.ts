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
