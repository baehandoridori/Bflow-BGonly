// ─── 리비전 아이템 (확장된 씬 내부) ──────────

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Undo2 } from 'lucide-react';
import type { CompRevision, RevisionStatus } from '@/types';
import { STATUS_CONFIG } from '@/constants/revision';
import { PathBadge } from '@/components/common/PathBadge';
import { Avatar, PriorityBadge, StatusDropdown } from './sharedComponents';
import { parsePathsFromText } from './utils';

export function RevisionItem({
  revision,
  isSelected,
  onSelect,
  onStatusChange,
}: {
  revision: CompRevision;
  isSelected: boolean;
  onSelect: () => void;
  onStatusChange: (status: RevisionStatus, note?: string) => void;
}) {
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const isResolved = revision.status === 'resolved';
  const { description: descText, paths } = parsePathsFromText(revision.description);

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
      className={`relative flex items-start gap-3 pl-10 pr-4 py-2.5 rounded-lg transition-colors group cursor-pointer ${
        isSelected ? 'bg-accent/[0.08]' : 'hover:bg-bg-border/10'
      }`}
    >
      {/* 트리 가지 (가로 커넥터) */}
      <div
        className="absolute left-[22px] top-[18px] w-3 h-px bg-bg-border/50"
      />

      {/* 요청자 아바타 */}
      <Avatar name={revision.requesterName} size={28} />

      {/* 상태 도트 */}
      <div className="mt-2.5 shrink-0">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: STATUS_CONFIG[revision.status].color }}
        />
      </div>

      {/* 설명 */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-relaxed ${
            isResolved ? 'line-through text-text-secondary/50' : 'text-text-primary'
          }`}
        >
          {descText || revision.description}
        </p>

        {/* 경로 뱃지 */}
        {paths.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {paths.map((p, i) => <PathBadge key={i} path={p} resolved={isResolved} />)}
          </div>
        )}

        {/* 해결 메모 */}
        {isResolved && revision.resolvedNote && (
          <p className="text-xs text-text-secondary/50 mt-0.5">
            → {revision.resolvedNote}
          </p>
        )}

        {/* 해결 메모 입력 */}
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
                placeholder="해결 메모 (선택, Enter로 전송)"
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
                  해결
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 프레임 번호 */}
      {revision.frameNo && (
        <span className="shrink-0 text-[11px] text-text-secondary/60 font-mono mt-0.5">
          {revision.frameNo}
        </span>
      )}

      {/* 상태 변경 */}
      {!isResolved ? (
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <StatusDropdown currentStatus={revision.status} onSelect={handleStatusSelect} />
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); handleStatusSelect('open'); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-1 text-[11px] text-text-secondary hover:text-accent rounded-md hover:bg-accent/10 transition-all cursor-pointer"
          title="되돌리기"
        >
          <Undo2 size={11} />
          되돌리기
        </button>
      )}

      {/* 우선순위 뱃지 */}
      <div className="shrink-0">
        <PriorityBadge priority={revision.priority} />
      </div>
    </motion.div>
  );
}
