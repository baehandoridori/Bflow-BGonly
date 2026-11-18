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
    // 8단계
    jobListTeam: async (actor: string, since: string | null, n: number) => { calls.push(['jobListTeam', actor, since, n]); return { rows: [], more: false, serverTime: 'now', total: 0 }; },
    jobFindTeam: async (actor: string, filter: unknown, before: unknown, n: number) => { calls.push(['jobFindTeam', actor, filter, before, n]); return { rows: [], more: false, next: null, serverTime: 'now' }; },
    jobStamp: async (actor: string, jobId: string, stamp: string | null, note: string | null) => { calls.push(['jobStamp', actor, jobId, stamp, note]); return { id: jobId, stamp }; },
    jobStampBulk: async (actor: string, ids: string[]) => { calls.push(['jobStampBulk', actor, ids]); return { stamped: ids, skipped: 0 }; },
    jobStamps: async (actor: string, jobId: string) => { calls.push(['jobStamps', actor, jobId]); return []; },
    stampUnseen: async (actor: string) => { calls.push(['stampUnseen', actor]); return { count: 2, jobIds: [], upto: 9 }; },
    stampSeen: async (actor: string, upto: number | null) => { calls.push(['stampSeen', actor, upto]); return { count: 0, jobIds: [], upto: 9 }; },
    usageTeam: async (actor: string, from: string | null, to: string | null, bucket: string) => {
      calls.push(['usageTeam', actor, from, to, bucket]);
      return { from: '2026-10-31T15:00:00Z', to: '2026-11-16T09:00:00Z', bucket, tz: 'Asia/Seoul', periods: ['2026-11-15', '2026-11-16'],
        rows: [{ userId: 'u2', userName: '=장삐쭈', period: '2026-11-16', kind: 'image', model: 'gpt-image-2.5-sunburst', n: 2, usd: 0.1553 },
          { userId: 'u3', userName: '허혜원, 팀', period: '2026-11-15', kind: 'order', model: 'gpt-6.1-sol', n: 1, usd: 0.0241 }],
        total: { n: 3, usd: 0.1794 }, month: { from: '2026-10-31T15:00:00Z', n: 3, usd: 0.1794 } };
    },
  };
  const saved: Array<[string, string]> = [];
  return {
    handlers, calls, signals, saved, get forgot() { return forgot; }, setOrigin: (o: typeof origin) => { origin = o; },
    deps: { ipc: { handle: (c: string, h: (...a: unknown[]) => Promise<unknown>) => handlers.set(c, h) }, getSessionOriginOrThrow: () => origin, store, keyring: { forget: () => { forgot++; } }, onChanged: (w: string) => signals.push(w),
      saveText: async (name: string, text: string) => { saved.push([name, text]); return 'C:\\Users\\me\\Downloads\\' + name; } },
    invoke: (c: string, ...a: unknown[]) => handlers.get(c)!(null, ...a),
  };
}

test('no channel gives the key back: the screen can put a key in and ask whether there is one, nothing more', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true }); registerBaeIpc(h.deps);
  assert.deepEqual([...h.handlers.keys()].sort(), ['bae:access', 'bae:key-set', 'bae:key-status', 'bae:members-list', 'bae:members-set', 'bae:settings', 'bae:settings-history', 'bae:settings-save', 'bae:settings-seed',
    'bae:jobs-mine', 'bae:job-get', 'bae:job-hide', 'bae:usage-summary',
    'bae:jobs-team', 'bae:jobs-team-find', 'bae:job-stamp', 'bae:job-stamp-bulk', 'bae:job-stamps', 'bae:stamp-unseen', 'bae:stamp-seen', 'bae:usage-team', 'bae:usage-export'].sort());
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

