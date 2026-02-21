import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Columns2, Layers, ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * 뷰 상태:
 *   single-storyboard  ←(Left)→  side-by-side  ←(Right)→  single-guide
 *   overlay 는 별도 (방향키 무관)
 */
type ViewState = 'single-storyboard' | 'side-by-side' | 'single-guide' | 'overlay';

/** 툴바에서 보여줄 고수준 모드 */
type ToolbarMode = 'single' | 'side-by-side' | 'overlay';

interface ImageModalProps {
  storyboardUrl: string;
  guideUrl: string;
  sceneId: string;
  onClose: () => void;
}

/* ────────────────────────────────────────────────────────────── */

export function ImageModal({ storyboardUrl, guideUrl, sceneId, onClose }: ImageModalProps) {
  const hasBoth = !!storyboardUrl && !!guideUrl;

  const [view, setView] = useState<ViewState>(
    hasBoth ? 'side-by-side' : storyboardUrl ? 'single-storyboard' : 'single-guide',
  );
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [direction, setDirection] = useState(0); // -1 left · 0 fade · 1 right
  const imageAreaRef = useRef<HTMLDivElement>(null);

  /* ── 뷰 순서 (오버레이 제외) ── */
  const viewOrder: ViewState[] = ['single-storyboard', 'side-by-side', 'single-guide'];

  /* ── 부드러운 줌 (0.05 단위) ── */
  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => Math.round(Math.min(4, Math.max(0.1, z + delta)) * 100) / 100);
  }, []);

  /* ── 방향키 / 화살표 네비게이션 ── */
  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (view === 'overlay' || !hasBoth) return;
      const idx = viewOrder.indexOf(view);
      const next = idx + dir;
      if (next >= 0 && next < viewOrder.length) {
        setDirection(dir);
        setView(viewOrder[next]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, hasBoth],
  );

  /* ── 키보드 핸들러 ── */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navigate(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate, onClose]);

  /* ── 마우스 휠 줌 ── */
  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      zoomBy(delta);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [zoomBy]);

  /* ── 배경 클릭 → 닫기 ── */
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  /* ── 나란히 이미지 클릭 → 단일 ── */
  const handleImageClick = (which: 'storyboard' | 'guide') => {
    if (view !== 'side-by-side') return;
    setDirection(which === 'storyboard' ? -1 : 1);
    setView(which === 'storyboard' ? 'single-storyboard' : 'single-guide');
  };

  /* ── 툴바 활성 모드 ── */
  const toolbarMode: ToolbarMode =
    view === 'overlay' ? 'overlay' : view === 'side-by-side' ? 'side-by-side' : 'single';

  /* ── 네비게이션 가능 여부 ── */
  const canGoLeft  = hasBoth && view !== 'overlay' && viewOrder.indexOf(view) > 0;
  const canGoRight = hasBoth && view !== 'overlay' && viewOrder.indexOf(view) < viewOrder.length - 1;

  /* ── 스와이프 애니메이션 variants (빠른 tween) ── */
  const slideVariants = {
    enter: (d: number) => ({
      x: d > 0 ? 300 : d < 0 ? -300 : 0,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (d: number) => ({
      x: d > 0 ? -300 : d < 0 ? 300 : 0,
      opacity: 0,
    }),
  };

  /* ────────────────────── 렌더 ────────────────────── */
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={handleBackdrop}
      >
        {/* ─── 상단 툴바 ─── */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-bg-card/90 border border-bg-border rounded-xl px-4 py-2 z-10">
          <span className="text-sm text-text-primary font-mono mr-2">{sceneId}</span>

          {hasBoth && (
            <>
              <div className="w-px h-5 bg-bg-border" />
              {(['single', 'side-by-side', 'overlay'] as ToolbarMode[]).map((m) => {
                const labels: Record<ToolbarMode, string> = {
                  single: '단일',
                  'side-by-side': '나란히',
                  overlay: '오버레이',
                };
                const icons: Record<ToolbarMode, React.ReactNode> = {
                  single: null,
                  'side-by-side': <Columns2 size={14} />,
                  overlay: <Layers size={14} />,
                };
                return (
                  <button
                    key={m}
                    onClick={() => {
                      if (m === 'single') {
                        setDirection(-1);
                        setView('single-storyboard');
                      } else if (m === 'side-by-side') {
                        setDirection(0);
                        setView('side-by-side');
                      } else {
                        setView('overlay');
                      }
                    }}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
                      toolbarMode === m
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {icons[m]}
                    {labels[m]}
                  </button>
                );
              })}
            </>
          )}

          <div className="w-px h-5 bg-bg-border" />

          {/* 줌 컨트롤 */}
          <button
            onClick={() => zoomBy(-0.25)}
            className="p-1 text-text-secondary hover:text-text-primary"
            title="축소"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className={cn(
              'text-xs w-12 text-center rounded px-1 py-0.5 transition-colors',
              zoom === 1
                ? 'text-accent bg-accent/10'
                : 'text-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer',
            )}
            title="원본 크기 (100%)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => zoomBy(0.25)}
            className="p-1 text-text-secondary hover:text-text-primary"
            title="확대"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1 text-text-secondary hover:text-text-primary"
            title="원본 크기로"
          >
            <Maximize size={14} />
          </button>

          <div className="w-px h-5 bg-bg-border" />
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-red-400">
            <X size={16} />
          </button>
        </div>

        {/* ─── 오버레이 슬라이더 ─── */}
        {view === 'overlay' && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-bg-card/90 border border-bg-border rounded-xl px-4 py-2 z-10">
            <span className="text-[10px] text-text-secondary">스토리보드</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              className="w-48 accent-accent"
            />
            <span className="text-[10px] text-text-secondary">가이드</span>
          </div>
        )}

        {/* ─── 좌 화살표 버튼 ─── */}
        {canGoLeft && (
          <button
            onClick={() => navigate(-1)}
            className="absolute left-6 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full
                       bg-white/5 text-white/40 hover:text-white hover:bg-white/15
                       backdrop-blur transition-all duration-200"
          >
            <ChevronLeft size={28} />
          </button>
        )}

        {/* ─── 우 화살표 버튼 ─── */}
        {canGoRight && (
          <button
            onClick={() => navigate(1)}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full
                       bg-white/5 text-white/40 hover:text-white hover:bg-white/15
                       backdrop-blur transition-all duration-200"
          >
            <ChevronRight size={28} />
          </button>
        )}

        {/* ─── 하단 인디케이터 (도트) ─── */}
        {hasBoth && view !== 'overlay' && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
            {viewOrder.map((v) => (
              <div
                key={v}
                className={cn(
                  'rounded-full transition-all duration-300',
                  v === view
                    ? 'w-6 h-2 bg-accent'
                    : 'w-2 h-2 bg-white/30 hover:bg-white/50',
                )}
              />
            ))}
          </div>
        )}

        {/* ─── 이미지 영역 ─── */}
        <div
          ref={imageAreaRef}
          className="relative w-full h-full flex items-center justify-center pt-20 pb-16 overflow-hidden"
        >
          {view === 'overlay' ? (
            /* 오버레이 모드 — 스와이프 없음 */
            <div className="relative">
              {storyboardUrl && (
                <img
                  src={storyboardUrl}
                  alt="스토리보드"
                  className="rounded-lg shadow-2xl object-contain transition-transform duration-150 ease-out"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center',
                    maxHeight: '75vh',
                    opacity: 1 - overlayOpacity,
                  }}
                  draggable={false}
                />
              )}
              {guideUrl && (
                <img
                  src={guideUrl}
                  alt="가이드"
                  className="absolute inset-0 rounded-lg object-contain transition-transform duration-150 ease-out"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center',
                    maxHeight: '75vh',
                    opacity: overlayOpacity,
                  }}
                  draggable={false}
                />
              )}
            </div>
          ) : (
            /* 단일 / 나란히 — 스와이프 애니메이션 */
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={view}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
                className="flex items-center justify-center gap-6"
              >
                {/* ── 단일: 스토리보드 ── */}
                {view === 'single-storyboard' && (
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-xs text-accent font-medium tracking-wide">스토리보드</span>
                    <img
                      src={storyboardUrl}
                      alt="스토리보드"
                      className="rounded-lg shadow-2xl object-contain transition-transform duration-150 ease-out"
                      style={{
                        transform: `scale(${zoom})`,
                        transformOrigin: 'center',
                        maxHeight: '75vh',
                      }}
                      draggable={false}
                    />
                  </div>
                )}

                {/* ── 단일: 가이드 ── */}
                {view === 'single-guide' && (
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-xs text-accent font-medium tracking-wide">가이드</span>
                    <img
                      src={guideUrl}
                      alt="가이드"
                      className="rounded-lg shadow-2xl object-contain transition-transform duration-150 ease-out"
                      style={{
                        transform: `scale(${zoom})`,
                        transformOrigin: 'center',
                        maxHeight: '75vh',
                      }}
                      draggable={false}
                    />
                  </div>
                )}

                {/* ── 나란히 (3D 호버 + 클릭) ── */}
                {view === 'side-by-side' && (
                  <>
                    {/* 스토리보드 (왼쪽) */}
                    <div
                      className="flex flex-col items-center gap-2 cursor-pointer"
                      style={{ perspective: 800 }}
                      onClick={() => handleImageClick('storyboard')}
                    >
                      <span className="text-xs text-text-secondary">스토리보드</span>
                      {storyboardUrl ? (
                        <HoverCard3D direction="left">
                          <img
                            src={storyboardUrl}
                            alt="스토리보드"
                            className="rounded-lg shadow-2xl object-contain transition-transform duration-150 ease-out"
                            style={{
                              transform: `scale(${zoom})`,
                              transformOrigin: 'center',
                              maxHeight: '70vh',
                              maxWidth: '42vw',
                            }}
                            draggable={false}
                          />
                        </HoverCard3D>
                      ) : (
                        <EmptySlot />
                      )}
                    </div>

                    {/* 가이드 (오른쪽) */}
                    <div
                      className="flex flex-col items-center gap-2 cursor-pointer"
                      style={{ perspective: 800 }}
                      onClick={() => handleImageClick('guide')}
                    >
                      <span className="text-xs text-text-secondary">가이드</span>
                      {guideUrl ? (
                        <HoverCard3D direction="right">
                          <img
                            src={guideUrl}
                            alt="가이드"
                            className="rounded-lg shadow-2xl object-contain transition-transform duration-150 ease-out"
                            style={{
                              transform: `scale(${zoom})`,
                              transformOrigin: 'center',
                              maxHeight: '70vh',
                              maxWidth: '42vw',
                            }}
                            draggable={false}
                          />
                        </HoverCard3D>
                      ) : (
                        <EmptySlot />
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ══════════════════════════════════════════════════════════════
   서브 컴포넌트
   ══════════════════════════════════════════════════════════════ */

/** 3D 호버 카드 래퍼 — direction 에 따라 회전 방향이 다름 */
function HoverCard3D({
  direction,
  children,
}: {
  direction: 'left' | 'right';
  children: React.ReactNode;
}) {
  const rotateY = direction === 'left' ? 6 : -6;

  return (
    <motion.div
      className="rounded-lg"
      whileHover={{
        rotateY,
        scale: 1.04,
        boxShadow: '0 25px 60px -12px rgba(99, 102, 241, 0.25)',
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {children}
    </motion.div>
  );
}

/** 이미지 없음 슬롯 */
function EmptySlot() {
  return (
    <div className="w-64 h-48 rounded-lg bg-bg-card border border-bg-border flex items-center justify-center text-text-secondary text-sm">
      이미지 없음
    </div>
  );
}
