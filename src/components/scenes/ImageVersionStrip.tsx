/**
 * v1.26.0 — 라이트박스 하단 이미지 버전 썸네일 스트립.
 *
 * 가로 스크롤 가능. 현재 버전 = 보더 강조 + "현재" 배지.
 * 주석 버전 = 우상단 노란 코너 표식.
 * 우측 끝 "+" 버튼 = 새 교체 버전 업로드.
 */

import { Plus } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { ImageVersion } from '@/types';

interface ImageVersionStripProps {
  versions: ImageVersion[];
  currentVersionId: string | null;
  onSelect: (versionId: string) => void;
  onAdd: () => void;
}

function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

export function ImageVersionStrip({
  versions,
  currentVersionId,
  onSelect,
  onAdd,
}: ImageVersionStripProps) {
  const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
  const current = sorted.find((v) => v.id === currentVersionId);

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 bg-bg-card border-t border-bg-border/40 overflow-x-auto">
      {sorted.map((v) => {
        const isCurrent = v.id === currentVersionId;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            className={cn(
              'relative flex-shrink-0 w-16 h-12 rounded-md overflow-hidden cursor-pointer transition-all duration-200',
              'border-2',
              isCurrent
                ? 'border-accent-sub ring-2 ring-accent/25'
                : 'border-transparent hover:-translate-y-0.5',
            )}
            style={{ backgroundImage: `url(${v.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            aria-label={`v${v.versionNo} ${v.kind === 'annotate' ? '주석' : '교체'} ${v.createdByName}`}
            title={`v${v.versionNo} · ${v.createdByName} · ${formatShortDateTime(v.createdAt)} · ${v.kind === 'annotate' ? '주석' : '교체'}`}
          >
            {/* 주석 버전 표시 — 우상단 노란 코너 */}
            {v.kind === 'annotate' && (
              <div
                className="absolute top-0 right-0 w-0 h-0"
                style={{
                  borderTop: '12px solid #FDCB6E',
                  borderLeft: '12px solid transparent',
                }}
                aria-hidden
              />
            )}
            {isCurrent && (
              <span className="absolute top-0.5 left-0.5 bg-accent-sub text-bg-primary text-[8px] font-bold tracking-wider px-1 rounded">
                현재
              </span>
            )}
            <span className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[9px] font-semibold px-1 rounded">
              v{v.versionNo}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="flex-shrink-0 w-12 h-12 rounded-md border border-dashed border-bg-border text-text-secondary hover:border-accent/70 hover:text-accent-sub flex items-center justify-center transition-all"
        aria-label="버전 추가"
        title="새 이미지로 교체 (v 추가)"
      >
        <Plus size={22} />
      </button>
      {current && (
        <div className="ml-auto flex-shrink-0 text-right text-[11px] text-text-secondary">
          <strong className="block text-text-primary">v{current.versionNo} · {current.createdByName}</strong>
          <span>{formatShortDateTime(current.createdAt)} · {current.kind === 'annotate' ? '주석' : '교체'}</span>
        </div>
      )}
    </div>
  );
}
