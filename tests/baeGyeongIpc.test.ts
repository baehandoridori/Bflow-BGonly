import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// BAE경 메인 통로 (electron/bae/baeIpc.ts, baeKeyring.ts): 키는 들어오기만 하고, 본문은 관리자에게만, 세션이 바뀌면 버린다.
let nonce = 0;
async function load(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['@supabase/supabase-js'] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const FAKE_KEY = 'sk-test-local-only-0123456789abcdef';
const MANUAL = { key: 'manual', value: { text: '# BAE PD manual v1.7\nZEBRA-RULES' }, revision: 3, version: null, updatedAt: '2026-11-13', updatedBy: 'admin' };

function harness(opts: { isAdmin: boolean; canUse?: boolean; setKeyError?: string }) {
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  let origin = { userId: 'u1', epoch: 7 };
  const calls: Array<[string, ...unknown[]]> = []; let forgot = 0; const signals: string[] = [];
  const store = {
    access: async () => ({ canUse: opts.canUse ?? true, canReview: opts.isAdmin, isAdmin: opts.isAdmin, open: false }),
    settingsGet: async () => [MANUAL, { key: 'models', value: { imageLabel: '2.5 Sunburst (정교함)' }, revision: 1, version: null, updatedAt: null, updatedBy: null }],
    settingsSave: async (actor: string, key: string, value: unknown, rev: number) => { calls.push(['save', actor, key, rev]); return { key, value, revision: rev + 1, version: null, updatedAt: 'now', updatedBy: actor }; },
    settingsHistory: async () => [MANUAL],
    keyStatus: async () => ({ hasKey: false, updatedAt: null, label: 'team' }),
    setKey: async (actor: string, key: string) => { calls.push(['setKey', actor, key]); if (opts.setKeyError) throw new Error(opts.setKeyError); return { hasKey: true, updatedAt: 'now', label: 'team' }; },
    membersList: async () => [], membersSet: async () => [],
  };
  return {
    handlers, calls, signals, get forgot() { return forgot; }, setOrigin: (o: typeof origin) => { origin = o; },
    deps: { ipc: { handle: (c: string, h: (...a: unknown[]) => Promise<unknown>) => handlers.set(c, h) }, getSessionOriginOrThrow: () => origin, store, keyring: { forget: () => { forgot++; } }, onChanged: (w: string) => signals.push(w) },
    invoke: (c: string, ...a: unknown[]) => handlers.get(c)!(null, ...a),
  };
}

test('no channel gives the key back: the screen can put a key in and ask whether there is one, nothing more', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true }); registerBaeIpc(h.deps);
  assert.deepEqual([...h.handlers.keys()].sort(), ['bae:access', 'bae:key-set', 'bae:key-status', 'bae:members-list', 'bae:members-set', 'bae:settings', 'bae:settings-history', 'bae:settings-save', 'bae:settings-seed',
    'bae:jobs-mine', 'bae:job-get', 'bae:job-hide', 'bae:usage-summary'].sort());
  const st = await h.invoke('bae:key-set', `  ${FAKE_KEY}\n`, 7);
  assert.deepEqual(st, { hasKey: true, updatedAt: 'now', label: 'team' });
  assert.deepEqual(h.calls.at(-1), ['setKey', 'u1', FAKE_KEY], 'trimmed before it goes to the server');
  assert.equal(h.forgot, 1, 'the key held in memory is dropped when a new one is put in');
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const bae = preload.slice(preload.indexOf("exposeInMainWorld('baeGyeongAPI'"));
  assert.doesNotMatch(bae, /get-key|getKey/, 'preload opens no way to read the key');
});

test('an error on the key channel never carries the key', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true, setKeyError: `invalid input syntax near "${FAKE_KEY}"` }); registerBaeIpc(h.deps);
  await assert.rejects(h.invoke('bae:key-set', FAKE_KEY, 7), (e: Error) => { assert.ok(!e.message.includes('0123456789abcdef'), e.message); return true; });
  await assert.rejects(h.invoke('bae:key-set', 'hello', 7), /sk-/);
  await assert.rejects(h.invoke('bae:key-set', 'two words', 7), /한 줄로/);
});

test('the bodies of the manual go to an admin\'s screen only; the version goes to everyone', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const user = harness({ isAdmin: false }); registerBaeIpc(user.deps);
  const v = await user.invoke('bae:settings', 7) as { rows: Array<{ key: string; value: unknown; version: string | null; bodyHidden?: boolean }>; defaults: { manual: string; fixed: string } };
  const m = v.rows.find((r) => r.key === 'manual')!;
  assert.equal(m.value, null); assert.equal(m.bodyHidden, true); assert.equal(m.version, 'v1.7');
  assert.deepEqual(v.defaults, { manual: 'v1.7', fixed: 'v1' }, 'the app\'s own first texts are the HTML v0.4.11 ones');
  assert.ok(!JSON.stringify(v).includes('ZEBRA-RULES'), 'not a letter of the body');
  const admin = harness({ isAdmin: true }); registerBaeIpc(admin.deps);
  const va = await admin.invoke('bae:settings', 7) as { rows: Array<{ key: string; value: { text: string } }> };
  assert.equal(va.rows.find((r) => r.key === 'manual')!.value.text, MANUAL.value.text);
  // someone who may not use BAE경 gets no rows at all
  const out = harness({ isAdmin: false, canUse: false }); registerBaeIpc(out.deps);
  assert.deepEqual((await out.invoke('bae:settings', 7) as { rows: unknown[] }).rows, []);
});

test('answers are dropped when the login session changed on the way', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true }); registerBaeIpc(h.deps);
  await assert.rejects(h.invoke('bae:access', 6), /세션/);
  const slow = h.invoke('bae:settings-save', 'horizon', { calib: 2 }, 0, 7);
  h.setOrigin({ userId: 'u2', epoch: 8 });
  await assert.rejects(slow, /세션/);
  // a bad value never reaches the server
  await assert.rejects(h.invoke('bae:settings-save', 'horizon', { calib: 99 }, 0, 8));
  await assert.rejects(h.invoke('bae:settings-save', 'nope', {}, 0, 8), /알 수 없는/);
  assert.equal(h.calls.filter((c) => c[0] === 'save').length, 1);
});

test('the seed puts the app\'s v1.7 manual on the shelf without the body passing through the screen', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true }); registerBaeIpc(h.deps);
  const row = await h.invoke('bae:settings-seed', 'manual', 0, 7) as { version: string; revision: number };
  assert.equal(row.version, 'v1.7'); assert.equal(row.revision, 1);
  assert.deepEqual(h.calls.at(-1), ['save', 'u1', 'manual', 0]);
  assert.deepEqual(h.signals, ['settings']);
});

test('the keyring keeps one key per login in memory and fetches again after forget or a new session', async () => {
  const { createBaeKeyring } = await load('electron/bae/baeKeyring.ts');
  let fetches = 0;
  const kr = createBaeKeyring(async () => { fetches++; return { key: FAKE_KEY, label: 'team' }; });
  await kr.keyFor({ userId: 'u1', epoch: 1 }); await kr.keyFor({ userId: 'u1', epoch: 1 });
  assert.equal(fetches, 1);
  await kr.keyFor({ userId: 'u1', epoch: 2 }); assert.equal(fetches, 2, 'a new login asks again');
  kr.forget(); assert.equal(kr.holds(), false);
  await kr.keyFor({ userId: 'u1', epoch: 2 }); assert.equal(fetches, 3);
});
