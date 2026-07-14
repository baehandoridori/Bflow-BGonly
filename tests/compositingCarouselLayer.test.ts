/**
 * 피드백 30 — 컴포지팅 캐러셀 레이어/가림 검사 배선 고정.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const panel = readFileSync('src/views/compositing-dashboard/timeline/TimelinePanel.tsx', 'utf8');

test('캐러셀 z 는 헤더(z-30) 아래 상수로 고정 — 알림창을 덮지 않는다', () => {
  assert.match(panel, /const CAROUSEL_LAYER_Z = 25;/);
  assert.match(panel, /zIndex: CAROUSEL_LAYER_Z/);
  assert.doesNotMatch(panel, /height: 150, zIndex: 90/);
});

test('hover 히트테스트는 최상단 요소 가림 검사를 통과해야 발화', () => {
  assert.match(panel, /document\.elementFromPoint\(clientX, clientY\)/);
  assert.match(panel, /trackContainerRef\.current\?\.contains\(topElement\)/);
});
