/**
 * v1.26.0 — 라이트박스 좌상단 이미지 버전 드롭다운.
 *
 * 닫힌 상태: 현재 버전 칩.
 * 열린 상태: 모든 버전 목록 (작성자/시간/타입) + 본인/관리자만 삭제 버튼.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { ImageVersion } from '@/types';
import { canDeleteVersion } from '@/utils/imageVersionUtils';

interface ImageVersionDropdownProps {
  versions: ImageVersion[];
  currentVersionId: string | null;
  currentUserId: string | null;
  isAdmin: boolean;
  onSelect: (versionId: string) => void;
  onDelete: (versionId: string) => void;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ImageVersionDropdown({
  versions,
  currentVersionId,
  currentUserId,
  isAdmin,
  onSelect,
  onDelete,
}: ImageVersionDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const onlyOne = versions.length === 1;
  const current = versions.find((v) => v.id === currentVersionId);
  const sorted = [...versions].sort((a, b) => b.versionNo - a.versionNo);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (versions.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 bg-bg-card/90 backdrop-blur border border-bg-border/60 rounded-lg text-xs text-text-primary hover:border-accent/50 transition-colors"
      >
        {current && (
          <>
            <span className="bg-accent/25 text-accent-sub px-1.5 py-0.5 rounded text-[11px] font-semibold">
              v{current.versionNo}
            </span>
            <span>현재 · {current.createdByName} · {formatShortDate(current.createdAt)}</span>
          </>
        )}
        <ChevronDown size={14} className={cn('text-text-secondary transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 w-64 bg-bg-card border border-bg-border rounded-lg p-1 shadow-2xl z-30">
          {sorted.map((v) => {
            const isCurrent = v.id === currentVersionId;
            const deletable = canDeleteVersion(v, currentUserId, isAdmin, onlyOne);
            return (
              <div
                key={v.id}
                className={cn(
                  'group flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors',
                  isCurrent ? 'bg-accent/15' : 'hover:bg-bg-border/50',
                )}
                onClick={() => {
                  onSelect(v.id);
                  setOpen(false);
                }}
              >
                <div
                  className="w-10 h-7 rounded flex-shrink-0 bg-cover bg-center bg-bg-border"
                  style={{ backgroundImage: `url(${v.url})` }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                    v{v.versionNo}
                    {v.kind === 'annotate' && (
                      <span className="text-[9px] px-1 rounded bg-stage-review/30 text-stage-review font-bold">주석</span>
                    )}
                    {v.kind === 'replace' && (
                      <span className="text-[9px] px-1 rounded bg-stage-lo/30 text-stage-lo font-bold">교체</span>
                    )}
                    {isCurrent && (
                      <span className="text-[9px] px-1 rounded bg-accent-sub text-bg-primary font-bold">표시</span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-secondary/70 mt-0.5">
                    {v.createdByName} · {formatShortDate(v.createdAt)}
                  </div>
                  {v.description && (
                    <div className="text-[11px] text-text-secondary mt-0.5 line-clamp-2" title={v.description}>
                      {v.description}
                    </div>
                  )}
                </div>
                {deletable && (
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-80 hover:opacity-100 text-red-400 p-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`v${v.versionNo} 버전을 삭제할까요? 되돌릴 수 없습니다.`)) onDelete(v.id);
                    }}
                    aria-label={`v${v.versionNo} 삭제`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
