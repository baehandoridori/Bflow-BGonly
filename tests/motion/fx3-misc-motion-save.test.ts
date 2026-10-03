/**
 * 코덱스 2차 지적 4172094269 — 움직임 설정을 파일(preferences.json)에 쓰지 못하면 다른 창에 알리지 않는다.
 *
 * 예전: savePreferences 가 쓰기 실패를 삼키고 정상으로 끝나, 방송이 나가 다른 창도 새 값을 받았는데 파일은 옛 값이라
 * 다음 실행 때 조용히 옛 설정으로 돌아갔다.
 * 이제: savePreferences 는 성공 여부만 돌려준다(던지지 않음 — 결과를 보지 않는 기존 호출처는 그대로). 움직임 설정은 false 를 보면
 * 방송하지 않고, 이 창을 파일에 남은 값(다음 실행 때 쓰일 값)으로 되돌린 뒤 짧게 알린다. 쓰는 사이 더 새 값을 골랐으면
 * 그 차례가 다시 쓰므로 되돌리지도 알리지도 않는다.
 *
 * motionLevelSync 는 실제 소스를 esbuild 로 묶어 돌린다(알림 카드 sonner 만 기록용으로 바꿈).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, type Plugin } from 'esbuild';

import { savePreferences } from '../../src/services/settingsService.ts';

type Globals = Record<string, unknown>;
const g = globalThis as Globals;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** console.error 를 잠깐 기록으로 바꾼다(실패 기록이 테스트 출력을 덮지 않게). */
async function capturingErrors<T>(run: (errors: unknown[][]) => Promise<T>): Promise<T> {
  const original = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    return await run(errors);
  } finally {
    console.error = original;
  }
}

/* ─── savePreferences: 성공 여부만 돌려준다 ──────────────────────── */

test('savePreferences: 파일에 썼으면 true, 쓰기가 던지거나 거절하면 false — 예외는 밖으로 던지지 않는다', async () => {
  await capturingErrors(async (errors) => {
    const writes: unknown[] = [];
    g.window = { electronAPI: { writeSettings: async (file: string, data: unknown) => { writes.push([file, data]); return true; } } };
    assert.equal(await savePreferences({ motionLevel: 'lite' }), true);
    assert.deepEqual(writes, [['preferences.json', { motionLevel: 'lite' }]]);

    g.window = { electronAPI: { writeSettings: async () => { throw new Error('EPERM: operation not permitted'); } } };
    assert.equal(await savePreferences({ motionLevel: 'lite' }), false, '예전처럼 던지지 않는다(결과를 안 보는 호출처 그대로)');

    g.window = { electronAPI: { writeSettings: async () => false } };
    assert.equal(await savePreferences({ motionLevel: 'lite' }), false, '쓰기가 false 로 거절해도 실패');

    g.window = { electronAPI: { writeSettings: async () => undefined } };
    assert.equal(await savePreferences({}), true, '값을 돌려주지 않는 쓰기(옛 흉내 등)는 성공으로 본다');
    assert.equal(errors.length, 2, '실패는 기록한다');
  });
});

/* ─── 움직임 설정 저장(실제 소스) ─────────────────────────────────── */

const sonnerStub: Plugin = {
  name: 'stub-sonner',
  setup(builder) {
    builder.onResolve({ filter: /^sonner$/ }, () => ({ path: 'sonner', namespace: 'fx3-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'fx3-stub' }, () => ({
      loader: 'js',
      contents: [
        'const record = (kind) => (...args) => { (globalThis.__fx3Toasts ??= []).push([kind, ...args]); };',
        'export const toast = Object.assign(record("toast"), { error: record("error"), success: record("success"), warning: record("warning") });',
      ].join('\n'),
    }));
  },
};

interface SyncApi {
  saveMotionLevel(level: string): Promise<void>;
  startMotionLevelSync(): void;
  getMotionLevel(): string;
  subscribeMotionLevel(listener: () => void): () => void;
  MOTION_LEVEL_SAVE_FAILED_MESSAGE: string;
  MOTION_LEVEL_SAVE_FAILED_DETAIL: string;
}

