// 네온 픽셀 아케이드 보드 캔버스 렌더 헬퍼(D 방향 = 네온 픽셀 캐비닛).
// 단색 네온 코어 + 바깥으로 번지는 글로우 + 위쪽만 은은한 광택 — inset 베벨(엠보싱)은 쓰지 않는다.
// 색은 호출부에서 --pg-* 토큰을 rgb(...)로 해석해 넘긴다.

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 어두운 보드 배경 + 은은한 격자선.
export function paintNeonBackground(
  ctx: CanvasRenderingContext2D,
  width: number, height: number, cell: number,
  bg: string, gridColor: string,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = cell; x < width; x += cell) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
  for (let y = cell; y < height; y += cell) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
  ctx.stroke();
  ctx.restore();
}

export interface NeonCellOptions {
  alpha?: number;
  glow?: number;
  radius?: number;
  pad?: number;
}

// 채워진 네온 블록: 코어 단색 + 바깥 글로우(shadowBlur) + 위쪽 광택.
export function drawNeonCell(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, color: string, opts: NeonCellOptions = {},
): void {
  const pad = opts.pad ?? Math.max(1, size * 0.09);
  const radius = opts.radius ?? size * 0.22;
  const inX = x + pad;
  const inY = y + pad;
  const inW = size - pad * 2;
  const inH = size - pad * 2;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.shadowColor = color;
  ctx.shadowBlur = opts.glow ?? size * 0.5;
  ctx.fillStyle = color;
  roundRectPath(ctx, inX, inY, inW, inH, radius);
  ctx.fill();
  ctx.shadowBlur = 0; // 코어를 한 번 더 채워 선명하게(글로우는 바깥으로만 남는다)
  ctx.fill();
  // 위쪽만 밝히는 광택 — 아래를 어둡게 하지 않아 눌린(엠보싱) 느낌이 안 난다.
  const gloss = ctx.createLinearGradient(inX, inY, inX, inY + inH);
  gloss.addColorStop(0, 'rgba(255,255,255,0.32)');
  gloss.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  roundRectPath(ctx, inX, inY, inW, inH, radius);
  ctx.fill();
  ctx.restore();
}

// 고스트(테트리스 착지 미리보기): 채움 없이 네온 윤곽만.
export function drawNeonOutline(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, color: string,
): void {
  const pad = Math.max(1, size * 0.12);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.07);
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.25;
  roundRectPath(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.2);
  ctx.stroke();
  ctx.restore();
}

// 둥근 네온 비콘(스네이크 사과).
export function drawNeonDot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, color: string,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.36;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
