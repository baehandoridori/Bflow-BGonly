import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { VIEW_SPINNER_DELAY_MS } from '@/utils/viewTransitionMotion';

/*
 * 화면 전환 덮개 (움직임 폴리싱 12번).
 * MainLayout 이 본문(main) 위에 배경색 덮개 한 장을 두고, 새 화면이 실제로 그려지는 순간(ViewReady 의
 * layout effect — 첫 페인트 전) 그 덮개를 opacity 1→0 으로 걷는다. 화면 내용은 움직이지 않는다.
 */

export interface ViewRevealApi {
  /** 새 화면이 마운트됐다 — 덮개를 걷을지 판단하고 걷는다. */
  onViewMounted(view: string): void;
}

const NOOP: ViewRevealApi = { onViewMounted: () => {} };

export const ViewRevealContext = createContext<ViewRevealApi>(NOOP);

/** Suspense 안에서 화면과 나란히 둔다. 화면 코드가 도착해 처음 그려질 때 한 번 신호를 보낸다. */
export function ViewReady({ view }: { view: string }) {
  const api = useContext(ViewRevealContext);
  useLayoutEffect(() => {
    api.onViewMounted(view);
    // 마운트 때 한 번만 — 화면이 바뀌면 오류 경계 key 가 바뀌어 새로 마운트된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** 화면 코드가 250ms 안에 오면 아무것도 보이지 않는다. 그보다 늦을 때만 로딩 동그라미. */
export function DelayedViewSpinner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), VIEW_SPINNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** 지금 store 에 알림·딥링크로 씬 창을 바로 여는 요청이 있는지(덮개 생략 판단용). */
export function readPendingSceneOpen(): { pendingDeepLink: unknown; pendingSceneModalRequest: unknown } {
  const s = useAppStore.getState();
  return { pendingDeepLink: s.pendingDeepLink, pendingSceneModalRequest: s.pendingSceneModalRequest };
}
