import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createSaveRetryController,
  flushNowWithin,
  type SaveRetryEnv,
  type SaveRetryJob,
} from '../../src/utils/saveRetry.ts';
import {
  SaveSessionEndedError,
  createSaveSessionTracker,
  saveSessionUserChanged,
} from '../../src/utils/saveSession.ts';
import { type PendingSceneOverlay } from '../../src/utils/pendingSceneOverlay.ts';
import { useStageSaveStatusStore } from '../../src/stores/useStageSaveStatusStore.ts';
import type { Stage } from '../../src/types/index.ts';

/* 움직임 폴리싱 20번 safety-net — 3차 수정(fx3-retry 갈래), 코덱스 2차 지적 4172094259.
   자동 재전송은 저장을 앱 전역에 최대 60초 붙들고 있다. 로그인 세션이 바뀌면(로그아웃·다른 사용자 로그인)
   기다리던 저장을 모두 그만두고(다시 보내지 않음·콜백 없음) 다시 얹을 값·표시도 지운다. 한 번에 여러 요청을 보내는
   저장은 요청마다 세션을 다시 확인한다. 직접 로그아웃할 때는 세션이 살아 있을 때 한 번 보내 본다(최대 3초). */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const transient = () => new Error("Error invoking remote method 'supabase:update-scene-stage': Error: TypeError: fetch failed");

function fakeEnv() {
  let now = 0;
  let seq = 0;
  let online = true;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const onlineListeners = new Set<() => void>();
  const env: SaveRetryEnv = {
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
    now: () => now,
    isOnline: () => online,
    onOnline: (fn) => {
      onlineListeners.add(fn);
      return () => onlineListeners.delete(fn);
    },
  };
  return {
    env,
    get now() {
      return now;
    },
    setOnline(value: boolean) {
      online = value;
      if (value) [...onlineListeners].forEach((fn) => fn());
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        await flush();
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = target;
      await flush();
    },
  };
}

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Plan = 'ok' | 'transient' | ReturnType<typeof deferred>;

/**
 * 화면 쪽 씬 단위 칸 경로를 흉내 낸다(세션 부분만): 클릭한 순간의 세션을 붙잡고, 요청마다 확인한다.
 * run 은 src/services/sceneSaveRetry.ts 와 같이 다시 보낼 때마다 세션을 확인하는 껍질을 씌운다.
 * endSession 은 endSceneSaveSession 과 같다(세션 시기 올림 → 진행기 cancelAll → 다시 얹을 값 비우기).
 */
function sessionLane(clock: ReturnType<typeof fakeEnv>) {
  const retry = createSaveRetryController(clock.env);
  const sessions = createSaveSessionTracker();
  const overlays = new Map<string, PendingSceneOverlay>();
  const calls: string[] = [];
  const events: string[] = [];
  let user = 'A';
  let failPlan: Plan[] = [];
  const run = <C,>(key: string, job: SaveRetryJob<C>) => {
    const session = sessions.capture();
    return retry.run<C>(key, {
      ...job,
      attempt: () => {
        session.assertCurrent();
        return job.attempt();
      },
    });
  };
  const click = (stages: Stage[], key = 'uuid-a|stages') => {
    const actor = user;
    const session = sessions.capture();
    const writeStage = async (stage: Stage) => {
      session.assertCurrent();
      const plan = failPlan.shift() ?? 'ok';
      calls.push(`${actor}:${stage}:${typeof plan === 'string' ? plan : 'pending'}`);
      if (plan === 'transient') throw transient();
      if (typeof plan !== 'string') await plan.promise;
    };
    const overlay: PendingSceneOverlay = { sceneUuid: 'uuid-a', reapply: () => ({ lo: true }) };
    overlays.set(key, overlay);
    return run<{ actor: string }>(key, {
      carry: { actor },
      attempt: async () => {
        for (const stage of stages) await writeStage(stage);
      },
      stillMine: () => true,
      onRetrying: () => events.push(`${actor}:retrying`),
      onSaved: () => events.push(`${actor}:saved`),
      onOvertaken: () => events.push(`${actor}:overtaken`),
      onGiveUp: () => events.push(`${actor}:giveUp`),
      onSupersededSaved: (next) => events.push(`${actor}:supersededSaved→${next?.actor ?? '-'}`),
    }).finally(() => {
      if (overlays.get(key) === overlay) overlays.delete(key);
    });
  };
  return {
    retry,
    overlays,
    calls,
    events,
    click,
    endSession() {
      sessions.end();
      const stopped = retry.cancelAll();
      overlays.clear();
      return stopped;
    },
    setUser(next: string) {
      user = next;
    },
    fail(plan: Plan[]) {
      failPlan = plan;
    },
  };
}

