/**
 * 4K로 키우기 · 이 PC 점검이 쓰는 모델 통로: 앱에서는 preload 의 window.baeModelAPI, 테스트 모드(?preview=1)에서는
 * 같은 모양의 가짜(previewModels). 다른 단계(레이어 · 각도)가 쓰는 baeModelGateway() 는 그대로 둔다 — 테스트 모드에서
 * 그쪽이 가짜를 쓰려면 이 baeModels() 로 바꾸면 된다.
 */
import { isExplicitPlaygroundPreviewMode } from '@/features/playground/featureFlag';
import { useAuthStore } from '@/stores/useAuthStore';
import type { BaePcCheck, BaeWebGpuInfo } from '@/shared/bae/pcCheck';
import type { BaeUpscaleKey } from '@/shared/bae/upscaleTiles';
import { baeModelGateway, type BaeModelGateway } from './modelApi';
import { createPreviewModelGateway, type PreviewModelGateway } from './previewModels';
import { baeUpscaleA } from './engines/upscaleA';
import { baeUpscaleB, baeWebGpuInfo } from './engines/upscaleB';
import type { BaeUpscaleOutcome } from './engines/upscaleCommon';
import { useBaeStore } from './useBaeStore';

let preview: PreviewModelGateway | null = null;

export function baeModels(): BaeModelGateway {
  if (typeof window !== 'undefined' && window.baeModelAPI) return window.baeModelAPI;
  if (isExplicitPlaygroundPreviewMode()) {
    preview ??= createPreviewModelGateway({
      storage: window.localStorage,
      identity: () => { const u = useAuthStore.getState().currentUser; return u ? { id: u.id, name: u.name } : null; },
      canUse: () => useBaeStore.getState().access.canUse,
      canReview: () => useBaeStore.getState().access.canReview,
      userName: (id) => useAuthStore.getState().users.find((u) => u.id === id)?.name,
      channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bflow-preview-bae-gyeong'),
    });
    return preview;
  }
  return baeModelGateway();
}
export const isPreviewModels = (g: BaeModelGateway): g is PreviewModelGateway => (g as { preview?: unknown }).preview === true;

/** 화면의 WebGPU (4K B · 이 PC 점검). 테스트 모드는 정해 둔 값. */
export async function baeWebGpu(): Promise<BaeWebGpuInfo> {
  if (isPreviewModels(baeModels())) return { ok: true, f16: true, name: 'nvidia ampere (테스트 모드)' };
  return baeWebGpuInfo();
}

/** 이 PC 점검: 화면이 WebGPU 를 재서 넣고, 나머지는 메인이 모은다. */
export async function baeRunPcCheck(): Promise<BaePcCheck> {
  const webgpu = await baeWebGpu().catch((e) => ({ ok: false, why: String((e as Error)?.message || e) }));
  return baeModels().pcCheck(webgpu);
}

/** 4K 한 번: A 는 모델 일꾼(메인), B 는 화면 쪽 일꾼. 테스트 모드는 둘 다 가짜 2배. */
export async function baeRunUpscale(mode: BaeUpscaleKey, src: Blob, onTile: (done: number, total: number) => void, target: [number, number]): Promise<BaeUpscaleOutcome> {
  const g = baeModels();
  if (mode === 'A') return baeUpscaleA(src, onTile, { target, gateway: g });
  if (isPreviewModels(g)) {
    const r = await baeUpscaleA(src, onTile, { target, gateway: { ...g, upscaleA: g.upscaleBFake } });
    return { ...r, ep: 'webgpu' };
  }
  return baeUpscaleB(src, onTile, { target, gateway: g });
}
