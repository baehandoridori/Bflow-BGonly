/**
 * Supabase Storage 기반 이미지 업로드/삭제
 *
 * - 기존 GAS/Drive 경로를 Storage 버킷 'scene-images'로 대체
 * - nativeImage로 안전망 resize (렌더러에서 이미 변환된 경우 double-resize 방지)
 */

import { nativeImage } from 'electron';
import { supabase } from './supabase';

const BUCKET = 'scene-images';
const MAX_PX = 800;
const JPEG_QUALITY = 80;
const SAFE_SIZE_BYTES = 500 * 1024; // 500KB 이상이면 안전망 resize 고려

/** sheetName 예: "EP01_A_BG" → { ep: "EP01", partId: "A", dept: "BG" } */
function parseSheetName(sheetName: string): { ep: string; partId: string; dept: string } {
  const m = sheetName.match(/^(EP\d+)_([A-Z])_(BG|ACT)$/);
  if (!m) throw new Error(`Invalid sheetName: ${sheetName}`);
  return { ep: m[1], partId: m[2], dept: m[3] };
}

function buildPath(sheetName: string, sceneId: string, imageType: string): string {
  const { ep, partId, dept } = parseSheetName(sheetName);
  // 8자리 hex random suffix로 같은 ms 내 충돌 방지
  const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${ep}/${partId}/${dept}/${sceneId}/${imageType}_${uniq}.jpg`;
}

/** public URL → storage 경로 추출 */
export function extractPathFromPublicUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/scene-images\/(.+)$/);
  return m ? m[1] : null;
}

/** base64 → 필요 시 resize된 JPEG Buffer */
function toBuffer(base64Data: string): Buffer {
  const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 image data');
  const buffer = Buffer.from(match[2], 'base64');

  // 안전망: 이미 작으면 그대로 사용 (renderer에서 이미 처리된 경우)
  if (buffer.length <= SAFE_SIZE_BYTES) return buffer;

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
    return resized.toJPEG(JPEG_QUALITY);
  }
  // 크기는 작은데 파일만 큰 경우 (PNG 등) — JPEG 인코딩만
  return image.toJPEG(JPEG_QUALITY);
}

export async function uploadImage(
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide',
  base64Data: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const buffer = toBuffer(base64Data);
    const path = buildPath(sheetName, sceneId, imageType);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Storage] 업로드 실패:', msg);
    return { ok: false, error: msg };
  }
}

export async function deleteImage(url: string): Promise<void> {
  const path = extractPathFromPublicUrl(url);
  if (!path) return; // 비-Supabase URL은 무시 (legacy drive URL 등)
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('[Storage] 삭제 실패:', error.message);
}
