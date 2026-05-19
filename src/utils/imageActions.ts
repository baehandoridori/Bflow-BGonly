/**
 * v1.26.0 — 라이트박스 이미지 액션 헬퍼.
 *
 * - downloadImage: URL 의 이미지를 파일로 저장 (드라이브/HTTP/data URL 모두 지원)
 * - copyImageToClipboard: 클립보드에 PNG 로 복사 (다른 앱에 붙여넣기 가능)
 * - copyImageUrl: URL 자체를 텍스트 클립보드에
 * - generateImageFileName: 파일명 규칙 (sheetName_sceneId_type_vN.jpg)
 */

import { toast } from 'sonner';

export { generateImageFileName } from './imageVersionUtils';

async function fetchImageBlob(url: string): Promise<Blob> {
  if (url.startsWith('drive-img://')) {
    // Electron 우회 — main 프로세스에서 디스크 읽기
    // (drive-img:// 프로토콜은 electron 측에서 정의됨. fetch 는 안 통할 수 있어 IPC 사용)
    // window.electronAPI 에 readDriveImage 가 없을 수 있으니 fetch 도 시도
    try {
      const res = await fetch(url);
      if (res.ok) return res.blob();
    } catch {
      /* fall through */
    }
    throw new Error('drive-img:// 이미지를 가져올 수 없습니다');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
  return res.blob();
}

export async function downloadImage(url: string, fileName: string): Promise<void> {
  try {
    const blob = await fetchImageBlob(url);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
    toast.success(`저장됨: ${fileName}`);
  } catch (err) {
    console.error('[downloadImage] 실패', err);
    toast.error('이미지 다운로드 실패');
  }
}

export async function copyImageToClipboard(url: string): Promise<void> {
  try {
    const blob = await fetchImageBlob(url);

    // JPEG → PNG 변환 (Clipboard API 는 PNG 만 안정적으로 받음)
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const objectUrl = URL.createObjectURL(blob);
    img.src = objectUrl;
    try {
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('이미지 디코딩 실패'));
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas context 없음');
      ctx.drawImage(img, 0, 0);
      const pngBlob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob 실패'))), 'image/png'),
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      toast.success('클립보드에 이미지 복사됨');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (err) {
    console.error('[copyImageToClipboard] 실패', err);
    toast.error('이미지 복사 실패');
  }
}

export async function copyImageUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('URL 복사됨');
  } catch (err) {
    console.error('[copyImageUrl] 실패', err);
    toast.error('URL 복사 실패');
  }
}
