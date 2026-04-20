import { useState, useEffect, useCallback, useRef } from 'react';
import { toast as sonnerToast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Pencil,
  Check,
  ImagePlus,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronRight,
  Plus,
  Film,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Scene, Stage, Department } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';
import { resizeBlob } from '@/utils/imageUtils';
import { ImageModal } from './ImageModal';
import { CommentPanel } from './CommentPanel';
import { RevisionPanel } from './RevisionPanel';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { buildSceneKey } from '@/services/revisionService';

/**
 * 전체 뷰(BG+ACT 통합) 전용 상세 모달.
 * 단독 SceneDetailModal 과 동일한 레이아웃 (본체 + 우측 댓글 + 우측 리비전 토글).
 * 본체만 좌/우 BG/ACT 분할 + 하단 도트 네비.
 */

export interface UnifiedSceneDetailModalProps {
  merged: MergedScene;
  bgSheetName: string | null;
  actSheetName: string | null;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onFieldUpdate: (sheetName: string, sceneIndex: number, field: string, value: string) => void;
  onDeleteDept: (sheetName: string, sceneIndex: number) => void;
  onDeleteBoth: () => void;
  onAddDept: (dept: Department) => void;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  currentMergedIndex?: number;
  totalMerged?: number;
  partLabel?: string;
  episodeLabel?: string;
}

