import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMP_CHARACTER_NAME_BASE,
  deriveCharacterNameFromFileName,
  isTempCharacterName,
  nextTempCharacterName,
} from '../src/utils/characterName.ts';

test('임시 이름은 겹치지 않게 번호를 붙인다', () => {
  assert.equal(TEMP_CHARACTER_NAME_BASE, '새 캐릭터');
  assert.equal(nextTempCharacterName([]), '새 캐릭터');
  assert.equal(nextTempCharacterName(['한솔']), '새 캐릭터');
  assert.equal(nextTempCharacterName(['새 캐릭터']), '새 캐릭터 2');
  assert.equal(nextTempCharacterName(['새 캐릭터', '새 캐릭터 2']), '새 캐릭터 3');
  assert.equal(nextTempCharacterName(['새 캐릭터', '새 캐릭터 3']), '새 캐릭터 2');
});

test('isTempCharacterName 은 자동 부여 이름만 참', () => {
  assert.equal(isTempCharacterName('새 캐릭터'), true);
  assert.equal(isTempCharacterName('새 캐릭터 2'), true);
  assert.equal(isTempCharacterName('  새 캐릭터 12 '), true);
  assert.equal(isTempCharacterName('한솔'), false);
  assert.equal(isTempCharacterName('새 캐릭터들'), false);
  assert.equal(isTempCharacterName(''), false);
  assert.equal(isTempCharacterName(null), false);
});

test('파일명에서 이름을 뽑되 일반명은 제외', () => {
  assert.equal(deriveCharacterNameFromFileName('한솔.png'), '한솔');
  assert.equal(deriveCharacterNameFromFileName('한솔 SWver12.png'), '한솔 SWver12');
  assert.equal(deriveCharacterNameFromFileName('a.b.png'), 'a.b');
  assert.equal(deriveCharacterNameFromFileName('찜질방 사장.jpg'), '찜질방 사장');
  // 일반/기본 저장명 → null
  assert.equal(deriveCharacterNameFromFileName('image.png'), null);
  assert.equal(deriveCharacterNameFromFileName('IMAGE.PNG'), null);
  assert.equal(deriveCharacterNameFromFileName('clipboard.png'), null);
  assert.equal(deriveCharacterNameFromFileName('스크린샷 2026-07-08.png'), null);
  assert.equal(deriveCharacterNameFromFileName('Screenshot 2026.png'), null);
  assert.equal(deriveCharacterNameFromFileName('20260708.png'), null);
  assert.equal(deriveCharacterNameFromFileName('2026-07-08_12-00.png'), null);
  assert.equal(deriveCharacterNameFromFileName(''), null);
  assert.equal(deriveCharacterNameFromFileName('.png'), null);
});
