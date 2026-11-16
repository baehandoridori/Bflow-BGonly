/**
 * BAE경 '다른 각도로' 작업 (메인). 화면이 입체 판에서 만든 그림 · 카메라 문장을 받아 HTML v0.4.11 agGo 의 순서대로:
 *   작업 줄 '그리는 중' → 재료 원본을 이 PC 에 → (메모가 있으면) PD메모 읽기 (약 20원, 장부 'note') → 주문서 마저 쓰기 →
 *   그림 요청 (장부 'angle') → 원본 · 미리보기 → 작업 줄 '완성' (종류 'angle').
 * 요청 몸은 HTML 과 같다: PD메모 = agMemoPD 의 /responses 몸, 그림 = callImage 의 /images/edits 필드 (주문서는 비율 문장을 붙이지 않는다).
 * PD 를 못 부르면(인터넷 · 서버 문제) 그림은 계속 그리고 메모 글과 자리를 그대로 넣는다 (HTML 과 같음). 그만두기는 작업마다.
 * 서버로 갈 것은 모두 '못 보낸 것 줄'(outbox)을 거친다. electron 을 import 하지 않는다 (node 시험이 그대로 읽는다).
 */
import { randomUUID } from 'node:crypto';
import { imageFields, imageCost, pdCost } from '../../src/shared/bae/order';
import { anglePromptText, angleMemoBody, readAngleMemo, type AngleMemo } from '../../src/shared/bae/angle/order';
import { baeAngleCallProblem, type BaeAngleDrawCall, type BaeAngleDrawOutcome, type BaeAngleRecord, type BaeAngleSummary } from '../../src/shared/bae/angle/calls';
import { isBaeJobId, baePreviewPath, type BaeJobWrite, type BaeUsageLine, type BaePreviewName, type BaeJobImages, type BaeJobResult } from '../../src/shared/bae/jobs';
import type { BaeFailure, BaeProgress } from '../../src/shared/bae/makeCalls';
import { maskSecrets } from '../../src/shared/bae/secrets';
import { postResponses, postImageEdit, responseOutputText, type BaeImageFieldName, type BaeImageFormField } from './openaiClient';
import type { BaeSettingsCache } from './baeSettingsCache';
import type { BaeLocalStore } from './localStore';
import type { BaeOutbox } from './outbox';

export type { BaeAngleDrawCall, BaeAngleDrawOutcome } from '../../src/shared/bae/angle/calls';

export interface BaeAngleDeps {
  settings: BaeSettingsCache;
  keyFor(origin: { userId: string; epoch: number }): Promise<string>;
  local: Pick<BaeLocalStore, 'saveJobFile' | 'writeJobMeta'>;
  outbox: Pick<BaeOutbox, 'enqueue'>;
  /** 진행 알림 (중간 그림 · 'PD가 메모 읽는 중'). 화면이 없으면 버려진다. */
  progress(p: BaeProgress & { memo?: 'reading' | 'done' | 'raw' }): void;
  /** 그림 요청의 기억 (HTML LS imageField · noStream) — baeMain 의 것을 같이 쓴다. */
  imagePrefs: { get(): { imageField: BaeImageFieldName; stream: boolean }; set(p: { imageField: BaeImageFieldName; stream: boolean }): void };
  /** 미리보기 공개 주소 */
  publicUrl(path: string): string;
  appVersion: string;
  origin: string;
  now?: () => number;
  fetch?: typeof fetch;
}

const decodeJpeg = (u: string | null | undefined): Uint8Array | null => {
  const m = typeof u === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(u) : null;
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : null;
};
const failure = (e: unknown): BaeFailure => {
  const err = e as { name?: string; message?: string; code?: string } | null;
  const aborted = !!err && err.name === 'AbortError';
  return { ok: false, aborted, message: aborted ? '그만뒀어요.' : maskSecrets(err && err.message ? err.message : String(e)), code: (err && typeof err.code === 'string') ? err.code : null };
};
function pngSize(bytes: Uint8Array): { w: number; h: number } {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return { w: 0, h: 0 };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}
/** usage 에서 숫자만 (장부 tokens 칸, baeJobs 와 같은 규칙). */
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

