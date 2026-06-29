import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Copy, Move, X } from 'lucide-react';
import type { CharacterImageBackground, CharacterImageFit } from '@/types';
import { CharacterImageFrame } from './CharacterImageFrame';
import { CharacterImageFitEditor } from './CharacterImageFitEditor';

export interface CharacterImageLightboxEntry {
  costumeId: string;
  name: string;
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
            <div className="truncate text-base font-semibold">{current.name}</div>
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
