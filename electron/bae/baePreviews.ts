/**
 * BAE경 미리보기 (plan 14 5-3): 결과는 1600px + 목록용 320px JPEG, 재료는 1600px. 원본은 만든 사람 PC 에만.
 * 저장소 자리는 `bae/{작업 id}/{정해 둔 이름}` — 사용자가 쓴 글자를 경로에 넣지 않는다 (CLAUDE.md 씬 그림 경로 규칙과 같은 뜻).
 */
import { nativeImage } from 'electron';
import { baePreviewPath, type BaePreviewName } from '../../src/shared/bae/jobs';

export interface BaeStorageLike {
  upload(path: string, body: Buffer, opts: { contentType: string; upsert: boolean }): Promise<{ error: { message?: string } | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

/** PNG · JPEG 바이트를 긴 변 max 픽셀 안의 JPEG 로 (작으면 크기 그대로). */
export function makeJpegPreview(bytes: Uint8Array, max: number, quality = 82): { jpeg: Buffer; w: number; h: number } {
  let img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) throw new Error('그림을 읽지 못했어요.');
  const { width, height } = img.getSize();
  const scale = Math.min(1, max / Math.max(width, height));
  if (scale < 1) img = img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' });
  const size = img.getSize();
  return { jpeg: img.toJPEG(quality), w: size.width, h: size.height };
}

/**
 * 한 장을 올리고 공개 주소를 돌려준다. 덮어쓰기(upsert)는 쓰지 않는다 — 저장소 정책이 새로 넣기만 허락할 수 있어서
 * (배경 라이브러리와 같게). 다시 보내기에서 '이미 있음'이 오면 앞서 올라간 것이니 성공으로 본다.
 */
export async function uploadBaePreview(storage: BaeStorageLike, jobId: string, name: BaePreviewName, jpeg: Buffer): Promise<string> {
  const path = baePreviewPath(jobId, name);
  const { error } = await storage.upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message || '')) throw new Error(error.message || 'BAE경 미리보기를 올리지 못했어요.');
  return storage.getPublicUrl(path).data.publicUrl;
}
