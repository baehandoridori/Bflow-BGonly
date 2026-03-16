/**
 * Google Drive 이미지 업로드 — Apps Script 웹 앱 경유
 *
 * 이미지는 GAS를 통해 Google Drive에 저장되고, drive-img:// 프로토콜로 표시된다.
 * Supabase 전환 후에도 이미지 업로드만 GAS를 유지한다.
 */

import { gasFetchWithRetry } from './gas-fetch';

let imageUploadUrl: string | null = null;

/** 이미지 업로드용 GAS URL 설정 (sheets.ts initSheets 대체) */
export function setImageUploadUrl(url: string): void {
  imageUploadUrl = url;
}

export function getImageUploadUrl(): string | null {
  return imageUploadUrl;
}

// ─── 이미지 URL 검증 & Google Drive 프록시 변환 ──────────────
// 1. CellImage 쓰레기 값 필터링
// 2. Google Drive uc?export=view URL → drive-img:// 프록시로 변환 (403 방지)

export function sanitizeImageUrl(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';

  // Google Drive URL → drive-img:// 프로토콜로 변환 (렌더러에서 403 차단 우회)
  const driveMatch = trimmed.match(
    /drive\.google\.com\/uc\?export=view&id=([a-zA-Z0-9_-]+)/
  );
  if (driveMatch) {
    return `drive-img://file/${driveMatch[1]}`;
  }

  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('bflow-img://') ||
    trimmed.startsWith('drive-img://')
  ) {
    return trimmed;
  }
  return '';
}

// ─── 이미지 업로드 (Drive에 저장 → URL 반환) ──────────────────

export async function uploadImage(
  sheetName: string,
  sceneId: string,
  imageType: string,
  base64Data: string
): Promise<{ url: string }> {
  if (!imageUploadUrl) throw new Error('이미지 업로드 URL 미설정');

  // base64 data URL에서 순수 데이터와 MIME 타입 추출
  const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 image data');

  const mimeType = match[1];
  const rawBase64 = match[2];

  // POST로 이미지 데이터 전송 (URL 길이 제한 회피)
  const res = await gasFetchWithRetry(imageUploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadImage',
      sheetName,
      sceneId,
      imageType,
      mimeType,
      base64: rawBase64,
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; url?: string; error?: string };
  if (!json.ok) throw new Error(json.error ?? '이미지 업로드 실패');

  // Drive URL → drive-img:// 프록시로 변환하여 즉시 표시 가능하도록
  return { url: sanitizeImageUrl(json.url!) || json.url! };
}
