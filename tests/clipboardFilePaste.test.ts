/**
 * F28 클립보드 파일 붙여넣기 순수 로직 단위 테스트.
 * 두 소스 파일 모두 런타임 import 0개(@/ alias 없음)여야 plain node --test 로 로드된다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileNameWBuffer, imageMimeForPath } from '../electron/clipboardFiles.ts';
import { dataUrlToFile } from '../src/utils/dataUrlToFile.ts';

test('parseFileNameWBuffer: FileNameW(UTF-16LE 널 종단) 경로 추출', () => {
  // 한글 경로 + 널 종단.
  assert.equal(parseFileNameWBuffer(Buffer.from('C:\\작업\\미영.png\0', 'utf16le')), 'C:\\작업\\미영.png');
  // 트레일링 널 여러 개.
  assert.equal(parseFileNameWBuffer(Buffer.from('C:\\a\\b.jpg\0\0\0', 'utf16le')), 'C:\\a\\b.jpg');
  // 널 없는 버퍼 → 전체 문자열.
  assert.equal(parseFileNameWBuffer(Buffer.from('D:\\x.webp', 'utf16le')), 'D:\\x.webp');
});

test('parseFileNameWBuffer: 빈/무효 버퍼 → null', () => {
  assert.equal(parseFileNameWBuffer(Buffer.alloc(0)), null);
  // 널만 있는 버퍼.
  assert.equal(parseFileNameWBuffer(Buffer.from('\0', 'utf16le')), null);
  // 공백만.
  assert.equal(parseFileNameWBuffer(Buffer.from('   \0', 'utf16le')), null);
});

test('imageMimeForPath: 확장자별 MIME(대문자 허용) + 비이미지 → null', () => {
  assert.equal(imageMimeForPath('a.PNG'), 'image/png');
  assert.equal(imageMimeForPath('a.jpg'), 'image/jpeg');
  assert.equal(imageMimeForPath('a.jpeg'), 'image/jpeg');
  assert.equal(imageMimeForPath('a.webp'), 'image/webp');
  // 작업 파일/문서/확장자 없음 → null.
  assert.equal(imageMimeForPath('a.moho'), null);
  assert.equal(imageMimeForPath('a.txt'), null);
  assert.equal(imageMimeForPath('noext'), null);
});

test('dataUrlToFile: 유효 data URL → File(name/type/size)', () => {
  // 'hello'(5바이트)의 base64.
  const dataUrl = `data:image/png;base64,${Buffer.from('hello').toString('base64')}`;
  const file = dataUrlToFile(dataUrl, '미영.png');
  assert.ok(file);
  assert.equal(file!.name, '미영.png');
  assert.equal(file!.type, 'image/png');
  assert.equal(file!.size, 5);
});

test('dataUrlToFile: 무효 입력 → null', () => {
  assert.equal(dataUrlToFile('not-a-data-url', 'x.png'), null);
  // base64 아님(URL-encoded data URL).
  assert.equal(dataUrlToFile('data:image/png,rawtext', 'x.png'), null);
});