/* ─── 세션 시기 ─── */

test('saveSession — 붙잡은 세션은 세션이 바뀌면 지난 것이 되고, 그 뒤에 붙잡은 세션은 지금 세션이다', () => {
  const sessions = createSaveSessionTracker();
  const a = sessions.capture();
  assert.equal(a.isCurrent(), true);
  a.assertCurrent();
  sessions.end();
  assert.equal(a.isCurrent(), false);
  assert.throws(() => a.assertCurrent(), SaveSessionEndedError);
  const b = sessions.capture();
  assert.equal(b.isCurrent(), true);
  sessions.end();
  assert.equal(b.isCurrent(), false);
  assert.equal(a.isCurrent(), false, '한 번 지난 세션은 다시 지금이 되지 않는다');
});

test('saveSessionUserChanged — 로그아웃·로그인·다른 사람만 바뀐 것으로 본다(같은 사람 정보 갱신은 아님)', () => {
  assert.equal(saveSessionUserChanged('1', null), true, '로그아웃');
  assert.equal(saveSessionUserChanged(null, '2'), true, '로그인');
  assert.equal(saveSessionUserChanged(undefined, '2'), true);
  assert.equal(saveSessionUserChanged('1', '2'), true, '다른 사람');
  assert.equal(saveSessionUserChanged('1', '1'), false, '이름·권한·비밀번호 표시만 새로 받음');
  assert.equal(saveSessionUserChanged(null, undefined), false);
});

/* ─── 진행기: 세션이 바뀌면 그만둔다 ─── */

test('로그아웃: 다시 보내기를 기다리던 저장은 다시 보내지 않고, 되돌리기·안내·저장됨 콜백도 부르지 않는다', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  lane.fail(['transient']);
  const outcome = lane.click(['lo']);
  await clock.advance(100);
  assert.deepEqual(lane.calls, ['A:lo:transient']);
  assert.equal(lane.retry.isRetrying('uuid-a|stages'), true);
  assert.equal(lane.overlays.size, 1);

  assert.equal(lane.endSession(), 1, '그만둔 작업 수');
  assert.equal(lane.overlays.size, 0, '받아오기 위에 다시 얹던 앞 사람의 값도 지운다');
  assert.equal(lane.retry.pendingCarry('uuid-a|stages'), undefined, '다음 저장은 앞 사람 것을 넘겨받지 않는다');
  assert.equal(lane.retry.isRetrying('uuid-a|stages'), false);
  await clock.advance(70_000);
  assert.equal(await outcome, 'cancelled');
  assert.deepEqual(lane.calls, ['A:lo:transient'], '0.8초 뒤에도 다시 보내지 않는다');
  assert.deepEqual(lane.events, ['A:retrying'], '포기 되돌림·멈춤 안내·저장됨 표시 지우기 모두 부르지 않는다');
  assert.equal(lane.retry.cancelAll(), 0, '이미 그만둔 작업은 다시 세지 않는다');
});

test('로그아웃: 인터넷이 끊겨 60초 연결을 기다리던 저장도 바로 그만둔다(연결이 돌아와도 보내지 않는다)', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  lane.fail(['transient']);
  const outcome = lane.click(['lo']);
  await clock.advance(0);
  clock.setOnline(false);
  await clock.advance(5_000); // 0.8초 뒤 → 연결 대기 중
  assert.deepEqual(lane.calls, ['A:lo:transient']);
  lane.endSession();
  assert.equal(await outcome, 'cancelled');
  assert.equal(clock.now, 5_000, '60초를 다 기다리지 않는다');
  clock.setOnline(true);
  await clock.advance(1_000);
  assert.deepEqual(lane.calls, ['A:lo:transient']);
});

