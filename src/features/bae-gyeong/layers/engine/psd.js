/* BAE layer engine: the layered PSD (folders = the PD's groups, back to front; each layer cropped to what it shows).
   ag-psd (MIT) writes the file; it is passed in (browser bundle or Node package). */
export function folderName(u) { return u === 'BG' ? 'BG 빈 배경' : u === 'BG 보정' ? 'BG 보정 (빈 배경이 달라진 곳)' : `PROP ${u}`; }
export function tightLayer(L) {                    // a layer's RGBA crop without its empty margin
  const [x0, y0, x1, y1] = L.box, w = x1 - x0, h = y1 - y0; let a = w, b = h, c = -1, d = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (L.rgba[(y * w + x) * 4 + 3]) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  if (c < 0) return null; const tw = c - a + 1, th = d - b + 1, out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) out.set(L.rgba.subarray(((y + b) * w + a) * 4, ((y + b) * w + a + tw) * 4), y * tw * 4);
  return { left: x0 + a, top: y0 + b, right: x0 + a + tw, bottom: y0 + b + th, data: out, w: tw, h: th };
}
export function composite(res) {                   // the stack, back to front, as RGBA (what Photoshop shows as the preview)
  const { W, H, layers, stackKeys } = res; const N = W * H; const f = new Float32Array(N * 3); const bg = layers.get('bg').rgb;
  for (let i = 0; i < N * 3; i++) f[i] = bg[i];
  for (const k of stackKeys) {
    if (k === 'bg') continue; const L = layers.get(k); if (!L || !L.rgba) continue; const [x0, y0, x1, y1] = L.box, cw = x1 - x0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = ((y - y0) * cw + x - x0) * 4, a = L.rgba[q + 3] / 255; if (!a) continue; const o = (y * W + x) * 3; for (let c = 0; c < 3; c++) f[o + c] = L.rgba[q + c] * a + f[o + c] * (1 - a); }
  }
  const out = new Uint8ClampedArray(N * 4); const q = (v) => Math.min(255, Math.max(0, Math.floor(v + .5))); for (let i = 0; i < N; i++) { out[i * 4] = q(f[i * 3]); out[i * 4 + 1] = q(f[i * 3 + 1]); out[i * 4 + 2] = q(f[i * 3 + 2]); out[i * 4 + 3] = 255; }
  return out;
}
export function psdDocument(res) {
  const { W, H, layers, meta, folders, stackKeys } = res; const byKey = new Map(meta.map(m => [m.key, m]));
  const bgRGBA = new Uint8ClampedArray(W * H * 4); const bg = layers.get('bg').rgb; for (let i = 0; i < W * H; i++) { bgRGBA[i * 4] = bg[i * 3]; bgRGBA[i * 4 + 1] = bg[i * 3 + 1]; bgRGBA[i * 4 + 2] = bg[i * 3 + 2]; bgRGBA[i * 4 + 3] = 255; }
  const children = [];
  for (const u of folders) {
    const keys = stackKeys.filter(k => (byKey.get(k) || {}).unit === u); if (!keys.length) continue;
    const kids = [];
    for (const k of keys) {
      const m = byKey.get(k);
      if (k === 'bg') { kids.push({ name: m.name, left: 0, top: 0, right: W, bottom: H, imageData: { width: W, height: H, data: bgRGBA } }); continue; }
      const t = tightLayer(layers.get(k)); if (!t) continue;
      kids.push({ name: m.name, left: t.left, top: t.top, right: t.right, bottom: t.bottom, imageData: { width: t.w, height: t.h, data: t.data } });
    }
    if (kids.length) children.push({ name: folderName(u), opened: true, children: kids });
  }
  return { width: W, height: H, children, imageData: { width: W, height: H, data: composite(res) } };
}
