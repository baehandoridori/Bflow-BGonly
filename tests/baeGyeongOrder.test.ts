import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BAE_DEFAULT_MANUAL, BAE_DEFAULT_FIXED } from '../electron/bae/defaultTexts.ts';
import { BAE_SETTING_DEFAULTS } from '../src/shared/bae/settings.ts';
import { BAE_LIBRARY_DEFAULT, baeActiveLibrary } from '../src/shared/bae/library.ts';

// BAE경 주문서 · 그림 요청이 HTML v0.4.11 과 같은지: 견본은 C:\BAE_stage0\order_port\capture.mjs 가 HTML 을 숨긴 크롬에 띄우고
// 127.0.0.1 가짜 OpenAI 로 받은 것 (tests/fixtures/bae/order). 그림은 sha256 앞 16자 파일로 한 번만 둔다.
const built = await build({ entryPoints: ['src/shared/bae/order/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const O: any = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const FIX = new URL('./fixtures/bae/order/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, FIX), 'utf8'));
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png' };
const imgCache = new Map<string, string>();
function dataUrl(ref: string) {
  const name = ref.slice(4); let u = imgCache.get(name);
  if (!u) { const buf = readFileSync(new URL('img/' + name, FIX)); assert.equal(createHash('sha256').update(buf).digest('hex').slice(0, 16), name.split('.')[0], 'img file name = its sha256'); u = 'data:' + MIME[name.split('.')[1]] + ';base64,' + buf.toString('base64'); imgCache.set(name, u); }
  return u;
}
function resolve(v: any): any {
  if (typeof v === 'string') return v.startsWith('img:') ? dataUrl(v) : v.startsWith('@@MANUAL@@') ? BAE_DEFAULT_MANUAL + v.slice(10) : v;
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = resolve(v[k]); return o; }
  return v;
}

const files = readdirSync(FIX).filter((f) => f.endsWith('.json') && f !== 'sizes.json' && f !== 'html.json').sort();
const fixtures = files.map((f) => resolve(read(f)));
const PRICES = BAE_SETTING_DEFAULTS.prices;
const MODELS = BAE_SETTING_DEFAULTS.models;
const LIB = baeActiveLibrary([], []);

/** 견본의 HTML 상태 → TS 입력 (렌더러가 모아 메인에 넘길 것). 계산은 모두 TS 함수가 한다. */
function materialsOf(f: any) {
  const m = f.snap.materials;
  return { ratio: m.ratio, tier: m.tier, tilt: m.tilt, time: m.time, times: O.timeList(m.timeUser), place: m.place, persp: m.persp, guide: m.guide, calib: m.calib, request: m.request };
}
function inputsOf(f: any) {
  const i = f.snap.inputs, r = i.rough;
  return { rough: { kind: r.kind, small: r.small, annotated: r.annotated, notesText: r.notesText, hasColor: r.hasColor, tilt: r.tilt, noteCount: r.noteCount, key: O.hashStr(r.small), painted: r.painted },
    refs: i.refs.map((x: any) => ({ small: x.small, note: x.note })), base: { small: i.base.small }, refIds: i.refIds, place: i.place };
}
/** HTML 이 PD 에게 보낸 예시 썸네일 (렌더러의 libItem 이 만들 것 — 같은지는 그림 비교 도구가 본다). */
function thumbsOf(body: any) {
  const out: Record<string, string> = {}; const c = body.input[body.input.length - 1].content;
  c.forEach((x: any, k: number) => { const m = x.type === 'input_text' && /^Style library (\S+): /.exec(x.text); if (m) out[m[1]] = c[k + 1].image_url; });
  return out;
}
function prepare(f: any) {
  const materials = materialsOf(f), inputs = inputsOf(f); const isRev = typeof f.call.revText === 'string';
  const prev = f.snap.prevOrder; const mode = f.snap.materials.styleMode; const manualIds = f.snap.materials.manualPicks;
  const revise = isRev ? O.reviseInput(f.call.revText, f.snap.promptBefore, prev, BAE_DEFAULT_FIXED, null) : null;
  const carry = (!isRev && f.snap.carryChecked ? O.carryList(prev, inputs.rough.key) : []).concat(f.call.carryExtra);
  const dir = O.dirFor(isRev ? f.call.revText : null, carry, materials.request, prev);
  return { materials, inputs, isRev, prev, mode, manualIds, revise, carry, dir };
}

