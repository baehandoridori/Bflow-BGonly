/**
 * BAE경 결과 도구와 노이즈 제거 창 (계획 14b 10-2 '다듬기', 14d 3-5 · 8장 3번, HTML v0.4.11 syncLockRow · runNoise · undoNoise).
 *   - 색 맞춤 켜고 끄기 · 노이즈 제거와 되돌리기: 계산은 이 PC 의 엔진(engines), 파일 · 기록은 메인(resultSet). 화면은 먼저 바꾸고(낙관적),
 *     메인이 못 받으면 전 그림으로 되돌린다. 한 번 만든 판은 이 PC 에 남아서 다시 누르면 바로 돌아온다 (HTML noiseClean).
 *   - 노이즈 제거 창: 불러온 그림을 이 PC 에서 지우고 도구 작업 한 건으로 남긴다 (0원). 다시 누르면 원래 그림.
 *   - 이 PC 원본 주소(useBaeLocal): 기록 · 작업대가 서버 미리보기보다 먼저 쓴다. 판이 바뀌면 새 주소로.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import { baeVariantFile, BAE_BASE_VARIANT_FILES, type BaeJob, type BaeJobImages, type BaeJobResult, type BaeVariant } from '@/shared/bae/jobs';
import { baeDenoise } from '../engines';
import { baeGw } from '../useBaeStore';
import { useBaeJobs, visibleBaeJobs } from './useBaeJobs';
import { baeSetActiveResult, useBaeMake } from './useBaeMake';
import { baeLockNext, baeLockToast, baeNoiseNext } from './baeBases';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const png = (b: Uint8Array) => new Blob([b as BlobPart], { type: 'image/png' });
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/* ── 이 PC 원본 주소 ── */
interface LocalState { urls: Record<string, string | null>; ensure(jobId: string): void; put(jobId: string, url: string | null): void }
const asking = new Set<string>();
export const useBaeLocal = create<LocalState>((set, get) => ({
  urls: {},
  // 이미 주소가 있으면 그대로. 없었던 작업(아직 그리는 중이었거나 다른 PC 것)은 그 줄이 바뀔 때마다 다시 묻는다.
  ensure: (jobId) => {
    if (typeof get().urls[jobId] === 'string' || asking.has(jobId)) return;
    asking.add(jobId);
    void baeGw().localFile(jobId, 'result.png').then((b) => b ? URL.createObjectURL(png(b)) : null, () => null)
      .then((u) => { asking.delete(jobId); if (typeof get().urls[jobId] !== 'string') set((s) => ({ urls: { ...s.urls, [jobId]: u } })); });
  },
  put: (jobId, url) => set((s) => ({ urls: { ...s.urls, [jobId]: url } })),
}));

/** 결과 도구를 쓸 작업 한 건 (지금 작업이거나 기록). */
export interface BaeToolTarget { jobId: string; variant: BaeVariant; hasLock: boolean }

/** 판 파일 읽기: 처음 그림은 final → gpt → source 순서. */
async function readVariant(jobId: string, v: BaeVariant): Promise<Blob | null> {
  const name = baeVariantFile(v);
  for (const n of name ? [name] : [...BAE_BASE_VARIANT_FILES]) { const b = await baeGw().localFile(jobId, n).catch(() => null); if (b) return png(b); }
  return null;
}
const recordOf = (jobId: string): BaeJob | null => visibleBaeJobs(useBaeJobs.getState()).find((j) => j.id === jobId) ?? null;
function finishWith(result: BaeJobResult | undefined, v: BaeVariant, sec: number | null): BaeJobResult {
  const r = result ?? {}; const f = r.finish ?? {};
  return { ...r, finish: { ...f, lock: f.lock ? { ...f.lock, on: !v.alt } : f.lock ?? null, noise: v.noise ? { on: true, ...(sec != null ? { sec } : f.noise?.sec != null ? { sec: f.noise.sec } : {}) } : f.noise ? { ...f.noise, on: false } : null } };
}

interface DenoiseWin {
  label: string; w: number; h: number; parentJobId: string | null;
  source: Blob; sourceUrl: string; cleanUrl: string | null;
  jobId: string | null; on: boolean; busy: boolean; step: string; sec: number | null;
}
interface ToolsState {
  /** 작업마다 지금 하는 일 */
  busy: Record<string, { what: 'noise' | 'lock'; step: string }>;
  dn: DenoiseWin | null;
  toggleNoise(t: BaeToolTarget): Promise<void>;
  toggleLock(t: BaeToolTarget): Promise<void>;
  openDenoise(input: { blob: Blob; label: string; parentJobId?: string | null }): Promise<void>;
  toggleDenoise(): Promise<void>;
  closeDenoise(): void;
}