test('보내는 중에 세션이 바뀌면, 나간 요청은 끝까지 두되 같은 저장의 다음 요청은 보내지 않는다(앞 사람 이름으로 다음 칸을 쓰지 않는다)', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  const inFlight = deferred();
  lane.fail([inFlight]);
  const outcome = lane.click(['lo', 'done', 'review', 'png']);
  await clock.advance(0);
  assert.deepEqual(lane.calls, ['A:lo:pending']);
  lane.endSession();
  inFlight.resolve();
  assert.equal(await outcome, 'cancelled');
  assert.deepEqual(lane.calls, ['A:lo:pending'], '완료·검수·PNG 는 보내지 않는다');
  assert.deepEqual(lane.events, [], '저장됨·포기 콜백도 없다');
});

test('B 로그인 뒤 같은 칸: A 의 기준을 잇지 않고, A 의 나간 요청이 끝난 뒤에 보내며, A 의 결과로 B 의 기준을 앞당기지 않는다', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  const aInFlight = deferred();
  lane.fail([aInFlight]);
  const a = lane.click(['lo', 'done']);
  await clock.advance(0);
  lane.endSession();
  lane.setUser('B');
  assert.equal(lane.retry.pendingCarry('uuid-a|stages'), undefined);
  const b = lane.click(['lo']);
  await clock.advance(0);
  assert.deepEqual(lane.calls, ['A:lo:pending'], 'B 의 요청은 A 의 나간 요청 뒤에 선다(늦게 닿은 A 가 B 를 덮지 않게)');
  aInFlight.resolve();
  assert.equal(await a, 'cancelled');
  assert.equal(await b, 'saved');
  assert.deepEqual(lane.calls, ['A:lo:pending', 'B:lo:ok'], 'A 의 남은 칸(완료)은 보내지 않는다');
  assert.deepEqual(lane.events, ['B:saved'], 'A 가 B 의 carry 를 앞당기지 않는다(supersededSaved 없음)');
});

test('넘겨준 뒤 앞 요청이 아직 나가 있는 작업도 함께 그만둔다 — 늦게 끝나도 다음 사람 저장의 기준을 건드리지 않는다', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  const first = deferred();
  lane.fail([first]);
  const a1 = lane.click(['lo']);
  await clock.advance(0);
  const a2 = lane.click(['done']); // A1 을 넘겨받는다 — A1 의 요청은 아직 나가 있다
  assert.equal(lane.endSession(), 2, '넘겨준 A1 도 센다');
  lane.setUser('B');
  const b = lane.click(['png']);
  first.resolve();
  assert.equal(await a1, 'cancelled');
  assert.equal(await a2, 'cancelled');
  assert.equal(await b, 'saved');
  assert.deepEqual(lane.calls, ['A:lo:pending', 'B:png:ok']);
  assert.deepEqual(lane.events, ['B:saved']);
});

test('앱 종료 직전 정리를 기다리는 중에 세션이 바뀌어도 정리가 붙들리지 않는다', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  const inFlight = deferred();
  lane.fail([inFlight]);
  const outcome = lane.click(['lo']);
  await clock.advance(0);
  let flushed = false;
  void lane.retry.flushNow().then(() => {
    flushed = true;
  });
  await clock.advance(0);
  assert.equal(flushed, false);
  lane.endSession();
  await clock.advance(0);
  assert.equal(flushed, true, '나간 요청이 끝나기 전에 풀린다');
  inFlight.resolve();
  assert.equal(await outcome, 'cancelled');
});

/* ─── 직접 로그아웃: 세션이 살아 있을 때 한 번 보내 본다 ─── */

test('로그아웃 직전 정리: 기다리던 저장을 지금(앞 사람 세션으로) 보내고, 끝나면 바로 넘어간다', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  lane.fail(['transient']);
  const outcome = lane.click(['lo']);
  await clock.advance(100); // 0.8초 재전송을 기다리는 중
  const result = await flushNowWithin(lane.retry, 3000, clock.env);
  assert.equal(result, 'flushed');
  assert.equal(clock.now, 100, '0.8초를 기다리지 않고 바로 보낸다');
  assert.deepEqual(lane.calls, ['A:lo:transient', 'A:lo:ok']);
  assert.equal(await outcome, 'saved');
  assert.equal(lane.endSession(), 0, '로그아웃 때 그만둘 것이 남지 않는다');
});

