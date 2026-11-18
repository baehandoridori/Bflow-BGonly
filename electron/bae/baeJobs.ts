/**
 * BAE경 작업 흐름 (메인). 화면은 재료(글자 · 데이터 주소 · PNG 바이트)만 넘기고, 여기서
 *   주문서: 설정 책장(매뉴얼 · 고정 문장 본문은 메인에만) → PD 요청(HTML v0.4.11 과 같은 몸) → 장부 줄 → 주문서 마무리
 *   그림:   작업 줄 '그리는 중' → 그림 요청(중간 그림은 화면으로) → 이 PC 원본 → 장부 줄 → 미리보기 · 작업 줄 '완성'
 * 을 한다. 서버에 보낼 것은 모두 '못 보낸 것 줄'(outbox)을 거친다: 인터넷이 끊겨도 그림 작업은 끝나고, 이어지면 올라간다.
 * 그만두기는 작업마다 AbortController. 화면을 떠나도(다른 메뉴) 작업은 여기서 계속된다.
 */
import { randomUUID } from 'node:crypto';
import {
  buildPdRequest, readPdResponse, pdCost, finishOrder, dirFor, reviseInput, timeList, manualVersion, blocksVersion,
  imageFields, imageCost, drawPrompt, drawSizes,
  type OrderMaterials,
} from '../../src/shared/bae/order';
import type {
  BaeOrderCall, BaeOrderOutcome, BaeDrawCall, BaeDrawOutcome, BaeFailure, BaeProgress,
  BaeDrawFinishCall, BaeDrawFinishOutcome, BaeResultSetCall, BaeResultSetOutcome, BaeToolJobCall, BaeToolJobOutcome,
} from '../../src/shared/bae/makeCalls';
import {
  isBaeJobId, baePreviewPath, baeVariantFile, baeVariantPreviews, BAE_BASE_VARIANT_FILES,
  type BaeJobWrite, type BaeUsageLine, type BaePreviewName, type BaeJobImages, type BaeJobFinish, type BaeJobResult,
} from '../../src/shared/bae/jobs';
import { maskSecrets } from '../../src/shared/bae/secrets';
import { baePickModel, baePickQuality } from '../../src/shared/bae/imageChoice';
import { BAE_UPSCALE_MAX_PIXELS, BAE_UPSCALE_MODES, BAE_UPSCALE_PREVIEW_NOTE as UPSCALE_PREVIEW_NOTE } from '../../src/shared/bae/upscaleView';
import { postResponses, postImageEdit, type BaeImageFieldName, type BaeImageFormField } from './openaiClient';
import type { BaeSettingsCache } from './baeSettingsCache';
import type { BaeLocalStore } from './localStore';
import type { BaeOutbox } from './outbox';
import { BAE_DEFAULT_FIXED, BAE_DEFAULT_MANUAL } from './defaultTexts';

export type {
  BaeOrderCall, BaeOrderOutcome, BaeDrawCall, BaeDrawOutcome, BaeFailure, BaeProgress,
  BaeDrawFinishCall, BaeDrawFinishOutcome, BaeResultSetCall, BaeResultSetOutcome, BaeToolJobCall, BaeToolJobOutcome,
} from '../../src/shared/bae/makeCalls';

export interface BaeJobsDeps {
  settings: BaeSettingsCache;
  keyFor(origin: { userId: string; epoch: number }): Promise<string>;
  local: BaeLocalStore;
  outbox: Pick<BaeOutbox, 'enqueue'>;
  /** 진행 알림 (중간 그림). 화면이 없으면 버려진다. */
  progress(p: BaeProgress): void;
  /** 그림 요청의 기억 (HTML LS imageField · noStream). */
  imagePrefs: { get(): { imageField: BaeImageFieldName; stream: boolean }; set(p: { imageField: BaeImageFieldName; stream: boolean }): void };
  /** 미리보기 공개 주소 (자리만 정해지면 주소는 정해진다 — 올리기는 줄에서). */
  publicUrl(path: string): string;
  appVersion: string;
  origin: string;
  now?: () => number;
  fetch?: typeof fetch;
  /** 화면이 그린 뒤 마무리를 보내 주기를 기다리는 시간 (기본 3분). 지나면 GPT 그림 그대로 끝낸다. */
  finishWaitMs?: number;
}

