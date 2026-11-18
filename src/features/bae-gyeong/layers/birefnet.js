/* BAE경 6단계: BiRefNet 새 방식 (계획 11 10~11절, 14 9-1 · 14b 11-3 6단계).
   2026-11-03 Electron 시험의 마지막 판 poc_main6.mjs (C:\BAE_stage0\bir_port\poc_main6.mjs) 의 두 가지를 셈 그대로 옮겼다.
     1 윤곽 (refineOutlines): PD 가 정한 물건마다 SAM 이 짚은 자리를 BiRefNet 에게 보여 주고 그 윤곽을 쓴다 — 다른 물건은 빈 배경으로 칠해
       지우고, 그림 끝에 닿은 물건은 배경색으로 넓혀 보여 준다. SAM 과 맞을 때(IoU 0.85 이상)만 바꾼다. 엔진 split.js 에 표시를 붙여 끼운
       한 군데가 이것을 부른다 → 맞닿은 쌍 · 앞뒤 · 가려진 부분 · 레이어 · BG 보정이 모두 새 윤곽으로.
     2 가장자리 (softEdges): 나눈 레이어마다 BiRefNet 의 부드러운 가장자리를 얹는다 (두 물건이 만나는 곳은 엔진이 자른 그대로).
   바꾼 것: 시험용 그림 남기기(dbg 폴더)를 뺐고, 물건마다 진행을 알리고, 그만두기를 듣는다. 모델 계산(run)은 넣어 준다 —
   앱은 화면 쪽 일꾼 → 전용 통로 → 모델 일꾼(onnxruntime-node, 그래픽카드)이다.
   셈에서 바꾼 한 가지 (2026-11-16, 교실 검사): 두 물건이 같은 픽셀을 가질 때 색으로 나누는 것은 BiRefNet 이 새로 더한 픽셀만.
     두 SAM 윤곽이 원래 함께 가졌던 픽셀은 나누지 않고 엔진(앞뒤)에 맡긴다 — 지금 방식과 같게. 회의실 두 장은 이런 픽셀이 없어
     결과가 poc_main6 과 픽셀까지 같고, 교실은 책상 · 의자의 SAM 윤곽이 가는 쇠다리에서 겹쳐 그대로 두면 책상 다리가 의자로 갔다.
   BiRefNet 이 한 번이라도 실패하면 그 그림은 SAM 윤곽 그대로 돌려준다 (= SAM 만으로, 지금 방식). 그만두기는 실패가 아니라 그대로 던진다. */
import * as I from './engine/img.js';
import * as B from './engine/bm.js';
import { clean } from './engine/prep.js';

export const BIR_SIZE = 1024;
const MEAN = [.485, .456, .406], STD = [.229, .224, .225];
/** 잘라 낸 그림 (RGB) → 1024×1024 (늘여서), ImageNet 정규화, NCHW (poc_main6 prepCrop) */
export function prepCrop(rgb, cw, ch) {
  const N = 1024, out = new Float32Array(3 * N * N);
  for (let y = 0; y < N; y++) { const sy = Math.min(ch - 1, Math.max(0, (y + .5) * ch / N - .5)), y0i = Math.floor(sy), y1i = Math.min(ch - 1, y0i + 1), fy = sy - y0i;
    for (let x = 0; x < N; x++) { const sx = Math.min(cw - 1, Math.max(0, (x + .5) * cw / N - .5)), x0i = Math.floor(sx), x1i = Math.min(cw - 1, x0i + 1), fx = sx - x0i;
      const p00 = (y0i * cw + x0i) * 3, p01 = (y0i * cw + x1i) * 3, p10 = (y1i * cw + x0i) * 3, p11 = (y1i * cw + x1i) * 3;
      for (let c = 0; c < 3; c++) { const v = (rgb[p00 + c] * (1 - fx) + rgb[p01 + c] * fx) * (1 - fy) + (rgb[p10 + c] * (1 - fx) + rgb[p11 + c] * fx) * fy;
        out[c * N * N + y * N + x] = (v / 255 - MEAN[c]) / STD[c]; } } }
  return out;
}
/** 1024×1024 답 → 잘라 낸 크기, 0..1 (로짓이면 시그모이드) (poc_main6 back) */
export function back(o, cw, ch) {
  const N = 1024, out = new Float32Array(cw * ch); let lo = Infinity, hi = -Infinity; for (let i = 0; i < o.length; i += 97) { lo = Math.min(lo, o[i]); hi = Math.max(hi, o[i]); }
  const sig = lo < -.01 || hi > 1.01;
  for (let y = 0; y < ch; y++) { const sy = Math.min(N - 1, Math.max(0, (y + .5) * N / ch - .5)), a = Math.floor(sy), b = Math.min(N - 1, a + 1), fy = sy - a;
    for (let x = 0; x < cw; x++) { const sx = Math.min(N - 1, Math.max(0, (x + .5) * N / cw - .5)), c = Math.floor(sx), d = Math.min(N - 1, c + 1), fx = sx - c;
      let v = (o[a * N + c] * (1 - fx) + o[a * N + d] * fx) * (1 - fy) + (o[b * N + c] * (1 - fx) + o[b * N + d] * fx) * fy; if (sig) v = 1 / (1 + Math.exp(-v)); out[y * cw + x] = Math.min(1, Math.max(0, v)); } }
  return out;
}
/** 물건 상자 + 12% 여백 (적어도 16px) (poc_main6 cropOf) */
export const cropOf = (box, W, H) => { const [bx0, by0, bx1, by1] = box; const mg = Math.max(16, Math.round(.12 * Math.max(bx1 - bx0, by1 - by0))); return [Math.max(0, bx0 - mg), Math.max(0, by0 - mg), Math.min(W, bx1 + mg), Math.min(H, by1 + mg)]; };

