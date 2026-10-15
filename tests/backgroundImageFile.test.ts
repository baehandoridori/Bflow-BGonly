import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { readBackgroundImageFile, MAX_BACKGROUND_IMAGE_BYTES, MAX_BACKGROUND_IMAGE_DATA_URL } from '../electron/backgroundImageFile.ts';
import { clipboardImageFilePath } from '../electron/clipboardFiles.ts';
import type { BackgroundDecodedImage } from '../electron/backgroundImageFile.ts';
import type { ElectronAPI } from '../src/types/index.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2UAAAAASUVORK5CYII=', 'base64');
const filename = 'G:\\공유 드라이브\\배경\\교실.png';
function fileFixture(data = png, options: { size?: number; file?: boolean; readError?: boolean } = {}) {
  let reads = 0, closed = 0, opened = 0, readBytes = 0;
  return {
    state: () => ({ reads, closed, opened, readBytes }),
    openFile: async () => {
      opened++;
      return {
        stat: async () => ({ size: options.size ?? data.length, isFile: () => options.file ?? true }),
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          reads++;
          if (options.readError) throw Object.assign(new Error('EIO'), { code: 'EIO' });
          const bytesRead = Math.max(0, Math.min(length, data.length - position));
          data.copy(buffer, offset, position, position + bytesRead); readBytes += bytesRead;
          return { bytesRead };
        },
        close: async () => { closed++; },
      };
    },
  };
}
function decoderFixture(options: { width?: number; height?: number; empty?: boolean; large?: boolean } = {}) {
  const resizes: { width: number; height: number }[] = [];
  let pngCalls = 0, jpegCalls = 0;
  const create = (width: number, height: number): BackgroundDecodedImage => ({
    isEmpty: () => options.empty ?? false,
    getSize: () => ({ width, height }),
    resize: size => { resizes.push(size); return create(size.width, size.height); },
    toPNG: () => { pngCalls++; return options.large && width > 900 ? Buffer.alloc(1_600_000) : png; },
    toJPEG: () => { jpegCalls++; return Buffer.from([255, 216, 255, 217]); },
  });
  return { decode: () => create(options.width ?? 640, options.height ?? 400), state: () => ({ resizes, pngCalls, jpegCalls }) };
}

test('linked image reader rejects URLs, relative paths and unsupported extensions before file access', async () => {
  const file = fileFixture(), decoder = decoderFixture();
  for (const input of ['https://example.com/bg.png', 'file:///C:/bg.png', 'bg.png', 'C:bg.png', '\\bg.png', '\\\\.\\pipe\\bg.png', 'C:\\bg.psd', 'C:\\bg.png\0']) {
    await assert.rejects(readBackgroundImageFile(input, { ...file, ...decoder }));
  }
  assert.equal(file.state().opened, 0);
});

test('linked image reader accepts absolute Unicode drive and UNC paths without changing the source', async () => {
  for (const filePath of [filename, '\\\\nas\\배경\\학교.png']) {
    const file = fileFixture(), decoder = decoderFixture();
    const result = await readBackgroundImageFile(filePath, { ...file, ...decoder });
    assert.equal(result.filePath, filePath); assert.equal(result.dataUrl, `data:image/png;base64,${png.toString('base64')}`);
    assert.equal(file.state().closed, 1); assert.equal(decoder.state().jpegCalls, 0);
  }
});

test('linked image reader rejects oversized sources before reading and growth during a bounded read', async () => {
  const decoder = decoderFixture(), over = fileFixture(png, { size: MAX_BACKGROUND_IMAGE_BYTES + 1 });
  await assert.rejects(readBackgroundImageFile(filename, { ...over, ...decoder }), /20MB/);
  assert.equal(over.state().reads, 0); assert.equal(over.state().closed, 1);
  const growing = fileFixture(Buffer.alloc(MAX_BACKGROUND_IMAGE_BYTES + 2048), { size: 10 });
  await assert.rejects(readBackgroundImageFile(filename, { ...growing, ...decoder }), /20MB/);
  assert.equal(growing.state().readBytes, MAX_BACKGROUND_IMAGE_BYTES + 1); assert.equal(growing.state().closed, 1);
});

