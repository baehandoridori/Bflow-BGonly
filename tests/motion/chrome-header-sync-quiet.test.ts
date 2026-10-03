import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSyncQueue, type SyncKind, type SyncQueueState } from '../../src/utils/syncQueue.ts';
import {
  CHECK_BREATH_KEYFRAMES,
  CHECK_BREATH_TIMING,
  CHECK_POP_KEYFRAMES,
  CHECK_POP_TIMING,
  SPIN_PERIOD_MS,
  angleFromTransform,
  planSpinStop,
  resolveSyncLabel,
  syncKindChange,
} from '../../src/components/layout/headerSyncMotion.ts';

/* 움직임 폴리싱 3번 — 15초 자동 동기화는 조용히, 직접 누른 새로고침만 또렷하게. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

/** 직접 끝낼 수 있는 가짜 받아오기. */
function harness() {
  const runs: { kind: SyncKind; finish: (error?: unknown) => void }[] = [];
  const states: SyncQueueState[] = [];
  const queue = createSyncQueue(
    (kind) => new Promise<void>((resolve, reject) => {
      runs.push({ kind, finish: (error) => (error ? reject(error) : resolve()) });
    }),
    (state) => states.push(state),
  );
  return { queue, runs, states };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ─── 받아오기 조율 ─── */

test('자동 받아오기는 바로 돌고 상태는 auto → 쉼', async () => {
  const { queue, runs, states } = harness();
  const done = queue.request('auto');
  assert.deepEqual(runs.map((r) => r.kind), ['auto']);
  assert.deepEqual(queue.getState(), { syncing: true, kind: 'auto' });
  runs[0].finish();
  await done;
  assert.deepEqual(states, [{ syncing: true, kind: 'auto' }, { syncing: false, kind: null }]);
});

test('인자 없이 부르면(또는 이상한 값이 오면) 자동으로 다룬다 — 클릭 이벤트가 넘어와도 직접으로 오인하지 않는다', () => {
  const { queue, runs } = harness();
  void queue.request();
  void queue.request({ type: 'click' } as unknown as SyncKind);
  assert.deepEqual(runs.map((r) => r.kind), ['auto', 'auto']);
});

test('자동이 도는 중에 직접 누르면 무시하지 않고, 끝난 뒤 한 번 더 받아온다(그동안 상태는 manual 로 이어짐)', async () => {
  const { queue, runs, states } = harness();
  void queue.request('auto');
  const manual = queue.request('manual');
  assert.equal(runs.length, 1, '자동이 끝나기 전에는 겹쳐 돌리지 않는다');
  assert.deepEqual(queue.getState(), { syncing: true, kind: 'manual' }, '누르자마자 아이콘이 돌 수 있게 manual');

  runs[0].finish();
  await flush();
  assert.deepEqual(runs.map((r) => r.kind), ['auto', 'manual']);
  assert.deepEqual(queue.getState(), { syncing: true, kind: 'manual' });

  runs[1].finish();
  await manual;
  assert.deepEqual(states, [
    { syncing: true, kind: 'auto' },
    { syncing: true, kind: 'manual' },
    { syncing: false, kind: null },
  ], '예약 → 실행 사이에 쉼(null)이 끼지 않아 아이콘이 끊기지 않는다');
});

test('직접 받아오기가 돌거나 예약돼 있으면 더 쌓지 않는다(연타)', async () => {
  const { queue, runs } = harness();
  const first = queue.request('manual');
  assert.equal(queue.request('manual'), first);
  assert.equal(runs.length, 1);
  runs[0].finish();
  await first;

  void queue.request('auto');
  const pending = queue.request('manual');
  assert.equal(queue.request('manual'), pending);
  runs[1].finish();
  await flush();
  assert.equal(runs.length, 3);
  assert.equal(runs[2].kind, 'manual');
});

test('자동끼리는 예전처럼 겹쳐 돌고, 먼저 끝난 쪽이 동기화 끝을 알리지 않는다', async () => {
  const { queue, runs } = harness();
  void queue.request('auto');
  void queue.request('auto');
  assert.equal(runs.length, 2);
  runs[0].finish();
  await flush();
  assert.deepEqual(queue.getState(), { syncing: true, kind: 'auto' });
  runs[1].finish();
  await flush();
  assert.deepEqual(queue.getState(), { syncing: false, kind: null });
});

test('직접 받아오는 중 자동이 끝나도 manual 이 유지되고, 실패해도 큐가 멈추지 않는다', async () => {
  const { queue, runs } = harness();
  void queue.request('manual');
  void queue.request('auto');
  runs[1].finish();
  await flush();
  assert.deepEqual(queue.getState(), { syncing: true, kind: 'manual' });
  runs[0].finish(new Error('network'));
  await flush();
  assert.deepEqual(queue.getState(), { syncing: false, kind: null });
  void queue.request('manual');
  assert.equal(runs.length, 3, '실패 뒤에도 다시 누르면 받아온다');
});

/* ─── 상태 문구 ─── */

test('자동 받아오기는 문구를 바꾸지 않고, 직접 새로고침·멈추는 중·첫 로드만 동기화 중', () => {
  const base = { isSyncing: false, syncKind: null, lastSyncTime: 1, spinning: false } as const;
  assert.equal(resolveSyncLabel(base), 'fresh');
  assert.equal(resolveSyncLabel({ ...base, isSyncing: true, syncKind: 'auto' }), 'fresh');
  assert.equal(resolveSyncLabel({ ...base, isSyncing: true, syncKind: 'manual' }), 'syncing');
  assert.equal(resolveSyncLabel({ ...base, spinning: true }), 'syncing', '아이콘이 멈출 때까지 기다렸다가 체크가 톡');
  assert.equal(resolveSyncLabel({ ...base, isSyncing: true, syncKind: 'auto', lastSyncTime: null }), 'syncing', '한 번도 못 받았으면 최신 상태가 아니다');
});

test('상태 변화 → 회전 시작·멈춤·숨쉬기', () => {
  assert.deepEqual(syncKindChange(null, 'manual'), { spin: 'start', breathe: false });
  assert.deepEqual(syncKindChange('auto', 'manual'), { spin: 'start', breathe: false });
  assert.deepEqual(syncKindChange('manual', null), { spin: 'stop', breathe: false });
  assert.deepEqual(syncKindChange('manual', 'auto'), { spin: 'stop', breathe: false });
  assert.deepEqual(syncKindChange(null, 'auto'), { spin: null, breathe: true });
  assert.deepEqual(syncKindChange('auto', null), { spin: null, breathe: false });
  assert.deepEqual(syncKindChange('manual', 'manual'), { spin: null, breathe: false });
});

/* ─── 회전 멈춤 ─── */

test('getComputedStyle 의 transform 에서 회전각을 읽는다', () => {
  assert.equal(angleFromTransform('none'), 0);
  assert.equal(angleFromTransform(''), 0);
  assert.equal(angleFromTransform(undefined), 0);
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);
  close(angleFromTransform('matrix(0, 1, -1, 0, 0, 0)'), 90);
  close(angleFromTransform('matrix(-1, 0, 0, -1, 0, 0)'), 180);
  close(angleFromTransform('matrix(0, -1, 1, 0, 0, 0)'), 270);
  close(angleFromTransform('matrix3d(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'), 90);
  close(angleFromTransform('rotate(-30deg)'), 330);
});