const abortErr = () => { const e = new Error('그만뒀어요'); e.name = 'AbortError'; return e; };

/**
 * 그림 한 장의 새 방식. run(x) = BiRefNet 한 번 (x: 1×3×1024×1024 Float32Array → 첫 출력 1024×1024 Float32Array).
 * 돌려주는 것: refineOutlines (split.js 의 끼운 자리에 넘긴다) · softEdges(built) (나눈 뒤, 조립 전에 한 번) · 결과 (state).
 */
export function createBirefnet({ run, onProgress = () => {}, log = () => {}, signal = null }) {
  const birById = new Map();
  const state = { tried: false, failed: null, used: 0, props: 0, outlinesMs: 0, edgesMs: 0, runs: 0, outlines: [], edges: [] };
  async function birRun(x) { if (signal && signal.aborted) throw abortErr(); state.runs++; return run(x); }

  // ---- 1. 윤곽: BiRefNet 에게 물건 하나씩 (다른 물건은 빈 배경으로 칠해 지움) — poc_main6 refineOutlines ----
  async function refineCore({ W, H, orig, plate, objs, ms }) {
    const out = [], report = [];
    for (let i = 0; i < objs.length; i++) {
      onProgress(i, objs.length);
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
      }
      // which prop: SAM's (grown 12 px); BiRefNet's pixels only there. Agreement with SAM (IoU) >= 0.85 -> BiRefNet's outline
      const gate = B.crop(B.dil(m, 12, W, H), cb), sm = B.crop(m, cb); let inter = 0, uni = 0; const bin = new Uint8Array(cw * ch);
      for (let q = 0; q < cw * ch; q++) { if (!gate[q]) a[q] = 0; const b = a[q] > .5; bin[q] = b ? 1 : 0; if (sm[q] && b) inter++; if (sm[q] || b) uni++; }
      const iou = uni ? inter / uni : 0; const name = objs[i].name;
      if (iou < .85) { out.push(m); report.push({ name, crop: cb, painted_px: painted, widened: pl + pt + pr + pb > 0 ? [pl, pt, pr, pb] : null, iou: +iou.toFixed(3), used: 'sam' }); continue; }
      const core = B.crop(B.ero(m, 6, W, H), cb); for (let q = 0; q < cw * ch; q++) if (core[q]) bin[q] = 1;
      // what BiRefNet adds outside SAM's outline must be at least 3 px thick (no 1-px spikes where another prop's edge was)
      const opened = I.open(bin, cw, ch, I.rect(1)); for (let q = 0; q < cw * ch; q++) if (bin[q] && !sm[q] && !opened[q]) bin[q] = 0;
      const nm = clean(B.fromCrop(bin, cb), W, H); out.push(nm && !nm.empty ? nm : m);
      if (objs[i].id != null) birById.set(objs[i].id, { cb, a });
      report.push({ name, crop: cb, painted_px: painted, widened: pl + pt + pr + pb > 0 ? [pl, pt, pr, pb] : null, iou: +iou.toFixed(3), used: 'birefnet', px_sam: B.count(m), px_birefnet: B.count(nm) });
    }
    onProgress(objs.length, objs.length);
    // two props claiming the same pixels (a table's soft edge running up into a chair's bottom): each such pixel goes to
    // the prop whose own colour (the middle colour of its inside) it is clearly closer to - in flat cel colours that is the line
    const med = out.map((m) => { const c = B.ero(m, 6, W, H); const use = B.count(c) > 50 ? c : m; const v = [[], [], []];
      for (let y = 0; y < use.h; y += 2) for (let x = 0; x < use.w; x += 2) if (use.d[y * use.w + x]) { const g = ((y + use.y0) * W + x + use.x0) * 3; for (let k = 0; k < 3; k++) v[k].push(orig[g + k]); }
      return v.map(a => a.length ? I.median(a) : 0); });
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const both = B.and(out[i], out[j]); if (both.empty || !B.count(both)) continue; const toI = new Uint8Array(both.d.length), toJ = new Uint8Array(both.d.length); let ni = 0, nj = 0, nb = 0;
      // when the colour does not settle it (a soft edge pixel, half prop and half wall), the prop whose SAM outline is nearer
      const pb = [Math.max(0, both.x0 - 16), Math.max(0, both.y0 - 16), Math.min(W, both.x1 + 16), Math.min(H, both.y1 + 16)], pw = pb[2] - pb[0], ph = pb[3] - pb[1];
      const si = B.crop(ms[i], pb), sj = B.crop(ms[j], pb); const ui = new Uint8Array(pw * ph), uj = new Uint8Array(pw * ph); for (let q = 0; q < pw * ph; q++) { ui[q] = si[q] ? 0 : 1; uj[q] = sj[q] ? 0 : 1; }
      const Di = I.edt(ui, pw, ph).dist, Dj = I.edt(uj, pw, ph).dist;
      for (let y = 0; y < both.h; y++) for (let x = 0; x < both.w; x++) { const q = y * both.w + x; if (!both.d[q]) continue; const g = ((y + both.y0) * W + x + both.x0) * 3;
        const q2 = (y + both.y0 - pb[1]) * pw + x + both.x0 - pb[0];
        // (BAE 6단계, poc_main6 에서 바꾼 한 가지) both SAM outlines held this pixel already: it is not BiRefNet's doing, so it stays
        // with both and the engine settles it by front/back as with SAM only. poc_main6 split these too - the meeting rooms never
        // had any (every prop there took BiRefNet's outline), but in the classroom the desks' and chairs' SAM outlines overlap at
        // the thin metal legs, and splitting them by colour gave the desks' legs to the chairs (front-row desks kept 492 of 878 thin px)
        if (si[q2] && sj[q2]) { nb++; continue; }
        let di = 0, dj = 0; for (let k = 0; k < 3; k++) { di += Math.abs(orig[g + k] - med[i][k]); dj += Math.abs(orig[g + k] - med[j][k]); }
        const toIi = Math.abs(di - dj) > 20 ? di < dj : Di[q2] <= Dj[q2];
        if (toIi) { toI[q] = 1; ni++; } else { toJ[q] = 1; nj++; } }
      const bb = [both.x0, both.y0, both.x1, both.y1];
      if (ni + nj) { out[i] = B.andNot(out[i], B.fromCrop(toJ, bb)); out[j] = B.andNot(out[j], B.fromCrop(toI, bb)); }
      const ri = report.find(r => r.name === objs[i].name), rj = report.find(r => r.name === objs[j].name);
      if (ri) ri.shared_px_kept = (ri.shared_px_kept || 0) + ni; if (rj) rj.shared_px_kept = (rj.shared_px_kept || 0) + nj;
      if (nb) { if (ri) ri.shared_px_engine = (ri.shared_px_engine || 0) + nb; if (rj) rj.shared_px_engine = (rj.shared_px_engine || 0) + nb; }
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
    return { ms: out, report };
  }
  /** split.js 의 끼운 자리가 부른다. BiRefNet 이 실패하면 SAM 윤곽 그대로 (그 그림은 지금 방식). */
  async function refineOutlines(o) {
    const t0 = Date.now(); state.tried = true; state.props = o.objs.length;
    try {
      const r = await refineCore(o);
      state.outlinesMs = Date.now() - t0; state.outlines = r.report; state.used = r.report.filter((x) => x.used === 'birefnet').length;
      return r;
    } catch (e) {
      if ((e && e.name === 'AbortError') || (signal && signal.aborted)) throw e.name === 'AbortError' ? e : abortErr();
      birById.clear(); state.failed = e instanceof Error ? e : new Error(String(e)); state.used = 0; state.outlinesMs = Date.now() - t0;
      log('BiRefNet 실패 → SAM 윤곽 그대로: ' + String((e && e.message) || e).slice(0, 300));
      return { ms: o.ms, report: [] };
    }
  }

  // ---- 2. 나눈 레이어마다 BiRefNet 의 부드러운 가장자리 (윤곽은 이미 BiRefNet 것, 사이 픽셀만 더함) — poc_main6 softEdge ----
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
  /** 나눈 뒤 한 번 (poc_main6 의 그림마다 줄: 물건 레이어 · 주인 지도 · 레이어마다 softEdge). BiRefNet 윤곽을 쓴 물건만 바뀐다. */
  function softEdges(built) {
    if (!birById.size) { state.edges = []; return state.edges; }
    const t0 = Date.now(); const { W, H } = built;
    const keys = built.res.stackKeys.filter(k => { const m = built.res.meta.find(x => x.key === k); const L = built.res.layers.get(k); return m && m.id != null && L && L.vis && !L.vis.empty && L.body; });
    const owner = new Int16Array(W * H).fill(-1); keys.forEach((k, t2) => { const v = built.res.layers.get(k).vis; for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) if (v.d[y * v.w + x]) owner[(y + v.y0) * W + x + v.x0] = t2; });
    state.edges = keys.map((k, t2) => { const m = built.res.meta.find(x => x.key === k); const cut = birById.get(m.id); return Object.assign({ key: k, name: m.name }, cut ? softEdge(built, k, owner, t2, cut) : { soft: 'engine (SAM outline)' }); });
    state.edgesMs = Date.now() - t0;
    return state.edges;
  }

  return { refineOutlines, softEdges, state };
}
