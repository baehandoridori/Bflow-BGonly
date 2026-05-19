/**
 * v1.26.0 — 이미지 버전 관리 서비스 래퍼.
 * window.electronAPI 의 supabaseListImageVersions / supabaseAddImageVersion / supabaseDeleteImageVersion
 * 를 감싸 호출 + 에러 로깅.
 */

import type { ImageType, ImageVersion, ImageVersionKind } from '@/types';

export async function fetchImageVersions(
  sceneId: string,
  imageType: ImageType,
): Promise<ImageVersion[]> {
  if (!sceneId) return [];
  try {
    return await window.electronAPI.supabaseListImageVersions(sceneId, imageType);
  } catch (err) {
    console.error('[imageVersionService] list 실패', err);
    return [];
  }
}

export async function createImageVersion(params: {
  sceneId: string;
  imageType: ImageType;
  kind: ImageVersionKind;
  url: string;
  baseVersionNo?: number;
  createdBy: string;
  description?: string | null;
}): Promise<ImageVersion> {
  return window.electronAPI.supabaseAddImageVersion(params);
}

export async function removeImageVersion(versionId: string): Promise<void> {
  return window.electronAPI.supabaseDeleteImageVersion(versionId);
}
