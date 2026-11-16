/**
 * BAE경 화면이 쓰는 통로: 앱에서는 preload 의 `window.baeGyeongAPI`(메인 → 세션 래퍼),
 * 테스트 모드(?preview=1)에서는 같은 규칙의 가짜 저장소(previewGateway). 둘 다 아니면 오류.
 */
import { isExplicitPlaygroundPreviewMode } from '@/features/playground/featureFlag';
import { useAuthStore } from '@/stores/useAuthStore';
import { createBaePreviewGateway } from './previewGateway';
import { createPreviewMake } from './previewMake';
import { baePreviewSeed } from './previewSeed';
import type { BaeGateway } from './types';

let preview: BaeGateway | null = null;
/** 테스트 모드 8단계 시험 자료의 그림: 앱에 들어 있는 스타일 예시 그림 (띠 그림 빼고). */
const SEED_PICS = Object.entries(import.meta.glob('./assets/library/L*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([, url]) => url);

export function baeGateway(): BaeGateway {
  if (typeof window !== 'undefined' && window.baeGyeongAPI) return window.baeGyeongAPI;
  if (isExplicitPlaygroundPreviewMode()) {
    preview ??= createBaePreviewGateway({
      storage: window.localStorage,
      identity: () => {
        const u = useAuthStore.getState().currentUser;
        return u ? { id: u.id, name: u.name, role: u.role ?? 'user' } : null;
      },
      knownUserIds: () => useAuthStore.getState().users.map((u) => u.id),
      userName: (id) => useAuthStore.getState().users.find((u) => u.id === id)?.name,
      seed: () => baePreviewSeed(new Date(), SEED_PICS),
      channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bflow-preview-bae-gyeong'),
      make: createPreviewMake,
    });
    return preview;
  }
  throw new Error('BAE경 기능이 준비되지 않았어요. 앱을 다시 실행해 주세요.');
}
