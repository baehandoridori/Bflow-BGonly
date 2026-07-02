import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Copy, Move, X } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import { CharacterImageFrame } from './CharacterImageFrame';
import { CharacterImageFitEditor } from './CharacterImageFitEditor';

export interface CharacterImageLightboxEntry {
  costumeId: string;
  name: string;
  costumeName: string;
  versionNo: number;
  url: string;
  background: CharacterImageBackground;
  fit: CharacterImageFit;
}

export function CharacterImageLightbox({
  entries,
  initialCostumeId,
  onClose,
  onFitCommit,
  onCopyImage,
}: {
  entries: CharacterImageLightboxEntry[];
  initialCostumeId: string | null;
  onClose: () => void;
  onFitCommit: (costumeId: string, fit: CharacterImageFit) => void;
  onCopyImage: (url: string) => void;
}) {
  const initialIndex = useMemo(() => {
    const found = entries.findIndex((entry) => entry.costumeId === initialCostumeId);
    return found >= 0 ? found : 0;
  }, [entries, initialCostumeId]);
  const [index, setIndex] = useState(initialIndex);
  const [fitEditorOpen, setFitEditorOpen] = useState(false);
  const initialCostumeIdRef = useRef(initialCostumeId);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIndex((prev) => {
      if (entries.length === 0) return 0;

      if (initialCostumeIdRef.current !== initialCostumeId) {
        initialCostumeIdRef.current = initialCostumeId;
        return initialIndex;
      }

      const currentCostumeId = entries[prev]?.costumeId;
      if (currentCostumeId) {
        const currentIndex = entries.findIndex((entry) => entry.costumeId === currentCostumeId);
        if (currentIndex >= 0) return currentIndex;
      }

      return Math.min(prev, entries.length - 1);
    });
  }, [entries, initialCostumeId, initialIndex]);

  const current = entries[index] ?? entries[0] ?? null;
  const go = (delta: number) => {
    if (entries.length === 0) return;
    setIndex((prev) => (prev + delta + entries.length) % entries.length);
    setFitEditorOpen(false);
  };
  const scrollThumbnailStrip = (delta: number) => {
    thumbnailStripRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (fitEditorOpen) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries.length, fitEditorOpen, onClose]);

  if (!current) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-5" onMouseDown={onClose}>
      <div className="relative flex h-full w-full max-w-6xl flex-col" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="truncate text-base font-semibold">{current.name}</div>
              <span className="shrink-0 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/80">
                복장 버전 v{current.versionNo}
              </span>
            </div>
            <div className="text-xs text-white/55">{index + 1} / {entries.length}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFitEditorOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
            >
              <Move size={15} /> 썸네일 맞추기
            </button>
            <button
              type="button"
              onClick={() => onCopyImage(current.url)}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
            >
              <Copy size={15} /> 이미지 복사
            </button>
            <button type="button" aria-label="닫기" onClick={onClose} className="rounded-lg p-2 text-white/75 hover:bg-white/10 hover:text-white">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 rounded-xl border border-white/10 bg-black/20">
          <CharacterImageFrame
            url={current.url}
            alt={current.name}
            background={current.background}
            fit={current.fit}
            className="absolute inset-0 rounded-xl"
          />
          {entries.length > 1 && (
            <>
              <button
                type="button"
                aria-label="이전 복장"
                onClick={() => go(-1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white/80 hover:bg-black/70 hover:text-white"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                type="button"
                aria-label="다음 복장"
                onClick={() => go(1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white/80 hover:bg-black/70 hover:text-white"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}
        </div>

        {entries.length > 0 && (
          <div className="mt-3 shrink-0 rounded-xl border border-white/10 bg-black/35 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0 text-xs text-white/60">
                다른 복장
                <span className="ml-2 text-white/35">{entries.length}개</span>
              </div>
              {entries.length > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="이전 복장 썸네일"
                    onClick={() => scrollThumbnailStrip(-220)}
                    className="rounded-md border border-white/10 p-1.5 text-white/65 hover:bg-white/10 hover:text-white"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="다음 복장 썸네일"
                    onClick={() => scrollThumbnailStrip(220)}
                    className="rounded-md border border-white/10 p-1.5 text-white/65 hover:bg-white/10 hover:text-white"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </div>
            <div
              ref={thumbnailStripRef}
              aria-label="복장 썸네일 목록"
              className="flex gap-2 overflow-x-auto pb-1"
            >
              {entries.map((entry, entryIndex) => {
                const selected = entry.costumeId === current.costumeId;
                return (
                  <button
                    key={entry.costumeId}
                    type="button"
                    onClick={() => {
                      setIndex(entryIndex);
                      setFitEditorOpen(false);
                    }}
                    aria-pressed={selected}
                    title={`${entry.costumeName} · v${entry.versionNo}`}
                    className={`flex w-[82px] shrink-0 flex-col overflow-hidden rounded-lg border text-left transition-colors active:scale-[0.98] ${
                      selected
                        ? 'border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(108,92,231,0.45)]'
                        : 'border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]'
                    }`}
                  >
                    <CharacterImageFrame
                      url={entry.url}
                      alt={entry.name}
                      background={entry.background}
                      fit={entry.fit}
                      className="h-[82px] w-full"
                    />
                    <span className="min-w-0 px-2 py-1.5">
                      <span className="block truncate text-[11px] font-medium text-white/80">{entry.costumeName}</span>
                      <span className="mt-0.5 block text-[10px] text-white/45">v{entry.versionNo}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {fitEditorOpen && (
        <CharacterImageFitEditor
          url={current.url}
          alt={current.name}
          background={current.background}
          fit={current.fit}
          onCommit={(next) => onFitCommit(current.costumeId, next)}
          onClose={() => setFitEditorOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}
