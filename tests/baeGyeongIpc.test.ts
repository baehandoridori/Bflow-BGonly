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