test('the stage-3 make channels (finish · result versions · tool job) are open in preload, each with the session epoch, and none reads the key', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const bae = preload.slice(preload.indexOf("exposeInMainWorld('baeGyeongAPI'"));
  const api = bae.slice(0, bae.indexOf('});') + 3);
  for (const [name, channel] of [['drawFinish', 'bae:draw-finish'], ['resultSet', 'bae:result-set'], ['toolJob', 'bae:tool-job']] as const) {
    assert.match(api, new RegExp(`${name}: \\(call: unknown\\) => ipcRenderer\\.invoke\\('${channel}', call, canonicalSessionEpoch\\)`), name);
  }
  const ipcSrc = readFileSync('electron/bae/baeJobsIpc.ts', 'utf8');
  for (const channel of ['bae:draw-finish', 'bae:result-set', 'bae:tool-job']) assert.ok(ipcSrc.includes(`'${channel}'`), channel);
  assert.doesNotMatch(api, /get-key|getKey/);
  // 화면이 읽을 수 있는 이 PC 그림: 판 파일과 재료 미리보기뿐 (input_N · job.json 은 아님)
  const names = /LOCAL_READ_NAMES = new Set\(\[([\s\S]*?)\]\)/.exec(ipcSrc)![1];
  for (const n of ['final.png', 'alt.png', 'final_noise.png', 'alt_noise.png', 'source.png', 'base_1.jpg', 'sheet.jpg']) assert.ok(names.includes(`'${n}'`), n);
  assert.ok(!names.includes('input_') && !names.includes('job.json'));
});

// ── 8단계: 관리자 화면 ──
const J1 = '11111111-1111-4111-8111-111111111111', J2 = '22222222-2222-4222-8222-222222222222';

test('stage 8: a stamp is checked before it goes to the server (kind, memo for 다시, one line), and the windows hear jobs', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true }); registerBaeIpc(h.deps);
  await assert.rejects(h.invoke('bae:job-stamp', 'not-an-id', 'good', null, 7), /작업 번호/);
  await assert.rejects(h.invoke('bae:job-stamp', J1, 'gold', null, 7), /도장 종류/);
  await assert.rejects(h.invoke('bae:job-stamp', J1, 'again', '   ', 7), /메모/);
  await assert.rejects(h.invoke('bae:job-stamp', J1, 'seen', 'x'.repeat(401), 7), /400자/);
  assert.equal(h.calls.filter((c) => c[0] === 'jobStamp').length, 0, 'nothing reached the server');
  await h.invoke('bae:job-stamp', J1, 'again', '  칠판을\n더 크게  ', 7);
  assert.deepEqual(h.calls.at(-1), ['jobStamp', 'u1', J1, 'again', '칠판을 더 크게'], 'the memo goes as one line; the actor is the session\'s');
  await h.invoke('bae:job-stamp', J1, null, 'ignored', 7);
  assert.deepEqual(h.calls.at(-1), ['jobStamp', 'u1', J1, null, null], 'taking a stamp back carries no memo');
  assert.deepEqual(h.signals, ['jobs', 'jobs']);
  // bulk: ids only, at most 200, the same id once
  await assert.rejects(h.invoke('bae:job-stamp-bulk', [], 7), /1~200/);
  await assert.rejects(h.invoke('bae:job-stamp-bulk', [J1, 'x'], 7), /1~200/);
  await assert.rejects(h.invoke('bae:job-stamp-bulk', Array.from({ length: 201 }, () => J1), 7), /1~200/);
  await h.invoke('bae:job-stamp-bulk', [J1, J2, J1], 7);
  assert.deepEqual(h.calls.at(-1), ['jobStampBulk', 'u1', [J1, J2]]);
  // seen: a non-negative position (or null); the other windows hear 'stamps' (the 景 number)
  await assert.rejects(h.invoke('bae:stamp-seen', -1, 7), /위치/);
  await assert.rejects(h.invoke('bae:stamp-seen', 1.5, 7), /위치/);
  await h.invoke('bae:stamp-seen', 9, 7);
  assert.deepEqual(h.calls.at(-1), ['stampSeen', 'u1', 9]); assert.equal(h.signals.at(-1), 'stamps');
  await h.invoke('bae:stamp-unseen', 7); assert.deepEqual(h.calls.at(-1), ['stampUnseen', 'u1']);
  // a stamp answer is dropped when the login changed on the way
  const slow = h.invoke('bae:job-stamp', J2, 'good', null, 7);
  h.setOrigin({ userId: 'u2', epoch: 8 });
  await assert.rejects(slow, /세션/);
});

