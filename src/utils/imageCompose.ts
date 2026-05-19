/**
 * v1.26.0 → v1.26.2 — 원본 이미지 + 주석 캔버스 합성.
 *
 * v1.26.2: 캔버스가 stage 비율로 이미지보다 큰 영역으로 확장됨.
 *  - 결과 이미지 크기 = 캔버스 자연 크기 (이미지 + 여백)
 *  - 이미지를 캔버스 안의 정확한 위치(imageRect)에 그림
 *  - 캔버스 그림을 그 위에 합성 (같은 좌표계)
 *  - imageRect 가 없으면 (호환) 캔버스 = 이미지 크기로 가정.
 */

export interface ImageRectInCanvas {
  imgX: number;
  imgY: number;
  imgW: number;
  imgH: number;
}

export async function composeAnnotation(
  originalImageUrl: string,
  annotationCanvas: HTMLCanvasElement,
  imageRect: ImageRectInCanvas | null = null,
  quality: number = 0.9,
): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = originalImageUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('원본 이미지 로드 실패'));
  });

  const W = annotationCanvas.width;
  const H = annotationCanvas.height;
  const composite = document.createElement('canvas');
  composite.width = W;
  composite.height = H;
  const ctx = composite.getContext('2d');
  if (!ctx) throw new Error('canvas context 없음');

  // 1) 캔버스 여백을 흰색으로 채움 (이미지 + 여백 패턴)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // 2) 이미지를 캔버스 안의 정확한 위치에
  if (imageRect) {
    ctx.drawImage(img, imageRect.imgX, imageRect.imgY, imageRect.imgW, imageRect.imgH);
  } else {
    // 호환 fallback — 캔버스 = 이미지 크기
    ctx.drawImage(img, 0, 0, W, H);
  }

  // 3) 주석 캔버스를 동일 좌표계에 합성
  ctx.drawImage(annotationCanvas, 0, 0);

  return new Promise<Blob>((res, rej) =>
    composite.toBlob(
      (b) => (b ? res(b) : rej(new Error('toBlob 실패'))),
      'image/jpeg',
      quality,
    ),
  );
}
