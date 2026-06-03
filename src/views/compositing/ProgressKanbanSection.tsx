// ─── 진행률별 칸반 뷰 (v1.19.0) ─────────
//
// 3컬럼 grid (대기 / 진행중 / 완료). 각 컬럼에 미니 카드.
// mockup `revision-board-v3.html` view-progress 섹션 참조.

import { useMemo } from 'react';
import { Circle, MessageSquareText } from 'lucide-react';
import type { CompRevision } from '@/types';
import { STATUS_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { formatTimeShort } from '@/utils/formatTime';
import { parseSceneKey } from './utils';
import type { SceneInfo } from './utils';
import { RevisionCommentMarker } from './RevisionCommentMarker';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';

// ─── 메인 컴포넌트 ──────────

export function ProgressKanbanSection({
  revisions,
  sceneInfoMap,
  selectedRevisionId,
  commentCountByRev,
  commentSeenByRev,
  onSelectRevision,
}: {
  revisions: CompRevision[];
  sceneInfoMap: Map<string, SceneInfo>;
  selectedRevisionId: string | null;
  /** v1.19.7: revisionId → 댓글 개수. 0 이면 마커 표시 안 함. 씬별 모드와 일관 유지. */
  commentCountByRev?: Map<string, number>;
  /** revisionId → 현재 사용자가 댓글을 확인했는지 여부. */
  commentSeenByRev?: Map<string, boolean>;
  onSelectRevision: (rev: CompRevision) => void;
}) {
  const byStatus = useMemo(() => ({
    open: revisions.filter((r) => r.status === 'open'),
    in_progress: revisions.filter((r) => r.status === 'in_progress'),
    resolved: revisions.filter((r) => r.status === 'resolved'),
  }), [revisions]);

  return (
    <div className="grid grid-cols-3 gap-3 px-6 pb-6">
      <KanbanColumn
        title="대기"
        statusKey="open"
        revisions={byStatus.open}
        sceneInfoMap={sceneInfoMap}
        selectedRevisionId={selectedRevisionId}
        commentCountByRev={commentCountByRev}
        commentSeenByRev={commentSeenByRev}
        onSelectRevision={onSelectRevision}
      />
      <KanbanColumn
        title="진행중"
        statusKey="in_progress"
        revisions={byStatus.in_progress}
        sceneInfoMap={sceneInfoMap}
        selectedRevisionId={selectedRevisionId}
        commentCountByRev={commentCountByRev}
        commentSeenByRev={commentSeenByRev}
        onSelectRevision={onSelectRevision}
      />
      <KanbanColumn
        title="완료"
        statusKey="resolved"
        revisions={byStatus.resolved}
        sceneInfoMap={sceneInfoMap}
        selectedRevisionId={selectedRevisionId}
        commentCountByRev={commentCountByRev}
        commentSeenByRev={commentSeenByRev}
        onSelectRevision={onSelectRevision}
      />
    </div>
  );
}

// ─── 컬럼 ──────────

function KanbanColumn({
  title,
  statusKey,
  revisions,
  sceneInfoMap,
  selectedRevisionId,
  commentCountByRev,
  commentSeenByRev,
  onSelectRevision,
}: {
  title: string;
  statusKey: 'open' | 'in_progress' | 'resolved';
  revisions: CompRevision[];
  sceneInfoMap: Map<string, SceneInfo>;
  selectedRevisionId: string | null;
  commentCountByRev?: Map<string, number>;
  commentSeenByRev?: Map<string, boolean>;
  onSelectRevision: (rev: CompRevision) => void;
}) {
  const statusCfg = STATUS_CONFIG[statusKey];
  return (
    <div className="bg-bg-primary/35 rounded-xl p-3 space-y-2 min-h-[200px]">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="compact-label-container text-[12px] font-bold text-text-primary flex min-w-0 items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusCfg.color }} />
          <CompactIconLabel icon={<Circle size={11} strokeWidth={2.4} />} label={title} />
        </h3>
        <span className="text-[10px] text-text-secondary/70">{revisions.length}</span>
      </div>

      {revisions.length === 0 ? (
        <p className="text-[11px] text-text-secondary/40 text-center py-6">없음</p>
      ) : (
        revisions.map((rev) => (
          <KanbanCard
            key={rev.id}
            rev={rev}
            sceneInfo={sceneInfoMap.get(rev.sceneKey) ?? null}
            isSelected={rev.id === selectedRevisionId}
            isResolved={statusKey === 'resolved'}
            commentCount={commentCountByRev?.get(rev.id) ?? 0}
            commentSeen={commentSeenByRev?.get(rev.id) ?? false}
            onSelect={() => onSelectRevision(rev)}
          />
        ))
      )}
    </div>
  );
}

// ─── 카드 ──────────

function KanbanCard({
  rev,
  sceneInfo,
  isSelected,
  isResolved,
  commentCount = 0,
  commentSeen = false,
  onSelect,
}: {
  rev: CompRevision;
  sceneInfo: SceneInfo | null;
  isSelected: boolean;
  isResolved: boolean;
  /** v1.19.7: 댓글 개수 마커 — 씬별 모드와 일관 유지. */
  commentCount?: number;
  commentSeen?: boolean;
  onSelect: () => void;
}) {
  // 씬 라벨: "EP01 A 1" 형태
  const sceneLabel = useMemo(() => {
    if (sceneInfo) {
      const epNum = sceneInfo.episodeNumber ?? 0;
      const partId = sceneInfo.partId ?? sceneInfo.part;
      return `EP${String(epNum).padStart(2, '0')} ${partId} ${sceneInfo.sceneId}`;
    }
    const parsed = parseSceneKey(rev.sceneKey);
    return `${parsed.ep} ${parsed.part} ${parsed.sceneId}`.trim();
  }, [sceneInfo, rev.sceneKey]);

  return (
    <button
      onClick={onSelect}
      className={`relative w-full text-left bg-bg-card border border-bg-border/40 rounded-lg overflow-hidden transition-colors group cursor-pointer ${
        isSelected ? 'border-accent/60' : 'hover:border-accent/40'
      } ${isResolved ? 'opacity-70' : ''}`}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: isResolved ? STATUS_CONFIG.resolved.color : 'rgb(var(--color-accent, 108 92 231))' }}
      />
      <div className="ml-1 p-2.5 flex gap-2">
        {/* 썸네일 영역 */}
        {rev.imageUrl ? (
          <div className="shrink-0 w-14 h-10 rounded overflow-hidden">
            <img
              src={rev.imageUrl}
              className={`w-full h-full object-cover ${isResolved ? 'opacity-60' : ''}`}
              alt=""
            />
          </div>
        ) : (
          <div className="shrink-0 w-14 h-10 rounded border border-dashed border-bg-border/40 flex items-center justify-center text-text-secondary/40">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5-11 11" />
            </svg>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] px-1 py-0.5 rounded bg-accent/15 text-accent-sub font-mono font-bold truncate max-w-[160px]">
              {sceneLabel}
            </span>
            <span className={`compact-label-container inline-flex min-w-0 shrink text-[10px] font-bold ${isResolved ? 'text-text-secondary/60' : 'text-accent-sub'}`}>
              <CompactIconLabel icon={<MessageSquareText size={10} strokeWidth={2.4} />} label={revisionNoToLabel(rev.revisionNo)} />
            </span>
            <RevisionCommentMarker
              count={commentCount}
              seen={commentSeen}
              size="compact"
              className={`ml-auto ${isResolved ? 'opacity-70' : ''}`}
            />
          </div>
          <div
            className={`text-[11.5px] line-clamp-2 ${isResolved ? 'line-through text-text-secondary/60' : 'text-text-primary'}`}
          >
            {rev.description}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-text-secondary/70 mt-1">
            <span title={`요청자: ${rev.requesterName}`}>요청 · {formatTimeShort(rev.createdAt)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}