type WriteStep = { result: 'ok' | 'throw' | 'false'; wait?: Promise<void> };

let syncSource: string | null = null;

/** 움직임 설정 모듈을 새로 하나 띄운다(테스트마다 따로). 파일·방송·알림 카드는 기록만 한다. */
async function freshMotionSync(file: Record<string, unknown> | null, plan: WriteStep[] = []) {
  if (!syncSource) {
    const result = await build({
      stdin: {
        contents: [
          "export { saveMotionLevel, startMotionLevelSync, MOTION_LEVEL_SAVE_FAILED_MESSAGE, MOTION_LEVEL_SAVE_FAILED_DETAIL } from './src/services/motionLevelSync.ts';",
          "export { getMotionLevel, subscribeMotionLevel } from './src/utils/motionLevel.ts';",
        ].join('\n'),
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      format: 'cjs',
      platform: 'node',
      write: false,
      logLevel: 'silent',
      plugins: [sonnerStub],
    });
    syncSource = result.outputFiles[0].text;
  }
  const files: Record<string, unknown> = { 'preferences.json': file };
  const broadcasts: Array<{ motionLevel?: string }> = [];
  const dataset: Record<string, string> = {};
  g.document = { documentElement: { dataset } };
  g.__fx3Toasts = [];
  g.window = {
    electronAPI: {
      readSettings: async (name: string) => structuredClone(files[name] ?? null),
      writeSettings: async (name: string, data: unknown) => {
        const step = plan.shift() ?? { result: 'ok' };
        if (step.wait) await step.wait;
        if (step.result === 'throw') throw new Error('EPERM: operation not permitted');
        if (step.result === 'false') return false;
        files[name] = structuredClone(data);
        return true;
      },
      preferencesBroadcastChange: (payload: { motionLevel?: string }) => { broadcasts.push(payload); },
    },
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', syncSource)(() => { throw new Error('외부 모듈 없음'); }, module, module.exports);
  const api = module.exports as unknown as SyncApi;
  // 시작 — 파일 값을 이 창에 적는다(설정 화면을 열기 전 상태)
  api.startMotionLevelSync();
  await flush();
  const seen: string[] = [];
  api.subscribeMotionLevel(() => seen.push(api.getMotionLevel()));
  return {
    api,
    files,
    broadcasts,
    dataset,
    seen,
    toasts: () => g.__fx3Toasts as unknown[][],
  };
}

test('움직임 설정: 저장되면 다른 설정은 그대로 두고 방송한다 — 알림 카드 없음', async () => {
  const env = await freshMotionSync({ motionLevel: 'full', sidebarExpanded: true });
  assert.equal(env.api.getMotionLevel(), 'full');
  await env.api.saveMotionLevel('lite');
  assert.equal(env.api.getMotionLevel(), 'lite');
  assert.equal(env.dataset.motion, 'lite');
  assert.deepEqual(env.files['preferences.json'], { motionLevel: 'lite', sidebarExpanded: true });
  assert.deepEqual(env.broadcasts.map((payload) => payload.motionLevel), ['lite']);
  assert.deepEqual(env.toasts(), []);
});

for (const failure of ['throw', 'false'] as const) {
  test(`움직임 설정: 파일에 쓰지 못하면(${failure === 'throw' ? '쓰기 오류' : '쓰기 거절'}) 방송하지 않고 파일 값으로 되돌린 뒤 짧게 알린다`, async () => {
    await capturingErrors(async () => {
      const env = await freshMotionSync({ motionLevel: 'lite', fontScale: 'm' }, [{ result: failure }]);
      assert.equal(env.api.getMotionLevel(), 'lite', '시작 때 파일 값');
      await env.api.saveMotionLevel('minimal');
      assert.deepEqual(env.seen, ['minimal', 'lite'], '바로 반영(낙관적)했다가 파일에 남은 값으로 되돌린다');
      assert.equal(env.api.getMotionLevel(), 'lite');
      assert.equal(env.dataset.motion, 'lite');
      assert.equal('motionMinimal' in env.dataset, false, "'최소' 표시도 걷힌다");
      assert.deepEqual(env.broadcasts, [], '다른 창에 알리지 않는다(다음 실행과 어긋나지 않게)');
      assert.deepEqual(env.files['preferences.json'], { motionLevel: 'lite', fontScale: 'm' }, '파일은 그대로');
      assert.deepEqual(env.toasts(), [['error', env.api.MOTION_LEVEL_SAVE_FAILED_MESSAGE, { description: env.api.MOTION_LEVEL_SAVE_FAILED_DETAIL }]]);
    });
  });
}

test('움직임 설정: 파일에 값이 없을 때 실패하면 기본으로 되돌린다(다음 실행 때 쓰일 값)', async () => {
  await capturingErrors(async () => {
    const env = await freshMotionSync(null, [{ result: 'throw' }]);
    await env.api.saveMotionLevel('lite');
    assert.equal(env.api.getMotionLevel(), 'full');
    assert.deepEqual(env.broadcasts, []);
    assert.equal(env.toasts().length, 1);
  });
});

test('움직임 설정: 쓰는 사이 더 새 값을 골랐으면 앞 저장의 실패는 되돌리지도 알리지도 않는다 — 뒤 저장이 쓰고 방송', async () => {
  await capturingErrors(async () => {
    const gate = deferred();
    const env = await freshMotionSync({ motionLevel: 'full' }, [{ result: 'throw', wait: gate.promise }, { result: 'ok' }]);
    const first = env.api.saveMotionLevel('lite');
    await flush(); // 앞 저장이 파일에 쓰는 중
    const second = env.api.saveMotionLevel('minimal');
    gate.resolve();
    await first;
    await second;
    assert.deepEqual(env.seen, ['lite', 'minimal'], '중간에 옛 값으로 깜빡 되돌아가지 않는다');
    assert.equal(env.api.getMotionLevel(), 'minimal');
    assert.deepEqual(env.toasts(), []);
    assert.deepEqual(env.broadcasts.map((payload) => payload.motionLevel), ['minimal']);
    assert.deepEqual(env.files['preferences.json'], { motionLevel: 'minimal' });
  });
});

test('움직임 설정: 연달아 골라 둘 다 쓰지 못하면 마지막 차례만 되돌리고 한 번만 알린다', async () => {
  await capturingErrors(async () => {
    const gate = deferred();
    const env = await freshMotionSync({ motionLevel: 'lite' }, [{ result: 'throw', wait: gate.promise }, { result: 'throw' }]);
    const first = env.api.saveMotionLevel('minimal');
    await flush();
    const second = env.api.saveMotionLevel('full');
    gate.resolve();
    await first;
    await second;
    assert.deepEqual(env.seen, ['minimal', 'full', 'lite']);
    assert.equal(env.api.getMotionLevel(), 'lite');
    assert.deepEqual(env.broadcasts, []);
    assert.equal(env.toasts().length, 1);
  });
});

test('알림 문구: 개발 용어 없이 무엇이 일어났는지(저장 못 함 → 원래 설정으로)', async () => {
  const env = await freshMotionSync({ motionLevel: 'full' });
  assert.equal(env.api.MOTION_LEVEL_SAVE_FAILED_MESSAGE, '움직임 설정을 저장하지 못했어요');
  assert.equal(env.api.MOTION_LEVEL_SAVE_FAILED_DETAIL, '원래 설정으로 돌려 놓았어요');
  for (const text of [env.api.MOTION_LEVEL_SAVE_FAILED_MESSAGE, env.api.MOTION_LEVEL_SAVE_FAILED_DETAIL]) {
    assert.doesNotMatch(text, /preferences|json|IPC|broadcast|방송|파일/i);
  }
});
