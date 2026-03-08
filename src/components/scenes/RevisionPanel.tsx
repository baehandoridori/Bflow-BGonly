import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, Clock, Circle, ChevronDown, ImagePlus, X } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { buildSceneKey } from '@/services/revisionService';
import { resizeBlob } from '@/utils/imageUtils';
import type { CompRevision, RevisionPriority, RevisionStatus } from '@/types';

// ─── 상수 ───────────────────────────────────

const STATUS_CONFIG: Record<RevisionStatus, { label: string; color: string; bg: string }> = {
  open: { label: '대기', color: '#FDCB6E', bg: 'rgba(253, 203, 110, 0.15)' },
  in_progress: { label: '진행중', color: '#74B9FF', bg: 'rgba(116, 185, 255, 0.15)' },
  resolved: { label: '해결', color: '#00B894', bg: 'rgba(0, 184, 148, 0.15)' },
};

// ─── 시간 포맷 ───────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (hr < 24) return `${hr}시간 전`;
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

// ─── 상태 뱃지 ───────────────────────────────

function StatusBadge({ status, size = 'sm' }: { status: RevisionStatus; size?: 'sm' | 'md' }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <motion.span
      layout
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
      }`}
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      {status === 'open' && <Circle size={size === 'sm' ? 8 : 10} fill="currentColor" />}
      {status === 'in_progress' && <Clock size={size === 'sm' ? 8 : 10} />}
      {status === 'resolved' && <Check size={size === 'sm' ? 8 : 10} />}
      {cfg.label}
    </motion.span>
  );
}

// ─── 상태 드롭다운 ───────────────────────────

function StatusDropdown({
  currentStatus,
  onSelect,
}: {
  currentStatus: RevisionStatus;
  onSelect: (status: RevisionStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const options: RevisionStatus[] = ['open', 'in_progress', 'resolved'];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
      >
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        상태 변경
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 z-10 rounded-xl overflow-hidden border border-bg-border shadow-xl"
            style={{ background: 'rgba(26, 29, 39, 0.95)', backdropFilter: 'blur(12px)' }}
          >
            {options.filter(s => s !== currentStatus).map((s) => (
              <button
                key={s}
                onClick={() => { onSelect(s); setOpen(false); }}
                className="flex items-center gap-2 px-3 py-2 text-xs w-full hover:bg-white/5 transition-colors cursor-pointer"
              >
                <StatusBadge status={s} />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 리비전 카드 ──────────────────────────────

function RevisionCard({
  revision,
  onStatusChange,
}: {
  revision: CompRevision;
  onStatusChange: (status: RevisionStatus, note?: string) => void;
}) {
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const { currentUser } = useAuthStore();

  const handleStatusChange = (status: RevisionStatus) => {
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
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-xl p-3 border border-bg-border/60"
      style={{ background: 'rgba(26, 29, 39, 0.8)', backdropFilter: 'blur(12px)' }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-text-secondary">Rev.{revision.revisionNo}</span>
          <StatusBadge status={revision.status} />
          {revision.priority && revision.priority !== 'normal' && (
            <span
              className="text-[10px] font-medium rounded px-1 py-0.5"
              style={{
                color: revision.priority === 'urgent' ? '#FF6B6B' : '#E17055',
                backgroundColor: revision.priority === 'urgent' ? 'rgba(255, 107, 107, 0.15)' : 'rgba(225, 112, 85, 0.15)',
              }}
            >
              {revision.priority === 'urgent' ? '긴급' : '높음'}
            </span>
          )}
          {revision.frameNo && (
            <span className="text-[10px] text-text-secondary/60 font-mono">{revision.frameNo}</span>
          )}
          {revision.department && (
            <span className="text-[10px] text-text-secondary/70 uppercase">
              {revision.department === 'bg' ? 'BG' : 'ACT'}
            </span>
          )}
        </div>
        {currentUser && (
          <StatusDropdown currentStatus={revision.status} onSelect={handleStatusChange} />
        )}
      </div>

      {/* 설명 */}
      <p className="text-sm text-text-primary leading-relaxed mb-2 whitespace-pre-wrap">
        {revision.description}
      </p>

      {/* 이미지 썸네일 */}
      {revision.imageUrl && (
        <div className="mb-2">
          <img
            src={revision.imageUrl}
            alt="첨부"
            className="rounded-lg max-h-32 object-cover border border-bg-border/40 cursor-pointer hover:opacity-80 transition-opacity"
          />
        </div>
      )}

      {/* 해결 메모 입력 */}
      <AnimatePresence>
        {showResolveNote && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-2 overflow-hidden"
          >
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="해결 메모 (선택)"
              className="w-full px-3 py-2 text-sm bg-bg-primary rounded-lg border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
              rows={2}
            />
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => { setShowResolveNote(false); setResolveNote(''); }}
                className="text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={handleResolve}
                className="text-xs px-3 py-1 rounded-lg text-white transition-colors cursor-pointer"
                style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
              >
                해결
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 해결 메모 표시 */}
      {revision.status === 'resolved' && revision.resolvedNote && (
        <div className="mb-2 px-3 py-2 rounded-lg" style={{ background: STATUS_CONFIG.resolved.bg }}>
          <p className="text-xs text-text-secondary">
            <span className="font-medium" style={{ color: STATUS_CONFIG.resolved.color }}>해결:</span>{' '}
            {revision.resolvedNote}
          </p>
        </div>
      )}

      {/* 푸터 */}
      <div className="flex items-center gap-2 text-[11px] text-text-secondary/70">
        <span>{revision.requesterName}</span>
        <span>&middot;</span>
        <span>{formatTime(revision.createdAt)}</span>
        {revision.status === 'resolved' && revision.resolvedBy && (
          <>
            <span>&middot;</span>
            <span style={{ color: STATUS_CONFIG.resolved.color }}>{revision.resolvedBy}이(가) 해결</span>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ─── 메인 패널 ───────────────────────────────

interface RevisionPanelProps {
  sheetName: string;
  sceneId: string;
  department: 'bg' | 'acting';
  onCountChange?: (count: number) => void;
}

export function RevisionPanel({ sheetName, sceneId, department, onCountChange }: RevisionPanelProps) {
  const { currentUser } = useAuthStore();
  const { createRevision, updateStatus, loadRevisions, getRevisionsForScene, getOpenCount } = useRevisionStore();

  const sceneKey = buildSceneKey(sheetName, sceneId);
  const revisions = getRevisionsForScene(sceneKey);
  const sortedRevisions = [...revisions].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<RevisionPriority>('normal');
  const [frameNo, setFrameNo] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadRevisions();
  }, [loadRevisions]);

  useEffect(() => {
    onCountChange?.(getOpenCount(sceneKey));
  }, [sceneKey, revisions.length, getOpenCount, onCountChange]);

  useEffect(() => {
    if (showForm) textareaRef.current?.focus();
  }, [showForm]);

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
      await createRevision(sceneKey, {
        description: description.trim(),
        priority,
        frameNo: frameNo.trim() || undefined,
        imageUrl: imagePreview || undefined,
        department,
        requesterId: currentUser.id,
        requesterName: currentUser.name,
      });
      setDescription('');
      setPriority('normal');
      setFrameNo('');
      setImagePreview(null);
      setShowForm(false);
    } catch (err) {
      console.error('리비전 등록 실패:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (revId: string, status: RevisionStatus, note?: string) => {
    await updateStatus(revId, sceneKey, status, {
      resolvedBy: currentUser?.name,
      resolvedNote: note,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* 리비전 목록 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {sortedRevisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-secondary/50">
            <Circle size={24} className="mb-2" />
            <p className="text-xs">리비전 요청이 없습니다</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {sortedRevisions.map((rev) => (
              <RevisionCard
                key={rev.id}
                revision={rev}
                onStatusChange={(status, note) => handleStatusChange(rev.id, status, note)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* 수정 요청 폼 */}
      <div className="shrink-0 border-t border-bg-border">
        <AnimatePresence>
          {showForm ? (
            <motion.div
              key="revision-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              <div className="px-4 py-3 space-y-3">
                {/* 우선순위 + 프레임 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-primary w-fit">
                    {(['urgent', 'high', 'normal'] as const).map((p) => {
                      const cfgMap: Record<RevisionPriority, { label: string; color: string; bg: string }> = {
                        urgent: { label: '긴급', color: '#FF6B6B', bg: 'rgba(255, 107, 107, 0.15)' },
                        high: { label: '높음', color: '#E17055', bg: 'rgba(225, 112, 85, 0.15)' },
                        normal: { label: '보통', color: '#74B9FF', bg: 'rgba(116, 185, 255, 0.15)' },
                      };
                      const cfg = cfgMap[p];
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

                {/* 설명 입력 */}
                <textarea
                  ref={textareaRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="수정 내용을 설명해주세요..."
                  className="w-full px-3 py-2 text-sm bg-bg-primary rounded-lg border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
                  rows={3}
                />

                {/* 이미지 프리뷰 */}
                {imagePreview && (
                  <div className="relative w-fit">
                    <img src={imagePreview} alt="preview" className="rounded-lg max-h-24 border border-bg-border/40" />
                    <button
                      onClick={() => setImagePreview(null)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer hover:bg-red-400 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}

                {/* 액션 바 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-primary transition-colors cursor-pointer"
                      title="이미지 첨부"
                    >
                      <ImagePlus size={16} />
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
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowForm(false); setDescription(''); setImagePreview(null); }}
                      className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={!description.trim() || submitting}
                      className="px-4 py-1.5 text-xs font-medium rounded-lg text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: '#FDCB6E' }}
                    >
                      {submitting ? '등록 중...' : '등록'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="revision-add-btn"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-4 py-3"
            >
              <button
                onClick={() => setShowForm(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl border border-dashed border-bg-border text-text-secondary hover:text-accent hover:border-accent/40 transition-all cursor-pointer"
              >
                <Plus size={14} />
                수정 요청
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