test('로그아웃 직전 정리: 3초 안에 안 끝나면 로그아웃을 붙들지 않고, 남은 요청 결과는 세션이 바뀐 뒤 버린다', async () => {
  const clock = fakeEnv();
  const lane = sessionLane(clock);
  const hang = deferred();
  lane.fail(['transient', hang]);
  const outcome = lane.click(['lo', 'done']);
  await clock.advance(100);
  let result: string = 'waiting';
  void flushNowWithin(lane.retry, 3000, clock.env).then((value) => {
    result = value;
  });
  await clock.advance(2999);
  assert.equal(result, 'waiting');
  await clock.advance(1);
  assert.equal(result, 'timeout', '3초가 지나면 로그아웃으로 넘어간다');
  lane.endSession(); // 로그아웃
  hang.resolve();
  assert.equal(await outcome, 'cancelled');
  assert.deepEqual(lane.calls, ['A:lo:transient', 'A:lo:pending'], '세션이 바뀐 뒤 다음 칸(완료)은 보내지 않는다');
  assert.deepEqual(lane.events, ['A:retrying']);
});

test('로그아웃 직전 정리: 기다리는 저장이 없으면 바로 끝난다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  assert.equal(await flushNowWithin(retry, 3000, clock.env), 'flushed');
  assert.equal(clock.now, 0);
});

/* ─── 저장 상태 표시 ─── */

test('저장 상태 저장소 resetAll — 그만둔 저장의 다시 보내는 중·되돌림 표시를 모두 지운다(지울 것이 없으면 그대로)', () => {
  const store = useStageSaveStatusStore;
  store.getState().setRetrying('uuid-x', 'stages', ['lo']);
  store.getState().setRetrying('uuid-y', 'a:김', ['a:김:png']);
  store.getState().flashRollback('uuid-x', ['done']);
  store.getState().resetAll();
  assert.deepEqual(store.getState().retrying, {});
  assert.deepEqual(store.getState().rollbacks, {});
  const before = store.getState();
  store.getState().resetAll();
  assert.equal(store.getState(), before, '지울 것이 없으면 다시 그리지 않는다');
});

/* ─── 연결 앵커: 앱이 실제로 세션 변경에 묶여 있는가 ─── */

