import { FolderOpen } from 'lucide-react';
import { shortenPath } from '@/utils/pathLink';

interface PathBadgeProps {
  path: string;
  /** CompositingView 전용 — 해결된 리테이크 경로 회색 처리. 메모/댓글/메모위젯 사용처에선 항상 false. */
  resolved?: boolean;
  className?: string;
}

/**
 * G:\ 경로를 클릭 가능한 뱃지로 표시. 클릭 시 파일 탐색기에서 해당 경로 열기.
 *
 * 4곳에서 재사용: 메모(InlineTextareaRow) / 댓글(CommentPanel) / 메모 위젯(TipTap) / 리테이크(CompositingView).
 * 외관·동작은 한 곳에서 정의해 일관성 + 유지보수성 확보.
 */
export function PathBadge({ path, resolved, className }: PathBadgeProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.electronAPI?.shellShowItem?.(path);
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 text-[11px] font-mono rounded px-1.5 py-0.5 max-w-full cursor-pointer transition-all hover:brightness-125 ${className ?? ''}`}
      style={
        resolved
          ? { color: '#6B7280', backgroundColor: 'rgba(107, 114, 128, 0.1)', border: '1px solid rgba(107, 114, 128, 0.2)' }
          : { color: '#74B9FF', backgroundColor: 'rgba(116, 185, 255, 0.1)', border: '1px solid rgba(116, 185, 255, 0.2)' }
      }
      title={`${path}\n(클릭하면 파일탐색기에서 열기)`}
    >
      <FolderOpen size={10} className="shrink-0" />
      <span className="truncate">{shortenPath(path)}</span>
    </button>
  );
}
