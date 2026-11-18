import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// BAE경 4단계 화면: '4K로 키우기' 창의 글자 · 숫자 (HTML v0.3.5 UP_HINT · upTarget · upSync · upGo), '이 PC 점검' 카드와 관리자 표의 글자,
// 테스트 모드의 가짜 모델 통로(previewModels), 서버의 'pc-check-changed' 신호. DOM · 진짜 모델 · 서버 없이.
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}

test('4K size: the ratio\'s FHD × 2 like the HTML (16:9 → 3840×2160), a picked file finds its ratio, already-4K turns the button off', async () => {
  const v = await load('src/shared/bae/upscaleView.ts');
  assert.equal(v.baeRatioOf(2048, 1152), '16:9'); assert.equal(v.baeRatioOf(1536, 1024), '3:2'); assert.equal(v.baeRatioOf(1080, 1920), '9:16');
  assert.equal(v.baeRatioOf(1000, 777), null);
  // 시안: 2048×1152 → 3840×2160, 가로세로 1.875배, 견준 그림의 안쪽 53.33%
  const p = v.baeUpscalePlan({ ratio: '16:9', w: 2048, h: 1152 });
  assert.deepEqual(p.target, [3840, 2160]); assert.equal(p.done, false); assert.equal(p.problem, null);
  assert.equal(p.factorText, '1.875배'); assert.equal(Number(p.inner.w.toFixed(2)), 53.33);
  assert.deepEqual(v.baeUpscaleButton(p), { disabled: false, title: '그림은 그대로 두고 크기만 키워서 저장해요 (3840×2160). 이 PC 그래픽카드로 돌아서 비용이 없어요' });
  // 비율을 모르는 파일: 크기로 비율을 찾는다 (1600×900 → 16:9)
  assert.deepEqual(v.baeUpscalePlan({ w: 1600, h: 900 }).target, [3840, 2160]);
  assert.equal(v.baeUpscalePlan({ w: 1600, h: 900 }).factorText, '2.4배');
  // FHD 가 없는 비율은 2배 (HTML upTarget)
  assert.deepEqual(v.baeUpscalePlan({ ratio: '3:2', w: 1536, h: 1024 }).target, [3072, 2048]);
  assert.equal(v.baeUpscalePlan({ ratio: '3:2', w: 1536, h: 1024 }).factorText, '2배');
  // 이미 4K: HTML upSync 의 '이미 … 이상이에요'
  const big = v.baeUpscalePlan({ ratio: '16:9', w: 3840, h: 2160 });
  assert.equal(big.done, true); assert.deepEqual(v.baeUpscaleButton(big), { disabled: true, title: '이미 3840×2160 이상이에요' });
  // 비율 표시와 크기가 조금 다르면 둘 다
  assert.equal(v.baeUpscalePlan({ ratio: '16:9', w: 1500, h: 900 }).factorText, '가로 2.56배 · 세로 2.4배');
  // 못 키우는 것: 너무 작음 · 4096×4096 넘음 · 키운 크기가 8K 넓이를 넘음
  assert.match(v.baeUpscalePlan({ w: 10, h: 10 }).problem, /크기/);
  assert.match(v.baeUpscalePlan({ w: 4097, h: 4097 }).problem, /너무 커요/);
  assert.match(v.baeUpscalePlan({ w: 4096, h: 4000 }).problem, /키운 크기\(8192×8000\)/);
  assert.equal(v.baeUpscalePlan({ ratio: '3:2', w: 3456, h: 2304 }).problem, null, 'the HTML allowed 3:2 최대 → 6912×4608');
  assert.equal(v.baeUpscaleButton(v.baeUpscalePlan({ w: 4097, h: 4097 })).disabled, true);
});

