import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { FolderOpen, X } from 'lucide-react';
import { shortenPath } from '@/utils/pathLink';

/**
 * TipTap PathLink Node 의 React 렌더러.
 *
 * - PathBadge(textarea/리테이크) 와 동일한 청색 박스 외관
 * - 짧은 이름만 표시 (full path 는 hover title)
 * - 우측 X 버튼으로 노드 삭제 (deleteNode)
 * - 박스 본체 클릭 → window.electronAPI.shellShowItem 으로 파일탐색기 열기
 */
export function PathLinkNodeView({ node, deleteNode }: NodeViewProps) {
  const path = node.attrs.href as string;

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (path) window.electronAPI?.shellShowItem?.(path);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteNode();
  };

  return (
    <NodeViewWrapper
      as="span"
      className="path-link-node-wrap"
      contentEditable={false}
    >
      <span
        className="inline-flex items-center gap-1 text-[11px] font-mono rounded px-1.5 py-0.5 max-w-full cursor-pointer transition-all hover:brightness-125 align-middle"
        style={{
          color: '#74B9FF',
          backgroundColor: 'rgba(116, 185, 255, 0.1)',
          border: '1px solid rgba(116, 185, 255, 0.2)',
        }}
        title={`${path}\n(클릭하면 파일탐색기에서 열기)`}
        onClick={handleOpen}
      >
        <FolderOpen size={10} className="shrink-0" />
        <span className="truncate max-w-[240px]">{shortenPath(path)}</span>
        <button
          type="button"
          onClick={handleRemove}
          onMouseDown={(e) => e.preventDefault()}
          className="ml-0.5 -mr-1 p-[1px] rounded hover:bg-red-500/25 hover:text-red-300 transition-colors cursor-pointer"
          title="이 경로 삭제"
          aria-label="경로 삭제"
        >
          <X size={10} />
        </button>
      </span>
    </NodeViewWrapper>
  );
}
