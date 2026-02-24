import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Pencil,
  Check,
  ImagePlus,
  ClipboardPaste,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { Scene, Stage, Department } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';
import { resizeBlob, pasteImageFromClipboard } from '@/utils/imageUtils';
import { ImageModal } from './ImageModal';
import { CommentPanel } from './CommentPanel';
import { getComments } from '@/services/commentService';

// ─── 타입 ──────────────────────────────────────────

interface SceneDetailModalProps {
  scene: Scene;
  sceneIndex: number;
  sheetName: string;
  department: Department;
  onFieldUpdate: (sceneIndex: number, field: string, value: string) => void;
  onToggle: (sceneId: string, stage: Stage) => void;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  totalScenes?: number;
  currentSceneIndex?: number;
}

// ─── 속성 행 컴포넌트 ──────────────────────────────

interface PropertyRowProps {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
}

function PropertyRow({ label, value, placeholder, onSave }: PropertyRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-3 py-2.5 px-4 group hover:bg-bg-primary/40 rounded-lg transition-colors">
      <span className="text-xs text-text-secondary w-20 shrink-0 font-medium">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setDraft(value); setEditing(false); }
            }}
            className="w-full bg-bg-primary border border-accent/50 rounded-md px-2.5 py-1 text-sm text-text-primary outline-none focus:border-accent"
          />
        ) : (
          <span className="text-sm text-text-primary">
            {value || (
              <span className="text-text-secondary/50 italic">
                {placeholder ?? '비어 있음'}
              </span>
            )}
          </span>
        )}
      </div>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 p-1 text-text-secondary/50 hover:text-accent transition-all"
          title="편집"
        >
          <Pencil size={12} />
        </button>
      )}
      {editing && (
        <button
          onClick={commit}
          className="p-1 text-accent hover:text-accent/80 transition-colors"
          title="저장"
        >
          <Check size={14} />
        </button>
      )}
    </div>
  );
}

// ─── 이미지 슬롯 ──────────────────────────────────

