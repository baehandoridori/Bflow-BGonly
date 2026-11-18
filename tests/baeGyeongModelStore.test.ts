import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

// BAE경 모델 보관함 (electron/bae/model/modelStore.ts): 이 PC → 모델 창고(PC 폴더로 흉내) → Hugging Face(127.0.0.1 가짜 서버).
// 진짜 모델 파일 · 진짜 Hugging Face 는 쓰지 않는다. 작은 가짜 모델 두 개로 확인값 · 거절 · 받기 순서를 본다.
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const GOOD_A = Buffer.from('graph-bytes-of-a-tiny-model-'.repeat(200));
const GOOD_B = Buffer.alloc(3 * 1024 * 1024 + 17, 7);   // 3MB 넘게: 진행 알림이 여러 번 온다
const BAD_B = Buffer.alloc(GOOD_B.length, 9);            // 크기는 같고 내용이 다름 (창고에 잘못 올린 파일)
const MODELS = {
  depth: { id: 'depth', label: '시험 깊이 모델', use: '다른 각도로', engine: 'worker', source: 'test',
    files: [{ path: 'depth/model.onnx', size: GOOD_B.length, sha256: sha(GOOD_B), url: 'https://huggingface.co/x/resolve/abc/model.onnx' }] },
  'up-a': { id: 'up-a', label: '시험 4K', use: '4K', engine: 'worker', source: 'test',
    files: [{ path: 'up-a/model.onnx', size: GOOD_A.length, sha256: sha(GOOD_A), url: null }, { path: 'up-a/w.bin', size: GOOD_B.length, sha256: sha(GOOD_B), url: null }] },
};

