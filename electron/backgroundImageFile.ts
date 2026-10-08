import { open } from 'node:fs/promises';
import path from 'node:path';

export const MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_BACKGROUND_IMAGE_DATA_URL = 2_000_000;

interface ImageFileHandle {
  stat(): Promise<{ size: number; isFile(): boolean }>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export interface BackgroundDecodedImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number }): BackgroundDecodedImage;
  toPNG(): Buffer;
  toJPEG(quality: number): Buffer;
}
export interface BackgroundImageFileDependencies {
  decode(buffer: Buffer): BackgroundDecodedImage;
  openFile?(filePath: string): Promise<ImageFileHandle>;
}

function validatePath(input: string): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096 || /[\u0000-\u001f]/.test(input)) {
    throw new Error('이미지 파일의 전체 경로를 입력해 주세요.');
  }
  const filePath = input.trim();
  const drivePath = /^[a-z]:[\\/]/i.test(filePath);
  const uncPath = /^\\\\[^\\/]+[\\/][^\\/]+[\\/].+/.test(filePath);
  if (/^\\\\[?.][\\/]/.test(filePath) || (!drivePath && !uncPath && !path.posix.isAbsolute(filePath))) {
    throw new Error('웹 주소가 아닌 로컬 또는 공유 드라이브의 전체 파일 경로를 입력해 주세요.');
  }
  // The main process decodes PNG and JPEG only. WebP works through the file picker, where the renderer re-encodes it.
  if (/\.webp$/i.test(filePath)) throw new Error('WebP 파일은 경로로 연결할 수 없습니다. 파일 선택으로 등록하거나 PNG, JPG 파일의 경로를 입력해 주세요.');
  if (!/\.(?:png|jpe?g)$/i.test(filePath)) throw new Error('PNG, JPG, JPEG 이미지 파일만 경로로 연결할 수 있습니다.');
  return filePath;
}

async function readBounded(filePath: string, openFile: NonNullable<BackgroundImageFileDependencies['openFile']>): Promise<Buffer> {
  let file: ImageFileHandle;
  try {
    file = await openFile(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new Error('이미지 파일을 찾을 수 없습니다. 경로와 공유 드라이브 연결을 확인해 주세요.');
    if (code === 'EACCES' || code === 'EPERM') throw new Error('이미지 파일을 읽을 권한이 없습니다.');
    throw new Error('이미지 파일을 열 수 없습니다. 경로와 공유 드라이브 연결을 확인해 주세요.');
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('폴더가 아닌 이미지 파일을 선택해 주세요.');
    if (stat.size > MAX_BACKGROUND_IMAGE_BYTES) throw new Error('이미지는 20MB 이하로 선택해 주세요.');
    // Bound the actual read as well as stat: a shared file may grow while being read.
    const buffer = Buffer.alloc(MAX_BACKGROUND_IMAGE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, Math.min(64 * 1024, buffer.length - offset), offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_BACKGROUND_IMAGE_BYTES) throw new Error('이미지는 20MB 이하로 선택해 주세요.');
    if (!offset) throw new Error('이미지 파일이 비어 있습니다.');
    return buffer.subarray(0, offset);
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error;
    throw new Error('이미지 파일을 읽지 못했습니다. 공유 드라이브 연결을 확인해 주세요.');
  } finally {
    await file.close();
  }
}

/** Reads only a selected image; it never changes the original or uploads it. */
export async function readBackgroundImageFile(input: string, deps: BackgroundImageFileDependencies): Promise<{ dataUrl: string; filePath: string }> {
  const filePath = validatePath(input);
  const buffer = await readBounded(filePath, deps.openFile ?? (filePath => open(filePath, 'r')));
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (!png && !jpeg) throw new Error('이미지 파일이 손상되었거나 지원하지 않는 형식입니다.');
  let image: BackgroundDecodedImage;
  try { image = deps.decode(buffer); } catch { throw new Error('이미지 파일을 읽을 수 없습니다. 파일이 손상되었는지 확인해 주세요.'); }
  const size = image.getSize();
  if (image.isEmpty() || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1) {
    throw new Error('이미지 파일을 읽을 수 없습니다. 파일이 손상되었는지 확인해 주세요.');
  }
  const ratio = Math.min(1, 1600 / size.width, 1600 / size.height);
  let width = Math.max(1, Math.round(size.width * ratio));
  let height = Math.max(1, Math.round(size.height * ratio));
  if (ratio < 1) image = image.resize({ width, height });
  // Only genuine JPEG sources become JPEG; PNG retains transparency.
  for (;;) {
    const data = jpeg ? image.toJPEG(85) : image.toPNG();
    const dataUrl = `data:image/${jpeg ? 'jpeg' : 'png'};base64,${data.toString('base64')}`;
    if (data.length && dataUrl.length <= MAX_BACKGROUND_IMAGE_DATA_URL) return { dataUrl, filePath };
    if (width === 1 && height === 1) throw new Error('이미지 미리보기를 만들 수 없습니다. 다른 이미지 파일을 선택해 주세요.');
    width = Math.max(1, Math.floor(width * .75));
    height = Math.max(1, Math.floor(height * .75));
    image = image.resize({ width, height });
  }
}
