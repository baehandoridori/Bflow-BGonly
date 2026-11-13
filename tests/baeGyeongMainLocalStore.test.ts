import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// BAE경 이 PC 보관함 (electron/bae/localStore.ts). 시험 폴더는 OS 임시 폴더 아래에 새로 만든다 (지우지 않는다).
let nonce = 0;
async function load(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const L = await load('electron/bae/localStore.ts');
const JOB_A = '0f6f1c2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
const JOB_B = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
/** 보관함 뿌리를 임시 폴더 안의 한 칸 아래로 둔다 (뿌리 밖에 무엇이 생기는지 볼 수 있게). */
function fresh() {
  const outer = mkdtempSync(join(tmpdir(), 'bae-local-'));
  const root = join(outer, 'bae');
  return { outer, root, store: L.createBaeLocalStore({ root, now: () => Date.parse('2026-11-13T12:00:00Z') }) };
}
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

test('paths take no letters the user typed: bad job ids, names, hashes, times and roots are refused', async () => {
  assert.throws(() => L.createBaeLocalStore({ root: 'relative\\bae' }), /보관함 위치/);
  const { outer, store } = fresh();
  const T = '2026-11-13T05:00:00Z';
  for (const id of ['../x', 'not-a-uuid', `${JOB_A}/..`, `..\\${JOB_A}`, 'C:\\Windows', '', null]) {
    await assert.rejects(store.saveJobFile(id, T, 'result.png', bytes(3)), /작업 번호/);
    await assert.rejects(store.readJobFile(id, 'result.png'), /작업 번호/);
  }
  for (const name of ['../result.png', '..\\result.png', 'result.exe', 'C:\\Windows\\evil.png', '/etc/passwd', 'job.json', 'ref_5.png', 'Result.png', '', 'result.png\u0000.txt']) {
    await assert.rejects(store.saveJobFile(JOB_A, T, name, bytes(3)), /파일 이름/);
  }
  for (const t of ['garbage', '', '1999-12-31T00:00:00Z', '2300-01-01T00:00:00Z', 12345]) await assert.rejects(store.saveJobFile(JOB_A, t, 'result.png', bytes(3)), /만든 때/);
  for (const h of ['../../etc', 'ABCDEF0123456789', 'abc', '0123456789abcdef/..', '0123456789abcdeg']) await assert.rejects(store.cachePut(h, 'answer.json', bytes(1)), /해시/);
  await assert.rejects(store.cachePut('0123456789abcdef', '../answer.json', bytes(1)), /파일 이름/);
  await assert.rejects(store.saveDraft({ data: {}, images: { '../rough.png': bytes(1) } }), /파일 이름/);
  await assert.rejects(store.saveJobFile(JOB_A, T, 'result.png', 'not bytes'), /내용/);
  assert.deepEqual(readdirSync(outer), [], 'nothing was written anywhere');
});

test('a job\'s files go to jobs\\{year-month}\\{id}\\ and come back the same; meta, list and size', async () => {
  const { root, store } = fresh();
  const r = await store.saveJobFile(JOB_A, '2026-11-13T05:00:00Z', 'result.png', bytes(1000, 1));
  assert.equal(r.path, join(root, 'jobs', '2026-11', JOB_A, 'result.png')); assert.equal(r.bytes, 1000);
  await store.saveJobFile(JOB_A, '2026-11-13T05:00:00Z', 'gpt.png', bytes(500, 2));
  await store.saveJobFile(JOB_A, '2026-11-13T05:00:00Z', 'input_1.png', bytes(10, 3));
  assert.deepEqual([...(await store.readJobFile(JOB_A, 'result.png'))!], [...bytes(1000, 1)]);
  assert.equal(await store.readJobFile(JOB_A, 'alt.png'), null);
  assert.equal(await store.readJobFile(JOB_B, 'result.png'), null);
  // an existing job stays where it is even if a later call says another month; upper-case ids are the same job
  await store.saveJobFile(JOB_A.toUpperCase(), '2026-12-02T00:00:00Z', 'rough_notes.jpg', bytes(20, 4));
  assert.ok(existsSync(join(root, 'jobs', '2026-11', JOB_A, 'rough_notes.jpg')));
  assert.ok(!existsSync(join(root, 'jobs', '2026-12')));
  // the month is the UTC one, the same on every PC
  await store.writeJobMeta(JOB_B, '2026-10-31T20:00:00-05:00', { prompt: 'a street', cost: 0.2 });
  assert.ok(existsSync(join(root, 'jobs', '2026-11', JOB_B, 'job.json')));
  assert.deepEqual(await store.readJobMeta(JOB_B), { prompt: 'a street', cost: 0.2 });
  await store.writeJobMeta(JOB_A, '2026-11-13T05:00:00Z', { v: 2 });
  assert.deepEqual(await store.readJobMeta(JOB_A), { v: 2 });
  assert.equal(await store.jobDir(JOB_A), join(root, 'jobs', '2026-11', JOB_A));
  assert.equal(await store.jobDir('2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'), null);
  assert.equal(await store.jobDir('2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', '2026-01-05T00:00:00Z'), join(root, 'jobs', '2026-01', '2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'));

  // a fresh instance (the app restarted) finds them by walking the month folders
  const again = L.createBaeLocalStore({ root });
  const list = await again.listLocalJobs();
  assert.deepEqual(list.map((j: { jobId: string; month: string; createdAt: string }) => [j.jobId, j.month, j.createdAt]), [
    [JOB_A, '2026-11', '2026-11-13T05:00:00.000Z'], [JOB_B, '2026-11', '2026-11-01T01:00:00.000Z'],
  ]);
  assert.deepEqual(list[0].files, ['gpt.png', 'input_1.png', 'result.png', 'rough_notes.jpg']);
  const sum = walk(join(root, 'jobs')).reduce((s, f) => s + statSync(f).size, 0);
  assert.equal(await again.usageBytes(), sum);
  assert.ok(sum >= 1530);
  assert.deepEqual([...(await again.readJobFile(JOB_A, 'gpt.png'))!], [...bytes(500, 2)]);
  assert.ok(!walk(root).some((f) => /\.tmp$/.test(f) || /[\\/]\./.test(f.slice(root.length))), 'no half-written file is left');
});

test('the draft is saved, read back, replaced and cleared; a save cut halfway leaves the last one whole', async () => {
  const { root, store } = fresh();
  assert.equal(await store.loadDraft(), null);
  await store.saveDraft({ data: { ratio: '16:9', request: '골목길', board: { notes: [] } }, images: { 'rough.png': bytes(30, 1), 'ref_1.jpg': bytes(10, 2) } });
  let d = await store.loadDraft();
  assert.deepEqual(d!.data, { ratio: '16:9', request: '골목길', board: { notes: [] } });
  assert.deepEqual(Object.keys(d!.images).sort(), ['ref_1.jpg', 'rough.png']);
  assert.deepEqual([...d!.images['rough.png']], [...bytes(30, 1)]);
  assert.deepEqual(d!.missing, []); assert.equal(d!.savedAt, '2026-11-13T12:00:00.000Z');

  await store.saveDraft({ data: { ratio: '2:1' }, images: { 'board_paint.png': bytes(5, 9) } });
  d = await store.loadDraft();
  assert.deepEqual(d!.data, { ratio: '2:1' });
  assert.deepEqual(Object.keys(d!.images), ['board_paint.png'], 'only the pictures of this save');

  // a save that died before the pointer moved: the half-written slot is ignored
  const slot = existsSync(join(root, 'draft', 'a', 'draft.json')) && existsSync(join(root, 'draft', 'b', 'draft.json')) ? null : 'x';
  assert.equal(slot, null, 'two slots in turn');
  const cur = JSON.parse((await import('node:fs')).readFileSync(join(root, 'draft', 'current.json'), 'utf8')).slot;
  const other = cur === 'a' ? 'b' : 'a';
  writeFileSync(join(root, 'draft', other, 'draft.json'), '{"v":1,"savedAt":"x","images":["rough.png"],"data":{"half":');
  assert.deepEqual((await store.loadDraft())!.data, { ratio: '2:1' });

  // three saves at once land one after another; the last one wins
  await Promise.all([1, 2, 3].map((n) => store.saveDraft({ data: { n }, images: { 'rough.png': bytes(4, n) } })));
  d = await store.loadDraft();
  assert.deepEqual(d!.data, { n: 3 }); assert.deepEqual([...d!.images['rough.png']], [...bytes(4, 3)]);

  await store.clearDraft();
  assert.equal(await store.loadDraft(), null);
  assert.equal(await L.createBaeLocalStore({ root }).loadDraft(), null, 'cleared for the next start too');
  await store.saveDraft({ data: { after: true } });
  assert.deepEqual((await store.loadDraft())!.data, { after: true });
  assert.deepEqual((await store.loadDraft())!.images, {});
});

test('a picture listed by the draft but gone from disk is reported, not fatal', async () => {
  const { root, store } = fresh();
  await store.saveDraft({ data: { a: 1 }, images: { 'rough.png': bytes(3) } });
  const cur = JSON.parse((await import('node:fs')).readFileSync(join(root, 'draft', 'current.json'), 'utf8')).slot;
  const listed = join(root, 'draft', cur, 'draft.json');
  const v = JSON.parse((await import('node:fs')).readFileSync(listed, 'utf8'));
  v.images.push('ref_2.png');
  writeFileSync(listed, JSON.stringify(v));
  const d = await store.loadDraft();
  assert.deepEqual(d!.missing, ['ref_2.png']); assert.deepEqual(Object.keys(d!.images), ['rough.png']);
});

test('the cache keeps files under cache\\{hash}\\ by fixed names', async () => {
  const { root, store } = fresh();
  const h = 'a3f09c1d2e4b5a6f';
  assert.equal(await store.cacheGet(h, 'answer.json'), null);
  await store.cachePut(h, 'answer.json', new TextEncoder().encode('{"layers":3}'));
  assert.equal(new TextDecoder().decode(await store.cacheGet(h, 'answer.json')), '{"layers":3}');
  assert.ok(existsSync(join(root, 'cache', h, 'answer.json')));
  assert.equal(store.outboxDir, join(root, 'outbox'));
  assert.equal(dirname(store.jobsDir), root);
});

test('folders that are not ours are skipped when listing', async () => {
  const { root, store } = fresh();
  await store.saveJobFile(JOB_A, '2026-11-13T05:00:00Z', 'result.png', bytes(2));
  mkdirSync(join(root, 'jobs', 'notes'), { recursive: true });
  mkdirSync(join(root, 'jobs', '2026-11', 'not-a-job'), { recursive: true });
  writeFileSync(join(root, 'jobs', '2026-11', JOB_A, 'stray.txt'), 'x');
  const list = await store.listLocalJobs();
  assert.deepEqual(list.map((j: { jobId: string }) => j.jobId), [JOB_A]);
  assert.deepEqual(list[0].files, ['result.png'], 'unknown files are counted in bytes but not listed');
});