export function UnifiedSceneDetailModal({
  merged,
  bgSheetName,
  actSheetName,
  onToggle,
  onFieldUpdate,
  onDeleteDept,
  onDeleteBoth,
  onAddDept,
  onClose,
  onNavigate,
  hasPrev = false,
  hasNext = false,
  currentMergedIndex = 0,
  totalMerged = 0,
  partLabel,
  episodeLabel,
}: UnifiedSceneDetailModalProps) {
  const { bgScene, actScene, bgSceneIndex, actSceneIndex } = merged;
  const headScene = bgScene ?? actScene;

  // 댓글 키: BG와 ACT 양쪽 조회 가능하게
  const primarySheet = bgSheetName ?? actSheetName ?? '';
  const primaryScene = bgScene ?? actScene;
  const primaryCommentKey = primaryScene && primarySheet ? `${primarySheet}:${primaryScene.no}` : '';
  const secondarySheet = bgSheetName && actSheetName && bgScene && actScene ? actSheetName : null;
  const secondaryScene = bgSheetName && actSheetName && bgScene && actScene ? actScene : null;
  const secondaryCommentKey = secondarySheet && secondaryScene ? `${secondarySheet}:${secondaryScene.no}` : '';

  // 리비전 키 — buildSceneKey 가 부서 구분 없이 EP:Part:sceneId 로 해싱되므로 BG/ACT 공용
  const revisionSheetName = primarySheet;
  const revisionSceneId = primaryScene?.sceneId ?? '';
  const revisionSceneKey = revisionSheetName && revisionSceneId ? buildSceneKey(revisionSheetName, revisionSceneId) : '';
  const openRevCount = useRevisionStore((s) => revisionSceneKey ? s.getOpenCount(revisionSceneKey) : 0);

  // UI state
  const [commentCount, setCommentCount] = useState(0);
  const [revisionCount, setRevisionCount] = useState(0);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showImageModal, setShowImageModal] = useState<null | 'storyboard' | 'guide'>(null);
  const [imageLoading, setImageLoading] = useState<null | 'storyboard' | 'guide'>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<null | 'storyboard' | 'guide' | 'bg' | 'act' | 'both'>(null);
  const [previewUrls, setPreviewUrls] = useState<{ storyboard?: string; guide?: string }>({});
  const addingRef = useRef<{ bg: boolean; acting: boolean }>({ bg: false, acting: false });

  // ESC 닫기 + 좌우 화살표
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showImageModal) { setShowImageModal(null); return; }
        if (deleteConfirm) { setDeleteConfirm(null); return; }
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (showImageModal) return;
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate?.('prev');
      if (e.key === 'ArrowRight' && hasNext) onNavigate?.('next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNavigate, hasPrev, hasNext, showImageModal, deleteConfirm]);

  // Ctrl+V 이미지 붙여넣기 (BG 만)
  useEffect(() => {
    if (!bgScene || !bgSheetName) return;
    const onPaste = async (e: ClipboardEvent) => {
      if (showImageModal) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const imageType: 'storyboard' | 'guide' = !bgScene.storyboardUrl ? 'storyboard' : 'guide';
          await uploadImage(blob, imageType);
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgScene?.storyboardUrl, bgScene?.guideUrl, bgSheetName, showImageModal]);

  const uploadImage = useCallback(async (blob: Blob, imageType: 'storyboard' | 'guide') => {
    if (!bgScene || !bgSheetName) {
      sonnerToast.error('BG 씬이 없어 이미지를 저장할 수 없습니다.');
      return;
    }
    try {
      setImageLoading(imageType);
      const base64 = await resizeBlob(blob);
      setPreviewUrls((prev) => ({ ...prev, [imageType]: base64 }));
      const { saveImage: si } = await import('@/utils/imageUtils');
      const url = await si(
        base64,
        bgSheetName,
        bgScene.sceneId || String(bgScene.no),
        imageType,
      );
      const field = imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
      onFieldUpdate(bgSheetName, bgSceneIndex, field, url);
      setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
    } catch (err) {
      console.error('[UnifiedSceneDetailModal] 이미지 업로드 실패', err);
      setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
      sonnerToast.error(`이미지 저장 실패: ${err instanceof Error ? err.message : err}`);
    } finally {
      setImageLoading(null);
    }
  }, [bgScene, bgSheetName, bgSceneIndex, onFieldUpdate]);

  const pickFile = useCallback((imageType: 'storyboard' | 'guide') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) uploadImage(file, imageType);
    };
    input.click();
  }, [uploadImage]);

  const removeImage = useCallback((imageType: 'storyboard' | 'guide') => {
    if (!bgScene || !bgSheetName) return;
    const field = imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
    onFieldUpdate(bgSheetName, bgSceneIndex, field, '');
    setDeleteConfirm(null);
  }, [bgScene, bgSheetName, bgSceneIndex, onFieldUpdate]);

  const handleAddDept = useCallback(async (dept: Department) => {
    if (addingRef.current[dept]) return;
    addingRef.current[dept] = true;
    try {
      await Promise.resolve(onAddDept(dept));
    } finally {
      setTimeout(() => { addingRef.current[dept] = false; }, 800);
    }
  }, [onAddDept]);

  if (!headScene) return null;

  const sceneNoDisplay = headScene.sceneId?.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(headScene.no);
  const showSceneDots = totalMerged > 0 && totalMerged <= 80;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        {/* ── flex 래퍼 — 본체 + 리비전 패널 + 댓글 ── */}
        <div className="flex gap-3 items-stretch max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
          {/* ── 본체 (좌 BG + 우 ACT) ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-[min(1000px,calc(100vw-26rem))] max-h-[90vh] flex flex-col bg-bg-card border border-bg-border rounded-2xl shadow-2xl"
          >
            {/* 헤더 */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-bg-border/40 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-mono text-text-secondary/50">#{sceneNoDisplay}</span>
                <span className="text-lg font-mono font-bold text-text-primary truncate">
                  {headScene.sceneId || '(씬번호 없음)'}
                </span>
                {headScene.layoutId && (
                  <span className="text-xs italic text-text-secondary/50 shrink-0">L#{headScene.layoutId}</span>
                )}
                {(episodeLabel || partLabel) && (
                  <span className="text-xs text-text-secondary/50 shrink-0">
                    {[episodeLabel, partLabel].filter(Boolean).join(' / ')}
                  </span>
                )}
              </div>

              {/* 네비게이션 */}
              {(hasPrev || hasNext) && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => onNavigate?.('prev')}
                    disabled={!hasPrev}
                    className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-border/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    title="이전 씬"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs text-text-secondary/60 tabular-nums min-w-[3.5rem] text-center">
                    {currentMergedIndex + 1} / {totalMerged}
                  </span>
                  <button
                    onClick={() => onNavigate?.('next')}
                    disabled={!hasNext}
                    className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-border/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    title="다음 씬"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}

              {(bgScene || actScene) && (
                <button
                  onClick={() => setDeleteConfirm('both')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] font-medium hover:bg-red-500/20 cursor-pointer transition-colors shrink-0',
                    !(hasPrev || hasNext) && 'ml-auto',
                  )}
                  title="BG+ACT 모두 삭제"
                >
                  <Trash2 size={11} />
                  씬 삭제
                </button>
              )}

              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer transition-colors shrink-0"
                title="닫기"
              >
                <X size={16} />
              </button>
            </div>

            {/* 본체: 스크롤 영역 */}
            <div className="flex-1 overflow-auto min-h-0">
              {/* 이미지 공통 (BG 기준) */}
              {primaryScene && (
                <div className="grid grid-cols-2 gap-3 px-5 pt-4 pb-2">
                  <UnifiedImageSlot
                    label="스토리보드"
                    url={previewUrls.storyboard ?? bgScene?.storyboardUrl ?? ''}
                    loading={imageLoading === 'storyboard'}
                    canEdit={!!bgScene && !!bgSheetName}
                    onPick={() => pickFile('storyboard')}
                    onRemove={() => setDeleteConfirm('storyboard')}
                    onView={() => setShowImageModal('storyboard')}
                    onDropBlob={(b) => uploadImage(b, 'storyboard')}
                  />
                  <UnifiedImageSlot
                    label="가이드"
                    url={previewUrls.guide ?? bgScene?.guideUrl ?? ''}
                    loading={imageLoading === 'guide'}
                    canEdit={!!bgScene && !!bgSheetName}
                    onPick={() => pickFile('guide')}
                    onRemove={() => setDeleteConfirm('guide')}
                    onView={() => setShowImageModal('guide')}
                    onDropBlob={(b) => uploadImage(b, 'guide')}
                  />
                </div>
              )}

              {/* 좌 BG | 우 ACT */}
              <div className="grid grid-cols-2 gap-0 divide-x divide-bg-border/40">
                <DeptSection
                  dept="bg"
                  scene={bgScene}
                  sheetName={bgSheetName}
                  sceneIndex={bgSceneIndex}
                  sceneId={merged.sceneId}
                  onToggle={onToggle}
                  onFieldUpdate={onFieldUpdate}
                  onDelete={() => setDeleteConfirm('bg')}
                  onAdd={() => handleAddDept('bg')}
                />
                <DeptSection
                  dept="acting"
                  scene={actScene}
                  sheetName={actSheetName}
                  sceneIndex={actSceneIndex}
                  sceneId={merged.sceneId}
                  onToggle={onToggle}
                  onFieldUpdate={onFieldUpdate}
                  onDelete={() => setDeleteConfirm('act')}
                  onAdd={() => handleAddDept('acting')}
                />
              </div>
            </div>

            {/* 하단 도트 인디케이터 — merged 단위 */}
            {showSceneDots && onNavigate && (
              <div className="flex items-center justify-center gap-1.5 pb-3 pt-2 shrink-0 border-t border-bg-border/30">
                {Array.from({ length: totalMerged }, (_, i) => {
                  const isCurrent = i === currentMergedIndex;
                  const showDot = totalMerged <= 9 ||
                    i === 0 || i === totalMerged - 1 ||
                    Math.abs(i - currentMergedIndex) <= 2;
                  const showEllipsis = !showDot && (
                    (i === 1 && currentMergedIndex > 3) ||
                    (i === totalMerged - 2 && currentMergedIndex < totalMerged - 4)
                  );
                  if (showEllipsis) {
                    return <span key={i} className="text-[8px] text-text-secondary/40 px-0.5">...</span>;
                  }
                  if (!showDot) return null;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const diff = i - currentMergedIndex;
                        const dir = diff < 0 ? 'prev' : 'next';
                        const steps = Math.abs(diff);
                        for (let j = 0; j < steps; j++) {
                          setTimeout(() => onNavigate(dir), j * 30);
                        }
                      }}
                      className={cn(
                        'rounded-full transition-all duration-300 cursor-pointer',
                        isCurrent ? 'w-5 h-1.5 bg-accent' : 'w-1.5 h-1.5 bg-text-secondary/30 hover:bg-text-secondary/50',
                      )}
                      title={`씬 ${i + 1}`}
                    />
                  );
                })}
              </div>
            )}

            {/* ── 리비전 토글 탭 버튼 — 본체 우측에 튀어나오도록 absolute ── */}
            <AnimatePresence>
              {!showRevisions && (
                <motion.button
                  key="revision-tab"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8, transition: { duration: 0.15 } }}
                  transition={{ delay: 0.15, duration: 0.2 }}
                  onClick={() => setShowRevisions(true)}
                  className="absolute -right-11 top-20 flex flex-col items-center gap-1 px-2 py-3 rounded-r-xl bg-bg-border/80 text-text-secondary hover:text-[#FDCB6E] transition-all cursor-pointer z-10"
                  style={openRevCount > 0 ? { backgroundColor: 'rgba(253, 203, 110, 0.15)' } : {}}
                  title="컴포지팅 리비전"
                >
                  <Film size={18} />
                  {(openRevCount > 0 || revisionCount > 0) && (
                    <span className="text-[10px] font-bold text-[#FDCB6E] tabular-nums">
                      {openRevCount > 0 ? openRevCount : revisionCount}
                    </span>
                  )}
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── 리비전 패널 (토글) ── */}
          <AnimatePresence>
            {showRevisions && revisionSheetName && revisionSceneId && (
              <motion.div
                key="revision-panel"
                initial={{ opacity: 0, x: -30, width: 0 }}
                animate={{ opacity: 1, x: 0, width: 320 }}
                exit={{ opacity: 0, x: -30, width: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 0.25 }}
                className="bg-bg-card rounded-2xl shadow-2xl border border-bg-border max-h-[90vh] flex flex-col shrink-0 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border shrink-0">
                  <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                    <Film size={14} className="text-[#FDCB6E]" />
                    컴포지팅 리비전
                  </h3>
                  <button
                    onClick={() => setShowRevisions(false)}
                    className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-border/50 cursor-pointer transition-colors"
                    title="닫기"
                  >
                    <X size={14} />
                  </button>
                </div>
                <RevisionPanel
                  sheetName={revisionSheetName}
                  sceneId={revisionSceneId}
                  department="bg"
                  onCountChange={setRevisionCount}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── 댓글 패널 (상시 표시) ── */}
          {primaryCommentKey && (
            <motion.div
              key="comment-panel"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              className="w-80 bg-bg-card rounded-2xl shadow-2xl border border-bg-border max-h-[90vh] flex flex-col shrink-0 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-bg-border shrink-0">
                <h3 className="text-sm font-medium text-text-primary">
                  댓글 및 활동
                  {commentCount > 0 && (
                    <span className="ml-2 text-xs text-text-secondary/60 tabular-nums">({commentCount})</span>
                  )}
                </h3>
              </div>
              <CommentPanel
                sceneKey={primaryCommentKey}
                secondarySceneKey={secondaryCommentKey || undefined}
                onCountChange={setCommentCount}
              />
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* 이미지 확대 */}
      {showImageModal && bgScene && (
        <ImageModal
          storyboardUrl={bgScene.storyboardUrl ?? ''}
          guideUrl={bgScene.guideUrl ?? ''}
          sceneId={bgScene.sceneId || String(bgScene.no)}
          onClose={() => setShowImageModal(null)}
        />
      )}

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <ConfirmDialog
          message={
            deleteConfirm === 'storyboard' ? '스토리보드 이미지를 삭제하시겠습니까?' :
            deleteConfirm === 'guide' ? '가이드 이미지를 삭제하시겠습니까?' :
            deleteConfirm === 'bg' ? 'BG 씬을 삭제하시겠습니까? (ACT 는 유지됩니다)' :
            deleteConfirm === 'act' ? 'ACT 씬을 삭제하시겠습니까? (BG 는 유지됩니다)' :
            'BG + ACT 양쪽을 모두 삭제하시겠습니까?'
          }
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => {
            if (deleteConfirm === 'storyboard' || deleteConfirm === 'guide') {
              removeImage(deleteConfirm);
            } else if (deleteConfirm === 'bg' && bgSheetName) {
              onDeleteDept(bgSheetName, bgSceneIndex);
              setDeleteConfirm(null);
              onClose();
            } else if (deleteConfirm === 'act' && actSheetName) {
              onDeleteDept(actSheetName, actSceneIndex);
              setDeleteConfirm(null);
              onClose();
            } else if (deleteConfirm === 'both') {
              onDeleteBoth();
              setDeleteConfirm(null);
              onClose();
            }
          }}
        />
      )}
    </AnimatePresence>
  );
}

