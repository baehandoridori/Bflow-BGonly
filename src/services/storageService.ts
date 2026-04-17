/**
 * Supabase Storage IPC 래퍼 (렌더러 → 메인)
 *
 * 기존 sheetsUploadImage를 대체. 시그니처 호환 유지.
 */

export async function uploadImage(
  sheetName: string,
  sceneId: string,
  imageType: 'storyboard' | 'guide',
  base64Data: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  return window.electronAPI.storageUploadImage(sheetName, sceneId, imageType, base64Data);
}

export async function deleteImage(url: string): Promise<void> {
  return window.electronAPI.storageDeleteImage(url);
}
