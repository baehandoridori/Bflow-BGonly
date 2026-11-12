/**
 * Supabase Storage 기반 이미지 업로드/삭제
 *
 * - 기존 GAS/Drive 경로를 Storage 버킷 'scene-images'로 대체
 * - nativeImage로 안전망 resize (렌더러에서 이미 변환된 경우 double-resize 방지)
 * - v1.30.2 (코덱스 P1, 한솔 보고 2026-05-24):
 *   주석 결과(PNG, alpha 채널) 가 toJPEG 으로 재인코딩되면서 투명 픽셀이 검정 matte 되던 문제.
 *   base64 의 mime 을 그대로 보존 — PNG 이면 PNG 로, JPEG 이면 JPEG 로 업로드.
 */

import { nativeImage } from 'electron';
import { supabase } from './supabase';
import { uploadCharacterImageFiles, type CharacterImageStore } from './characterImageUpload';
import { withCharacterOriginalPaths } from '../src/shared/characterImageOriginal';
import { buildSceneImageStoragePath } from '../src/shared/sceneImageStoragePath';

const BUCKET = 'scene-images';
const MAX_PX = 800;
const JPEG_QUALITY = 80;
const SAFE_SIZE_BYTES = 500 * 1024; // 500KB 이상이면 안전망 resize 고려

/** 경로 규칙(씬 번호의 한글 등은 저장소가 받는 글자로 바꿔 적기)은 src/shared/sceneImageStoragePath.ts. */
function buildPath(sheetName: string, sceneId: string, imageType: string, ext: 'jpg' | 'png'): string {
  // 8자리 hex random suffix로 같은 ms 내 충돌 방지
  const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return buildSceneImageStoragePath(sheetName, sceneId, imageType, ext, uniq);
}

/** public URL → storage 경로 추출 */
export function extractPathFromPublicUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/scene-images\/(.+)$/);
  return m ? m[1] : null;
}

interface ProcessedImage {
  buffer: Buffer;
  mime: 'image/jpeg' | 'image/png';
  ext: 'jpg' | 'png';
}

/** base64 → 필요 시 resize. PNG 는 PNG 로, JPEG 은 JPEG 로 보존 (alpha 채널 유지). */
function toBuffer(base64Data: string): ProcessedImage {
  const match = base64Data.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 image data');
  const inputMime = match[1] as 'image/jpeg' | 'image/png';
  const isPng = inputMime === 'image/png';
  const ext: 'jpg' | 'png' = isPng ? 'png' : 'jpg';
  const buffer = Buffer.from(match[2], 'base64');

  // 안전망: 이미 작으면 그대로 사용 (renderer에서 이미 처리된 경우)
  if (buffer.length <= SAFE_SIZE_BYTES) {
    return { buffer, mime: inputMime, ext };
  }

  // 크면 nativeImage로 크기 확인 후 필요할 때만 resize
  const image = nativeImage.createFromBuffer(buffer);
  const { width, height } = image.getSize();
  if (width === 0 || height === 0) {
    throw new Error('Image decode failed');
  }
  if (width > MAX_PX || height > MAX_PX) {
    const ratio = Math.min(MAX_PX / width, MAX_PX / height);
    const resized = image.resize({
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
    });
    return isPng
      ? { buffer: resized.toPNG(), mime: 'image/png', ext: 'png' }
      : { buffer: resized.toJPEG(JPEG_QUALITY), mime: 'image/jpeg', ext: 'jpg' };
  }
  // 크기는 작은데 파일만 큰 경우 — PNG 는 PNG 로, JPEG 은 JPEG 로 재인코딩.
  return isPng
    ? { buffer: image.toPNG(), mime: 'image/png', ext: 'png' }
    : { buffer: image.toJPEG(JPEG_QUALITY), mime: 'image/jpeg', ext: 'jpg' };
}

export async function uploadImage(
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide' | 'comment',
  base64Data: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const processed = toBuffer(base64Data);
    const path = buildPath(sheetName, sceneId, imageType, processed.ext);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, processed.buffer, { contentType: processed.mime, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Storage] 업로드 실패:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * 리테이크 첨부 그림 업로드 — 등록 창이 넘긴 data URL 을 저장소에 올리고 공개 주소를 돌려준다.
 * 예전에는 data URL 을 comp_revisions.image_url 에 그대로 담아, 리테이크 목록을 받을 때마다 그림까지 통째로 받았다
 * (2026-11-05 기준 31장·1.5MB — 그 줄들은 같은 날 revisions/{id}/legacy_*.jpg 로 옮김).
 * 경로: revisions/{revisionId}/{uniq}.{ext}. 실패하면 throw — 호출자가 그림을 줄에 담을지 정한다.
 */
export async function uploadRevisionImage(revisionId: string, dataUrl: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(revisionId)) throw new Error('리테이크 ID가 올바르지 않아요.');
  const processed = toBuffer(dataUrl);
  const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const path = `revisions/${revisionId}/${uniq}.${processed.ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, processed.buffer, { contentType: processed.mime, upsert: false });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function deleteImage(url: string): Promise<void> {
  const path = extractPathFromPublicUrl(url);
  if (!path) return; // 비-Supabase URL은 무시 (legacy drive URL 등)
  // 캐릭터 그림이면 함께 보관한 원본도 같이 지운다.
  const { error } = await supabase.storage.from(BUCKET).remove(withCharacterOriginalPaths([path]));
  if (error) console.warn('[Storage] 삭제 실패:', error.message);
}

const characterImageStore: CharacterImageStore = {
  upload: async (path, body, contentType) => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
    if (error) throw error;
  },
  publicUrl: (path) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
};

/**
 * 캐릭터 복장 대표 이미지 업로드.
 * 씬 이미지(uploadImage)는 sheetName(EP/파트/부서) 경로 규칙에 묶여 있어 캐릭터엔 부적합.
 * 경로: characters/{characterId}/{costumeId}/{uniq}.{ext} (화면용) + 같은 자리의 {uniq}.orig (올린 파일 그대로).
 * originalDataUrl 은 줄이기 전 파일 — '이미지 복사'가 원래 크기로 나가도록 함께 보관한다(없으면 화면용만).
 */
export async function uploadCharacterImage(
  characterId: string,
  costumeId: string,
  base64Data: string,
  originalDataUrl?: string | null,
): Promise<{ ok: boolean; url?: string; error?: string; originalSaved?: boolean }> {
  try {
    const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const result = await uploadCharacterImageFiles(characterImageStore, { characterId, costumeId, uniq, display: toBuffer(base64Data), originalDataUrl });
    return { ok: true, ...result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Storage] 캐릭터 이미지 업로드 실패:', msg);
    return { ok: false, error: msg };
  }
}
