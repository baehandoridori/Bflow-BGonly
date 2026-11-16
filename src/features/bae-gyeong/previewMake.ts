/**
 * 테스트 모드(?preview=1)의 만들기: 진짜 OpenAI 를 부르지 않는다. 앱과 같은 순서로
 *   주문서: 같은 함수로 PD 요청을 만들어 보고(모양 확인) → 가짜 PD 답 → 같은 마무리(finishOrder) → 장부 줄
 *   그림:   작업 줄 '그리는 중' → 중간 그림 두 장 → 가짜 완성 그림(러프를 바탕으로 그림) → 장부 줄 → 작업 줄 '완성'
 *   마무리: 기울기 · 기준 배경이 있으면 앱처럼 작업을 끝내지 않고 GPT 그림을 돌려준 뒤, 화면이 마무리한 그림(drawFinish)으로 끝낸다
 *   결과 판: 색 맞춤 켜고 끄기 · 노이즈 제거(resultSet), 노이즈 제거 창의 도구 작업(toolJob) — 판 파일은 이 탭의 메모리에
 * 을 흉내 낸다. 그만두기 · 화면 떠나기 · 기록이 앱과 같게 움직이는지 보려는 것이다.
 */
import {
  buildPdRequest, pdCost, finishOrder, dirFor, reviseInput, timeList, manualVersion, blocksVersion, imageCost, drawPrompt, drawSizes,
  type OrderMaterials, type PdAnswer,
} from '@/shared/bae/order';
import { BAE_SETTING_DEFAULTS } from '@/shared/bae/settings';
import type {
  BaeDrawCall, BaeDrawOutcome, BaeFailure, BaeOrderCall, BaeOrderOutcome, BaeProgress,
  BaeDrawFinishCall, BaeDrawFinishOutcome, BaeResultSetCall, BaeResultSetOutcome, BaeToolJobCall, BaeToolJobOutcome,
} from '@/shared/bae/makeCalls';
import { baeVariantFile, BAE_BASE_VARIANT_FILES, type BaeJobFinish, type BaeJobImages, type BaeJobResult, type BaeJobWrite } from '@/shared/bae/jobs';
import { PREVIEW_DEFAULT_TEXTS, type PreviewMakeContext, type PreviewMakeMethods } from './previewGateway';
import type { BaeDraftData } from './types';

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException('그만뒀어요', 'AbortError')); return; }
  const t = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(t); reject(new DOMException('그만뒀어요', 'AbortError')); }, { once: true });
});
const fail = (e: unknown, drawing = false): BaeFailure => {
  const aborted = !!e && (e as { name?: string }).name === 'AbortError';
  return { ok: false, aborted, message: aborted ? (drawing ? '그만뒀어요. 이미 보낸 요청은 비용이 들 수 있어요.' : '그만뒀어요.') : (e instanceof Error ? e.message : String(e)), code: null };
};
const uuid = () => crypto.randomUUID();