function bezier(easing: string) {
  const m = easing.match(/^cubic-bezier\(([^)]*)\)$/);
  assert.ok(m, easing);
  return m[1].split(',').map(Number);
}

test('멈출 때는 0° 로 튀지 않고 돌던 바퀴를 마저 돌며, 돌던 속도로 출발해 감속한다', () => {
  const speed = 360 / SPIN_PERIOD_MS;
  for (const angle of [0, 1, 30, 90, 180, 250, 299, 301, 359.5]) {
    const plan = planSpinStop(angle);
    assert.equal(plan.toDeg % 360, 0, `${angle}°: 끝은 360 의 배수 — transform 이 비어도 같은 모습`);
    const travel = plan.toDeg - plan.fromDeg;
    assert.ok(travel >= 60 && travel <= 420, `${angle}°: 남은 각 ${travel}`);
    assert.ok(plan.durationMs >= 240 && plan.durationMs <= 800, `${angle}°: ${plan.durationMs}ms`);
    const [x1, y1, x2, y2] = bezier(plan.easing);
    for (const x of [x1, x2]) assert.ok(x >= 0 && x <= 1, 'cubic-bezier x 는 0~1');
    assert.equal(y2, 1, '끝 기울기 0 — 사뿐히 멈춤');
    const startSpeed = (y1 / x1) * (travel / plan.durationMs);
    assert.ok(Math.abs(startSpeed - speed) / speed < 0.02, `${angle}°: 시작 속도 ${startSpeed} ≈ 회전 속도 ${speed}`);
  }
  assert.equal(planSpinStop(359.5).toDeg, 720, '몇 도 안 남았으면 한 바퀴 더 — 급정거 금지');
  assert.equal(planSpinStop(90).toDeg, 360);
  assert.equal(planSpinStop(-90).fromDeg, 270);
});