interface ImageSlotProps {
  label: string;
  url: string;
  loading: boolean;
  onPickFile: () => void;
  onPasteClipboard: () => void;
  onRemove: () => void;
  onView: () => void;
  onPasteEvent: (e: React.ClipboardEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function ImageSlot({
  label,
  url,
  loading,
  onPickFile,
  onPasteClipboard,
  onRemove,
  onView,
  onPasteEvent,
  onDrop,
}: ImageSlotProps) {
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'paste-hint'>('idle');

  const handleEmptyClick = () => {
    if (phase === 'idle') {
      setPhase('paste-hint');
    } else {
      // 두번째 클릭 → 파일 선택
      setPhase('idle');
      onPickFile();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
        {label}
      </span>

      {loading ? (
        <div className="flex items-center justify-center h-40 bg-bg-primary rounded-xl border border-bg-border">
          <div className="flex items-center gap-2 text-sm text-text-secondary/60">
            <div className="w-4 h-4 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
            이미지 저장 중...
          </div>
        </div>
      ) : url ? (
        /* 이미지가 있을 때 */
        <div className="relative group">
          <div
            tabIndex={0}
            onPaste={onPasteEvent}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(e); }}
            className={cn(
              'rounded-xl overflow-hidden border-2 transition-colors cursor-pointer outline-none',
              dragOver ? 'border-accent' : 'border-transparent',
            )}
          >
            <img
              src={url}
              alt={label}
              className="w-full max-h-60 object-contain bg-bg-primary rounded-xl"
              draggable={false}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = 'none';
                const parent = img.parentElement;
                if (parent && !parent.querySelector('.img-error-msg')) {
                  const msg = document.createElement('div');
                  msg.className = 'img-error-msg flex items-center justify-center h-40 text-xs text-text-secondary/50';
                  msg.textContent = '이미지를 불러올 수 없습니다';
                  parent.prepend(msg);
                }
              }}
            />
            {/* 호버 오버레이 — 아이콘 확대 */}
            <div className="absolute inset-0 bg-overlay/0 group-hover:bg-overlay/50 transition-colors rounded-xl flex items-center justify-center gap-4 opacity-0 group-hover:opacity-100">
              <button
                onClick={onView}
                className="p-3.5 bg-white/20 hover:bg-white/35 rounded-xl backdrop-blur-sm text-white transition-all hover:scale-110"
                title="확대 보기"
              >
                <Eye size={26} />
              </button>
              <button
                onClick={onPasteClipboard}
                className="p-3 bg-white/20 hover:bg-white/35 rounded-xl backdrop-blur-sm text-white transition-all hover:scale-110"
                title="클립보드에서 교체"
              >
                <ClipboardPaste size={22} />
              </button>
              <button
                onClick={onPickFile}
                className="p-3 bg-white/20 hover:bg-white/35 rounded-xl backdrop-blur-sm text-white transition-all hover:scale-110"
                title="파일로 교체"
              >
                <ImagePlus size={22} />
              </button>
              <button
                onClick={onRemove}
                className="p-3 bg-white/20 hover:bg-red-500/60 rounded-xl backdrop-blur-sm text-white transition-all hover:scale-110"
                title="이미지 삭제"
              >
                <Trash2 size={22} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* 이미지가 없을 때 — 2단계 클릭 */
        <div
          tabIndex={0}
          onPaste={(e) => { onPasteEvent(e); setPhase('idle'); }}
          onBlur={() => setPhase('idle')}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(e); }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 h-40 rounded-xl border-2 border-dashed transition-all cursor-pointer outline-none',
            dragOver
              ? 'border-accent bg-accent/10'
              : phase === 'paste-hint'
                ? 'border-accent bg-accent/5'
                : 'border-bg-border hover:border-text-secondary/30',
          )}
          onClick={handleEmptyClick}
        >
          {phase === 'paste-hint' ? (
            <>
              <ClipboardPaste size={28} className="text-accent" />
              <div className="text-center">
                <p className="text-xs text-accent font-medium">
                  Ctrl+V 로 이미지 붙여넣기
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); onPasteClipboard(); setPhase('idle'); }}
                  className="text-xs text-accent/70 underline hover:text-accent mt-1"
                >
                  붙여넣기 버튼
                </button>
                <p className="text-[10px] text-text-secondary/50 mt-1.5">
                  한번 더 클릭하면 파일 탐색기 열기
                </p>
              </div>
            </>
          ) : (
            <>
              <ImagePlus size={28} className="text-text-secondary/45" />
              <div className="text-center">
                <p className="text-xs text-text-secondary/50">
                  클릭하여 이미지 추가
                </p>
                <p className="text-[10px] text-text-secondary/45 mt-0.5">
                  드래그 앤 드롭도 가능
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 메인 모달 ─────────────────────────────────────

export function SceneDetailModal({
  scene,
  sceneIndex,
  sheetName,
  department,
  onFieldUpdate,
  onToggle,
  onClose,
  onNavigate,
  hasPrev = false,
  hasNext = false,
  totalScenes = 0,
  currentSceneIndex = 0,
}: SceneDetailModalProps) {
  const [imageLoading, setImageLoading] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<'storyboard' | 'guide' | null>(null);

  const deptConfig = DEPARTMENT_CONFIGS[department];
  const pct = sceneProgress(scene);
  const sceneKey = `${sheetName}:${scene.no}`;

  // 댓글 수 로드
  useEffect(() => {
    getComments(sceneKey).then((c) => setCommentCount(c.length));
  }, [sceneKey]);

  // ESC 닫기 + 좌우 화살표 씬 이동 (이미지 뷰어 열려있으면 이미지 모달만 닫기)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showImageModal) {
          // 이미지 모달만 닫기 (상세 모달은 유지)
          setShowImageModal(false);
          return;
        }
        onClose();
        return;
      }
      // 입력 중이면 화살표 무시
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // 이미지 모달이 열려있으면 방향키를 이미지 전환에 양보
      if (showImageModal) return;
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate?.('prev');
      if (e.key === 'ArrowRight' && hasNext) onNavigate?.('next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNavigate, hasPrev, hasNext, showImageModal]);

  // ── 글로벌 Ctrl+V 이미지 붙여넣기 ──
  useEffect(() => {
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
          // 스토리보드가 없으면 스토리보드에, 아니면 가이드에
          const imageType: 'storyboard' | 'guide' = !scene.storyboardUrl ? 'storyboard' : 'guide';
          try {
            setImageLoading(imageType);
            const base64 = await resizeBlob(blob);
            const { saveImage: si } = await import('@/utils/imageUtils');
            const url = await si(
              base64,
              sheetName,
              scene.sceneId || String(scene.no),
              imageType,
  
            );
            const field = imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
            onFieldUpdate(sceneIndex, field, url);
          } catch (err) {
            console.error('[Ctrl+V 실패]', err);
            alert(`이미지 붙여넣기 실패: ${err instanceof Error ? err.message : err}`);
          } finally {
            setImageLoading(null);
          }
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [showImageModal, scene.storyboardUrl, sheetName, scene.sceneId, scene.no, sceneIndex, onFieldUpdate]);

  // ── 이미지 핸들러 ──

  const pickFile = useCallback(
    (imageType: 'storyboard' | 'guide') => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          setImageLoading(imageType);
          const { resizeBlob: rb, saveImage: si } = await import(
            '@/utils/imageUtils'
          );
          const base64 = await rb(file);
          const url = await si(
            base64,
            sheetName,
            scene.sceneId || String(scene.no),
            imageType,

          );
          const field =
            imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
          onFieldUpdate(sceneIndex, field, url);
        } catch (err) {
          console.error('[파일 선택 실패]', err);
          alert(`이미지 저장 실패: ${err instanceof Error ? err.message : err}`);
        } finally {
          setImageLoading(null);
        }
      };
      input.click();
    },
    [sheetName, scene.sceneId, scene.no, sceneIndex, onFieldUpdate],
  );

  const pasteClipboard = useCallback(
    async (imageType: 'storyboard' | 'guide') => {
      try {
        setImageLoading(imageType);
        const url = await pasteImageFromClipboard(
          sheetName,
          scene.sceneId || String(scene.no),
          imageType,

        );
        if (!url) {
          alert('클립보드에 이미지가 없습니다.');
          setImageLoading(null);
          return;
        }
        const field =
          imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
        onFieldUpdate(sceneIndex, field, url);
      } catch (err) {
        console.error('[클립보드 붙여넣기 실패]', err);
        alert(`클립보드 붙여넣기 실패: ${err instanceof Error ? err.message : err}`);
      } finally {
        setImageLoading(null);
      }
    },
    [sheetName, scene.sceneId, scene.no, sceneIndex, onFieldUpdate],
  );

  const handlePasteEvent = useCallback(
    async (e: React.ClipboardEvent, imageType: 'storyboard' | 'guide') => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          try {
            setImageLoading(imageType);
            const base64 = await resizeBlob(blob);
            const { saveImage: si } = await import('@/utils/imageUtils');
            const url = await si(
              base64,
              sheetName,
              scene.sceneId || String(scene.no),
              imageType,
  
            );
            const field =
              imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
            onFieldUpdate(sceneIndex, field, url);
          } catch (err) {
            console.error('[Ctrl+V 실패]', err);
            alert(`이미지 붙여넣기 실패: ${err instanceof Error ? err.message : err}`);
          } finally {
            setImageLoading(null);
          }
          return;
        }
      }
    },
    [sheetName, scene.sceneId, scene.no, sceneIndex, onFieldUpdate],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, imageType: 'storyboard' | 'guide') => {
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      try {
        setImageLoading(imageType);
        const base64 = await resizeBlob(file);
        const { saveImage: si } = await import('@/utils/imageUtils');
        const url = await si(
          base64,
          sheetName,
          scene.sceneId || String(scene.no),
          imageType,

        );
        const field =
          imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
        onFieldUpdate(sceneIndex, field, url);
      } catch (err) {
        console.error('[드롭 실패]', err);
        alert(`이미지 드롭 실패: ${err instanceof Error ? err.message : err}`);
      } finally {
        setImageLoading(null);
      }
    },
    [sheetName, scene.sceneId, scene.no, sceneIndex, onFieldUpdate],
  );

  const confirmRemoveImage = useCallback(
    () => {
      if (!deleteConfirm) return;
      const field = deleteConfirm === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
      onFieldUpdate(sceneIndex, field, '');
      setDeleteConfirm(null);
    },
    [sceneIndex, onFieldUpdate, deleteConfirm],
  );

  // 씬 네비게이션 도트 표시 여부 (2개 이상일 때만)
  const showSceneDots = totalScenes > 1;

  return (
    <AnimatePresence>
      {/* 백드롭 */}
      <motion.div
        key="detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* 모달 래퍼 — 댓글 패널은 absolute로 배치하여 레이아웃 점프 방지 */}
        <motion.div
          className="relative"
          animate={{ x: showComments ? -160 : 0 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
            {/* 모달 본체 */}
            <motion.div
              key="detail-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-bg-card rounded-2xl shadow-2xl border border-bg-border w-[42rem] max-h-[90vh] overflow-y-auto"
            >
              {/* ── 헤더 ── */}
              <div className="sticky top-0 z-10 flex items-center gap-3 px-6 py-4 bg-bg-card/95 backdrop-blur-md border-b border-bg-border rounded-t-2xl">
                {/* 이전/다음 씬 네비게이션 */}
                {onNavigate && (
                  <div className="flex items-center gap-1 mr-1">
                    <button
                      onClick={() => onNavigate('prev')}
                      disabled={!hasPrev}
                      className={cn(
                        'p-1.5 rounded-lg transition-all',
                        hasPrev
                          ? 'text-text-secondary hover:text-text-primary hover:bg-bg-primary cursor-pointer'
                          : 'text-bg-border cursor-not-allowed',
                      )}
                      title="이전 씬 (←)"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      onClick={() => onNavigate('next')}
                      disabled={!hasNext}
                      className={cn(
                        'p-1.5 rounded-lg transition-all',
                        hasNext
                          ? 'text-text-secondary hover:text-text-primary hover:bg-bg-primary cursor-pointer'
                          : 'text-bg-border cursor-not-allowed',
                      )}
                      title="다음 씬 (→)"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )}
                <span className="text-lg font-mono font-bold text-accent">
                  #{scene.no}
                </span>
                <span className="text-lg font-semibold text-text-primary">
                  {scene.sceneId || '(씬번호 없음)'}
                </span>
                {/* 진행률 */}
                <div className="flex items-center gap-2 ml-auto mr-2">
                  <div className="w-20 h-1.5 bg-bg-primary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          pct >= 100
                            ? '#00B894'
                            : pct >= 50
                              ? '#FDCB6E'
                              : '#E17055',
                      }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-secondary">
                    {Math.round(pct)}%
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-primary rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-6 py-5 flex flex-col gap-6">
                {/* ── 속성 섹션 ── */}
                <section>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary/50 mb-2 px-4">
                    속성
                  </h3>
                  <div className="bg-bg-primary/30 rounded-xl border border-bg-border/50 divide-y divide-bg-border/30">
                    <PropertyRow
                      label="씬번호"
                      value={scene.sceneId}
                      placeholder="예: a001"
                      onSave={(v) => onFieldUpdate(sceneIndex, 'sceneId', v)}
                    />
                    {/* 담당자 — 사용자 목록 드롭다운 */}
                    <div className="flex items-center gap-3 py-2.5 px-4 hover:bg-bg-primary/40 rounded-lg transition-colors">
                      <span className="text-xs text-text-secondary w-20 shrink-0 font-medium">담당자</span>
                      <AssigneeSelect
                        value={scene.assignee}
                        onChange={(v) => onFieldUpdate(sceneIndex, 'assignee', v)}
                        placeholder="담당자 입력"
                        className="flex-1"
                      />
                    </div>
                    <PropertyRow
                      label="레이아웃"
                      value={scene.layoutId}
                      placeholder="레이아웃 번호"
                      onSave={(v) => onFieldUpdate(sceneIndex, 'layoutId', v)}
                    />
                    <PropertyRow
                      label="메모"
                      value={scene.memo}
                      placeholder="메모 입력"
                      onSave={(v) => onFieldUpdate(sceneIndex, 'memo', v)}
                    />
                  </div>
                </section>

                {/* ── 진행 단계 ── */}
                <section>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary/50 mb-3 px-4">
                    진행 단계
                  </h3>
                  <div className="flex gap-3 px-4">
                    {STAGES.map((stage) => (
                      <button
                        key={stage}
                        onClick={() => onToggle(scene.sceneId, stage)}
                        className={cn(
                          'flex-1 py-2.5 rounded-xl text-sm font-medium transition-all',
                          scene[stage]
                            ? 'text-bg-primary shadow-md'
                            : 'bg-bg-primary text-text-secondary border border-bg-border hover:border-text-secondary',
                        )}
                        style={
                          scene[stage]
                            ? { backgroundColor: deptConfig.stageColors[stage] }
                            : undefined
                        }
                      >
                        {scene[stage] ? '✓ ' : ''}
                        {deptConfig.stageLabels[stage]}
                      </button>
                    ))}
                  </div>
                </section>

                {/* ── 이미지 섹션 ── */}
                <section>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary/50 mb-3 px-4">
                    이미지
                  </h3>
                  <div className="flex flex-col gap-5 px-4">
                    <ImageSlot
                      label="스토리보드"
                      url={scene.storyboardUrl}
                      loading={imageLoading === 'storyboard'}
                      onPickFile={() => pickFile('storyboard')}
                      onPasteClipboard={() => pasteClipboard('storyboard')}
                      onRemove={() => setDeleteConfirm('storyboard')}
                      onView={() => setShowImageModal(true)}
                      onPasteEvent={(e) => handlePasteEvent(e, 'storyboard')}
                      onDrop={(e) => handleDrop(e, 'storyboard')}
                    />
                    <ImageSlot
                      label="가이드"
                      url={scene.guideUrl}
                      loading={imageLoading === 'guide'}
                      onPickFile={() => pickFile('guide')}
                      onPasteClipboard={() => pasteClipboard('guide')}
                      onRemove={() => setDeleteConfirm('guide')}
                      onView={() => setShowImageModal(true)}
                      onPasteEvent={(e) => handlePasteEvent(e, 'guide')}
                      onDrop={(e) => handleDrop(e, 'guide')}
                    />
                  </div>
                </section>
              </div>

              {/* ── 하단 씬 네비게이션 도트 ── */}
              {showSceneDots && (
                <div className="flex items-center justify-center gap-1.5 pb-4 pt-1">
                  {Array.from({ length: totalScenes }, (_, i) => {
                    const isCurrent = i === currentSceneIndex;
                    // 도트가 많을 때 축소 표시 (양쪽 2개 + 현재 주변 2개)
                    const showDot = totalScenes <= 9 ||
                      i === 0 || i === totalScenes - 1 ||
                      Math.abs(i - currentSceneIndex) <= 2;
                    const showEllipsis = !showDot && (
                      (i === 1 && currentSceneIndex > 3) ||
                      (i === totalScenes - 2 && currentSceneIndex < totalScenes - 4)
                    );
                    if (showEllipsis) {
                      return (
                        <span key={i} className="text-[8px] text-text-secondary/40 px-0.5">...</span>
                      );
                    }
                    if (!showDot) return null;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (i < currentSceneIndex && onNavigate) {
                            for (let j = 0; j < currentSceneIndex - i; j++) {
                              setTimeout(() => onNavigate('prev'), j * 30);
                            }
                          } else if (i > currentSceneIndex && onNavigate) {
                            for (let j = 0; j < i - currentSceneIndex; j++) {
                              setTimeout(() => onNavigate('next'), j * 30);
                            }
                          }
                        }}
                        className={cn(
                          'rounded-full transition-all duration-300 cursor-pointer',
                          isCurrent
                            ? 'w-5 h-1.5 bg-accent'
                            : 'w-1.5 h-1.5 bg-text-secondary/30 hover:bg-text-secondary/50',
                        )}
                        title={`씬 ${i + 1}`}
                      />
                    );
                  })}
                </div>
              )}
            </motion.div>

            {/* ── 말풍선 탭 버튼 — 의견 모달 열리면 접힘 ── */}
            <AnimatePresence>
              {!showComments && (
                <motion.button
                  key="comment-tab"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8, transition: { duration: 0.15 } }}
                  transition={{ delay: 0.15, duration: 0.2 }}
                  onClick={() => setShowComments(true)}
                  className="absolute -right-11 top-20 flex flex-col items-center gap-1 px-2 py-3 rounded-r-xl bg-bg-border/80 text-text-secondary hover:bg-accent/30 hover:text-accent transition-all cursor-pointer"
                  title="의견"
                >
                  <MessageCircle size={18} />
                  {commentCount > 0 && (
                    <span className="text-[10px] font-bold leading-none">{commentCount}</span>
                  )}
                </motion.button>
              )}
            </AnimatePresence>

          {/* ── 댓글 패널 — absolute 배치로 레이아웃 점프 방지 ── */}
          <AnimatePresence>
            {showComments && (
              <motion.div
                key="comment-panel"
                initial={{ opacity: 0, x: 30, scaleX: 0.9 }}
                animate={{ opacity: 1, x: 0, scaleX: 1 }}
                exit={{ opacity: 0, x: 30, scaleX: 0.9 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: 'left center' }}
                className="absolute left-full top-0 ml-3 w-80 bg-bg-card rounded-2xl shadow-2xl border border-bg-border max-h-[90vh] flex flex-col"
              >
                {/* 패널 헤더 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border shrink-0">
                  <div className="flex items-center gap-2">
                    <MessageCircle size={14} className="text-accent" />
                    <h3 className="text-sm font-medium text-text-primary">의견</h3>
                    {commentCount > 0 && (
                      <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-medium">
                        {commentCount}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowComments(false)}
                    className="p-1 text-text-secondary hover:text-text-primary rounded transition-colors cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
                {/* 패널 바디 */}
                <CommentPanel
                  sceneKey={sceneKey}
                  onCountChange={setCommentCount}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* ── 이미지 삭제 확인 팝업 ── */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            key="delete-confirm-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex items-center justify-center"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', backgroundColor: 'rgb(var(--color-overlay) / var(--overlay-alpha))' }}
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              key="delete-confirm-dialog"
              initial={{ opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 12 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-bg-card rounded-2xl shadow-2xl border border-bg-border p-6 w-80 flex flex-col items-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
                <Trash2 size={24} className="text-red-400" />
              </div>
              <div className="text-center">
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  이미지를 삭제하시겠습니까?
                </h3>
                <p className="text-xs text-text-secondary">
                  {deleteConfirm === 'storyboard' ? '스토리보드' : '가이드'} 이미지가 삭제됩니다.
                </p>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-bg-primary text-text-secondary border border-bg-border hover:bg-bg-border transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  onClick={confirmRemoveImage}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-500/80 hover:bg-red-500 text-white transition-colors cursor-pointer"
                >
                  삭제
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 이미지 전체 뷰 모달 */}
      {showImageModal && (
        <ImageModal
          storyboardUrl={scene.storyboardUrl}
          guideUrl={scene.guideUrl}
          sceneId={scene.sceneId}
          onClose={() => setShowImageModal(false)}
          // 씬 네비게이션 props
          hasPrevScene={hasPrev}
          hasNextScene={hasNext}
          currentSceneIndex={currentSceneIndex}
          totalScenes={totalScenes}
          onSceneNavigate={onNavigate}
        />
      )}
    </AnimatePresence>
  );
}
