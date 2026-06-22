import test from 'node:test';
import assert from 'node:assert/strict';
import {
  revisionPartOf,
  isGeneralRevisionSceneKey,
  nextGeneralRevisionNo,
} from '../src/utils/revisionGeneral.ts';

test('revisionPartOf — EP:PART:scene 에서 대문자 파트', () => {
  assert.equal(revisionPartOf('EP01:A:1'), 'A');
  assert.equal(revisionPartOf('EP02:b:raw-x'), 'B');
});

test('revisionPartOf — 전반 표현은 null', () => {
  assert.equal(revisionPartOf(''), null);     // 낙관 추가 표현
  assert.equal(revisionPartOf('::'), null);   // 재로드 정규화 표현
  assert.equal(revisionPartOf('single'), null);
});

test('isGeneralRevisionSceneKey — 빈/콜론만/형식밖은 전반', () => {
  assert.equal(isGeneralRevisionSceneKey(''), true);
  assert.equal(isGeneralRevisionSceneKey('::'), true);
  assert.equal(isGeneralRevisionSceneKey('EP01:A:1'), false);
});

test('nextGeneralRevisionNo — 빈 세트는 1', () => {
  assert.equal(nextGeneralRevisionNo([], 'set-1'), 1);
});

test("nextGeneralRevisionNo — 같은 세트 전반 항목 max+1 ('' / '::' 혼재)", () => {
  const revs = [
    { setId: 'set-1', sceneKey: '', revisionNo: 1 },
    { setId: 'set-1', sceneKey: '::', revisionNo: 2 },        // 재로드 표현도 동일 카운트
    { setId: 'set-2', sceneKey: '', revisionNo: 9 },          // 다른 세트 무시
    { setId: 'set-1', sceneKey: 'EP01:A:1', revisionNo: 7 },  // 씬 매인 무시
  ];
  assert.equal(nextGeneralRevisionNo(revs, 'set-1'), 3);
});
