// BAE경 PoC 4 (Electron 33 main process, the kind of process Bflow has; models on the graphics card through DirectML).
// 'BiRefNet chooses and cuts': the PD still says WHICH props (names and boxes) and SAM finds them in their boxes, but
// each prop's pixels are BiRefNet's: it is shown the prop with every other prop painted out by the empty background
// (GPT's), and where the prop is cut by the picture's edge the frame is widened with the background's colour, so a
// prop that is not the 'main subject' of its crop (a table as wide as the picture) is found too.
// Those outlines go into the engine's split (touching pairs, front/back, hidden parts, layers: bir/split_bir.js),
// then BiRefNet's soft edge is laid on each layer (where two props meet, the engine's cut stays, so no seam opens).
// GPT answers: saved ones (the meeting room's rebuilt from the artist's own PSD), 0 won. Warm-up: 소나무 거실.
// Writes out4/poc4.log, out4/poc4_result.json, out4/<pic>_new.psd, out4/dbg/ (what BiRefNet saw and answered).
import { app } from 'electron';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const OUT = path.join(HERE, 'out6'); fs.mkdirSync(path.join(OUT, 'dbg'), { recursive: true });
const E = path.join(HERE, 'bae-layers'); const SMP = path.join(E, 'sample') + path.sep;
const BIREF = process.env.BAE_BIREF || 'C:\\Users\\user\\Downloads\\BAE_model_compare\\birefnet_full_fp16.onnx';
const log = (...a) => { try { fs.appendFileSync(path.join(OUT, 'poc6.log'), '[' + new Date().toTimeString().slice(0, 8) + '] ' + a.join(' ') + '\n'); } catch (e) { /* ignore */ } };
process.on('uncaughtException', (e) => { log('uncaught', (e && e.stack) || e); app.exit(1); });
process.on('unhandledRejection', (e) => { log('unhandled', (e && e.stack) || e); app.exit(1); });
try { process.stdout.on('error', () => {}); process.stderr.on('error', () => {}); } catch (e) { /* ignore */ }
app.on('window-all-closed', () => {});
app.whenReady().then(async () => { try { await run(); } catch (e) { log('ERROR', (e && e.stack) || e); } app.quit(); });

const imp = (p) => import(pathToFileURL(path.join(HERE, p)).href);
const MEAN = [.485, .456, .406], STD = [.229, .224, .225];
function f32ToF16(f) { const b = new Float32Array(1), u = new Uint32Array(b.buffer); const o = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) { b[0] = f[i]; const x = u[0], s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
    if (e <= 0) o[i] = s; else if (e >= 31) o[i] = s | 0x7c00; else o[i] = s | (e << 10) | (m >>> 13); } return o; }
function f16ToF32(h) { const o = new Float32Array(h.length); for (let i = 0; i < h.length; i++) { const x = h[i], s = x & 0x8000 ? -1 : 1, e = (x >>> 10) & 31, m = x & 1023;
  o[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15); } return o; }
function prepCrop(rgb, cw, ch) {                 // a crop (RGB) -> 1024x1024 (stretched), ImageNet-normalised, NCHW
  const N = 1024, out = new Float32Array(3 * N * N);
  for (let y = 0; y < N; y++) { const sy = Math.min(ch - 1, Math.max(0, (y + .5) * ch / N - .5)), y0i = Math.floor(sy), y1i = Math.min(ch - 1, y0i + 1), fy = sy - y0i;
    for (let x = 0; x < N; x++) { const sx = Math.min(cw - 1, Math.max(0, (x + .5) * cw / N - .5)), x0i = Math.floor(sx), x1i = Math.min(cw - 1, x0i + 1), fx = sx - x0i;
      const p00 = (y0i * cw + x0i) * 3, p01 = (y0i * cw + x1i) * 3, p10 = (y1i * cw + x0i) * 3, p11 = (y1i * cw + x1i) * 3;
      for (let c = 0; c < 3; c++) { const v = (rgb[p00 + c] * (1 - fx) + rgb[p01 + c] * fx) * (1 - fy) + (rgb[p10 + c] * (1 - fx) + rgb[p11 + c] * fx) * fy;
        out[c * N * N + y * N + x] = (v / 255 - MEAN[c]) / STD[c]; } } }
  return out;
}
function back(o, cw, ch) {                       // 1024x1024 answer -> crop size, 0..1
  const N = 1024, out = new Float32Array(cw * ch); let lo = Infinity, hi = -Infinity; for (let i = 0; i < o.length; i += 97) { lo = Math.min(lo, o[i]); hi = Math.max(hi, o[i]); }
  const sig = lo < -.01 || hi > 1.01;
  for (let y = 0; y < ch; y++) { const sy = Math.min(N - 1, Math.max(0, (y + .5) * N / ch - .5)), a = Math.floor(sy), b = Math.min(N - 1, a + 1), fy = sy - a;
    for (let x = 0; x < cw; x++) { const sx = Math.min(N - 1, Math.max(0, (x + .5) * N / cw - .5)), c = Math.floor(sx), d = Math.min(N - 1, c + 1), fx = sx - c;
      let v = (o[a * N + c] * (1 - fx) + o[a * N + d] * fx) * (1 - fy) + (o[b * N + c] * (1 - fx) + o[b * N + d] * fx) * fy; if (sig) v = 1 / (1 + Math.exp(-v)); out[y * cw + x] = Math.min(1, Math.max(0, v)); } }
  return out;
}
const cropOf = (box, W, H) => { const [bx0, by0, bx1, by1] = box; const mg = Math.max(16, Math.round(.12 * Math.max(bx1 - bx0, by1 - by0))); return [Math.max(0, bx0 - mg), Math.max(0, by0 - mg), Math.min(W, bx1 + mg), Math.min(H, by1 + mg)]; };

