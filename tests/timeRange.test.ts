import test from 'node:test';
import assert from 'node:assert/strict';

import { getRangeBoundary, granularityFor, todayLabelFor } from '../src/components/widgets/activity/timeRange.ts';

// 기준: 2026-05-09(토) 14:30 KST = 2026-05-09T05:30:00Z
const REF = new Date('2026-05-09T05:30:00Z');

test('week idx=0 → 이번 주(월~일) 라벨', () => {
  const r = getRangeBoundary('week', 0, REF);
  assert.equal(r.label.startsWith('이번 주'), true, `actual: ${r.label}`);
  assert.match(r.label, /5\/4/);
});

test('week idx=1 → 지난 주', () => {
  const r = getRangeBoundary('week', 1, REF);
  assert.equal(r.label.startsWith('지난 주'), true);
});

test('week idx=2 → N주 전', () => {
  const r = getRangeBoundary('week', 2, REF);
  assert.equal(r.label.startsWith('2주 전'), true);
});

test('month idx=0 → 이번 달', () => {
  const r = getRangeBoundary('month', 0, REF);
  assert.equal(r.label, '이번 달 (5월)');
});

test('month idx=1 → 지난 달', () => {
  const r = getRangeBoundary('month', 1, REF);
  assert.equal(r.label, '지난 달 (4월)');
});

test('year idx=0 → 올해', () => {
  const r = getRangeBoundary('year', 0, REF);
  assert.equal(r.label, '올해 (2026년)');
});

test('year idx=1 → 작년', () => {
  const r = getRangeBoundary('year', 1, REF);
  assert.equal(r.label, '작년 (2025년)');
});

test('granularityFor', () => {
  assert.equal(granularityFor('week'), 'hour-of-day-x-dow');
  assert.equal(granularityFor('month'), 'hour-of-day-x-dow');
  assert.equal(granularityFor('year'), 'month-x-dow');
});

test('todayLabelFor', () => {
  assert.equal(todayLabelFor('week'), '이번 주');
  assert.equal(todayLabelFor('month'), '이번 달');
  assert.equal(todayLabelFor('year'), '올해');
});

test('rangeIdx 증가 시 startISO/endISO 정합성 (week)', () => {
  const r0 = getRangeBoundary('week', 0, REF);
  const r1 = getRangeBoundary('week', 1, REF);
  // 지난 주의 endISO == 이번 주의 startISO
  assert.equal(r1.endISO, r0.startISO, '지난 주 끝 = 이번 주 시작');
});