test('fixtures: HTML v0.4.11, no key-like text, under 5MB', () => {
  const html = read('html.json');
  assert.equal(html.ver, O.BAE_HTML_VER); assert.equal(html.manual, O.MANUAL_TAG); assert.ok(BAE_DEFAULT_MANUAL.startsWith(O.MANUAL_TAG + '\n'));
  assert.equal(html.imgModel, MODELS.imageModel); assert.equal(html.quality, MODELS.imageQuality);
  let total = 0;
  const walk = (dir: URL) => { for (const n of readdirSync(dir)) { const u = new URL(n, dir); const s = statSync(u); if (s.isDirectory()) walk(new URL(n + '/', dir)); else {
    total += s.size; if (!/\.json$/.test(n)) continue; const t = readFileSync(u, 'utf8');
    assert.doesNotMatch(t, /\bsk-[A-Za-z0-9_\-]{4,}/, n + ': key-like text'); assert.doesNotMatch(t, /Bearer|Authorization|sk-test-local-only/i, n);
  } } };
  walk(FIX); assert.ok(total < 5 * 1024 * 1024, 'fixtures ' + total + ' bytes');
  assert.ok(fixtures.length >= 30, 'PD fixtures ' + fixtures.length);
});

test('the team library and the style strip are the ones the HTML has', () => {
  const html = read('html.json');
  for (const e of BAE_LIBRARY_DEFAULT) {
    const buf = readFileSync(new URL('../src/features/bae-gyeong/assets/library/' + e.file, import.meta.url));
    assert.equal(createHash('sha256').update(buf).digest('hex').slice(0, 16), html.libSha[e.id], e.id);
  }
  const strip = readFileSync(new URL('../src/features/bae-gyeong/assets/library/strip.jpg', import.meta.url));
  assert.equal(createHash('sha256').update(strip).digest('hex').slice(0, 16), html.styleSha);
  for (const f of fixtures) assert.deepEqual(LIB.map((e: any) => ({ id: e.id, name: e.name, place: e.place, tod: e.tod })), f.snap.materials.library, f.id);
});

