// ─── 리비전 아이템 (확장된 씬 내부) ──────────

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, MessageSquarePlus, Undo2, UserRound } from 'lucide-react';
import type { CompRevision, RevisionStatus } from '@/types';
import { STATUS_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { PathBadge } from '@/components/common/PathBadge';
import { useAuthStore } from '@/stores/useAuthStore';
import { StatusDropdown } from './sharedComponents';
import { parsePathsFromText } from './utils';
import { RevisionCommentMarker } from './RevisionCommentMarker';

const STATUS_TINT: Record<RevisionStatus, { background: string; halo: string }> = {
  open: {
    background: 'linear-gradient(90deg, rgba(253, 203, 110, 0.13) 0%, rgba(253, 203, 110, 0.045) 42%, rgba(253, 203, 110, 0) 88%)',
    halo: 'rgba(253, 203, 110, 0.18)',
  },
  in_progress: {
    background: 'linear-gradient(90deg, rgba(116, 185, 255, 0.13) 0%, rgba(116, 185, 255, 0.045) 42%, rgba(116, 185, 255, 0) 88%)',
    halo: 'rgba(116, 185, 255, 0.18)',
  },
  resolved: {
    background: 'linear-gradient(90deg, rgba(0, 184, 148, 0.075) 0%, rgba(0, 184, 148, 0.028) 42%, rgba(0, 184, 148, 0) 88%)',
    halo: 'rgba(0, 184, 148, 0.12)',
  },
};

export function RevisionItem({
  revision,
  isSelected,
  commentCount = 0,
  commentSeen = false,
  onSelect,
  onStatusChange,
}: {
  revision: CompRevision;
  isSelected: boolean;
  /** v1.19.6: 이 리비전에 달린 댓글 개수. 0 이면 마커 표시 안 함. */
  commentCount?: number;
  /** 확인한 댓글은 회색 마커로 낮춰 보인다. */
  commentSeen?: boolean;
  onSelect: () => void;
  onStatusChange: (status: RevisionStatus, note?: string) => void;
}) {
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const isResolved = revision.status === 'resolved';
  const isInProgress = revision.status === 'in_progress';
  const statusCfg = STATUS_CONFIG[revision.status];
  const statusTint = STATUS_TINT[revision.status];
  const { description: descText, paths } = parsePathsFromText(revision.description);
  const allUsers = useAuthStore((s) => s.users);
  // v1.19.4: notifyUserIds → 사용자 이름 배열 (AvatarStack 용)
  const notifyNames = useMemo(
    () =>
      (revision.notifyUserIds ?? [])
        .map((uid) => allUsers.find((u) => u.id === uid)?.name)
        .filter((n): n is string => !!n),
    [revision.notifyUserIds, allUsers],
  );

  const handleStatusSelect = (status: RevisionStatus) => {
    if (status === 'resolved') {
      setShowResolveNote(true);
      return;
    }
    onStatusChange(status);
  };

  const handleResolve = () => {
    onStatusChange('resolved', resolveNote);
    setShowResolveNote(false);
    setResolveNote('');
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.2 }}
      onClick={onSelect}
      data-revision-status={revision.status}
      className={`relative flex items-start gap-3 pl-10 pr-4 py-2.5 rounded-lg border border-bg-border/35 bg-bg-primary/20 transition-all duration-200 group cursor-pointer overflow-hidden ${
        isSelected ? 'ring-1 ring-accent/25 bg-bg-border/10' : 'hover:bg-bg-border/10'
      }`}
    >
      <div
        className="pointer-events-none absolute inset-[1px] rounded-[7px]"
        style={{
          background: statusTint.background,
          boxShadow: `inset 0 0 0 1px ${statusTint.halo}`,
        }}
      />

      {/* 트리 가지 (가로 커넥터) */}
      <div
        className="absolute left-[22px] top-[18px] w-3 h-px bg-bg-border/45"
      />

      {/* 요청자 아바타 */}
      <div className="relative z-[1] shrink-0">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent-sub"
          title={`요청자: ${revision.requesterName}`}
          aria-label={`요청자: ${revision.requesterName}`}
        >
          <MessageSquarePlus size={13} strokeWidth={2.4} />
        </div>
      </div>

      {/* 썸네일 영역 (이미지 있으면 표시, 없으면 placeholder) */}
      {revision.imageUrl ? (
        <div className="relative z-[1] shrink-0 w-20 h-14 rounded overflow-hidden">
          <img
            src={revision.imageUrl}
            className={`w-full h-full object-cover ${isResolved ? 'opacity-60' : ''}`}
            alt=""
          />
        </div>
      ) : (
        <div className="relative z-[1] shrink-0 w-20 h-14 rounded border border-dashed border-bg-border/40 flex items-center justify-center text-text-secondary/40">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5-11 11" />
          </svg>
        </div>
      )}

      {/* 설명 */}
      <div className="relative z-[1] flex-1 min-w-0">
        {/* re# 라벨 + 본문 */}
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-[11px] font-mono font-bold shrink-0 ${
              isResolved ? 'text-text-secondary/50' : 'text-accent-sub'
            }`}
          >
            {revisionNoToLabel(revision.revisionNo)}
          </span>
          <p
            className={`text-sm leading-relaxed ${
              isResolved ? 'line-through text-text-secondary/50' : 'text-text-primary'
            }`}
          >
            {descText || revision.description}
          </p>
        </div>

        {/* 경로 뱃지 */}
        {paths.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {paths.map((p, i) => <PathBadge key={i} path={p} resolved={isResolved} />)}
          </div>
        )}

        {/* 메타 라인 — v1.19.4: 알림 대상 / v1.19.6: 댓글 카운트 마커 */}
        <div
          className={`flex items-center gap-3 mt-1 flex-wrap ${isResolved ? 'opacity-50' : ''}`}
        >
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 shrink-0"
            style={{ color: STATUS_CONFIG[revision.status].color, backgroundColor: STATUS_CONFIG[revision.status].bg }}
          >
            <CompactIconLabel icon={<Bell size={10} strokeWidth={2.2} />} label={statusCfg.label} />
          </span>
          {isInProgress && (
            <button
              onClick={(e) => { e.stopPropagation(); onStatusChange('open'); }}
              className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 text-text-secondary/70 bg-bg-primary/45 border border-bg-border/35 hover:text-accent-sub hover:border-accent/35 hover:bg-accent/10 transition-colors cursor-pointer"
              title="대기 상태로 되돌리기"
              aria-label="대기 상태로 되돌리기"
            >
              <CompactIconLabel icon={<Undo2 size={10} />} label="되돌리기" />
            </button>
          )}
          <RevisionCommentMarker count={commentCount} seen={commentSeen} />
          {revision.assignee && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 text-text-secondary/70 bg-bg-primary/40 border border-bg-border/35"
              title={`담당: ${revision.assignee}`}
            >
              <CompactIconLabel icon={<UserRound size={10} />} label="담당" />
            </span>
          )}
          {notifyNames.length > 0 && (
            <div
              className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 text-text-secondary/65 bg-bg-primary/35 border border-bg-border/30"
              title={`알림 대상: ${notifyNames.join(', ')}`}
            >
              <CompactIconLabel icon={<Bell size={10} className="shrink-0" />} label={`알림 ${notifyNames.length}`} />
            </div>
          )}
        </div>

        {/* 완료 메모 */}
        {isResolved && revision.resolvedNote && (
          <p className="text-xs text-text-secondary/50 mt-0.5">
            → {revision.resolvedNote}
          </p>
        )}

        {/* 완료 메모 입력 */}
        <AnimatePresence>
          {showResolveNote && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden"
            >
              <textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleResolve(); }
                  if (e.key === 'Escape') { setShowResolveNote(false); setResolveNote(''); }
                }}
                placeholder="완료 메모 (선택, Enter로 전송)"
                className="w-full px-3 py-1.5 text-xs bg-bg-primary rounded-lg border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
                rows={2}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex justify-end gap-2 mt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowResolveNote(false); setResolveNote(''); }}
                  className="text-[11px] text-text-secondary hover:text-text-primary cursor-pointer"
                >
                  취소
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleResolve(); }}
                  className="text-[11px] px-2.5 py-1 rounded-md text-white cursor-pointer"
                  style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
                >
                  완료
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 상태 변경 (호버 시 노출) */}
      {!isResolved ? (
        <div className="relative z-[1] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <StatusDropdown currentStatus={revision.status} onSelect={handleStatusSelect} />
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); handleStatusSelect('open'); }}
          className="relative z-[1] shrink-0 opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-1 text-[11px] text-text-secondary hover:text-accent rounded-md hover:bg-accent/10 transition-all cursor-pointer"
          title="되돌리기"
        >
          <CompactIconLabel icon={<Undo2 size={11} />} label="되돌리기" />
        </button>
      )}
    </motion.div>
  );
}
