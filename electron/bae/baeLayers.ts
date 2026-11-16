/**
 * BAE경 '레이어로 나누기' 메인 쪽 (5단계, 계획 14 3-2 · 3-4 · 14d 3-2). 엔진은 화면 쪽 일꾼에서 돌고, 여기는
 *   - GPT: 엔진이 묻는 그대로 (PD 물건 찾기 약 10원 · 빈 방 다시 그리기 약 80원 · 네모로 더한 물건 이름 약 5원 + 그 자리 약 80원 ·
 *     앞뒤 판단 · 앞 지우고 뒤 완성). 요청 몸은 HTML v0.4.4 엔진의 browserGpt 와 같다 (src/shared/bae/layers.ts). 키는 여기만.
 *   - 장부: 돈이 나간 호출마다 줄 하나 (kind 'layers'), 못 보낸 것 줄(outbox)을 거친다 — baeJobs.ts 와 같은 길.
 *   - 기록: 작업 한 건 (kind 'layers'). 줄은 돈이 처음 나갈 때('그리는 중') 또는 다 나눴을 때('완성') 생긴다.
 *     실패는 늘 남기고, 계획만 고치고 창을 닫으면 돈이 나간 작업만 '그만둠'으로.
 *   - 이 PC: 나눌 그림(source.png|jpg) · PSD(layers.psd)는 작업 폴더, GPT 답과 계획은 cache\layers\{사람 · 그림 해시}\g{판}\.
 *     같은 그림을 다시 나누면 GPT 답을 다시 쓰므로 0원. '저장해 둔 단계 지우기'는 파일을 지우지 않고 새 판(g+1)으로 넘어간다.
 * electron 을 import 하지 않는다 (폴더 열기는 주입받는다).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  baeLayersPdBody, baeLayersEditFields, baeLayersPdProblem, baeLayersEditProblem, baeLayersStoreFile, baeLayersJobSummary,
  isBaeLayersJobId, isPngBytes, isPictureBytes, BAE_LAYERS_PIC_RE, BAE_LAYERS_MAX_JSON, BAE_LAYERS_MAX_PSD, baeLayersEdgesRecord,
  type BaeLayersEdgesMethod, type BaeLayersBeginCall, type BaeLayersPdCall, type BaeLayersEditCall, type BaeLayersDoneCall,
  type BaeLayersPdOutcome, type BaeLayersEditOutcome, type BaeLayersDoneOutcome, type BaeLayersSummaryLite,
} from '../../src/shared/bae/layers';
import type { BaeFailure } from '../../src/shared/bae/makeCalls';
import { isBaeJobId, baePreviewPath, type BaeJobWrite, type BaeUsageLine, type BaePreviewName, type BaeJobResult } from '../../src/shared/bae/jobs';
import { pdCost } from '../../src/shared/bae/order/pd';
import { imageCost } from '../../src/shared/bae/order/image';
import { maskSecrets } from '../../src/shared/bae/secrets';
import { postResponses, postImageEdit, responseOutputText, BaeOpenAiError, type BaeImageFieldName, type BaeImageFormField } from './openaiClient';
import { writeFileAtomic } from './atomicFile';
import type { BaeSettingsCache } from './baeSettingsCache';
import type { BaeLocalStore } from './localStore';
import type { BaeOutbox } from './outbox';

export interface BaeLayersDeps {
  settings: Pick<BaeSettingsCache, 'get'>;
  keyFor(origin: { userId: string; epoch: number }): Promise<string>;
  local: Pick<BaeLocalStore, 'saveJobFile' | 'jobDir' | 'cacheDir'>;
  outbox: Pick<BaeOutbox, 'enqueue'>;
  /** 그림 요청의 기억 (baeMain 의 imagePrefs 와 같은 것). 레이어 요청은 스트림을 쓰지 않으므로 그림 칸 이름만 바꾼다. */
  imagePrefs: { get(): { imageField: BaeImageFieldName; stream: boolean }; set(p: { imageField: BaeImageFieldName; stream: boolean }): void };
  publicUrl(path: string): string;
  /** 탐색기에서 그 파일을 고른 채로 폴더 열기 (main: shell.showItemInFolder) */
  showItemInFolder(path: string): void;
  appVersion: string;
  origin: string;
  now?: () => number;
  fetch?: typeof fetch;
}

