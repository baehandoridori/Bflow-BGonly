/**
 * BAE경 '4K로 키우기' 창의 상태 (계획 14d 3-4 · 6장 '창 안에 진행 줄 → 끝나면 결과가 큰 그림으로', HTML v0.3.5 upGo).
 *   열기: 작업대 시작 줄 · 놓는 칸 · 결과 도구(지금 작업 · 기록)에서 그림 한 장으로. PNG 로 바꿔 두고 몇으로 키울지 정한다 (HTML upTarget).
 *   키우기: 모델 준비(처음 한 번은 모델 창고에서 받음 — 진행 막대와 남은 크기) → 엔진 → 타일 → PNG → 도구 작업 한 건(0원, kind 'upscale').
 *   이 상태는 창 밖에 있어서, 창을 닫거나 다른 메뉴로 가도 키우기는 이어진다 (끝나면 알림). 한 번에 하나만.
 *   결과 도구에서 열었으면 그 기록을 parentJobId 로 가리키는 새 기록 한 줄이 생긴다 (그 기록의 '뒤에 한 일: 4K').
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import type { BaeModelState } from '@/shared/bae/models';
import type { BaeUpscaleKey } from '@/shared/bae/upscaleTiles';
import {
  BAE_UPSCALE_MODES, baeModelProgressText, baeUpscaleDoneText, baeUpscaleFileName, baeUpscalePlan,
  type BaeUpscaleEp, type BaeUpscalePlan,
} from '@/shared/bae/upscaleView';
import { baeGw } from '../useBaeStore';
import { baeModels, baeRunUpscale, baeWebGpu } from '../modelAccess';
import { useBaeJobs } from './useBaeJobs';
import { useBaeLocal } from './useBaeTools';
import { useBaeMake } from './useBaeMake';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const MODE_KEY = 'bflow:bae:upMode';

export type BaeUpPhase = 'ready' | 'model' | 'engine' | 'run' | 'save' | 'done' | 'failed';
/** 지금 계산 중인 단계 (창을 닫아도 이어지는 동안) */
export const baeUpRunning = (p: BaeUpPhase | undefined | null) => p === 'model' || p === 'engine' || p === 'run' || p === 'save';

export interface BaeUpOut { url: string; w: number; h: number; ms: number; ep: BaeUpscaleEp; fellBack: boolean; mode: BaeUpscaleKey; jobId: string }
export interface BaeUpWin {
  label: string; w: number; h: number; ratio: string | null; parentJobId: string | null; fromPreview: boolean;
  source: Blob; sourceUrl: string;
  plan: BaeUpscalePlan;
  mode: BaeUpscaleKey;
  phase: BaeUpPhase;
  /** 지금 하는 일 (창 아래 줄 · 알림) */
  step: string;
  /** 모델 받는 중 (바이트) */
  model: { done: number; total: number } | null;
  /** 타일 진행 */
  tiles: { done: number; total: number } | null;
  startedAt: number | null;
  out: BaeUpOut | null;
  error: string | null;
  /** 이 PC 에 받아 둔 4K 모델 (오른쪽 안내) */
  models: Partial<Record<'up-a' | 'up-b', BaeModelState>>;
}
interface UpState {
  up: BaeUpWin | null;
  open(input: { blob: Blob; label: string; parentJobId?: string | null; ratio?: string | null; fromPreview?: boolean }): Promise<void>;
  setMode(mode: BaeUpscaleKey): void;
  run(): Promise<void>;
  /** 방식 다시 고르기 (같은 그림으로 처음 상태) */
  again(): void;
  save(): Promise<void>;
  /** 열어 둔 그림의 창을 다시 띄운다 (키우는 중 버튼을 눌렀을 때). 없으면 false */
  show(): boolean;
  close(): void;
}

function readMode(): BaeUpscaleKey { try { return localStorage.getItem(MODE_KEY) === 'B' ? 'B' : 'A'; } catch { return 'A'; } }
function keepMode(m: BaeUpscaleKey) { try { localStorage.setItem(MODE_KEY, m); } catch { /* 기억 못 해도 된다 */ } }

