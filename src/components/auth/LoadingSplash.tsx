import { useEffect } from 'react';
import { cn } from '@/utils/cn';
import { LOADING_SPLASH_FADE_MS } from '@/utils/firstEntryMotion';

interface LoadingSplashProps {
  /** 로딩이 끝나 클릭으로 넘길 수 있는지. */
  canSkip: boolean;
  /** 넘긴 뒤 — 다음 화면 위에 덮개로 남아 0.2초 동안 걷힌다. */
  fading: boolean;
  onSkip: () => void;
  /** 다 걷혔다. */
  onFaded: () => void;
}

/**
 * 로딩 스플래시 — authReady 후에도 유지, 클릭으로 스킵 가능.
 * 영상은 1회 재생 후 마지막 프레임에서 멈춤 (스플래시 아트처럼).
 *
 * 움직임 폴리싱 13번: 넘기면 그 자리에서 사라지지 않고, 아래에 그려진 첫 화면('Bflow.' 또는 로그인) 위에서
 * 0.2초 동안 걷히며 짧게 겹친다. 앱은 같은 key 로 계속 그려 영상이 마지막 프레임 그대로 남게 한다.
 */
export function LoadingSplash({ canSkip, fading, onSkip, onFaded }: LoadingSplashProps) {
  // animationend 가 오지 않는 경우(창이 가려져 있었음 등)를 위한 안전장치.
  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(onFaded, LOADING_SPLASH_FADE_MS + 200);
    return () => window.clearTimeout(timer);
  }, [fading, onFaded]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex items-center justify-center h-screen w-screen overflow-hidden select-none',
        fading ? 'bf-loading-splash-out' : 'cursor-pointer',
      )}
      style={{
        backgroundColor: '#0F1117',
        backgroundImage: 'radial-gradient(ellipse 55% 65% at 50% 48%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0.15) 80%, #0F1117 100%)',
      }}
      onClick={() => { if (canSkip && !fading) onSkip(); }}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === 'bf-loading-splash-out') onFaded();
      }}
    >
      {/* 스플래시 영상 — loop 없이 1회 재생 후 마지막 프레임 고정 */}
      <div className="relative" style={{ width: 'min(420px, 75vmin)', aspectRatio: '672 / 592' }}>
        <video
          autoPlay muted playsInline preload="auto"
          src="./splash/opening_video.mp4"
          className="absolute object-cover"
          style={{
            inset: '-10%', width: '120%', height: '120%',
            animation: 'loadingSplashReveal 1.5s ease-out 0.3s forwards',
            filter: 'blur(8px) brightness(0.6)',
            transform: 'scale(1.05)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
            maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
            WebkitMaskComposite: 'destination-in' as never,
            maskComposite: 'intersect' as never,
          }}
        />
      </div>

      {/* 하단 문구 */}
      <div className="absolute bottom-6 flex flex-col items-center gap-1.5">
        {canSkip ? (
          <>
            <span
              className="text-sm text-accent/80 font-medium tracking-wide"
              style={{ animation: 'fadeIn 0.5s ease-out' }}
            >
              로딩 완료
            </span>
            <span
              className="text-xs text-white/40 tracking-wide"
              style={{ animation: 'fadeIn 0.5s ease-out 0.2s both' }}
            >
              아무 곳이나 클릭하여 건너뛰기
            </span>
          </>
        ) : (
          <span className="text-sm text-white/30 animate-pulse tracking-wide">
            로딩 중...
          </span>
        )}
      </div>

      <style>{`
        @keyframes loadingSplashReveal {
          to { filter: blur(0px) brightness(1); transform: scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
