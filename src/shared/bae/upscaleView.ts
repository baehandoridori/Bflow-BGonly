/**
 * BAE경 '4K로 키우기' 창의 글자와 숫자 (계획 14d 3-4, HTML v0.3.5 script_4.js 2151~2185줄 UP_HINT · upTarget · upSync · upGo).
 * 화면 · 테스트 모드 · 시험이 같이 쓴다. DOM · electron · '@/' 없이.
 */
import { RATIOS, RATIO_ORDER, type RatioId } from './order/constants';
import { BAE_UPSCALE_HINT, baeUpscaleTarget, type BaeUpscaleKey } from './upscaleTiles';
import { BAE_MODELS, type BaeModelId, type BaeModelProgress } from './models';

export type BaeUpscaleEp = 'dml' | 'cpu' | 'webgpu' | 'wasm';

/** 키우는 방식 둘 (시안 WinUpscale 의 카드 글 + HTML UP_HINT). */
export const BAE_UPSCALE_MODES: Record<BaeUpscaleKey, { name: string; text: string; hint: string; meta: string; speed: string; model: Extract<BaeModelId, 'up-a' | 'up-b'>; modelName: string }> = {
  A: { name: 'A 선명하게', text: '선과 가장자리를 또렷하게 세우면서 키워요.', hint: BAE_UPSCALE_HINT.A, meta: 'Real-ESRGAN', speed: '가장 빨라요', model: 'up-a', modelName: 'Real-ESRGAN animevideov3' },
  B: { name: 'B 원본 그대로', text: '그림의 느낌은 그대로 두고 크기만 키워요.', hint: BAE_UPSCALE_HINT.B, meta: 'waifu2x', speed: 'A보다 2배쯤 걸려요', model: 'up-b', modelName: 'waifu2x swin_unet art' },
};
/** 창의 안내 (이 PC 에 원본이 없는 기록을 열었을 때). w×h = 받은 미리보기 크기 */
export const baeUpscalePreviewHint = (w: number, h: number) => `이 PC에 원본이 없어서 서버의 미리보기 그림(${w}×${h})으로 키워요. 원본을 만든 PC에서 키우면 더 선명해요.`;
/** HTML 의 모델 안내 그대로 (둘 다 상업 사용이 되는 공개 모델). */
export const BAE_UPSCALE_LICENSE = 'A는 Real-ESRGAN(BSD-3), B는 waifu2x(MIT) · 둘 다 상업 사용이 되는 공개 모델이에요';
/** 이 PC 에 원본이 없어서 서버 미리보기(1600px)를 키웠을 때 창 · 기록에 남기는 안내 */
export const BAE_UPSCALE_PREVIEW_NOTE = '이 PC에 원본이 없어서 미리보기 그림(1600px)을 키웠어요. 원본을 만든 PC에서 키우면 더 선명해요.';
/** 키운 크기의 상한 (8K 가로 · 세로의 넓이). 그보다 크면 모델 일꾼 · 화면 메모리가 모자랄 수 있다. */
export const BAE_UPSCALE_MAX_PIXELS = 7680 * 4320;

/** 비율을 모르는 그림(불러온 파일)의 비율: 가로세로가 0.6% 안으로 맞는 것. 없으면 null. */
export function baeRatioOf(w: number, h: number): RatioId | null {
  if (!(w > 0 && h > 0)) return null;
  for (const id of RATIO_ORDER) {
    const [rw, rh] = RATIOS[id].sizes.m;
    if (Math.abs(w / h - rw / rh) / (rw / rh) <= 0.006) return id;
  }
  return null;
}

export interface BaeUpscalePlan {
  /** 저장 크기 (HTML upTarget) */
  target: [number, number];
  /** 이미 그 크기 이상 (HTML upSync 의 done: 버튼이 꺼진다) */
  done: boolean;
  /** 키울 수 없는 까닭 (없으면 null) */
  problem: string | null;
  /** 가로 · 세로가 몇 배 커지나 */
  factor: { x: number; y: number };
  /** '1.875배' · '가로 2.4배 · 세로 2.39배' */
  factorText: string;
  /** 견준 그림에서 지금 크기가 차지하는 너비 · 높이 (%) */
  inner: { w: number; h: number };
}

const times = (n: number) => `${Number(n.toFixed(3))}배`;

