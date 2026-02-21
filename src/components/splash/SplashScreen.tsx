import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Bflow 스플래시 스크린 — bflow_splash_prompt.md 스펙 기반
 *
 * 시퀀스:
 * 0.0s  — 비디오 재생 (blur + brightness + scale 효과)
 * 0.3s  — 블러/밝기 서서히 원래 값
 * 5.0s  — 비디오 종료 → 크로스페이드 (이미지)
 * 5.7s  — "Bflow" 텍스트 + 태그라인
 * 7.0s  — onComplete 콜백
 */

interface SplashScreenProps {
  onComplete: () => void;
}

type SplashPhase = 'video' | 'crossfade' | 'text' | 'done';

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<SplashPhase>('video');
  const [videoError, setVideoError] = useState(false);
  const [progress, setProgress] = useState(0);

  // 프로그레스 바 업데이트
  const updateProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    setProgress((video.currentTime / video.duration) * 100);
  }, []);

  // 비디오 이벤트
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnded = () => {
      setPhase('crossfade');
      setTimeout(() => setPhase('text'), 700);
      setTimeout(() => {
        setPhase('done');
        onComplete();
      }, 2500);
    };

    const onError = () => {
      setVideoError(true);
      // 비디오 실패 시 이미지만 바로 보여주기
      setPhase('crossfade');
      setTimeout(() => setPhase('text'), 500);
      setTimeout(() => {
        setPhase('done');
        onComplete();
      }, 2000);
    };

    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('timeupdate', updateProgress);

    // 자동 재생 시도
    video.play().catch(onError);

    return () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('timeupdate', updateProgress);
    };
  }, [onComplete, updateProgress]);

  // 이미지 프리로드
  useEffect(() => {
    const img = new Image();
    img.src = '/splash/opening_image_cropped.png';
  }, []);

  // ESC로 스킵
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPhase('done');
        onComplete();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onComplete]);

  if (phase === 'done') return null;

  const showVideo = phase === 'video';
  const showImage = phase === 'crossfade' || phase === 'text';
  const showText = phase === 'text';
  const showProgress = phase === 'video';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: '#000' }}
    >
      {/* 배경 글로우 */}
      <div
        className="absolute rounded-full"
        style={{
          width: 500, height: 500,
          background: 'rgba(6, 214, 214, 0.25)',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'blur(120px)',
          opacity: phase === 'text' ? 0.25 : 0,
          transition: 'opacity 2s ease-in-out',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: 350, height: 350,
          background: 'rgba(59, 130, 246, 0.15)',
          top: '35%', left: '60%',
          transform: 'translate(-50%, -50%)',
          filter: 'blur(120px)',
          opacity: phase === 'text' ? 0.2 : 0,
          transition: 'opacity 2s ease-in-out 0.5s',
        }}
      />

      {/* 아이콘 스테이지 */}
      <div
        className="relative"
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
            className="absolute object-cover feather-mask"
            style={{
              inset: '-10%', width: '120%', height: '120%',
              zIndex: showVideo ? 2 : 1,
              opacity: showVideo ? 1 : 0,
              transition: 'opacity 0.8s ease-in-out',
              filter: showVideo ? undefined : 'blur(0px)',
              animation: showVideo ? 'splashVideoReveal 1.5s ease-out 0.3s forwards' : undefined,
              // 초기 상태
              ...(showVideo ? { filter: 'blur(8px) brightness(0.6)', transform: 'scale(1.05)' } : {}),
              // CSS mask for feather
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
              maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
              WebkitMaskComposite: 'destination-in' as never,
              maskComposite: 'intersect' as never,
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
            // CSS mask for feather
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
            maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
            WebkitMaskComposite: 'destination-in' as never,
            maskComposite: 'intersect' as never,
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
            className="absolute text-center z-10"
            style={{ bottom: 'max(12%, 60px)' }}
          >
            <div
              className="font-semibold text-white tracking-wide"
              style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontFamily: "'Outfit', sans-serif" }}
            >
              <span
                style={{
                  background: 'linear-gradient(135deg, #06D6D6, #3B82F6)',
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
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              B THE FLOW.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 프로그레스 바 */}
      <div
        className="absolute z-10"
        style={{
          bottom: 'max(6%, 30px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(180px, 35vw)',
          height: 2,
          background: 'rgba(255, 255, 255, 0.08)',
          borderRadius: 2,
          overflow: 'hidden',
          opacity: showProgress ? 1 : 0,
          transition: 'opacity 0.5s',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #06D6D6, #3B82F6)',
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* CSS keyframes for video reveal */}
      <style>{`
        @keyframes splashVideoReveal {
          to { filter: blur(0px) brightness(1); transform: scale(1); }
        }
      `}</style>
    </motion.div>
  );
}