/** 기록 줄의 result 에 더 적는 것 (BaeJobResult 에 없는 칸 — 화면이 읽으려면 jobs.ts 에 같은 이름으로 더하면 된다). */
export interface BaeLayersResultExtra { layers?: { count: number; shadows: number; bins: { OL: number; ML: number; UL: number }; left: number; merged: number; props: number; stackDiff: number; again: boolean; file: 'layers.psd'; edges: BaeLayersEdgesMethod; edgesNote: string } }

interface Job {
  owner: string; createdAt: string; parentJobId: string | null; label: string; w: number; h: number; t0: number;
  pdUsd: number; imageUsd: number; calls: number; rowWritten: boolean; status: 'working' | 'done' | 'failed' | 'stopped';
  ctls: Set<AbortController>; psdPath: string | null; sourceFile: 'source.png' | 'source.jpg';
}

const failure = (e: unknown): BaeFailure => {
  const err = e as { name?: string; message?: string; code?: string } | null;
  const aborted = !!err && err.name === 'AbortError';
  return { ok: false, aborted, message: aborted ? '그만뒀어요. 이미 보낸 GPT 요청은 비용이 들 수 있어요.' : maskSecrets(err && err.message ? err.message : String(e)), code: err && typeof err.code === 'string' ? err.code : null };
};
const fail = (message: string): BaeFailure => ({ ok: false, aborted: false, message, code: null });
const isJpeg = (b: Uint8Array) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;

/** usage 에서 숫자만 (장부 tokens 칸, baeJobs.ts 와 같은 규칙). */
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

