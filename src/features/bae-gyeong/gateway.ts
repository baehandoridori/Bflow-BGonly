/**
 * BAE경 화면이 쓰는 통로: 앱에서는 preload 의 `window.baeGyeongAPI`(메인 → 세션 래퍼),
 * 테스트 모드(?preview=1)에서는 같은 규칙의 가짜 저장소(previewGateway). 둘 다 아니면 오류.
 */
import { isExplicitPlaygroundPreviewMode } from '@/features/playground/featureFlag';
import { useAuthStore } from '@/stores/useAuthStore';
import { createBaePreviewGateway } from './previewGateway';
import type { BaeGateway } from './types';

let preview: BaeGateway | null = null;

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
      channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bflow-preview-bae-gyeong'),
    });
    return preview;
  }
  throw new Error('BAE경 기능이 준비되지 않았어요. 앱을 다시 실행해 주세요.');
}
