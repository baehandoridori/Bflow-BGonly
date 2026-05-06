import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, Clock, Circle, ChevronDown, ImagePlus, X, Trash2, MessageSquareWarning, Bell } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAuthStore } from '@/stores/useAuthStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { buildSceneKey } from '@/services/revisionService';
import { resizeBlob } from '@/utils/imageUtils';
import type { CompRevision, RevisionStatus, Scene } from '@/types';
import { formatTime } from '@/utils/formatTime';
import { STATUS_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { elevatedGlassStyle, floatingGlassStyle } from '@/utils/glassStyles';
import { RevisionRecipientPicker } from './RevisionRecipientPicker';
import { RevisionCommentThread } from './RevisionCommentThread';
import { calcDefaultRecipients } from '@/utils/revisionRecipients';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';

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
            style={floatingGlassStyle}
          >
            {options.filter(s => s !== currentStatus).map((s) => (
              <button
                key={s}
                onClick={() => { onSelect(s); setOpen(false); }}
                className="flex items-center gap-2 px-3 py-2 text-xs w-full hover:bg-bg-border/20 transition-colors cursor-pointer"
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
  commentSceneKey,
  onStatusChange,
  onDelete,
}: {
  revision: CompRevision;
  /**
   * commentService 형식 sceneKey (`sheetName:sceneNo`, 예: "EP01_A_BG:3").
   * ⚠️ 리비전 시스템의 sceneKey(`episode:part:sceneId`, 예: "EP01:A:1")와 형식이 다름.
   * 이 카드는 RevisionCommentThread 마운트에만 sceneKey를 사용하므로 commentService 형식으로 받는다.
   * 잘못된 형식이 전달되면 commentService.parseSceneKey 가 lastIndexOf(':')로 split해
   * partUuid lookup이 실패하고 "씬을 찾을 수 없음" 에러가 발생한다 (이슈: 2026-05-04).
   */
  commentSceneKey: string;
  onStatusChange: (status: RevisionStatus, note?: string) => void;
  onDelete?: () => void;
}) {
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const { currentUser, users: allUsers } = useAuthStore();
  const canDelete = !!(
    currentUser && onDelete &&
    (currentUser.id === revision.requesterId || currentUser.role === 'admin')
  );

  // v1.19.4: notifyUserIds → 사용자 객체 (이름 + 컴포지터 라벨용)
  const notifyUsers = useMemo(
    () =>
      (revision.notifyUserIds ?? [])
        .map((uid) => allUsers.find((u) => u.id === uid))
        .filter((u): u is NonNullable<typeof u> => !!u),
    [revision.notifyUserIds, allUsers],
  );

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
      id={`rev-card-${revision.id}`}
      data-status={revision.status}
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rev-card relative rounded-xl p-3 border border-bg-border/60 group"
      style={elevatedGlassStyle}
    >
      {/* 좌측 컬러 막대 — 미해결: 액센트 / 완료: 그린 */}
      <span
        className={`rev-side-bar${revision.status === 'resolved' ? ' rev-side-bar-done' : ''}`}
        aria-hidden
      />

      {/* 헤더 — v1.18.0 재설계: re# 라벨 + 상태만 (우선순위/부서/프레임 표시 제거) */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[12px] font-bold ${
              revision.status === 'resolved' ? 'text-text-secondary' : 'text-accent-sub'
            }`}
          >
            {revisionNoToLabel(revision.revisionNo)}
          </span>
          <StatusBadge status={revision.status} />
        </div>
        {currentUser && (
          <div className="flex items-center gap-1.5">
            <StatusDropdown currentStatus={revision.status} onSelect={handleStatusChange} />
            {canDelete && (
              <button
                onClick={onDelete}
                title="리비전 삭제"
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-text-secondary/60 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 설명 — G:\ 경로는 PathBadge 아이콘 버튼으로 자동 변환 (메모/댓글과 동일 패턴) */}
      <p className="rev-card-description text-sm text-text-primary leading-relaxed mb-2 whitespace-pre-wrap">
        <PathLinkifiedText text={revision.description} />
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
      <div className="flex items-center gap-2 text-[11px] text-text-secondary/70 flex-wrap">
        <span>{revision.requesterName}</span>
        <span>&middot;</span>
        <span>{formatTime(revision.createdAt)}</span>
        {revision.status === 'resolved' && revision.resolvedBy && (
          <>
            <span>&middot;</span>
            <span style={{ color: STATUS_CONFIG.resolved.color }}>{revision.resolvedBy}이(가) 해결</span>
          </>
        )}
        {/* 알림 대상 — v1.19.4: 종 아이콘 + user-chip 인라인 (4명 초과 시 +N) */}
        {notifyUsers.length > 0 && (
          <>
            <span>&middot;</span>
            <span
              className="inline-flex items-center gap-1"
              title={`알림 대상: ${notifyUsers.map((u) => u.name).join(', ')}`}
            >
              <Bell size={10} className="text-text-secondary/60 shrink-0" />
              <span className="inline-flex items-center gap-1 flex-wrap">
                {notifyUsers.slice(0, 4).map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[10px] text-text-primary"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ background: 'rgb(var(--color-accent))' }}
                    >
                      {u.name.charAt(0)}
                    </span>
                    <span>{u.name}</span>
                  </span>
                ))}
                {notifyUsers.length > 4 && (
                  <span className="text-[10px] text-text-secondary/60">+{notifyUsers.length - 4}</span>
                )}
              </span>
            </span>
          </>
        )}
      </div>

      {/* 카드 내 댓글 스레드 — v1.18.0 신규 */}
      <RevisionCommentThread revisionId={revision.id} sceneKey={commentSceneKey} />
    </motion.div>
  );
}

// ─── 메인 패널 ───────────────────────────────

function inferDepartmentFromSheetName(sheetName: string): 'bg' | 'acting' | undefined {
  if (/_ACT$/i.test(sheetName)) return 'acting';
  if (/_BG$/i.test(sheetName)) return 'bg';
  return undefined;
}

interface RevisionPanelProps {
  sheetName: string;
  sceneId: string;
  siblingSceneIds?: readonly string[];
  department?: 'bg' | 'acting';
  onCountChange?: (count: number) => void;
}

export function RevisionPanel({ sheetName, sceneId, siblingSceneIds, department, onCountChange }: RevisionPanelProps) {
  const { currentUser, users: allUsers } = useAuthStore();
  const { createRevision, updateStatus, loadRevisions, getRevisionsForScene, getOpenCount } = useRevisionStore();
  const episodes = useDataStore((s) => s.episodes);

  // 그 sheetName 의 part + 그 안에서 sceneId 매칭되는 scene 객체 (담당자 자동 체크용)
  const { inferredSiblingSceneIds, scene } = useMemo<{ inferredSiblingSceneIds: string[]; scene: Scene | undefined }>(() => {
    for (const episode of episodes) {
      const part = episode.parts.find((candidate) => candidate.sheetName === sheetName);
      if (part) {
        return {
          inferredSiblingSceneIds: part.scenes.map((s) => s.sceneId),
          scene: part.scenes.find((s) => s.sceneId === sceneId),
        };
      }
    }
    return { inferredSiblingSceneIds: [], scene: undefined };
  }, [episodes, sheetName, sceneId]);
  const effectiveSiblingSceneIds = siblingSceneIds ?? inferredSiblingSceneIds;
  const effectiveDepartment = department ?? inferDepartmentFromSheetName(sheetName);

  const sceneKey = buildSceneKey(sheetName, sceneId, { siblingSceneIds: effectiveSiblingSceneIds });
  // commentService 가 사용하는 sceneKey 형식 (`sheetName:scene.no`).
  // ⚠️ scene.no 는 DB sort_order(숫자). raw sceneId(예: "a001")가 아니다.
  //   - 첫 번째 fix(2026-05-04 #1): sceneKey 형식 불일치 → sceneId 추출됨
  //   - 두 번째 fix(2026-05-04 #2): comment 저장은 sceneId 를 Number()로 sort_order 변환해 scenes lookup → "a001" 같은 raw 값은 NaN 이라 실패
  //   → CommentPanel(`UnifiedSceneDetailModal:134`)와 동일하게 scene.no 사용.
  const commentSceneKey = scene ? `${sheetName}:${scene.no}` : '';
  const revisions = getRevisionsForScene(sceneKey);
  const sortedRevisions = [...revisions].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 자동 체크 대상자 — 모든 컴포지터 + 그 씬 담당자 (등록자 본인 제외).
  // v1.18.1 한솔 정정: 컴포지터는 부서로 나뉘지 않으므로 dept 인자 불필요.
  const defaultRecipients = useMemo(() => {
    if (!currentUser) return [];
    return calcDefaultRecipients(scene, allUsers, currentUser.id);
  }, [scene, allUsers, currentUser]);

  useEffect(() => {
    loadRevisions();
  }, [loadRevisions]);

  // Realtime 이벤트 리스너 — 다른 사용자 변경 시 자동 갱신
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadRevisions(); }, 300);
    };
    window.addEventListener('bflow:revisions-invalidated', handler);
    return () => {
      window.removeEventListener('bflow:revisions-invalidated', handler);
      if (timer) clearTimeout(timer);
    };
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
      await createRevision({
        sceneKey,
        description: description.trim(),
        imageUrl: imagePreview || undefined,
        department: effectiveDepartment,
        lookupDepartment: effectiveDepartment,
        requesterId: currentUser.id,
        requesterName: currentUser.name,
        // v1.18.0: RevisionRecipientPicker 가 계산한 알림 대상자 (자동 체크 ± 사용자 수정).
        notifyUserIds: notifyIds,
      });
      setDescription('');
      setImagePreview(null);
      setNotifyIds([]);
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

  const handleDelete = async (rev: CompRevision) => {
    const ok = await ConfirmDialog.show({
      message: `${revisionNoToLabel(rev.revisionNo)} 리비전을 삭제하시겠습니까?\n첨부 이미지도 함께 제거됩니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      // 권한은 main 프로세스가 신뢰된 session 에서 직접 확인 (Codex #8 P1)
      await useRevisionStore.getState().deleteRevision(rev.id, rev.sceneKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sonnerToast.error(`리비전 삭제 실패: ${msg}`);
    }
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
                commentSceneKey={commentSceneKey}
                onStatusChange={(status, note) => handleStatusChange(rev.id, status, note)}
                onDelete={() => handleDelete(rev)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* 수정 요청 폼 — v1.18.0 재설계: 우선순위/프레임/부서 제거 + 알림 받을 사람 칩 */}
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
              <div className="px-4 py-3">
                <div className="bg-bg-primary/50 border border-accent/40 rounded-xl p-4 space-y-4">
                  {/* 헤더 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquareWarning className="w-4 h-4 text-accent" strokeWidth={2.4} />
                      <span className="text-[13px] font-bold text-text-primary">새 리비전 등록</span>
                    </div>
                    <button
                      onClick={() => { setShowForm(false); setDescription(''); setImagePreview(null); }}
                      className="text-text-secondary hover:text-text-primary text-base leading-none cursor-pointer"
                      title="닫기"
                    >
                      ×
                    </button>
                  </div>

                  {/* 본문 */}
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
                      내용 <span className="text-accent">*</span>
                    </label>
                    <textarea
                      ref={textareaRef}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      onPaste={handlePaste}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                      placeholder="어떤 부분을 수정해야 하는지, 또는 무엇이 변경되었는지 적어주세요."
                      className="w-full min-h-[88px] px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary placeholder:text-text-secondary/50 resize-y focus:outline-none focus:border-accent/60"
                    />
                  </div>

                  {/* 이미지 첨부 */}
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
                      이미지 첨부 <span className="text-text-secondary/50 font-normal normal-case">(선택)</span>
                    </label>
                    {imagePreview ? (
                      <div className="relative w-fit">
                        <img src={imagePreview} alt="preview" className="rounded-lg max-h-32 border border-bg-border/40" />
                        <button
                          onClick={() => setImagePreview(null)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-bg-card border border-bg-border text-text-secondary hover:text-text-primary flex items-center justify-center cursor-pointer transition-colors"
                          title="이미지 제거"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-bg-border/40 hover:border-accent/40 text-[12px] text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                        >
                          <ImagePlus size={14} />
                          파일 선택
                        </button>
                        <span className="text-[11px] text-text-secondary/50">
                          또는 본문에 클립보드에서 붙여넣기 (Ctrl+V)
                        </span>
                      </div>
                    )}
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

                  {/* 알림 받을 사람 */}
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
                      알림 받을 사람{' '}
                      <span className="text-text-secondary/50 font-normal normal-case">
                        — 컴포지터 + 그 씬 담당자 자동 체크 (클릭으로 토글)
                      </span>
                    </label>
                    <RevisionRecipientPicker
                      allUsers={allUsers}
                      defaultCheckedIds={defaultRecipients}
                      excludeUserId={currentUser?.id || ''}
                      onChange={setNotifyIds}
                    />
                  </div>

                  {/* 액션 바 */}
                  <div className="flex items-center justify-between pt-2 border-t border-bg-border/40">
                    <div className="text-[11px] text-text-secondary/60">
                      등록자: {currentUser?.name ?? '—'} · 등록 즉시 선택된 사람들에게 알림이 발송됩니다.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowForm(false); setDescription(''); setImagePreview(null); }}
                        className="px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleSubmit}
                        disabled={!description.trim() || submitting}
                        className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
                      >
                        {submitting ? '등록 중...' : '리비전 등록'}
                      </button>
                    </div>
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
                새 리비전
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
