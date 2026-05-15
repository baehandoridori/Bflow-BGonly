/**
 * v1.26.0 — 원본 이미지 + 주석 캔버스 합성.
 *
 * AnnotationCanvas 의 캔버스는 원본 이미지의 자연 크기와 동일하므로
 * 같은 좌표계에서 원본 이미지를 먼저 그리고 그 위에 캔버스를 합성하면
 * 손실 없이 합쳐진다 (JPEG 0.9 압축).
 */

export async function composeAnnotation(
  originalImageUrl: string,
  annotationCanvas: HTMLCanvasElement,
  quality: number = 0.9,
): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = originalImageUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('원본 이미지 로드 실패'));
  });

  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const composite = document.createElement('canvas');
  composite.width = W;
  composite.height = H;
  const ctx = composite.getContext('2d');
  if (!ctx) throw new Error('canvas context 없음');
  ctx.drawImage(img, 0, 0, W, H);
  // annotationCanvas 가 원본과 동일 픽셀 크기여야 정확히 합성됨
  ctx.drawImage(annotationCanvas, 0, 0, W, H);

  return new Promise<Blob>((res, rej) =>
    composite.toBlob(
      (b) => (b ? res(b) : rej(new Error('toBlob 실패'))),
      'image/jpeg',
      quality,
    ),
  );
}
