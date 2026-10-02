import { useMemo, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ViewRevealContext, readPendingSceneOpen, type ViewRevealApi } from './ViewReveal';
import type { ViewMode } from '@/stores/useAppStore';
import { prefersReducedMotion } from '@/utils/motion';
import { VIEW_REVEAL_KEYFRAMES, shouldSkipViewReveal, viewRevealTiming } from '@/utils/viewTransitionMotion';

interface MainLayoutProps {
  activeView: ViewMode;
  children: React.ReactNode;
  onRefresh: () => void;
}

export function MainLayout({ activeView, children, onRefresh }: MainLayoutProps) {
  const immersive = activeView === 'playground';
  const mainRef = useRef<HTMLElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<{ lastView: string | null; animation: Animation | null }>({ lastView: null, animation: null });

  // 움직임 폴리싱 12번: 어느 메뉴로 가든 새 화면은 본문 위 덮개가 걷히며 0.18초 동안 드러난다.
  // 본문(main)에 opacity·transform 을 걸지 않는다 — 위젯 흐림이 꺼지고 fixed 자손 기준이 바뀐다.
  const revealApi = useMemo<ViewRevealApi>(() => ({
    onViewMounted(view) {
      const state = revealRef.current;
      if (state.lastView === view) return; // StrictMode 이중 실행·같은 화면 재신호
      const isFirstView = state.lastView === null;
      state.lastView = view;
      // 이전 화면 스크롤이 남아 새 화면이 중간부터 보이지 않게.
      if (!isFirstView && mainRef.current) mainRef.current.scrollTop = 0;
      if (shouldSkipViewReveal({ view, isFirstView, ...readPendingSceneOpen() })) {
        state.animation?.cancel();
        state.animation = null;
        return;
      }
      const cover = coverRef.current;
      if (!cover || typeof cover.animate !== 'function') return;
      state.animation?.cancel();
      // 첫 프레임부터 덮개가 덮인 상태(키프레임 1)로 그려진다 — layout effect 안이라 페인트 전이다.
      const animation = cover.animate(VIEW_REVEAL_KEYFRAMES, viewRevealTiming(prefersReducedMotion()));
      state.animation = animation;
      animation.onfinish = () => { if (state.animation === animation) state.animation = null; };
    },
  }), []);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {!immersive && <Header activeView={activeView} onRefresh={onRefresh} />}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <main ref={mainRef} className={immersive ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4'}>
            <ViewRevealContext.Provider value={revealApi}>
              {children}
            </ViewRevealContext.Provider>
          </main>
          {/* 화면 전환 덮개 — 평소엔 투명, 클릭은 통과. 화면이 바뀔 때만 1→0 으로 걷힌다. */}
          <div ref={coverRef} aria-hidden="true" className="bf-view-cover" />
        </div>
      </div>
    </div>
  );
}
