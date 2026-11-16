import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';

// BAE경 '이 PC 점검' (electron/bae/model/pcCheck.ts + src/shared/bae/pcCheck.ts). 바깥은 모두 가짜:
// OpenAI 는 127.0.0.1 의 가짜 서버, 모델 일꾼은 가짜 probe, 그래픽카드 정보는 손으로 만든 값.
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const GPU_INFO = { gpuDevice: [
  { vendorId: 0x1002, deviceId: 0x164e, active: false, driverVersion: '31.0.21921.1000' },
  { vendorId: 0x10de, deviceId: 0x2702, active: true, driverVersion: '32.0.15.7680', deviceString: 'NVIDIA GeForce RTX 4080 SUPER' },
] };
const models = (ready: string[]) => ['sam', 'birefnet', 'depth', 'up-a', 'up-b'].map((id) => ({
  id, ready: ready.includes(id), haveBytes: ready.includes(id) ? 100e6 : 0, totalBytes: 100e6, internet: id === 'depth' || id === 'birefnet',
}));
const probeOk = { dml: { ok: true, ms: 310 }, cpu: { ok: true, ms: 40 } };
const probeNoGpu = { dml: { ok: false, ms: 5, error: '시험: 그래픽카드를 끈 것처럼' }, cpu: { ok: true, ms: 40 } };

async function check(over: Record<string, unknown> = {}) {
  const { runBaePcCheck } = await load('electron/bae/model/pcCheck.ts');
  return runBaePcCheck({
    appVersion: '1.151.0', pcName: 'JBBJ-PC-07',
    gpuInfo: async () => GPU_INFO,
    videoMemory: async () => [{ name: 'NVIDIA GeForce RTX 4080 SUPER', bytes: 0x3ff800000 }, { name: 'AMD Radeon(TM) Graphics', bytes: 0x20000000 }],
    probe: async () => probeOk,
    models: async () => models(['sam', 'up-a']),
    warehouse: () => 'C:/BAE_stage0/model_warehouse',
    modelsDir: 'C:/x/models',
    freeBytes: async () => 50e9,
    openaiReach: async () => ({ ok: true, status: 401 }),
    internetReach: async () => ({ ok: true, status: 302 }),
    webgpu: { ok: true, f16: false, name: 'nvidia ada' },
    now: () => new Date('2026-11-16T09:00:00Z'),
    ...over,
  });
}

test('a good PC: everything works, the summary reads like the HTML', async () => {
  const r = await check();
  assert.equal(r.level, 'ok');
  assert.equal(r.summary, '4K로 키우기 돼요 · 레이어로 나누기 돼요 · 다른 각도로 돼요');
  assert.deepEqual(r.rows[0], { level: 'ok', name: '정리', text: r.summary });
  assert.equal(r.gpu.name, 'NVIDIA GeForce RTX 4080 SUPER');
  assert.equal(r.gpu.vramMB, 16376, 'the memory of the card with the same name, from the registry');
  assert.match(r.rows.find((x: any) => x.name === '그래픽카드').text, /RTX 4080 SUPER · 메모리 약 16GB/);
  assert.equal(r.rows.find((x: any) => x.name === '레이어 윤곽 모델 (SAM 2.1)').text, '이 PC에 받아 뒀어요');
  assert.match(r.rows.find((x: any) => x.name === '깊이 모델 (Depth Anything V2 Small)').text, /처음 쓸 때 약 100MB를 받아요/);
  assert.equal(r.checkedAt, '2026-11-16T09:00:00.000Z');
  assert.equal(r.version, 1);
  assert.ok(JSON.stringify(r).length < 16384, 'fits the server row');
});

test('"no graphics card": DirectML fails → CPU still does everything, slowly, and says so', async () => {
  const r = await check({ probe: async () => probeNoGpu });
  assert.equal(r.level, 'warn');
  assert.equal(r.summary, '4K로 키우기 돼요 · 레이어로 나누기 돼요 · 다른 각도로 돼요 (그래픽카드가 없어서 느려요)');
  assert.match(r.rows.find((x: any) => x.name === '그래픽카드').text, /쓸 수 없어요 \(시험: 그래픽카드를 끈 것처럼\)\. .*CPU로/);
  assert.equal(r.can.layers, true);
});

