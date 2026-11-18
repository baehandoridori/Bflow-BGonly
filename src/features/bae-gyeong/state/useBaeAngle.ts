/**
 * BAE경 '다른 각도로'(7단계) · '레이어로 나누기'(5단계) 창 열기. 창은 한 번에 하나 (useBaeMake.win 'angle' · 'layers').
 *   - 다른 각도로: 시작 줄 · 놓는 칸(파일, angleFileTarget) · 결과 도구 · 한 건 보기(결과). 결과 그림은 이 PC 원본(result.png)을 blob 주소로 연다 —
 *     입체 판(WebGL)은 http 미리보기 그림을 쓸 수 없다. 이 PC 에 원본이 없으면(다른 PC 에서 만든 것) 미리보기를 받아 blob 주소로.
 *     '이 각도로 그리기' → 창을 닫고 useBaeMake.drawAngle (만드는 화면 '그리는 중' → 작업판 결과, kind 'angle').
 *   - 레이어로 나누기: 시작 줄 · 놓는 칸(파일 바이트, parentJobId null) · 결과 도구 · 한 건 보기(이 PC result.png, parentJobId = 그 작업,
 *     notes = 그 작업의 설명). 창이 물건 찾기 → 계획 → 나누기를 스스로 한다 (LayersWindow).
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import { baeJobVariant, type BaeJob } from '@/shared/bae/jobs';
import type { BaeAngleDrawCall } from '@/shared/bae/angle/calls';
import type { AngleResultChoice, AngleTarget } from '../angle/controller';
import { angleFileTarget } from '../angle/controller';
import type { LayersPicture } from '../layers/useLayersSession';
import { baeGw } from '../useBaeStore';
import { useBaeMake } from './useBaeMake';
import { useBaeJobs, visibleBaeJobs } from './useBaeJobs';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50;

/** 결과 그림 바이트: 이 PC 원본(result.png) → 없으면 미리보기 주소. */
async function resultBytes(jobId: string, preview: string | null | undefined): Promise<{ bytes: Uint8Array; local: boolean } | null> {
  const local = await baeGw().localFile(jobId, 'result.png').catch(() => null);
  if (local && local.length) return { bytes: local, local: true };
  if (!preview) return null;
  try { const r = await fetch(preview); if (!r.ok) return null; return { bytes: new Uint8Array(await r.arrayBuffer()), local: false }; } catch { return null; }
}
async function sizeOf(src: string): Promise<{ w: number; h: number }> {
  const img = new Image(); img.src = src; await img.decode(); return { w: img.naturalWidth, h: img.naturalHeight };
}
/** 같은 그림(작업 · 판 · 크기)은 같은 blob 주소를 다시 쓴다 (깊이 기억의 열쇠도 같게, 주소가 쌓이지 않게). */
const targets = new Map<string, AngleTarget>();
async function targetOf(a: { id: string; variant: string; bytes: Uint8Array; name: string; angle?: AngleTarget['angle']; place?: string | null; prompt?: string | null; thumb?: string | null }): Promise<AngleTarget> {
  const key = 'r' + a.id + a.variant + '_' + a.bytes.length;
  const have = targets.get(key);
  if (have) return { ...have, name: a.name, angle: a.angle ?? null, place: a.place ?? null, prompt: a.prompt ?? null };
  const src = URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: isPng(a.bytes) ? 'image/png' : 'image/jpeg' }));
  let size: { w: number; h: number };
  try { size = await sizeOf(src); } catch { URL.revokeObjectURL(src); throw new Error('그림을 열 수 없어요'); }
  const t: AngleTarget = { kind: 'result', id: a.id, key, name: a.name, w: size.w, h: size.h, src, angle: a.angle ?? null, place: a.place ?? null, prompt: a.prompt ?? null, thumb: a.thumb ?? null };
  targets.set(key, t);
  return t;
}
const variantTag = (j: Pick<BaeJob, 'result'>) => { const v = baeJobVariant(j); return (v.alt ? 'a' : '') + (v.noise ? 'n' : '') || 'o'; };

