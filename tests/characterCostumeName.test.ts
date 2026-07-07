import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COSTUME_NAME,
  costumeNameForNew,
  nextCostumeName,
} from '../src/utils/characterCostumeName.ts';

test('첫 복장은 기본 복장, 이후는 복장 N 으로 이어진다', () => {
  assert.equal(DEFAULT_COSTUME_NAME, '기본 복장');
  assert.equal(costumeNameForNew([]), '기본 복장');
  assert.equal(costumeNameForNew([{ name: '기본 복장' }]), '복장 1');
  assert.equal(costumeNameForNew([{ name: '기본 복장' }, { name: '복장 1' }]), '복장 2');
});

test('nextCostumeName 은 기존 복장 N 최대값 + 1 (구멍 채우지 않음)', () => {
  assert.equal(nextCostumeName([]), '복장 1');
  assert.equal(nextCostumeName([{ name: '기본 복장' }]), '복장 1');
  // 복장 1 삭제되어 [기본 복장, 복장 2] 만 남아도 최대값 기준 → 복장 3 (구멍 미채움).
  assert.equal(nextCostumeName([{ name: '기본 복장' }, { name: '복장 2' }]), '복장 3');
  // 명명형 복장('교복', '사복')은 번호 계산에서 무시.
  assert.equal(nextCostumeName([{ name: '교복' }, { name: '사복' }]), '복장 1');
  assert.equal(nextCostumeName([{ name: '교복' }, { name: '복장 3' }]), '복장 4');
});

test('불규칙 공백/유사 문자열은 번호로 오인하지 않는다', () => {
  // '복장' 뒤 숫자 없는 것, '복장12A' 같은 것은 미매칭.
  assert.equal(nextCostumeName([{ name: '복장' }, { name: '복장12A' }]), '복장 1');
  // 앞뒤 공백은 trim 후 매칭.
  assert.equal(nextCostumeName([{ name: '  복장 5  ' }]), '복장 6');
});
