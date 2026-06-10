import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast as sonnerToast } from 'sonner';
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
  Film,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { Scene, Stage, Department, ScenePhaseState } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import * as storageService from '@/services/storageService';
import { AssigneeSelect, getUserColor } from '@/components/common/AssigneeSelect';
import { AssigneeMultiSelect } from '@/components/common/AssigneeMultiSelect';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';
import { resizeBlob, pasteImageFromClipboard } from '@/utils/imageUtils';
import { ImageModal } from './ImageModal';
import { ScenePhaseToggle } from './ScenePhaseToggle';
import { StageSegmentToggle } from './StageSegmentToggle';
import { CommentPanelResizable } from './CommentPanelResizable';
import type { CommentInlineEvent } from './CommentPanel';
import { RevisionPanel } from './RevisionPanel';
import { getComments } from '@/services/commentService';
import { useSceneActivities } from '@/hooks/useSceneActivities';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { buildSceneKey } from '@/services/revisionService';
import { buildSceneThreadKeyFromRevisionKey } from '@/utils/commentThreadKey';
import { formatStamp, formatTime } from '@/utils/formatTime';
import { findLatestMemoActivity, type MemoAuthorMeta } from './memoAuthorMeta';
import { describeActivity, deptPrefix } from './activityLabels';
import { useOptimisticSceneImageUrl } from '@/hooks/useOptimisticSceneImageUrl';

// ─── 타입 ──────────────────────────────────────────

interface SceneDetailModalProps {
  scene: Scene;
  sceneIndex: number;
  sheetName: string;
  department: Department;
  /** 반대 부서의 댓글/리비전을 함께 보려면 반대편 sheetName 지정 (BG 단독 모달에서도 ACT 댓글 노출) */
  counterpartSheetName?: string | null;
  /** 반대 부서에 같은 번호의 씬이 존재하면 그 씬의 scene.no (댓글 키용) */
  counterpartSceneNo?: number | null;
  /** ACT 모달에서 BG 의 이미지를 읽기 전용으로 표시하기 위한 URL 들 */
  readOnlyStoryboardUrl?: string | null;
  readOnlyGuideUrl?: string | null;
  onFieldUpdate: (sceneIndex: number, field: string, value: string) => void;
  onToggle: (sceneId: string, stage: Stage) => void;
  onActPhaseStateClick?: (sheetName: string, sceneId: string, newState: ScenePhaseState) => void;
  onActFeedbackRequest?: (sheetName: string, sceneId: string) => void;
  onActRoundBump?: (sheetName: string, sceneId: string, kind: 'work' | 'feedback', delta: 1 | -1) => void;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  totalScenes?: number;
  currentSceneIndex?: number;
  /**
   * 코덱스 P2 fix (5차, 2026-05-05): 단일 부서 모달도 알림 라우팅 지원.
   * 알림 클릭으로 진입했을 때 초기 탭/포커스할 리비전 카드 지정. UnifiedSceneDetailModal 과 동일.
   */
  initialTab?: 'detail' | 'revisions' | 'files' | 'history';
  focusRevisionId?: string;
  /** v1.24.0: 댓글 점프용 — 모달 진입 시 자동 스크롤 + 펄스. */
  focusCommentId?: string;
  /** 리비전 카드 내부 댓글 스레드에서 강조할 댓글 id. */
  focusRevisionCommentId?: string;
}

// ─── 속성 행 컴포넌트 ──────────────────────────────

interface PropertyRowProps {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
  memoAuthorMeta?: MemoAuthorMeta | null;
}