test('stage 8: the team list filter and cursor are checked; the period unit of the cost table too', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true }); registerBaeIpc(h.deps);
  await assert.rejects(h.invoke('bae:jobs-team-find', { userId: 'u2', actorId: 'admin' }, null, 60, 7), /거르기/, 'unknown keys are refused');
  await assert.rejects(h.invoke('bae:jobs-team-find', { kind: 'paint' }, null, 60, 7), /거르기/);
  await assert.rejects(h.invoke('bae:jobs-team-find', { from: 'yesterday' }, null, 60, 7), /기간/);
  await assert.rejects(h.invoke('bae:jobs-team-find', { q: 'x'.repeat(101) }, null, 60, 7), /100자/);
  await assert.rejects(h.invoke('bae:jobs-team-find', {}, { createdAt: 'x', id: J1 }, 60, 7), /위치/);
  await h.invoke('bae:jobs-team-find', { userId: 'u2', unstamped: true, q: '주차장' }, { createdAt: '2026-11-16T07:01:52.123456+00:00', id: J1 }, 999, 7);
  assert.deepEqual(h.calls.at(-1), ['jobFindTeam', 'u1', { userId: 'u2', unstamped: true, q: '주차장' }, { createdAt: '2026-11-16T07:01:52.123456+00:00', id: J1 }, 200], 'the cursor text goes back as it came; at most 200 a page');
  await h.invoke('bae:jobs-team', '2026-11-16T07:00:00Z', 50, 7);
  assert.deepEqual(h.calls.at(-1), ['jobListTeam', 'u1', '2026-11-16T07:00:00Z', 50]);
  await assert.rejects(h.invoke('bae:usage-team', null, null, 'hour', 7), /단위/);
  await assert.rejects(h.invoke('bae:usage-team', 'soon', null, 'day', 7), /기준 시각/);
  await h.invoke('bae:usage-team', '2026-10-31T15:00:00.000Z', null, 'week', 7);
  assert.deepEqual(h.calls.at(-1), ['usageTeam', 'u1', '2026-10-31T15:00:00.000Z', null, 'week']);
});

test('stage 8: the CSV is made in main from the server table (the screen sends only the period), with the won rate from settings', async () => {
  const { registerBaeIpc } = await load('electron/bae/baeIpc.ts');
  const h = harness({ isAdmin: true });
  h.deps.store.settingsGet = async () => [{ key: 'prices', value: { krwPerUsd: 1500 }, revision: 1, version: null, updatedAt: null, updatedBy: null }] as never;
  registerBaeIpc(h.deps);
  const where = await h.invoke('bae:usage-export', null, null, 'day', 7);
  assert.equal(where, 'C:\\Users\\me\\Downloads\\BAE경_비용_2026-11-01_2026-11-16.csv');
  const [name, text] = h.saved[0];
  assert.equal(name, 'BAE경_비용_2026-11-01_2026-11-16.csv');
  assert.ok(text.startsWith('\uFEFF기간 시작(일),사람,종류,모델,호출 수,달러,원\r\n'), 'a BOM so Excel reads Korean');
  const lines = text.slice(1).trim().split('\r\n');
  assert.deepEqual(lines.slice(1), [
    '2026-11-15,"허혜원, 팀",주문서,gpt-6.1-sol,1,0.024100,36',
    "2026-11-16,'=장삐쭈,그림,gpt-image-2.5-sunburst,2,0.155300,233",
    '합계,,,,3,0.179400,269',
  ], 'quoted commas, no formula cells, a total that matches the lines');
  assert.deepEqual(h.calls.find((c) => c[0] === 'usageTeam'), ['usageTeam', 'u1', null, null, 'day']);
  await assert.rejects(h.invoke('bae:usage-export', null, null, 'decade', 7), /단위/);
});

