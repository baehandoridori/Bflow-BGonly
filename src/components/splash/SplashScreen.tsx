import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/stores/useAppStore';
import { getPreset, rgbToHex } from '@/themes';

/**
 * Bflow 스플래시 스크린 — 이스터에그
 *
 * 변경사항:
 * - 원형 radial mask + 넉넉한 페더 (전체 검정 X)
 * - 프로그레스 바 삭제
 * - 자동 닫힘 없음 — 계속 유지 (Thanks to 등 추가 콘텐츠용)
 * - ESC / 클릭으로 닫기
 */

interface SplashScreenProps {
  onComplete: () => void;
}

type SplashPhase = 'video' | 'crossfade' | 'text';

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<SplashPhase>('video');
  const [videoError, setVideoError] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // 테마 accent 색상 (스플래시 글로우 + 그라데이션에 사용)
  const themeId = useAppStore((s) => s.themeId);
  const customThemeColors = useAppStore((s) => s.customThemeColors);
  const { accentRgba, accentSubRgba, accentHex, accentSubHex } = useMemo(() => {
    const colors = customThemeColors ?? getPreset(themeId)?.colors;
    const accent = colors?.accent ?? '108 92 231';
    const accentSub = colors?.accentSub ?? '162 155 254';
    const toRgba = (triplet: string, opacity: number) => {
      const [r, g, b] = triplet.split(' ');
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    };
    return {
      accentRgba: (o: number) => toRgba(accent, o),
      accentSubRgba: (o: number) => toRgba(accentSub, o),
      accentHex: rgbToHex(accent),
      accentSubHex: rgbToHex(accentSub),
    };
  }, [themeId, customThemeColors]);

  // 닫기 (페이드아웃 후 콜백)
  const dismiss = useCallback(() => {
    if (dismissing) return;
    setDismissing(true);
    setTimeout(onComplete, 400);
  }, [dismissing, onComplete]);

  // 비디오 이벤트
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnded = () => {
      setPhase('crossfade');
      setTimeout(() => setPhase('text'), 700);
    };

    const onError = () => {
      setVideoError(true);
      setPhase('crossfade');
      setTimeout(() => setPhase('text'), 500);
    };

    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.play().catch(onError);

    return () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, []);

  // 이미지 프리로드
  useEffect(() => {
    const img = new Image();
    img.src = '/splash/opening_image_cropped.png';
  }, []);

  // ESC로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dismiss]);

  const showVideo = phase === 'video';
  const showImage = phase === 'crossfade' || phase === 'text';
  const showText = phase === 'text';

  // 사각형 페더 마스크 (비디오/이미지용)
  const featherMask = {
    WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
    maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
    WebkitMaskComposite: 'destination-in' as never,
    maskComposite: 'intersect' as never,
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: dismissing ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden cursor-pointer"
      onClick={dismiss}
      // 원형 마스크 + 넉넉한 페더 — 전체 검정 덮기 대신 원형 창
      style={{
        background: 'radial-gradient(ellipse 55% 65% at 50% 48%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0.15) 80%, transparent 100%)',
      }}
    >
      {/* 배경 글로우 */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 500, height: 500,
          background: accentRgba(0.25),
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'blur(120px)',
          opacity: showText ? 0.25 : 0,
          transition: 'opacity 2s ease-in-out',
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 350, height: 350,
          background: accentSubRgba(0.15),
          top: '35%', left: '60%',
          transform: 'translate(-50%, -50%)',
          filter: 'blur(120px)',
          opacity: showText ? 0.2 : 0,
          transition: 'opacity 2s ease-in-out 0.5s',
        }}
      />

      {/* 아이콘 스테이지 */}
      <div
        className="relative pointer-events-none"
        style={{ width: 'min(420px, 75vmin)', aspectRatio: '672 / 592' }}
      >
        {/* 비디오 */}
        {!videoError && (
          <video
            ref={videoRef}
            muted
            playsInline
            preload="auto"
            src="/splash/opening_video.mp4"
            className="absolute object-cover"
            style={{
              inset: '-10%', width: '120%', height: '120%',
              zIndex: showVideo ? 2 : 1,
              opacity: showVideo ? 1 : 0,
              transition: 'opacity 0.8s ease-in-out',
              animation: showVideo ? 'splashVideoReveal 1.5s ease-out 0.3s forwards' : undefined,
              filter: 'blur(8px) brightness(0.6)',
              transform: 'scale(1.05)',
              ...featherMask,
            }}
          />
        )}

        {/* 이미지 */}
        <img
          src="/splash/opening_image_cropped.png"
          alt="Bflow"
          className="absolute object-cover"
          style={{
            inset: '-10%', width: '120%', height: '120%',
            zIndex: showImage ? 3 : 1,
            opacity: showImage ? 1 : 0,
            transition: 'opacity 0.8s ease-in-out',
            ...featherMask,
          }}
        />
      </div>

      {/* 텍스트 */}
      <AnimatePresence>
        {showText && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute text-center z-10 pointer-events-none"
            style={{ bottom: 'max(12%, 60px)' }}
          >
            <div
              className="font-semibold text-white tracking-wide"
              style={{ fontSize: 'clamp(28px, 5vw, 48px)' }}
            >
              <span
                style={{
                  background: `linear-gradient(135deg, ${accentHex}, ${accentSubHex})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                B
              </span>
              flow
            </div>
            <div
              className="uppercase tracking-[0.18em] font-light mt-2"
              style={{
                fontSize: 'clamp(11px, 1.8vw, 16px)',
                color: 'rgba(255, 255, 255, 0.45)',
              }}
            >
              B THE FLOW.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ESC 힌트 */}
      <AnimatePresence>
        {showText && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            transition={{ delay: 1.5, duration: 0.6 }}
            className="absolute bottom-4 right-4 z-10 text-[10px] text-white/40 tracking-wider pointer-events-none"
          >
            ESC or click to close
          </motion.div>
        )}
      </AnimatePresence>

      {/* CSS keyframes */}
      <style>{`
        @keyframes splashVideoReveal {
          to { filter: blur(0px) brightness(1); transform: scale(1); }
        }
      `}</style>
    </motion.div>
  );
}
