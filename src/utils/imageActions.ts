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

export async function fetchImageBlob(url: string): Promise<Blob> {
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

/**
 * 그림 Blob 을 PNG 로 클립보드에 쓰고, 쓴 그림의 픽셀 크기를 돌려준다. 실패하면 throw — 안내는 호출부가 한다.
 * 쓰기는 main 이 한다: 화면 쪽 클립보드 API 는 창이 앞에 있을 때만 쓸 수 있어서, 복사를 누르고 곧바로
 * 다른 프로그램(Moho)으로 넘어가면 그림을 받는 사이 창이 바뀌어 실패한다.
 */
export async function writeImageBlobToClipboard(blob: Blob): Promise<{ width: number; height: number }> {
  // 어떤 형식이든 PNG 로 바꿔 넘긴다 (main 의 nativeImage 는 PNG·JPEG 만 읽는다)
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
    // 그 자리에서 바꾸는 toDataURL 을 쓴다 — toBlob 은 창이 가려지면(곧바로 다른 프로그램으로 넘어간 경우) 1초쯤 미뤄진다.
    const binary = atob(canvas.toDataURL('image/png').split(',')[1] ?? '');
    if (!binary) throw new Error('PNG 변환 실패');
    const png = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) png[i] = binary.charCodeAt(i);
    const written = await window.electronAPI.clipboardWriteImage(png);
    if (!written) throw new Error('클립보드 쓰기 실패');
    return { width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function copyImageToClipboard(url: string): Promise<boolean> {
  try {
    await writeImageBlobToClipboard(await fetchImageBlob(url));
    toast.success('클립보드에 이미지 복사됨');
    return true;
  } catch (err) {
    console.error('[copyImageToClipboard] 실패', err);
    toast.error('이미지 복사 실패');
    return false;
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
