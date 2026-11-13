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
import type { BaeOrderCall, BaeOrderOutcome, BaeDrawCall, BaeDrawOutcome, BaeFailure, BaeProgress } from '../../src/shared/bae/makeCalls';
import { isBaeJobId, baePreviewPath, type BaeJobWrite, type BaeUsageLine, type BaePreviewName } from '../../src/shared/bae/jobs';
import { maskSecrets } from '../../src/shared/bae/secrets';
import { postResponses, postImageEdit, type BaeImageFieldName, type BaeImageFormField } from './openaiClient';
import type { BaeSettingsCache } from './baeSettingsCache';
import type { BaeLocalStore } from './localStore';
import type { BaeOutbox } from './outbox';
import { BAE_DEFAULT_FIXED, BAE_DEFAULT_MANUAL } from './defaultTexts';

export type { BaeOrderCall, BaeOrderOutcome, BaeDrawCall, BaeDrawOutcome, BaeFailure, BaeProgress } from '../../src/shared/bae/makeCalls';

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
}

const decodeDataUrl = (u: string | null | undefined): Uint8Array | null => {
  const m = typeof u === 'string' ? /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(u) : null;
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : null;
};
const failure = (e: unknown): BaeFailure => {
  const err = e as { name?: string; message?: string; code?: string } | null;
  const aborted = !!err && err.name === 'AbortError';
  return { ok: false, aborted, message: aborted ? '그만뒀어요.' : maskSecrets(err && err.message ? err.message : String(e)), code: (err && typeof err.code === 'string') ? err.code : null };
};
function pngSize(bytes: Uint8Array): { w: number; h: number } {
  // PNG IHDR: 16~23 바이트에 가로 · 세로
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return { w: 0, h: 0 };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

export function createBaeJobs(deps: BaeJobsDeps) {
  const now = deps.now ?? Date.now;
  const running = new Map<string, { ctl: AbortController; phase: 'order' | 'draw'; startedAt: number; owner: string }>();

  function begin(jobId: string, phase: 'order' | 'draw', owner: string) {
    if (!isBaeJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    if (running.has(jobId)) throw new Error('이 작업은 이미 진행 중이에요.');
    const entry = { ctl: new AbortController(), phase, startedAt: now(), owner };
    running.set(jobId, entry);
    return entry;
  }
  // 줄에 넣기는 실패해도 그림 작업을 막지 않는다 (줄 자체의 오류는 기록만).
  const quiet = (p: Promise<unknown>) => p.catch((e) => console.warn('[bae] 줄에 넣지 못함:', maskSecrets(e instanceof Error ? e.message : String(e))));
  const usage = (owner: string, line: BaeUsageLine) => quiet(deps.outbox.enqueue('usage', line, { id: line.requestId, owner }));
  const jobWrite = (owner: string, w: BaeJobWrite) => quiet(deps.outbox.enqueue('job', w, { id: `job-${w.id}-${randomUUID()}`, owner, orderKey: `job:${w.id}` }));

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
      model = s.models.imageModel;
      const prompt = drawPrompt(q.promptText, q.ratio, q.tier, q.tilt);
      if (!prompt) throw new Error('주문서가 비어 있어요');
      const size = drawSizes(q.ratio, q.tier, q.tilt).gen;
      // 작업 줄 '그리는 중' + 재료 원본을 이 PC 에 (그림 요청보다 먼저: 실패해도 무엇을 보냈는지 남는다)
      await jobWrite(owner, base);
      q.images.forEach((b, i) => { if (i < 16) void deps.local.saveJobFile(q.jobId, q.createdAt, `input_${i + 1}.png`, b).catch(() => {}); });
      const roughBytes = decodeDataUrl(q.previews.rough); const notesBytes = decodeDataUrl(q.previews.roughNotes);
      if (roughBytes) await deps.local.saveJobFile(q.jobId, q.createdAt, 'rough.jpg', roughBytes);
      if (notesBytes) await deps.local.saveJobFile(q.jobId, q.createdAt, 'rough_notes.jpg', notesBytes);
      for (let i = 0; i < Math.min(4, q.previews.refs.length); i++) { const b = decodeDataUrl(q.previews.refs[i]); if (b) await deps.local.saveJobFile(q.jobId, q.createdAt, `ref_${i + 1}.jpg`, b); }

      const prefs = deps.imagePrefs.get();
      const fields: BaeImageFormField[] = imageFields({ model, prompt, size, quality: s.models.imageQuality, stream: false, imageCount: q.images.length }, 'image[]')
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
      const { w, h } = pngSize(png);
      await deps.local.saveJobFile(q.jobId, q.createdAt, 'gpt.png', png);
      await deps.local.saveJobFile(q.jobId, q.createdAt, 'result.png', png);
      const sec = Math.round((now() - t0) / 1000);
      const total = (imageUsd != null || q.orderCostUsd != null) ? (imageUsd ?? 0) + (q.orderCostUsd ?? 0) : null;
      // 미리보기: 결과 1600 · 목록 320 · 러프 · 메모 러프 · 레퍼런스. 주소는 자리로 정해지고, 올리기는 줄에서.
      const shots: Array<[BaePreviewName, string, number]> = [['result_1600.jpg', 'result.png', 1600], ['result_320.jpg', 'result.png', 320]];
      if (roughBytes) shots.push(['rough.jpg', 'rough.jpg', 1600]);
      if (notesBytes) shots.push(['rough_notes.jpg', 'rough_notes.jpg', 1600]);
      q.previews.refs.slice(0, 4).forEach((_, i) => shots.push([`ref_${i + 1}.jpg` as BaePreviewName, `ref_${i + 1}.jpg`, 1600]));
      for (const [name, file, max] of shots) await quiet(deps.outbox.enqueue('preview', { jobId: q.jobId, file, name, max }, { id: `preview-${q.jobId}-${name}`, owner, orderKey: `preview:${q.jobId}` }));
      const url = (n: BaePreviewName) => deps.publicUrl(baePreviewPath(q.jobId, n));
      const images = { result: url('result_1600.jpg'), thumb: url('result_320.jpg'), ...(roughBytes ? { rough: url('rough.jpg') } : {}),
        ...(notesBytes ? { roughNotes: url('rough_notes.jpg') } : {}), refs: q.previews.refs.slice(0, 4).map((_, i) => url(`ref_${i + 1}.jpg` as BaePreviewName)) };
      const doneWrite: BaeJobWrite = { ...base, status: 'done', result: { w, h, model, quality: s.models.imageQuality, sec, usdOrder: q.orderCostUsd ?? undefined, usdImage: imageUsd ?? undefined },
        images, costUsd: total ?? 0, finishedAt: new Date(now()).toISOString() };
      await deps.local.writeJobMeta(q.jobId, q.createdAt, { ...doneWrite, requestPrompt: prompt, size });
      await jobWrite(owner, doneWrite);
      return { ok: true, jobId: q.jobId, png, w, h, sec, costUsd: total, imageUsd, model };
    } catch (e) {
      const f = failure(e);
      await jobWrite(owner, { ...base, status: f.aborted ? 'stopped' : 'failed', result: { error: f.aborted ? '그만뒀어요. 이미 보낸 요청은 비용이 들 수 있어요.' : f.message, model }, finishedAt: new Date(now()).toISOString() });
      if (f.aborted) f.message = '그만뒀어요. 이미 보낸 요청은 비용이 들 수 있어요.';
      return f;
    } finally { running.delete(q.jobId); }
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
    order, draw, patch,
    abort(jobId: string, owner: string): boolean {
      const e = running.get(jobId); if (!e || e.owner !== owner) return false;
      e.ctl.abort(); return true;
    },
    active(owner: string) { return [...running.entries()].filter(([, e]) => e.owner === owner).map(([jobId, e]) => ({ jobId, phase: e.phase, startedAt: e.startedAt })); },
    /** 로그아웃 · 앱 끄기: 진행 중인 것을 모두 그만둔다. */
    abortAll() { for (const e of running.values()) e.ctl.abort(); },
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
