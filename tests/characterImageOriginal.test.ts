/**
 * 캐릭터 그림 원본 보관 (v1.134.1).
 * 올릴 때 긴 변 800px 로 줄인 그림만 보관해서, '이미지 복사' → Moho 붙여넣기가 원래보다 작게 들어가던 문제.
 *   - 순수 규칙(주소 만들기·형식/크기 판정)과 main 쪽 올리기 흐름은 동작으로 검사한다.
 *   - 화면·main 배선은 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_DISPLAY_MAX_PX,
  CHARACTER_ORIGINAL_MAX_BYTES,
  canKeepCharacterOriginal,
  characterOriginalImageUrl,
  characterOriginalStoragePath,
  parseCharacterOriginalDataUrl,
  withCharacterOriginalPaths,
} from '../src/shared/characterImageOriginal.ts';
import { uploadCharacterImageFiles } from '../electron/characterImageUpload.ts';
import type { CharacterImageStore } from '../electron/characterImageUpload.ts';

const PUBLIC = 'https://example.supabase.co/storage/v1/object/public/scene-images/';
const DISPLAY = 'characters/c94d920a/4eff806a/1791798435926_cj2w62qk.png';

test('원본 주소: 화면용 그림 옆의 .orig — 형식이 달라도 같은 자리', () => {
  assert.equal(characterOriginalStoragePath(DISPLAY), 'characters/c94d920a/4eff806a/1791798435926_cj2w62qk.orig');
  assert.equal(
    characterOriginalStoragePath('characters/c94d920a/4eff806a/1791798435926_cj2w62qk.jpg'),
    'characters/c94d920a/4eff806a/1791798435926_cj2w62qk.orig',
  );
});

test('원본 주소: 캐릭터 그림이 아니면 없음 — 씬 그림·댓글 첨부·이미 원본인 주소', () => {
  assert.equal(characterOriginalStoragePath('EP01/A/BG/a001/storyboard_1_x.jpg'), null);
  assert.equal(characterOriginalStoragePath('characters/c94d920a/comments/comment_1791_x.png'), null);
  assert.equal(characterOriginalStoragePath('characters/c94d920a/4eff806a/1791798435926_cj2w62qk.orig'), null);
  assert.equal(characterOriginalStoragePath('characters/c94d920a/4eff806a/deep/1791_x.png'), null);
  assert.equal(characterOriginalStoragePath(''), null);
});

test('원본 주소: 공개 주소에서 만들기 — 저장소 밖 주소는 없음', () => {
  assert.equal(characterOriginalImageUrl(PUBLIC + DISPLAY), `${PUBLIC}characters/c94d920a/4eff806a/1791798435926_cj2w62qk.orig`);
  // 다시 받기용 꼬리표가 붙어 있어도 같은 원본을 가리킨다.
  assert.equal(
    characterOriginalImageUrl(`${PUBLIC}${DISPLAY}?characterImageRetry=2`),
    `${PUBLIC}characters/c94d920a/4eff806a/1791798435926_cj2w62qk.orig`,
  );
  assert.equal(characterOriginalImageUrl('/splash/opening_image_cropped.png'), null);
  assert.equal(characterOriginalImageUrl('data:image/png;base64,AAAA'), null);
  assert.equal(characterOriginalImageUrl(`${PUBLIC}EP01/A/BG/a001/guide_1_x.jpg`), null);
  assert.equal(characterOriginalImageUrl(null), null);
  assert.equal(characterOriginalImageUrl(undefined), null);
});

test('지울 때: 화면용 그림과 원본을 함께 — 다른 주소는 그대로', () => {
  assert.deepEqual(
    withCharacterOriginalPaths([DISPLAY, 'characters/c94d920a/comments/comment_1_x.png', 'EP01/A/BG/a001/guide_1_x.jpg']),
    [
      DISPLAY,
      'characters/c94d920a/4eff806a/1791798435926_cj2w62qk.orig',
      'characters/c94d920a/comments/comment_1_x.png',
      'EP01/A/BG/a001/guide_1_x.jpg',
    ],
  );
  assert.deepEqual(withCharacterOriginalPaths([]), []);
});

test('원본으로 둘 수 있는 파일: 흔한 그림 형식 + 크기 한계 안', () => {
  assert.equal(CHARACTER_DISPLAY_MAX_PX, 800);
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']) {
    assert.equal(canKeepCharacterOriginal({ type, size: 1024 }), true, type);
  }
  // 스크립트를 담을 수 있는 형식·그림이 아닌 것은 원본으로 두지 않는다.
  assert.equal(canKeepCharacterOriginal({ type: 'image/svg+xml', size: 1024 }), false);
  assert.equal(canKeepCharacterOriginal({ type: 'text/html', size: 1024 }), false);
  assert.equal(canKeepCharacterOriginal({ type: '', size: 1024 }), false);
  assert.equal(canKeepCharacterOriginal({ type: 'image/png', size: CHARACTER_ORIGINAL_MAX_BYTES }), true);
  assert.equal(canKeepCharacterOriginal({ type: 'image/png', size: CHARACTER_ORIGINAL_MAX_BYTES + 1 }), false);
  assert.equal(canKeepCharacterOriginal({ type: 'image/png', size: 0 }), false);
});

test('원본 data URL 읽기: 형식과 내용 분리 — 허용 밖 형식·깨진 값은 없음', () => {
  assert.deepEqual(parseCharacterOriginalDataUrl('data:image/webp;base64,AAAA'), { mime: 'image/webp', base64: 'AAAA' });
  assert.equal(parseCharacterOriginalDataUrl('data:image/svg+xml;base64,AAAA'), null);
  assert.equal(parseCharacterOriginalDataUrl('data:image/png;base64,'), null);
  assert.equal(parseCharacterOriginalDataUrl('https://example.com/a.png'), null);
  assert.equal(parseCharacterOriginalDataUrl(null), null);
  assert.equal(parseCharacterOriginalDataUrl(undefined), null);
});

// ─── main: 올리기 흐름 ───

function fakeStore(options: { failOn?: (path: string) => boolean } = {}) {
  const uploads: { path: string; body: Buffer; contentType: string }[] = [];
  const store: CharacterImageStore = {
    upload: async (path, body, contentType) => {
      if (options.failOn?.(path)) throw new Error('upload failed');
      uploads.push({ path, body, contentType });
    },
    publicUrl: (path) => PUBLIC + path,
  };
  return { store, uploads };
}

const displayPng = { buffer: Buffer.from('display-800px'), mime: 'image/png' as const, ext: 'png' as const };
const originalBytes = Buffer.from('original-590x930-bytes');
const originalDataUrl = `data:image/png;base64,${originalBytes.toString('base64')}`;
const target = { characterId: 'char-1', costumeId: 'cos-1', uniq: '1791_abcd1234' };

test('올리기: 화면용 그림과 원본을 같은 자리에 — 원본은 받은 바이트 그대로', async () => {
  const { store, uploads } = fakeStore();
  const result = await uploadCharacterImageFiles(store, { ...target, display: displayPng, originalDataUrl });
  assert.deepEqual(result, { url: `${PUBLIC}characters/char-1/cos-1/1791_abcd1234.png`, originalSaved: true });
  assert.deepEqual(uploads.map((u) => [u.path, u.contentType]), [
    ['characters/char-1/cos-1/1791_abcd1234.png', 'image/png'],
    ['characters/char-1/cos-1/1791_abcd1234.orig', 'image/png'],
  ]);
  assert.equal(uploads[0].body.equals(displayPng.buffer), true);
  assert.equal(uploads[1].body.equals(originalBytes), true);
  // 화면이 주소에서 만들어 내는 원본 주소와 main 이 실제로 올린 자리가 같아야 한다.
  assert.equal(characterOriginalImageUrl(result.url), PUBLIC + uploads[1].path);
});

test('올리기: 원본 형식이 화면용과 달라도 원본 형식 그대로', async () => {
  const { store, uploads } = fakeStore();
  const displayJpg = { buffer: Buffer.from('display-jpg'), mime: 'image/jpeg' as const, ext: 'jpg' as const };
  const webp = `data:image/webp;base64,${originalBytes.toString('base64')}`;
  const result = await uploadCharacterImageFiles(store, { ...target, display: displayJpg, originalDataUrl: webp });
  assert.equal(result.originalSaved, true);
  assert.deepEqual(uploads.map((u) => [u.path, u.contentType]), [
    ['characters/char-1/cos-1/1791_abcd1234.jpg', 'image/jpeg'],
    ['characters/char-1/cos-1/1791_abcd1234.orig', 'image/webp'],
  ]);
});

test('올리기: 원본이 없거나 받을 수 없는 값이면 화면용만', async () => {
  // 마지막 값은 base64 로 읽으면 내용이 비는 경우 — 빈 원본이 올라가면 복사가 화면용으로 넘어가지 못하고 실패한다.
  for (const value of [undefined, null, '', 'data:image/svg+xml;base64,AAAA', 'not-a-data-url', 'data:image/png;base64,!!!!']) {
    const { store, uploads } = fakeStore();
    const result = await uploadCharacterImageFiles(store, { ...target, display: displayPng, originalDataUrl: value });
    assert.equal(result.originalSaved, false);
    assert.deepEqual(uploads.map((u) => u.path), ['characters/char-1/cos-1/1791_abcd1234.png']);
  }
});

test('올리기: 크기 한계를 넘는 원본은 올리지 않는다', async () => {
  const { store, uploads } = fakeStore();
  const huge = `data:image/png;base64,${Buffer.alloc(CHARACTER_ORIGINAL_MAX_BYTES + 1).toString('base64')}`;
  const result = await uploadCharacterImageFiles(store, { ...target, display: displayPng, originalDataUrl: huge });
  assert.equal(result.originalSaved, false);
  assert.deepEqual(uploads.map((u) => u.path), ['characters/char-1/cos-1/1791_abcd1234.png']);
});

test('올리기: 원본만 실패하면 그림은 올라간 것으로 — 화면용이 실패하면 원본은 시도하지 않는다', async () => {
  const originalFails = fakeStore({ failOn: (path) => path.endsWith('.orig') });
  const result = await uploadCharacterImageFiles(originalFails.store, { ...target, display: displayPng, originalDataUrl });
  assert.deepEqual(result, { url: `${PUBLIC}characters/char-1/cos-1/1791_abcd1234.png`, originalSaved: false });

  const attempted: string[] = [];
  const displayFails: CharacterImageStore = {
    upload: async (path) => { attempted.push(path); throw new Error('upload failed'); },
    publicUrl: (path) => PUBLIC + path,
  };
  await assert.rejects(uploadCharacterImageFiles(displayFails, { ...target, display: displayPng, originalDataUrl }), /upload failed/);
  assert.deepEqual(attempted, ['characters/char-1/cos-1/1791_abcd1234.png']);
});

// ─── 배선 ───

const storage = readFileSync('electron/storage.ts', 'utf8');
const mainSupabase = readFileSync('electron/supabase.ts', 'utf8');
const main = readFileSync('electron/main.ts', 'utf8');
const preload = readFileSync('electron/preload.ts', 'utf8');
const types = readFileSync('src/types/index.ts', 'utf8');
const service = readFileSync('src/services/supabaseService.ts', 'utf8');
const slot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
const pathActions = readFileSync('src/services/characterPathActions.ts', 'utf8');
const imageActions = readFileSync('src/utils/imageActions.ts', 'utf8');
const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');

test('배선: 원본이 화면 → main → 저장소까지 끊기지 않고 간다', () => {
  assert.match(types, /storageUploadCharacterImage: \(characterId: string, costumeId: string, base64Data: string, originalDataUrl\?: string \| null\) => Promise<\{ ok: boolean; url\?: string; error\?: string; originalSaved\?: boolean \}>/);
  assert.match(preload, /ipcRenderer\.invoke\('storage:upload-character-image', characterId, costumeId, base64Data, originalDataUrl\)/);
  assert.match(main, /return storageUploadCharacterImage\(characterId, costumeId, base64Data, originalDataUrl\)/);
  assert.match(service, /window\.electronAPI\.storageUploadCharacterImage\(characterId, costumeId, base64Data, originalDataUrl\)/);
  assert.match(storage, /uploadCharacterImageFiles\(characterImageStore, \{ characterId, costumeId, uniq, display: toBuffer\(base64Data\), originalDataUrl \}\)/);
  // 미리보기도 같은 길 — 원본을 받았는지 그대로 돌려준다.
  assert.match(mock, /storageUploadCharacterImage: async \(_characterId: string, _costumeId: string, _base64Data: string, originalDataUrl\?: string \| null\) => \(\{ ok: true, url: MOCK_CHARACTER_IMAGE_URL, originalSaved: !!originalDataUrl \}\)/);
});

test('배선: 그림을 올릴 때 줄이기 전 파일을 함께 보낸다', () => {
  assert.match(slot, /const base64 = await resizeBlob\(file, CHARACTER_DISPLAY_MAX_PX, /);
  assert.match(slot, /const originalDataUrl = canKeepCharacterOriginal\(file\) \? await readFileAsDataUrl\(file\) : null;/);
  assert.match(slot, /await uploadCharacterImage\(character\.id, targetCostume\.id, base64, originalDataUrl\)/);
  // 줄어든 그림만 남았을 때만 알린다 — 원래 작은 그림은 화면용이 곧 원래 크기다.
  assert.match(slot, /if \(!res\.originalSaved && naturalSize && Math\.max\(naturalSize\.width, naturalSize\.height\) > CHARACTER_DISPLAY_MAX_PX\) \{/);
});

test('배선: 캐릭터 그림 복사는 원본을 먼저 — 없으면 화면용으로', () => {
  assert.match(pathActions, /const originalUrl = characterOriginalImageUrl\(url\);/);
  assert.match(pathActions, /const original = originalUrl \? await fetchImageBlob\(originalUrl\)\.catch\(\(\) => null\) : null;/);
  assert.match(pathActions, /const size = await writeImageBlobToClipboard\(original \?\? await fetchImageBlob\(url\)\);/);
  assert.match(pathActions, /if \(!original && Math\.max\(size\.width, size\.height\) === CHARACTER_DISPLAY_MAX_PX\) \{/);
  // 씬 쪽 복사는 그대로 — 같은 그리기·쓰기를 나눠 쓴다.
  assert.match(imageActions, /export async function fetchImageBlob\(url: string\): Promise<Blob>/);
  assert.match(imageActions, /export async function writeImageBlobToClipboard\(blob: Blob\): Promise<\{ width: number; height: number \}>/);
  assert.match(imageActions, /await writeImageBlobToClipboard\(await fetchImageBlob\(url\)\);/);
  // 쓴 그림의 실제 크기를 돌려준다 — 줄어든 그림인지 가리는 데 쓴다.
  assert.match(imageActions, /return \{ width: canvas\.width, height: canvas\.height \};/);
});

test('배선: 그림을 지우면 원본도 같이 지운다 — 낱장·복장·캐릭터 삭제 모두', () => {
  assert.match(storage, /\.remove\(withCharacterOriginalPaths\(\[path\]\)\)/);
  assert.match(mainSupabase, /await supabase\.storage\.from\('scene-images'\)\.remove\(withCharacterOriginalPaths\(paths\)\)/);
});
