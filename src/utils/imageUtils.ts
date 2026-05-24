/**
 * 이미지 리사이즈/저장 유틸리티
 *
 * GAS → Drive 업로드 → https:// URL
 */

import * as storageService from '@/services/storageService';

/** File/Blob → 리사이즈 base64 data URL (기본 JPEG, 옵션으로 PNG — alpha 채널 유지 시).
 *  v1.30.2 (코덱스 P1): 주석 결과(투명 PNG) 가 JPEG 재인코딩되면서 검정 matte 되던 문제 fix —
 *  outputMime 인자로 PNG 유지 가능. */
export function resizeBlob(
  file: File | Blob,
  maxSize = 800,
  quality = 0.8,
  outputMime: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resizeDataUrl(reader.result as string, maxSize, quality, outputMime)
        .then(resolve)
        .catch(reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** data URL → 리사이즈 base64 data URL (기본 JPEG, 옵션 PNG). */
export function resizeDataUrl(
  dataUrl: string,
  maxSize = 800,
  quality = 0.8,
  outputMime: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(outputMime, quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** 리사이즈된 base64 를 저장하고 URL 반환 */
export async function saveImage(
  base64: string,
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide',
): Promise<string> {
  const result = await storageService.uploadImage(
    sheetName,
    sceneId,
    imageType,
    base64,
  );
  if (!result.ok || !result.url) {
    throw new Error(result.error ?? '이미지 업로드 실패');
  }
  return result.url;
}

/** Electron 클립보드에서 이미지 읽기 → 저장 → URL 반환
 *  Electron 메인 프로세스에서 이미 리사이즈+JPEG 인코딩 완료 → 재인코딩 불필요 */
export async function pasteImageFromClipboard(
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide',
): Promise<string | null> {
  const dataUrl = await window.electronAPI.clipboardReadImage();
  if (!dataUrl) return null;

  return saveImage(dataUrl, sheetName, sceneId, imageType);
}