test('linked image reader reports missing, unreadable, empty, directory and corrupt files', async () => {
  const decoder = decoderFixture();
  for (const [code, pattern] of [['ENOENT', /찾을 수/], ['EACCES', /권한/]] as const) {
    await assert.rejects(readBackgroundImageFile(filename, { ...decoder, openFile: async () => { throw Object.assign(new Error(code), { code }); } }), pattern);
  }
  for (const file of [fileFixture(Buffer.alloc(0)), fileFixture(png, { file: false }), fileFixture(png, { readError: true }), fileFixture(Buffer.from('not an image'))]) {
    await assert.rejects(readBackgroundImageFile(filename, { ...file, ...decoder })); assert.equal(file.state().closed, 1);
  }
  await assert.rejects(readBackgroundImageFile(filename, { ...fileFixture(), ...decoderFixture({ empty: true }) }), /손상/);
  await assert.rejects(readBackgroundImageFile(filename, { ...fileFixture(), decode() { throw new Error('bad decoder'); } }), /손상/);
});

test('linked image reader shrinks large transparent images to the dimension and data URL limits using PNG', async () => {
  const decoder = decoderFixture({ width: 4000, height: 2000, large: true });
  const result = await readBackgroundImageFile(filename, { ...fileFixture(), ...decoder });
  assert.deepEqual(decoder.state().resizes, [{ width: 1600, height: 800 }, { width: 1200, height: 600 }, { width: 900, height: 450 }]);
  assert.equal(decoder.state().jpegCalls, 0); assert.match(result.dataUrl, /^data:image\/png;base64,/);
  assert.ok(result.dataUrl.length <= MAX_BACKGROUND_IMAGE_DATA_URL);
});

test('linked image reader refuses WebP paths before opening them and only encodes actual JPEG sources as JPEG', async () => {
  const webp = fileFixture(Buffer.from('RIFF0000WEBPfixture')), decoder = decoderFixture();
  // The production decoder (nativeImage) reads PNG and JPEG only: say so instead of reporting a healthy file as corrupt.
  await assert.rejects(readBackgroundImageFile('C:\\source.webp', { ...webp, ...decoder }), /WebP 파일은 경로로 연결할 수 없습니다/);
  assert.equal(webp.state().opened, 0);
  // WebP bytes behind a .png name are refused by content, not handed to the decoder.
  await assert.rejects(readBackgroundImageFile('C:\\renamed.png', { ...fileFixture(Buffer.from('RIFF0000WEBPfixture')), ...decoder }), /지원하지 않는 형식/);
  assert.equal(decoder.state().jpegCalls, 0);
  const jpegResult = await readBackgroundImageFile('C:\\source.jpg', { ...fileFixture(Buffer.from([255, 216, 255, 217])), ...decoder });
  assert.match(jpegResult.dataUrl, /^data:image\/jpeg;/); assert.equal(decoder.state().jpegCalls, 1);
});

test('linked image reader uses the real read-only filesystem adapter and leaves file bytes unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bflow-bg-image-'));
  const filePath = path.join(directory, '교실.png');
  try {
    await writeFile(filePath, png);
    let decoded: Buffer | undefined;
    const decoder = decoderFixture();
    const result = await readBackgroundImageFile(filePath, { decode(buffer) { decoded = Buffer.from(buffer); return decoder.decode(); } });
    assert.deepEqual(decoded, png); assert.equal(result.filePath, filePath);
    // A second read succeeds after the first handle was closed.
    assert.deepEqual(await readBackgroundImageFile(filePath, decoder), result);
  } finally { await unlink(filePath); await rmdir(directory); }
});