/* ── 부서 섹션 ── */

function DeptSection({
  dept,
  scene,
  sheetName,
  sceneIndex,
  sceneId,
  onToggle,
  onFieldUpdate,
  onDelete,
  onAdd,
}: {
  dept: Department;
  scene: Scene | null;
  sheetName: string | null;
  sceneIndex: number;
  sceneId: string;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onFieldUpdate: (sheetName: string, sceneIndex: number, field: string, value: string) => void;
  onDelete: () => void;
  onAdd: () => void;
}) {
  const cfg = DEPARTMENT_CONFIGS[dept];

  if (!scene || !sheetName) {
    return (
      <div className="flex flex-col items-center justify-center py-14 px-6 text-center gap-3 min-h-[280px]">
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: cfg.color }}>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
          {cfg.shortLabel}
        </div>
        <span className="text-xs text-text-secondary/50 italic">아직 등록되지 않았습니다</span>
        <button
          onClick={onAdd}
          className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          style={{ backgroundColor: `${cfg.color}20`, color: cfg.color }}
        >
          <Plus size={14} />
          {cfg.shortLabel} 씬 추가
        </button>
      </div>
    );
  }

  const pct = sceneProgress(scene);

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
        <span className="text-sm font-semibold" style={{ color: cfg.color }}>{cfg.shortLabel}</span>
        <span className="ml-auto text-xs text-text-secondary tabular-nums">{pct}%</span>
        <button
          onClick={onDelete}
          className="p-1 rounded-md text-text-secondary/50 hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
          title={`${cfg.shortLabel} 씬 삭제`}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <InlineAssigneeRow
        label="담당자"
        value={scene.assignee || ''}
        onSave={(v) => onFieldUpdate(sheetName, sceneIndex, 'assignee', v)}
      />

      <div>
        <span className="block text-xs text-text-secondary mb-1.5">진행 단계</span>
        <div className="flex rounded-lg bg-black/[0.06] dark:bg-white/[0.04] p-1 gap-1">
          {STAGES.map((stage, i) => {
            const done = scene[stage];
            const isCurrent = done && (i === STAGES.length - 1 || !scene[STAGES[i + 1]]);
            return (
              <button
                key={stage}
                onClick={() => onToggle(sheetName, sceneId, stage)}
                className={cn(
                  'flex-1 text-center py-2 text-xs font-medium rounded-md transition-all cursor-pointer',
                  !done && 'text-text-secondary/60 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5',
                )}
                style={
                  done
                    ? isCurrent
                      ? { backgroundColor: cfg.color, color: '#fff', fontWeight: 700, boxShadow: `0 2px 8px ${cfg.color}40` }
                      : { backgroundColor: `${cfg.color}20`, color: cfg.color }
                    : undefined
                }
              >
                {cfg.stageLabels[stage]}
              </button>
            );
          })}
        </div>
      </div>

      <InlineTextareaRow
        label="메모"
        value={scene.memo || ''}
        onSave={(v) => onFieldUpdate(sheetName, sceneIndex, 'memo', v)}
      />
    </div>
  );
}

