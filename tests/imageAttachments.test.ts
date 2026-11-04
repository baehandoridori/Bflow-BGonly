import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clipboardImageFiles,
  createImageAttachmentActions,
  discardAttachedImages,
  pickImageFiles,
  type AttachedImage,
  type ImageAttachmentDeps,
} from '../src/utils/imageAttachments.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(overrides: Partial<ImageAttachmentDeps> = {}) {
  let images: AttachedImage[] = [];
  const deleted: string[] = [];
  const revoked: string[] = [];
  const uploads: Array<{ resolve: (url: string) => void; reject: (err: Error) => void }> = [];
  let mounted = true;
  let single = false;
  let id = 0;
  const deps: ImageAttachmentDeps = {
    setImages: (updater) => { images = updater(images); },
    upload: () => new Promise<string>((resolve, reject) => uploads.push({ resolve, reject })),
    deleteRemote: async (url) => { deleted.push(url); },
    createPreviewUrl: () => `blob:${id}`, // createId 다음에 불린다 — 같은 번호
    revokePreviewUrl: (url) => { revoked.push(url); },
    createId: () => `img-${++id}`,
    isMounted: () => mounted,
    single: () => single,
    label: '[검사]',
    ...overrides,
  };
  const actions = createImageAttachmentActions(deps);
  return {
    actions, deleted, revoked, uploads,
    images: () => images,
    unmount: () => { mounted = false; },
    setSingle: (value: boolean) => { single = value; },
  };
}
const png = { type: 'image/png' } as Blob;
const txt = { type: 'text/plain' } as Blob;

test('넣으면 바로 미리보기, 올라오면 주소가 붙는다', async () => {
  const h = harness();
  h.actions.add(png);
  assert.deepEqual(h.images(), [{ id: 'img-1', previewUrl: 'blob:1', uploading: true }]);
  h.uploads[0].resolve('https://cdn/a.jpg');
  await flush();
  assert.deepEqual(h.images(), [{ id: 'img-1', previewUrl: 'blob:1', uploading: false, uploadedUrl: 'https://cdn/a.jpg' }]);
});

test('올리는 중에 빼면 올라온 파일을 지운다(주인 없는 파일 방지)', async () => {
  const h = harness();
  h.actions.add(png);
  h.actions.remove('img-1');
  assert.deepEqual(h.revoked, ['blob:1']);
  h.uploads[0].resolve('https://cdn/late.jpg');
  await flush();
  assert.deepEqual(h.images(), []);
  assert.deepEqual(h.deleted, ['https://cdn/late.jpg']);
});

test('화면이 닫힌 뒤 올라온 파일도 지운다, 실패는 화면이 있을 때만 표시', async () => {
  const h = harness();
  h.actions.add(png);
  h.actions.add(png);
  h.unmount();
  h.uploads[0].resolve('https://cdn/after-close.jpg');
  h.uploads[1].reject(new Error('끊김'));
  await flush();
  assert.deepEqual(h.deleted, ['https://cdn/after-close.jpg']);
  assert.ok(h.images().every((item) => item.uploading), '닫힌 뒤에는 목록을 건드리지 않는다');
});

test('올리기 실패 — 그 그림에 오류를 단다', async () => {
  const h = harness();
  h.actions.add(png);
  h.uploads[0].reject(new Error('용량 초과'));
  await flush();
  assert.equal(h.images()[0].uploading, false);
  assert.equal(h.images()[0].error, '용량 초과');
});

test('올라온 뒤 빼면 저장소의 파일도 지운다', async () => {
  const h = harness();
  h.actions.add(png);
  h.uploads[0].resolve('https://cdn/a.jpg');
  await flush();
  h.actions.remove('img-1');
  assert.deepEqual(h.images(), []);
  assert.deepEqual(h.deleted, ['https://cdn/a.jpg']);
});

test('한 장만(빠른 리테이크) — 새로 넣으면 앞의 것을 정리하고 바꾼다, 여러 장을 놓아도 첫 장만', async () => {
  const h = harness();
  h.setSingle(true);
  h.actions.add(png);
  h.uploads[0].resolve('https://cdn/first.jpg');
  await flush();
  h.actions.addFiles([png, png, txt]);
  assert.equal(h.images().length, 1);
  assert.equal(h.images()[0].id, 'img-2');
  assert.deepEqual(h.deleted, ['https://cdn/first.jpg']);
  assert.deepEqual(h.revoked, ['blob:1']);
});

test('파일 고르기·끌어 놓기는 그림만, 붙여 넣기는 그림이 있을 때만 true', () => {
  const h = harness();
  h.actions.addFiles([txt, png, png]);
  assert.equal(h.images().length, 2);
  assert.equal(h.actions.addFromClipboard([{ type: 'text/plain', getAsFile: () => null }]), false);
  assert.equal(h.actions.addFromClipboard([{ type: 'image/png', getAsFile: () => png }]), true);
  assert.equal(h.images().length, 3);
  assert.equal(h.actions.addFromClipboard(null), false);
});

test('순수 도우미 — 그림 고르기·붙여 넣기 파일·정리', () => {
  assert.deepEqual(pickImageFiles([txt, png, png], true), [png]);
  assert.deepEqual(pickImageFiles(null, false), []);
  assert.deepEqual(clipboardImageFiles([{ type: 'image/png', getAsFile: () => null }], false), []);
  const deleted: string[] = [];
  const revoked: string[] = [];
  discardAttachedImages(
    [{ id: 'a', previewUrl: 'blob:a', uploading: false, uploadedUrl: 'u:a' }, { id: 'b', previewUrl: 'blob:b', uploading: true }],
    { deleteRemote: async (url) => { deleted.push(url); }, revokePreviewUrl: (url) => { revoked.push(url); } },
    '[검사]',
  );
  assert.deepEqual(revoked, ['blob:a', 'blob:b']);
  assert.deepEqual(deleted, ['u:a']);
});
