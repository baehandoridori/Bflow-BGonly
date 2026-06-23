import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeAutoCommentPanelWidth,
  computeCommentPanelResizeWidth,
  computeCommentThreadPanelResizeWidth,
} from '../src/utils/commentPanelResize.ts';

test('viewport=1440 count=0 → base=Math.min(480, 1440*0.26)=374.4', () => {
  const w = computeAutoCommentPanelWidth(1440, 0);
  assert.equal(w, 1440 * 0.26);
});

test('viewport=1024 count=8 → max(320, min(480, 266))=320 + boost40 = 360', () => {
  const w = computeAutoCommentPanelWidth(1024, 8);
  assert.equal(w, 360);
});

test('viewport=1920 count=20 → max(320, min(480, 499))=480 + boost80 = 560', () => {
  const w = computeAutoCommentPanelWidth(1920, 20);
  assert.equal(w, 560);
});

test('viewport=320 count=0 → 320 (lower bound clamp)', () => {
  const w = computeAutoCommentPanelWidth(320, 0);
  assert.equal(w, 320);
});

test('자동 모드 최댓값: viewport=3840 count=50 → 480 base + 80 boost = 560 (600 cap 아래)', () => {
  // 자동 모드에서는 max base 480 + max boost 80 = 560 이므로 600 cap 에는 닿지 못함.
  // 600 cap 은 향후 더 큰 boost 가 추가될 때 안전망 역할.
  const w = computeAutoCommentPanelWidth(3840, 50);
  assert.equal(w, 560);
});

test('viewport=2000 count=10 → 480 + 40 = 520 (boost 중간)', () => {
  const w = computeAutoCommentPanelWidth(2000, 10);
  assert.equal(w, 520);
});

test('viewport=1500 count=15 → max(320, min(480, 390))=390 + 40 = 430 (count 정확히 15 → boost40)', () => {
  // count > 15 가 아니라 > 5 만 만족
  const w = computeAutoCommentPanelWidth(1500, 15);
  assert.equal(w, 430);
});

test('viewport=1500 count=16 → 390 + 80 = 470 (count 16 → boost80)', () => {
  const w = computeAutoCommentPanelWidth(1500, 16);
  assert.equal(w, 470);
});

test('댓글 패널 안쪽 경계 드래그는 왼쪽으로 끌 때 너비가 커진다', () => {
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 940, 'inner'), 480);
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 1060, 'inner'), 360);
});

test('댓글 패널 바깥쪽 아웃라인 드래그는 오른쪽으로 끌 때 너비가 커진다', () => {
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 1060, 'outer'), 480);
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 940, 'outer'), 360);
});

test('댓글 패널 드래그 너비는 저장 가능 범위 안으로 제한된다', () => {
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 0, 'inner'), 720);
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 2000, 'inner'), 280);
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 2000, 'outer'), 720);
  assert.equal(computeCommentPanelResizeWidth(420, 1000, 0, 'outer'), 280);
});

test('스레드 칸 경계 드래그는 왼쪽으로 끌 때 스레드 폭이 커진다', () => {
  assert.equal(computeCommentThreadPanelResizeWidth(340, 1000, 940), 400);
  assert.equal(computeCommentThreadPanelResizeWidth(340, 1000, 1060), 280);
});

test('스레드 칸 드래그 폭은 읽기 가능한 범위 안으로 제한된다', () => {
  assert.equal(computeCommentThreadPanelResizeWidth(340, 1000, 0), 560);
  assert.equal(computeCommentThreadPanelResizeWidth(340, 1000, 2000), 260);
});
