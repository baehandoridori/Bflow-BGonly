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

export interface CanvasSize {
  width: number;
  height: number;
}

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampRect(bounds: RectBounds, canvas: CanvasSize): RectBounds | null {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(canvas.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(canvas.height, Math.ceil(bounds.y + bounds.height));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function unionRect(a: RectBounds, b: RectBounds): RectBounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function calculateAnnotationExportBounds(
  canvas: CanvasSize,
  imageRect: ImageRectInCanvas,
  annotationBounds: RectBounds | null,
): RectBounds {
  const imageBounds = clampRect(
    {
      x: imageRect.imgX,
      y: imageRect.imgY,
      width: imageRect.imgW,
      height: imageRect.imgH,
    },
    canvas,
  ) ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };

  const clampedAnnotation = annotationBounds ? clampRect(annotationBounds, canvas) : null;
  return clampedAnnotation ? unionRect(imageBounds, clampedAnnotation) : imageBounds;
}

function findAnnotationPixelBounds(annotationCanvas: HTMLCanvasElement): RectBounds | null {
  const ctx = annotationCanvas.getContext('2d');
  if (!ctx) return null;

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, annotationCanvas.width, annotationCanvas.height).data;
  } catch {
    return {
      x: 0,
      y: 0,
      width: annotationCanvas.width,
      height: annotationCanvas.height,
    };
  }

  let minX = annotationCanvas.width;
  let minY = annotationCanvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < annotationCanvas.height; y++) {
    for (let x = 0; x < annotationCanvas.width; x++) {
      const alpha = data[(y * annotationCanvas.width + x) * 4 + 3];
      if (alpha === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
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

  const exportBounds = imageRect
    ? calculateAnnotationExportBounds(
      { width: annotationCanvas.width, height: annotationCanvas.height },
      imageRect,
      findAnnotationPixelBounds(annotationCanvas),
    )
    : { x: 0, y: 0, width: annotationCanvas.width, height: annotationCanvas.height };

  const W = exportBounds.width;
  const H = exportBounds.height;
  const composite = document.createElement('canvas');
  composite.width = W;
  composite.height = H;
  const ctx = composite.getContext('2d');
  if (!ctx) throw new Error('canvas context 없음');

  // 1) 배경 — 투명 유지 (PNG 결과). 이전엔 흰색으로 채웠지만 한솔 요청.

  // 2) 원본 이미지는 exportBounds 안의 상대 위치에 배치.
  //    이미지 바깥에 그린 주석은 결과 캔버스를 확장하고, 남는 영역은 PNG 투명도로 유지한다.
  if (imageRect) {
    ctx.drawImage(
      img,
      0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height,
      imageRect.imgX - exportBounds.x,
      imageRect.imgY - exportBounds.y,
      imageRect.imgW,
      imageRect.imgH,
    );
  } else {
    ctx.drawImage(img, 0, 0, W, H);
  }

  // 3) 실제 exportBounds 만큼의 주석을 합성. 이미지 밖 주석도 잘리지 않는다.
  ctx.drawImage(
    annotationCanvas,
    exportBounds.x, exportBounds.y, exportBounds.width, exportBounds.height,
    0, 0, W, H,
  );

  return new Promise<Blob>((res, rej) =>
    composite.toBlob(
      (b) => (b ? res(b) : rej(new Error('toBlob 실패'))),
      'image/png',
      quality,
    ),
  );
}