/** 기록 한 건 → 각도 창의 그림 (이 PC 원본, 없으면 미리보기). 없으면 null. */
export async function baeAngleRecordTarget(j: BaeJob, name: string): Promise<AngleTarget | null> {
  const b = await resultBytes(j.id, j.images.result); if (!b) return null;
  const pd = useBaeJobs.getState().details[j.id]?.pd ?? j.pd;
  return targetOf({ id: j.id, variant: variantTag(j), bytes: b.bytes, name, angle: j.summary.angle ?? null, place: j.summary.place ?? null, prompt: pd?.prompt ?? null, thumb: j.images.thumb ?? null });
}
/** 지금 작업의 결과 (이 화면이 가진 blob 주소) → 각도 창의 그림. */
export async function baeAngleActiveTarget(a: { jobId: string; url: string; name: string; variant: { alt: boolean; noise: boolean }; place: string | null; prompt: string | null }): Promise<AngleTarget | null> {
  try {
    const bytes = new Uint8Array(await (await fetch(a.url)).arrayBuffer());
    return await targetOf({ id: a.jobId, variant: (a.variant.alt ? 'a' : '') + (a.variant.noise ? 'n' : '') || 'o', bytes, name: a.name, place: a.place, prompt: a.prompt });
  } catch { return null; }
}
/** '+ 같은 공간 그림 더하기'에서 고를 결과: 내 기록 중 다 된 그림 (레이어 작업은 원래 그림이라 뺀다). */
export function baeAngleResults(): AngleResultChoice[] {
  return visibleBaeJobs(useBaeJobs.getState())
    .filter((j) => j.status === 'done' && j.kind !== 'layers' && !!j.images.thumb)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((j) => ({ id: j.id, thumb: j.images.thumb!, w: j.result.w ?? 0, h: j.result.h ?? 0, createdAt: Date.parse(j.createdAt) || 0 }));
}
/** 각도 창의 '원래 그림 기준으로' · 같은 공간 그림 더하기: 작업 id → 그림. */
export async function baeAngleResolve(jobId: string): Promise<AngleTarget | null> {
  const j = visibleBaeJobs(useBaeJobs.getState()).find((x) => x.id === jobId) ?? useBaeJobs.getState().details[jobId] ?? null;
  if (j) return baeAngleRecordTarget(j, j.name || j.summary.source || '결과 그림');
  // 지금 작업 (기록에 아직 없을 수도)
  const a = useBaeMake.getState().job;
  if (a && a.id === jobId && a.result) return baeAngleActiveTarget({ jobId, url: a.result.url, name: '지금 그림', variant: a.result.variant, place: useBaeMake.getState().place, prompt: a.promptText || null });
  return null;
}

interface AngleWinState {
  /** 각도 창에 연 그림 (닫아도 남겨 두어 '각도 다시 맞추기' · 다시 시도에 쓴다) */
  target: AngleTarget | null;
  error: string;
  /** 레이어 창에 연 그림 (seq 가 바뀌면 창을 새로 띄운다) */
  layers: (LayersPicture & { seq: number }) | null;
  openAngle(target: AngleTarget): void;
  openAngleFile(file: File): Promise<void>;
  /** 마지막에 연 그림으로 각도 창을 다시 연다. 없으면 false */
  reopenAngle(): boolean;
  closeAngle(): void;
  /** '이 각도로 그리기': 창을 닫고 만드는 화면으로 */
  drawAngle(call: BaeAngleDrawCall): void;
  openLayers(pic: LayersPicture): void;
  openLayersFile(file: File): Promise<void>;
  closeLayers(): void;
}

let layersSeq = 0;
const showWin = (win: 'angle' | 'layers') => useBaeMake.setState({ win, winAuto: false });
const winIs = (win: 'angle' | 'layers') => useBaeMake.getState().win === win;

export const useBaeAngle = create<AngleWinState>((set, get) => ({
  target: null, error: '', layers: null,

  openAngle: (target) => { set({ target, error: '' }); showWin('angle'); },
  openAngleFile: async (file) => {
    try { get().openAngle(await angleFileTarget(file)); } catch (e) { toast.error(msg(e) || '그림을 열 수 없어요'); }
  },
  reopenAngle: () => { const t = get().target; if (!t) return false; set({ error: '' }); showWin('angle'); return true; },
  closeAngle: () => { if (winIs('angle')) useBaeMake.setState({ win: null, winAuto: false }); },
  drawAngle: (call) => {
    get().closeAngle();
    void useBaeMake.getState().drawAngle(call);
  },

  openLayers: (pic) => { set({ layers: { ...pic, seq: ++layersSeq } }); showWin('layers'); },
  openLayersFile: async (file) => {
    try { get().openLayers({ bytes: new Uint8Array(await file.arrayBuffer()), label: file.name, parentJobId: null }); }
    catch (e) { toast.error(msg(e) || '그림을 열 수 없어요'); }
  },
  closeLayers: () => {
    if (winIs('layers')) useBaeMake.setState({ win: null, winAuto: false });
    set({ layers: null });
    void useBaeJobs.getState().load();   // 나눈 작업 · 그만둔 작업이 기록에 (신호가 늦어도)
  },
}));

/** 결과 그림으로 레이어 창: 이 PC 원본(result.png), 없으면 미리보기 (알림). notes = 그 작업의 설명 (PD 가 이름 짓는 힌트). */
export async function baeLayersFromRecord(j: BaeJob, label: string): Promise<void> {
  const b = await resultBytes(j.id, j.images.result);
  if (!b) { toast('이 그림의 원본도 미리보기도 없어요'); return; }
  if (!b.local) toast('이 PC에 원본이 없어서 미리보기 그림으로 나눠요');
  useBaeAngle.getState().openLayers({ bytes: b.bytes, label, parentJobId: j.id, notes: j.summary.request || undefined });
}
/** 지금 작업의 결과로 레이어 창. */
export async function baeLayersFromActive(a: { jobId: string; url: string; label: string; notes: string }): Promise<void> {
  try {
    const bytes = new Uint8Array(await (await fetch(a.url)).arrayBuffer());
    useBaeAngle.getState().openLayers({ bytes, label: a.label, parentJobId: a.jobId, notes: a.notes || undefined });
  } catch (e) { toast.error(msg(e)); }
}
