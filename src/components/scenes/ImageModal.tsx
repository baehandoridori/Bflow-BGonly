import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Columns2, Layers, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/utils/cn';

type CompareMode = 'single' | 'side-by-side' | 'overlay';

interface ImageModalProps {
  storyboardUrl: string;
  guideUrl: string;
  sceneId: string;
  onClose: () => void;
}

function toSrc(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith('http') || filePath.startsWith('data:')) return filePath;
  return `local-image://${encodeURIComponent(filePath)}`;
}

export function ImageModal({ storyboardUrl, guideUrl, sceneId, onClose }: ImageModalProps) {
  const hasBoth = !!storyboardUrl && !!guideUrl;
  const [mode, setMode] = useState<CompareMode>(hasBoth ? 'side-by-side' : 'single');
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [zoom, setZoom] = useState(1);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={handleBackdrop}
      >
        {/* 툴바 */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-bg-card/90 border border-bg-border rounded-xl px-4 py-2 z-10">
          <span className="text-sm text-text-primary font-mono mr-2">{sceneId}</span>

          {hasBoth && (
            <>
              <div className="w-px h-5 bg-bg-border" />
              {(['single', 'side-by-side', 'overlay'] as CompareMode[]).map((m) => {
                const labels: Record<CompareMode, string> = {
                  single: '단일',
                  'side-by-side': '나란히',
                  overlay: '오버레이',
                };
                const icons: Record<CompareMode, React.ReactNode> = {
                  single: null,
                  'side-by-side': <Columns2 size={14} />,
                  overlay: <Layers size={14} />,
                };
                return (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
                      mode === m ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
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

          {/* 줌 */}
          <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="p-1 text-text-secondary hover:text-text-primary">
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-text-secondary w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="p-1 text-text-secondary hover:text-text-primary">
            <ZoomIn size={14} />
          </button>

          <div className="w-px h-5 bg-bg-border" />
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-red-400">
            <X size={16} />
          </button>
        </div>

        {/* 오버레이 슬라이더 */}
        {mode === 'overlay' && (
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

        {/* 이미지 영역 */}
        <div className="flex items-center justify-center gap-4 max-w-[90vw] max-h-[80vh] mt-16 overflow-auto">
          {mode === 'single' && (
            <img
              src={toSrc(storyboardUrl || guideUrl)}
              alt={sceneId}
              className="rounded-lg shadow-2xl object-contain"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center', maxHeight: '75vh' }}
              draggable={false}
            />
          )}

          {mode === 'side-by-side' && (
            <>
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-text-secondary">스토리보드</span>
                {storyboardUrl ? (
                  <img
                    src={toSrc(storyboardUrl)}
                    alt="스토리보드"
                    className="rounded-lg shadow-2xl object-contain"
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'center', maxHeight: '70vh', maxWidth: '42vw' }}
                    draggable={false}
                  />
                ) : (
                  <div className="w-64 h-48 rounded-lg bg-bg-card border border-bg-border flex items-center justify-center text-text-secondary text-sm">
                    이미지 없음
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-text-secondary">가이드</span>
                {guideUrl ? (
                  <img
                    src={toSrc(guideUrl)}
                    alt="가이드"
                    className="rounded-lg shadow-2xl object-contain"
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'center', maxHeight: '70vh', maxWidth: '42vw' }}
                    draggable={false}
                  />
                ) : (
                  <div className="w-64 h-48 rounded-lg bg-bg-card border border-bg-border flex items-center justify-center text-text-secondary text-sm">
                    이미지 없음
                  </div>
                )}
              </div>
            </>
          )}

          {mode === 'overlay' && (
            <div className="relative">
              {storyboardUrl && (
                <img
                  src={toSrc(storyboardUrl)}
                  alt="스토리보드"
                  className="rounded-lg shadow-2xl object-contain"
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
                  src={toSrc(guideUrl)}
                  alt="가이드"
                  className="absolute inset-0 rounded-lg object-contain"
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
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
