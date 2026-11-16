/* BAE layer engine: numbers drawn into an RGBA picture without a canvas (5x7 pixel digits, doubled, white rim) */
const F = { '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'] };
export function drawNumber(rgba, w, h, text, x0, y0, color, scale = 2) {
  const cells = []; let cx = 0;
  for (const ch of text) { const g = F[ch]; if (!g) { cx += 3; continue; } for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '1') cells.push([cx + c, r]); cx += 6; }
  const put = (x, y, col) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const k = (y * w + x) * 4; rgba[k] = col[0]; rgba[k + 1] = col[1]; rgba[k + 2] = col[2]; rgba[k + 3] = 255; };
  for (const [c, r] of cells) for (let dy = -1; dy <= scale; dy++) for (let dx = -1; dx <= scale; dx++) put(x0 + c * scale + dx, y0 + r * scale + dy, [255, 255, 255]);
  for (const [c, r] of cells) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(x0 + c * scale + dx, y0 + r * scale + dy, color);
}