test('browser file-link preview requires canonical admin and only serves the explicit sample path', async () => {
  const bundle = await build({ entryPoints: ['src/mocks/devElectronAPI.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false });
  const values = new Map<string, string>(); let canvases = 0;
  const window = { electronAPI: undefined as ElectronAPI | undefined, location: { protocol: 'http:' }, localStorage: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
  } };
  const document = { documentElement: { dataset: {} }, createElement: () => {
    canvases++; return { width: 0, height: 0, getContext: () => ({ fillStyle: '', font: '', fillRect() {}, fillText() {} }), toDataURL: () => `data:image/png;base64,${png.toString('base64')}` };
  } };
  const module = { exports: {} as { installDevElectronAPI(): void } };
  new Function('module', 'exports', 'window', 'document', 'navigator', 'BroadcastChannel', 'fetch', bundle.outputFiles[0].text)(
    module, module.exports, window, document, {}, undefined, () => { throw new Error('No external requests in preview'); },
  );
  module.exports.installDevElectronAPI(); const api = window.electronAPI!;
  const samplePath = 'G:\\공유 드라이브\\JBBJ\\배경\\교실\\교실_낮.png';
  await assert.rejects(api.backgroundReadImageFile(samplePath), /로그인/);
  await api.loginCanonicalSession({ name: '장삐쭈', password: '1234', rememberMe: false });
  await assert.rejects(api.backgroundReadImageFile(samplePath), /관리자/); assert.equal(canvases, 0);
  await api.loginCanonicalSession({ name: '배한솔', password: '1234', rememberMe: false });
  await assert.rejects(api.backgroundReadImageFile('G:\\없는 파일.png'), /직접 읽을 수 없습니다/); assert.equal(canvases, 0);
  const result = await api.backgroundReadImageFile(samplePath);
  assert.equal(result.filePath, samplePath); assert.match(result.dataUrl, /^data:image\/png;base64,/); assert.equal(canvases, 1);
  assert.equal(api.getPathForFile({} as File), ''); assert.equal(api.fontGetPathForFile({} as File), '');
});

test('clipboardImageFilePath reads the first path of FileNameW and nothing else, and only a picture', () => {
  const formats: string[] = [];
  /** A clipboard that holds these bytes under any format: each format asked for is written down. */
  const reader = (bytes: Buffer) => (format: string) => { formats.push(format); return bytes; };
  const copied = (filePath: string) => reader(Buffer.from(`${filePath}\0`, 'utf16le'));
  assert.equal(clipboardImageFilePath(reader(Buffer.from('G:\\공유 드라이브\\배경\\교실.png\0', 'utf16le'))), 'G:\\공유 드라이브\\배경\\교실.png');
  assert.deepEqual(formats, ['FileNameW']);
  // Every picture extension in any case: for a WebP or a GIF the screen says why it is not added.
  for (const picture of ['C:\\art\\교실.WEBP', 'C:\\art\\움짤.gif']) assert.equal(clipboardImageFilePath(copied(picture)), picture);
  for (const other of ['C:\\art\\교실.psd', 'C:\\art\\교실']) assert.equal(clipboardImageFilePath(copied(other)), null);
  assert.equal(clipboardImageFilePath(reader(Buffer.alloc(0))), null);
  assert.equal(clipboardImageFilePath(format => { formats.push(format); throw new Error('the clipboard is busy'); }), null);
  assert.equal(clipboardImageFilePath(reader(Buffer.from('C:\\art\\첫째.png\0C:\\art\\둘째.jpg\0', 'utf16le'))), 'C:\\art\\첫째.png');
  assert.deepEqual(formats, Array(8).fill('FileNameW'));
});

test('background clipboard and picker preview: a path only from the hook, and no file dialog in the app engine', async () => {
  const bundle = await build({ entryPoints: ['src/mocks/devElectronAPI.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false });
  type Hook = { filePath?: (file: File) => string; clipboardFile?: string; pick?: () => File[] };
  /** One page of the preview, under the navigator given: a browser tab, or the check window of the app engine. `Image` is the picture element of the page (none: the page cannot draw), and each canvas the page encodes is written down with its size and what it was asked for. */
  function preview(navigator: { userAgent?: string }, Image?: unknown) {
    const values = new Map<string, string>(), encoded: { width: number; height: number; args: unknown[] }[] = [];
    const window = { electronAPI: undefined as ElectronAPI | undefined, __bflowMockBackgroundAdd: undefined as Hook | undefined, location: { protocol: 'http:' }, localStorage: {
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
    } };
    const document = { documentElement: { dataset: {} }, createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', font: '', fillRect() {}, fillText() {}, drawImage() {} }),
      toDataURL(...args: unknown[]) { encoded.push({ width: this.width, height: this.height, args }); return 'data:image/webp;base64,UklGRg=='; } }) };
    const module = { exports: {} as { installDevElectronAPI(): void } };
    new Function('module', 'exports', 'window', 'document', 'navigator', 'Image', 'BroadcastChannel', 'fetch', bundle.outputFiles[0].text)(
      module, module.exports, window, document, navigator, Image, undefined, () => { throw new Error('No external requests in preview'); },
    );
    module.exports.installDevElectronAPI();
    return { window, api: window.electronAPI!, encoded };
  }
  /** The picture element of the app engine: it decodes when the test says so, at the size the test gives, and until then its natural size is 0, as in the engine. */
  let size = [0, 0], decode = () => {};
  class Picture {
    naturalWidth = 0; naturalHeight = 0; onload = () => {}; onerror = () => {};
    set src(_url: string) { decode = () => { [this.naturalWidth, this.naturalHeight] = size; this.onload(); }; }
  }
  const picked = [{ name: '교실.png' } as File, { name: '복도.jpg' } as File];
  const sent = `data:image/png;base64,${png.toString('base64')}`;
  const tab = preview({});
  await assert.rejects(tab.api.backgroundReadClipboardFile(), /로그인/);
  await tab.api.loginCanonicalSession({ name: '배한솔', password: '1234', rememberMe: false });
  // The clipboard of the preview holds no file until the hook puts a path there.
  assert.equal(await tab.api.backgroundReadClipboardFile(), null);
  tab.window.__bflowMockBackgroundAdd = { clipboardFile: 'C:\\art\\a.png' };
  assert.deepEqual(await tab.api.backgroundReadClipboardFile(), { filePath: 'C:\\art\\a.png' });
  tab.window.__bflowMockBackgroundAdd = { filePath: file => file === picked[1] ? 'C:\\art\\복도.jpg' : '' };
  assert.equal(tab.api.getPathForFile(picked[1]), 'C:\\art\\복도.jpg'); assert.equal(tab.api.getPathForFile(picked[0]), '');
  // A browser tab: with no files from the hook the answer is nothing at all, and the page opens its own file dialog.
  tab.window.__bflowMockBackgroundAdd = undefined;
  assert.equal(await tab.api.backgroundPickImages!(), undefined);
  tab.window.__bflowMockBackgroundAdd = {};
  assert.equal(await tab.api.backgroundPickImages!(), undefined);
  tab.window.__bflowMockBackgroundAdd = { pick: () => picked };
  assert.deepEqual(await tab.api.backgroundPickImages!(), picked);
  // A page that cannot draw (this stand-in has no picture element) gets back what it sent, as it came.
  assert.deepEqual(await tab.api.backgroundUploadImage(sent), { ok: true, url: sent });
  // The check window of the app engine: an empty list, hook or no hook, so no native file dialog is ever opened there.
  const engine = preview({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Electron/33.0.0 Safari/537.36' }, Picture);
  assert.deepEqual(await engine.api.backgroundPickImages!(), []);
  engine.window.__bflowMockBackgroundAdd = {};
  assert.deepEqual(await engine.api.backgroundPickImages!(), []);
  engine.window.__bflowMockBackgroundAdd = { pick: () => picked };
  assert.deepEqual(await engine.api.backgroundPickImages!(), picked);
  // An upload of the preview comes back small (the preview store keeps every picture twice in one value): drawn again once it has decoded, as a WebP of 480px on its long side at most, never larger than it came.
  await engine.api.loginCanonicalSession({ name: '배한솔', password: '1234', rememberMe: false });
  for (const [natural, shrunk] of [[[960, 480], [480, 240]], [[600, 1200], [240, 480]], [[320, 200], [320, 200]]]) {
    size = natural; const upload = engine.api.backgroundUploadImage(sent); decode();
    assert.deepEqual(await upload, { ok: true, url: 'data:image/webp;base64,UklGRg==' });
    assert.deepEqual(engine.encoded.at(-1), { width: shrunk[0], height: shrunk[1], args: ['image/webp', 0.8] });
  }
  // The session is asked once the drawing is done: a login that changed meanwhile gets nothing back.
  const late = engine.api.backgroundUploadImage(sent);
  await engine.api.loginCanonicalSession({ name: '장삐쭈', password: '1234', rememberMe: false });
  decode(); await assert.rejects(late, /세션/);
});