/** 화면의 마무리를 기다리는 그림 (HTML finishPicture 를 화면이 하는 동안). */
interface PendingFinish {
  owner: string; base: BaeJobWrite; createdAt: string; t0: number; gpt: Uint8Array; model: string; quality: string;
  imageUsd: number | null; orderUsd: number | null; prompt: string; size: [number, number]; mats: Materials; timer: ReturnType<typeof setTimeout> | null;
}
/** 재료 미리보기: 올릴 것 [이름, 원본 파일, 긴 변] 과 기록에 적을 주소. */
interface Materials { shots: Array<[BaePreviewName, string, number]>; images: BaeJobImages }
/** 이 PC job.json 의 meta (서버 줄 + 이 PC 에만 두는 것). */
type LocalMeta = BaeJobWrite & { requestPrompt?: string; size?: [number, number]; ownerId?: string };

const FINISH_FAIL_NOTE = '그린 뒤 마무리를 하지 못해서 GPT가 그린 그대로 뒀어요.';
const UPSCALE_EPS = new Set(['dml', 'cpu', 'webgpu', 'wasm']);

const decodeDataUrl = (u: string | null | undefined): Uint8Array | null => {
  const m = typeof u === 'string' ? /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(u) : null;
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : null;
};
const failure = (e: unknown): BaeFailure => {
  const err = e as { name?: string; message?: string; code?: string } | null;
  const aborted = !!err && err.name === 'AbortError';
  return { ok: false, aborted, message: aborted ? '그만뒀어요.' : maskSecrets(err && err.message ? err.message : String(e)), code: (err && typeof err.code === 'string') ? err.code : null };
};
const isPng = (b: unknown): b is Uint8Array => b instanceof Uint8Array && b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
function pngSize(bytes: Uint8Array): { w: number; h: number } {
  // PNG IHDR: 16~23 바이트에 가로 · 세로
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return { w: 0, h: 0 };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

export function createBaeJobs(deps: BaeJobsDeps) {
  const now = deps.now ?? Date.now;
  const running = new Map<string, { ctl: AbortController; phase: 'order' | 'draw'; startedAt: number; owner: string }>();
  const pending = new Map<string, PendingFinish>();
  const finishWait = deps.finishWaitMs ?? 180_000;
  /** 같은 작업의 결과 바꾸기는 한 줄로 (빠르게 두 번 눌러도 차례대로). */
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined); chains.set(key, tail);
    void tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return run;
  };

  function begin(jobId: string, phase: 'order' | 'draw', owner: string) {
    if (!isBaeJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    if (running.has(jobId) || pending.has(jobId)) throw new Error('이 작업은 이미 진행 중이에요.');
    const entry = { ctl: new AbortController(), phase, startedAt: now(), owner };
    running.set(jobId, entry);
    return entry;
  }
  // 줄에 넣기는 실패해도 그림 작업을 막지 않는다 (줄 자체의 오류는 기록만).
  const quiet = (p: Promise<unknown>) => p.catch((e) => console.warn('[bae] 줄에 넣지 못함:', maskSecrets(e instanceof Error ? e.message : String(e))));
  const usage = (owner: string, line: BaeUsageLine) => quiet(deps.outbox.enqueue('usage', line, { id: line.requestId, owner }));
  const jobWrite = (owner: string, w: BaeJobWrite) => quiet(deps.outbox.enqueue('job', w, { id: `job-${w.id}-${randomUUID()}`, owner, orderKey: `job:${w.id}` }));
  const preview = (owner: string, jobId: string, name: BaePreviewName, file: string, max: number) =>
    quiet(deps.outbox.enqueue('preview', { jobId, file, name, max }, { id: `preview-${jobId}-${name}`, owner, orderKey: `preview:${jobId}` }));
  const urlOf = (jobId: string, n: BaePreviewName) => deps.publicUrl(baePreviewPath(jobId, n));

  /** 재료 원본을 이 PC 에 (그림 요청보다 먼저: 실패해도 무엇을 보냈는지 남는다). 미리보기는 그림이 끝났을 때 올린다. */
  async function saveMaterials(q: BaeDrawCall): Promise<Materials> {
    const shots: Materials['shots'] = []; const images: BaeJobImages = {};
    const keep = async (file: string, dataUrl: string | null | undefined) => { const b = decodeDataUrl(dataUrl); if (!b) return false; await deps.local.saveJobFile(q.jobId, q.createdAt, file, b); return true; };
    if (await keep('rough.jpg', q.previews.rough)) { shots.push(['rough.jpg', 'rough.jpg', 1600]); images.rough = urlOf(q.jobId, 'rough.jpg'); }
    if (await keep('rough_notes.jpg', q.previews.roughNotes)) { shots.push(['rough_notes.jpg', 'rough_notes.jpg', 1600]); images.roughNotes = urlOf(q.jobId, 'rough_notes.jpg'); }
    const refs = q.previews.refs.slice(0, 4);
    for (let i = 0; i < refs.length; i++) await keep(`ref_${i + 1}.jpg`, refs[i]);
    refs.forEach((_, i) => shots.push([`ref_${i + 1}.jpg` as BaePreviewName, `ref_${i + 1}.jpg`, 1600]));
    images.refs = refs.map((_, i) => urlOf(q.jobId, `ref_${i + 1}.jpg` as BaePreviewName));
    const bases = Array.isArray(q.previews.bases) ? q.previews.bases.slice(0, 3) : [];
    const baseUrls: string[] = [];
    for (let i = 0; i < bases.length; i++) {
      const n = `base_${i + 1}.jpg` as BaePreviewName;
      if (await keep(n, bases[i])) { shots.push([n, n, 1600]); baseUrls.push(urlOf(q.jobId, n)); }
    }
    if (baseUrls.length) images.bases = baseUrls;
    if (await keep('sheet.jpg', q.previews.sheet)) { shots.push(['sheet.jpg', 'sheet.jpg', 1600]); images.sheet = urlOf(q.jobId, 'sheet.jpg'); }
    return { shots, images };
  }

  /**
   * 그림 한 장을 끝낸다: 원본 · 판 파일을 이 PC 에 → 미리보기 줄 → job.json → 작업 줄 '완성'.
   * fin 이 없으면 메인이 끝내는 것(마무리 없음). 판 파일은 한 번 쓰면 바꾸지 않으므로 미리보기는 늘 그 파일에서 만든다.
   */
  async function complete(p: PendingFinish, fin: { png: Uint8Array; alt: Uint8Array | null; moved: number; tilt: number; note: string } | null): Promise<BaeDrawFinishOutcome> {
    const jobId = p.base.id; const c = p.createdAt;
    const png = fin ? fin.png : p.gpt;
    const differs = !!fin && !sameBytes(png, p.gpt);
    if (differs) await deps.local.saveJobFile(jobId, c, 'final.png', png);
    await deps.local.saveJobFile(jobId, c, 'result.png', png);
    const lock = fin && fin.moved > 0 ? { moved: fin.moved, on: true } : null;
    if (fin && lock) await deps.local.saveJobFile(jobId, c, 'alt.png', fin.alt ?? p.gpt);
    const { w, h } = pngSize(png);
    const sec = Math.round((now() - p.t0) / 1000);
    const total = (p.imageUsd != null || p.orderUsd != null) ? (p.imageUsd ?? 0) + (p.orderUsd ?? 0) : null;
    // 미리보기: 결과 1600 · 목록 320 (처음 그림 파일에서) · 달라졌으면 GPT 가 준 그대로 · 재료. 주소는 자리로 정해지고, 올리기는 줄에서.
    const first = differs ? 'final.png' : 'gpt.png';
    const shots: Materials['shots'] = [['result_1600.jpg', first, 1600], ['result_320.jpg', first, 320]];
    if (differs) shots.push(['gpt_1600.jpg', 'gpt.png', 1600]);
    shots.push(...p.mats.shots);
    for (const [name, file, max] of shots) await preview(p.owner, jobId, name, file, max);
    const images: BaeJobImages = { result: urlOf(jobId, 'result_1600.jpg'), thumb: urlOf(jobId, 'result_320.jpg'), ...(differs ? { gpt: urlOf(jobId, 'gpt_1600.jpg') } : {}), ...p.mats.images };
    const finish: BaeJobFinish | null = fin ? { tilt: fin.tilt || 0, lock, noise: null, ...(fin.note ? { note: fin.note } : {}) } : null;
    const result: BaeJobResult = { w, h, model: p.model, quality: p.quality, sec, usdOrder: p.orderUsd ?? undefined, usdImage: p.imageUsd ?? undefined, ...(finish ? { finish } : {}) };
    const doneWrite: BaeJobWrite = { ...p.base, status: 'done', result, images, costUsd: total ?? 0, finishedAt: new Date(now()).toISOString() };
    const meta: LocalMeta = { ...doneWrite, requestPrompt: p.prompt, size: p.size, ownerId: p.owner };
    await deps.local.writeJobMeta(jobId, c, meta);
    await jobWrite(p.owner, doneWrite);
    return { ok: true, jobId, w, h, sec, costUsd: total, imageUsd: p.imageUsd, model: p.model };
  }
  async function failJob(p: Pick<PendingFinish, 'owner' | 'base' | 'model'>, e: unknown): Promise<BaeFailure> {
    const f = failure(e);
    await jobWrite(p.owner, { ...p.base, status: 'failed', result: { error: f.message, model: p.model }, finishedAt: new Date(now()).toISOString() });
    return f;
  }
  /** 화면이 마무리를 보내지 않았다 (창을 닫음 · 앱을 끔): GPT 그림 그대로 끝낸다. */
  function finishFallback(jobId: string) {
    const p = pending.get(jobId); if (!p) return;
    pending.delete(jobId); if (p.timer) clearTimeout(p.timer);
    void complete(p, { png: p.gpt, alt: null, moved: 0, tilt: 0, note: FINISH_FAIL_NOTE }).catch((e) => failJob(p, e));
  }

  async function order(origin: { userId: string; epoch: number }, q: BaeOrderCall): Promise<BaeOrderOutcome | BaeFailure> {
    let entry;
    try { entry = begin(q.jobId, 'order', origin.userId); } catch (e) { return failure(e); }
    const t0 = now();
    try {
      const s = await deps.settings.get(origin.userId);
      const key = await deps.keyFor(origin);
      const materials: OrderMaterials = { ...q.materials, times: timeList(s.times.user ?? []), calib: s.calib };
      const isRev = !!q.revise;
      const dir = dirFor(isRev ? q.revise!.text : null, q.carry, materials.request, q.prevOrder);
      const revise = isRev && q.prevOrder ? reviseInput(q.revise!.text, q.prevPrompt, q.prevOrder, s.fixedText, q.revise!.reviewImage ?? null) : null;
      if (isRev && !revise) throw new Error('고칠 내용을 한국어로 써주세요');
      const req = buildPdRequest({
        manualText: s.manualText, fixedText: s.fixedText, rulesKo: s.guidanceText, model: s.models.pdModel, materials, inputs: q.inputs,
        styleMode: q.styleMode, library: q.library, manualIds: q.manualIds, libThumbs: q.libThumbs, revise, carry: q.carry, dir: dir.ko,
      });
      const requestId = randomUUID(); const at = new Date(now()).toISOString();
      const r = await postResponses({ apiBase: s.apiBase, key, body: req.body, fallbackBody: req.retryBody ?? undefined, signal: entry.ctl.signal, fetch: deps.fetch });
      // 돈이 나간 호출은 답을 읽기 전에 장부에 적는다
      const cost = pdCost(r.usage as { input_tokens?: number; output_tokens?: number } | null, s.models.pdModel, s.prices.pd);
      await usage(origin.userId, { requestId, jobId: q.jobId, kind: 'order', model: s.models.pdModel, tokens: numbers(r.usage), usd: cost ?? 0, at });
      const { obj } = readPdResponse(r.json, s.models.pdModel, s.prices.pd);
      const done = finishOrder({
        obj, cost, revText: isRev ? q.revise!.text : null, label: q.revise?.label ?? null, materials, fixedText: s.fixedText, inputs: q.inputs,
        styleMode: q.styleMode, library: q.library, manualIds: q.manualIds, dir, carry: q.carry, carryExtra: q.carryExtra, prevOrder: q.prevOrder,
        rate: s.prices.krwPerUsd, dirty: !!q.dirty, manualVer: manualVersion(s.manualText, s.manualText !== BAE_DEFAULT_MANUAL),
        blocksVer: blocksVersion(s.fixedText, s.fixedText !== BAE_DEFAULT_FIXED), rulesKo: s.guidanceText, manualPicks: q.manualPicks,
      });
      return { ok: true, ...done, costUsd: cost, sec: Math.round((now() - t0) / 1000) };
    } catch (e) {
      return failure(e);
    } finally { running.delete(q.jobId); }
  }

  async function draw(origin: { userId: string; epoch: number }, q: BaeDrawCall): Promise<BaeDrawOutcome | BaeFailure> {
    let entry;
    try { entry = begin(q.jobId, 'draw', origin.userId); } catch (e) { return failure(e); }
    const owner = origin.userId; const t0 = now();
    const base: BaeJobWrite = { id: q.jobId, kind: q.kind, status: 'drawing', parentJobId: q.parentJobId, name: q.name, summary: q.summary, pd: q.pd,
      costUsd: q.orderCostUsd ?? 0, origin: deps.origin, appVersion: deps.appVersion, createdAt: q.createdAt };
    let model = '';
    try {
      if (!Array.isArray(q.images) || !q.images.length || q.images.some((b) => !(b instanceof Uint8Array))) throw new Error('보낼 이미지를 준비하지 못했어요. 주문서를 다시 만들어 주세요.');
      const s = await deps.settings.get(owner);
      const key = await deps.keyFor(origin);
      model = baePickModel(q.imageModel, s.models.imageModel);
      const quality = baePickQuality(q.quality, s.models.imageQuality);
      const prompt = drawPrompt(q.promptText, q.ratio, q.tier, q.tilt);
      if (!prompt) throw new Error('주문서가 비어 있어요');
      const size = drawSizes(q.ratio, q.tier, q.tilt).gen;
      // 작업 줄 '그리는 중' + 재료 원본을 이 PC 에 (그림 요청보다 먼저: 실패해도 무엇을 보냈는지 남는다)
      await jobWrite(owner, base);
      q.images.forEach((b, i) => { if (i < 16) void deps.local.saveJobFile(q.jobId, q.createdAt, `input_${i + 1}.png`, b).catch(() => {}); });
      const mats = await saveMaterials(q);

      const prefs = deps.imagePrefs.get();
      const fields: BaeImageFormField[] = imageFields({ model, prompt, size, quality, stream: false, imageCount: q.images.length }, 'image[]')
        .map((f) => ('file' in f ? { name: f.name, file: { bytes: q.images[f.file], filename: f.filename, type: f.type } } : f));
      const requestId = randomUUID(); const at = new Date(now()).toISOString();
      const r = await postImageEdit({
        apiBase: s.apiBase, key, fields, signal: entry.ctl.signal, imageField: prefs.imageField, stream: prefs.stream, fetch: deps.fetch,
        onPartial: (b64, index) => deps.progress({ jobId: q.jobId, phase: 'draw', partial: { index, dataUrl: 'data:image/png;base64,' + b64 } }),
        onFieldChange: (p) => deps.imagePrefs.set(p),
      });
      const imageUsd = imageCost(r.usage as Parameters<typeof imageCost>[0], s.prices.image);
      await usage(owner, { requestId, jobId: q.jobId, kind: 'image', model, tokens: numbers(r.usage), usd: imageUsd ?? 0, at });
      const png = new Uint8Array(Buffer.from(r.b64, 'base64'));
      await deps.local.saveJobFile(q.jobId, q.createdAt, 'gpt.png', png);
      const p: PendingFinish = { owner, base, createdAt: q.createdAt, t0, gpt: png, model, quality, imageUsd, orderUsd: q.orderCostUsd,
        prompt, size: [size[0], size[1]], mats, timer: null };
      if (q.finish === true) {
        // 화면이 마무리한다 (기울기 되돌리기 · 색 맞춤): 작업은 끝내지 않고 GPT 그림을 돌려준다. 오지 않으면 GPT 그림 그대로 끝낸다.
        p.timer = setTimeout(() => finishFallback(q.jobId), finishWait);
        (p.timer as { unref?: () => void }).unref?.();
        pending.set(q.jobId, p);
        const { w, h } = pngSize(png);
        const total = (imageUsd != null || q.orderCostUsd != null) ? (imageUsd ?? 0) + (q.orderCostUsd ?? 0) : null;
        return { ok: true, jobId: q.jobId, png, w, h, sec: Math.round((now() - t0) / 1000), costUsd: total, imageUsd, model, finish: true };
      }
      const done = await complete(p, null);
      return { ...done, png };
    } catch (e) {
      const f = failure(e);
      await jobWrite(owner, { ...base, status: f.aborted ? 'stopped' : 'failed', result: { error: f.aborted ? '그만뒀어요. 이미 보낸 요청은 비용이 들 수 있어요.' : f.message, model }, finishedAt: new Date(now()).toISOString() });
      if (f.aborted) f.message = '그만뒀어요. 이미 보낸 요청은 비용이 들 수 있어요.';
      return f;
    } finally { running.delete(q.jobId); }
  }

  /** 화면이 마무리한 그림을 받아 작업을 끝낸다 (bae:draw-finish). 기다리던 그림이 없거나 다른 계정이면 거절. */
  async function drawFinish(origin: { userId: string; epoch: number }, c: BaeDrawFinishCall): Promise<BaeDrawFinishOutcome | BaeFailure> {
    const p = c && isBaeJobId(c.jobId) ? pending.get(c.jobId) : undefined;
    if (!p || p.owner !== origin.userId) return failure(new Error('마무리할 그림을 찾지 못했어요. 이미 끝났거나 다른 계정의 작업이에요.'));
    if (!isPng(c.png) || (c.alt != null && !isPng(c.alt))) return failure(new Error('마무리한 그림이 올바르지 않아요.'));
    pending.delete(c.jobId); if (p.timer) clearTimeout(p.timer);
    const moved = Number.isSafeInteger(c.moved) && c.moved > 0 ? Math.min(c.moved, 999) : 0;
    const tilt = Number.isFinite(c.tilt) ? Math.max(-45, Math.min(45, c.tilt)) : 0;
    const note = typeof c.note === 'string' ? c.note.slice(0, 400) : '';
    try { return await complete(p, { png: c.png, alt: moved && c.alt ? c.alt : null, moved, tilt, note }); }
    catch (e) { return failJob(p, e); }
  }

  /**
   * 결과 판 바꾸기 (HTML 색 맞춤 스위치 · 노이즈 제거 버튼): 판 파일을 result.png 로, 그 판의 미리보기를 줄에, 작업 줄의 result · images 를 고친다.
   * 처음 만드는 판(노이즈 제거한 그림)은 화면이 png 로 보낸다. 없는 판이면 code 'MISSING'.
   */
  function setResult(owner: string, c: BaeResultSetCall): Promise<BaeResultSetOutcome | BaeFailure> {
    return serial(`result:${c?.jobId}`, async () => {
      try {
        if (!c || !isBaeJobId(c.jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
        if (running.has(c.jobId) || pending.has(c.jobId)) throw new Error('아직 그리는 중인 작업이에요.');
        const v = { alt: c.variant?.alt === true, noise: c.variant?.noise === true };
        const meta = (await deps.local.readJobMeta(c.jobId)) as LocalMeta | null;
        if (!meta || meta.status !== 'done' || typeof meta.createdAt !== 'string') throw new Error('이 PC 에 이 그림의 원본이 없어요. 만든 PC 에서 해 주세요.');
        if (meta.ownerId && meta.ownerId !== owner) throw new Error('내가 만든 그림만 바꿀 수 있어요.');
        const prev: BaeJobFinish = meta.result?.finish ?? {};
        const lockPrev = prev.lock && prev.lock.moved > 0 ? prev.lock : null;
        if (v.alt && !lockPrev) throw new Error('색 맞춤을 한 그림이 아니에요.');
        const named = baeVariantFile(v);
        let file: string | null = null; let bytes: Uint8Array | null = null;
        if (named) {
          file = named;
          if (c.png != null) {
            if (!isPng(c.png)) throw new Error('보낸 그림이 올바르지 않아요.');
            await deps.local.saveJobFile(c.jobId, meta.createdAt, named, c.png); bytes = c.png;
          } else bytes = await deps.local.readJobFile(c.jobId, named);
        } else {
          if (c.png != null) throw new Error('처음 그림은 바꿀 수 없어요.');
          for (const f of BAE_BASE_VARIANT_FILES) { bytes = await deps.local.readJobFile(c.jobId, f); if (bytes) { file = f; break; } }
        }
        if (!bytes || !file) return { ok: false, aborted: false, message: '이 그림이 이 PC 에 아직 없어요.', code: 'MISSING' };
        await deps.local.saveJobFile(c.jobId, meta.createdAt, 'result.png', bytes);
        const { w, h } = pngSize(bytes);
        const pv = baeVariantPreviews(v);
        await preview(owner, c.jobId, pv.big, file, 1600);
        await preview(owner, c.jobId, pv.small, file, 320);
        const sec = typeof c.sec === 'number' && Number.isFinite(c.sec) && c.sec >= 0 ? Math.round(c.sec) : prev.noise?.sec;
        const finish: BaeJobFinish = { ...prev, lock: lockPrev ? { moved: lockPrev.moved, on: !v.alt } : (prev.lock ?? null),
          noise: v.noise ? { on: true, ...(sec != null ? { sec } : {}) } : prev.noise ? { ...prev.noise, on: false } : null };
        const result: BaeJobResult = { ...(meta.result ?? {}), w: w || meta.result?.w, h: h || meta.result?.h, finish };
        const images: BaeJobImages = { ...(meta.images ?? {}), result: urlOf(c.jobId, pv.big), thumb: urlOf(c.jobId, pv.small) };
        await deps.local.writeJobMeta(c.jobId, meta.createdAt, { ...meta, result, images });
        // 서버는 보낸 칸을 통째로 바꾼다: result · images 를 다 보낸다 (이름 · 검수는 보내지 않아 그대로).
        await jobWrite(owner, { id: c.jobId, status: 'done', result, images });
        return { ok: true, jobId: c.jobId, w, h, result, images };
      } catch (e) { return failure(e); }
    });
  }

  /**
   * 도구만 쓴 작업 (노이즈 제거 창 · 4K로 키우기 창): 불러온 그림 · 결과를 이 PC 에, 미리보기 줄, 작업 줄 한 번에 '완성'. 0원이라 장부 줄은 없다.
   * 4K: source.png = 키우기 전, final.png · result.png = 키운 그림 (판 파일은 한 번 쓰면 그대로라 미리보기는 final.png 에서).
   */
  async function toolJob(owner: string, c: BaeToolJobCall): Promise<BaeToolJobOutcome | BaeFailure> {
    try {
      if (!c || !isBaeJobId(c.jobId) || (c.kind !== 'denoise' && c.kind !== 'upscale')) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
      if (c.parentJobId !== null && !isBaeJobId(c.parentJobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
      if (typeof c.createdAt !== 'string' || !Number.isFinite(Date.parse(c.createdAt))) throw new Error('작업 시각이 올바르지 않아요.');
      if (!isPng(c.source) || !isPng(c.png)) throw new Error('보낸 그림이 올바르지 않아요.');
      if (c.kind === 'upscale') return await upscaleJob(owner, c);
      if (running.has(c.jobId) || pending.has(c.jobId) || (await deps.local.readJobMeta(c.jobId))) throw new Error('이 작업은 이미 있어요.');
      await deps.local.saveJobFile(c.jobId, c.createdAt, 'source.png', c.source);
      await deps.local.saveJobFile(c.jobId, c.createdAt, 'final_noise.png', c.png);
      await deps.local.saveJobFile(c.jobId, c.createdAt, 'result.png', c.png);
      const { w, h } = pngSize(c.png);
      const sec = Number.isFinite(c.sec) && c.sec >= 0 ? Math.round(c.sec) : 0;
      const shots: Materials['shots'] = [['noise_1600.jpg', 'final_noise.png', 1600], ['noise_320.jpg', 'final_noise.png', 320], ['result_1600.jpg', 'source.png', 1600], ['result_320.jpg', 'source.png', 320]];
      for (const [name, file, max] of shots) await preview(owner, c.jobId, name, file, max);
      const label = typeof c.label === 'string' ? c.label.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      const write: BaeJobWrite = {
        id: c.jobId, kind: 'denoise', status: 'done', parentJobId: c.parentJobId, name: null, summary: label ? { source: label } : {}, pd: {},
        result: { w, h, sec, finish: { tilt: 0, lock: null, noise: { on: true, sec } } },
        images: { result: urlOf(c.jobId, 'noise_1600.jpg'), thumb: urlOf(c.jobId, 'noise_320.jpg'), source: urlOf(c.jobId, 'result_1600.jpg') },
        costUsd: 0, origin: deps.origin, appVersion: deps.appVersion, createdAt: c.createdAt, finishedAt: new Date(now()).toISOString(),
      };
      const meta: LocalMeta = { ...write, ownerId: owner };
      await deps.local.writeJobMeta(c.jobId, c.createdAt, meta);
      await jobWrite(owner, write);
      return { ok: true, jobId: c.jobId, w, h };
    } catch (e) { return failure(e); }
  }
  async function upscaleJob(owner: string, c: BaeToolJobCall): Promise<BaeToolJobOutcome | BaeFailure> {
    const u = c.upscale;
    if (!u || (u.mode !== 'A' && u.mode !== 'B') || !UPSCALE_EPS.has(u.ep)) throw new Error('4K로 키운 방식이 올바르지 않아요.');
    const from = pngSize(c.source); const { w, h } = pngSize(c.png);
    if (!from.w || !from.h || w < from.w || h < from.h || w * h > BAE_UPSCALE_MAX_PIXELS) throw new Error('키운 그림의 크기가 올바르지 않아요.');
    if (running.has(c.jobId) || pending.has(c.jobId) || (await deps.local.readJobMeta(c.jobId))) throw new Error('이 작업은 이미 있어요.');
    await deps.local.saveJobFile(c.jobId, c.createdAt, 'source.png', c.source);
    await deps.local.saveJobFile(c.jobId, c.createdAt, 'final.png', c.png);
    await deps.local.saveJobFile(c.jobId, c.createdAt, 'result.png', c.png);
    const sec = Number.isFinite(c.sec) && c.sec >= 0 ? Math.round(c.sec) : 0;
    // 미리보기는 다른 결과와 같은 크기 (1600 · 320). 키운 원본 PNG 는 이 PC 에만.
    for (const [name, max] of [['result_1600.jpg', 1600], ['result_320.jpg', 320]] as const) await preview(owner, c.jobId, name, 'final.png', max);
    const label = typeof c.label === 'string' ? c.label.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const done = { mode: u.mode, ep: u.ep, fellBack: u.fellBack === true, from: [from.w, from.h] as [number, number] };
    const write: BaeJobWrite = {
      id: c.jobId, kind: 'upscale', status: 'done', parentJobId: c.parentJobId, name: null, summary: label ? { source: label } : {}, pd: {},
      result: { w, h, sec, model: BAE_UPSCALE_MODES[u.mode].modelName,
        finish: { tilt: 0, lock: null, noise: null, upscale: done, ...(c.fromPreview === true ? { note: UPSCALE_PREVIEW_NOTE } : {}) } },
      images: { result: urlOf(c.jobId, 'result_1600.jpg'), thumb: urlOf(c.jobId, 'result_320.jpg') },
      costUsd: 0, origin: deps.origin, appVersion: deps.appVersion, createdAt: c.createdAt, finishedAt: new Date(now()).toISOString(),
    };
    await deps.local.writeJobMeta(c.jobId, c.createdAt, { ...write, ownerId: owner } as LocalMeta);
    await jobWrite(owner, write);
    return { ok: true, jobId: c.jobId, w, h };
  }

  /** 만든 사람이 붙이는 것: 그림 이름 · 검수 (줄을 거쳐 서버로). 상태는 지금 상태를 그대로 보낸다 (서버가 되돌리지 않는다). */
  async function patch(owner: string, jobId: string, status: BaeJobWrite['status'], p: { name?: string | null; selfReview?: Record<string, unknown> | null }) {
    if (!isBaeJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const w: BaeJobWrite = { id: jobId, status };
    if ('name' in p) { const n = typeof p.name === 'string' ? p.name.trim() : ''; if (n.length > 80) throw new Error('그림 이름은 80자까지 쓸 수 있어요.'); w.name = n || null; }
    if ('selfReview' in p) w.selfReview = p.selfReview && typeof p.selfReview === 'object' ? p.selfReview : null;
    await jobWrite(owner, w);
    return true;
  }

  return {
    order, draw, patch, drawFinish, setResult, toolJob,
    abort(jobId: string, owner: string): boolean {
      const e = running.get(jobId); if (!e || e.owner !== owner) return false;
      e.ctl.abort(); return true;
    },
    active(owner: string) { return [...running.entries()].filter(([, e]) => e.owner === owner).map(([jobId, e]) => ({ jobId, phase: e.phase, startedAt: e.startedAt })); },
    /** 로그아웃 · 앱 끄기: 진행 중인 것을 모두 그만두고, 마무리를 기다리던 그림은 GPT 그림 그대로 끝낸다. */
    abortAll() { for (const e of running.values()) e.ctl.abort(); for (const id of [...pending.keys()]) finishFallback(id); },
    /** 화면의 마무리를 기다리는 작업 id (그 사람 것). */
    pendingFinish(owner: string) { return [...pending.entries()].filter(([, p]) => p.owner === owner).map(([jobId]) => jobId); },
  };
}
export type BaeJobs = ReturnType<typeof createBaeJobs>;

/** usage 에서 숫자만 (장부 tokens 칸). */
function numbers(u: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (o: unknown, prefix: string) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[prefix + k] = v;
      else if (v && typeof v === 'object' && prefix === '') walk(v, k + '.');
    }
  };
  walk(u, ''); return out;
}
