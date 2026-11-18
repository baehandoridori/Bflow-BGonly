import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IV_FIT_PAD, IV_MAX_SCALE, ivAllVisible, ivCenterOn, ivClamp, ivFit, ivFitScale, ivIsFit, ivMinScale, ivNavRect, ivNavSize,
  ivPercent, ivResize, ivStep, ivWheelFactor, ivZoomTo,
} from '../src/features/bae-gyeong/view/imageViewMath.ts';

// BAE경 그림 크게 보기(view/ImageViewer)의 셈 — DOM 없이.
const img = { w: 3840, h: 2160 };
const box = { w: 1600, h: 900 };
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('opens fitted: the whole picture with a margin, centered', () => {
  const s = ivFitScale(img, box);
  near(s, Math.min((1600 - IV_FIT_PAD * 2) / 3840, (900 - IV_FIT_PAD * 2) / 2160));
  const v = ivFit(img, box);
  near(v.x, (1600 - 3840 * s) / 2); near(v.y, (900 - 2160 * s) / 2);
  assert.ok(ivAllVisible(v, img, box), 'navigator hidden when everything is visible');
  assert.ok(ivIsFit(v, img, box));
  assert.equal(ivPercent(v.s), `${Math.round(s * 100)}%`);
  // a small picture is enlarged to fit
  assert.ok(ivFitScale({ w: 400, h: 300 }, box) > 1);
});

test('wheel zoom keeps the point under the cursor, and the scale stays in range', () => {
  const v = ivFit(img, box);
  const cx = 1200; const cy = 300;
  const before = { x: (cx - v.x) / v.s, y: (cy - v.y) / v.s };
  const z = ivZoomTo(v, 1, cx, cy, img, box);
  near((cx - z.x) / z.s, before.x, 1e-6); near((cy - z.y) / z.s, before.y, 1e-6);
  assert.equal(ivZoomTo(v, 100, cx, cy, img, box).s, IV_MAX_SCALE);
  near(ivZoomTo(v, 0.0001, cx, cy, img, box).s, ivMinScale(img, box));
  assert.ok(ivWheelFactor(100) < 1 && ivWheelFactor(-100) > 1, 'down = smaller, up = bigger');
  assert.ok(ivWheelFactor(3, 1) < 1, 'line-mode wheels count too');
  near(ivWheelFactor(100) * ivWheelFactor(-100), 1);
});

test('panning never shows empty space past the edges; a smaller picture stays centered', () => {
  const big = { s: 1, x: 0, y: 0 };
  assert.deepEqual(ivClamp({ s: 1, x: 500, y: 500 }, img, box), big);
  assert.deepEqual(ivClamp({ s: 1, x: -99999, y: -99999 }, img, box), { s: 1, x: 1600 - 3840, y: 900 - 2160 });
  const small = ivClamp({ s: 0.1, x: 0, y: 0 }, img, box);
  near(small.x, (1600 - 384) / 2); near(small.y, (900 - 216) / 2);
});

test('+ / − walk the steps, double-click toggles fit and 100%', () => {
  assert.equal(ivStep(1, 1, img, box), 1.5);
  assert.equal(ivStep(1, -1, img, box), 0.67);
  assert.equal(ivStep(0.5, 1, img, box), 0.67);
  assert.equal(ivStep(IV_MAX_SCALE, 1, img, box), IV_MAX_SCALE, 'stays at the top');
  const at100 = ivZoomTo(ivFit(img, box), 1, 800, 450, img, box);
  assert.equal(at100.s, 1);
  assert.equal(ivIsFit(at100, img, box), false);
});

test('the navigator box is the visible part, and pressing it centers the view there', () => {
  const nav = ivNavSize(img);
  assert.ok(nav.w <= 200 && nav.h <= 136);
  near(nav.w / nav.h, 3840 / 2160, 0.02);
  const v = ivZoomTo(ivFit(img, box), 1, 0, 0, img, box); // 100%, top-left corner
  const r = ivNavRect(v, img, box, nav.k);
  near(r.left, 0); near(r.top, 0); near(r.width, 1600 * nav.k); near(r.height, 900 * nav.k);
  const c = ivCenterOn(v, 1920 * nav.k, 1080 * nav.k, nav.k, img, box); // the middle of the picture on the navigator
  near(c.x, 800 - 1920); near(c.y, 450 - 1080);
  // resizing the window keeps the middle
  const grown = ivResize(c, box, { w: 1800, h: 1000 }, img);
  near(grown.x, c.x + 100); near(grown.y, c.y + 50);
});

test('wiring: one transformed <img>, pixelated from 200%, wheel not passive, focus kept and returned, Esc closes', () => {
  const src = readFileSync('src/features/bae-gyeong/view/ImageViewer.tsx', 'utf8');
  assert.equal((src.match(/<canvas/g) ?? []).length, 0, 'no canvas copies');
  assert.match(src, /transform: `translate\(\$\{view\.x\}px, \$\{view\.y\}px\) scale\(\$\{view\.s\}\)`/);
  assert.match(src, /scale >= IV_PIXEL_SCALE \? ' is-px' : ''/);
  assert.match(src, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  assert.match(src, /useModalFocus\(rootRef, \{ active: true \}\)/);
  assert.match(src, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); close\(\); return; \}/);
  assert.match(src, /createPortal\(/);
  assert.match(src, /export function useImageViewer\(\)/);
  const css = readFileSync('src/features/bae-gyeong/view/image-viewer.css', 'utf8');
  assert.match(css, /\.bae-iv-img\.is-px \{ image-rendering: pixelated; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /z-index: 100;/, 'same layer as the BAE windows');
  // the one-job view opens it from the picture and from the '크게 보기' button, with the full-size result
  const job = readFileSync('src/features/bae-gyeong/records/JobView.tsx', 'utf8');
  assert.match(job, /<ImageViewer key=\{p\.result\.src\} src=\{p\.result\.src\} alt=\{p\.result\.alt\} title=\{p\.title\} onClose=\{\(\) => setZoom\(false\)\} \/>/);
  assert.equal((job.match(/onClick=\{\(\) => setZoom\(true\)\}/g) ?? []).length, 2);
});
