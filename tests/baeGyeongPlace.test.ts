import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BAE_DEFAULT_MANUAL, BAE_DEFAULT_FIXED } from '../electron/bae/defaultTexts.ts';
import { BAE_SETTING_DEFAULTS } from '../src/shared/bae/settings.ts';
import { baeActiveLibrary } from '../src/shared/bae/library.ts';

// BAE경 '같은 장소'(기준 배경) 재료가 HTML v0.4.11 과 같은지. 견본은 C:\BAE_stage0\place_port\capture_place.mjs 가 HTML(꺼낸 소스로 다시 짠 것)을
// 앱과 같은 엔진(Electron 33, 화면 밖 창)에 띄우고 127.0.0.1 가짜 OpenAI 로 받은 것 (tests/fixtures/bae/order/place_cases).
// 그림(부품 시트 · 기준 배경 PNG, PD 용 JPEG)은 같은 엔진에서 Bflow 코드로 다시 만들어 픽셀로 견준 결과(compare_place.mjs → electron_compare.json)를 여기서 확인한다.
const bundle = async (entry: string) => {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64'));
};
const O: any = await bundle('src/shared/bae/order/index.ts');
const PL: any = await bundle('src/shared/bae/place/index.ts');

const FIX = new URL('./fixtures/bae/order/place_cases/', import.meta.url);
const OLD_IMG = new URL('./fixtures/bae/order/img/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, FIX), 'utf8'));
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png' };
const imgCache = new Map<string, string>();
function dataUrl(ref: string) {
  const name = ref.slice(4); let u = imgCache.get(name);
  if (!u) {
    const mine = new URL('img/' + name, FIX); const buf = readFileSync(existsSync(mine) ? mine : new URL(name, OLD_IMG));
    assert.equal(createHash('sha256').update(buf).digest('hex').slice(0, 16), name.split('.')[0], 'img file name = its sha256');
    u = 'data:' + MIME[name.split('.')[1]] + ';base64,' + buf.toString('base64'); imgCache.set(name, u);
  }
  return u;
}
function resolve(v: any): any {
  if (typeof v === 'string') return v.startsWith('img:') ? dataUrl(v) : v.startsWith('@@MANUAL@@') ? BAE_DEFAULT_MANUAL + v.slice(10) : v;
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = resolve(v[k]); return o; }
  return v;
}

const files = readdirSync(FIX).filter((f) => /^place_.*\.json$/.test(f)).sort();
const fixtures = files.map((f) => resolve(read(f)));
const CMP = read('electron_compare.json');
const PRICES = BAE_SETTING_DEFAULTS.prices;
const MODELS = BAE_SETTING_DEFAULTS.models;
const LIB = baeActiveLibrary([], []);
const LOCK_NOTE = '색 맞춤: 기준 배경과 같은 넓은 면을 찾지 못해서 GPT가 그린 색 그대로 뒀어요.';   // 가짜 그림(64×36 단색)에 색 맞춤을 한 HTML 의 안내