/* ── 인라인 담당자 ── */

function InlineAssigneeRow({ label, value, onSave }: {
  label: string; value: string; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <span className="block text-xs text-text-secondary mb-1.5">{label}</span>
      {editing ? (
        <AssigneeSelect
          value={value}
          onChange={(v) => { onSave(v); setEditing(false); }}
          onClose={() => setEditing(false)}
          className="w-full"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:border-accent/30 hover:bg-accent/5 text-sm text-text-primary cursor-pointer transition-colors"
        >
          {value || <span className="text-text-secondary/50 italic">담당자 없음</span>}
        </button>
      )}
    </div>
  );
}

/* ── 인라인 메모 ── */

function InlineTextareaRow({ label, value, onSave }: {
  label: string; value: string; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-text-secondary">{label}</span>
        {editing && (
          <button
            onClick={commit}
            className="p-1 text-accent hover:text-accent/80 cursor-pointer transition-colors"
            title="저장"
          >
            <Check size={12} />
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          className="w-full min-h-[64px] bg-bg-primary border border-accent/50 rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent resize-y"
          spellCheck={false}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:border-accent/30 hover:bg-accent/5 text-sm text-text-primary min-h-[40px] cursor-pointer transition-colors whitespace-pre-wrap"
        >
          {value || <span className="text-text-secondary/50 italic">메모 없음</span>}
          {value && (
            <Pencil size={12} className="inline-block ml-2 opacity-0 hover:opacity-60 transition-opacity" />
          )}
        </button>
      )}
    </div>
  );
}