test('사양 수치: 회전 700ms · 숨쉬기 1→.35→1 600ms · 톡 .6→1.12→1 220ms', () => {
  assert.equal(SPIN_PERIOD_MS, 700);
  assert.deepEqual(CHECK_BREATH_KEYFRAMES.map((f) => f.opacity), [1, 0.35, 1]);
  assert.equal(CHECK_BREATH_TIMING.duration, 600);
  assert.deepEqual(CHECK_POP_KEYFRAMES.map((f) => f.transform), ['scale(0.6)', 'scale(1.12)', 'scale(1)']);
  assert.equal(CHECK_POP_TIMING.duration, 220);
  assert.equal(CHECK_POP_TIMING.easing, 'cubic-bezier(0.18, 0.88, 0.34, 1.28)');
});

/* ─── 소스 가드 ─── */

test('새로고침: 버튼은 눌림만, 회전은 아이콘(WAAPI)만 — animate-spin·disabled 없음', () => {
  const status = read('src/components/layout/HeaderSyncStatus.tsx');
  assert.doesNotMatch(status, /animate-spin/, '클래스 회전은 빠지는 순간 0° 로 튄다');
  assert.doesNotMatch(status, /animate-pulse/, '숨은 문구에서도 계속 도는 무한 애니메이션 금지');
  assert.doesNotMatch(status, /disabled=/, '자동 중에 눌러도 무시하지 않는다');
  assert.match(status, /<RefreshCw ref=\{iconRef\}/);
  assert.match(status, /className=\{cn\(\s*'bf-press p-2 rounded-lg hover:bg-bg-border\/50'/);
  assert.match(status, /useMotionPref\(\)/, 'WAAPI 는 전역 동작 줄이기 CSS 가 못 막는다');
  assert.match(status, /min-w-\[78px\]/);
  assert.match(status, /transition-opacity duration-\[160ms\]/);

  const header = read('src/components/layout/Header.tsx');
  assert.match(header, /<HeaderSyncStatus onRefresh=\{onRefresh\} \/>/);
  assert.doesNotMatch(header, /=\s*useDataStore\(\);/, '스토어 전체 구독 금지');
  assert.doesNotMatch(header, /=\s*useAppStore\(\);/, '스토어 전체 구독 금지');
});

test('App: 버튼·단축키는 직접(manual), 폴링·실시간 재로드는 자동', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const loadData = useCallback\(\(\) => syncQueue\.request\('auto'\), \[syncQueue\]\);/);
  assert.match(app, /const refreshDataManually = useCallback\(\(\) => \{ void syncQueue\.request\('manual'\); \}, \[syncQueue\]\);/);
  assert.match(app, /onRefresh=\{refreshDataManually\}/);
  assert.match(app, /useGlobalShortcuts\(\{ onReload: refreshDataManually \}\);/);
  assert.match(app, /setInterval\(\(\) => \{\s*loadData\(\);\s*\}, POLL_INTERVAL\)/);
  assert.doesNotMatch(app, /setSyncing\(/, '동기화 중 표시는 syncQueue 가 센다');
});
