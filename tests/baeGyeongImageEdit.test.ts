import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BAE_IMG_OPS_MAX, baeImgBrushSize, baeImgCropOp, baeImgCropRect, baeImgOpsLine, baeImgOpsSize, baeImgPush, baeImgShapeChanged, baeImgUndo, type BaeImgOp,
} from '../src/shared/bae/imageEdit.ts';

// 2026-11-27 한솔 '재료 창의 이미지를 누르면 이미지 수정 창이 뜰 수 있게': 레퍼런스 · 기준 배경을 자르기 · 돌리기 · 뒤집기 · 칠하기로 고친다.
const src = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('size follows the ops in order: rotate swaps, crop keeps the box, flip and paint keep the size', () => {
  const crop: BaeImgOp = { t: 'crop', x0: 0.25, y0: 0, x1: 0.75, y1: 0.5 };
  assert.deepEqual(baeImgOpsSize(1600, 900, []), [1600, 900]);
  assert.deepEqual(baeImgOpsSize(1600, 900, [{ t: 'rot', d: 1 }]), [900, 1600]);
  assert.deepEqual(baeImgOpsSize(1600, 900, [crop]), [800, 450]);
  assert.deepEqual(baeImgOpsSize(1600, 900, [{ t: 'rot', d: -1 }, crop]), [450, 800]);   // 돌린 뒤의 가로 · 세로로 자른다
  assert.deepEqual(baeImgOpsSize(1600, 900, [{ t: 'flip' }, { t: 'paint', color: '#fff', size: 0.02, pts: [0.1, 0.1, 0.2, 0.2] }]), [1600, 900]);
});

test('crop box: reversed drags work, tiny or whole-picture boxes are not a crop, pixels stay inside', () => {
  assert.deepEqual(baeImgCropOp({ u0: 0.8, v0: 0.9, u1: 0.2, v1: 0.1 }, 1000, 1000), { t: 'crop', x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.9 });
  assert.equal(baeImgCropOp({ u0: 0.5, v0: 0.5, u1: 0.505, v1: 0.9 }, 1000, 1000), null);       // 가로 5px
  assert.equal(baeImgCropOp({ u0: 0, v0: 0, u1: 1, v1: 1 }, 1000, 1000), null);                 // 그림 전체
  assert.equal(baeImgCropOp({ u0: -0.5, v0: -1, u1: 2, v1: 3 }, 1000, 1000), null);             // 밖으로 끌어도 전체
  const r = baeImgCropRect(101, 57, { x0: 0.99, y0: 0.99, x1: 1, y1: 1 });
  assert.ok(r.sx + r.sw <= 101 && r.sy + r.sh <= 57 && r.sw >= 1 && r.sh >= 1);
});

test('undo drops the last op only; shape change is anything but paint; the list cannot grow forever', () => {
  const paint: BaeImgOp = { t: 'paint', color: '#000', size: 0.01, pts: [0.5, 0.5, 0.5, 0.5] };
  const ops: BaeImgOp[] = [{ t: 'rot', d: 1 }, paint];
  assert.deepEqual(baeImgUndo(ops), [{ t: 'rot', d: 1 }]);
  assert.deepEqual(baeImgUndo([]), []);
  assert.equal(baeImgShapeChanged([paint, paint]), false);
  assert.equal(baeImgShapeChanged([paint, { t: 'flip' }]), true);
  assert.deepEqual(baeImgPush([], { t: 'paint', color: '#000', size: 0.01, pts: [0.5] }), []);   // 점이 없는 칠하기는 버린다
  const full = Array.from({ length: BAE_IMG_OPS_MAX }, () => paint);
  assert.equal(baeImgPush(full, { t: 'flip' }).length, BAE_IMG_OPS_MAX);
  assert.equal(baeImgOpsLine([{ t: 'crop', x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, { t: 'rot', d: 1 }, { t: 'rot', d: -1 }, paint]), '자르기 1 · 돌리기 2 · 칠하기 1획');
  assert.equal(baeImgOpsLine([]), '');
  // 화면 붓 굵기 → 그림 긴 변 비율 (화면 1000px 에서 50px = 0.05)
  assert.equal(baeImgBrushSize(50, 1000), 0.05);
});

test('painting after a rotate or flip lands where the hand drew (no leftover canvas transform)', () => {
  // 앱 엔진 확인에서 실제로 걸림: 돌린 뒤 가로로 그은 획이 세로로 칠해졌다 (돌리기가 남긴 좌표 변환 위에 칠함)
  const c = src('src/features/bae-gyeong/make/imageEdit.ts');
  const paint = c.slice(c.indexOf('export function baeImgPaint'), c.indexOf('export function baeImgApply'));
  assert.match(paint, /x\.save\(\); x\.setTransform\(1, 0, 0, 1, 0, 0\);/);
  const apply = c.slice(c.indexOf('export function baeImgApply'), c.indexOf('export function baeImgRender'));
  assert.match(apply, /x\.save\(\); x\.translate\(op\.d === 1 \? H : 0, op\.d === 1 \? 0 : W\); x\.rotate\(op\.d \* Math\.PI \/ 2\); x\.drawImage\(c, 0, 0\); x\.restore\(\);/);
  assert.match(apply, /x\.save\(\); x\.translate\(W, 0\); x\.scale\(-1, 1\); x\.drawImage\(c, 0, 0\); x\.restore\(\);/);
});

test('material window pictures open the edit window; an edited picture gets a new number', () => {
  const mw = src('src/features/bae-gyeong/windows/MaterialWindow.tsx');
  assert.match(mw, /onClick=\{\(\) => p\.onEditRef\(r\.id\)\}/);
  assert.match(mw, /onClick=\{\(\) => p\.onEditBase\(b\.id\)\}/);
  const vm = src('src/features/bae-gyeong/state/baeViewModel.ts');
  assert.match(vm, /onEditRef: \(id\) => s\.openImgEdit\('ref', Number\(id\)\)/);
  assert.match(vm, /onEditBase: \(id\) => s\.openImgEdit\('base', Number\(id\)\)/);
  const layer = src('src/features/bae-gyeong/state/BaeMakeLayer.tsx');
  assert.match(layer, /<ImageEditWindow [^>]*onApply=\{s\.applyImgEdit\} onClose=\{s\.backFromImgEdit\}/);
  // 고치던 그림이 빠지면 빈 화면이 아니라 재료 창
  assert.match(layer, /s\.win === 'material' \|\| s\.win === 'imgedit'/);
  const mk = src('src/features/bae-gyeong/state/useBaeMake.ts');
  const apply = mk.slice(mk.indexOf('applyImgEdit: async'), mk.indexOf('openSame: async'));
  // 만들어 둔 재료는 그림 번호로 다시 쓰므로 (inputsKey · baePlaceKey), 고친 그림은 새 번호여야 옛 그림이 가지 않는다
  assert.match(apply, /const id = \+\+refSeq \+ Date\.now\(\)/);
  assert.match(apply, /id: \+\+baseSeq \+ Date\.now\(\)/);
  assert.match(apply, /parts: shapeChanged \? \[\] : old\.parts/);
  assert.match(apply, /autoSwatches\(nb\.id\); baseChanged\(\)/);
  assert.match(apply, /markStale\(\)/);
});