test('세션이 바뀌면(렌더러 로그인 사용자 · 메인 세션 방송) 저장을 그만두고 다시 얹을 값·표시를 지운다', () => {
  const service = read('src/services/sceneSaveRetry.ts');
  assert.match(
    service,
    /useAuthStore\.subscribe\(\(state, previous\) => \{\n\s+if \(saveSessionUserChanged\(previous\.currentUser\?\.id, state\.currentUser\?\.id\)\) endSceneSaveSession\(\);\n\}\);/,
  );
  assert.match(
    service,
    /export function endSceneSaveSession\(\): void \{\n\s+sessions\.end\(\);\n\s+const stopped = controller\.cancelAll\(\);\n\s+const held = pendingOverlays\.size;\n\s+pendingOverlays\.clear\(\);\n\s+useStageSaveStatusStore\.getState\(\)\.resetAll\(\);/,
  );
  // 메인 세션 방송: 시기가 바뀌었거나 방송된 사용자가 화면 사용자와 다르면.
  assert.match(service, /window\.electronAPI\?\.onSessionChanged\?\.\(\(payload\) => \{/);
  assert.match(service, /if \(epochChanged \|\| saveSessionUserChanged\(useAuthStore\.getState\(\)\.currentUser\?\.id, userId\)\) endSceneSaveSession\(\);/);
  assert.match(service, /run<C>\(key: string, job: SaveRetryJob<C>\) \{\n\s+hookQuitFlush\(\);\n\s+hookSessionWatch\(\);/);
  // 다시 보낼 때마다 저장을 시작한 세션을 확인한다.
  assert.match(
    service,
    /const session = sessions\.capture\(\);\n\s+return controller\.run<C>\(key, \{\n\s+\.\.\.job,\n\s+attempt: \(\) => \{\n\s+session\.assertCurrent\(\);\n\s+return job\.attempt\(\);/,
  );
  // 그만둔 저장이 있었으면 App 이 바로 다시 받아온다(앞 사람의 아직 저장 안 된 체크가 남지 않게).
  assert.match(service, /if \(stopped === 0 && held === 0\) return;\n\s+sessionEndedListeners\.forEach/);
  const app = read('src/App.tsx');
  assert.match(app, /useEffect\(\(\) => onSceneSaveSessionEnded\(\(\) => \{ void loadData\(\); \}\), \[loadData\]\);/);
});

test('직접 로그아웃은 세션이 살아 있을 때 기다리던 저장을 한 번 보내 본 뒤(최대 3초) 로그아웃한다', () => {
  const menu = read('src/components/auth/UserMenu.tsx');
  assert.match(menu, /const handleLogout = async \(\) => \{\n(?:\s+\/\/.*\n)*\s+await flushSceneSavesBeforeLogout\(\);\n\s+await logout\(\);\n\s+setCurrentUser\(null\);/);
  const service = read('src/services/sceneSaveRetry.ts');
  assert.match(service, /export const LOGOUT_FLUSH_MAX_MS = 3000;/);
  assert.match(service, /await flushNowWithin\(controller, maxWaitMs, retryEnv\);/);
  // 계정이 지워져 밀려나는 길(세션이 이미 끝남)은 보내 보지 않는다 — 사용자를 먼저 비우고 로그아웃한다.
  const reconcile = read('src/services/authoritativeUserSession.ts');
  assert.doesNotMatch(reconcile, /flushSceneSavesBeforeLogout/);
});

test('씬 목록의 세 저장 경로가 클릭한 순간의 세션을 붙잡고, 요청을 보내기 직전마다 확인한다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.equal((view.match(/const saveSession = sceneSaveSession\(\);/g) ?? []).length, 3);
  // 단계 칸: 칸 쓰기(다시 보내기·서버 되돌리기 모두) 직전.
  assert.match(view, /const writeStage = async \(changedStage: Stage, value: boolean\) => \{\n(?:\s+\/\/.*\n)*\s+saveSession\.assertCurrent\(\);/);
  // 단계 칸: 단계·담당자별 진행·완료 기록 직전(실패 처리가 삼키지 않게 try 밖에서).
  assert.match(view, /if \(actingPhaseSync && sceneUuid && saveCarry\.minePhase\) \{\n(?:\s+\/\/.*\n)*\s+saveSession\.assertCurrent\(\);\n\s+try \{/);
  assert.match(view, /hasMultiAssigneeProgress\(latestForProgress\)\) \{\n\s+saveSession\.assertCurrent\(\);/);
  assert.match(view, /if \(saveCarry\.completion\) \{\n\s+saveSession\.assertCurrent\(\);/);
  assert.match(view, /if \(!saveSession\.isCurrent\(\)\) throw progressErr;/);
  // 담당자별 진행 쓰기는 큐를 기다리고 정본을 읽은 뒤 쓰기 직전에 확인한다.
  assert.equal((view.match(/Object\.keys\(progress\), saveSession\.assertCurrent\)/g) ?? []).length, 2);
  assert.match(view, /saveAssigneeProgress\(sceneUuid, progress, changedNames, \{ beforeWrite \}\)/);
  const actions = read('src/services/assigneeProgressActions.ts');
  assert.match(actions, /options\.beforeWrite\?\.\(\);\n\s+await writeMetadata\(SCENE_ASSIGNEE_PROGRESS_META_TYPE/);
  // 액팅 칩: 저장된 뒤 따르는 기록도 세션이 바뀌었으면 보내지 않는다.
  assert.match(view, /if \(outcome !== 'saved'\) return;\n(?:\s+\/\/.*\n)*\s+if \(!saveSession\.isCurrent\(\)\) return;/);
  // 담당자별: 쓰기 직전 + 쓴 뒤 화면 맞추기 전.
  assert.match(view, /saveAssigneeProgress\(sceneUuid, nextProgress, \[assigneeName\], \{ beforeWrite: saveSession\.assertCurrent \}\);\n\s+savedEntry = merged\[assigneeName\] \?\? mine;\n(?:\s+\/\/.*\n)*\s+saveSession\.assertCurrent\(\);/);
});
