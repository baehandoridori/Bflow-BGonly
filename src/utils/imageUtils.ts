/**
 * 이미지 리사이즈/저장 유틸리티
 *
 * GAS → Drive 업로드 → https:// URL
 */

/** File/Blob → 리사이즈 JPEG base64 data URL */
export function resizeBlob(
  file: File | Blob,
  maxSize = 800,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resizeDataUrl(reader.result as string, maxSize, quality)
        .then(resolve)
        .catch(reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** data URL → 리사이즈 JPEG base64 data URL (Blob 변환 불필요) */
export function resizeDataUrl(
  dataUrl: string,
  maxSize = 800,
  quality = 0.8,
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
      resolve(canvas.toDataURL('image/jpeg', quality));
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
  const result = await window.electronAPI.sheetsUploadImage(
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
