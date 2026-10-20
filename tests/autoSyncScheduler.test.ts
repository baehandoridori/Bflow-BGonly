import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_WINDOW_SYNC_INTERVALS,
  POPUP_WINDOW_SYNC_INTERVALS,
  autoSyncIntervalMs,
  createAutoSyncScheduler,
} from '../src/utils/autoSyncScheduler.ts';

// 가짜 시계와 타이머 — 타이머는 하나만 걸린다(스케줄러가 늘 앞 타이머를 지운다).
function harness(opts: { visible?: boolean; connected?: boolean; lastSyncedAt?: number | null } = {}) {
  let now = 1_000_000;
  let visible = opts.visible ?? true;
  let connected = opts.connected ?? true;
  let busy = false;
  let otherSyncedAt: number | null = opts.lastSyncedAt ?? null;
  const runs: number[] = [];
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;

  const scheduler = createAutoSyncScheduler({
    run: () => { runs.push(now); },
    isBusy: () => busy,
    isVisible: () => visible,
    isConnected: () => connected,
    intervals: MAIN_WINDOW_SYNC_INTERVALS,
    getLastSyncedAt: () => otherSyncedAt,
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
  });

  /** ms 만큼 시간을 흘리며 그 사이 울릴 타이머를 차례로 울린다. */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };

  return {
    scheduler,
    runs,
    advance,
    timerCount: () => timers.size,
    setVisible: (v: boolean) => { visible = v; scheduler.refreshState(); },
    setConnected: (c: boolean) => { connected = c; scheduler.refreshState(); },
    setBusy: (b: boolean) => { busy = b; },
    syncedElsewhere: () => { otherSyncedAt = now; },
    now: () => now,
  };
}

test('간격은 창이 보이는지와 실시간 연결 여부로 정한다', () => {
  const i = MAIN_WINDOW_SYNC_INTERVALS;
  assert.equal(autoSyncIntervalMs(i, { visible: true, connected: true }), 60_000);
  assert.equal(autoSyncIntervalMs(i, { visible: true, connected: false }), 15_000, '실시간이 끊기면 예전 15초 그대로');
  assert.equal(autoSyncIntervalMs(i, { visible: false, connected: true }), 300_000);
  assert.equal(autoSyncIntervalMs(i, { visible: false, connected: false }), 300_000);
  assert.ok(POPUP_WINDOW_SYNC_INTERVALS.visibleDisconnectedMs <= 120_000, '위젯 창은 예전 2분 안전망보다 느슨해지지 않는다(끊겼을 때)');
});

test('보이는 창 + 실시간 연결: 1분에 한 번만 받는다', () => {
  const h = harness();
  h.scheduler.start();
  h.advance(59_000);
  assert.equal(h.runs.length, 0, '첫 로드는 따로 하므로 시작하자마자 받지 않는다');
  h.advance(1_000);
  assert.equal(h.runs.length, 1, '첫 차례는 시작 뒤 1분');
  h.advance(60_000 * 4);
  assert.equal(h.runs.length, 5);
});

test('실시간이 끊기면 15초로 당기고, 다시 붙으면 1분으로 돌아간다', () => {
  const h = harness({ connected: false });
  h.scheduler.start();
  h.advance(60_000);
  assert.equal(h.runs.length, 4);
  h.setConnected(true);
  h.advance(60_000);
  assert.equal(h.runs.length, 5);
});

test('트레이·최소화에서는 5분에 한 번, 실시간 변경은 미뤄 둔다', () => {
  const h = harness();
  h.scheduler.start();
  h.setVisible(false);
  assert.equal(h.scheduler.requestFromEvent(), false, '숨은 창은 바로 받지 않는다');
  h.advance(299_000);
  assert.equal(h.runs.length, 0);
  h.advance(1_000);
  assert.equal(h.runs.length, 1, '5분 안전망이 미뤄 둔 변경도 함께 받는다');
  h.advance(30 * 60_000);
  assert.equal(h.runs.length, 7);
});