test('small graphics memory warns about the edge model; no warehouse and no internet means no layers', async () => {
  const small = await check({ videoMemory: async () => [{ name: 'NVIDIA GeForce RTX 4080 SUPER', bytes: 6 * 1024 ** 3 }] });
  assert.match(small.rows.find((x: any) => x.name === '그래픽카드 메모리').text, /약 6GB라 가장자리 모델/);
  const cut = await check({ warehouse: () => null, internetReach: async () => ({ ok: false }), models: async () => models([]) });
  assert.deepEqual(cut.can, { upscale: false, layers: false, angle: false, edge: false });
  assert.equal(cut.level, 'warn');
  assert.equal(cut.summary, '4K로 키우기 안 돼요 · 레이어로 나누기 안 돼요 · 다른 각도로 안 돼요');
  assert.equal(cut.rows.find((x: any) => x.name === '모델 창고 (G 드라이브)').level, 'warn');
  // 창고가 없어도 인터넷이면 깊이 모델은 받을 수 있다 (윤곽 · 4K 는 창고에만 있다)
  const net = await check({ warehouse: () => null, models: async () => models([]) });
  assert.deepEqual(net.can, { upscale: false, layers: false, angle: true, edge: true });
});

test('OpenAI unreachable or no compute engine is bad; low disk warns', async () => {
  const off = await check({ openaiReach: async () => ({ ok: false }) });
  assert.equal(off.level, 'bad');
  assert.equal(off.rows.find((x: any) => x.name === 'OpenAI 연결').level, 'bad');
  const broken = await check({ probe: async () => { throw new Error('worker gone'); } });
  assert.equal(broken.level, 'bad');
  assert.ok(broken.rows.some((x: any) => x.name === '계산 엔진' && x.level === 'bad'));
  const disk = await check({ freeBytes: async () => 0.5e9, models: async () => models([]) });
  assert.match(disk.rows.find((x: any) => x.name === '저장 공간').text, /모자랄 수 있어요/);
});

test('reachUrl: a fake server answering 401 counts as reachable; a closed port does not (OpenAI is never called)', async () => {
  const { reachUrl } = await load('electron/bae/model/pcCheck.ts');
  const seen: string[] = [];
  const srv = http.createServer((req, res) => { seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? 'no-key'}`); res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"no key"}}'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  try {
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`;
    assert.deepEqual(await reachUrl(base + '/models'), { ok: true, status: 401 });
    assert.deepEqual(seen, ['GET /v1/models no-key'], 'no key is sent');
    assert.deepEqual(await reachUrl('http://127.0.0.1:9/v1/models', { timeoutMs: 2000 }), { ok: false });
  } finally { srv.closeAllConnections?.(); srv.close(); }
});

test('registry and GPU parsing: 64-bit memory sizes, the active device, software rendering', async () => {
  const { readVideoMemoryWindows, pickGpu } = await load('electron/bae/model/pcCheck.ts');
  const KEY = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
  const mem = `\r\n${KEY}\\0000\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x3ff800000\r\n\r\n${KEY}\\0001\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x20000000\r\n\r\n?? ?: 2? ??\r\n`;
  const names = `\r\n${KEY}\\0000\r\n    DriverDesc    REG_SZ    NVIDIA GeForce RTX 4080 SUPER\r\n\r\n${KEY}\\0001\r\n    DriverDesc    REG_SZ    AMD Radeon(TM) Graphics\r\n`;
  const out = await readVideoMemoryWindows(async (args: string[]) => (args.includes('DriverDesc') ? names : mem));
  assert.deepEqual(out, [{ name: 'NVIDIA GeForce RTX 4080 SUPER', bytes: 17171480576 }, { name: 'AMD Radeon(TM) Graphics', bytes: 536870912 }]);
  assert.deepEqual(await readVideoMemoryWindows(async () => { throw new Error('no reg'); }), []);
  assert.deepEqual(pickGpu(GPU_INFO), { name: 'NVIDIA GeForce RTX 4080 SUPER', vendor: 'NVIDIA', driver: '32.0.15.7680', software: false });
  assert.equal(pickGpu({ gpuDevice: [{ vendorId: 0x1414, deviceId: 0x8c, active: true }] }).software, true, 'Microsoft Basic Render Driver');
  assert.equal(pickGpu(null).software, true);
});

test('the server payload carries no person id, and server rows are parsed defensively', async () => {
  const { baePcCheckPayload, parseBaePcCheckRows } = await load('src/shared/bae/pcCheck.ts');
  const r = await check();
  const p = baePcCheckPayload('1b4e28ba-2fa1-41d2-883f-0016d3cca427', r);
  assert.deepEqual(Object.keys(p).sort(), ['appVersion', 'level', 'pcId', 'pcName', 'result', 'summary']);
  assert.equal(p.level, 'ok');
  assert.throws(() => parseBaePcCheckRows([{ userId: 'u', pcId: 'p', level: 'great', checkedAt: 'x' }]), /올바르지 않아요/);
  assert.throws(() => parseBaePcCheckRows({}), /올바르지 않아요/);
  assert.deepEqual(parseBaePcCheckRows([{ userId: 'u', pcId: 'p', level: 'warn', checkedAt: '2026-11-16T00:00:00Z', result: 'no' }])[0].result, null);
});
