import { useState, useRef } from 'react';
import { LayoutDashboard, Film, List, Users, GanttChart, CalendarDays, Settings } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';
import { SplashScreen } from '@/components/splash/SplashScreen';
import { getPreset, rgbToHex } from '@/themes';

const NAV_ITEMS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={20} /> },
  { id: 'episode', label: '에피소드', icon: <Film size={20} /> },
  { id: 'scenes', label: '씬 목록', icon: <List size={20} /> },
  { id: 'assignee', label: '인원별', icon: <Users size={20} /> },
  { id: 'calendar', label: '타임라인', icon: <GanttChart size={20} /> },
  { id: 'schedule', label: '캘린더', icon: <CalendarDays size={20} /> },
  { id: 'settings', label: '설정', icon: <Settings size={20} /> },
];

/** 리퀴드 글래스 스타일 B 로고 아이콘 (테마 accent 색상 반영) */
function LiquidGlassLogo({ onClick }: { onClick: () => void }) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });

  // 테마 accent 색상 — 매 렌더마다 직접 계산 (테마 변경 시 즉시 반영)
  const themeId = useAppStore((s) => s.themeId);
  const customThemeColors = useAppStore((s) => s.customThemeColors);
  const colors = customThemeColors ?? getPreset(themeId)?.colors;
  const accent = colors?.accent ?? '108 92 231';
  const accentSub = colors?.accentSub ?? '162 155 254';
  const ac = accent.split(' ').join(', ');
  const acSub = accentSub.split(' ').join(', ');
  const acHex = rgbToHex(accent);
  const acSubHex = rgbToHex(accentSub);
  // background-clip:text 그라디언트 re-paint 강제 키
  const themeKey = `${themeId}-${accent}-${accentSub}`;

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMousePos({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0.5, y: 0.5 });
  };

  // 마우스 위치에 따른 동적 라이트 포지션
  const lightX = mousePos.x * 100;
  const lightY = mousePos.y * 100;

  return (
    <button
      ref={containerRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      title="B flow — 스플래시 보기"
      className="group relative w-10 h-10 rounded-xl mb-4 cursor-pointer transition-transform duration-300 hover:scale-110 active:scale-95"
      style={{ perspective: '200px' }}
    >
      {/* 외부 글로우 */}
      <div
        className="absolute -inset-1 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle at ${lightX}% ${lightY}%, rgba(${ac}, 0.4), rgba(${acSub}, 0.15), transparent 70%)`,
          filter: 'blur(6px)',
        }}
      />

      {/* 메인 글래스 레이어 */}
      <div
        className="relative w-full h-full rounded-xl overflow-hidden"
        style={{
          background: `
            radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.18) 0%, transparent 60%),
            linear-gradient(135deg, rgba(${ac}, 0.35) 0%, rgba(${acSub}, 0.2) 50%, rgba(${ac}, 0.1) 100%)
          `,
          backdropFilter: 'blur(20px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: `
            0 0 0 0.5px rgba(255,255,255,0.1) inset,
            0 2px 8px rgb(var(--color-shadow) / var(--shadow-alpha)),
            0 1px 2px rgba(${ac}, 0.2)
          `,
        }}
      >
        {/* 상단 하이라이트 (유리 반사) */}
        <div
          className="absolute inset-x-0 top-0 h-[45%] rounded-t-xl pointer-events-none"
          style={{
            background: `linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 60%, transparent 100%)`,
            maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          }}
        />

        {/* 동적 라이트 리플렉션 */}
        <div
          className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.25) 0%, transparent 50%)`,
          }}
        />

        {/* 무지개빛(iridescent) 셰이드 */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity duration-500"
          style={{
            background: `
              conic-gradient(
                from ${mousePos.x * 360}deg at ${lightX}% ${lightY}%,
                rgba(${ac}, 0.15),
                rgba(${acSub}, 0.1),
                rgba(${ac}, 0.08),
                rgba(${acSub}, 0.1),
                rgba(${ac}, 0.15)
              )
            `,
            mixBlendMode: 'overlay',
          }}
        />

        {/* 텍스트 — key로 테마 변경 시 강제 re-mount하여 gradient repaint 보장 */}
        <div className="relative flex items-center justify-center w-full h-full">
          <span
            key={themeKey}
            className="font-bold text-base tracking-tight"
            style={{
              background: `linear-gradient(135deg, ${acHex} 0%, ${acSubHex} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              color: 'transparent',
              textShadow: 'none',
              filter: 'drop-shadow(0 1px 2px rgb(var(--color-shadow) / var(--shadow-alpha)))',
            }}
          >
            B
          </span>
        </div>

        {/* 하단 에지 라이트 */}
        <div
          className="absolute inset-x-0 bottom-0 h-[1px] pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.15) 50%, transparent 90%)',
          }}
        />
      </div>
    </button>
  );
}

export function Sidebar() {
  const { currentView, setView } = useAppStore();
  const [showSplash, setShowSplash] = useState(false);

  return (
    <>
      <aside
        className="w-16 h-full border-r border-bg-border flex flex-col items-center py-4 gap-2"
        style={{
          background: `
            linear-gradient(180deg, transparent 55%, rgb(var(--color-accent) / 0.07) 78%, rgb(var(--color-accent-sub) / 0.12) 100%),
            rgb(var(--color-bg-card))
          `,
        }}
      >
        {/* 리퀴드 글래스 로고 */}
        <LiquidGlassLogo onClick={() => setShowSplash(true)} />

        {/* 네비게이션 */}
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={item.label}
            className={cn(
              'w-12 h-12 rounded-lg flex items-center justify-center transition-colors cursor-pointer',
              currentView === item.id
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/50'
            )}
          >
            {item.icon}
          </button>
        ))}

        {/* 하단: 버전 */}
        <div className="mt-auto mb-2 flex flex-col items-center gap-0.5">
          <span className="text-[10px] text-text-secondary/50 font-mono">
            v{__APP_VERSION__}
          </span>
        </div>
      </aside>

      {/* 스플래시 오버레이 (이스터에그) */}
      <AnimatePresence>
        {showSplash && (
          <SplashScreen onComplete={() => setShowSplash(false)} />
        )}
      </AnimatePresence>
    </>
  );
}
