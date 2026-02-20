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
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { STAGE_LABELS, STAGE_COLORS, STAGES } from '@/types';
import type { Scene, Stage } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import { resizeBlob, pasteImageFromClipboard } from '@/utils/imageUtils';
import { ImageModal } from './ImageModal';

// ─── 타입 ──────────────────────────────────────────

interface SceneDetailModalProps {
  scene: Scene;
  sceneIndex: number;
  sheetName: string;
  isLiveMode: boolean;
  onFieldUpdate: (sceneIndex: number, field: string, value: string) => void;
  onToggle: (sceneId: string, stage: Stage) => void;
  onClose: () => void;
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
              <span className="text-text-secondary/40 italic">
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
            {/* 호버 오버레이 */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded-xl flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
              <button
                onClick={onView}
                className="p-2 bg-white/20 hover:bg-white/30 rounded-lg backdrop-blur-sm text-white transition-colors"
                title="확대 보기"
              >
                <Eye size={18} />
              </button>
              <button
                onClick={onPasteClipboard}
                className="p-2 bg-white/20 hover:bg-white/30 rounded-lg backdrop-blur-sm text-white transition-colors"
                title="클립보드에서 교체"
              >
                <ClipboardPaste size={18} />
              </button>
              <button
                onClick={onPickFile}
                className="p-2 bg-white/20 hover:bg-white/30 rounded-lg backdrop-blur-sm text-white transition-colors"
                title="파일로 교체"
              >
                <ImagePlus size={18} />
              </button>
              <button
                onClick={onRemove}
                className="p-2 bg-white/20 hover:bg-red-500/60 rounded-lg backdrop-blur-sm text-white transition-colors"
                title="이미지 삭제"
              >
                <Trash2 size={18} />
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
                <p className="text-[10px] text-text-secondary/40 mt-1.5">
                  한번 더 클릭하면 파일 탐색기 열기
                </p>
              </div>
            </>
          ) : (
            <>
              <ImagePlus size={28} className="text-text-secondary/30" />
              <div className="text-center">
                <p className="text-xs text-text-secondary/50">
                  클릭하여 이미지 추가
                </p>
                <p className="text-[10px] text-text-secondary/30 mt-0.5">
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
  isLiveMode,
  onFieldUpdate,
  onToggle,
  onClose,
}: SceneDetailModalProps) {
  const [imageLoading, setImageLoading] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  const pct = sceneProgress(scene);

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
            isLiveMode,
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
    [sheetName, scene.sceneId, scene.no, isLiveMode, sceneIndex, onFieldUpdate],
  );

  const pasteClipboard = useCallback(
    async (imageType: 'storyboard' | 'guide') => {
      try {
        setImageLoading(imageType);
        const url = await pasteImageFromClipboard(
          sheetName,
          scene.sceneId || String(scene.no),
          imageType,
          isLiveMode,
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
    [sheetName, scene.sceneId, scene.no, isLiveMode, sceneIndex, onFieldUpdate],
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
              isLiveMode,
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
    [sheetName, scene.sceneId, scene.no, isLiveMode, sceneIndex, onFieldUpdate],
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
          isLiveMode,
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
    [sheetName, scene.sceneId, scene.no, isLiveMode, sceneIndex, onFieldUpdate],
  );

  const removeImage = useCallback(
    (imageType: 'storyboard' | 'guide') => {
      const field = imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
      onFieldUpdate(sceneIndex, field, '');
    },
    [sceneIndex, onFieldUpdate],
  );

  return (
    <AnimatePresence>
      {/* 백드롭 */}
      <motion.div
        key="detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* 모달 본체 */}
        <motion.div
          key="detail-modal"
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative bg-bg-card rounded-2xl shadow-2xl border border-bg-border w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── 헤더 ── */}
          <div className="sticky top-0 z-10 flex items-center gap-3 px-6 py-4 bg-bg-card/95 backdrop-blur-md border-b border-bg-border rounded-t-2xl">
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
                <PropertyRow
                  label="담당자"
                  value={scene.assignee}
                  placeholder="담당자 입력"
                  onSave={(v) => onFieldUpdate(sceneIndex, 'assignee', v)}
                />
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
                        ? { backgroundColor: STAGE_COLORS[stage] }
                        : undefined
                    }
                  >
                    {scene[stage] ? '✓ ' : ''}
                    {STAGE_LABELS[stage]}
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
                  onRemove={() => removeImage('storyboard')}
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
                  onRemove={() => removeImage('guide')}
                  onView={() => setShowImageModal(true)}
                  onPasteEvent={(e) => handlePasteEvent(e, 'guide')}
                  onDrop={(e) => handleDrop(e, 'guide')}
                />
              </div>
            </section>
          </div>
        </motion.div>
      </motion.div>

      {/* 이미지 전체 뷰 모달 */}
      {showImageModal && (
        <ImageModal
          storyboardUrl={scene.storyboardUrl}
          guideUrl={scene.guideUrl}
          sceneId={scene.sceneId}
          onClose={() => setShowImageModal(false)}
        />
      )}
    </AnimatePresence>
  );
}