async function run() {
  const ortMod = await import('onnxruntime-node'); const ort = ortMod.default || ortMod;
  const agMod = await import('ag-psd'); const ag = agMod.writePsdBuffer ? agMod : agMod.default;
  const pngMod = await import('pngjs'); const PNG = pngMod.PNG || pngMod.default.PNG;
  const env = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, gameRunning: process.env.BAE_GAME || '?' };
  log('env', JSON.stringify(env));
  const { nodeCodec, nodeSam } = await imp('bae-layers/adapters/node.js'); const { planLayers } = await imp('bae-layers/src/planner.js');
  const { defaultPlan } = await imp('bae-layers/src/planview.js'); const { splitWithPlan } = await imp('bir/split_bir.js'); const { assemblePlan } = await imp('bae-layers/src/assemble.js');
  const B = await imp('bae-layers/src/bm.js'); const I = await imp('bae-layers/src/img.js'); const { clean } = await imp('bae-layers/src/prep.js');
  const codec = nodeCodec(); const R = { env, pictures: [] };
  const sam0 = await nodeSam({ dir: path.join(HERE, 'models'), ep: 'dml', log: (s) => log('  sam:', s), onEp: (ep) => log('  SAM fell back to', ep) });
  let picId = 'none';                              // the engine names every picture 'orig': one SAM memory per picture
  const sam = { setImage: (k, rgb, W, H) => sam0.setImage(k + '@' + picId, rgb, W, H), predict: (a) => sam0.predict(a), predictAll: (a) => sam0.predictAll(a), get ep() { return sam0.ep; }, dispose: () => sam0.dispose() };
  let t = Date.now(); let bir = null, birEp = 'dml';
  try { bir = await ort.InferenceSession.create(BIREF, { executionProviders: ['dml'] }); } catch (e) { log('BiRefNet on dml failed:', String(e).slice(0, 200)); birEp = 'cpu'; bir = await ort.InferenceSession.create(BIREF, { executionProviders: ['cpu'] }); }
  R.birefnet_session_ms = Date.now() - t; log('BiRefNet session', R.birefnet_session_ms, 'ms on', birEp);
  let half = false;
  async function birRun(x) {
    const feed = (h) => ({ [bir.inputNames[0]]: h ? new ort.Tensor('float16', f32ToF16(x), [1, 3, 1024, 1024]) : new ort.Tensor('float32', x, [1, 3, 1024, 1024]) });
    let o; try { o = await bir.run(feed(half)); } catch (e) { if (half || !/type|float16|tensor\(float16\)/i.test(String(e))) throw e; half = true; o = await bir.run(feed(true)); }
    const v = o[bir.outputNames[0]]; return v.type === 'float16' ? f16ToF32(v.data) : v.data;
  }
  const rgbPng = (file, w, h, rgb) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i * 4] = rgb[i * 3]; p.data[i * 4 + 1] = rgb[i * 3 + 1]; p.data[i * 4 + 2] = rgb[i * 3 + 2]; p.data[i * 4 + 3] = 255; } fs.writeFileSync(file, PNG.sync.write(p)); };
  const grayPng = (file, w, h, f) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { const v = Math.round(255 * f(i)); p.data[i * 4] = p.data[i * 4 + 1] = p.data[i * 4 + 2] = v; p.data[i * 4 + 3] = 255; } fs.writeFileSync(file, PNG.sync.write(p)); };
  const psdOut = (psd, file) => { const t0 = Date.now(); const buf = ag.writePsdBuffer(psd); const ms = Date.now() - t0; if (file) fs.writeFileSync(file, buf); return { ms, bytes: buf.length }; };

  // ---- 1. outlines: BiRefNet, shown each prop alone (the other props painted out by the empty background) ----
  let dump = null; const birById = new Map(); let refineMs = 0;
  async function refineOutlines({ W, H, orig, plate, objs, ms }) {
    const t0 = Date.now(); const out = [], report = [];
    for (let i = 0; i < objs.length; i++) {
      const m = ms[i]; const cb = cropOf(m.box(), W, H), cw = cb[2] - cb[0], ch = cb[3] - cb[1];
      const own = B.crop(B.dil(m, 4, W, H), cb); const oth = B.crop(B.dil(B.union(ms.filter((_, k) => k !== i)), 4, W, H), cb);   // other props painted out with their soft rims
      const rgb = new Uint8Array(cw * ch * 3); let painted = 0;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const q = y * cw + x, g = ((y + cb[1]) * W + x + cb[0]) * 3; const src = oth[q] && !own[q] ? plate : orig; if (src === plate) painted++; rgb[q * 3] = src[g]; rgb[q * 3 + 1] = src[g + 1]; rgb[q * 3 + 2] = src[g + 2]; }
      // a prop cut by the picture's edge (a table as wide as the picture): BiRefNet takes what touches the frame for
      // background, so the frame is widened there with the background's own colour and the prop shows whole
      const pd = Math.max(32, Math.round(.08 * Math.max(cw, ch))); const pl = cb[0] === 0 ? pd : 0, pt = cb[1] === 0 ? pd : 0, pr = cb[2] === W ? pd : 0, pb = cb[3] === H ? pd : 0;
      let a;
      if (pl + pt + pr + pb === 0) a = back(await birRun(prepCrop(rgb, cw, ch)), cw, ch);
      else {
        const vals = [[], [], []]; for (let q = 0; q < cw * ch; q += 7) if (!own[q] && !oth[q]) for (let c = 0; c < 3; c++) vals[c].push(rgb[q * 3 + c]);
        const bgc = vals.map(v => v.length ? I.median(v) : 128); const pw = cw + pl + pr, ph = ch + pt + pb; const big = new Uint8Array(pw * ph * 3);
        for (let q = 0; q < pw * ph; q++) { big[q * 3] = bgc[0]; big[q * 3 + 1] = bgc[1]; big[q * 3 + 2] = bgc[2]; }
        for (let y = 0; y < ch; y++) big.set(rgb.subarray(y * cw * 3, (y + 1) * cw * 3), ((y + pt) * pw + pl) * 3);
        const ab = back(await birRun(prepCrop(big, pw, ph)), pw, ph); a = new Float32Array(cw * ch);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) a[y * cw + x] = ab[(y + pt) * pw + x + pl];
        if (dump) rgbPng(path.join(dump, `${i}_input_widened.png`), pw, ph, big);
      }
      // which prop: SAM's (grown 12 px); BiRefNet's pixels only there. Agreement with SAM (IoU) >= 0.85 -> BiRefNet's outline
      const gate = B.crop(B.dil(m, 12, W, H), cb), sm = B.crop(m, cb); let inter = 0, uni = 0; const bin = new Uint8Array(cw * ch);
      for (let q = 0; q < cw * ch; q++) { if (!gate[q]) a[q] = 0; const b = a[q] > .5; bin[q] = b ? 1 : 0; if (sm[q] && b) inter++; if (sm[q] || b) uni++; }
      const iou = uni ? inter / uni : 0; const name = objs[i].name;
      if (dump) { rgbPng(path.join(dump, `${i}_input.png`), cw, ch, rgb); grayPng(path.join(dump, `${i}_birefnet.png`), cw, ch, (q) => a[q]); grayPng(path.join(dump, `${i}_sam.png`), cw, ch, (q) => sm[q]); }
      if (iou < .85) { out.push(m); report.push({ name, crop: cb, painted_px: painted, widened: pl + pt + pr + pb > 0 ? [pl, pt, pr, pb] : null, iou: +iou.toFixed(3), used: 'sam' }); continue; }
      const core = B.crop(B.ero(m, 6, W, H), cb); for (let q = 0; q < cw * ch; q++) if (core[q]) bin[q] = 1;
      // what BiRefNet adds outside SAM's outline must be at least 3 px thick (no 1-px spikes where another prop's edge was)
      const opened = I.open(bin, cw, ch, I.rect(1)); for (let q = 0; q < cw * ch; q++) if (bin[q] && !sm[q] && !opened[q]) bin[q] = 0;
      const nm = clean(B.fromCrop(bin, cb), W, H); out.push(nm && !nm.empty ? nm : m);
      if (objs[i].id != null) birById.set(objs[i].id, { cb, a });
      report.push({ name, crop: cb, painted_px: painted, widened: pl + pt + pr + pb > 0 ? [pl, pt, pr, pb] : null, iou: +iou.toFixed(3), used: 'birefnet', px_sam: B.count(m), px_birefnet: B.count(nm) });
    }
    // two props claiming the same pixels (a table's soft edge running up into a chair's bottom): each such pixel goes to
    // the prop whose own colour (the middle colour of its inside) it is clearly closer to - in flat cel colours that is the line
    const med = out.map((m) => { const c = B.ero(m, 6, W, H); const use = B.count(c) > 50 ? c : m; const v = [[], [], []];
      for (let y = 0; y < use.h; y += 2) for (let x = 0; x < use.w; x += 2) if (use.d[y * use.w + x]) { const g = ((y + use.y0) * W + x + use.x0) * 3; for (let k = 0; k < 3; k++) v[k].push(orig[g + k]); }
      return v.map(a => a.length ? I.median(a) : 0); });
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const both = B.and(out[i], out[j]); if (both.empty || !B.count(both)) continue; const toI = new Uint8Array(both.d.length), toJ = new Uint8Array(both.d.length); let ni = 0, nj = 0;
      // when the colour does not settle it (a soft edge pixel, half prop and half wall), the prop whose SAM outline is nearer
      const pb = [Math.max(0, both.x0 - 16), Math.max(0, both.y0 - 16), Math.min(W, both.x1 + 16), Math.min(H, both.y1 + 16)], pw = pb[2] - pb[0], ph = pb[3] - pb[1];
      const si = B.crop(ms[i], pb), sj = B.crop(ms[j], pb); const ui = new Uint8Array(pw * ph), uj = new Uint8Array(pw * ph); for (let q = 0; q < pw * ph; q++) { ui[q] = si[q] ? 0 : 1; uj[q] = sj[q] ? 0 : 1; }
      const Di = I.edt(ui, pw, ph).dist, Dj = I.edt(uj, pw, ph).dist;
      for (let y = 0; y < both.h; y++) for (let x = 0; x < both.w; x++) { const q = y * both.w + x; if (!both.d[q]) continue; const g = ((y + both.y0) * W + x + both.x0) * 3;
        let di = 0, dj = 0; for (let k = 0; k < 3; k++) { di += Math.abs(orig[g + k] - med[i][k]); dj += Math.abs(orig[g + k] - med[j][k]); }
        const q2 = (y + both.y0 - pb[1]) * pw + x + both.x0 - pb[0]; const toIi = Math.abs(di - dj) > 20 ? di < dj : Di[q2] <= Dj[q2];
        if (toIi) { toI[q] = 1; ni++; } else { toJ[q] = 1; nj++; } }
      const bb = [both.x0, both.y0, both.x1, both.y1];
      out[i] = B.andNot(out[i], B.fromCrop(toJ, bb)); out[j] = B.andNot(out[j], B.fromCrop(toI, bb));
      const ri = report.find(r => r.name === objs[i].name), rj = report.find(r => r.name === objs[j].name);
      if (ri) ri.shared_px_kept = (ri.shared_px_kept || 0) + ni; if (rj) rj.shared_px_kept = (rj.shared_px_kept || 0) + nj;
    }
    // after that split, again: what is left of BiRefNet's additions outside SAM's outline must be at least 5 px thick
    for (let i = 0; i < out.length; i++) {
      const m = out[i]; if (!m || m.empty || m === ms[i]) continue; const bx = B.pad(m, 3, W, H), bw = bx[2] - bx[0], bh = bx[3] - bx[1];
      const sub = B.crop(m, bx), sm = B.crop(ms[i], bx), op = I.open(sub, bw, bh, I.rect(2)); let cut = 0;   // 5 px: a corner sliver can be 3 px wide with its soft rim
      for (let q = 0; q < bw * bh; q++) if (sub[q] && !sm[q] && !op[q]) { sub[q] = 0; cut++; }
      if (cut) { out[i] = B.fromCrop(sub, bx); const r = report.find(x => x.name === objs[i].name); if (r) r.thin_px_dropped = cut; }
    }
    // SAM's pixels that BiRefNet left out, that no other prop took and that are not the empty background either: they stay
    // with the prop (else they end up in 'BG 보정' and stay behind when the prop's layer is hidden or moved - the TV
    // frame's outer 1~2 px on its left and right, where BiRefNet's edge was a little inside)
    const taken = new Uint8Array(W * H); for (const m of out) B.orInto(taken, m, W);
    for (let i = 0; i < out.length; i++) {
      const lost = B.andNot(ms[i], out[i]); if (lost.empty) continue; const back = new Uint8Array(lost.d.length); let nb = 0;
      for (let y = 0; y < lost.h; y++) for (let x = 0; x < lost.w; x++) { const q = y * lost.w + x; if (!lost.d[q]) continue; const gi = (y + lost.y0) * W + x + lost.x0, g = gi * 3;
        if (taken[gi]) continue; const dp = Math.max(Math.abs(orig[g] - plate[g]), Math.abs(orig[g + 1] - plate[g + 1]), Math.abs(orig[g + 2] - plate[g + 2])); if (dp > 24) { back[q] = 1; nb++; } }
      if (nb) { out[i] = B.or(out[i], B.fromCrop(back, [lost.x0, lost.y0, lost.x1, lost.y1])); const r = report.find(x => x.name === objs[i].name); if (r) r.kept_from_sam_px = nb; }
    }
    refineMs = Date.now() - t0; return { ms: out, report };
  }

  // ---- 2. BiRefNet's soft edge on each layer (the outline is already BiRefNet's; this adds the in-between pixels) ----
  function softEdge(built, k, owner, t, cut) {
    const { W, H, orig, plate } = built; const L = built.res.layers.get(k); const vis = L.vis; const { cb, a: bA } = cut; const cbw = cb[2] - cb[0];
    const gate = B.dil(vis, 10, W, H), core = B.ero(vis, 6, W, H);
    const nb = B.boxUnion(L.box, gate.box()); const nw = nb[2] - nb[0], nh = nb[3] - nb[1], n = nw * nh;
    const visC = B.crop(vis, nb), gateC = B.crop(gate, nb), coreC = B.crop(core, nb); const birG = new Float32Array(n);
    for (let y = Math.max(nb[1], cb[1]); y < Math.min(nb[3], cb[3]); y++) for (let x = Math.max(nb[0], cb[0]); x < Math.min(nb[2], cb[2]); x++) { const q = (y - nb[1]) * nw + x - nb[0]; birG[q] = gateC[q] ? bA[(y - cb[1]) * cbw + x - cb[0]] : 0; }
    let inter = 0, uni = 0; for (let q = 0; q < n; q++) { const s = visC[q], b = birG[q] > .5; if (s && b) inter++; if (s || b) uni++; }
    const iou = uni ? inter / uni : 0; if (iou < .85) return { iou: +iou.toFixed(3), soft: 'engine' };
    const P = 9, ob = [Math.max(0, nb[0] - P), Math.max(0, nb[1] - P), Math.min(W, nb[2] + P), Math.min(H, nb[3] + P)], ow = ob[2] - ob[0], oh = ob[3] - ob[1];
    const notOth = new Uint8Array(ow * oh).fill(1); for (let y = ob[1]; y < ob[3]; y++) for (let x = ob[0]; x < ob[2]; x++) { const o = owner[y * W + x]; if (o >= 0 && o !== t) notOth[(y - ob[1]) * ow + x - ob[0]] = 0; }
    const { dist: dOth } = I.edt(notOth, ow, oh, false);
    const [l0, m0, l1, m1] = L.box, lw = l1 - l0; const a0 = new Float32Array(n), c0 = new Uint8Array(n * 3), as0 = new Float32Array(n);
    for (let y = m0; y < m1; y++) for (let x = l0; x < l1; x++) { const s = ((y - m0) * lw + x - l0) * 4, q = (y - nb[1]) * nw + x - nb[0];
      a0[q] = L.body[s + 3] / 255; c0[q * 3] = L.body[s]; c0[q * 3 + 1] = L.body[s + 1]; c0[q * 3 + 2] = L.body[s + 2]; if (L.shadow && L.shadow[s + 3]) as0[q] = 1 - L.shadow[s] / 255; }
    const a = new Float32Array(n), col = new Uint8Array(n * 3), fixed = new Uint8Array(n); let changed = 0;
    const keepEngine = (q) => { a[q] = a0[q]; col[q * 3] = c0[q * 3]; col[q * 3 + 1] = c0[q * 3 + 1]; col[q * 3 + 2] = c0[q * 3 + 2]; fixed[q] = 1; };
    for (let q = 0; q < n; q++) {
      const y = (q / nw) | 0, x = q - y * nw, gx = x + nb[0], gy = y + nb[1], gi = gy * W + gx, g = gi * 3; const own = owner[gi];
      if (own >= 0 && own !== t) { keepEngine(q); continue; }
      if (dOth[(gy - ob[1]) * ow + gx - ob[0]] <= 8) { keepEngine(q); continue; }   // where two props meet: the engine's cut (already BiRefNet's line)
      col[q * 3] = orig[g]; col[q * 3 + 1] = orig[g + 1]; col[q * 3 + 2] = orig[g + 2];
      const m = Math.max(birG[q], coreC[q]);
      if (own === t && m < .5) { const dp = Math.max(Math.abs(orig[g] - plate[g]), Math.abs(orig[g + 1] - plate[g + 1]), Math.abs(orig[g + 2] - plate[g + 2])); if (dp <= 24) a[q] = 0; else keepEngine(q); }
      else a[q] = m;
      if (Math.abs(a[q] - a0[q]) > .02) changed++;
    }
    const notSolid = new Uint8Array(n); let anySolid = false; for (let q = 0; q < n; q++) { if (a[q] >= .98) anySolid = true; else notSolid[q] = 1; }
    if (anySolid) { const { idx } = I.edt(notSolid, nw, nh, true); for (let q = 0; q < n; q++) if (notSolid[q] && a[q] > 0 && !fixed[q]) { const s = idx[q]; col[q * 3] = col[s * 3]; col[q * 3 + 1] = col[s * 3 + 1]; col[q * 3 + 2] = col[s * 3 + 2]; } }
    const body = new Uint8Array(n * 4), rgba = new Uint8Array(n * 4); let shadow = null;
    for (let q = 0; q < n; q++) {
      const ao = a[q] + as0[q] * (1 - a[q]), f = a[q] / Math.max(ao, 1e-6);
      for (let c = 0; c < 3; c++) { body[q * 4 + c] = col[q * 3 + c]; rgba[q * 4 + c] = Math.trunc(Math.min(255, col[q * 3 + c] * f)); }
      body[q * 4 + 3] = Math.trunc(a[q] * 255 + .5); rgba[q * 4 + 3] = Math.trunc(ao * 255 + .5);
      if (as0[q] > 0) { shadow = shadow || new Uint8Array(n * 4); const gv = Math.trunc(255 * (1 - as0[q]) + .5); shadow[q * 4] = shadow[q * 4 + 1] = shadow[q * 4 + 2] = gv; shadow[q * 4 + 3] = 255; }
    }
    built.res.layers.set(k, Object.assign({}, L, { box: nb, rgba, body, shadow }));
    return { iou: +iou.toFixed(3), soft: 'birefnet', changed_px: changed };
  }

  const pics = (process.env.BAE_PICS || 'sonamu,meetA,meetB').split(',');
  for (const which of pics) {
    const C = which === 'meetA'
      ? { pic: SMP + 'meetA.png', inv: SMP + 'meetA_inventory2.json', depth: SMP + 'meetA_depth.json', plate: SMP + 'meetA_plate.png', edits: [] }
      : which === 'meetB'
      ? { pic: SMP + 'meetB.png', inv: SMP + 'meetB_inventory2.json', depth: SMP + 'meetB_depth.json', plate: SMP + 'meetB_plate.png', edits: [{ prompt: fs.readFileSync(SMP + 'meetB_edit_c0_prompt.txt', 'utf8'), png: fs.readFileSync(SMP + 'meetB_edit_c0.png') }] }
      : { pic: SMP + 'sonamu.png', inv: SMP + 'sonamu_inventory2.json', depth: null, plate: SMP + 'sonamu_plate.png', edits: [] };
    picId = which + ':' + Date.now(); const calls = []; birById.clear();
    dump = which !== 'sonamu' ? path.join(OUT, 'dbg_' + which) : null; if (dump) fs.mkdirSync(dump, { recursive: true });
    const gpt = {
      async pd(r) { calls.push('pd:' + r.name); if (r.name === 'inventory') return { json: JSON.parse(fs.readFileSync(C.inv, 'utf8')), usd: 0 }; if (r.name === 'depth') return { json: C.depth ? JSON.parse(fs.readFileSync(C.depth, 'utf8')) : { pairs: [] }, usd: 0 };
        if (r.name === 'describe') return { json: { name: '추가 물건', group: '추가', en: 'the added prop', see_through: false }, usd: 0 }; throw new Error('pd ' + r.name); },
      async edit(r) {                              // no saved 'hidden part' pictures for these: GPT 'changed nothing' (the picture comes back as it went),
        if (!r.mask) { calls.push('img:plate'); return { png: new Uint8Array(fs.readFileSync(C.plate)), usd: 0 }; }   // so no hidden part is added (the artist's PSD has none either)
        if (C.edits.length) { calls.push('img:front removed (rebuilt from the PSD)'); const cm = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; }; return { png: new Uint8Array(C.edits.slice().sort((a, b) => cm(b.prompt, r.prompt) - cm(a.prompt, r.prompt))[0].png), usd: 0 }; }
        calls.push('img:front removed (stand-in: unchanged picture)'); return { png: new Uint8Array(r.image), usd: 0 };
      },
    };
    const mem = new Map(); const store = { async get(k) { return mem.get(k); }, async set(k, v) { mem.set(k, v); } };
    const img = codec.decodePng(fs.readFileSync(C.pic)); const T = {};
    let t1 = Date.now(); const P = await planLayers({ image: img, gpt, codec, sam, store }); T.find_ms = Date.now() - t1;
    const plan = defaultPlan(P.objs, P.far);
    t1 = Date.now(); const built = await splitWithPlan({ P, plan, gpt, codec, sam, store, log: () => {}, refineOutlines }); T.split_ms = Date.now() - t1; T.of_which_birefnet_outlines_ms = refineMs;
    const { W, H } = built;
    const keys = built.res.stackKeys.filter(k => { const m = built.res.meta.find(x => x.key === k); const L = built.res.layers.get(k); return m && m.id != null && L && L.vis && !L.vis.empty && L.body; });
    const owner = new Int16Array(W * H).fill(-1); keys.forEach((k, t2) => { const v = built.res.layers.get(k).vis; for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) if (v.d[y * v.w + x]) owner[(y + v.y0) * W + x + v.x0] = t2; });
    t1 = Date.now(); const edges = keys.map((k, t2) => { const m = built.res.meta.find(x => x.key === k); const cut = birById.get(m.id); return Object.assign({ key: k, name: m.name }, cut ? softEdge(built, k, owner, t2, cut) : { soft: 'engine (SAM outline)' }); }); T.soft_edges_ms = Date.now() - t1;
    t1 = Date.now(); const a1 = assemblePlan(built, plan); T.assemble_ms = Date.now() - t1;
    const p1 = psdOut(a1.psd, which !== 'sonamu' ? path.join(OUT, which + '_new.psd') : null); T.psd_ms = p1.ms;
    T.total_ms = T.find_ms + T.split_ms + T.soft_edges_ms + T.assemble_ms + T.psd_ms;
    const pr = { which, props: P.objs.length, psd_layers: a1.summary.layers, names: a1.summary.names, timing: T, outlines: built.refine, edges, stack: a1.summary.stack, extra_layers: a1.summary.extra, psd_bytes: p1.bytes, sam_ep: sam.ep, birefnet_ep: birEp, birefnet_input: half ? 'float16' : 'float32', calls };
    R.pictures.push(pr); log(which, JSON.stringify(pr));
    fs.writeFileSync(path.join(OUT, 'poc6_result.json'), JSON.stringify(R, null, 1));
  }
  await sam.dispose(); log('DONE');
}