test('다시 보이면 미뤄 둔 변경을 바로 받는다', () => {
  const h = harness();
  h.scheduler.start();
  h.setVisible(false);
  h.scheduler.requestFromEvent();
  h.advance(5_000);
  assert.equal(h.runs.length, 0);
  h.setVisible(true);
  assert.equal(h.runs.length, 1, '창을 연 순간 받는다');
  h.advance(59_000);
  assert.equal(h.runs.length, 1, '방금 받았으니 다음은 1분 뒤');
});

test('다시 보일 때 미뤄 둔 것이 없어도 오래됐으면 받고, 막 받았으면 받지 않는다', () => {
  const stale = harness();
  stale.scheduler.start();
  stale.setVisible(false);
  stale.advance(40_000);
  stale.setVisible(true);
  assert.equal(stale.runs.length, 1, '30초 넘게 지났으면 바로 받는다');

  const fresh = harness();
  fresh.scheduler.start();
  fresh.syncedElsewhere();
  fresh.setVisible(false);
  fresh.advance(10_000);
  fresh.setVisible(true);
  assert.equal(fresh.runs.length, 0, '10초 전에 받았으면 다시 받지 않는다');
});

test('보이는 창의 실시간 변경은 예전처럼 바로 받는다', () => {
  const h = harness();
  h.scheduler.start();
  assert.equal(h.scheduler.requestFromEvent(), true);
  assert.equal(h.runs.length, 1);
  h.advance(59_000);
  assert.equal(h.runs.length, 1, '방금 받았으니 안전망은 1분 뒤로 밀린다');
  h.advance(1_000);
  assert.equal(h.runs.length, 2);
});

test('다른 길로 받은 것(첫 로드·직접 새로고침)도 마지막으로 받은 때로 센다', () => {
  const h = harness();
  h.scheduler.start();
  h.advance(50_000);
  h.syncedElsewhere();
  h.advance(10_000);
  assert.equal(h.runs.length, 0, '10초 전에 받았으면 안전망 차례를 넘긴다');
  h.advance(50_000);
  assert.equal(h.runs.length, 1);
});

test('안전망 차례에 이미 받는 중이면 겹쳐 받지 않고 끝난 뒤 다시 본다', () => {
  const h = harness();
  h.scheduler.start();
  h.setBusy(true);
  h.advance(65_000);
  assert.equal(h.runs.length, 0);
  h.setBusy(false);
  h.advance(1_000);
  assert.equal(h.runs.length, 1);
});

test('다시 보일 때 받는 중이면 미뤄 둔 변경을 잊지 않고 곧 받는다', () => {
  const h = harness();
  h.scheduler.start();
  h.setVisible(false);
  h.scheduler.requestFromEvent();
  h.setBusy(true);
  h.setVisible(true);
  assert.equal(h.runs.length, 0);
  h.setBusy(false);
  h.advance(1_000);
  assert.equal(h.runs.length, 1);
});

test('멈추면 타이머가 남지 않고, 시작 전 요청은 예전처럼 바로 받는다', () => {
  const h = harness();
  assert.equal(h.scheduler.requestFromEvent(), true);
  assert.equal(h.runs.length, 1);
  h.scheduler.start();
  assert.equal(h.timerCount(), 1);
  h.scheduler.stop();
  assert.equal(h.timerCount(), 0);
  h.advance(10 * 60_000);
  assert.equal(h.runs.length, 1);
});

test('실패한 받기가 스케줄러를 멈추지 않는다', () => {
  let now = 0;
  const timers: Array<() => void> = [];
  let calls = 0;
  const s = createAutoSyncScheduler({
    run: () => { calls += 1; throw new Error('offline'); },
    isBusy: () => false,
    isVisible: () => true,
    isConnected: () => true,
    intervals: MAIN_WINDOW_SYNC_INTERVALS,
    now: () => now,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  s.start();
  now = 60_000;
  timers.at(-1)!();
  now = 120_000;
  timers.at(-1)!();
  assert.equal(calls, 2);
});