function PropertyRow({ label, value, placeholder, onSave, memoAuthorMeta }: PropertyRowProps) {
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
      <span className={cn('text-xs text-text-secondary shrink-0 font-medium', memoAuthorMeta ? 'w-24' : 'w-20')}>
        {label}
        {value && memoAuthorMeta && (
          <span
            className="mt-1 flex items-center gap-1 max-w-full text-[10px] font-medium text-emerald-300/85 truncate"
            title={`마지막 수정: ${memoAuthorMeta.userName} · ${formatStamp(memoAuthorMeta.createdAt, { withYearAlways: true })}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300/80 shrink-0" />
            <span className="truncate">{memoAuthorMeta.userName} · {formatTime(memoAuthorMeta.createdAt)}</span>
          </span>
        )}
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
            className="w-full bg-bg-primary border border-accent/50 rounded-md px-2.5 py-1 text-sm text-text-primary outline-none focus:border-accent transition-shadow focus:shadow-[0_0_8px_rgba(108,92,231,0.4)]"
          />
        ) : (
          <div
            onClick={() => setEditing(true)}
            className="w-full rounded-md px-2.5 py-1 border border-transparent cursor-pointer transition-all duration-200 hover:border-accent/30 hover:bg-accent/5 hover:shadow-[0_0_8px_rgba(108,92,231,0.15)]"
          >
            <span className="text-sm text-text-primary">
              {value ? (
                <PathLinkifiedText text={value} />
              ) : (
                <span className="text-text-secondary/50 italic">
                  {placeholder ?? '비어 있음'}
                </span>
              )}
            </span>
          </div>
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
  uploading?: boolean;
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
  uploading,
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
            onDragLeave={(e) => {
              // 자식 요소로 이동하는 경우는 무시 — relatedTarget 이 현재 div 안에 있으면 유지
              const rt = e.relatedTarget as Node | null;
              if (rt && e.currentTarget.contains(rt)) return;
              setDragOver(false);
            }}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(e); }}
            className={cn(
              'relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer outline-none',
              dragOver ? 'border-accent ring-4 ring-accent/25 scale-[1.01]' : 'border-transparent',
            )}
          >
            <img
              src={url}
              alt={label}
              className={cn(
                'w-full max-h-60 object-contain bg-bg-primary rounded-xl transition-all',
                dragOver && 'brightness-50 blur-[1px]',
              )}
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
            {/* 드래그 오버 힌트 — 교체 안내 */}
            {dragOver && (
              <div className="absolute inset-0 rounded-xl flex flex-col items-center justify-center gap-1.5 pointer-events-none bg-accent/15 backdrop-blur-sm">
                <ImagePlus size={30} className="text-accent drop-shadow" />
                <span className="text-sm font-semibold text-accent drop-shadow">여기에 놓으면 이미지 교체</span>
              </div>
            )}
            {/* 업로드 중 오버레이 */}
            {uploading && (
              <div className="absolute inset-0 bg-overlay/40 rounded-xl flex items-center justify-center">
                <div className="flex items-center gap-2 text-sm text-white bg-black/40 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                  <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  업로드중...
                </div>
              </div>
            )}
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
          onDragLeave={(e) => {
            const rt = e.relatedTarget as Node | null;
            if (rt && e.currentTarget.contains(rt)) return;
            setDragOver(false);
          }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(e); }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 h-40 rounded-xl border-2 border-dashed transition-all cursor-pointer outline-none',
            dragOver
              ? 'border-accent bg-accent/15 ring-4 ring-accent/25 scale-[1.02] shadow-lg shadow-accent/20'
              : phase === 'paste-hint'
                ? 'border-accent bg-accent/5'
                : 'border-bg-border hover:border-text-secondary/30 hover:bg-accent/5',
          )}
          onClick={handleEmptyClick}
        >
          {dragOver ? (
            <>
              <ImagePlus size={32} className="text-accent animate-bounce" />
              <div className="text-center">
                <p className="text-sm font-semibold text-accent">
                  여기에 놓으면 이미지 추가
                </p>
                <p className="text-[11px] text-accent/70 mt-0.5">
                  파일을 놓으세요
                </p>
              </div>
            </>
          ) : phase === 'paste-hint' ? (
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
                <p className="text-[11px] text-text-secondary/50 mt-1.5">
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
                <p className="text-[11px] text-text-secondary/45 mt-0.5">
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

// ─── 읽기 전용 이미지 프리뷰 (ACT 모달에서 BG 이미지를 보여줄 때) ───

function ReadOnlyImagePreview({
  label,
  url,
  onView,
}: {
  label: string;
  url: string;
  onView: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">{label}</span>
      <button
        type="button"
        onClick={onView}
        className="relative group rounded-xl overflow-hidden cursor-zoom-in outline-none focus:ring-2 focus:ring-accent/40"
        title="클릭하여 확대"
      >
        <img
          src={url}
          alt={label}
          className="w-full max-h-60 object-contain bg-bg-primary rounded-xl"
          draggable={false}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="absolute inset-0 bg-overlay/0 group-hover:bg-overlay/30 transition-colors rounded-xl flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded-md bg-bg-card/80 border border-bg-border text-xs text-text-primary backdrop-blur-sm">
            클릭하여 확대
          </span>
        </div>
      </button>
    </div>
  );
}

// ─── 메인 모달 ─────────────────────────────────────

export function SceneDetailModal({
  scene,
  sceneIndex,
  sheetName,
  department,
  counterpartSheetName,
  counterpartSceneNo,
  readOnlyStoryboardUrl,
  readOnlyGuideUrl,
  onFieldUpdate,
  onToggle,
  onActPhaseStateClick,
  onActFeedbackRequest,
  onActRoundBump,
  onClose,
  onNavigate,
  hasPrev = false,
  hasNext = false,
  totalScenes = 0,
  currentSceneIndex = 0,
  initialTab,
  focusRevisionId,
  focusCommentId,
  focusRevisionCommentId,
}: SceneDetailModalProps) {
  const [imageLoading, setImageLoading] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const sceneActivities = useSceneActivities([scene.id], 200);
  const memoAuthorMeta = useMemo(
    () => findLatestMemoActivity(sceneActivities, scene.id),
    [sceneActivities, scene.id],
  );
  const inlineEvents: CommentInlineEvent[] = useMemo(() => {
    const BIG_EVENT_TYPES = new Set([
      'memo_update',
      'image_upload_storyboard', 'image_upload_guide',
      'image_annotate_storyboard', 'image_annotate_guide',
      'scene_add',
      'revision_add', 'revision_in_progress', 'revision_resolve', 'revision_delete',
    ]);

    const events: CommentInlineEvent[] = sceneActivities
      .filter((a) => BIG_EVENT_TYPES.has(a.actionType))
      .map<CommentInlineEvent>((a) => {
        const visual = describeActivity(a);
        const revisionTone =
          a.actionType === 'revision_add'
            ? 'revision_add'
            : a.actionType === 'revision_in_progress'
              ? 'revision_in_progress'
              : a.actionType === 'revision_resolve'
                ? 'revision_resolve'
                : undefined;
        const revisionLabel =
          a.actionType === 'revision_add'
            ? '등록'
            : a.actionType === 'revision_in_progress'
              ? '진행'
              : a.actionType === 'revision_resolve'
                ? '완료'
                : undefined;

        return {
          id: a.id,
          at: a.createdAt,
          text: `${a.userName} ${deptPrefix(a.department)}${visual.text}`,
          tone: revisionTone,
          label: revisionLabel,
        };
      });

    if (scene.completedAt && scene.completedBy) {
      events.push({
        id: `completed:${department}:${scene.id ?? 'na'}`,
        at: scene.completedAt,
        text: `${scene.completedBy} ${deptPrefix(department)}모든 단계 완료`,
      });
    }

    return events;
  }, [department, scene.completedAt, scene.completedBy, scene.id, sceneActivities]);
  // 코덱스 P2 fix (5차, 2026-05-05): 알림 라우팅 시 initialTab='revisions' 면 리비전 패널 자동 펼침.
  const [showRevisions, setShowRevisions] = useState(initialTab === 'revisions');
  // 코덱스 P2 fix (6차, 2026-05-05): 모달 인스턴스가 재사용되어 initialTab prop 이 나중에 바뀌면
  // useState 초기값만으로는 sync 안 됨. effect 로 prop 변경 감지 → revisions 모드로 전환.
  useEffect(() => {
    if (initialTab === 'revisions') setShowRevisions(true);
  }, [initialTab]);

  // 코덱스 P2 fix (9차, 2026-05-05): 댓글 패널의 [re#] 배지 클릭 → 리비전 패널 펼침 + 카드 강조.
  // UnifiedSceneDetailModal:173 동일 패턴. 단일 부서 모달도 같은 동작 보장.
  useEffect(() => {
    function onJump(e: Event) {
      const detail = (e as CustomEvent<{ revisionId?: string }>).detail;
      const revisionId = detail?.revisionId;
      if (!revisionId) return;
      setShowRevisions(true);
      let retries = 8;
      const attempt = () => {
        const card = document.getElementById(`rev-card-${revisionId}`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.remove('rev-pulse');
          void (card as HTMLElement).offsetWidth;
          card.classList.add('rev-pulse');
          window.dispatchEvent(new CustomEvent('bflow:expand-revision', { detail: { revisionId } }));
        } else if (retries-- > 0) {
          setTimeout(() => requestAnimationFrame(attempt), 100);
        }
      };
      requestAnimationFrame(attempt);
    }
    window.addEventListener('bflow:jump-to-revision', onJump);
    return () => window.removeEventListener('bflow:jump-to-revision', onJump);
  }, []);

  // 코덱스 P2 fix (5차, 2026-05-05): focusRevisionId 강조 — UnifiedSceneDetailModal:204 동일 패턴.
  // 단일 부서 모달에서도 알림 클릭 → 리비전 패널 펼침 + 해당 카드 scrollIntoView + pulse.
  useEffect(() => {
    if (!focusRevisionId || !showRevisions) return;
    let cancelled = false;
    let removeTimer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (retries: number) => {
      if (cancelled) return;
      const el = document.getElementById(`rev-card-${focusRevisionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('rev-pulse');
        window.dispatchEvent(new CustomEvent('bflow:expand-revision', {
          detail: { revisionId: focusRevisionId, commentId: focusRevisionCommentId },
        }));
        removeTimer = setTimeout(() => { el.classList.remove('rev-pulse'); }, 2600);
      } else if (retries > 0) {
        setTimeout(() => requestAnimationFrame(() => attempt(retries - 1)), 100);
      }
    };
    requestAnimationFrame(() => attempt(8));
    return () => {
      cancelled = true;
      if (removeTimer) clearTimeout(removeTimer);
    };
  }, [focusRevisionId, focusRevisionCommentId, showRevisions]);
  const [commentCount, setCommentCount] = useState(0);
  const [revisionCount, setRevisionCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<'storyboard' | 'guide' | null>(null);
  // 모달 backdrop 드래그 닫힘 방지 — mousedown 시작 위치를 추적해 backdrop 자체에서 시작한 경우만 onClose 트리거
  const backdropMouseDownRef = useRef(false);

  // 이미지 즉시 프리뷰용 낙관적 URL (업로드 중 base64 표시)
  const [previewUrls, setPreviewUrls] = useState<{ storyboard?: string; guide?: string }>({});
  const [latestImageUrls, setLatestImageUrls] = useState<{ storyboard?: string; guide?: string }>({});
  const { persistLatestImageUrl } = useOptimisticSceneImageUrl('SceneDetailModal');

  useEffect(() => {
    setLatestImageUrls({});
  }, [scene.id, scene.sceneId, sheetName]);

  useEffect(() => {
    setLatestImageUrls({});
  }, [scene.storyboardUrl, scene.guideUrl]);

  const applyLatestImageUrl = useCallback(
    (imageType: 'storyboard' | 'guide', url: string) => {
      if (department !== 'bg') return;

      const previousUrl = imageType === 'storyboard' ? scene.storyboardUrl : scene.guideUrl;

      setLatestImageUrls((prev) => ({ ...prev, [imageType]: url }));
      setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));

      persistLatestImageUrl({
        sceneUuid: scene.id,
        imageType,
        url,
        previousUrl,
        onRollback: (rollbackUrl) => {
          setLatestImageUrls((prev) => ({ ...prev, [imageType]: rollbackUrl }));
        },
      });
    },
    [department, scene.id, scene.storyboardUrl, scene.guideUrl, persistLatestImageUrl],
  );

  const deptConfig = DEPARTMENT_CONFIGS[department];
  const pct = sceneProgress(scene);
  const sceneKey = `${sheetName}:${scene.no}`;
  const revisionSceneKey = buildSceneKey(sheetName, scene.sceneId);
  const sceneThreadKey = buildSceneThreadKeyFromRevisionKey(revisionSceneKey);
  const openRevCount = useRevisionStore((s) => s.getOpenCount(revisionSceneKey));

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
            // 즉시 프리뷰: base64를 낙관적으로 표시
            setPreviewUrls((prev) => ({ ...prev, [imageType]: base64 }));
            const { saveImage: si } = await import('@/utils/imageUtils');
            const url = await si(
              base64,
              sheetName,
              scene.sceneId || String(scene.no),
              imageType,

            );
            const field = imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
            onFieldUpdate(sceneIndex, field, url);
            setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
          } catch (err) {
            console.error('[Ctrl+V 실패]', err);
            setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
            sonnerToast.error(`이미지 붙여넣기 실패: ${err instanceof Error ? err.message : err}`);
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
          // 즉시 프리뷰
          setPreviewUrls((prev) => ({ ...prev, [imageType]: base64 }));
          const url = await si(
            base64,
            sheetName,
            scene.sceneId || String(scene.no),
            imageType,

          );
          const field =
            imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
          onFieldUpdate(sceneIndex, field, url);
          setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
        } catch (err) {
          console.error('[파일 선택 실패]', err);
          setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
          sonnerToast.error(`이미지 저장 실패: ${err instanceof Error ? err.message : err}`);
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
        // 클립보드에서 이미지 읽기 → 즉시 프리뷰
        const dataUrl = await window.electronAPI.clipboardReadImage();
        if (!dataUrl) {
          sonnerToast.error('클립보드에 이미지가 없습니다.');
          setImageLoading(null);
          return;
        }
        // 즉시 프리뷰 표시
        setPreviewUrls((prev) => ({ ...prev, [imageType]: dataUrl }));
        // 백그라운드 업로드
        const { saveImage: si } = await import('@/utils/imageUtils');
        const url = await si(
          dataUrl,
          sheetName,
          scene.sceneId || String(scene.no),
          imageType,
        );
        const field =
          imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
        onFieldUpdate(sceneIndex, field, url);
        setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
      } catch (err) {
        console.error('[클립보드 붙여넣기 실패]', err);
        setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
        sonnerToast.error(`클립보드 붙여넣기 실패: ${err instanceof Error ? err.message : err}`);
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
            // 즉시 프리뷰
            setPreviewUrls((prev) => ({ ...prev, [imageType]: base64 }));
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
            setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
          } catch (err) {
            console.error('[Ctrl+V 실패]', err);
            setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
            sonnerToast.error(`이미지 붙여넣기 실패: ${err instanceof Error ? err.message : err}`);
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
        // 즉시 프리뷰
        setPreviewUrls((prev) => ({ ...prev, [imageType]: base64 }));
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
        setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
      } catch (err) {
        console.error('[드롭 실패]', err);
        setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
        sonnerToast.error(`이미지 드롭 실패: ${err instanceof Error ? err.message : err}`);
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
      // 1) URL 먼저 캡처 (onFieldUpdate가 비우기 전에)
      const oldUrl = deleteConfirm === 'storyboard' ? scene.storyboardUrl : scene.guideUrl;
      // 2) Storage 파일 삭제 (비동기, 실패해도 DB는 갱신)
      if (oldUrl) storageService.deleteImage(oldUrl).catch(() => {/* best-effort */});
      // 3) DB 필드 비우기
      onFieldUpdate(sceneIndex, field, '');
      setLatestImageUrls((prev) => ({ ...prev, [deleteConfirm]: '' }));
      setPreviewUrls((prev) => ({ ...prev, [deleteConfirm]: undefined }));
      setDeleteConfirm(null);
    },
    [sceneIndex, onFieldUpdate, deleteConfirm, scene.storyboardUrl, scene.guideUrl],
  );

  // 씬 네비게이션 도트 표시 여부 (2개 이상일 때만)
  const showSceneDots = totalScenes > 1;

  return (
    <AnimatePresence>
      {/* 백드롭 — data-no-lasso: 모달 내부 드래그가 뒤쪽 씬 그리드 라쏘를 트리거하지 않도록 */}
      <motion.div
        key="detail-backdrop"
        data-no-lasso
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
        onMouseDown={(e) => {
          // 모달 안 드래그가 backdrop 에서 끝나도 닫히지 않도록 mousedown 시작 위치 추적
          backdropMouseDownRef.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (backdropMouseDownRef.current && e.target === e.currentTarget) onClose();
          backdropMouseDownRef.current = false;
        }}
      >
        {/* 모달 래퍼 — 좌: 본체 + 우: 댓글 패널 (항상 표시) */}
        <motion.div
          className="relative flex gap-3"
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
                <span className="text-lg font-mono font-bold" style={{ color: deptConfig.color }}>
                  #{scene.no}
                </span>
                <span className="text-lg font-semibold text-text-primary flex-1">
                  {scene.sceneId || '(씬번호 없음)'}
                </span>
                {/* 진행률 */}
                <span className="text-sm font-mono text-text-secondary mr-2">
                  {Math.round(pct)}%
                </span>

                {/* v1.23.3 (#2 한솔 보고): BG/ACT 모달에서도 부서 토글 가능 — 통합/다른 부서로 이동 */}
                <DeptToggle scene={scene} sceneIdName={scene.sceneId || String(scene.no)} sheetName={sheetName} onClose={onClose} />

                <button
                  onClick={onClose}
                  className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-primary rounded-lg transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-6 py-5 flex flex-col gap-8">
                {/* ── 진행 단계 (프로세스 트랙) ── */}
                <section>
                  <h3 className="text-xs font-semibold text-text-secondary mb-3 px-4">
                    진행 단계
                  </h3>
                  <div className="mx-4">
                    {department === 'acting' && onActPhaseStateClick && onActFeedbackRequest && onActRoundBump ? (
                      <ScenePhaseToggle
                        scene={scene}
                        iconDisplay="always"
                        onStateClick={(next) => onActPhaseStateClick(sheetName, scene.sceneId, next)}
                        onRequestFeedback={() => onActFeedbackRequest(sheetName, scene.sceneId)}
                        onRoundBump={(kind, delta) => onActRoundBump(sheetName, scene.sceneId, kind, delta)}
                      />
                    ) : (
                      <StageSegmentToggle
                        scene={scene}
                        department={department}
                        iconDisplay="always"
                        className="bg-bg-primary/75 p-1.5 gap-1.5 border-bg-border/50"
                        segmentClassName="py-2.5 text-sm"
                        onToggle={(stage) => onToggle(scene.sceneId, stage)}
                      />
                    )}
                  </div>
                </section>

                {/* ── 속성 섹션 ── */}
                <section>
                  <h3 className="text-xs font-semibold text-text-secondary mb-2 px-4">
                    속성
                  </h3>
                  <div className="bg-bg-primary/30 rounded-xl border border-bg-border/50 divide-y divide-bg-border/30">
                    <PropertyRow
                      label="씬번호"
                      value={scene.sceneId}
                      placeholder="예: a001"
                      onSave={(v) => onFieldUpdate(sceneIndex, 'sceneId', v)}
                    />
                    {/* 담당자 — AssigneeMultiSelect 통합 (한솔 결정 2026-05-02) */}
                    <div className="flex items-start gap-3 py-2.5 px-4 hover:bg-bg-primary/40 rounded-lg transition-colors">
                      <span className="text-xs text-text-secondary w-20 shrink-0 font-medium mt-1.5">담당자</span>
                      <div className="flex-1">
                        <AssigneeMultiSelect
                          value={scene.assignee || ''}
                          onChange={(v) => onFieldUpdate(sceneIndex, 'assignee', v)}
                          placeholder="담당자 추가"
                          className="w-full"
                        />
                      </div>
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
                      memoAuthorMeta={memoAuthorMeta}
                    />
                  </div>
                </section>

                {/* ── 이미지 섹션 ─────────────────────
                     BG 모달: 편집 가능한 이미지 슬롯
                     ACT 모달: BG 에 이미지가 있으면 읽기 전용 프리뷰 노출 (정책 — ACT 슬롯 없음) */}
                {department === 'bg' ? (
                  <section>
                    <h3 className="text-xs font-semibold text-text-secondary mb-3 px-4">이미지</h3>
                    <div className="flex flex-col gap-5 px-4">
                      <ImageSlot
                        label="스토리보드"
                        url={previewUrls.storyboard ?? latestImageUrls.storyboard ?? scene.storyboardUrl}
                        loading={imageLoading === 'storyboard' && !previewUrls.storyboard}
                        uploading={!!previewUrls.storyboard}
                        onPickFile={() => pickFile('storyboard')}
                        onPasteClipboard={() => pasteClipboard('storyboard')}
                        onRemove={() => setDeleteConfirm('storyboard')}
                        onView={() => setShowImageModal(true)}
                        onPasteEvent={(e) => handlePasteEvent(e, 'storyboard')}
                        onDrop={(e) => handleDrop(e, 'storyboard')}
                      />
                      <ImageSlot
                        label="가이드"
                        url={previewUrls.guide ?? latestImageUrls.guide ?? scene.guideUrl}
                        loading={imageLoading === 'guide' && !previewUrls.guide}
                        uploading={!!previewUrls.guide}
                        onPickFile={() => pickFile('guide')}
                        onPasteClipboard={() => pasteClipboard('guide')}
                        onRemove={() => setDeleteConfirm('guide')}
                        onView={() => setShowImageModal(true)}
                        onPasteEvent={(e) => handlePasteEvent(e, 'guide')}
                        onDrop={(e) => handleDrop(e, 'guide')}
                      />
                    </div>
                  </section>
                ) : (readOnlyStoryboardUrl || readOnlyGuideUrl) ? (
                  <section>
                    <h3 className="text-xs font-semibold text-text-secondary mb-3 px-4 flex items-center gap-2">
                      이미지
                      <span className="text-[10px] font-normal text-text-secondary/50 italic">BG 에서 가져옴</span>
                    </h3>
                    <div className="flex flex-col gap-5 px-4">
                      {readOnlyStoryboardUrl && (
                        <ReadOnlyImagePreview
                          label="스토리보드"
                          url={readOnlyStoryboardUrl}
                          onView={() => setShowImageModal(true)}
                        />
                      )}
                      {readOnlyGuideUrl && (
                        <ReadOnlyImagePreview
                          label="가이드"
                          url={readOnlyGuideUrl}
                          onView={() => setShowImageModal(true)}
                        />
                      )}
                    </div>
                  </section>
                ) : null}
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

            {/* ── 컴포지팅 리비전 탭 버튼 ── */}
            <AnimatePresence>
              {!showRevisions && (
                <motion.button
                  key="revision-tab"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8, transition: { duration: 0.15 } }}
                  transition={{ delay: 0.2, duration: 0.2 }}
                  onClick={() => setShowRevisions(true)}
                  className="absolute -right-11 top-20 flex flex-col items-center gap-1 px-2 py-3 rounded-r-xl bg-bg-border/80 text-text-secondary hover:text-[#FDCB6E] transition-all cursor-pointer"
                  style={openRevCount > 0 ? { backgroundColor: 'rgba(253, 203, 110, 0.15)' } : {}}
                  title="컴포지팅 리비전"
                >
                  <Film size={18} />
                  {openRevCount > 0 && (
                    <span className="text-[11px] font-bold leading-none" style={{ color: '#FDCB6E' }}>{openRevCount}</span>
                  )}
                </motion.button>
              )}
            </AnimatePresence>

          {/* ── 컴포지팅 리비전 패널 (사이드 토글) ── */}
          <AnimatePresence>
            {showRevisions && (
              <motion.div
                key="revision-panel"
                initial={{ opacity: 0, x: 30, scaleX: 0.9 }}
                animate={{ opacity: 1, x: 0, scaleX: 1 }}
                exit={{ opacity: 0, x: 30, scaleX: 0.9 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: 'left center' }}
                className="absolute left-full top-0 ml-3 w-80 bg-bg-card rounded-2xl shadow-2xl border border-bg-border max-h-[90vh] flex flex-col"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border shrink-0">
                  <div className="flex items-center gap-2">
                    <Film size={14} style={{ color: '#FDCB6E' }} />
                    <h3 className="text-sm font-medium text-text-primary">컴포지팅</h3>
                    {revisionCount > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: '#FDCB6E', backgroundColor: 'rgba(253, 203, 110, 0.15)' }}>
                        {revisionCount}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowRevisions(false)}
                    className="p-1 text-text-secondary hover:text-text-primary rounded transition-colors cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
                <RevisionPanel
                  sheetName={sheetName}
                  sceneId={scene.sceneId}
                  department={department}
                  onCountChange={setRevisionCount}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── 댓글 패널 — 항상 표시. v1.27.0 3중 반응형 (clamp + 갯수 boost + 드래그) ── */}
          <CommentPanelResizable
            commentCount={commentCount}
            sceneKey={sceneKey}
            sceneThreadKey={sceneThreadKey}
            counterpartSheetName={counterpartSheetName}
            counterpartSceneNo={counterpartSceneNo}
            onCountChange={setCommentCount}
            inlineEvents={inlineEvents}
            focusCommentId={focusCommentId}
            sceneLabel={`${sheetName.replace(/_/g, ' ').replace(/^EP0?/, 'EP')}${scene.sceneId ? ` #${scene.sceneId}` : ''}`}
            quickRevision={{
              sceneKey: revisionSceneKey,
              context: department,
              department,
              bgAssignee: department === 'bg' ? scene.assignee : null,
              actingAssignee: department === 'acting' ? scene.assignee : null,
            }}
          />
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

      {/* 이미지 전체 뷰 모달 — ACT 모달이면 BG 에서 가져온 읽기 전용 URL 사용 */}
      {showImageModal && (
        <ImageModal
          key="detail-image-modal"
          storyboardUrl={department === 'bg' ? (latestImageUrls.storyboard ?? scene.storyboardUrl) : (readOnlyStoryboardUrl ?? '')}
          guideUrl={department === 'bg' ? (latestImageUrls.guide ?? scene.guideUrl) : (readOnlyGuideUrl ?? '')}
          sceneId={scene.sceneId}
          onClose={() => setShowImageModal(false)}
          // 씬 네비게이션 props
          hasPrevScene={hasPrev}
          hasNextScene={hasNext}
          currentSceneIndex={currentSceneIndex}
          totalScenes={totalScenes}
          onSceneNavigate={onNavigate}
          // v1.26.0: 버전 관리 + 우클릭 메뉴 메타
          sheetName={sheetName}
          sceneUuid={scene.id ?? null}
          onUploadImage={async (file, imageType) => {
            const { resizeBlob: rb, saveImage: si } = await import('@/utils/imageUtils');
            const base64 = await rb(file);
            return si(base64, sheetName, scene.sceneId || String(scene.no), imageType);
          }}
          onLatestImageUrlChange={applyLatestImageUrl}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * v1.23.3 (#2): BG/ACT 상세 모달 헤더의 부서 토글.
 * 클릭 시 selectedDepartment(+dashboardDeptFilter) 변경 + 모달 닫음 + 같은 컷 자동 재오픈 (pendingSceneModalRequest).
 * UnifiedSceneDetailModal 의 handleDeptToggle 과 동일 패턴.
 */
function DeptToggle({ scene, sceneIdName, sheetName, onClose }: { scene: Scene; sceneIdName: string; sheetName: string; onClose: () => void }) {
  const selectedDepartment = useAppStore((s) => s.selectedDepartment);
  const setSelectedDepartment = useAppStore((s) => s.setSelectedDepartment);
  const setDashboardDeptFilter = useAppStore((s) => s.setDashboardDeptFilter);
  const setPendingSceneModalRequest = useAppStore((s) => s.setPendingSceneModalRequest);
  const dataEpisodes = useDataStore((s) => s.episodes);

  const handle = useCallback((next: 'all' | 'bg' | 'acting') => {
    if (next === selectedDepartment) return;
    // codex 3차 P2: scene.sceneId 가 빈 문자열일 수 있음 — || 로 fallback (?? 는 빈 문자열도 truthy 취급).
    const sceneIdValue = scene.sceneId || sceneIdName;

    // codex 1·2차 P1: target dept 에 같은 sceneId 의 씬이 존재하는지 검사 — 없으면 pending 안 보냄.
    //   2차 P1: 같은 sceneId 가 다른 EP/Part 에서 reuse 될 수 있어 cross-context 매칭 위험.
    //     현재 sheetName 으로 EP+Part 컨텍스트 찾고, target dept 의 같은 EP+partId 인 part 안에서만 매칭.
    let targetUuid: string | undefined = scene.id;
    let hasTarget = next === 'all';
    if (next !== 'all' && sceneIdValue) {
      // 1) 현재 sheetName 의 EP+partId 컨텍스트 찾기
      let currentEpisodeNumber: number | undefined;
      let currentPartId: string | undefined;
      for (const ep of dataEpisodes) {
        const part = ep.parts.find((p) => p.sheetName === sheetName);
        if (part) {
          currentEpisodeNumber = ep.episodeNumber;
          currentPartId = part.partId;
          break;
        }
      }
      // 2) 같은 EP + partId + target dept 인 part 안에서만 sceneId 매칭
      if (currentEpisodeNumber != null && currentPartId != null) {
        const epRow = dataEpisodes.find((e) => e.episodeNumber === currentEpisodeNumber);
        const targetPart = epRow?.parts.find((p) => p.partId === currentPartId && p.department === next);
        const found = targetPart?.scenes.find((s) => s.sceneId === sceneIdValue);
        if (found) {
          targetUuid = found.id;
          hasTarget = true;
        }
      }
    }

    setSelectedDepartment(next);
    setDashboardDeptFilter(next);
    onClose();

    const label = next === 'all' ? '통합' : next === 'bg' ? 'BG' : '액팅';
    if (hasTarget) {
      setTimeout(() => {
        setPendingSceneModalRequest({ sceneUuid: targetUuid, sceneName: sceneIdValue ?? undefined });
      }, 120);
      sonnerToast.success(`${label} 모드로 전환 — 같은 컷 모달 다시 엽니다`, { duration: 1800 });
    } else {
      sonnerToast.info(`${label} 모드로 전환했어요`, {
        description: '이 컷은 ' + label + ' 데이터가 없어 모달이 다시 열리지 않습니다.',
        duration: 2400,
      });
    }
  }, [selectedDepartment, setSelectedDepartment, setDashboardDeptFilter, setPendingSceneModalRequest, scene.id, scene.sceneId, sceneIdName, onClose, dataEpisodes]);

  return (
    <div className="flex gap-[2px] bg-bg-border/40 p-[2px] rounded-md shrink-0 mr-1">
      {(['all', 'bg', 'acting'] as const).map((d) => (
        <button
          key={d}
          onClick={() => handle(d)}
          className={cn(
            'px-2 py-1 rounded-[4px] text-[10.5px] cursor-pointer transition-all whitespace-nowrap',
            selectedDepartment === d ? 'bg-accent/22 text-accent-sub' : 'text-text-secondary hover:text-text-primary',
          )}
          style={selectedDepartment === d ? { boxShadow: 'inset 0 0 0 1px rgba(108, 92, 231, 0.32)' } : {}}
          title={d === 'all' ? '통합 모드로 전환' : d === 'bg' ? 'BG 모드로 전환' : '액팅 모드로 전환'}
        >
          {d === 'all' ? '통합' : d === 'bg' ? 'BG' : '액팅'}
        </button>
      ))}
    </div>
  );
}
