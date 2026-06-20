// ─── 새 리테이크 등록 폼 ──────────────────────

import { useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { ImagePlus, X } from 'lucide-react';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { resizeBlob } from '@/utils/imageUtils';
import { elevatedGlassStyle } from '@/utils/glassStyles';
import { RevisionRecipientPicker } from '@/components/scenes/RevisionRecipientPicker';
import { calcDefaultRecipients } from '@/utils/revisionRecipients';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';

export function AddRevisionForm({
  sceneKey,
  department,
  /**
   * v1.19.4: 알림 대상 자동 체크 계산용 — assignee 있는 씬 정보(SceneInfo)를 받아 calcDefaultRecipients 호출.
   * SceneGroupSection 이 group.info 를 그대로 넘긴다. assignee 만 있으면 충분 (Pick<Scene,'assignee'> 호환).
   */
  sceneAssignee,
  onClose,
}: {
  sceneKey: string;
  department?: 'bg' | 'acting';
  sceneAssignee?: string;
  onClose: () => void;
}) {
  const { currentUser, users: allUsers } = useAuthStore();
  const { createRevision } = useRevisionStore();
  const [description, setDescription] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 자동 체크 대상자 — 모든 컴포지터 + 그 씬 담당자 (등록자 본인 제외).
  // RevisionPanel.tsx 의 defaultRecipients 와 동일 패턴.
  const defaultRecipients = useMemo(() => {
    if (!currentUser) return [];
    return calcDefaultRecipients(
      sceneAssignee ? { assignee: sceneAssignee } : null,
      allUsers,
      currentUser.id,
    );
  }, [sceneAssignee, allUsers, currentUser]);

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
        // v1.19.4: RevisionRecipientPicker 가 계산한 알림 대상자 (자동 체크 ± 사용자 수정).
        notifyUserIds: notifyIds,
      });
      onClose();
    } catch (err) {
      console.error('리테이크 등록 실패:', err);
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
        {/* 설명 */}
        <EntityAwareInput
          multiline
          rows={2}
          value={description}
          onChange={setDescription}
          users={allUsers}
          enableHashtag={false}
          onPaste={handlePaste}
          submitOn="enter"
          onSubmit={handleSubmit}
          onCancel={onClose}
          autoFocus
          placeholder="수정 내용을 설명해주세요... (@이름으로 멘션)"
          className="w-full px-3 py-2 text-sm bg-bg-primary rounded-lg border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
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

        {/* 알림 받을 사람 — v1.19.4: 컴포지터 + 그 씬 담당자 자동 체크 */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-1 block">
            알림 받을 사람
            <span className="text-text-secondary/50 font-normal normal-case ml-1">
              — 자동 체크된 사람을 클릭하면 제외됩니다
            </span>
          </label>
          <RevisionRecipientPicker
            allUsers={allUsers}
            defaultCheckedIds={defaultRecipients}
            excludeUserId={currentUser?.id || ''}
            onChange={setNotifyIds}
          />
        </div>

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