test('4K words: the two methods (mockup cards + HTML hints), the engine that ran, the done line, the file name, the model download line', async () => {
  const v = await load('src/shared/bae/upscaleView.ts');
  const t = await load('src/shared/bae/upscaleTiles.ts');
  assert.deepEqual([v.BAE_UPSCALE_MODES.A.name, v.BAE_UPSCALE_MODES.B.name], ['A 선명하게', 'B 원본 그대로']);
  assert.equal(v.BAE_UPSCALE_MODES.A.hint, t.BAE_UPSCALE_HINT.A); assert.equal(v.BAE_UPSCALE_MODES.B.hint, '붓 질감까지 원본 그대로예요. A보다 2배쯤 걸려요.');
  assert.deepEqual([v.BAE_UPSCALE_MODES.A.model, v.BAE_UPSCALE_MODES.B.model], ['up-a', 'up-b']);
  assert.deepEqual([v.BAE_UPSCALE_MODES.A.speed, v.BAE_UPSCALE_MODES.B.speed], ['가장 빨라요', 'A보다 2배쯤 걸려요'], 'the HTML hint\'s speed half, on the card');
  assert.equal(v.baeUpscalePreviewHint(1600, 900), '이 PC에 원본이 없어서 서버의 미리보기 그림(1600×900)으로 키워요. 원본을 만든 PC에서 키우면 더 선명해요.');
  assert.equal(v.baeUpscaleEngineLabel('dml'), '그래픽카드 (DirectML)'); assert.equal(v.baeUpscaleEngineLabel('webgpu'), '그래픽카드 (WebGPU)');
  assert.equal(v.baeUpscaleEngineLabel('cpu', true), 'CPU · 그래픽카드에서 안 돼서 이어 감'); assert.equal(v.baeUpscaleEngineLabel('wasm'), 'CPU (WASM)');
  assert.equal(v.baeUpscaleDoneText({ ms: 12345, w: 3840, h: 2160, mode: 'A', ep: 'dml', fellBack: false }), '다 키웠어요 · 12.3초 · 3840×2160 · A 선명하게 · 그래픽카드 (DirectML)');
  assert.equal(v.baeUpscaleSeconds(125_000), '2분 5초');
  // HTML: 이름_3840x2160_A.png. 메인의 저장 창 이름 규칙(bae:save-as)을 지난다
  assert.equal(v.baeUpscaleFileName('주차장 낮.png', 3840, 2160, 'B'), '주차장 낮_3840x2160_B.png');
  const odd = v.baeUpscaleFileName('a/b:c*?"<>|', 3840, 2160, 'A');
  assert.equal(odd, 'abc_3840x2160_A.png'); assert.match(odd, /^[^\\/:*?"<>|]{1,120}\.png$/);
  assert.equal(v.baeUpscaleFileName('', 10, 10, 'A'), 'BAE경_10x10_A.png');
  // 계획 14 9-2: 받는 동안 진행 막대와 남은 크기
  assert.equal(v.baeModelProgressText({ id: 'up-b', phase: 'copy', doneBytes: 5e6, totalBytes: 16734210, source: 'warehouse' }),
    '4K 원본 그대로 (waifu2x swin_unet art)을(를) 모델 창고(G 드라이브)에서 받는 중 (처음 한 번) · 남은 크기 약 12MB');
  assert.match(v.baeModelProgressText({ id: 'up-a', phase: 'download', doneBytes: 1e6, totalBytes: 2495551, source: 'internet' }), /인터넷에서 받는 중 .* 남은 크기 약 1\.5MB$/);
  assert.equal(v.baeModelFirstUseText({ ready: true, haveBytes: 1, totalBytes: 1 }), '모델은 이 PC에 받아 뒀어요.');
  assert.equal(v.baeModelFirstUseText({ ready: false, haveBytes: 0, totalBytes: 2495551 }), '처음 한 번은 모델(약 2.5MB)을 모델 창고(G 드라이브)에서 받아요.');
});

test('PC check screen words: the admin table says who\'s PC can do what (slow without a graphics card), my new row replaces the old one', async () => {
  const { buildBaePcCheck } = await load('src/shared/bae/pcCheck.ts');
  const v = await load('src/features/bae-gyeong/settings/pcCheckView.ts');
  const { previewPcFacts } = await load('src/features/bae-gyeong/previewModels.ts');
  const models = ['sam', 'birefnet', 'depth', 'up-a', 'up-b'].map((id) => ({ id, ready: true, haveBytes: 1, totalBytes: 1, internet: true }));
  const row = (userId: string, kind: string, at: string) => { const r = buildBaePcCheck(previewPcFacts(kind, models, null), new Date(at));
    return { userId, userName: userId, pcId: `pc-${userId}`, pcName: r.pcName, appVersion: r.appVersion, level: r.level, summary: r.summary, result: r, checkedAt: r.checkedAt }; };
  const a = row('a', 'gpu', '2026-11-16T01:00:00Z'), b = row('b', 'nogpu', '2026-11-16T02:00:00Z'), c = row('c', 'offline', '2026-11-16T03:00:00Z');
  assert.deepEqual(v.pcTeamCells(a), { upscale: 'yes', layers: 'yes', angle: 'yes', gpu: 'NVIDIA GeForce RTX 3060', gpuOk: true });
  assert.deepEqual(v.pcTeamCells(b), { upscale: 'slow', layers: 'slow', angle: 'slow', gpu: 'CPU만 (Intel UHD Graphics 620)', gpuOk: false });
  assert.equal(c.level, 'bad', 'no OpenAI → bad');
  assert.deepEqual([v.pcTeamCells(c).upscale, v.pcTeamCells(c).layers, v.pcTeamCells(c).angle], ['no', 'no', 'yes'], 'no warehouse: only the model already here works');
  assert.equal(v.pcTeamCells({ ...a, result: null }).upscale, 'unknown');
  assert.equal(v.pcTeamSummary([a, b, c]), '3명 · PC 3대 · 4K 되는 PC 2대 · 레이어 2대 · 각도 3대');
  assert.equal(v.pcTeamSummary([]), '아직 올라온 점검이 없어요');
  const mine = { ...a, summary: 'new', checkedAt: '2026-11-16T09:00:00Z' };
  const merged = v.mergePcCheckRow([c, b, a], mine);
  assert.deepEqual(merged.map((r: any) => [r.userId, r.summary === 'new']), [['a', true], ['c', false], ['b', false]], 'same person and PC → one row, newest first');
  assert.equal(v.pcUploadText('ok', null), '관리자 표에 올렸어요.');
  assert.match(v.pcUploadText('failed', 'BAE경 서버 준비가 필요해요.'), /^관리자 표에는 올리지 못했어요\. 점검 결과는 여기서 그대로 볼 수 있어요\. \(BAE경 서버/);
});

function memoryStorage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; }

test('the preview model API keeps the app\'s shape: first use copies from the warehouse with progress, 4K A ticks per tile and doubles, the PC check row goes to the table with a signal', async () => {
  const { createPreviewModelGateway } = await load('src/features/bae-gyeong/previewModels.ts');
  const { baeUpscaleTileCount } = await load('src/shared/bae/upscaleTiles.ts');
  const storage = memoryStorage(); const sent: unknown[] = []; let review = false; let use = true;
  const g = createPreviewModelGateway({
    storage, identity: () => ({ id: '1', name: '배한솔' }), canUse: () => use, canReview: () => review, channel: { postMessage: (m: unknown) => sent.push(m) },
    tickMs: 0, now: () => new Date('2026-11-16T09:00:00Z'), enlarge: async (_rgba: Uint8Array, w: number, h: number) => new Uint8ClampedArray(w * h * 16),
  });
  assert.equal(g.preview, true);
  const st = await g.status();
  assert.deepEqual(st.models.filter((m: any) => m.ready).map((m: any) => m.id), ['sam', 'birefnet', 'depth'], '4K models are not here yet: the first use shows the download');
  const seen: any[] = []; const off = g.onProgress((p: any) => seen.push(p));
  await g.ensure('up-a');
  assert.deepEqual([seen[0].phase, seen.at(-2).phase, seen.at(-1).phase], ['check', 'verify', 'done']);
  const copies = seen.filter((p) => p.phase === 'copy');
  assert.equal(copies.length, 12); assert.ok(copies.every((p, i) => i === 0 || p.doneBytes >= copies[i - 1].doneBytes)); assert.equal(copies.at(-1).doneBytes, copies.at(-1).totalBytes);
  assert.ok(copies.every((p) => p.source === 'warehouse'));
  seen.length = 0; await g.ensure('up-a');
  assert.deepEqual(seen.map((p) => p.phase), ['check', 'done'], 'already here → no copy');
  off();
  // 4K A: 타일마다 알림 (같은 표), 2배
  const ticks: any[] = []; const offT = g.onUpscaleProgress((t: any) => ticks.push(t));
  const r = await g.upscaleA(new Uint8Array(640 * 360 * 4), 640, 360, 'u1');
  offT();
  assert.deepEqual([r.w, r.h, r.ep, r.fellBack, r.rgba.length], [1280, 720, 'dml', false, 1280 * 720 * 4]);
  assert.equal(r.tiles, baeUpscaleTileCount('A', 640, 360)); assert.equal(ticks.length, r.tiles); assert.ok(ticks.every((t) => t.ticket === 'u1'));
  await assert.rejects(g.upscaleA(new Uint8Array(10), 640, 360, 'u2'), /크기가 맞지 않아요/);
  const rb = await g.upscaleBFake(new Uint8Array(64 * 64 * 4), 64, 64, 'b');
  assert.equal(rb.tiles, baeUpscaleTileCount('B', 64, 64));
  // 이 PC 점검 → 서버 표 (내 줄 하나, 신호), 관리자 · 검수자만 표를 본다
  const check = await g.pcCheck({ ok: true, name: 'nvidia ampere' });
  assert.equal(check.level, 'ok'); assert.equal(check.summary, '4K로 키우기 돼요 · 레이어로 나누기 돼요 · 다른 각도로 돼요'); assert.equal(check.rows[0].name, '정리');
  await assert.rejects(g.pcCheckList(), /관리자와 BAE경 검수자만/);
  review = true;
  const before = await g.pcCheckList();
  assert.deepEqual(before.map((x: any) => [x.userName, x.level]), [['장삐쭈', 'ok'], ['허혜원', 'warn'], ['안류천', 'bad']], 'three test accounts, newest first');
  const mine = await g.pcCheckPut();
  assert.equal(mine.userId, '1'); assert.equal(mine.level, 'ok'); assert.match(mine.pcId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(sent, [{ bae: 'pc-checks' }], 'a contentless signal like the server');
  const again = await g.pcCheckPut();
  assert.equal(again.pcId, mine.pcId, 'the same PC keeps its number');
  const after = await g.pcCheckList();
  assert.equal(after.length, 4); assert.equal(after[0].userId, '1');
  await assert.rejects(g.portRequest(), /모델 일꾼이 없어요/); await assert.rejects(g.files('up-b'), /모델 파일/);
  use = false; await assert.rejects(g.ensure('up-b'), /권한/);
});

test('the server\'s pc-check-changed signal reaches the screens as "pc-checks" (and again after a reconnect)', async () => {
  const { startBaeRealtime } = await load('electron/bae/baeStore.ts');
  const handlers = new Map<string, () => void>(); let onStatus: ((s: string) => void) | null = null;
  const channel = { on: (_t: string, f: { event: string }, cb: () => void) => { handlers.set(f.event, cb); return channel; }, subscribe: (cb: (s: string) => void) => { onStatus = cb; return channel; } };
  const got: string[] = [];
  const stop = startBaeRealtime({ channel: () => channel, removeChannel: async () => 'ok' } as never, (w: string) => got.push(w));
  assert.deepEqual([...handlers.keys()].sort(), ['jobs-changed', 'members-changed', 'pc-check-changed', 'settings-changed']);
  handlers.get('pc-check-changed')!();
  assert.deepEqual(got, ['pc-checks']);
  onStatus!('SUBSCRIBED');
  assert.deepEqual(got.slice(1), ['settings', 'members', 'jobs', 'pc-checks']);
  stop();
});

test('wiring: the 4K window opens from the start row, the drop zone and the result tools; settings carry the PC check for everyone and the team table for reviewers', () => {
  const view = readFileSync('src/features/bae-gyeong/BaeGyeongView.tsx', 'utf8');
  assert.doesNotMatch(view, /4K로 키우기는 4단계에서 열려요/, 'the stage-4 toast is gone');
  assert.match(view, /kind === 'upscale'\) \{ if \(!upscaleBusyShown\(null\)\) upscaleFileRef\.current\?\.click\(\)/, 'start row: pick a picture first (14d 8장 6번)');
  assert.match(view, /zone === 'upscale'\) void upscale\.open\(\{ blob: file, label: file\.name \}\)/, 'drop zone');
  assert.equal((view.match(/onUpscale:/g) ?? []).length, 3, 'bench result, my record, my team record');
  const job = readFileSync('src/features/bae-gyeong/records/JobView.tsx', 'utf8');
  assert.match(job, /onUpscale=\{p\.onUpscale\}/); assert.doesNotMatch(job, /onLater!\('upscale'\)/);
  const bench = readFileSync('src/features/bae-gyeong/home/Workbench.tsx', 'utf8');
  assert.match(bench, /onUpscale=\{a\.onUpscale\}/);
  const layer = readFileSync('src/features/bae-gyeong/state/BaeMakeLayer.tsx', 'utf8');
  assert.match(layer, /s\.win === 'upscale' && upscale\.up/);
  const win = readFileSync('src/features/bae-gyeong/windows/UpscaleWindow.tsx', 'utf8');
  for (const t of ['이 PC의 그래픽카드로 키워요. 0원이에요.', '키우는 방식', '지금 크기', '키운 크기', '이 PC 그래픽카드', '두 크기를 같은 비율로 줄여 견준 그림이에요.', '방식 다시 고르기', '창을 닫아도 계속 키워요.',
    '받는 동안 다른 일을 해도 돼요. 창을 닫아도 계속 받고, 다 받으면 이어서 키워요.'])
    assert.ok(win.includes(t), t);
  const set = readFileSync('src/features/bae-gyeong/settings/BaeSettingsTab.tsx', 'utf8');
  assert.match(set, /<PcCheckCard \/>\s*\{access\.canReview \? <PcCheckTeamCard \/> : null\}/);
  // 화면이 쓰는 모델 통로는 preload 에 다 열려 있다 (세션 epoch 를 붙여서)
  const preload = readFileSync('electron/preload.ts', 'utf8');
  for (const [name, ch] of [['ensure', 'bae:model-ensure'], ['pcCheck', 'bae:pc-check'], ['pcCheckPut', 'bae:pc-check-put'], ['pcCheckList', 'bae:pc-check-list'], ['upscaleA', 'bae:upscale-a']])
    assert.match(preload, new RegExp(`${name}: \\([^)]*\\) => ipcRenderer\\.invoke\\('${ch}'[^)]*canonicalSessionEpoch\\)`), name);
});