function fakeHf(body: () => Buffer | null) {
  const hits: string[] = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    const b = body();
    if (!b) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length });
    // 조각으로 나눠 보낸다 (받는 쪽이 이어 붙이며 재는지)
    let i = 0; const step = () => { if (i >= b.length) { res.end(); return; } res.write(b.subarray(i, i + 65536)); i += 65536; setImmediate(step); }; step();
  });
  return new Promise<{ url: string; hits: string[]; close: () => void }>((resolve) => srv.listen(0, '127.0.0.1', () => {
    const port = (srv.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}/model.onnx`, hits, close: () => { srv.closeAllConnections?.(); srv.close(); } });
  }));
}

const made: string[] = [];
const tmp = (name: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `bae-models-${name}-`)); made.push(d); return d; };
test.after(() => {
  // 이 시험이 만든 임시 폴더만 치운다
  for (const d of made) { assert.equal(path.dirname(path.resolve(d)), path.resolve(os.tmpdir())); assert.ok(path.basename(d).startsWith('bae-models-')); fs.rmSync(d, { recursive: true, force: true }); }
});
function putWarehouse(dir: string, rel: string, bytes: Buffer) { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); }
const listAll = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : [];

async function makeStore(root: string, warehouse: string | null, hfUrl: string | null, extra: Record<string, unknown> = {}) {
  const { createBaeModelStore } = await load('electron/bae/model/modelStore.ts');
  const lines: string[] = [];
  const store = createBaeModelStore({ root, warehouse: () => warehouse, models: MODELS, urlFor: (f: { url: string | null }) => (f.url ? hfUrl : null), log: (l: string) => lines.push(l), ...extra });
  return { store, lines };
}

test('the real model list: safe paths, pinned Hugging Face revisions, known sizes', async () => {
  const { BAE_MODELS, isSafeModelPath, baeModelBytes } = await load('src/shared/bae/models.ts');
  for (const spec of Object.values(BAE_MODELS) as any[]) {
    for (const f of spec.files) {
      assert.ok(isSafeModelPath(f.path), f.path);
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
      if (f.url) assert.match(f.url, /^https:\/\/huggingface\.co\/onnx-community\/[^/]+\/resolve\/[0-9a-f]{40}\//, `${f.path}: a pinned commit, never 'main'`);
    }
  }
  assert.equal(BAE_MODELS.depth.files[0].sha256, 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c', 'the same pin as the HTML ANGD');
  assert.equal(BAE_MODELS['up-b'].engine, 'renderer', '4K B runs on the screen side (stage 0: wrong picture on DirectML)');
  assert.equal(BAE_MODELS['up-a'].engine, 'worker');
  assert.ok(baeModelBytes(BAE_MODELS.birefnet) > 480e6);
  for (const bad of ['../x', 'a/b/c', '/abs', 'a\\b', '', 'a/..', 'x.']) assert.equal(isSafeModelPath(bad), false, bad);
});

test('warehouse ok → copied, checked and used; the next call uses the PC copy without copying', async () => {
  const root = tmp('root'), wh = tmp('wh');
  putWarehouse(wh, 'depth/model.onnx', GOOD_B);
  const hf = await fakeHf(() => GOOD_B);
  try {
    const { store } = await makeStore(root, wh, hf.url);
    assert.equal((await store.state('depth')).ready, false);
    const progress: any[] = [];
    const r = await store.ensure('depth', (p: any) => progress.push(p));
    assert.deepEqual(r.sources, { 'depth/model.onnx': 'warehouse' });
    assert.deepEqual(fs.readFileSync(r.files['depth/model.onnx']), GOOD_B);
    assert.equal(hf.hits.length, 0, 'Hugging Face is not asked when the warehouse has it');
    const copies = progress.filter((p) => p.phase === 'copy');
    assert.ok(copies.length >= 3, `progress during the copy (${copies.length})`);
    assert.ok(copies.every((p, i) => i === 0 || p.doneBytes >= copies[i - 1].doneBytes), 'progress only goes up');
    assert.deepEqual(progress.at(-1), { id: 'depth', phase: 'done', file: null, source: null, doneBytes: GOOD_B.length, totalBytes: GOOD_B.length });
    assert.equal((await store.state('depth')).ready, true);
    assert.ok(!listAll(root).some((f) => f.endsWith('.part')), 'no half file left');
    // 두 번째: 이 PC 의 사본 (창고를 지워도 된다)
    fs.rmSync(wh, { recursive: true, force: true });
    const again = await store.ensure('depth');
    assert.deepEqual(again.sources, { 'depth/model.onnx': 'local' });
  } finally { hf.close(); }
});

test('a wrong file in the warehouse is rejected (moved aside, not used) and Hugging Face gives the right one', async () => {
  const root = tmp('root'), wh = tmp('wh');
  putWarehouse(wh, 'depth/model.onnx', BAD_B);
  const hf = await fakeHf(() => GOOD_B);
  try {
    const { store, lines } = await makeStore(root, wh, hf.url);
    const progress: any[] = [];
    const r = await store.ensure('depth', (p: any) => progress.push(p));
    assert.deepEqual(r.sources, { 'depth/model.onnx': 'internet' });
    assert.deepEqual(fs.readFileSync(r.files['depth/model.onnx']), GOOD_B);
    assert.equal(hf.hits.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(root, '.rejected', 'depth__model.onnx.warehouse')), BAD_B, 'the wrong copy is kept aside');
    assert.deepEqual(fs.readFileSync(path.join(wh, 'depth', 'model.onnx')), BAD_B, 'the warehouse itself is never touched');
    assert.ok(lines.some((l) => /확인값이 다름: depth\/model\.onnx \(warehouse\)/.test(l)), lines.join('\n'));
    assert.ok(progress.some((p) => p.phase === 'download' && p.source === 'internet'));
  } finally { hf.close(); }
});

test('Hugging Face also wrong → a clear error, nothing in the model place, the wrong download kept aside', async () => {
  const root = tmp('root'), wh = tmp('wh');
  putWarehouse(wh, 'depth/model.onnx', BAD_B);
  const hf = await fakeHf(() => BAD_B);
  try {
    const { store } = await makeStore(root, wh, hf.url);
    const progress: any[] = [];
    await assert.rejects(store.ensure('depth', (p: any) => progress.push(p)), (e: any) => e.code === 'MODEL_BAD_FILE' && /확인값이 달라서 쓰지 않았어요/.test(e.message));
    assert.equal(fs.existsSync(path.join(root, 'depth', 'model.onnx')), false);
    assert.ok(fs.existsSync(path.join(root, '.rejected', 'depth__model.onnx.internet')));
    assert.equal(progress.at(-1).phase, 'failed');
    assert.equal((await store.state('depth')).ready, false);
  } finally { hf.close(); }
});

test('a longer download than the file is refused early; an unreachable server is a network error', async () => {
  const root = tmp('root');
  const hf = await fakeHf(() => Buffer.concat([GOOD_B, Buffer.from('extra')]));
  try {
    const { store } = await makeStore(root, null, hf.url);
    await assert.rejects(store.ensure('depth'), (e: any) => e.code === 'MODEL_BAD_FILE');
  } finally { hf.close(); }
  const { store: offline } = await makeStore(tmp('root'), null, 'http://127.0.0.1:9/model.onnx');
  await assert.rejects(offline.ensure('depth'), (e: any) => e.code === 'MODEL_NETWORK' && /인터넷에서 받지 못했어요/.test(e.message));
  const hf404 = await fakeHf(() => null);
  try {
    const { store } = await makeStore(tmp('root'), null, hf404.url);
    await assert.rejects(store.ensure('depth'), (e: any) => e.code === 'MODEL_NETWORK' && /응답 404/.test(e.message));
  } finally { hf404.close(); }
});

test('a file with no Hugging Face copy comes only from the warehouse, with a message that says so', async () => {
  const root = tmp('root'), wh = tmp('wh');
  const { store } = await makeStore(root, null, 'http://127.0.0.1:9/never');
  await assert.rejects(store.ensure('up-a'), (e: any) => e.code === 'MODEL_UNAVAILABLE' && /G 드라이브 모델 창고를 찾지 못했어요/.test(e.message) && /창고에서만/.test(e.message));
  const { store: s2 } = await makeStore(root, wh, null);
  await assert.rejects(s2.ensure('up-a'), /모델 창고에 파일이 없어요/);
  putWarehouse(wh, 'up-a/model.onnx', GOOD_A);
  putWarehouse(wh, 'up-a/w.bin', Buffer.alloc(10));   // 크기가 다름: 복사하지도 않는다
  await assert.rejects(s2.ensure('up-a'), /모델 창고의 파일이 맞지 않아요/);
  putWarehouse(wh, 'up-a/w.bin', GOOD_B);
  const r = await s2.ensure('up-a');
  assert.deepEqual(r.sources, { 'up-a/model.onnx': 'local', 'up-a/w.bin': 'warehouse' }, 'the first file was already kept from the earlier try');
  assert.equal(r.dir, path.join(root, 'up-a'));
});

test('a damaged PC copy is found (size or content), moved aside and fetched again; verify() re-reads everything', async () => {
  const root = tmp('root'), wh = tmp('wh');
  putWarehouse(wh, 'depth/model.onnx', GOOD_B);
  const { store } = await makeStore(root, wh, null);
  await store.ensure('depth');
  const file = path.join(root, 'depth', 'model.onnx');
  // 같은 크기로 내용만 바뀜 (확인 기록의 고친 시각이 달라져 다시 잰다)
  const damaged = Buffer.from(GOOD_B); damaged[100] ^= 0xff; fs.writeFileSync(file, damaged);
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal((await store.state('depth')).ready, false, 'the stamp no longer matches');
  const r = await store.ensure('depth');
  assert.deepEqual(r.sources, { 'depth/model.onnx': 'warehouse' });
  assert.deepEqual(fs.readFileSync(path.join(root, '.rejected', 'depth__model.onnx.local')), damaged);
  assert.equal(await store.verify('depth'), true);
  fs.truncateSync(file, 10);
  assert.equal(await store.verify('depth'), false);
  assert.equal(fs.existsSync(file), false, 'verify moves a wrong file aside');
});

test('the same model asked twice at once is fetched once, and both callers get progress', async () => {
  const root = tmp('root');
  const hf = await fakeHf(() => GOOD_B);
  try {
    const { store } = await makeStore(root, null, hf.url);
    const a: any[] = [], b: any[] = [];
    const [r1, r2] = await Promise.all([store.ensure('depth', (p: any) => a.push(p)), store.ensure('depth', (p: any) => b.push(p))]);
    assert.equal(hf.hits.length, 1);
    assert.deepEqual(r1, r2);
    assert.equal(a.at(-1).phase, 'done'); assert.equal(b.at(-1).phase, 'done');
    await assert.rejects(store.ensure('nope'), (e: any) => e.code === 'MODEL_UNKNOWN');
  } finally { hf.close(); }
});

test('a stalled download stops after the quiet time instead of hanging', async () => {
  const srv = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Length': GOOD_B.length }); res.write(GOOD_B.subarray(0, 1000)); /* 그 뒤로 조용 */ });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/m`;
  try {
    const root = tmp('root');
    const { store } = await makeStore(root, null, url, { stallMs: 300 });
    const t0 = Date.now();
    await assert.rejects(store.ensure('depth'), (e: any) => e.code === 'MODEL_NETWORK');
    assert.ok(Date.now() - t0 < 5000);
    assert.ok(!listAll(root).some((f) => f.endsWith('.part')), 'the half file is cleaned up');
  } finally { srv.closeAllConnections?.(); srv.close(); }
});