for (const f of fixtures) {
  test(`PD request body is the HTML one: ${f.id}`, () => {
    const p = prepare(f);
    // 둘레 값들 (화면 안내 · 기다림 말 · 이어 받기)
    const misc = f.snap.misc;
    assert.equal(p.inputs.rough.key, f.snap.inputs.rough.key, 'rough.key = hashStr(rough.small)');
    assert.deepEqual(O.carryList(p.prev, p.inputs.rough.key), misc.carryList);
    assert.deepEqual(O.orderPhrases(p.inputs, p.mode, LIB.length), misc.orderPhrases);
    assert.equal(p.prev ? O.mappingText(p.prev) : null, misc.mapping);
    assert.equal(O.guideSummaryKo(p.materials.persp, p.materials.guide), misc.guideSummaryKo);
    assert.equal(O.cameraSentence(p.materials), misc.cameraSentence);
    assert.equal(O.effRatio(p.materials.ratio, p.materials.tier, p.materials.tilt), misc.effRatio);
    assert.deepEqual(O.drawSizes(p.materials.ratio, p.materials.tier, p.materials.tilt), misc.drawSizes);
    assert.equal(O.timeForPD(p.materials.time, p.materials.times), misc.timeForPD);
    assert.equal(O.manualVersion(BAE_DEFAULT_MANUAL, f.snap.materials.manualCustom), misc.manualVersion);
    assert.equal(O.blocksVersion(BAE_DEFAULT_FIXED, f.snap.materials.blocksCustom), misc.blocksVersion);
    assert.deepEqual(O.currentPickIds('', p.mode, p.manualIds, p.prev, LIB), misc.currentPickIds);
    // 요청 몸
    const req = O.buildPdRequest({ model: MODELS.pdModel, manualText: BAE_DEFAULT_MANUAL, fixedText: BAE_DEFAULT_FIXED, rulesKo: f.snap.materials.rulesKo,
      materials: p.materials, inputs: p.inputs, styleMode: p.mode, library: LIB, manualIds: p.manualIds, libThumbs: thumbsOf(f.requests[0].body),
      revise: p.revise, carry: p.carry, dir: p.dir.ko });
    assert.equal(req.url, '/responses');
    assert.equal(f.snap.materials.pdModel, MODELS.pdModel, 'the HTML default PD model = the settings default');
    const first = f.requests[0].body;
    assert.equal(JSON.stringify(req.body), JSON.stringify(first), 'same JSON, same key order');
    assert.deepStrictEqual(req.body, first);
    if (f.requests.length > 1) {
      assert.equal(f.requests[0].status, 400);
      assert.ok(O.pdShouldRetryWithoutDeveloper(p.dir.ko.length > 0, 400, "Unsupported value: 'developer' role is not supported with this model."));
      assert.equal(JSON.stringify(req.retryBody), JSON.stringify(f.requests[1].body), 'the retry without a developer message');
    } else assert.equal(req.retryBody === null, p.dir.ko.length === 0);
  });

  test(`finished order sheet is the HTML one: ${f.id}`, () => {
    const p = prepare(f);
    const resp = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(f.answer.obj) }] }], usage: f.answer.usage };
    const { obj, cost } = O.readPdResponse(resp, MODELS.pdModel, PRICES.pd);
    const out = O.finishOrder({ obj, cost, revText: p.isRev ? f.call.revText : null, label: f.call.label, materials: p.materials, fixedText: BAE_DEFAULT_FIXED,
      inputs: p.inputs, styleMode: p.mode, library: LIB, manualIds: p.manualIds, dir: p.dir, carry: p.carry, carryExtra: f.call.carryExtra, prevOrder: p.prev,
      rate: PRICES.krwPerUsd, dirty: f.after.order.dirty, manualVer: O.manualVersion(BAE_DEFAULT_MANUAL, false), blocksVer: O.blocksVersion(BAE_DEFAULT_FIXED, false),
      rulesKo: f.snap.materials.rulesKo, manualPicks: f.snap.materials.manualPicks });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out.order)), f.after.order);
    assert.equal(out.promptText, f.after.promptText);
    assert.deepEqual(out.manualPicks, f.after.manualPicks);
    assert.equal(O.promptCountText(out.promptText).text, f.after.promptCount);
  });

  if (f.draw) test(`image request fields are the HTML ones: ${f.id}`, () => {
    const p = prepare(f); const d = f.draw;
    const size = O.drawSizes(p.materials.ratio, p.materials.tier, p.materials.tilt).gen;
    const prompt = O.drawPrompt(f.after.promptText, p.materials.ratio, p.materials.tier, p.materials.tilt);
    const q = { model: MODELS.imageModel, prompt, size, quality: MODELS.imageQuality, stream: true, imageCount: d.list.length };
    // HTML 이 보낸 그림 순서 = finalList(러프, 레퍼런스, 고른 예시, 그림체 띠), 고른 예시 = 주문서의 picks
    const kinds = O.finalList({ rough: p.inputs.rough.kind, place: null, refs: p.inputs.refs.map(() => 'ref'), base: 'style' }, f.after.order.picks.map(() => 'example'));
    assert.deepEqual(d.list.map((l: any) => l.kind), kinds);
    assert.deepEqual(d.list.filter((l: any) => l.kind === 'example').map((l: any) => l.id), f.after.order.picks);
    let st = O.firstImageAttempt(true, false);
    const ERR: Record<string, string> = { rejectField: "Unknown parameter: 'image[]'.", rejectStream: 'stream is not supported for this model.' };
    d.attempts.forEach((a: any, k: number) => {
      const want = a.fields.map((x: any) => x.filename ? { name: x.name, filename: x.filename, type: x.type } : { name: x.name, value: x.value });
      // 글 값은 multipart 로 나갈 때의 모양(줄바꿈 CRLF)으로 견준다 — 크롬의 FormData 가 그렇게 보냈다
      const got = O.imageFields({ ...q, stream: st.stream }, st.field).map((x: any) => 'file' in x ? { name: x.name, filename: x.filename, type: x.type } : { name: x.name, value: O.multipartTextValue(x.value) });
      assert.deepStrictEqual(got, want, 'attempt ' + (k + 1));
      // 그림 칸 i 는 finalList 의 i 번째 (sha256 로 확인)
      assert.deepEqual(a.fields.filter((x: any) => x.filename).map((x: any) => x.sha256), d.list.map((l: any) => l.sha256));
      for (const x of a.fields.filter((x: any) => x.filename)) assert.equal(x.format, 'png');
      if (k < d.attempts.length - 1) { const nx = O.nextImageAttempt(st, { status: a.status, raw: ERR[d.mode] }); assert.ok(nx, 'retry rule'); st = nx.next; }
    });
    const sets = O.imageFieldSets(q); assert.deepEqual(sets['image[]'].map((x: any) => x.name).slice(-1), [d.list.length ? 'image[]' : 'n']); assert.equal(sets.image.filter((x: any) => x.name === 'image').length, d.list.length);
    assert.equal(d.done.result.model, MODELS.imageModel); assert.equal(d.done.result.quality, MODELS.imageQuality); assert.equal(d.done.result.prompt, prompt);
    const usage = { input_tokens: 2400, output_tokens: 6200, input_tokens_details: { text_tokens: 700, image_tokens: 1700 } };   // 가짜 OpenAI 의 답
    assert.equal(O.imageCost(usage, PRICES.image), d.done.result.cost);
    assert.equal((d.done.result.cost || 0) + (f.after.order.cost || 0), d.done.result.total);
    assert.equal(d.done.drawMsg, '');
  });

  if (f.chat) test(`'ChatGPT로 테스트하기' text is the HTML one: ${f.id}`, () => {
    const p = prepare(f);
    const out = O.chatTestText({ manualText: BAE_DEFAULT_MANUAL, fixedText: BAE_DEFAULT_FIXED, rulesKo: f.snap.materials.rulesKo, materials: p.materials, inputs: p.inputs,
      styleMode: p.mode, library: LIB, manualPicks: f.after.manualPicks });
    assert.equal(out.text, f.chat.text);
    // HTML 에서는 이 안내 토스트가 곧바로 '복사했어요' 토스트로 덮인다 (견본에는 마지막 토스트만 남는다)
    assert.equal(f.chat.toast, '복사했어요. ChatGPT 새 채팅에 붙여넣고 이미지를 순서대로 첨부하세요.');
    assert.equal(out.toast, p.inputs.rough.tilt ? 'ChatGPT 테스트에서는 기울기를 돌려 주지 않아요. 수평 그림이 나와요.'
      : p.mode === 'auto' ? "ChatGPT 테스트에서는 '직접 고르기'로 고른 예시만 함께 보내요. 지금은 기준 이미지만 보내요." : null);
  });
}

