/* BAE layer engine: SAM 2.1 (Meta, Apache-2.0) through ONNX Runtime - the same code for the browser (onnxruntime-web,
   graphics card through WebGPU) and for Node / Electron (onnxruntime-node).
   Model files: onnx-community/sam2.1-hiera-base-plus-ONNX (fp16). The decoder graph is patched (py/patch_decoder.py) to
   also give the single-mask answer (mask token 0), which the prototype preferred for plain box prompts.
   The picture goes in the way the prototype's SAM got it (ultralytics): shrunk so the long side is 1024, top-left,
   padded with grey 114 - its masks matched the prototype's best. */
import * as B from './bm.js';

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
// resize helpers (bilinear, half-pixel centers like cv2.INTER_LINEAR)
function coef(sn, dn) { const sc = sn / dn, i0 = new Int32Array(dn), i1 = new Int32Array(dn), a = new Float32Array(dn); for (let d = 0; d < dn; d++) { let f = (d + 0.5) * sc - 0.5; let s = Math.floor(f); f -= s; if (s < 0) { s = 0; f = 0; } if (s >= sn - 1) { s = sn - 1; f = 0; } i0[d] = s; i1[d] = Math.min(sn - 1, s + 1); a[d] = f; } return { i0, i1, a }; }

export function createSam({ ort, encoder, decoder, ep = 'cpu', fallbackEp = null, onEp = () => {}, log = () => {} }) {
  // encoder / decoder: { graph: Uint8Array|path, data: Uint8Array|path, dataName } ; ort: onnxruntime module (web or node)
  // fallbackEp: when the graphics card cannot start or fails on the first picture (driver, memory), the same run goes on
  // there (e.g. 'wasm' in the browser, 'cpu' in Node) instead of stopping; onEp(ep) tells the caller.
  let encS = null, decS = null; const cache = new Map(); let cur = null; let usedEp = ep, proven = false;
  async function sessions() {
    if (encS) return;
    const mk = async (m, extra) => ort.InferenceSession.create(m.graph, Object.assign({ executionProviders: [usedEp], graphOptimizationLevel: 'all' }, m.data ? { externalData: [{ path: m.dataName, data: m.data }] } : {}, extra || {}));
    // on the graphics card the picture's numbers stay there for the decoder (no 17 MB copy per prop)
    encS = await mk(encoder, usedEp === 'webgpu' ? { preferredOutputLocation: 'gpu-buffer' } : null); decS = await mk(decoder);
  }
  async function release() { try { await encS?.release?.(); await decS?.release?.(); } catch (err) { /* ignore */ } encS = decS = null; cache.clear(); cur = null; }
  async function setImage(key, rgb, W, H) {
    for (;;) {
      try { return await setImage1(key, rgb, W, H); }
      catch (err) {
        if (proven || !fallbackEp || usedEp === fallbackEp) throw err;
        log(`SAM: ${usedEp} did not work (${String((err && err.message) || err).slice(0, 160)}), going on with ${fallbackEp}`);
        await release(); usedEp = fallbackEp; onEp(usedEp);
      }
    }
  }
  async function setImage1(key, rgb, W, H) {
    await sessions();
    if (cache.has(key)) { cur = cache.get(key); return; }
    const s = 1024 / Math.max(W, H), nw = Math.round(W * s), nh = Math.round(H * s);
    const X = coef(W, nw), Y = coef(H, nh); const px = new Float32Array(3 * 1024 * 1024); const plane = 1024 * 1024;
    for (let c = 0; c < 3; c++) { const v = (114 / 255 - MEAN[c]) / STD[c]; px.fill(v, c * plane, (c + 1) * plane); }
    for (let y = 0; y < nh; y++) {
      const r0 = Y.i0[y] * W, r1 = Y.i1[y] * W, b = Y.a[y];
      for (let x = 0; x < nw; x++) {
        const a = X.a[x]; const p00 = (r0 + X.i0[x]) * 3, p01 = (r0 + X.i1[x]) * 3, p10 = (r1 + X.i0[x]) * 3, p11 = (r1 + X.i1[x]) * 3;
        for (let c = 0; c < 3; c++) {
          const v = Math.round((rgb[p00 + c] * (1 - a) + rgb[p01 + c] * a) * (1 - b) + (rgb[p10 + c] * (1 - a) + rgb[p11 + c] * a) * b);
          px[c * plane + y * 1024 + x] = (v / 255 - MEAN[c]) / STD[c];
        }
      }
    }
    const t0 = Date.now();
    const out = await encS.run({ pixel_values: new ort.Tensor('float32', px, [1, 3, 1024, 1024]) });
    const e = { key, W, H, s, nw, nh, emb: [out['image_embeddings.0'], out['image_embeddings.1'], out['image_embeddings.2']] };
    log(`SAM: picture ${key} read in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (cache.size >= 3) { const k0 = cache.keys().next().value; const old = cache.get(k0); cache.delete(k0); try { old.emb.forEach(t => t.dispose && t.dispose()); } catch (err) { /* ignore */ } }   // keep a few pictures' embeddings
    cache.set(key, e); cur = e;
    if (!proven) { await run({ box: [0, 0, W / 2, H / 2] }); proven = true; }   // one decoder pass, so a failing graphics card shows up here
  }
  function toMask(lo, k, e) {                       // low-res logits (256x256, mask k) -> full-size box mask (> 0)
    const L = 256, off = k * L * L; const { W, H, nw, nh } = e;
    let mnx = L, mny = L, mxx = -1, mxy = -1;       // where it could be positive (+2 cells)
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) if (lo[off + y * L + x] > 0) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
    if (mxx < 0) return new B.BM();
    // 1024-space ROI, then picture-space ROI
    const ax = Math.max(0, (mnx - 2) * 4), ay = Math.max(0, (mny - 2) * 4), bx = Math.min(1024, (mxx + 3) * 4), by = Math.min(1024, (mxy + 3) * 4);
    const U = coef(L, 1024); const up = new Float32Array((bx - ax) * (by - ay)); const uw = bx - ax;
    for (let y = ay; y < by; y++) { const r0 = off + U.i0[y] * L, r1 = off + U.i1[y] * L, b = U.a[y]; for (let x = ax; x < bx; x++) { const a = U.a[x]; up[(y - ay) * uw + x - ax] = (lo[r0 + U.i0[x]] * (1 - a) + lo[r0 + U.i1[x]] * a) * (1 - b) + (lo[r1 + U.i0[x]] * (1 - a) + lo[r1 + U.i1[x]] * a) * b; } }
    const X = coef(nw, W), Y = coef(nh, H); const gx0 = Math.max(0, Math.floor((ax - 1) * W / nw)), gy0 = Math.max(0, Math.floor((ay - 1) * H / nh)), gx1 = Math.min(W, Math.ceil((bx + 1) * W / nw)), gy1 = Math.min(H, Math.ceil((by + 1) * H / nh));
    const gw = gx1 - gx0, o = new Uint8Array(gw * (gy1 - gy0));
    const at = (x, y) => (x < ax || x >= bx || y < ay || y >= by) ? -1e9 : up[(y - ay) * uw + x - ax];
    for (let y = gy0; y < gy1; y++) { const y0 = Y.i0[y], y1 = Y.i1[y], b = Y.a[y]; for (let x = gx0; x < gx1; x++) { const x0 = X.i0[x], x1 = X.i1[x], a = X.a[x]; const v = (at(x0, y0) * (1 - a) + at(x1, y0) * a) * (1 - b) + (at(x0, y1) * (1 - a) + at(x1, y1) * a) * b; o[(y - gy0) * gw + x - gx0] = v > 0 ? 1 : 0; } }
    return B.fromCrop(o, [gx0, gy0, gx1, gy1]);
  }
  async function run({ box, points, labels }) {
    const e = cur; const s = e.s;
    const P = points && points.length ? points : [], Lb = labels && labels.length ? labels : [];
    const feeds = {
      input_points: new ort.Tensor('float32', Float32Array.from(P.flatMap(p => [p[0] * s, p[1] * s])), [1, 1, P.length, 2]),
      input_labels: new ort.Tensor('int64', BigInt64Array.from(Lb.map(v => BigInt(v))), [1, 1, Lb.length]),
      input_boxes: new ort.Tensor('float32', Float32Array.from(box ? box.map(v => v * s) : []), [1, box ? 1 : 0, 4]),
      'image_embeddings.0': e.emb[0], 'image_embeddings.1': e.emb[1], 'image_embeddings.2': e.emb[2],
    };
    const out = await decS.run(feeds);
    return { masks: out.all_masks.data, iou: out.all_iou.data, e };
  }
  return {
    setImage,
    get ep() { return usedEp; },
    // multimask: the 3 answers (tokens 1..3) with SAM's own score, like ultralytics' multimask_output=True
    // single: token 0, or the best of the 3 when token 0 is unstable (SAM2's dynamic multimask)
    async predict({ box, points, labels, multimask = true }) {
      const { masks, iou, e } = await run({ box, points, labels });
      if (multimask) return [1, 2, 3].map(k => ({ mask: toMask(masks, k, e), conf: iou[k] }));
      return [singleOf(masks, iou, e)];
    },
    async predictAll({ box, points, labels }) {
      const { masks, iou, e } = await run({ box, points, labels });
      return { multi: [1, 2, 3].map(k => ({ mask: toMask(masks, k, e), conf: iou[k] })), single: singleOf(masks, iou, e) };
    },
    dispose: release,
  };
  function singleOf(masks, iou, e) {
    const L = 256 * 256; let pos = 0, neg = 0; for (let i = 0; i < L; i++) { const v = masks[i]; if (v > .05) pos++; if (v > -.05) neg++; }
    const stab = neg ? pos / neg : 1; let k = 0;
    if (stab < .98) { k = 1; for (let q = 2; q <= 3; q++) if (iou[q] > iou[k]) k = q; }
    return { mask: toMask(masks, k, e), conf: iou[k], token: k };
  }
}