/** 견본의 기준 배경 → Bflow BaePlaceBase (엔진은 sw.auto 를 '#rrggbb' 글로 준다: HTML 의 [r,g,b] 를 일부러 소문자 글로 바꿔 넣는다). */
function basesOf(f: any) {
  return f.snap.place.bases.map((b: any) => ({ id: b.id, src: 'data:,', w: b.w, h: b.h, note: b.note, parts: b.parts.map((p: any) => ({ ...p })),
    sw: { auto: b.sw.autoRgb.map((c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')), off: b.sw.off.slice(), add: b.sw.add.slice() } }));
}
/** 같은 장소 재료 (Bflow 규칙으로 만든 것; 그림 데이터 주소만 견본의 것 — 그림이 같은지는 electron_compare.json). */
function placeOf(f: any) {
  const bases = basesOf(f); const mode = PL.baePlaceMode(bases); if (!mode) return null;
  const b = f.snap.board; const notes = PL.baePlaceItemNotes(mode, bases);
  return { mode, n: PL.baePlaceCount(bases), painted: PL.baeRoughPainted({ guide: b.isGuide, photoLike: b.photoLike, paintShare: b.paintShare }),
    items: f.snap.inputs.place.items.map((it: any, i: number) => ({ small: it.small, note: notes[i] })), bases: PL.baePlaceOrderBases(bases) };
}
function materialsOf(f: any) {
  const m = f.snap.materials;
  return { ratio: m.ratio, tier: m.tier, tilt: m.tilt, time: m.time, times: O.timeList(m.timeUser), place: m.place, persp: m.persp, guide: m.guide, calib: m.calib, request: m.request };
}
function inputsOf(f: any) {
  const i = f.snap.inputs, r = i.rough;
  return { rough: { kind: r.kind, small: r.small, annotated: r.annotated, notesText: r.notesText, hasColor: r.hasColor, tilt: r.tilt, noteCount: r.noteCount, key: O.hashStr(r.small), painted: r.painted },
    refs: i.refs.map((x: any) => ({ small: x.small, note: x.note })), base: { small: i.base.small }, refIds: i.refIds, place: placeOf(f) };
}
function prepare(f: any) {
  const materials = materialsOf(f), inputs = inputsOf(f); const isRev = typeof f.call.revText === 'string';
  const prev = f.snap.prevOrder; const mode = f.snap.materials.styleMode; const manualIds = f.snap.materials.manualPicks;
  const revise = isRev ? O.reviseInput(f.call.revText, f.snap.promptBefore, prev, BAE_DEFAULT_FIXED, null) : null;
  const carry = (!isRev && f.snap.carryChecked ? O.carryList(prev, inputs.rough.key) : []).concat(f.call.carryExtra);
  const dir = O.dirFor(isRev ? f.call.revText : null, carry, materials.request, prev);
  return { materials, inputs, isRev, prev, mode, manualIds, revise, carry, dir };
}
const fit = (w: number, h: number, max: number) => { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };
const boardSize = (r: string) => { const [a, b] = r.split(':').map(Number); return a >= b ? [1536, Math.round(1536 * b / a)] : [Math.round(1536 * a / b), 1536]; };

test('place fixtures: HTML v0.4.11 in Electron 33, all asked cases, no key-like text, under 1.5MB', () => {
  const html = read('html.json');
  assert.equal(html.ver, O.BAE_HTML_VER); assert.equal(html.manual, O.MANUAL_TAG); assert.equal(html.engine.electron.split('.')[0], '33');
  assert.deepEqual(html.control.ctl_m1_basic, { requestsSame: true, afterSame: true, instructionsSame: true, userTextSame: true }, 'the rebuilt HTML sends the stage-2 m1_basic request letter for letter');
  let total = 0;
  const walk = (dir: URL) => { for (const n of readdirSync(dir)) { const u = new URL(n, dir); const s = statSync(u); if (s.isDirectory()) walk(new URL(n + '/', dir)); else {
    total += s.size; if (!/\.json$/.test(n)) continue; const t = readFileSync(u, 'utf8');
    assert.doesNotMatch(t, /\bsk-[A-Za-z0-9_\-]{4,}/, n + ': key-like text'); assert.doesNotMatch(t, /Bearer|Authorization|sk-test-local-only/i, n);
  } } };
  walk(FIX); assert.ok(total < 1.5 * 1024 * 1024, 'place fixtures ' + total + ' bytes');
  const ids = fixtures.map((f) => f.id);
  for (const id of ['place_a_base1', 'place_b_base3', 'place_c_sheet', 'place_d_painted', 'place_d2_painted_sheet', 'place_e_tilt7', 'place_e_tilt_m12', 'place_f_sheet_refs', 'place_g_revise']) assert.ok(ids.includes(id), id);
  const modes = new Set(fixtures.map((f) => f.snap.place.mode + (f.snap.inputs.rough.painted ? '+painted' : '') + (f.snap.inputs.rough.tilt ? '+tilt' : '')));
  for (const m of ['base', 'sheet', 'base+painted', 'sheet+painted', 'base+tilt', 'sheet+tilt']) assert.ok(modes.has(m), m);
});

for (const f of fixtures) {
  test(`place values and screen rules are the HTML ones: ${f.id}`, () => {
    const P = f.snap.place; const bases = basesOf(f);
    assert.equal(PL.baePlaceMode(bases), P.mode); assert.equal(PL.baePlaceCount(bases), P.count);
    assert.equal(PL.baePlaceKey(bases), P.key, 'placeKey (lower-case hex from the engine reads like the HTML)');
    assert.deepEqual(PL.baePlaceSheetSwatches(bases), P.sheetSwatches);
    assert.deepEqual(bases.map(PL.baePlaceBaseSwatches), P.baseSwatches);
    assert.deepEqual(P.bases.map((b: any) => b.sw.autoRgb.map(PL.baePlaceSwHex)), P.bases.map((b: any) => b.sw.auto), 'swHex of [r,g,b] = HTML swHex');
    const v = PL.baeBaseFieldView(bases);
    assert.equal(v.hint, P.ui.baseHint); assert.equal(v.partsButton, P.ui.btnParts); assert.equal(v.rowHidden, P.ui.baseRowHidden);
    const st = PL.baeStyleForPlace(P.mode, P.ui.styleMode);
    assert.deepEqual([st.styleModeHidden, st.libPickHidden, st.hint], [P.ui.styleModeHidden, P.ui.libPickHidden, P.ui.styleHint]);
    assert.deepEqual(P.currentPickIds, []); assert.deepEqual(O.currentPickIds(P.mode, f.snap.materials.styleMode, f.snap.materials.manualPicks, f.snap.prevOrder, LIB), []);
    // 같은 장소 그림: 몇 장 · 이름 · 메모 · 크기 · '칠한 러프'
    const want = f.snap.inputs.place; const notes = PL.baePlaceItemNotes(P.mode, bases);
    assert.equal(want.mode, P.mode); assert.equal(want.n, want.items.length); assert.equal(want.n, P.count);
    want.items.forEach((it: any, i: number) => {
      assert.equal(it.kind, P.mode === 'sheet' ? 'sheet' : 'basebg'); assert.equal(it.label, PL.BAE_PLACE_LABEL[it.kind]); assert.equal(it.note, notes[i]);
      assert.deepEqual([it.w, it.h], P.mode === 'sheet' ? [PL.BAE_SHEET.W, PL.BAE_SHEET.H] : fit(bases[i].w, bases[i].h, PL.BAE_BASE_SEND_SIDE));
    });
    const b = f.snap.board;
    assert.equal(PL.baeRoughPainted({ guide: b.isGuide, photoLike: b.photoLike, paintShare: b.paintShare }), f.snap.inputs.rough.painted, 'painted = !guide && !photoLike && paintShare > 0.25');
    assert.equal(want.painted, f.snap.inputs.rough.painted, 'place.painted = rough.painted');
    // 주문서를 만든 뒤: 그대로면 맞고, 기준 배경 방식이나 장 수가 바뀌면 HTML 의 그 안내
    assert.equal(f.after.place.misfit, ''); assert.equal(PL.baePlaceMisfits(f.after.order.place, bases), false);
    assert.equal(PL.baePlaceMisfits(f.after.order.place, bases.map((x: any) => ({ ...x, note: x.note + '!' }))), false, 'notes only: still fits');
    assert.equal(PL.baePlaceMisfits(f.after.order.place, P.mode === 'sheet' ? bases.map((x: any) => ({ ...x, parts: [] })) : bases.slice(1)), true);
    assert.equal(PL.baePlaceMisfits(f.after.order.place, []), true); assert.equal(PL.baePlaceMisfits(null, bases), true); assert.equal(PL.baePlaceMisfits(null, []), false);
    assert.match(PL.BAE_PLACE_MISFIT, /^기준 배경이 바뀌어서/);
  });

  test(`PD request body is the HTML one: ${f.id}`, () => {
    const p = prepare(f); const misc = f.snap.misc;
    assert.equal(p.inputs.rough.key, f.snap.inputs.rough.key, 'rough.key = hashStr(rough.small)');
    assert.deepEqual(O.carryList(p.prev, p.inputs.rough.key), misc.carryList);
    assert.deepEqual(O.orderPhrases(p.inputs, p.mode, LIB.length), misc.orderPhrases);
    assert.equal(p.prev ? O.mappingText(p.prev) : null, misc.mapping);
    assert.equal(O.effRatio(p.materials.ratio, p.materials.tier, p.materials.tilt), misc.effRatio);
    assert.deepEqual(O.drawSizes(p.materials.ratio, p.materials.tier, p.materials.tilt), misc.drawSizes);
    const req = O.buildPdRequest({ model: MODELS.pdModel, manualText: BAE_DEFAULT_MANUAL, fixedText: BAE_DEFAULT_FIXED, rulesKo: f.snap.materials.rulesKo,
      materials: p.materials, inputs: p.inputs, styleMode: p.mode, library: LIB, manualIds: p.manualIds, libThumbs: {}, revise: p.revise, carry: p.carry, dir: p.dir.ko });
    assert.equal(f.requests.length, 1); const first = f.requests[0].body;
    assert.equal(JSON.stringify(req.body), JSON.stringify(first), 'same JSON, same key order');
    assert.deepStrictEqual(req.body, first);
    assert.equal(req.retryBody === null, p.dir.ko.length === 0);
    // 그림 번호: 러프 다음에 같은 장소 그림, 그다음 레퍼런스
    const texts = first.input[first.input.length - 1].content.filter((c: any) => c.type === 'input_text').map((c: any) => c.text);
    if (p.inputs.place.mode === 'sheet') assert.ok(texts.includes('Image 2 (model sheet):'));
    else p.inputs.place.items.forEach((_: any, i: number) => assert.ok(texts.includes('Image ' + (i + 2) + ' (base background ' + (i + 1) + '):')));
    p.inputs.refs.forEach((_: any, i: number) => assert.ok(texts.includes('Image ' + (p.inputs.place.n + i + 2) + ':')));
    assert.ok(!texts.some((t: string) => t.startsWith('Style library ')), 'no style examples with a place');
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
    assert.equal(O.samePlaceSentence(p.inputs.place).length > 0 && out.promptText.includes(O.samePlaceSentence(p.inputs.place)), true, 'the [SAME PLACE] sentence is in the prompt');
  });

  if (f.draw) test(`image request (order, sizes, fields) is the HTML one: ${f.id}`, () => {
    const p = prepare(f); const d = f.draw; const pl = p.inputs.place; const bases = basesOf(f);
    const z = O.drawSizes(p.materials.ratio, p.materials.tier, p.materials.tilt); const size = z.gen;
    const prompt = O.drawPrompt(f.after.promptText, p.materials.ratio, p.materials.tier, p.materials.tilt);
    const q = { model: MODELS.imageModel, prompt, size, quality: MODELS.imageQuality, stream: true, imageCount: d.list.length };
    // 순서: 러프, 같은 장소 그림, 레퍼런스, (예시 없음), 그림체 띠
    const kind = pl.mode === 'sheet' ? 'sheet' : 'basebg';
    assert.deepEqual(d.list.map((l: any) => l.kind), O.finalList({ rough: p.inputs.rough.kind, place: { items: pl.items.map(() => kind) }, refs: p.inputs.refs.map(() => 'ref'), base: 'style' }, []));
    assert.deepEqual(f.after.order.picks, []);
    // 크기: 러프 = 그림판(기울기면 수평으로 돌린 큰 종이), 기준 배경 = 긴 변 1536, 부품 시트 = 2048×1152
    const k = 1536 / Math.max(z.gen[0], z.gen[1]);
    const roughSize = z.tilt ? [Math.round(z.gen[0] * k), Math.round(z.gen[1] * k)] : boardSize(p.materials.ratio);
    const sizes = [roughSize, ...pl.items.map((_: any, i: number) => (pl.mode === 'sheet' ? [2048, 1152] : fit(bases[i].w, bases[i].h, 1536))), ...f.snap.inputs.refs.map((r: any) => [r.w, r.h]), [f.snap.inputs.base.w, f.snap.inputs.base.h]];
    assert.equal(d.attempts.length, 1);
    const files = d.attempts[0].fields.filter((x: any) => x.filename);
    assert.deepEqual(files.map((x: any) => [x.width, x.height]), sizes);
    assert.deepEqual(d.list.map((l: any) => [l.w, l.h]), sizes);
    for (const x of files) assert.equal(x.format, 'png');
    assert.deepEqual(files.map((x: any) => x.sha256), d.list.map((l: any) => l.sha256), 'image i = finalList[i]');
    pl.items.forEach((it: any, i: number) => { assert.equal(d.list[1 + i].note, it.note); assert.equal(d.list[1 + i].label, PL.BAE_PLACE_LABEL[kind]); });
    const want = d.attempts[0].fields.map((x: any) => x.filename ? { name: x.name, filename: x.filename, type: x.type } : { name: x.name, value: x.value });
    const got = O.imageFields(q, 'image[]').map((x: any) => 'file' in x ? { name: x.name, filename: x.filename, type: x.type } : { name: x.name, value: O.multipartTextValue(x.value) });
    assert.deepStrictEqual(got, want);
    assert.equal(d.done.result.prompt, prompt); assert.deepEqual(d.done.result.gen, z.tilt ? z.gen : null); assert.equal(d.done.result.tilt, z.tilt);
    assert.equal(d.done.drawMsg, LOCK_NOTE);
    // 같은 엔진에서 Bflow 가 만든 PNG 가 HTML 이 보낸 PNG 와 픽셀까지 같다 (compare_place.mjs)
    const c = CMP.cases[f.id]; assert.ok(c, 'electron compare has ' + f.id);
    d.list.forEach((l: any, i: number) => {
      const r = c.images.find((x: any) => x.what.startsWith('list[' + i + '] ')); assert.ok(r, 'list[' + i + '] compared');
      assert.equal(r.htmlSha16, l.sha256.slice(0, 16), 'compared against the very PNG the HTML sent'); assert.equal(r.max, 0); assert.equal(r.sameBytes, true);
      assert.deepEqual(r.size, [l.w + 'x' + l.h, l.w + 'x' + l.h]);
    });
  });

  if (f.chat) test(`'ChatGPT로 테스트하기' text is the HTML one: ${f.id}`, () => {
    const p = prepare(f);
    const out = O.chatTestText({ manualText: BAE_DEFAULT_MANUAL, fixedText: BAE_DEFAULT_FIXED, rulesKo: f.snap.materials.rulesKo, materials: p.materials, inputs: p.inputs,
      styleMode: p.mode, library: LIB, manualPicks: f.after.manualPicks });
    assert.equal(out.text, f.chat.text);
    assert.equal(out.toast, p.inputs.rough.tilt ? 'ChatGPT 테스트에서는 기울기를 돌려 주지 않아요. 수평 그림이 나와요.' : null);
  });
}

test('parts sheet and place pictures: Bflow = HTML by pixels in Electron 33 (compare_place.mjs)', () => {
  assert.equal(CMP.engine.electron.split('.')[0], '33'); assert.equal(CMP.engine.mode, 'gpu');
  const s = CMP.summary; assert.equal(s.cases, fixtures.length); assert.equal(s.sizeErrors, 0); assert.equal(s.checksFailed, 0); assert.ok(s.checks >= 200);
  assert.equal(s.samePixels, s.images); assert.equal(s.worstMax, 0); assert.ok(s.sheetImages >= 16); assert.equal(s.sheetSamePixels, s.sheetImages);
  for (const f of fixtures) {
    const c = CMP.cases[f.id]; assert.ok(c, f.id); assert.ok(c.checks.every((x: any) => x[0] === 'ok'), f.id);
    f.snap.inputs.place.items.forEach((it: any, i: number) => {
      const png = c.images.find((x: any) => x.what === 'place[' + i + '] ' + it.kind + ' png (pixels)'); assert.ok(png, f.id + ' place[' + i + '] png');
      assert.equal(png.max, 0); assert.deepEqual(png.size, [it.w + 'x' + it.h, it.w + 'x' + it.h]);
      const small = c.images.find((x: any) => x.what === 'place[' + i + '] ' + it.kind + ' small'); assert.ok(small, f.id + ' place[' + i + '] small');
      const ref = read(f.id + '.json').snap.inputs.place.items[i].small;   // 'img:<sha256 앞 16자>.jpg'
      assert.equal(small.htmlSha16, ref.slice(4, 20), 'compared against the very JPEG the HTML gave the PD'); assert.equal(small.max, 0); assert.equal(small.sameBytes, true);
    });
    if (f.snap.place.mode === 'sheet') assert.equal(c.images.find((x: any) => x.what.startsWith('sheet preview')).max, 0, f.id + ' sheet preview');
    assert.ok(c.checks.some((x: any) => /^paintShare/.test(x[1])), f.id + ' paintShare re-measured by Bflow');
  }
  // 기준 배경이 없으면 새 inputs.ts 의 그림 · 열쇠 · PD 재료가 2단계(git HEAD) inputs.ts 와 바이트까지 같다
  assert.ok(CMP.regression.checks.length >= 9 && CMP.regression.checks.every((x: any) => x[0] === 'ok'));
});

test('parts sheet layout (pure): parts boxed in rows, swatches in two rows, all on the 2048x1152 sheet', () => {
  for (const f of fixtures.filter((x) => x.snap.place.mode === 'sheet')) {
    const bases = basesOf(f); const items = bases.flatMap((b: any) => b.parts.map((p: any) => PL.baePartCrop(b.w, b.h, p)));
    const sw = PL.baePlaceSheetSwatches(bases); const L = PL.baeSheetLayout(items, sw.length); const S = PL.BAE_SHEET;
    assert.ok(L, f.id); assert.equal(L.boxes.length, items.length); assert.equal(L.swatches.length, sw.length); assert.ok(sw.length <= 8);
    const h = L.boxes[0][3];
    L.boxes.forEach(([x, y, w, bh]: number[], i: number) => {
      assert.equal(bh, h); assert.equal(w, Math.max(8, Math.round(items[i].w * h / items[i].h)));
      assert.ok(x >= S.M && y >= S.M && x + w <= S.W - S.M && y + bh <= S.H - S.M, f.id + ' box ' + i);
    });
    L.swatches.forEach(([x, y]: number[]) => assert.ok(x >= S.M && y >= S.M && x + L.s <= S.W - S.M && y + L.s <= S.H - S.M));
    assert.equal(L.s, Math.max(24, Math.min(150, Math.floor((h - 14) / 2))));
  }
  assert.equal(PL.baeSheetLayout([{ w: 100, h: 10000 }], 0).boxes[0][3], 460, 'a tall part still fits at 460');
  assert.equal(PL.baeSheetLayout([{ w: 100000, h: 10 }], 2), null, 'a part too wide for any height: no sheet');
  const many = PL.baeSheetLayout(Array.from({ length: 16 }, () => ({ w: 1000, h: 1000 })), 8); assert.ok(many && many.boxes[0][3] < 460, 'sixteen parts shrink the row height');
});

test('place colors for the drawing board and the record are the HTML rules', () => {
  const f = fixtures.find((x) => x.id === 'place_f_sheet_refs'); const bases = basesOf(f);
  const cols: Record<string, string[]> = {}; for (const b of bases) for (const p of b.parts) cols[PL.baePartColorKey(b, p)] = ['#8E3B2F', '#123456'];
  const list = PL.baePlaceColors(bases, (k: string) => cols[k]);
  assert.deepEqual(list.slice(0, PL.baePlaceSheetSwatches(bases).length).map((x: any) => x.hex), PL.baePlaceSheetSwatches(bases));
  assert.ok(list.every((x: any, i: number) => list.findIndex((y: any) => PL.baePlaceNearHex(x.hex, y.hex)) === i), 'no two near colors');
  assert.ok(list.length <= 21); assert.equal(list.find((x: any) => x.hex === '#123456').name, '소파');
  assert.equal(PL.baePartColorKey({ id: 3 }, { x0: 0.1234, y0: 0, x1: 1, y1: 0.5 }), '3:123,0,1000,500');
  assert.deepEqual(PL.baeAutoSwatchOpts({ parts: [{ x0: 0, y0: 0.1, x1: 0.5, y1: 1, name: '' }] }), { skip: [[0, 0.1, 0.5, 1]], top: 6 });
  assert.deepEqual(PL.baePlaceRecord({ mode: 'sheet', n: 1, painted: false }, bases), { mode: 'sheet', n: 1, painted: false, notes: ['창문 쪽', '소파 쪽', 'TV 쪽 '], parts: 4 });
  assert.equal(PL.baePlaceRecord(null, bases), null);
  assert.equal(PL.baePlaceSwHex('#8e3b2f'), '#8E3B2F'); assert.equal(PL.baePlaceSwHex([142, 59, 47]), '#8E3B2F');
  assert.equal(PL.baePlaceNearHex('#000000', '#030303'), true); assert.equal(PL.baePlaceNearHex('#000000', '#040303'), false);
  assert.deepEqual(PL.baePlaceBaseSwatches({ sw: { auto: null, off: ['#111111'], add: ['#111111', '#222222'] } }), ['#222222']);
  assert.equal(PL.baePlaceKey([]), '|[]');
});
