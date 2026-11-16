/**
 * 5단계 레이어 · 7단계 각도가 쓰는 통로 고르기: 앱에서는 preload 의 window.baeAngleAPI · window.baeLayersAPI,
 * 테스트 모드(?preview=1)에서는 각도는 흉내(previewMake 의 각도 — 가짜 그림 + 같은 모양의 기록 · 장부), 레이어는 흉내가 없어서 안내만.
 */
import { isExplicitPlaygroundPreviewMode } from '@/features/playground/featureFlag';
import { baeAngleGateway, type BaeAngleGateway } from './angle/gateway';
import { previewAngleNow } from './previewMake';
import { baeGw } from './useBaeStore';

/** '다른 각도로' 통로 (그리기 · 그만두기). 없으면 오류. */
export function baeAngleGw(): BaeAngleGateway {
  if (typeof window !== 'undefined' && window.baeAngleAPI) return window.baeAngleAPI;
  if (isExplicitPlaygroundPreviewMode()) {
    baeGw();   // 테스트 모드 저장소를 세우면 각도 흉내도 같이 선다
    const g = previewAngleNow(); if (g) return g;
  }
  return baeAngleGateway();
}

/** 테스트 모드(앱 통로 없이 ?preview=1)인가: 각도 창은 흉내 깊이, 레이어 창은 안내. */
export const baeToolsPreview = () => typeof window !== 'undefined' && !window.baeAngleAPI && !window.baeLayersAPI && isExplicitPlaygroundPreviewMode();

/** 테스트 모드의 레이어 창 안내 (레이어 엔진 · 윤곽 모델 · GPT 흉내가 없다). */
export const BAE_LAYERS_PREVIEW_TEXT = '테스트 모드에서는 레이어 나누기를 쓸 수 없어요.';
