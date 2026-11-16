import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAE_PART_MAX, baeNormBox, baeHitPart, baeBoxBigEnough, baePartsKey, baePartCount, baeSwatchRemove, baeSwatchPick, baeAverageHex,
  baeStyleRowForBases, baeLockNext, baeNoiseNext, baeLockText, baeNoiseText, baeLockToast,
  baeDataUrlBytes, baeBytesDataUrl, baeBasesToDraft, baeBasesFromDraft, baeEmptySwatches,
} from '../src/features/bae-gyeong/state/baeBases.ts';

// BAE경 3단계 화면 쪽 규칙 (HTML v0.4.11 Parts · syncLockRow · syncNoiseBtn · lockSw · 초안의 bases). DOM 없이.

test('parts: a drag becomes a box either way round, a press finds the top box, tiny boxes are dropped', () => {
  assert.deepEqual(baeNormBox({ u0: 0.8, v0: 0.6, u1: 0.2, v1: 0.1 }), { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.6 });
  const parts = [{ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }];
  assert.equal(baeHitPart(parts, { u: 0.3, v: 0.3 }), 1, 'the one drawn last is on top');
  assert.equal(baeHitPart(parts, { u: 0.1, v: 0.1 }), 0);
  assert.equal(baeHitPart(parts, { u: 0.9, v: 0.9 }), -1);
  assert.equal(baeBoxBigEnough({ x0: 0, y0: 0, x1: 0.01, y1: 0.5 }, 800, 600), false, 'under 10 canvas pixels wide');
  assert.equal(baeBoxBigEnough({ x0: 0, y0: 0, x1: 0.02, y1: 0.5 }, 800, 600), true);
  assert.equal(BAE_PART_MAX, 16);
  assert.equal(baePartsKey(parts), '[[0,0,0.5,0.5],[0.25,0.25,0.75,0.75]]', 'names do not change the key');
  assert.equal(baePartCount([{ parts }, { parts: [] }, { parts: [parts[0]] }]), 3);
});

test('swatches: × takes an added color out, or turns an engine color off; the dropper adds (and turns back on)', () => {
  const sw = { auto: ['#AABBCC', '#112233'], off: [], add: ['#FFEEDD'] };
  assert.deepEqual(baeSwatchRemove(sw, '#FFEEDD'), { ...sw, add: [] });
  assert.deepEqual(baeSwatchRemove(sw, '#AABBCC'), { ...sw, off: ['#AABBCC'] });
  assert.deepEqual(baeSwatchRemove(baeSwatchRemove(sw, '#AABBCC'), '#AABBCC').off, ['#AABBCC'], 'once only');
  assert.deepEqual(baeSwatchPick({ ...sw, off: ['#AABBCC'] }, '#AABBCC'), { auto: sw.auto, off: [], add: ['#FFEEDD', '#AABBCC'] });
  assert.deepEqual(baeSwatchPick(sw, '#FFEEDD').add, ['#FFEEDD']);
  assert.deepEqual(baeEmptySwatches(), { auto: null, off: [], add: [] });
  // HTML pickAt: 5×5 평균, 대문자
  const px = new Uint8ClampedArray(25 * 4); for (let i = 0; i < 25; i++) px.set(i < 12 ? [10, 20, 255, 255] : [12, 22, 250, 255], i * 4);
  assert.equal(baeAverageHex(px), '#0B15FC');
});

test('result tools follow the HTML: the lock switch keeps denoise on, denoise toggles, the words match', () => {
  assert.deepEqual(baeLockNext({ alt: false, noise: true }), { alt: true, noise: true });
  assert.deepEqual(baeNoiseNext({ alt: true, noise: false }), { alt: true, noise: true });
  assert.deepEqual(baeLockText(true, 3), { label: '색 맞춤 켬', title: '넓은 면 3곳(벽·바닥·소파 같은)을 기준 배경 색에 맞췄어요. 끄면 GPT가 그린 색 그대로예요' });
  assert.equal(baeLockText(false, 3).title, 'GPT가 그린 색 그대로예요. 켜면 넓은 면 3곳을 기준 배경 색에 맞춰요');
  assert.equal(baeNoiseText(true, 4).label, '노이즈 제거됨');
  assert.match(baeNoiseText(true, 4).title, /\(4초\)/);
  assert.equal(baeNoiseText(false, null).label, '노이즈 제거');
  assert.equal(baeLockToast(true, false), '색 맞춤한 그림이에요');
  assert.equal(baeLockToast(false, true), 'GPT가 그린 색 그대로예요 · 노이즈 제거도 다시 했어요');
  assert.equal(baeStyleRowForBases(2), '기준 배경 2장이 기준이에요');
});

test('the draft keeps base backgrounds as picture files plus their notes, parts and swatches', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7]);
  const src1 = baeBytesDataUrl(png, 'png'); const src2 = baeBytesDataUrl(jpg, 'jpg');
  assert.match(src1, /^data:image\/png;base64,/); assert.match(src2, /^data:image\/jpeg;base64,/);
  assert.deepEqual([...baeDataUrlBytes(src1)!.bytes], [...png]);
  assert.equal(baeDataUrlBytes('blob:abc'), null);
  const bases = [
    { id: 11, src: src1, w: 1536, h: 1024, note: '소파 쪽', parts: [{ x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.6, name: '소파' }], sw: { auto: ['#AABBCC'], off: ['#AABBCC'], add: ['#102030'] } },
    { id: 12, src: src2, w: 800, h: 600, note: 'TV 쪽', parts: [], sw: { auto: null, off: [], add: [] } },
  ];
  const d = baeBasesToDraft(bases);
  assert.deepEqual(Object.keys(d.images), ['base_1.png', 'base_2.jpg'], 'the names the PC store accepts');
  assert.deepEqual(d.list.map((x) => x.file), ['base_1.png', 'base_2.jpg']);
  assert.ok(!JSON.stringify(d.list).includes('base64'), 'the pictures are not in the text');
  const back = baeBasesFromDraft(JSON.parse(JSON.stringify(d.list)), d.images);
  assert.deepEqual(back, bases);
  // 모양이 틀린 것 · 없는 그림 · 이상한 부품은 버린다
  const bad = baeBasesFromDraft([{ file: '../x.png' }, d.list[0], { file: 'base_2.jpg', id: 1, note: 1, parts: [{ x0: 0.5, y0: 0, x1: 0.2, y1: 1 }], sw: { auto: ['red'] } }], d.images);
  assert.equal(bad.length, 2, 'a path that is not ours is dropped');
  assert.deepEqual(bad[1].parts, [], 'a box that is inside out is dropped');
  assert.deepEqual(bad[1].sw, { auto: [], off: [], add: [] }, 'colors that are not #RRGGBB are dropped');
  assert.equal(bad[1].note, '');
});
