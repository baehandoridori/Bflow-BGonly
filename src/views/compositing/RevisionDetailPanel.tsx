// ─── 상세내용 패널 ────────────────────────

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  Circle,
  Check,
  X,
  FolderOpen,
  Undo2,
} from 'lucide-react';
import type { CompRevision, RevisionStatus } from '@/types';
import { formatDateTime } from '@/utils/formatTime';
import { STATUS_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { elevatedGlassStyle } from '@/utils/glassStyles';
import { useAuthStore } from '@/stores/useAuthStore';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { Avatar } from './sharedComponents';
import { parsePathsFromText, parseSceneKey } from './utils';
import type { SceneInfo } from './utils';
import { SceneJumpButton } from './SceneJumpButton';
import { RevisionCommentThread } from '@/components/scenes/RevisionCommentThread';

export function DetailPanel({
  revision,
  sceneInfo,
  onClose,
  onStatusChange,
}: {
  revision: CompRevision;
  sceneInfo: SceneInfo | null;
  onClose: () => void;
  onStatusChange: (status: RevisionStatus, note?: string) => void;
}) {
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const { description: descText, paths: detailPaths } = parsePathsFromText(revision.description);
  const allUsers = useAuthStore((s) => s.users);
  // v1.19.4: notifyUserIds 를 사용자 객체로 변환 (이름 + 컴포지터 라벨 표시)
  const notifyUsers = (revision.notifyUserIds ?? [])
    .map((uid) => allUsers.find((u) => u.id === uid))
    .filter((u): u is NonNullable<typeof u> => !!u);

  const handleResolve = () => {
    onStatusChange('resolved', resolveNote);
    setShowResolveNote(false);
    setResolveNote('');
  };

  const handleStatusSelect = (status: RevisionStatus) => {
    if (status === 'resolved') {
      setShowResolveNote(true);
      return;
    }
    onStatusChange(status);
  };

  const { sceneId } = parseSceneKey(revision.sceneKey);

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 380, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="shrink-0 border-l border-bg-border overflow-hidden h-full"
    >
      <div className="w-[380px] h-full overflow-y-auto bg-bg-primary/25">
        <div className="p-5">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">선택 피드백</h3>
              <p className="mt-0.5 text-[11px] text-text-secondary">
                {sceneInfo?.sceneId || sceneId}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-border/50 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* re# 라벨 + 상태 뱃지 + 씬 점프 */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <span className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded bg-accent/15 text-accent-sub font-mono font-bold border border-accent/30">
              {revisionNoToLabel(revision.revisionNo)}
            </span>
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5"
              style={{ color: STATUS_CONFIG[revision.status].color, backgroundColor: STATUS_CONFIG[revision.status].bg }}
            >
              <CompactIconLabel
                icon={
                  revision.status === 'open'
                    ? <Circle size={10} fill="currentColor" />
                    : revision.status === 'in_progress'
                      ? <Clock size={10} />
                      : <Check size={10} />
                }
                label={STATUS_CONFIG[revision.status].label}
              />
            </span>
            <SceneJumpButton
              sceneKey={revision.sceneKey}
              variant="link"
              episodeNumber={sceneInfo?.episodeNumber}
              partId={sceneInfo?.partId}
              sceneUuid={sceneInfo?.sceneUuid}
            />
          </div>

          {/* 요청자 정보 */}
          <div className="flex items-center gap-3 mb-5">
            <Avatar name={revision.requesterName} size={36} />
            <div>
              <p className="text-sm font-medium text-text-primary">{revision.requesterName}</p>
              <p className="text-[11px] text-text-secondary">{formatDateTime(revision.createdAt)}</p>
            </div>
          </div>

          {/* 설명 카드 */}
          <div
            className="rounded-xl p-4 mb-5 border border-bg-border/60"
            style={elevatedGlassStyle}
          >
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
              {descText || revision.description}
            </p>
            {detailPaths.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-bg-border/40">
                <span className="text-[10px] text-text-secondary/60 font-medium uppercase tracking-wider">경로</span>
                {detailPaths.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => window.electronAPI?.shellShowItem?.(p)}
                    className="flex items-center gap-1.5 text-xs font-mono rounded-lg px-2.5 py-1.5 text-left cursor-pointer transition-all hover:brightness-125"
                    style={revision.status === 'resolved'
                      ? { color: '#6B7280', backgroundColor: 'rgba(107, 114, 128, 0.08)', border: '1px solid rgba(107, 114, 128, 0.15)' }
                      : { color: '#74B9FF', backgroundColor: 'rgba(116, 185, 255, 0.08)', border: '1px solid rgba(116, 185, 255, 0.15)' }
                    }
                    title={`${p}\n(클릭하면 파일탐색기에서 열기)`}
                  >
                    <FolderOpen size={12} className="shrink-0" />
                    <span className="break-all">{p}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 이미지 */}
          {revision.imageUrl && (
            <div className="mb-5">
              <img
                src={revision.imageUrl}
                alt="첨부"
                className="rounded-xl max-h-48 w-full object-contain border border-bg-border/40"
              />
            </div>
          )}

          {/* 알림 받는 사람 — v1.19.4 신규 */}
          {notifyUsers.length > 0 && (
            <div className="mb-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                알림 받는 사람
              </div>
              <div className="flex flex-wrap gap-1.5">
                {notifyUsers.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-accent/10 border border-accent/30 text-[11px] text-text-primary"
                  >
                    <Avatar name={u.name} size={18} />
                    <span>{u.name}</span>
                    {u.isCompositor && (
                      <span className="text-[10px] text-text-secondary/70">컴포지터</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 메타 정보 */}
          <div className="space-y-3 mb-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">씬</span>
              <span className="text-xs font-bold text-text-primary">{sceneInfo?.sceneId || sceneId}</span>
            </div>
            {revision.assignee && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">담당</span>
                <span className="text-xs text-text-primary">{revision.assignee}</span>
              </div>
            )}
          </div>

          {/* 해결 정보 */}
          {revision.status === 'resolved' && (
            <div
              className="rounded-xl p-4 mb-5 border"
              style={{ borderColor: STATUS_CONFIG.resolved.color + '40', backgroundColor: STATUS_CONFIG.resolved.bg }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Check size={14} style={{ color: STATUS_CONFIG.resolved.color }} />
                  <span className="text-xs font-medium" style={{ color: STATUS_CONFIG.resolved.color }}>완료됨</span>
                </div>
                <button
                  onClick={() => onStatusChange('open')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-text-secondary hover:text-accent rounded-md hover:bg-accent/10 transition-all cursor-pointer"
                  title="대기로 되돌리기"
                >
                  <CompactIconLabel icon={<Undo2 size={11} />} label="되돌리기" />
                </button>
              </div>
              {revision.resolvedBy && (
                <p className="text-xs text-text-secondary mb-1">
                  {revision.resolvedBy} · {revision.resolvedAt ? formatDateTime(revision.resolvedAt) : ''}
                </p>
              )}
              {revision.resolvedNote && (
                <p className="text-xs text-text-primary">{revision.resolvedNote}</p>
              )}
            </div>
          )}

          {/* 해결 메모 입력 */}
          <AnimatePresence>
            {showResolveNote && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <textarea
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleResolve(); }
                    if (e.key === 'Escape') { setShowResolveNote(false); setResolveNote(''); }
                  }}
                  placeholder="완료 메모 (선택, Enter로 전송)"
                  className="w-full px-3 py-2 text-sm bg-bg-primary rounded-xl border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
                  rows={2}
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => { setShowResolveNote(false); setResolveNote(''); }}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleResolve}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg text-white cursor-pointer"
                    style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
                  >
                    완료
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 상태 변경 버튼 — 워크플로우 순서: 진행 시작(위) → 해결 완료(아래) */}
          {revision.status === 'open' && !showResolveNote && (
            <button
              onClick={() => handleStatusSelect('in_progress')}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-medium rounded-xl border transition-all cursor-pointer"
              style={{ borderColor: STATUS_CONFIG.in_progress.color + '40', color: STATUS_CONFIG.in_progress.color }}
            >
              <CompactIconLabel icon={<Clock size={14} />} label="진행 시작" />
            </button>
          )}
          {revision.status !== 'resolved' && !showResolveNote && (
            <button
              onClick={() => handleStatusSelect('resolved')}
              className={`w-full flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-xl text-white transition-all cursor-pointer hover:opacity-90${revision.status === 'open' ? ' mt-2' : ''}`}
              style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
            >
              <CompactIconLabel icon={<Check size={16} />} label="완료로 변경" />
            </button>
          )}

          {/* 리비전 댓글 스레드 — sceneInfo 가 있을 때만 (sheetName + sceneNo 필요).
              ⚠️ sceneNo (DB sort_order, 숫자) 사용. raw sceneId("a001" 등) 사용 시
              comment 저장 로직이 Number() 변환 후 sort_order 매칭 실패 → "씬을 찾을 수 없음" 에러
              (이슈: 2026-05-04 #2). UnifiedSceneDetailModal:134 의 primaryCommentKey 와 동일 패턴. */}
          {sceneInfo && (
            <div className="mt-5 pt-5 border-t border-bg-border/40">
              <RevisionCommentThread
                revisionId={revision.id}
                sceneKey={`${sceneInfo.sheetName}:${sceneInfo.sceneNo}`}
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