/** 그림을 PNG 로 (긴 변 4096 까지 — 4K 입력 한도와 같다). */
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

export const useBaeUpscale = create<UpState>((set, get) => {
  /** 같은 그림의 같은 차례일 때만 고친다 (창에서 다른 그림을 불러왔으면 버린다). */
  const patchFor = (source: Blob) => (p: Partial<BaeUpWin>) => { const cur = get().up; if (cur && cur.source === source) set({ up: { ...cur, ...p } }); };
  const showWin = () => { if (useBaeMake.getState().win !== 'upscale') useBaeMake.setState({ win: 'upscale', winAuto: false }); };
  const winOpen = () => useBaeMake.getState().win === 'upscale';
  async function loadModels(source: Blob) {
    try {
      const st = await baeModels().status();
      const pick = (id: 'up-a' | 'up-b') => st.models.find((m) => m.id === id);
      patchFor(source)({ models: { 'up-a': pick('up-a'), 'up-b': pick('up-b') } });
    } catch { /* 안내만 못 할 뿐 */ }
  }

  return {
    up: null,

    open: async ({ blob, label, parentJobId = null, ratio = null, fromPreview = false }) => {
      const cur = get().up;
      if (cur && baeUpRunning(cur.phase)) {
        showWin();
        toast('지금 키우는 그림이 끝나면 다른 그림을 키울 수 있어요');
        return;
      }
      let png: { blob: Blob; w: number; h: number };
      try { png = await toPng(blob); } catch { toast.error('이미지를 열 수 없어요'); return; }
      if (cur) { URL.revokeObjectURL(cur.sourceUrl); if (cur.out) URL.revokeObjectURL(cur.out.url); }
      const plan = baeUpscalePlan({ ratio, w: png.w, h: png.h });
      set({ up: {
        label: label || '불러온 그림', w: png.w, h: png.h, ratio, parentJobId, fromPreview, source: png.blob, sourceUrl: URL.createObjectURL(png.blob),
        plan, mode: readMode(), phase: 'ready', step: '', model: null, tiles: null, startedAt: null, out: null, error: null, models: {},
      } });
      showWin();
      void loadModels(png.blob);
    },

    setMode: (mode) => {
      const u = get().up; if (!u || baeUpRunning(u.phase)) return;
      keepMode(mode);
      // 시안: 방식을 바꾸면 처음 상태로 (키운 그림은 기록에 남아 있다)
      set({ up: { ...u, mode, phase: u.phase === 'done' || u.phase === 'failed' ? 'ready' : u.phase, out: u.phase === 'done' ? null : u.out, error: null, step: '' } });
      if (u.out && u.phase === 'done') URL.revokeObjectURL(u.out.url);
    },

    again: () => {
      const u = get().up; if (!u || baeUpRunning(u.phase)) return;
      if (u.out) URL.revokeObjectURL(u.out.url);
      set({ up: { ...u, phase: 'ready', out: null, error: null, step: '', tiles: null, model: null, startedAt: null } });
    },

    run: async () => {
      const u = get().up; if (!u || baeUpRunning(u.phase)) return;
      if (u.plan.done || u.plan.problem) { toast(u.plan.problem ?? `이미 ${u.plan.target[0]}×${u.plan.target[1]} 이상이에요`); return; }
      const patch = patchFor(u.source); const mode = u.mode; const spec = BAE_UPSCALE_MODES[mode];
      const t0 = performance.now(); const startedAt = Date.now(); const createdAt = new Date().toISOString();
      patch({ phase: 'model', step: '모델을 확인하는 중', startedAt, error: null, out: null, tiles: null, model: null });
      const fail = (text: string) => {
        patch({ phase: 'failed', error: text, step: '', model: null });
        if (!winOpen()) toast.error(text.slice(0, 300), { action: { label: '창 열기', onClick: showWin } });
      };
      const gw = (() => { try { return baeModels(); } catch (e) { fail(msg(e)); return null; } })(); if (!gw) return;
      // 1) 모델 (처음 한 번은 모델 창고에서 받음). 받는 동안 다른 일을 해도 되고, 창을 닫아도 이어진다.
      const off = gw.onProgress((p) => {
        if (p.id !== spec.model || (p.phase !== 'copy' && p.phase !== 'download' && p.phase !== 'verify')) return;
        patch({ model: { done: p.doneBytes, total: p.totalBytes }, step: baeModelProgressText(p) });
      });
      try { await gw.ensure(spec.model); }
      catch (e) { off(); fail(`4K 모델을 받지 못했어요: ${msg(e).slice(0, 300)} G 드라이브(모델 창고)가 연결돼 있는지 확인해 주세요.`); return; }
      off();
      void loadModels(u.source);
      // 2) 엔진 (HTML: '엔진 준비 중…' · B 는 그래픽카드가 되는지 먼저)
      let step = '엔진 준비 중… (처음 한 번은 조금 걸려요)';
      if (mode === 'B') { const g = await baeWebGpu().catch(() => ({ ok: false })); step = g.ok ? '그래픽카드 준비 중…' : '그래픽카드를 쓸 수 없어서 느리게 돌아요 (2분 이상)…'; }
      patch({ phase: 'engine', model: null, step });
      // 3) 타일
      let out;
      try {
        out = await baeRunUpscale(mode, u.source, (done, total) => patch({ phase: 'run', tiles: { done, total }, step: `키우는 중 ${done}/${total}` }), u.plan.target);
      } catch (e) { fail(`4K로 키우지 못했어요: ${msg(e).slice(0, 300)}`); return; }
      // 4) 기록 한 줄 (0원). 원본 · 키운 그림은 이 PC, 서버에는 미리보기 1600 · 320 만.
      patch({ phase: 'save', tiles: null, step: '저장 중…' });
      const ms = Math.round(performance.now() - t0);
      const jobId = crypto.randomUUID();
      const r = await (async () => baeGw().toolJob({
        jobId, kind: 'upscale', parentJobId: u.parentJobId, createdAt, source: await bytesOf(u.source), png: await bytesOf(out.blob), sec: ms / 1000, label: u.label,
        upscale: { mode, ep: out.ep, fellBack: out.fellBack }, fromPreview: u.fromPreview,
      }))().catch((e) => ({ ok: false as const, aborted: false, message: msg(e), code: null }));
      if (!r.ok) { fail(`키운 그림을 기록에 남기지 못했어요: ${r.message}`); return; }
      const url = URL.createObjectURL(out.blob);
      useBaeLocal.getState().put(jobId, URL.createObjectURL(out.blob));
      void useBaeJobs.getState().load();
      const done = { url, w: out.w, h: out.h, ms, ep: out.ep, fellBack: out.fellBack, mode, jobId };
      patch({ phase: 'done', step: baeUpscaleDoneText(done), out: done });
      // 창이 떠 있으면 창의 발이 알린다 (알림은 창의 버튼을 가린다). 닫았으면 알림으로.
      if (!winOpen()) toast.success(`4K로 키웠어요 · ${out.w}×${out.h} · 기록에 남겼어요`, { action: { label: '창 열기', onClick: showWin } });
    },

    save: async () => {
      const u = get().up; const o = u?.out; if (!u || !o) return;
      try {
        const where = await baeGw().saveAs(o.jobId, baeUpscaleFileName(u.label, o.w, o.h, o.mode));
        if (where) toast.success('저장했어요');
        else if (!window.baeGyeongAPI) toast.message('테스트 모드에서는 파일로 저장하지 않아요.');
      } catch (e) { toast.error(msg(e)); }
    },

    show: () => { if (!get().up) return false; showWin(); return true; },

    close: () => { if (winOpen()) useBaeMake.setState({ win: null, winAuto: false }); },
  };
});