/* ── 이미지 슬롯 ── */

function UnifiedImageSlot({
  label,
  url,
  loading,
  canEdit,
  onPick,
  onRemove,
  onView,
  onDropBlob,
}: {
  label: string;
  url: string;
  loading: boolean;
  canEdit: boolean;
  onPick: () => void;
  onRemove: () => void;
  onView: () => void;
  onDropBlob: (blob: Blob) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) onDropBlob(file);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-text-secondary uppercase tracking-wider font-medium">{label}</span>
      {loading ? (
        <div className="flex items-center justify-center h-32 bg-bg-primary rounded-lg border border-bg-border">
          <div className="flex items-center gap-2 text-xs text-text-secondary/60">
            <div className="w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
            저장 중...
          </div>
        </div>
      ) : url ? (
        <div className="relative group">
          <div
            onDragOver={canEdit ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
            onDragLeave={canEdit ? (e) => {
              const rt = e.relatedTarget as Node | null;
              if (rt && e.currentTarget.contains(rt)) return;
              setDragOver(false);
            } : undefined}
            onDrop={canEdit ? handleDrop : undefined}
            className={cn(
              'relative rounded-lg overflow-hidden border-2 transition-all',
              dragOver ? 'border-accent ring-4 ring-accent/25' : 'border-transparent',
            )}
          >
            <img
              src={url}
              alt={label}
              className={cn('w-full max-h-40 object-contain bg-bg-primary rounded-lg transition-all', dragOver && 'brightness-50')}
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {dragOver && (
              <div className="absolute inset-0 rounded-lg flex items-center justify-center pointer-events-none bg-accent/15 backdrop-blur-sm">
                <span className="text-xs font-semibold text-accent">여기에 놓으면 교체</span>
              </div>
            )}
            <div className="absolute inset-0 bg-overlay/0 group-hover:bg-overlay/40 transition-colors rounded-lg flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <button onClick={onView} className="p-2 bg-white/20 hover:bg-white/35 rounded-md text-white backdrop-blur-sm" title="확대">
                <Eye size={16} />
              </button>
              {canEdit && (
                <>
                  <button onClick={onPick} className="p-2 bg-white/20 hover:bg-white/35 rounded-md text-white backdrop-blur-sm" title="파일로 교체">
                    <ImagePlus size={16} />
                  </button>
                  <button onClick={onRemove} className="p-2 bg-white/20 hover:bg-red-500/60 rounded-md text-white backdrop-blur-sm" title="삭제">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : canEdit ? (
        <button
          onClick={onPick}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => {
            const rt = e.relatedTarget as Node | null;
            if (rt && e.currentTarget.contains(rt)) return;
            setDragOver(false);
          }}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center h-32 rounded-lg border-2 border-dashed transition-all cursor-pointer',
            dragOver
              ? 'border-accent bg-accent/15 ring-4 ring-accent/25'
              : 'border-bg-border hover:border-text-secondary/30 hover:bg-accent/5',
          )}
        >
          <ImagePlus size={22} className={cn('mb-1', dragOver ? 'text-accent animate-bounce' : 'text-text-secondary/45')} />
          <span className={cn('text-xs', dragOver ? 'text-accent font-semibold' : 'text-text-secondary/60')}>
            {dragOver ? '여기에 놓기' : '클릭 또는 드래그 앤 드롭'}
          </span>
        </button>
      ) : (
        <div className="flex items-center justify-center h-32 rounded-lg border-2 border-dashed border-bg-border/50 bg-bg-primary/20 text-text-secondary/40 text-xs">
          BG 씬이 필요합니다
        </div>
      )}
    </div>
  );
}

/* ── 확인 다이얼로그 ── */

function ConfirmDialog({ message, onCancel, onConfirm }: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94 }}
        animate={{ scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-card border border-bg-border rounded-xl p-5 max-w-sm shadow-2xl"
      >
        <p className="text-sm text-text-primary mb-4 whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md bg-bg-border/40 hover:bg-bg-border/60 text-xs text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-xs text-red-400 font-medium cursor-pointer transition-colors"
          >
            삭제
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
