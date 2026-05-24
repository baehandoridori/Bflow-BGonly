/**
 * v1.26.0 → v1.30.2 — 원본 이미지 + 주석 캔버스 합성.
 *
 * v1.30.2 (한솔 보고 2026-05-24):
 *  - 결과 캔버스를 이미지 크기로 crop (이전: stage 비율로 캔버스가 이미지보다 큰 영역까지 포함하여
 *    이미지 안에만 그려도 결과에 흰 여백이 생기고 커졌음).
 *  - 배경 흰색 채우기 제거 → 투명 (PNG).
 *  - 결과 포맷 JPEG → PNG (alpha 채널 유지).
 *
 * v1.26.2: 캔버스가 stage 비율로 이미지보다 큰 영역으로 확장됨.
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
  quality: number = 0.92,
): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = originalImageUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('원본 이미지 로드 실패'));
  });

  // 결과 캔버스: imageRect 가 있으면 그 크기 (= 이미지 크기), 없으면 annotationCanvas 크기 (호환).
  //   이미지를 (0,0,W,H) 에 그리고, 주석 캔버스는 imageRect 영역만 crop 해서 같은 (0,0,W,H) 에 얹음.
  //   결과: 이미지 + 이미지 위 주석만 포함. 이미지 밖에 그린 주석은 잘림.
  const W = imageRect ? imageRect.imgW : annotationCanvas.width;
  const H = imageRect ? imageRect.imgH : annotationCanvas.height;
  const composite = document.createElement('canvas');
  composite.width = W;
  composite.height = H;
  const ctx = composite.getContext('2d');
  if (!ctx) throw new Error('canvas context 없음');

  // 1) 배경 — 투명 유지 (PNG 결과). 이전엔 흰색으로 채웠지만 한솔 요청.

  // 2) 이미지를 결과 캔버스 전체에 그림 (1:1)
  ctx.drawImage(img, 0, 0, W, H);

  // 3) 주석 캔버스에서 이미지 영역만 잘라서 결과에 합성
  if (imageRect) {
    ctx.drawImage(
      annotationCanvas,
      imageRect.imgX, imageRect.imgY, imageRect.imgW, imageRect.imgH,  // source crop
      0, 0, W, H,                                                       // destination
    );
  } else {
    ctx.drawImage(annotationCanvas, 0, 0);
  }

  return new Promise<Blob>((res, rej) =>
    composite.toBlob(
      (b) => (b ? res(b) : rej(new Error('toBlob 실패'))),
      'image/png',
      quality,
    ),
  );
}
