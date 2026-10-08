/** Thumbnails only. Original production files remain at their separately recorded filePath. */
import { randomUUID } from 'node:crypto';
import { nativeImage } from 'electron';
import { supabase } from './supabase';

export async function uploadBackgroundImage(base64Data: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    if (base64Data.length > 28_000_000) throw new Error('이미지는 20MB 이하로 선택해 주세요.');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(base64Data);
    if (!match) throw new Error('PNG, JPEG, WebP 이미지 파일을 선택해 주세요.');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('이미지는 20MB 이하로 선택해 주세요.');
    let image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) throw new Error('이미지 파일을 읽을 수 없습니다.');
    const { width, height } = image.getSize();
    if (width > 1600 || height > 1600) {
      const ratio = Math.min(1600 / width, 1600 / height);
      image = image.resize({ width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) });
    }
    const jpeg = match[1] === 'jpeg';
    const path = `backgrounds/${randomUUID()}.${jpeg ? 'jpg' : 'png'}`;
    const contentType = jpeg ? 'image/jpeg' : 'image/png';
    const storage = supabase.storage.from('scene-images');
    const { error } = await storage.upload(path, jpeg ? image.toJPEG(85) : image.toPNG(), { contentType, upsert: false });
    if (error) throw error;
    return { ok: true, url: storage.getPublicUrl(path).data.publicUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '배경 이미지 업로드에 실패했습니다.' };
  }
}
