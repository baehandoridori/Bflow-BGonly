import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanIpcErrorMessage } from '../src/utils/ipcErrorMessage.ts';

test('IPC 껍데기를 벗기고 메인이 쓴 문구만 남긴다', () => {
  assert.equal(
    cleanIpcErrorMessage(
      new Error("Error invoking remote method 'ics:add': Error: 캘린더 주소는 http 또는 https여야 합니다"),
      '구독을 추가하지 못했습니다',
    ),
    '캘린더 주소는 http 또는 https여야 합니다',
  );
});

test('Error: 접두사가 없는 껍데기도 벗긴다', () => {
  assert.equal(
    cleanIpcErrorMessage(
      new Error("Error invoking remote method 'ics:update': 이름을 바꾸지 못했습니다"),
      '기본 문구',
    ),
    '이름을 바꾸지 못했습니다',
  );
});

test('껍데기가 없으면 원문을 그대로 쓴다', () => {
  assert.equal(
    cleanIpcErrorMessage(new Error('네트워크가 불안정합니다'), '기본 문구'),
    '네트워크가 불안정합니다',
  );
  assert.equal(cleanIpcErrorMessage('문자열 오류', '기본 문구'), '문자열 오류');
});

test('알아볼 문구가 없으면 기본 문구로 돌아간다', () => {
  assert.equal(cleanIpcErrorMessage(new Error(''), '구독을 추가하지 못했습니다'), '구독을 추가하지 못했습니다');
  assert.equal(cleanIpcErrorMessage(null, '구독을 추가하지 못했습니다'), '구독을 추가하지 못했습니다');
  assert.equal(
    cleanIpcErrorMessage(new Error("Error invoking remote method 'ics:add': Error: "), '구독을 추가하지 못했습니다'),
    '구독을 추가하지 못했습니다',
  );
});
