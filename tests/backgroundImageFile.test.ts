import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { readBackgroundImageFile, MAX_BACKGROUND_IMAGE_BYTES, MAX_BACKGROUND_IMAGE_DATA_URL } from '../electron/backgroundImageFile.ts';
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

test('linked image reader keeps WebP transparency and only encodes actual JPEG sources as JPEG', async () => {
  const webp = Buffer.from('RIFF0000WEBPfixture'), decoder = decoderFixture();
  const webpResult = await readBackgroundImageFile('C:\\source.webp', { ...fileFixture(webp), ...decoder });
  assert.match(webpResult.dataUrl, /^data:image\/png;/); assert.equal(decoder.state().jpegCalls, 0);
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
