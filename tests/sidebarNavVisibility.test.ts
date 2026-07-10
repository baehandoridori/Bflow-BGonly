/**
 * 사이드바 nav 표시 규칙 동작 테스트 (소스 문자열 검사가 아니라 실제 실행 검증).
 * - '휴가' 탭은 지정된 사용자(강선영)에게만 숨겨진다.
 * - 그 외 사용자/로그인 없음/다른 탭에는 영향이 없다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isNavItemHiddenForUser, VACATION_HIDDEN_NAMES } from '../src/components/layout/navVisibility.ts';

test('강선영에게는 휴가 탭이 숨겨진다', () => {
  assert.equal(isNavItemHiddenForUser('vacation', '강선영'), true);
});

test('다른 사용자에게는 휴가 탭이 그대로 보인다', () => {
  assert.equal(isNavItemHiddenForUser('vacation', '배한솔'), false);
  assert.equal(isNavItemHiddenForUser('vacation', '홍길동'), false);
});

test('로그인 정보가 없으면 휴가 탭을 숨기지 않는다 (기본 노출)', () => {
  assert.equal(isNavItemHiddenForUser('vacation', null), false);
  assert.equal(isNavItemHiddenForUser('vacation', undefined), false);
  assert.equal(isNavItemHiddenForUser('vacation', ''), false);
});

test('휴가 외 다른 탭은 대상 사용자라도 숨기지 않는다', () => {
  assert.equal(isNavItemHiddenForUser('dashboard', '강선영'), false);
  assert.equal(isNavItemHiddenForUser('settings', '강선영'), false);
  assert.equal(isNavItemHiddenForUser('character-board', '강선영'), false);
});

test('숨김 명단에 강선영이 포함되어 있다', () => {
  assert.ok(VACATION_HIDDEN_NAMES.includes('강선영'));
});