export function createBaeLayers(deps: BaeLayersDeps) {
  const now = deps.now ?? Date.now;
  const jobs = new Map<string, Job>();
  const quiet = (p: Promise<unknown>) => p.catch((e) => console.warn('[bae layers] 줄에 넣지 못함:', maskSecrets(e instanceof Error ? e.message : String(e))));
  const usage = (owner: string, line: BaeUsageLine) => quiet(deps.outbox.enqueue('usage', line, { id: line.requestId, owner }));
  const jobWrite = (owner: string, w: BaeJobWrite) => quiet(deps.outbox.enqueue('job', w, { id: `job-${w.id}-${randomUUID()}`, owner, orderKey: `job:${w.id}` }));
  const preview = (owner: string, jobId: string, name: BaePreviewName, file: string, max: number) =>
    quiet(deps.outbox.enqueue('preview', { jobId, file, name, max }, { id: `preview-${jobId}-${name}`, owner, orderKey: `preview:${jobId}` }));
  const urlOf = (jobId: string, n: BaePreviewName) => deps.publicUrl(baePreviewPath(jobId, n));
  const total = (j: Job) => j.pdUsd + j.imageUsd;
  const baseRow = (jobId: string, j: Job): BaeJobWrite => ({
    id: jobId, kind: 'layers', status: 'drawing', parentJobId: j.parentJobId, name: null, summary: baeLayersJobSummary(j.label, j.w, j.h), pd: {},
    costUsd: total(j), origin: deps.origin, appVersion: deps.appVersion, createdAt: j.createdAt,
  });
  /** 돈이 처음 나갈 때 기록 줄을 연다 ('그리는 중'). 미리보기는 나눌 그림 (작업 폴더의 source). */
  async function openRow(jobId: string, j: Job) {
    if (j.rowWritten) return;
    j.rowWritten = true;
    await preview(j.owner, jobId, 'result_1600.jpg', j.sourceFile, 1600);
    await preview(j.owner, jobId, 'result_320.jpg', j.sourceFile, 320);
    await jobWrite(j.owner, { ...baseRow(jobId, j), images: { result: urlOf(jobId, 'result_1600.jpg'), thumb: urlOf(jobId, 'result_320.jpg') } });
  }
  function jobOf(owner: string, jobId: unknown): Job {
    if (!isBaeLayersJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const j = jobs.get(jobId);
    if (!j || j.owner !== owner) throw new Error('이 레이어 작업을 찾지 못했어요. 창을 다시 열어 주세요.');
    return j;
  }
  async function guarded<T>(j: Job, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctl = new AbortController(); j.ctls.add(ctl);
    try { return await fn(ctl.signal); } finally { j.ctls.delete(ctl); }
  }

  /* ---------- GPT 답 저장 (이 PC) ---------- */
  const storeRoot = (owner: string, pic: string) => {
    if (typeof pic !== 'string' || !BAE_LAYERS_PIC_RE.test(pic)) throw new Error('그림 해시가 올바르지 않아요.');
    // 사람마다 따로 (같은 PC 의 다른 계정이 내 계획 · 답을 쓰지 않게). 경로에는 해시만.
    return join(deps.local.cacheDir, 'layers', createHash('sha256').update(owner + '\n' + pic).digest('hex').slice(0, 40));
  };
  async function generation(root: string): Promise<number> {
    try { const v = JSON.parse((await readFile(join(root, 'current.json'))).toString('utf8')) as { g?: unknown }; return Number.isSafeInteger(v.g) && (v.g as number) >= 1 ? (v.g as number) : 1; }
    catch { return 1; }
  }
  const storeChains = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (storeChains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined); storeChains.set(key, tail);
    void tail.then(() => { if (storeChains.get(key) === tail) storeChains.delete(key); });
    return run;
  };

  return {
    /** 창이 그림 하나로 일을 시작할 때 (물건 찾기 전에). 나눌 그림을 이 PC 작업 폴더에 둔다. 기록 줄은 아직 없다. */
    async begin(owner: string, c: BaeLayersBeginCall): Promise<{ ok: true; jobId: string } | BaeFailure> {
      try {
        if (!c || typeof c !== 'object' || !isBaeLayersJobId(c.jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
        if (c.parentJobId !== null && !isBaeJobId(c.parentJobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
        if (typeof c.createdAt !== 'string' || !Number.isFinite(Date.parse(c.createdAt))) throw new Error('작업 시각이 올바르지 않아요.');
        if (!isPictureBytes(c.source)) throw new Error('나눌 그림이 올바르지 않아요.');
        const have = jobs.get(c.jobId);
        if (have) { if (have.owner !== owner) throw new Error('이 레이어 작업을 찾지 못했어요. 창을 다시 열어 주세요.'); return { ok: true, jobId: c.jobId }; }
        const w = Number.isSafeInteger(c.w) && (c.w as number) > 0 && (c.w as number) <= 16384 ? (c.w as number) : 0;
        const h = Number.isSafeInteger(c.h) && (c.h as number) > 0 && (c.h as number) <= 16384 ? (c.h as number) : 0;
        const sourceFile = isJpeg(c.source) ? 'source.jpg' : 'source.png';
        await deps.local.saveJobFile(c.jobId, c.createdAt, sourceFile, c.source);
        jobs.set(c.jobId, {
          owner, createdAt: new Date(Date.parse(c.createdAt)).toISOString(), parentJobId: c.parentJobId, label: typeof c.label === 'string' ? c.label : '', w, h, t0: now(),
          pdUsd: 0, imageUsd: 0, calls: 0, rowWritten: false, status: 'working', ctls: new Set(), psdPath: null, sourceFile,
        });
        return { ok: true, jobId: c.jobId };
      } catch (e) { return failure(e); }
    },

    /** PD (물건 찾기 · 앞뒤 판단 · 네모 안 물건 이름). browserGpt.pd 와 같은 몸, 같은 비용 셈. */
    async pd(origin: { userId: string; epoch: number }, c: BaeLayersPdCall): Promise<BaeLayersPdOutcome | BaeFailure> {
      try {
        const problem = baeLayersPdProblem(c); if (problem) throw new Error(problem);
        const j = jobOf(origin.userId, c.jobId);
        const s = await deps.settings.get(origin.userId);
        const key = await deps.keyFor(origin);
        const model = s.models.pdModel;
        return await guarded(j, async (signal) => {
          const body = baeLayersPdBody({ model, prompt: c.prompt, images: c.images, schema: c.schema, name: c.name });
          const requestId = randomUUID(); const at = new Date(now()).toISOString();
          const r = await postResponses({ apiBase: s.apiBase, key, body, signal, fetch: deps.fetch });
          // 돈이 나간 호출은 답을 읽기 전에 장부에 적는다
          const usd = pdCost(r.usage as { input_tokens?: number; output_tokens?: number } | null, model, s.prices.pd) ?? 0;
          j.pdUsd += usd; j.calls++;
          await openRow(c.jobId, j);
          await usage(origin.userId, { requestId, jobId: c.jobId, kind: 'layers', model, tokens: numbers(r.usage), usd, at });
          let text: string;
          try { text = r.json ? responseOutputText(r.json) : ''; } catch (e) {
            if (e instanceof BaeOpenAiError && /거절/.test(e.message)) throw new Error(e.message.replace('PD가 이 요청을 거절했어요', 'PD가 거절했어요'));
            text = '';
          }
          if (!text) throw new Error('PD 응답이 비어 있어요.');
          let json: unknown;
          try { json = JSON.parse(text); } catch { throw new Error('PD 답을 읽지 못했어요. 다시 해 주세요.'); }
          return { ok: true as const, json, usd };
        });
      } catch (e) { return failure(e); }
    },

    /** GPT Image 편집 (빈 방 · 더한 물건 자리 · 앞 지우고 뒤 완성). 스트림 없이 (엔진 그대로). */
    async edit(origin: { userId: string; epoch: number }, c: BaeLayersEditCall): Promise<BaeLayersEditOutcome | BaeFailure> {
      try {
        const problem = baeLayersEditProblem(c); if (problem) throw new Error(problem);
        const j = jobOf(origin.userId, c.jobId);
        const s = await deps.settings.get(origin.userId);
        const key = await deps.keyFor(origin);
        const model = s.models.imageModel;
        return await guarded(j, async (signal) => {
          const fields = baeLayersEditFields({ model, prompt: c.prompt, size: c.size, image: c.image, mask: c.mask }) as BaeImageFormField[];
          const prefs = deps.imagePrefs.get();
          const requestId = randomUUID(); const at = new Date(now()).toISOString();
          const r = await postImageEdit({
            apiBase: s.apiBase, key, fields, signal, imageField: prefs.imageField, stream: false, fetch: deps.fetch,
            onFieldChange: (p) => deps.imagePrefs.set({ imageField: p.imageField, stream: deps.imagePrefs.get().stream }),
          });
          const usd = imageCost(r.usage as Parameters<typeof imageCost>[0], s.prices.image) ?? 0;
          j.imageUsd += usd; j.calls++;
          await openRow(c.jobId, j);
          await usage(origin.userId, { requestId, jobId: c.jobId, kind: 'layers', model, tokens: numbers(r.usage), usd, at });
          const png = new Uint8Array(Buffer.from(r.b64, 'base64'));
          if (!isPngBytes(png)) throw new Error('그림 응답이 비어 있어요.');
          return { ok: true as const, png, usd };
        });
      } catch (e) { return failure(e); }
    },

    /** 다 나눔: PSD 를 이 PC 작업 폴더에 (layers.psd, 다시 나누면 새 PSD 로 바뀜), 기록 줄 '완성'. */
    async done(owner: string, c: BaeLayersDoneCall): Promise<BaeLayersDoneOutcome | BaeFailure> {
      try {
        const j = jobOf(owner, c?.jobId);
        if (!(c.psd instanceof Uint8Array) || c.psd.byteLength < 26 || c.psd.byteLength > BAE_LAYERS_MAX_PSD || String.fromCharCode(c.psd[0], c.psd[1], c.psd[2], c.psd[3]) !== '8BPS') throw new Error('PSD 가 올바르지 않아요.');
        const dir = await deps.local.jobDir(c.jobId);
        if (!dir) throw new Error('이 PC 에 작업 폴더가 없어요.');
        const psdPath = join(dir, 'layers.psd');
        await writeFileAtomic(psdPath, c.psd);
        j.psdPath = psdPath; j.status = 'done';
        const s = (c.summary || {}) as Partial<BaeLayersSummaryLite>;
        const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
        const sec = Math.round((now() - j.t0) / 1000);
        const result: BaeJobResult & BaeLayersResultExtra = {
          w: n(s.W) || j.w || undefined, h: n(s.H) || j.h || undefined, sec, usdOrder: j.pdUsd, usdImage: j.imageUsd,
          layers: { count: n(s.layers), shadows: n(s.shadows), bins: { OL: n(s.bins?.OL), ML: n(s.bins?.ML), UL: n(s.bins?.UL) }, left: n(s.left), merged: n(s.merged), props: n(s.props), stackDiff: typeof s.stackDiff === 'number' && Number.isFinite(s.stackDiff) ? Math.round(s.stackDiff * 100) / 100 : 0, again: s.again === true, file: 'layers.psd',
            // 6단계: 가장자리 방식과 그 까닭 (쉬운 말). 모르는 값은 지금 방식으로 적는다
            ...baeLayersEdgesRecord(s.edges, s.edgesNote) },
        };
        if (!j.rowWritten) {
          j.rowWritten = true;
          await preview(owner, c.jobId, 'result_1600.jpg', j.sourceFile, 1600);
          await preview(owner, c.jobId, 'result_320.jpg', j.sourceFile, 320);
        }
        await jobWrite(owner, { ...baseRow(c.jobId, j), status: 'done', result, images: { result: urlOf(c.jobId, 'result_1600.jpg'), thumb: urlOf(c.jobId, 'result_320.jpg') }, finishedAt: new Date(now()).toISOString() });
        return { ok: true, jobId: c.jobId, psdPath, costUsd: total(j), sec };
      } catch (e) { return failure(e); }
    },

    /** 실패 · 그만둠 · 계획만 고치고 닫음. 실패는 늘, 그만둠 · 닫음은 돈이 나간(줄이 있는) 작업만 기록. 이미 다 나눈 작업은 그대로. */
    async end(owner: string, jobId: unknown, how: unknown, message: unknown): Promise<boolean> {
      let j: Job; try { j = jobOf(owner, jobId); } catch { return false; }
      for (const ctl of j.ctls) ctl.abort();
      if (how !== 'failed' && how !== 'stopped' && how !== 'closed') return false;
      if (j.status === 'done' && how === 'closed') return true;
      const text = maskSecrets(typeof message === 'string' ? message : '').slice(0, 400);
      if (how === 'failed') {
        j.status = 'failed'; j.rowWritten = true;
        await jobWrite(owner, { ...baseRow(jobId as string, j), status: 'failed', result: { error: text || '레이어로 나누지 못했어요.', sec: Math.round((now() - j.t0) / 1000) }, finishedAt: new Date(now()).toISOString() });
        return true;
      }
      if (!j.rowWritten || j.status === 'done') return true;
      j.status = 'stopped';
      await jobWrite(owner, { ...baseRow(jobId as string, j), status: 'stopped', result: { error: text || (how === 'closed' ? '계획만 고치고 나누지 않았어요.' : '그만뒀어요.'), sec: Math.round((now() - j.t0) / 1000) }, finishedAt: new Date(now()).toISOString() });
      return true;
    },

    abort(owner: string, jobId: unknown): boolean {
      let j: Job; try { j = jobOf(owner, jobId); } catch { return false; }
      for (const ctl of j.ctls) ctl.abort();
      return true;
    },

    async storeGet(owner: string, pic: unknown, key: unknown): Promise<unknown> {
      const f = baeLayersStoreFile(key); if (!f) throw new Error('저장 이름이 올바르지 않아요.');
      const root = storeRoot(owner, pic as string);
      return serial(root, async () => {
        const g = await generation(root);
        let buf: Buffer;
        try { buf = await readFile(join(root, `g${g}`, f.file)); } catch { return null; }
        if (f.kind === 'png') return isPngBytes(new Uint8Array(buf)) ? new Uint8Array(buf) : null;
        try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
      });
    },
    async storeSet(owner: string, pic: unknown, key: unknown, value: unknown): Promise<boolean> {
      const f = baeLayersStoreFile(key); if (!f) throw new Error('저장 이름이 올바르지 않아요.');
      const root = storeRoot(owner, pic as string);
      let data: Uint8Array | string;
      if (f.kind === 'png') { if (!isPngBytes(value)) throw new Error('저장할 그림이 올바르지 않아요.'); data = value; }
      else { let t: string | undefined; try { t = JSON.stringify(value); } catch { t = undefined; } if (t === undefined || t.length > BAE_LAYERS_MAX_JSON) throw new Error('저장할 내용이 올바르지 않아요.'); data = t; }
      return serial(root, async () => { const g = await generation(root); await writeFileAtomic(join(root, `g${g}`, f.file), data); return true; });
    },
    async storeForget(owner: string, pic: unknown): Promise<boolean> {
      const root = storeRoot(owner, pic as string);
      return serial(root, async () => { const g = await generation(root); await writeFileAtomic(join(root, 'current.json'), JSON.stringify({ g: g + 1, at: new Date(now()).toISOString() })); return true; });
    },

    showPsd(owner: string, jobId: unknown): boolean {
      let j: Job; try { j = jobOf(owner, jobId); } catch { return false; }
      if (!j.psdPath) return false;
      deps.showItemInFolder(j.psdPath);
      return true;
    },

    /** 로그아웃 · 앱 끄기: 진행 중인 GPT 요청을 모두 그만둔다. */
    abortAll() { for (const j of jobs.values()) for (const ctl of j.ctls) ctl.abort(); },
    /** 시험용: 작업의 지금 숫자 */
    peek(jobId: string) { const j = jobs.get(jobId); return j ? { pdUsd: j.pdUsd, imageUsd: j.imageUsd, calls: j.calls, rowWritten: j.rowWritten, status: j.status, psdPath: j.psdPath } : null; },
  };
}
export type BaeLayers = ReturnType<typeof createBaeLayers>;