/** 이 그림을 몇으로 키우나: 기록의 비율(없으면 그림 크기로 맞춰 봄) → HTML upTarget. */
export function baeUpscalePlan(q: { ratio?: string | null; w: number; h: number }): BaeUpscalePlan {
  const ratio = q.ratio && Object.prototype.hasOwnProperty.call(RATIOS, q.ratio) ? q.ratio : baeRatioOf(q.w, q.h);
  const target = baeUpscaleTarget(ratio, q.w, q.h);
  const [tw, th] = target;
  const done = q.w >= tw && q.h >= th;
  const fx = q.w > 0 ? tw / q.w : 0, fy = q.h > 0 ? th / q.h : 0;
  let problem: string | null = null;
  if (!(q.w >= 16 && q.h >= 16)) problem = '그림 크기가 올바르지 않아요.';
  else if (q.w * q.h > 4096 * 4096) problem = '4K로 키우기에는 그림이 너무 커요 (최대 4096×4096).';
  else if (tw * th > BAE_UPSCALE_MAX_PIXELS) problem = `키운 크기(${tw}×${th})가 너무 커요. 더 작은 그림으로 해 주세요.`;
  const same = Math.abs(fx - fy) <= 0.01 * Math.max(fx, fy);
  return {
    target, done, problem, factor: { x: fx, y: fy },
    factorText: same ? times(fx) : `가로 ${times(fx)} · 세로 ${times(fy)}`,
    inner: { w: tw > 0 ? Math.min(100, (q.w / tw) * 100) : 100, h: th > 0 ? Math.min(100, (q.h / th) * 100) : 100 },
  };
}

/** 결과 도구의 '4K로 키우기' 버튼 (HTML upSync 의 title). */
export function baeUpscaleButton(plan: Pick<BaeUpscalePlan, 'target' | 'done' | 'problem'>): { disabled: boolean; title: string } {
  const [tw, th] = plan.target;
  if (plan.done) return { disabled: true, title: `이미 ${tw}×${th} 이상이에요` };
  if (plan.problem) return { disabled: true, title: plan.problem };
  return { disabled: false, title: `그림은 그대로 두고 크기만 키워서 저장해요 (${tw}×${th}). 이 PC 그래픽카드로 돌아서 비용이 없어요` };
}

/** 계산한 곳 (HTML: webgpu/wasm, Bflow 는 모델 일꾼의 DirectML/CPU 도). */
export function baeUpscaleEngineLabel(ep: BaeUpscaleEp, fellBack = false): string {
  const base = ep === 'dml' ? '그래픽카드 (DirectML)' : ep === 'webgpu' ? '그래픽카드 (WebGPU)' : ep === 'wasm' ? 'CPU (WASM)' : 'CPU';
  return fellBack && (ep === 'cpu' || ep === 'wasm') ? `${base} · 그래픽카드에서 안 돼서 이어 감` : base;
}

/** 걸린 시간 (HTML: 소수 한 자리 초). */
export function baeUpscaleSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s < 60 ? `${s.toFixed(1)}초` : `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`;
}

/** 끝난 뒤 한 줄 (HTML upGo 의 '저장했어요 · 12.3초 · 3840×2160 · A 선명하게' + 계산한 곳). */
export function baeUpscaleDoneText(r: { ms: number; w: number; h: number; mode: BaeUpscaleKey; ep: BaeUpscaleEp; fellBack: boolean }): string {
  return `다 키웠어요 · ${baeUpscaleSeconds(r.ms)} · ${r.w}×${r.h} · ${BAE_UPSCALE_MODES[r.mode].name} · ${baeUpscaleEngineLabel(r.ep, r.fellBack)}`;
}

/** 저장 파일 이름 (HTML: 이름_3840x2160_A.png). 파일 이름에 못 쓰는 글자는 뺀다. */
export function baeUpscaleFileName(label: string, w: number, h: number, mode: BaeUpscaleKey): string {
  const stem = String(label || '').replace(/\.(png|jpe?g|webp|gif|bmp)$/i, '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'BAE경';
  return `${stem}_${w}x${h}_${mode}.png`;
}

const mb = (bytes: number) => {
  const v = Math.max(0, bytes) / 1e6;
  return v >= 10 ? `${Math.round(v)}MB` : `${v.toFixed(1)}MB`;
};
/** 모델 받는 중 글 (계획 14 9-2 '진행 막대와 남은 크기'). 받을 것이 없으면 확인 중. */
export function baeModelProgressText(p: Pick<BaeModelProgress, 'id' | 'phase' | 'doneBytes' | 'totalBytes' | 'source'>): string {
  const name = BAE_MODELS[p.id]?.label ?? '모델';
  if (p.phase === 'done') return `${name}을(를) 준비했어요`;
  if (p.phase === 'verify') return `${name} 확인 중`;
  if (p.phase === 'check') return `${name}이(가) 이 PC에 있는지 보는 중`;
  const where = p.source === 'internet' ? '인터넷에서' : '모델 창고(G 드라이브)에서';
  return `${name}을(를) ${where} 받는 중 (처음 한 번) · 남은 크기 약 ${mb(p.totalBytes - p.doneBytes)}`;
}
/** 처음 쓸 때 받는 크기 안내 (창 오른쪽). */
export function baeModelFirstUseText(state: { ready: boolean; haveBytes: number; totalBytes: number } | null | undefined): string {
  if (!state) return '처음 한 번은 모델을 모델 창고(G 드라이브)에서 받아요.';
  return state.ready ? '모델은 이 PC에 받아 뒀어요.' : `처음 한 번은 모델(약 ${mb(state.totalBytes - state.haveBytes)})을 모델 창고(G 드라이브)에서 받아요.`;
}