test('stage 8: the new channels are open in preload, each with the session epoch', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const bae = preload.slice(preload.indexOf("exposeInMainWorld('baeGyeongAPI'"));
  const api = bae.slice(0, bae.indexOf('});') + 3);
  for (const [name, channel] of [['jobsTeam', 'bae:jobs-team'], ['jobsTeamFind', 'bae:jobs-team-find'], ['jobStamp', 'bae:job-stamp'], ['jobStampBulk', 'bae:job-stamp-bulk'],
    ['jobStamps', 'bae:job-stamps'], ['stampUnseen', 'bae:stamp-unseen'], ['stampSeen', 'bae:stamp-seen'], ['usageTeam', 'bae:usage-team'], ['usageExport', 'bae:usage-export']] as const) {
    assert.match(api, new RegExp(`${name}: \\([^)]*\\) => ipcRenderer\\.invoke\\('${channel}'(, [a-zA-Z]+)*, canonicalSessionEpoch\\)`), name);
  }
  // main writes the CSV through a save dialog; the screen never gets a file path to write
  const main = readFileSync('electron/main.ts', 'utf8');
  assert.match(main, /saveText: async \(defaultName, text\) => \{[\s\S]{0,400}showSaveDialog/);
});

// ── 5단계 레이어로 나누기 · 7단계 다른 각도로: 통로 연결 ──
function channelHarness(canUse = true) {
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  let origin = { userId: 'u1', epoch: 7 };
  const unused = () => { throw new Error('not in this test'); };
  return {
    handlers, setOrigin: (o: typeof origin) => { origin = o; },
    deps: {
      ipc: { handle: (c: string, h: (...a: unknown[]) => Promise<unknown>) => handlers.set(c, h) },
      getSessionOriginOrThrow: () => origin, canUse: async () => canUse,
      settings: { get: unused, forget: () => {} }, keyFor: unused, local: { saveJobFile: unused, writeJobMeta: unused, jobDir: unused, cacheDir: 'C:\\nowhere' },
      outbox: { enqueue: unused }, progress: () => {}, imagePrefs: { get: () => ({ imageField: 'image[]', stream: true }), set: () => {} },
      publicUrl: (p: string) => 'https://example.invalid/' + p, showItemInFolder: () => {}, appVersion: 'test', origin: 'test-pc',
    },
    invoke: (c: string, ...a: unknown[]) => handlers.get(c)!(null, ...a),
  };
}
/** preload 의 한 묶음 (exposeInMainWorld('이름', { … });) */
const preloadApi = (preload: string, name: string) => { const from = preload.slice(preload.indexOf(`exposeInMainWorld('${name}'`)); return from.slice(0, from.indexOf('});') + 3); };

