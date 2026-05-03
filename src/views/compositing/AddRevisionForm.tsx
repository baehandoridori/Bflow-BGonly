// ─── 새 리비전 등록 폼 ──────────────────────

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ImagePlus, X } from 'lucide-react';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { resizeBlob } from '@/utils/imageUtils';
import { PRIORITY_CONFIG } from '@/constants/revision';
import { elevatedGlassStyle } from '@/utils/glassStyles';
import type { RevisionPriority } from '@/types';

export function AddRevisionForm({
  sceneKey,
  department,
  onClose,
}: {
  sceneKey: string;
  department?: 'bg' | 'acting';
  onClose: () => void;
}) {
  const { currentUser } = useAuthStore();
  const { createRevision } = useRevisionStore();
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<RevisionPriority>('normal');
  const [frameNo, setFrameNo] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleImageFile = async (file: File) => {
    try {
      const resized = await resizeBlob(file, 800, 0.8);
      setImagePreview(resized);
    } catch { /* 무시 */ }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleImageFile(file);
        return;
      }
    }
  };

  const handleSubmit = async () => {
    if (!description.trim() || !currentUser || submitting) return;
    setSubmitting(true);
    try {
      await createRevision({
        sceneKey,
        description: description.trim(),
        imageUrl: imagePreview || undefined,
        department,
        lookupDepartment: department,
        requesterId: currentUser.id,
        requesterName: currentUser.name,
        // 청크 3에서 폼 재설계 시 멘션 UI → 실제 user.id 배열 전달.
        notifyUserIds: [],
      });
      onClose();
    } catch (err) {
      console.error('리비전 등록 실패:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden ml-12 mr-4 mb-2"
    >
      <div
        className="rounded-xl p-4 space-y-3 border border-bg-border/60"
        style={elevatedGlassStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 우선순위 선택 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-primary w-fit">
            {(['urgent', 'high', 'normal'] as const).map((p) => {
              const cfg = PRIORITY_CONFIG[p];
              return (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-all cursor-pointer ${
                    priority === p ? 'shadow-sm' : 'text-text-secondary hover:text-text-primary'
                  }`}
                  style={priority === p ? { color: cfg.color, backgroundColor: cfg.bg } : undefined}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
          <input
            value={frameNo}
            onChange={(e) => setFrameNo(e.target.value)}
            placeholder="F000"
            className="w-16 px-2 py-1 text-[11px] bg-bg-primary rounded-md border border-bg-border text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent/50 font-mono"
          />
        </div>

        {/* 설명 */}
        <textarea
          ref={textareaRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            if (e.key === 'Escape') onClose();
          }}
          placeholder="수정 내용을 설명해주세요..."
          className="w-full px-3 py-2 text-sm bg-bg-primary rounded-lg border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
          rows={2}
        />

        {/* 이미지 프리뷰 */}
        {imagePreview && (
          <div className="relative w-fit">
            <img src={imagePreview} alt="preview" className="rounded-lg max-h-20 border border-bg-border/40" />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer hover:bg-red-400"
            >
              <X size={10} />
            </button>
          </div>
        )}

        {/* 액션 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-primary transition-colors cursor-pointer"
            title="이미지 첨부"
          >
            <ImagePlus size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFile(file);
              e.target.value = '';
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!description.trim() || submitting}
              className="px-4 py-1.5 text-[11px] font-medium rounded-lg text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#6C5CE7' }}
            >
              {submitting ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