/** 엔진에 넣을 그림을 PNG 로 (도구 작업의 원래 그림 · 너무 크면 긴 변 4096). */
async function toPng(blob: Blob): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  try {
    const k = Math.min(1, 4096 / Math.max(bmp.width, bmp.height)); const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    if (k === 1 && blob.type === 'image/png') return { blob, w, h };
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!;
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('그림을 만들지 못했어요'))), 'image/png'));
    return { blob: out, w, h };
  } finally { bmp.close(); }
}

export const useBaeTools = create<ToolsState>((set, get) => {
  const setBusy = (jobId: string, what: 'noise' | 'lock' | null, step = '') => set((s) => {
    const busy = { ...s.busy }; if (what) busy[jobId] = { what, step }; else delete busy[jobId]; return { busy };
  });
  /**
   * 판을 바꾼다: 화면(작업대 · 기록 · 지금 작업)을 먼저 바꾸고 메인에 보낸다. 메인이 못 받으면 전 그림으로 되돌리고 false.
   * bytes = 이 PC 에 처음 만드는 판 (노이즈 제거한 그림)일 때만.
   */
  async function apply(jobId: string, v: BaeVariant, shown: Blob, made: Blob | null, sec: number | null): Promise<boolean> {
    const local = useBaeLocal.getState(); const beforeUrl = local.urls[jobId] ?? null;
    const rec = recordOf(jobId); const act = useBaeMake.getState().job;
    const beforeAct = act && act.id === jobId && act.result ? { ...act.result } : null;
    const url = URL.createObjectURL(shown);
    local.put(jobId, url);
    baeSetActiveResult(jobId, { url, variant: v, ...(sec != null ? { noiseSec: sec } : {}) });
    if (rec) useBaeJobs.getState().putLocal({ ...rec, result: finishWith(rec.result, v, sec), updatedAt: new Date().toISOString() });
    const r = await baeGw().resultSet({ jobId, variant: v, png: made ? await bytesOf(made) : null, ...(sec != null ? { sec } : {}) })
      .catch((e) => ({ ok: false as const, aborted: false, message: msg(e), code: null }));
    if (!r.ok) {
      useBaeLocal.getState().put(jobId, beforeUrl);
      if (beforeAct) baeSetActiveResult(jobId, beforeAct);
      if (rec) useBaeJobs.getState().putLocal({ ...rec, updatedAt: new Date().toISOString() });
      URL.revokeObjectURL(url);
      toast.error(r.message);
      return false;
    }
    const after = recordOf(jobId) ?? rec;
    if (after) useBaeJobs.getState().putLocal({ ...after, result: r.result, images: r.images as BaeJobImages, updatedAt: new Date().toISOString() });
    return true;
  }
  /** 판이 이 PC 에 없으면 그 판의 노이즈 전 그림에서 지운다. */
  async function makeNoise(jobId: string, v: BaeVariant): Promise<{ blob: Blob; made: boolean; sec: number | null }> {
    const have = await readVariant(jobId, v); if (have) return { blob: have, made: false, sec: null };
    const src = await readVariant(jobId, { alt: v.alt, noise: false });
    if (!src) throw new Error('지우기 전 그림이 이 PC 에 없어요.');
    const r = await baeDenoise(src, (step) => setBusy(jobId, get().busy[jobId]?.what ?? 'noise', step));
    return { blob: r.blob, made: true, sec: r.info.sec };
  }
  const busyToast = () => toast('지금 하던 작업이 끝나면 다시 눌러 주세요');

  return {
    busy: {}, dn: null,

    toggleNoise: async (t) => {
      if (get().busy[t.jobId]) { busyToast(); return; }
      const next = baeNoiseNext(t.variant);
      setBusy(t.jobId, 'noise', next.noise ? '지우는 중' : '');
      try {
        if (!next.noise) {
          const blob = await readVariant(t.jobId, next); if (!blob) throw new Error('지우기 전 그림이 이 PC 에 없어요.');
          if (await apply(t.jobId, next, blob, null, null)) toast('노이즈를 지우기 전 그림으로 돌렸어요');
        } else {
          const n = await makeNoise(t.jobId, next);
          if (await apply(t.jobId, next, n.blob, n.made ? n.blob : null, n.sec)) toast(n.sec != null ? `노이즈를 지웠어요 · ${n.sec}초 · 다시 누르면 지우기 전 그림` : '노이즈를 지운 그림이에요 · 다시 누르면 지우기 전 그림');
        }
      } catch (e) { toast.error('노이즈를 지우지 못했어요: ' + msg(e).slice(0, 300)); }
      finally { setBusy(t.jobId, null); }
    },

    toggleLock: async (t) => {
      if (!t.hasLock) return;
      if (get().busy[t.jobId]) { busyToast(); return; }
      // HTML lockSw: 노이즈 제거가 켜져 있으면 다른 그림에도 노이즈 제거를 다시 한다 (만든 적 있으면 그것을)
      const next = baeLockNext(t.variant);
      setBusy(t.jobId, 'lock', next.noise ? '노이즈 제거도 다시 하는 중' : '');
      try {
        let shown: Blob | null; let made: Blob | null = null; let sec: number | null = null;
        if (next.noise) { const n = await makeNoise(t.jobId, next); shown = n.blob; if (n.made) { made = n.blob; sec = n.sec; } }
        else shown = await readVariant(t.jobId, next);
        if (!shown) throw new Error('그림이 이 PC 에 없어요.');
        if (await apply(t.jobId, next, shown, made, sec)) toast(baeLockToast(!next.alt, next.noise));
      } catch (e) { toast.error(msg(e)); }
      finally { setBusy(t.jobId, null); }
    },

    openDenoise: async ({ blob, label, parentJobId = null }) => {
      let pngIn: { blob: Blob; w: number; h: number };
      try { pngIn = await toPng(blob); } catch { toast.error('이미지를 열 수 없어요'); return; }
      const old = get().dn;
      if (old && !old.busy) { URL.revokeObjectURL(old.sourceUrl); if (old.cleanUrl) URL.revokeObjectURL(old.cleanUrl); }
      set({ dn: { label: label || '불러온 그림', w: pngIn.w, h: pngIn.h, parentJobId, source: pngIn.blob, sourceUrl: URL.createObjectURL(pngIn.blob), cleanUrl: null, jobId: null, on: false, busy: false, step: '', sec: null } });
      const m = useBaeMake.getState();
      if (m.win !== 'denoise') useBaeMake.setState({ win: 'denoise', winAuto: false });
    },

    toggleDenoise: async () => {
      const d = get().dn; if (!d || d.busy) return;
      const patch = (p: Partial<DenoiseWin>) => { const cur = get().dn; if (cur && cur.source === d.source) set({ dn: { ...cur, ...p } }); };
      if (!d.jobId) {
        // 처음: 이 PC 에서 지우고 → 바로 보여 주고 → 도구 작업 한 건으로 남긴다. 못 남기면 원래 그림으로.
        patch({ busy: true, step: '지우는 중' });
        let clean: Blob; let sec: number;
        try { const r = await baeDenoise(d.source, (step) => patch({ step })); clean = r.blob; sec = r.info.sec; }
        catch (e) { patch({ busy: false, step: '' }); toast.error('노이즈를 지우지 못했어요: ' + msg(e).slice(0, 300)); return; }
        const cleanUrl = URL.createObjectURL(clean);
        patch({ cleanUrl, on: true, step: '기록에 남기는 중', sec });
        const jobId = crypto.randomUUID();
        const r = await baeGw().toolJob({ jobId, kind: 'denoise', parentJobId: d.parentJobId, createdAt: new Date().toISOString(), source: await bytesOf(d.source), png: await bytesOf(clean), sec, label: d.label })
          .catch((e) => ({ ok: false as const, aborted: false, message: msg(e), code: null }));
        if (!r.ok) { patch({ busy: false, step: '', on: false, cleanUrl: null }); URL.revokeObjectURL(cleanUrl); toast.error('노이즈를 지운 그림을 남기지 못했어요: ' + r.message); return; }
        patch({ busy: false, step: '', jobId });
        useBaeLocal.getState().put(jobId, URL.createObjectURL(clean));
        void useBaeJobs.getState().load();
        toast(`노이즈를 지웠어요 · ${sec}초 · 다시 누르면 원래 그림`);
        return;
      }
      // 그다음: 그 작업의 판을 바꾼다 (원래 그림 ↔ 지운 그림)
      const next = { alt: false, noise: !d.on };
      patch({ busy: true, on: next.noise });
      const ok = await apply(d.jobId, next, next.noise ? (await readVariant(d.jobId, next)) ?? d.source : d.source, null, null).catch(() => false);
      patch({ busy: false, on: ok ? next.noise : d.on });
      if (ok) toast(next.noise ? '노이즈를 지운 그림으로 바꿨어요' : '노이즈를 지우기 전 그림으로 돌렸어요');
    },

    closeDenoise: () => { if (useBaeMake.getState().win === 'denoise') useBaeMake.setState({ win: null, winAuto: false }); },
  };
});