test('sizes: 7 ratios × 4 tiers × tilts 0, 7, -3.5, 15 are the HTML ones', () => {
  const s = read('sizes.json').sizes; assert.equal(s.length, 112);
  for (const x of s) {
    const tag = x.ratio + ' ' + x.tier + ' ' + x.tilt;
    assert.deepEqual(O.drawSizes(x.ratio, x.tier, x.tilt), x.drawSizes, tag);
    assert.deepEqual(O.currentSize(x.ratio, x.tier), x.currentSize, tag);
    assert.equal(O.effRatio(x.ratio, x.tier, x.tilt), x.effRatio, tag);
    const c = O.sizeChoices(x.ratio, x.tier, x.tilt); assert.deepEqual(c.options, x.options, tag); assert.equal(c.hint, x.hint, tag);
    assert.equal(O.withRatio('Keep it. Aspect ratio 16:9. Aspect ratio 1.5 : 1 too', O.effRatio(x.ratio, x.tier, x.tilt)), x.withRatio, tag);
  }
  assert.deepEqual(s.filter((x: any) => x.tilt === 0).map((x: any) => x.drawSizes.gen.join('x')).length, 28);
  assert.deepEqual(s.find((x: any) => x.ratio === '16:9' && x.tier === 'm' && x.tilt === 7).drawSizes.gen, [2176, 1408]);
});

