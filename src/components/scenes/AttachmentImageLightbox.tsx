import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { formatCommentTime } from '@/utils/formatTime';
import { ImageContextMenu, type ContextAction } from './ImageContextMenu';
import { copyImageToClipboard, copyImageUrl, downloadImage } from '@/utils/imageActions';

export interface AttachmentImageLightboxEntry {
  url: string;
  userName: string;
  commentText: string;
  createdAt: string;
  commentId: string;
}

export interface AttachmentImageLightboxState {
  entries: AttachmentImageLightboxEntry[];
  index: number;
}

interface AttachmentImageLightboxProps {
  lightbox: AttachmentImageLightboxState;
  setLightbox: (
    next: AttachmentImageLightboxState | null
      | ((prev: AttachmentImageLightboxState | null) => AttachmentImageLightboxState | null)
  ) => void;
  closeLightbox: () => void;
  lightboxStep: (dir: 1 | -1) => void;
  sceneLabel?: string;
  ariaLabel?: string;
  fileNamePrefix?: string;
  manageKeyboard?: boolean;
}

function sanitizeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

function inferImageExtension(url: string): string {
  const dataMime = url.match(/^data:image\/([a-z0-9.+-]+);/i)?.[1];
  if (dataMime) return dataMime === 'jpeg' ? 'jpg' : dataMime;
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (ext && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {
    /* fallback below */
  }
  return 'png';
}

function buildDownloadFileName(
  entry: AttachmentImageLightboxEntry,
  index: number,
  sceneLabel?: string,
  fileNamePrefix?: string,
): string {
  const date = entry.createdAt ? entry.createdAt.slice(0, 10) : '';
  const base = [
    fileNamePrefix || sceneLabel || 'bflow-image',
    entry.userName,
    date,
    String(index + 1).padStart(2, '0'),
  ].filter(Boolean).join('_');
  return `${sanitizeFileName(base) || 'bflow-image'}.${inferImageExtension(entry.url)}`;
}

export function AttachmentImageLightbox({
  lightbox,
  setLightbox,
  closeLightbox,
  lightboxStep,
  sceneLabel,
  ariaLabel = '이미지 확대 보기',
  fileNamePrefix,
  manageKeyboard = true,
}: AttachmentImageLightboxProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const current = lightbox.entries[lightbox.index];
  const totalCount = lightbox.entries.length;
  const showNav = totalCount > 1;

  useEffect(() => {
    if (!manageKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const claimKey = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      if (e.key === 'Escape') {
        claimKey();
        closeLightbox();
        return;
      }
      if (e.key === 'ArrowLeft') {
        claimKey();
        lightboxStep(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        claimKey();
        lightboxStep(1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeLightbox, lightboxStep, manageKeyboard]);

  const openContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCtxMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const handleContextAction = useCallback((action: ContextAction) => {
    if (!current) return;
    const fileName = buildDownloadFileName(current, lightbox.index, sceneLabel, fileNamePrefix);
    if (action === 'download') void downloadImage(current.url, fileName);
    if (action === 'copy') void copyImageToClipboard(current.url);
    if (action === 'copy-url') void copyImageUrl(current.url);
  }, [current, fileNamePrefix, lightbox.index, sceneLabel]);

  if (typeof document === 'undefined' || !current) return null;

  return createPortal(
    <div
      className="comment-lightbox-backdrop cursor-zoom-out"
      onClick={closeLightbox}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="relative w-full h-full flex flex-col cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-6 pt-4 pb-2">
          <div className="flex items-center gap-2 text-[12px] text-white/80 flex-wrap min-w-0">
            {sceneLabel && (
              <>
                <span className="px-2 py-1 rounded bg-white/10 font-medium">{sceneLabel}</span>
                <span className="text-white/40">·</span>
              </>
            )}
            <span className="tabular-nums text-white/70">{lightbox.index + 1} / {totalCount}</span>
          </div>
          <button
            type="button"
            onClick={closeLightbox}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
            title="닫기 (ESC)"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>

        <div ref={stageRef} className="flex-1 relative flex items-center justify-center px-6 min-h-0">
          {showNav && (
            <button
              type="button"
              onClick={() => lightboxStep(-1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
              title="이전 이미지 (←)"
              aria-label="이전 이미지"
            >
              <ChevronLeft size={26} />
            </button>
          )}

          <img
            src={current.url}
            alt={`${current.userName}의 이미지 ${lightbox.index + 1}/${totalCount}`}
            className="comment-lightbox-image"
            key={`${lightbox.index}-${current.url}`}
            onContextMenu={openContextMenu}
          />

          {showNav && (
            <button
              type="button"
              onClick={() => lightboxStep(1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
              title="다음 이미지 (→)"
              aria-label="다음 이미지"
            >
              <ChevronRight size={26} />
            </button>
          )}

          {ctxMenu && (
            <ImageContextMenu
              open
              x={ctxMenu.x}
              y={ctxMenu.y}
              containerWidth={stageRef.current?.clientWidth ?? 0}
              containerHeight={stageRef.current?.clientHeight ?? 0}
              actions={['download', 'copy', 'copy-url']}
              onAction={handleContextAction}
              onClose={() => setCtxMenu(null)}
            />
          )}
        </div>

        <div className="flex-shrink-0 px-6 pt-3 pb-2 max-w-3xl mx-auto w-full">
          <div className="flex items-baseline gap-2 text-[12.5px] mb-1">
            <span className="font-semibold text-white">{current.userName}</span>
            <span className="text-white/50 text-[11px]">{formatCommentTime(current.createdAt)}</span>
          </div>
          {current.commentText && (
            <p className="text-[13.5px] text-white/95 leading-relaxed whitespace-pre-wrap break-words max-h-24 overflow-y-auto comment-lightbox-thumb-strip">
              {current.commentText}
            </p>
          )}
        </div>

        {showNav && (
          <div
            className="flex-shrink-0 px-6 py-3"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.2))' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-white/60 font-medium">이미지 {totalCount}장</span>
              <span className="text-[11px] text-white/60">
                <span className="px-1.5 py-0.5 rounded bg-white/10 mr-1">←</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">→</span>
                <span className="ml-2">키보드 이동</span>
                <span className="mx-2 text-white/30">·</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">ESC</span>
                <span className="ml-1">닫기</span>
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 comment-lightbox-thumb-strip">
              {lightbox.entries.map((entry, i) => {
                const isActive = i === lightbox.index;
                return (
                  <button
                    key={`${i}-${entry.commentId}-${entry.url}`}
                    type="button"
                    onClick={() => setLightbox((prev) => prev ? { ...prev, index: i } : prev)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setLightbox((prev) => prev ? { ...prev, index: i } : prev);
                      openContextMenu(e);
                    }}
                    className={cn(
                      'flex-shrink-0 rounded-md overflow-hidden transition-all cursor-pointer',
                      isActive ? 'comment-lightbox-thumb-active' : 'opacity-60 hover:opacity-100',
                    )}
                    style={{ width: 72, height: 72 }}
                    aria-label={`${i + 1}번 이미지로 이동 (${entry.userName})`}
                    aria-current={isActive ? 'true' : undefined}
                    title={`${entry.userName}: ${entry.commentText.slice(0, 30)}`}
                  >
                    <img src={entry.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