test('stages 5 · 7: main opens exactly the angle and layers channels, and every one is in preload with the session epoch (args in main\'s order)', async () => {
  const { registerBaeAngleIpc, BAE_ANGLE_CHANNELS } = await load('electron/bae/baeAngleIpc.ts');
  const { registerBaeLayersIpc, BAE_LAYERS_CHANNELS } = await load('electron/bae/baeLayersIpc.ts');
  const ha = channelHarness(); registerBaeAngleIpc(ha.deps);
  assert.deepEqual([...ha.handlers.keys()].sort(), ['bae:angle-abort', 'bae:angle-draw']);
  assert.deepEqual([...BAE_ANGLE_CHANNELS].sort(), ['bae:angle-abort', 'bae:angle-draw']);
  const hl = channelHarness(); registerBaeLayersIpc(hl.deps);
  const layers = ['bae:layers-abort', 'bae:layers-begin', 'bae:layers-done', 'bae:layers-edit', 'bae:layers-end', 'bae:layers-pd', 'bae:layers-show-psd', 'bae:layers-store-forget', 'bae:layers-store-get', 'bae:layers-store-set'];
  assert.deepEqual([...hl.handlers.keys()].sort(), layers);
  assert.deepEqual([...BAE_LAYERS_CHANNELS].sort(), layers);

  const preload = readFileSync('electron/preload.ts', 'utf8');
  const angle = preloadApi(preload, 'baeAngleAPI');
  for (const [name, args] of [['draw', 'call'], ['abort', 'jobId']] as const)
    assert.match(angle, new RegExp(`${name}: \\([^)]*\\) => ipcRenderer\\.invoke\\('bae:angle-${name}', ${args}, canonicalSessionEpoch\\)`), name);
  const lay = preloadApi(preload, 'baeLayersAPI');
  for (const [name, ch, args] of [['begin', 'begin', 'call'], ['pd', 'pd', 'call'], ['edit', 'edit', 'call'], ['done', 'done', 'call'], ['end', 'end', 'jobId, how, message'], ['abort', 'abort', 'jobId'],
    ['storeGet', 'store-get', 'pic, key'], ['storeSet', 'store-set', 'pic, key, value'], ['storeForget', 'store-forget', 'pic'], ['showPsd', 'show-psd', 'jobId']] as const)
    assert.match(lay, new RegExp(`${name}: \\([^)]*\\) => ipcRenderer\\.invoke\\('bae:layers-${ch}', ${args}, canonicalSessionEpoch\\)`), name);
  // 묶음마다 통로 수가 같다 (preload 에만 있는 통로가 없다)
  assert.equal((angle.match(/ipcRenderer\.invoke\('bae:angle-/g) ?? []).length, 2);
  assert.equal((lay.match(/ipcRenderer\.invoke\('bae:layers-/g) ?? []).length, layers.length);
  for (const api of [angle, lay]) assert.doesNotMatch(api, /get-key|getKey|token/i, 'no key or token goes to the screen');
});

test('stages 5 · 7: the new channels check the session epoch and the BAE경 right before doing anything', async () => {
  const { registerBaeAngleIpc } = await load('electron/bae/baeAngleIpc.ts');
  const { registerBaeLayersIpc } = await load('electron/bae/baeLayersIpc.ts');
  const a = channelHarness(); registerBaeAngleIpc(a.deps);
  await assert.rejects(a.invoke('bae:angle-draw', { jobId: J1 }, 6), /세션/);
  await assert.rejects(a.invoke('bae:angle-draw', { jobId: 'nope' }, 7), /작업 번호/);
  assert.equal(await a.invoke('bae:angle-abort', J1, 7), false, 'nothing running');
  const out = channelHarness(false); registerBaeAngleIpc(out.deps);
  await assert.rejects(out.invoke('bae:angle-draw', { jobId: J1, images: [] }, 7), /권한/);
  const l = channelHarness(); registerBaeLayersIpc(l.deps);
  await assert.rejects(l.invoke('bae:layers-begin', { jobId: J1 }, 6), /세션/);
  await assert.rejects(l.invoke('bae:layers-show-psd', J1, 8), /세션/);
  assert.equal(await l.invoke('bae:layers-show-psd', J1, 7), false, 'no PSD for a job this PC did not split');
  const lo = channelHarness(false); registerBaeLayersIpc(lo.deps);
  await assert.rejects(lo.invoke('bae:layers-show-psd', J1, 7), /권한/);
});

test('stages 5 · 7: baeMain registers both (same session · right · key · store · outbox as the make flow) and stops them on logout', () => {
  const src = readFileSync('electron/bae/baeMain.ts', 'utf8');
  assert.match(src, /const angle = registerBaeAngleIpc\(\{[\s\S]{0,400}progress: \(p\) => deps\.broadcast\('bae:progress', p\)/);
  assert.match(src, /const layers = registerBaeLayersIpc\(\{[\s\S]{0,400}showItemInFolder: \(p\) => shell\.showItemInFolder\(p\)/);
  for (const dep of ['canUse', 'settings', 'keyFor', 'local', 'outbox', 'imagePrefs', 'publicUrl', 'origin']) {
    assert.match(src, new RegExp(`registerBaeAngleIpc\\(\\{[\\s\\S]{0,400}\\b${dep}\\b`), 'angle ' + dep);
    assert.match(src, new RegExp(`registerBaeLayersIpc\\(\\{[\\s\\S]{0,400}\\b${dep}\\b`), 'layers ' + dep);
  }
  assert.match(src, /const keyFor = async \(o: \{ userId: string; epoch: number \}\) => \(await deps\.keyring\.keyFor\(o\)\)\.key;/);
  assert.match(src, /active: \(owner: string\) => \[\.\.\.jobs\.active\(owner\), \.\.\.angle\.active\(owner\)\]/, "'bae:active' lists angle drawings too");
  assert.match(src, /stop\(\) \{[^}]*angle\.abortAll\(\);[^}]*layers\.abortAll\(\);/);
});

test('stages 5 · 7: the screen opens both tools from the start row, the drop zones, the bench result and the job view (no more "N단계에서 열려요")', () => {
  const view = readFileSync('src/features/bae-gyeong/BaeGyeongView.tsx', 'utf8');
  assert.doesNotMatch(view, /단계에서 열려요|onLater|LATER/);
  assert.match(view, /kind === 'layers'\) layersFileRef\.current\?\.click\(\)/);
  assert.match(view, /else angleFileRef\.current\?\.click\(\)/);
  assert.match(view, /zone === 'layers'\) void useBaeAngle\.getState\(\)\.openLayersFile\(file\)/);
  assert.match(view, /else void useBaeAngle\.getState\(\)\.openAngleFile\(file\)/);
  assert.equal((view.match(/onLayers:/g) ?? []).length, 3, 'bench result, my record, my team record');
  assert.equal((view.match(/onAngle:/g) ?? []).length, 3, 'bench result, my record, my team record');
  // 그림 고르기 칸 순서: 레이어 · 각도 · 4K · 노이즈 제거 (3단계 화면 시험이 마지막 칸 = 노이즈 제거를 쓴다)
  const picks = [...view.matchAll(/data-pick="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(picks, ['layers', 'angle', 'upscale', 'denoise']);
  const job = readFileSync('src/features/bae-gyeong/records/JobView.tsx', 'utf8');
  assert.match(job, /onClick=\{p\.onLayers\}/); assert.match(job, /onClick=\{p\.onAngle\}/); assert.match(job, /onClick=\{p\.onShowPsd\}/);
  assert.match(job, /이어서 만들기/); assert.match(job, /PSD가 있는 폴더 열기/);
  const bench = readFileSync('src/features/bae-gyeong/home/Workbench.tsx', 'utf8');
  assert.match(bench, /bae-tool-layers" title="[^"]+" onClick=\{a\.onLayers\}/); assert.match(bench, /bae-tool-angle" title="[^"]+" onClick=\{a\.onAngle\}/);
  const layer = readFileSync('src/features/bae-gyeong/state/BaeMakeLayer.tsx', 'utf8');
  assert.match(layer, /s\.win === 'angle' && ag\.target/); assert.match(layer, /s\.win === 'layers' && ag\.layers/);
  assert.match(layer, /depth: previewAngleDepth/, 'test mode: fake depth');
  assert.match(layer, /gateway: previewLayers\(\)/, 'test mode: the layers window opens and says why it cannot split');
  const access = readFileSync('src/features/bae-gyeong/angleAccess.ts', 'utf8');
  assert.match(access, /테스트 모드에서는 레이어 나누기를 쓸 수 없어요/);
  // 결과 그림은 이 PC 원본(result.png)을 blob 주소로 (입체 판은 http 미리보기를 못 쓴다)
  const ag = readFileSync('src/features/bae-gyeong/state/useBaeAngle.ts', 'utf8');
  assert.match(ag, /localFile\(jobId, 'result\.png'\)/); assert.match(ag, /URL\.createObjectURL\(new Blob/);
  assert.match(ag, /const key = 'r' \+ a\.id \+ a\.variant \+ '_' \+ a\.bytes\.length/);
});