async function fakePicture(first: Uint8Array | undefined, w: number, h: number, scale: number, room?: Uint8Array): Promise<Uint8Array> {
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d')!; g.fillStyle = '#f3efe6'; g.fillRect(0, 0, c.width, c.height);
  if (room) {
    // 기준 배경을 통째로 보낸 작업: 그 그림을 색만 조금 틀어서 깐다 (그린 뒤 색 맞춤이 되돌릴 거리가 있게)
    const bmp = await createImageBitmap(new Blob([room as BlobPart], { type: 'image/png' }));
    const s = Math.max(c.width / bmp.width, c.height / bmp.height); const dw = bmp.width * s, dh = bmp.height * s;
    g.filter = 'hue-rotate(7deg) saturate(1.12)'; g.drawImage(bmp, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh); g.filter = 'none'; bmp.close();
    g.globalAlpha = 0.35; g.globalCompositeOperation = 'multiply';
  }
  if (first) {
    const bmp = await createImageBitmap(new Blob([first as BlobPart], { type: 'image/png' }));
    const s = Math.min(c.width / bmp.width, c.height / bmp.height); const dw = bmp.width * s, dh = bmp.height * s;
    g.drawImage(bmp, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh); bmp.close();
  }
  if (room) { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  else {
  const grad = g.createLinearGradient(0, 0, 0, c.height); grad.addColorStop(0, 'rgba(169,211,234,.55)'); grad.addColorStop(1, 'rgba(183,199,160,.45)');
  g.fillStyle = grad; g.globalCompositeOperation = 'multiply'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = 'rgba(38,37,31,.72)'; g.font = `${Math.round(c.height / 18)}px sans-serif`; g.fillText('테스트 모드 그림', c.width * 0.04, c.height * 0.94);
  const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('그림을 만들지 못했어요'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
const toDataUrl = (bytes: Uint8Array, type = 'image/png') => new Promise<string>((resolve) => {
  const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.readAsDataURL(new Blob([bytes as BlobPart], { type }));
});
async function shrinkJpeg(bytes: Uint8Array | Blob, max: number): Promise<string> {
  const bmp = await createImageBitmap(bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]));
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return c.toDataURL('image/jpeg', 0.8);
}

const pngSize = (b: Uint8Array) => (b.length > 24 ? { w: new DataView(b.buffer, b.byteOffset).getUint32(16), h: new DataView(b.buffer, b.byteOffset).getUint32(20) } : { w: 0, h: 0 });
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** 재료 미리보기를 작게 (테스트 모드는 localStorage 에 담으니 320 으로). */
async function smallOf(dataUrl: string | null | undefined): Promise<string | null> {
  if (!dataUrl) return null;
  try { const blob = await (await fetch(dataUrl)).blob(); return await shrinkJpeg(blob, 320); } catch { return null; }
}

interface PreviewPending { base: BaeJobWrite; t0: number; gpt: Uint8Array; model: string; imageUsd: number | null; orderUsd: number | null; images: BaeJobImages }

export function createPreviewMake(ctx: PreviewMakeContext): PreviewMakeMethods {
  const running = new Map<string, { ctl: AbortController; phase: 'order' | 'draw'; startedAt: number }>();
  const files = new Map<string, Record<string, Uint8Array>>();
  const pending = new Map<string, PreviewPending>();
  /** 이 탭의 job.json 대역 (끝난 작업의 result · images) */
  const metas = new Map<string, { result: BaeJobResult; images: BaeJobImages }>();
  const put = (jobId: string, name: string, bytes: Uint8Array) => { const f = files.get(jobId) ?? {}; f[name] = bytes; files.set(jobId, f); };
  async function materialImages(q: BaeDrawCall): Promise<BaeJobImages> {
    const out: BaeJobImages = {};
    const rough = q.previews.rough; if (rough) out.rough = rough;
    const bases = (await Promise.all((q.previews.bases ?? []).slice(0, 3).map(smallOf))).filter((x): x is string => !!x);
    if (bases.length) out.bases = bases;
    const sheet = await smallOf(q.previews.sheet); if (sheet) out.sheet = sheet;
    return out;
  }
  async function complete(p: PreviewPending, fin: { png: Uint8Array; alt: Uint8Array | null; moved: number; tilt: number; note: string } | null): Promise<BaeDrawFinishOutcome> {
    const jobId = p.base.id; const png = fin ? fin.png : p.gpt; const differs = !!fin && !same(png, p.gpt);
    if (differs) put(jobId, 'final.png', png);
    put(jobId, 'result.png', png);
    const lock = fin && fin.moved > 0 ? { moved: fin.moved, on: true } : null;
    if (fin && lock) put(jobId, 'alt.png', fin.alt ?? p.gpt);
    const { w, h } = pngSize(png); const sec = Math.round((Date.now() - p.t0) / 1000);
    const total = (p.imageUsd ?? 0) + (p.orderUsd ?? 0);
    const thumb = await shrinkJpeg(png, 320);
    const images: BaeJobImages = { result: thumb, thumb, ...(differs ? { gpt: await shrinkJpeg(p.gpt, 320) } : {}), ...p.images };
    const finish: BaeJobFinish | null = fin ? { tilt: fin.tilt || 0, lock, noise: null, ...(fin.note ? { note: fin.note } : {}) } : null;
    const result: BaeJobResult = { w, h, model: p.model, quality: models.imageQuality, sec, usdOrder: p.orderUsd ?? undefined, usdImage: p.imageUsd ?? undefined, ...(finish ? { finish } : {}) };
    metas.set(jobId, { result, images });
    ctx.writeJob({ ...p.base, status: 'done', result, images, costUsd: total, finishedAt: new Date().toISOString() });
    return { ok: true, jobId, w, h, sec, costUsd: total, imageUsd: p.imageUsd, model: p.model };
  }
  const listeners = new Set<(p: BaeProgress) => void>();
  let draft: BaeDraftData | null = null;
  const models = BAE_SETTING_DEFAULTS.models; const prices = BAE_SETTING_DEFAULTS.prices;
  const begin = (jobId: string, phase: 'order' | 'draw') => {
    if (running.has(jobId)) throw new Error('이 작업은 이미 진행 중이에요.');
    const e = { ctl: new AbortController(), phase, startedAt: Date.now() }; running.set(jobId, e); return e;
  };

  async function order(q: BaeOrderCall): Promise<BaeOrderOutcome | BaeFailure> {
    let e; try { ctx.requireUse(); e = begin(q.jobId, 'order'); } catch (err) { return fail(err); }
    const t0 = Date.now();
    try {
      const materials: OrderMaterials = { ...q.materials, times: timeList([]), calib: 0 };
      const isRev = !!q.revise;
      const dir = dirFor(isRev ? q.revise!.text : null, q.carry, materials.request, q.prevOrder);
      const revise = isRev && q.prevOrder ? reviseInput(q.revise!.text, q.prevPrompt, q.prevOrder, PREVIEW_DEFAULT_TEXTS.fixed, q.revise!.reviewImage ?? null) : null;
      // 앱과 같은 함수로 요청을 만들어 본다 (보내지는 않는다).
      buildPdRequest({ manualText: PREVIEW_DEFAULT_TEXTS.manual, fixedText: PREVIEW_DEFAULT_TEXTS.fixed, rulesKo: '', model: models.pdModel, materials, inputs: q.inputs,
        styleMode: q.styleMode, library: q.library, manualIds: q.manualIds, libThumbs: q.libThumbs, revise, carry: q.carry, dir: dir.ko });
      await sleep(isRev ? 1800 : 2600, e.ctl.signal);
      const req = materials.request.trim().replace(/\s+/g, ' ');
      const obj: PdAnswer = {
        summary_ko: (isRev ? '고친 내용을 반영했어요: ' + q.revise!.text.trim() + '. ' : '') + '테스트 모드의 가짜 주문서예요. ' + (req ? '설명: ' + req.slice(0, 80) : '러프를 그대로 따라 그려요.'),
        notes_ko: ['테스트 모드라 진짜 PD를 부르지 않았어요. 그림도 가짜예요.'],
        style_picks: q.styleMode === 'manual' ? q.manualIds.slice(0, 2) : q.library.slice(0, 2).map((x) => x.id),
        style_reason_ko: '테스트 모드에서 앞의 예시를 골랐어요.',
        prompt: 'Aspect ratio 16:9. Draw the background in Image 1 as a clean flat-color cartoon background. ' + (q.inputs.place ? '[SAME PLACE] ' : '') + '[STYLE]',
        ...(dir.ko.length ? { director_en: dir.ko.map((t) => 'Follow this note: ' + t), director_replaced: [] } : {}),
      };
      const usage = { input_tokens: 9000, output_tokens: 800 };
      const cost = pdCost(usage, models.pdModel, prices.pd);
      ctx.logUsage({ requestId: uuid(), jobId: q.jobId, kind: 'order', model: models.pdModel, tokens: usage, usd: cost ?? 0, at: new Date().toISOString() });
      const done = finishOrder({ obj, cost, revText: isRev ? q.revise!.text : null, label: q.revise?.label ?? null, materials, fixedText: PREVIEW_DEFAULT_TEXTS.fixed, inputs: q.inputs,
        styleMode: q.styleMode, library: q.library, manualIds: q.manualIds, dir, carry: q.carry, carryExtra: q.carryExtra, prevOrder: q.prevOrder, rate: prices.krwPerUsd,
        dirty: !!q.dirty, manualVer: manualVersion(PREVIEW_DEFAULT_TEXTS.manual, false), blocksVer: blocksVersion(PREVIEW_DEFAULT_TEXTS.fixed, false), rulesKo: '', manualPicks: q.manualPicks });
      return { ok: true, ...done, costUsd: cost, sec: Math.round((Date.now() - t0) / 1000) };
    } catch (err) { return fail(err); } finally { running.delete(q.jobId); }
  }

  async function draw(q: BaeDrawCall): Promise<BaeDrawOutcome | BaeFailure> {
    let e; try { ctx.requireUse(); e = begin(q.jobId, 'draw'); } catch (err) { return fail(err, true); }
    const t0 = Date.now(); const model = models.imageModel;
    const base: BaeJobWrite = { id: q.jobId, kind: q.kind, status: 'drawing', parentJobId: q.parentJobId, name: q.name, summary: q.summary, pd: q.pd, costUsd: q.orderCostUsd ?? 0,
      origin: '테스트 모드', appVersion: 'preview', createdAt: q.createdAt };
    try {
      if (!drawPrompt(q.promptText, q.ratio, q.tier, q.tilt)) throw new Error('주문서가 비어 있어요');
      const [w, h] = drawSizes(q.ratio, q.tier, q.tilt).gen;
      const room = q.summary.base?.mode === 'base' ? q.images[1] : undefined;
      ctx.writeJob(base);
      for (let i = 0; i < 2; i++) {
        await sleep(1600, e.ctl.signal);
        const part = await fakePicture(q.images[0], w, h, 0.25, room);
        const p: BaeProgress = { jobId: q.jobId, phase: 'draw', partial: { index: i, dataUrl: await toDataUrl(part) } };
        for (const l of [...listeners]) l(p);
      }
      await sleep(1600, e.ctl.signal);
      const png = await fakePicture(q.images[0], w, h, 1, room);
      const usage = { input_tokens: 1600, output_tokens: 1631, input_tokens_details: { text_tokens: 300, image_tokens: 1300 } };
      const imageUsd = imageCost(usage, prices.image);
      ctx.logUsage({ requestId: uuid(), jobId: q.jobId, kind: 'image', model, tokens: { input_tokens: 1600, output_tokens: 1631 }, usd: imageUsd ?? 0, at: new Date().toISOString() });
      put(q.jobId, 'gpt.png', png);
      const p: PreviewPending = { base, t0, gpt: png, model, imageUsd, orderUsd: q.orderCostUsd, images: await materialImages(q) };
      if (q.finish === true) {
        // 앱처럼: 화면이 마무리할 때까지 끝내지 않는다. 오지 않으면 3분 뒤 GPT 그림 그대로.
        pending.set(q.jobId, p);
        window.setTimeout(() => { const left = pending.get(q.jobId); if (left) { pending.delete(q.jobId); void complete(left, { png: left.gpt, alt: null, moved: 0, tilt: 0, note: '그린 뒤 마무리를 하지 못해서 GPT가 그린 그대로 뒀어요.' }); } }, 180_000);
        const total = (imageUsd ?? 0) + (q.orderCostUsd ?? 0);
        return { ok: true, jobId: q.jobId, png, w, h, sec: Math.round((Date.now() - t0) / 1000), costUsd: total, imageUsd, model, finish: true };
      }
      const done = await complete(p, null);
      return { ...done, png };
    } catch (err) {
      const f = fail(err, true);
      try { ctx.writeJob({ ...base, status: f.aborted ? 'stopped' : 'failed', result: { error: f.message, model }, finishedAt: new Date().toISOString() }); } catch { /* 기록 실패는 화면 오류로 덮지 않는다 */ }
      return f;
    } finally { running.delete(q.jobId); }
  }

  async function drawFinish(c: BaeDrawFinishCall): Promise<BaeDrawFinishOutcome | BaeFailure> {
    try { ctx.requireUse(); } catch (err) { return fail(err); }
    const p = pending.get(c.jobId);
    if (!p) return fail(new Error('마무리할 그림을 찾지 못했어요. 이미 끝났거나 다른 계정의 작업이에요.'));
    pending.delete(c.jobId);
    try { return await complete(p, { png: c.png, alt: c.moved > 0 ? c.alt : null, moved: Math.max(0, c.moved | 0), tilt: c.tilt || 0, note: String(c.note || '').slice(0, 400) }); }
    catch (err) { return fail(err); }
  }

  async function resultSet(c: BaeResultSetCall): Promise<BaeResultSetOutcome | BaeFailure> {
    try {
      ctx.requireUse();
      const meta = metas.get(c.jobId); const f = files.get(c.jobId);
      if (!meta || !f) throw new Error('이 PC 에 이 그림의 원본이 없어요. 만든 PC 에서 해 주세요.');
      const v = { alt: c.variant.alt === true, noise: c.variant.noise === true };
      const prev: BaeJobFinish = meta.result.finish ?? {};
      const lockPrev = prev.lock && prev.lock.moved > 0 ? prev.lock : null;
      if (v.alt && !lockPrev) throw new Error('색 맞춤을 한 그림이 아니에요.');
      const named = baeVariantFile(v); let bytes: Uint8Array | null = null;
      if (named) { if (c.png) { f[named] = c.png; bytes = c.png; } else bytes = f[named] ?? null; }
      else { if (c.png) throw new Error('처음 그림은 바꿀 수 없어요.'); for (const n of BAE_BASE_VARIANT_FILES) if (f[n]) { bytes = f[n]; break; } }
      if (!bytes) return { ok: false, aborted: false, message: '이 그림이 이 PC 에 아직 없어요.', code: 'MISSING' };
      f['result.png'] = bytes;
      const { w, h } = pngSize(bytes); const thumb = await shrinkJpeg(bytes, 320);
      const sec = typeof c.sec === 'number' ? Math.round(c.sec) : prev.noise?.sec;
      const finish: BaeJobFinish = { ...prev, lock: lockPrev ? { moved: lockPrev.moved, on: !v.alt } : (prev.lock ?? null),
        noise: v.noise ? { on: true, ...(sec != null ? { sec } : {}) } : prev.noise ? { ...prev.noise, on: false } : null };
      const result: BaeJobResult = { ...meta.result, w, h, finish };
      const images: BaeJobImages = { ...meta.images, result: thumb, thumb };
      metas.set(c.jobId, { result, images });
      ctx.writeJob({ id: c.jobId, status: 'done', result, images });
      return { ok: true, jobId: c.jobId, w, h, result, images };
    } catch (err) { return fail(err); }
  }

  async function toolJob(c: BaeToolJobCall): Promise<BaeToolJobOutcome | BaeFailure> {
    try {
      ctx.requireUse();
      if (metas.has(c.jobId) || files.has(c.jobId)) throw new Error('이 작업은 이미 있어요.');
      files.set(c.jobId, { 'source.png': c.source, 'final_noise.png': c.png, 'result.png': c.png });
      const { w, h } = pngSize(c.png); const thumb = await shrinkJpeg(c.png, 320);
      const result: BaeJobResult = { w, h, sec: Math.round(c.sec), finish: { tilt: 0, lock: null, noise: { on: true, sec: Math.round(c.sec) } } };
      const images: BaeJobImages = { result: thumb, thumb, source: await shrinkJpeg(c.source, 320) };
      metas.set(c.jobId, { result, images });
      const label = c.label.replace(/\s+/g, ' ').trim().slice(0, 120);
      ctx.writeJob({ id: c.jobId, kind: 'denoise', status: 'done', parentJobId: c.parentJobId, name: null, summary: label ? { source: label } : {}, pd: {}, result, images,
        costUsd: 0, origin: '테스트 모드', appVersion: 'preview', createdAt: c.createdAt, finishedAt: new Date().toISOString() });
      return { ok: true, jobId: c.jobId, w, h };
    } catch (err) { return fail(err); }
  }

  return {
    order, draw, drawFinish, resultSet, toolJob,
    abort: async (jobId) => { const e = running.get(jobId); if (!e) return false; e.ctl.abort(); return true; },
    jobPatch: async (jobId, status, p) => {
      const w: BaeJobWrite = { id: jobId, status };
      if ('name' in p) { const n = (p.name ?? '').trim(); if (n.length > 80) throw new Error('그림 이름은 80자까지 쓸 수 있어요.'); w.name = n || null; }
      if ('selfReview' in p) w.selfReview = p.selfReview ?? null;
      ctx.writeJob(w); return true;
    },
    active: async () => [...running.entries()].map(([jobId, e]) => ({ jobId, phase: e.phase, startedAt: e.startedAt })),
    localFile: async (jobId, name) => files.get(jobId)?.[name] ?? null,
    saveAs: async () => null,
    draftSave: async (d) => { draft = d; return true; },
    draftLoad: async () => draft,
    draftClear: async () => { draft = null; return true; },
    online: async () => true,
    onProgress: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
