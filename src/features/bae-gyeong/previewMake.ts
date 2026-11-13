/**
 * 테스트 모드(?preview=1)의 만들기: 진짜 OpenAI 를 부르지 않는다. 앱과 같은 순서로
 *   주문서: 같은 함수로 PD 요청을 만들어 보고(모양 확인) → 가짜 PD 답 → 같은 마무리(finishOrder) → 장부 줄
 *   그림:   작업 줄 '그리는 중' → 중간 그림 두 장 → 가짜 완성 그림(러프를 바탕으로 그림) → 장부 줄 → 작업 줄 '완성'
 * 을 흉내 낸다. 그만두기 · 화면 떠나기 · 기록이 앱과 같게 움직이는지 보려는 것이다.
 */
import {
  buildPdRequest, pdCost, finishOrder, dirFor, reviseInput, timeList, manualVersion, blocksVersion, imageCost, drawPrompt, drawSizes,
  type OrderMaterials, type PdAnswer,
} from '@/shared/bae/order';
import { BAE_SETTING_DEFAULTS } from '@/shared/bae/settings';
import type { BaeDrawCall, BaeDrawOutcome, BaeFailure, BaeOrderCall, BaeOrderOutcome, BaeProgress } from '@/shared/bae/makeCalls';
import type { BaeJobWrite } from '@/shared/bae/jobs';
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

async function fakePicture(first: Uint8Array | undefined, w: number, h: number, scale: number): Promise<Uint8Array> {
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d')!; g.fillStyle = '#f3efe6'; g.fillRect(0, 0, c.width, c.height);
  if (first) {
    const bmp = await createImageBitmap(new Blob([first as BlobPart], { type: 'image/png' }));
    const s = Math.min(c.width / bmp.width, c.height / bmp.height); const dw = bmp.width * s, dh = bmp.height * s;
    g.drawImage(bmp, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh); bmp.close();
  }
  const grad = g.createLinearGradient(0, 0, 0, c.height); grad.addColorStop(0, 'rgba(169,211,234,.55)'); grad.addColorStop(1, 'rgba(183,199,160,.45)');
  g.fillStyle = grad; g.globalCompositeOperation = 'multiply'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(38,37,31,.72)'; g.font = `${Math.round(c.height / 18)}px sans-serif`; g.fillText('테스트 모드 그림', c.width * 0.04, c.height * 0.94);
  const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('그림을 만들지 못했어요'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
const toDataUrl = (bytes: Uint8Array, type = 'image/png') => new Promise<string>((resolve) => {
  const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.readAsDataURL(new Blob([bytes as BlobPart], { type }));
});
async function shrinkJpeg(bytes: Uint8Array, max: number): Promise<string> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return c.toDataURL('image/jpeg', 0.8);
}

export function createPreviewMake(ctx: PreviewMakeContext): PreviewMakeMethods {
  const running = new Map<string, { ctl: AbortController; phase: 'order' | 'draw'; startedAt: number }>();
  const files = new Map<string, Record<string, Uint8Array>>();
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
        prompt: 'Aspect ratio 16:9. Draw the background in Image 1 as a clean flat-color cartoon background. [STYLE]',
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
      ctx.writeJob(base);
      for (let i = 0; i < 2; i++) {
        await sleep(1600, e.ctl.signal);
        const part = await fakePicture(q.images[0], w, h, 0.25);
        const p: BaeProgress = { jobId: q.jobId, phase: 'draw', partial: { index: i, dataUrl: await toDataUrl(part) } };
        for (const l of [...listeners]) l(p);
      }
      await sleep(1600, e.ctl.signal);
      const png = await fakePicture(q.images[0], w, h, 1);
      const usage = { input_tokens: 1600, output_tokens: 1631, input_tokens_details: { text_tokens: 300, image_tokens: 1300 } };
      const imageUsd = imageCost(usage, prices.image);
      ctx.logUsage({ requestId: uuid(), jobId: q.jobId, kind: 'image', model, tokens: { input_tokens: 1600, output_tokens: 1631 }, usd: imageUsd ?? 0, at: new Date().toISOString() });
      const thumb = await shrinkJpeg(png, 320);
      const rough = q.previews.rough;
      files.set(q.jobId, { 'result.png': png });
      const sec = Math.round((Date.now() - t0) / 1000);
      const total = (imageUsd ?? 0) + (q.orderCostUsd ?? 0);
      ctx.writeJob({ ...base, status: 'done', result: { w, h, model, quality: models.imageQuality, sec, usdOrder: q.orderCostUsd ?? undefined, usdImage: imageUsd ?? undefined },
        images: { result: thumb, thumb, ...(rough ? { rough } : {}) }, costUsd: total, finishedAt: new Date().toISOString() });
      return { ok: true, jobId: q.jobId, png, w, h, sec, costUsd: total, imageUsd, model };
    } catch (err) {
      const f = fail(err, true);
      try { ctx.writeJob({ ...base, status: f.aborted ? 'stopped' : 'failed', result: { error: f.message, model }, finishedAt: new Date().toISOString() }); } catch { /* 기록 실패는 화면 오류로 덮지 않는다 */ }
      return f;
    } finally { running.delete(q.jobId); }
  }

  return {
    order, draw,
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