test('model names come only from the settings book', () => {
  const f = fixtures.find((x) => x.id === 'm5_revise'); const p = prepare(f);
  for (const model of [MODELS.pdModel, 'gpt-test-pd-from-settings']) {
    const req = O.buildPdRequest({ model, manualText: BAE_DEFAULT_MANUAL, fixedText: BAE_DEFAULT_FIXED, rulesKo: '', materials: p.materials, inputs: p.inputs, styleMode: p.mode,
      library: LIB, manualIds: p.manualIds, libThumbs: thumbsOf(f.requests[0].body), revise: p.revise, carry: p.carry, dir: p.dir.ko });
    assert.equal(req.body.model, model); assert.equal(req.retryBody.model, model, 'revision (고치기) uses the same model');
  }
  const fields = O.imageFields({ model: 'gpt-image-from-settings', prompt: 'x', size: [2048, 1152], quality: 'xhigh', stream: false, imageCount: 2 }, 'image[]');
  assert.deepEqual(fields.slice(0, 6).map((x: any) => x.value), ['gpt-image-from-settings', 'x', '2048x1152', 'xhigh', '1', 'png']);
  assert.equal(O.pdCost({ input_tokens: 1e6, output_tokens: 1e6 }, 'gpt-unknown', PRICES.pd), null, 'no price for an unknown model');
  const src = ['pd.ts', 'image.ts', 'finish.ts'].map((n) => readFileSync(new URL('../src/shared/bae/order/' + n, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /gpt-(?:6|image)/, 'no model name in the order code');
});

test('PD answers: refusal, empty and broken answers say so in Korean', () => {
  assert.throws(() => O.readPdResponse({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'm', {}), /PD가 이 요청을 거절했어요: no/);
  assert.throws(() => O.readPdResponse({ output: [] }, 'm', {}), /주문서 형식을 읽지 못했어요/);
  assert.throws(() => O.readPdResponse({ output_text: '{"prompt":""}' }, 'm', {}), /주문서가 비어 있어요/);
  assert.throws(() => O.readPdResponse({ output_text: 'not json' }, 'm', {}), /주문서 형식을 읽지 못했어요/);
  const ok = O.readPdResponse({ output_text: '{"prompt":"p"}', usage: { input_tokens: 1000, output_tokens: 100 } }, 'gpt-6.1-sol', PRICES.pd);
  assert.equal(ok.cost, 1000 / 1e6 * 2 + 100 / 1e6 * 10);
  assert.equal(O.imageCost({ input_tokens: 3000, output_tokens: 10, input_tokens_details: { text_tokens: 1000 } }, PRICES.image), 1000 / 1e6 * 5 + 2000 / 1e6 * 8 + 10 / 1e6 * 30, 'image tokens = input - text');
  assert.equal(O.imageCost(null, PRICES.image), null);
  assert.equal(O.nextImageAttempt({ stream: false, field: 'image', flipped: true }, { status: 400, raw: 'image bad' }), null, 'one flip only');
  assert.equal(O.nextImageAttempt({ stream: true, field: 'image[]', flipped: false }, { status: 500, raw: 'stream' }), null, 'only 400 is retried');
});