export function createBaeAngle(deps: BaeAngleDeps) {
  const now = deps.now ?? Date.now;
  const running = new Map<string, { ctl: AbortController; startedAt: number; owner: string }>();
  const quiet = (p: Promise<unknown>) => p.catch((e) => console.warn('[bae] 줄에 넣지 못함:', maskSecrets(e instanceof Error ? e.message : String(e))));
  const usage = (owner: string, line: BaeUsageLine) => quiet(deps.outbox.enqueue('usage', line, { id: line.requestId, owner }));
  const jobWrite = (owner: string, w: BaeJobWrite) => quiet(deps.outbox.enqueue('job', w, { id: `job-${w.id}-${randomUUID()}`, owner, orderKey: `job:${w.id}` }));
  const preview = (owner: string, jobId: string, name: BaePreviewName, file: string, max: number) =>
    quiet(deps.outbox.enqueue('preview', { jobId, file, name, max }, { id: `preview-${jobId}-${name}`, owner, orderKey: `preview:${jobId}` }));
  const urlOf = (jobId: string, n: BaePreviewName) => deps.publicUrl(baePreviewPath(jobId, n));

  async function draw(origin: { userId: string; epoch: number }, q: BaeAngleDrawCall): Promise<BaeAngleDrawOutcome | BaeFailure> {
    const owner = origin.userId; const t0 = now();
    if (!q || !isBaeJobId(q.jobId)) return failure(new Error('BAE경 작업 번호가 올바르지 않아요.'));
    if (q.parentJobId !== null && !isBaeJobId(q.parentJobId)) return failure(new Error('BAE경 작업 번호가 올바르지 않아요.'));
    if (typeof q.createdAt !== 'string' || !Number.isFinite(Date.parse(q.createdAt))) return failure(new Error('작업 시각이 올바르지 않아요.'));
    const bad = baeAngleCallProblem(q); if (bad) return failure(new Error(bad));
    if (running.has(q.jobId)) return failure(new Error('이 작업은 이미 진행 중이에요.'));
    const entry = { ctl: new AbortController(), startedAt: t0, owner };
    running.set(q.jobId, entry);
    const record: BaeAngleRecord = { ...q.record, memo: null };
    const summary: BaeAngleSummary = {
      size: [q.size[0], q.size[1]], place: q.order.kind, source: q.record.fromName || undefined,
      angle: { ...record, line: q.line.slice(0, 600), fileName: q.fileName.slice(0, 200) },
    };
    const base: BaeJobWrite = { id: q.jobId, kind: 'angle', status: 'drawing', parentJobId: q.parentJobId, name: null, summary, pd: {},
      costUsd: 0, origin: deps.origin, appVersion: deps.appVersion, createdAt: q.createdAt };
    let model = ''; let memoUsd: number | null = null;
    try {
      const s = await deps.settings.get(owner);
      const key = await deps.keyFor(origin);
      model = s.models.imageModel;
      // 작업 줄 '그리는 중' + 재료 원본을 이 PC 에 (그림 요청보다 먼저: 실패해도 무엇을 보냈는지 남는다)
      await jobWrite(owner, base);
      q.images.forEach((b, i) => { void deps.local.saveJobFile(q.jobId, q.createdAt, `input_${i + 1}.png`, b).catch(() => {}); });
      const shots: Array<[BaePreviewName, string, number]> = []; const images: BaeJobImages = {};
      const keep = async (file: string, url: string | null | undefined) => { const b = decodeJpeg(url); if (!b) return false; await deps.local.saveJobFile(q.jobId, q.createdAt, file, b); return true; };
      if (await keep('rough.jpg', q.previews.rough)) { shots.push(['rough.jpg', 'rough.jpg', 1600]); images.rough = urlOf(q.jobId, 'rough.jpg'); }
      if (await keep('rough_notes.jpg', q.previews.roughNotes)) { shots.push(['rough_notes.jpg', 'rough_notes.jpg', 1600]); images.roughNotes = urlOf(q.jobId, 'rough_notes.jpg'); }
      const refs = q.previews.refs.slice(0, 4); const refUrls: string[] = [];
      for (let i = 0; i < refs.length; i++) { const n = `ref_${i + 1}.jpg` as BaePreviewName; if (await keep(n, refs[i])) { shots.push([n, n, 1600]); refUrls.push(urlOf(q.jobId, n)); } }
      images.refs = refUrls;

      // PD메모: 그림 모델은 메모를 못 본다. PD 가 메모 없는 · 있는 밑그림과 목록을 읽고 그림 모델에게 할 말을 쓴다.
      let memo: AngleMemo | null = null; let pdKo = ''; let memoErr = '';
      if (q.memo) {
        deps.progress({ jobId: q.jobId, phase: 'draw', memo: 'reading' });
        const pdModel = s.models.pdModel; const requestId = randomUUID(); const at = new Date(now()).toISOString();
        try {
          const r = await postResponses({ apiBase: s.apiBase, key, body: angleMemoBody(pdModel, q.memo.clean, q.memo.noted, q.memo.summary), signal: entry.ctl.signal, fetch: deps.fetch });
          // 돈이 나간 호출은 답을 읽기 전에 장부에 적는다
          const cost = pdCost(r.usage as { input_tokens?: number; output_tokens?: number } | null, pdModel, s.prices.pd);
          await usage(owner, { requestId, jobId: q.jobId, kind: 'note', model: pdModel, tokens: numbers(r.usage), usd: cost ?? 0, at });
          memoUsd = cost;
          const m = readAngleMemo(responseOutputText(r.json));
          memo = { pd: m.en }; pdKo = m.ko;
          deps.progress({ jobId: q.jobId, phase: 'draw', memo: 'done' });
        } catch (e) {
          if (e && (e as { name?: string }).name === 'AbortError') throw e;
          memo = { raw: q.memo.raw }; memoErr = maskSecrets(String((e && (e as Error).message) || e)).slice(0, 200);   // the notes still go, as they are
          deps.progress({ jobId: q.jobId, phase: 'draw', memo: 'raw' });
        }
        record.memo = { n: q.memo.n, pd: memo && memo.pd ? memo.pd : null, ko: pdKo, raw: !!(memo && memo.raw), err: memoErr, cost: memoErr ? null : memoUsd };
      }
      const prompt = anglePromptText(q.order.kind, q.order.sentence, { n: q.order.n, notes: q.order.notes, memo, crop: q.order.crop, under: q.order.under });

      const prefs = deps.imagePrefs.get();
      const fields: BaeImageFormField[] = imageFields({ model, prompt, size: q.size, quality: s.models.imageQuality, stream: false, imageCount: q.images.length }, 'image[]')
        .map((f) => ('file' in f ? { name: f.name, file: { bytes: q.images[f.file], filename: f.filename, type: f.type } } : f));
      const requestId = randomUUID(); const at = new Date(now()).toISOString();
      const r = await postImageEdit({
        apiBase: s.apiBase, key, fields, signal: entry.ctl.signal, imageField: prefs.imageField, stream: prefs.stream, fetch: deps.fetch,
        onPartial: (b64, index) => deps.progress({ jobId: q.jobId, phase: 'draw', partial: { index, dataUrl: 'data:image/png;base64,' + b64 } }),
        onFieldChange: (p) => deps.imagePrefs.set(p),
      });
      const imageUsd = imageCost(r.usage as Parameters<typeof imageCost>[0], s.prices.image);
      await usage(owner, { requestId, jobId: q.jobId, kind: 'angle', model, tokens: numbers(r.usage), usd: imageUsd ?? 0, at });
      const png = new Uint8Array(Buffer.from(r.b64, 'base64'));
      await deps.local.saveJobFile(q.jobId, q.createdAt, 'gpt.png', png);
      await deps.local.saveJobFile(q.jobId, q.createdAt, 'result.png', png);
      const { w, h } = pngSize(png);
      const sec = Math.round((now() - t0) / 1000);
      const total = (imageUsd != null || memoUsd != null) ? (imageUsd ?? 0) + (memoUsd ?? 0) : null;
      for (const [name, file, max] of ([['result_1600.jpg', 'gpt.png', 1600], ['result_320.jpg', 'gpt.png', 320]] as Array<[BaePreviewName, string, number]>).concat(shots)) await preview(owner, q.jobId, name, file, max);
      images.result = urlOf(q.jobId, 'result_1600.jpg'); images.thumb = urlOf(q.jobId, 'result_320.jpg');
      const result: BaeJobResult = { w, h, model, quality: s.models.imageQuality, sec, usdImage: imageUsd ?? undefined, ...(memoUsd != null ? { usdOrder: memoUsd } : {}) };
      const pdNotes = memo && memo.pd ? [pdKo || memo.pd] : [];
      const doneSummary: BaeAngleSummary = { ...summary, angle: { ...summary.angle, memo: record.memo } };
      const doneWrite: BaeJobWrite = { ...base, status: 'done', summary: doneSummary, pd: { prompt, notesKo: pdNotes, ...(q.memo ? { model: s.models.pdModel } : {}) }, result, images,
        costUsd: total ?? 0, finishedAt: new Date(now()).toISOString() };
      await deps.local.writeJobMeta(q.jobId, q.createdAt, { ...doneWrite, requestPrompt: prompt, size: [q.size[0], q.size[1]], ownerId: owner });
      await jobWrite(owner, doneWrite);
      return { ok: true, jobId: q.jobId, png, w, h, sec, costUsd: total, imageUsd, memoUsd, model, prompt, memo: record.memo, label: q.label };
    } catch (e) {
      const f = failure(e);
      const msg = f.aborted ? '그만뒀어요. 이미 보낸 요청은 비용이 들 수 있어요.' : f.message;
      await jobWrite(owner, { ...base, status: f.aborted ? 'stopped' : 'failed', result: { error: msg, model }, costUsd: memoUsd ?? 0, finishedAt: new Date(now()).toISOString() });
      f.message = f.aborted ? msg : '다른 각도로 그리지 못했어요: ' + f.message;
      return f;
    } finally { running.delete(q.jobId); }
  }

  return {
    draw,
    abort(jobId: string, owner: string): boolean { const e = running.get(jobId); if (!e || e.owner !== owner) return false; e.ctl.abort(); return true; },
    active(owner: string) { return [...running.entries()].filter(([, e]) => e.owner === owner).map(([jobId, e]) => ({ jobId, phase: 'draw' as const, startedAt: e.startedAt })); },
    /** 로그아웃 · 앱 끄기 */
    abortAll() { for (const e of running.values()) e.ctl.abort(); },
  };
}
export type BaeAngle = ReturnType<typeof createBaeAngle>;
