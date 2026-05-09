import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast as sonnerToast } from 'sonner';
import { motion, AnimatePresence, useAnimationControls } from 'framer-motion';
import { formatStamp } from '@/utils/formatTime';
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
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Scene, Stage, Department } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import { AssigneeMultiSelect, AssigneeChipList } from '@/components/common/AssigneeMultiSelect';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';
import { resizeBlob } from '@/utils/imageUtils';
import { ImageModal } from './ImageModal';
import { CommentPanel, type CommentInlineEvent } from './CommentPanel';
import { RevisionPanel } from './RevisionPanel';
import { SceneFilesTab } from './SceneFilesTab';
import { SceneHistoryTab } from './SceneHistoryTab';
import { useSceneActivities } from '@/hooks/useSceneActivities';
import { describeActivity, deptPrefix } from './activityLabels';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { buildSceneKey } from '@/services/revisionService';
import { buildMergedRevisionSceneId } from '@/utils/mergedSceneHelpers';

/**
 * 전체 뷰(BG+ACT 통합) 전용 상세 모달.
 *
 * SCENE-MODAL-A 디자인 적용 (mockup 핸드오프 §3 그라디언트 풀세트):
 *  - 모달 chrome: 라운드 18, 그림자 강화, 배경 글로우 두 개 (보라+코랄)
 *  - 부서 패널: 상단 2px 라이트 라인 + 보더 알파
 *  - 본체 내 탭 구조 (상세 / 리비전·N) — 우측 토글 패널 제거
 *  - 헤더 글래스 backdrop blur
 *
 * 보존 (한솔 결정 — "버튼 디자인 가만 놔두고"):
 *  - 진행 단계 칩, 댓글 입력/전송, 헤더 아이콘 버튼, 부서 휴지통/추가, 이미지 슬롯 액션,
 *    인라인 편집(담당자/메모) 모두 기존 그대로.
 */

/**
 * 모달 시각 토큰 — 한솔 결정 (2026-05-02): hardcode 보라/코랄 제거, 모두 테마 CSS variable.
 *  - 글로우/탭 글로우/멘션 등 = accent / accent-sub (한솔 테마 따름)
 *  - 부서 라이트 라인/보더 = 부서 자체 색 (DEPARTMENT_CONFIGS[dept].color) — 다른 화면과 일관성
 *  - 위험 (씬 삭제) = red 시멘틱 (Tailwind red-400/500)
 */
const SMA = {
  /** 글로우/탭/멘션 — 테마 accent */
  accentRgb: 'rgb(var(--color-accent))',
  accentSubRgb: 'rgb(var(--color-accent-sub))',
  /** alpha 합성용 — `rgb(var(--color-accent) / 0.30)` 같은 형태 */
  accentAlpha: (a: number) => `rgb(var(--color-accent) / ${a})`,
  accentSubAlpha: (a: number) => `rgb(var(--color-accent-sub) / ${a})`,
} as const;

/** 부서 → 시각 색 (DEPARTMENT_CONFIGS 의 글로벌 부서 색 사용 — 다른 화면과 일관) */
const deptVisualColor = (dept: Department): string => DEPARTMENT_CONFIGS[dept].color;

/** 좌우 이동 슬라이드 — direction 1=다음(우→좌 슬라이드), -1=이전(좌→우 슬라이드)
 * 한솔 요청(2026-05-02): 더 길고 부드럽게 — 거리 ±48px, duration 0.45s.
 */
const navVariants = {
  enter: (dir: 1 | -1) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:  (dir: 1 | -1) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
};

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
  /** v1.18.0: 알림 클릭 등 외부에서 모달 열 때 시작 탭 지정. */
  initialTab?: TabKey;
  /** v1.18.0: 'revisions' 탭에서 강조할 리비전 id — scrollIntoView + pulse 애니메이션. */
  focusRevisionId?: string;
}

type TabKey = 'detail' | 'revisions' | 'files' | 'history';

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
  initialTab,
  focusRevisionId,
}: UnifiedSceneDetailModalProps) {
  const { bgScene, actScene, bgSceneIndex, actSceneIndex } = merged;
  const headScene = bgScene ?? actScene;
  // v1.23.2 (#1 재설계): localDeptOverride 제거. 한솔 의도 = 토글 클릭이 전역 부서 모드 변경 +
  // 모달 닫음 → 사용자가 같은 컷 다시 클릭 시 새 부서 모드의 모달이 열림 ("이동").
  // codex 2차 P1: ScenesView 가 useAppStore.selectedDepartment 로 라우팅 — 그것도 같이 변경 안 하면
  //   같은 통합 모달이 다시 열려서 토글 무효. dashboardDeptFilter (대시보드 위젯용) 도 함께 변경하여 일관성 유지.
  const selectedDepartment = useAppStore((s) => s.selectedDepartment);
  const setSelectedDepartment = useAppStore((s) => s.setSelectedDepartment);
  const setDashboardDeptFilter = useAppStore((s) => s.setDashboardDeptFilter);
  const handleDeptToggle = useCallback((next: 'all' | 'bg' | 'acting') => {
    if (next === selectedDepartment) return;
    setSelectedDepartment(next);
    setDashboardDeptFilter(next);
    const label = next === 'all' ? '통합' : next === 'bg' ? '배경' : '액팅';
    sonnerToast.success(`${label} 모드로 전환했어요`, {
      description: '같은 컷을 다시 클릭하면 ' + label + ' 모달이 열립니다',
      duration: 3000,
    });
    onClose();
  }, [selectedDepartment, setSelectedDepartment, setDashboardDeptFilter, onClose]);
  // 모달 backdrop 드래그 닫힘 방지 — mousedown 시작 위치를 추적해 backdrop 자체에서 시작한 경우만 onClose 트리거
  const backdropMouseDownRef = useRef(false);

  // 댓글 키: BG와 ACT 양쪽 조회 가능하게.
  // primary 는 "실제로 이 merged 에 존재하는 부서" 와 일치해야 한다 —
  // ACT-only 병합 항목에서 BG sheetName 을 쓰면 ACT 씬 번호가 BG 시트 경로로 라우팅되어
  // 댓글/리비전이 엉뚱한 키에 저장되는 문제가 생김.
  const primaryScene = bgScene ?? actScene;
  const primarySheet = bgScene
    ? (bgSheetName ?? '')
    : (actSheetName ?? '');
  const primaryCommentKey = primaryScene && primarySheet ? `${primarySheet}:${primaryScene.no}` : '';
  // BG + ACT 양쪽이 다 있을 때만 secondary (상대편) 설정.
  const secondarySheet = bgScene && actScene && bgSheetName && actSheetName ? actSheetName : null;
  const secondaryScene = bgScene && actScene && bgSheetName && actSheetName ? actScene : null;
  const secondaryCommentKey = secondarySheet && secondaryScene ? `${secondarySheet}:${secondaryScene.no}` : '';

  const unifiedSceneId = merged.sceneId || primaryScene?.sceneId || '';

  // 리비전 키 — buildSceneKey 가 부서 구분 없이 EP:Part:sceneId 로 해싱되므로 BG/ACT 공용
  const revisionSheetName = primarySheet;
  const revisionSceneId = buildMergedRevisionSceneId(merged) || primaryScene?.sceneId || unifiedSceneId;
  const episodes = useDataStore((s) => s.episodes);
  const revisionSiblingSceneIds = useMemo(() => {
    if (!revisionSheetName) return [];

    for (const episode of episodes) {
      const part = episode.parts.find((candidate) => candidate.sheetName === revisionSheetName);
      if (part) return part.scenes.map((scene) => scene.sceneId);
    }

    return [];
  }, [episodes, revisionSheetName]);
  const revisionSceneKey = revisionSheetName && revisionSceneId
    ? buildSceneKey(revisionSheetName, revisionSceneId, { siblingSceneIds: revisionSiblingSceneIds })
    : '';
  const openRevCount = useRevisionStore((s) => revisionSceneKey ? s.getOpenCount(revisionSceneKey) : 0);

  // UI state — v1.18.0: initialTab 으로 외부에서 시작 탭 지정 가능 (알림 클릭 시 'revisions' 등)
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'detail');
  const [commentCount, setCommentCount] = useState(0);
  const [revisionCount, setRevisionCount] = useState(0);

  // v1.18.0: initialTab 변경 → 활성 탭 동기화 (모달이 마운트된 상태에서 다른 알림 클릭 시).
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // v1.18.0: 댓글 패널의 [re#] 칩 클릭 → 리비전 탭 + 카드 강조 + 스레드 펼침.
  // CommentPanel(같은 모달 내부) 이 'bflow:jump-to-revision' 을 dispatch 한다.
  useEffect(() => {
    function onJump(e: Event) {
      const detail = (e as CustomEvent<{ revisionId?: string }>).detail;
      const revisionId = detail?.revisionId;
      if (!revisionId) return;
      setTab('revisions');
      // 다음 paint 에서 카드 scrollIntoView + pulse + 스레드 펼침 신호.
      // 탭 전환 직후엔 카드가 아직 마운트 안 됐을 수 있어 retry 패턴(focusRevisionId 와 동일).
      let retries = 8;
      const attempt = () => {
        const card = document.getElementById(`rev-card-${revisionId}`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.remove('rev-pulse');
          // reflow trigger — 같은 카드 재클릭 시 애니메이션 재실행
          void (card as HTMLElement).offsetWidth;
          card.classList.add('rev-pulse');
          // 카드 내 댓글 스레드 펼침 신호 (RevisionCommentThread 가 listen)
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

  // v1.18.0: focusRevisionId 강조 — 활성 탭이 'revisions' 일 때 카드를 scrollIntoView + pulse 클래스 부여.
  // 카드 element 는 RevisionCard 의 root motion.div 가 id={`rev-card-${revision.id}`} 로 설정.
  useEffect(() => {
    if (!focusRevisionId || tab !== 'revisions') return;

    let cancelled = false;
    let removeTimer: ReturnType<typeof setTimeout> | null = null;
    // requestAnimationFrame 으로 다음 paint 대기 — 탭 전환 직후엔 카드가 아직 마운트 안 됐을 수 있음.
    // 추가로 50ms delay 한 번 더 (RevisionPanel loadRevisions 비동기 완료 대기).
    const attempt = (retries: number) => {
      if (cancelled) return;
      const el = document.getElementById(`rev-card-${focusRevisionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('rev-pulse');
        // animation 길이 (1.2s × 2회) 보다 약간 길게 → 자동 제거
        removeTimer = setTimeout(() => {
          el.classList.remove('rev-pulse');
        }, 2600);
      } else if (retries > 0) {
        setTimeout(() => requestAnimationFrame(() => attempt(retries - 1)), 100);
      }
    };
    requestAnimationFrame(() => attempt(8));

    return () => {
      cancelled = true;
      if (removeTimer) clearTimeout(removeTimer);
    };
  }, [focusRevisionId, tab]);
  const [showImageModal, setShowImageModal] = useState<null | 'storyboard' | 'guide'>(null);
  const [imageLoading, setImageLoading] = useState<null | 'storyboard' | 'guide'>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<null | 'storyboard' | 'guide' | 'bg' | 'act' | 'both'>(null);
  const [previewUrls, setPreviewUrls] = useState<{ storyboard?: string; guide?: string }>({});
  const addingRef = useRef<{ bg: boolean; acting: boolean }>({ bg: false, acting: false });

  // 좌우 이동 슬라이드 방향 (1=다음, -1=이전). 키보드/버튼/도트 모두 handleNavigate 경유.
  const [navDirection, setNavDirection] = useState<1 | -1>(1);
  const handleNavigate = useCallback((dir: 'prev' | 'next') => {
    setNavDirection(dir === 'next' ? 1 : -1);
    onNavigate?.(dir);
  }, [onNavigate]);

  // 모달 박스 + 댓글 패널 wrapper 의 좌우 흔들림 (한솔 요청: "본체와 댓글 창 같이 옆으로 움직임")
  // navigate 시 wrapper 가 ±36px 슬라이드 → 본체와 댓글이 함께 밀림.
  const wrapperControls = useAnimationControls();
  const isFirstNavRef = useRef(true);
  useEffect(() => {
    if (isFirstNavRef.current) {
      isFirstNavRef.current = false;
      return;
    }
    wrapperControls.start({
      x: [navDirection > 0 ? -56 : 56, 0],
      transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1], times: [0, 1] },
    });
    // navDirection 도 deps 에 넣으면 같은 방향 연속 navigate 시 효과 안 발동 — currentMergedIndex 만 추적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMergedIndex]);

  // 리비전 탭 라벨용 — open 우선, 없으면 전체
  const revisionTabBadge = openRevCount > 0 ? openRevCount : (revisionCount > 0 ? revisionCount : 0);

  // 헤더 합산 퍼센트 — 양쪽 다 있으면 평균, 한쪽만 있으면 그 쪽
  const bgPct = bgScene ? sceneProgress(bgScene) : null;
  const actPct = actScene ? sceneProgress(actScene) : null;
  const totalPct =
    bgPct !== null && actPct !== null ? Math.round((bgPct + actPct) / 2) : (bgPct ?? actPct ?? null);

  // 모든 탭 + 댓글창 인라인이 공유하는 활동 데이터 — 모달이 단일 owner.
  const sceneActivities = useSceneActivities([bgScene?.id, actScene?.id], 200);

  // 댓글 패널 인라인 — 한솔 결정 (2026-05-02): "큰 이벤트만". 단계 개별 토글/담당자/레이아웃은 제외.
  // 추가: Scene.completedAt + completedBy 로 "단계 전부 완료" derive (activity_log 별도 actionType 없음).
  const inlineEvents: CommentInlineEvent[] = useMemo(() => {
    const BIG_EVENT_TYPES = new Set([
      'memo_update',
      'image_upload_storyboard', 'image_upload_guide',
      'scene_add',
      'revision_add', 'revision_in_progress', 'revision_resolve', 'revision_delete',
    ]);
    const events: CommentInlineEvent[] = sceneActivities
      .filter((a) => BIG_EVENT_TYPES.has(a.actionType))
      .map<CommentInlineEvent>((a) => {
        const v = describeActivity(a);
        return {
          id: a.id,
          at: a.createdAt,
          text: `${a.userName} ${deptPrefix(a.department)}${v.text}`,
        };
      });
    // 단계 전부 완료 derive — Scene.completedAt + completedBy
    if (bgScene?.completedAt && bgScene.completedBy) {
      events.push({
        id: `completed:bg:${bgScene.id ?? 'na'}`,
        at: bgScene.completedAt,
        text: `${bgScene.completedBy} BG · 모든 단계 완료`,
      });
    }
    if (actScene?.completedAt && actScene.completedBy) {
      events.push({
        id: `completed:act:${actScene.id ?? 'na'}`,
        at: actScene.completedAt,
        text: `${actScene.completedBy} ACT · 모든 단계 완료`,
      });
    }
    return events;
  }, [sceneActivities, bgScene, actScene]);

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
      if (e.key === 'ArrowLeft' && hasPrev) handleNavigate('prev');
      if (e.key === 'ArrowRight' && hasNext) handleNavigate('next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, handleNavigate, hasPrev, hasNext, showImageModal, deleteConfirm]);

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

  const sceneNoDisplay = unifiedSceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(headScene.no);
  const showSceneDots = totalMerged > 0 && totalMerged <= 80;

  return (
    <AnimatePresence>
      {/* data-no-lasso: 모달 내부 드래그가 뒤쪽 씬 그리드 라쏘를 트리거하지 않도록 */}
      <motion.div
        data-no-lasso
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-4"
        onMouseDown={(e) => {
          backdropMouseDownRef.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (backdropMouseDownRef.current && e.target === e.currentTarget) {
            onClose();
          }
          backdropMouseDownRef.current = false;
        }}
      >
        {/* ── flex 래퍼 — 본체 + 댓글 (좌우 이동 시 같이 흔들기 위해 motion.div 로 감쌈) ── */}
        <motion.div
          animate={wrapperControls}
          className="flex gap-3 items-stretch max-w-full max-h-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── 본체 ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-[min(720px,calc(100vw-26rem))] h-[min(720px,90vh)] flex flex-col bg-bg-card border border-bg-border overflow-hidden"
            style={{ borderRadius: 18, boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }}
          >
            {/* §3-1 배경 글로우 두 개 — 시그니처 */}
            <div
              aria-hidden
              style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -100,
                  left: -100,
                  width: 400,
                  height: 400,
                  borderRadius: 999,
                  background: `radial-gradient(circle, ${SMA.accentAlpha(0.19)} 0%, transparent 60%)`,
                  filter: 'blur(40px)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: -150,
                  right: -100,
                  width: 500,
                  height: 500,
                  borderRadius: 999,
                  background: `radial-gradient(circle, ${SMA.accentSubAlpha(0.14)} 0%, transparent 60%)`,
                  filter: 'blur(50px)',
                }}
              />
            </div>

            {/* 본체 컨텐츠 — 글로우 위에 얹기 */}
            <div className="relative z-[1] flex flex-col h-full min-h-0">
              {/* 헤더 (글래스) */}
              <div
                className="flex items-center gap-3 px-5 py-3 border-b border-bg-border/40 shrink-0"
                style={{
                  background: 'rgba(255,255,255,0.015)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                }}
              >
                <AnimatePresence mode="wait" custom={navDirection} initial={false}>
                  <motion.div
                    key={`hdr:${currentMergedIndex}:${unifiedSceneId}`}
                    custom={navDirection}
                    variants={navVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-2 min-w-0"
                  >
                    <span className="text-sm font-mono text-text-secondary/50">#{sceneNoDisplay}</span>
                    <span className="text-lg font-mono font-bold text-text-primary truncate">
                      {unifiedSceneId || headScene.sceneId || '(씬번호 없음)'}
                    </span>
                    {headScene.layoutId && (
                      <span className="text-xs italic text-text-secondary/50 shrink-0">L#{headScene.layoutId}</span>
                    )}
                    {(episodeLabel || partLabel) && (
                      <span className="text-xs text-text-secondary/50 shrink-0">
                        {[episodeLabel, partLabel].filter(Boolean).join(' / ')}
                      </span>
                    )}
                    {totalPct !== null && (
                      <span
                        className="text-[11px] font-bold text-text-primary px-2 py-0.5 rounded-full bg-white/[0.06] tabular-nums shrink-0"
                        style={{ marginLeft: 6 }}
                        title="BG · ACT 합산 진행률"
                      >
                        {totalPct}%
                      </span>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* 네비게이션 — handleNavigate 경유 (방향 추적) */}
                {(hasPrev || hasNext) && (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => handleNavigate('prev')}
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
                      onClick={() => handleNavigate('next')}
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

                {/* v1.23.2 (#1 재설계): 토글 = 전역 selectedDepartment(+dashboardDeptFilter) 변경 + 모달 닫음 → 같은 컷 다시 클릭 시 새 부서 모달. */}
                <div className="flex gap-[2px] bg-bg-border/40 p-[2px] rounded-md shrink-0">
                  {(['all', 'bg', 'acting'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => handleDeptToggle(d)}
                      className={cn(
                        'px-2 py-1 rounded-[4px] text-[10.5px] cursor-pointer transition-all whitespace-nowrap',
                        selectedDepartment === d ? 'bg-accent/22 text-accent-sub' : 'text-text-secondary hover:text-text-primary',
                      )}
                      style={selectedDepartment === d ? { boxShadow: 'inset 0 0 0 1px rgba(108, 92, 231, 0.32)' } : {}}
                      title={d === 'all' ? '통합 모드로 전환 (모달 닫고 다시 클릭하면 BG+액팅 모달)' : d === 'bg' ? '배경 모드로 전환' : '액팅 모드로 전환'}
                    >
                      {d === 'all' ? '통합' : d === 'bg' ? 'BG' : '액팅'}
                    </button>
                  ))}
                </div>

                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer transition-colors shrink-0"
                  title="닫기"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 탭 (상세 / 리비전·N / 파일 / 히스토리) */}
              <div className="flex gap-1 px-5 border-b border-bg-border/40 shrink-0">
                <TabButton active={tab === 'detail'} onClick={() => setTab('detail')}>
                  상세
                </TabButton>
                <TabButton
                  active={tab === 'revisions'}
                  onClick={() => setTab('revisions')}
                  badge={revisionTabBadge > 0 ? revisionTabBadge : undefined}
                >
                  리비전
                </TabButton>
                <TabButton active={tab === 'files'} onClick={() => setTab('files')}>
                  파일
                </TabButton>
                <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
                  히스토리
                </TabButton>
              </div>

              {/* 본체: 탭에 따라 분기 + 좌우 이동 슬라이드 애니메이션 */}
              <div className="flex-1 min-h-0 relative overflow-hidden">
                <AnimatePresence mode="wait" custom={navDirection} initial={false}>
                  <motion.div
                    key={`body:${tab}:${currentMergedIndex}`}
                    custom={navDirection}
                    variants={navVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full overflow-auto"
                  >
                    {tab === 'detail' && (
                      <>
                        {/* 이미지 (BG 기준) */}
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

                        {/* 좌 BG | 우 ACT — 듀얼 패널 (v1.23.0 동작 복원). 부서 전환은 헤더 토글로. */}
                        <div className="grid grid-cols-2 gap-3 px-5 py-4">
                          <DeptSection
                            dept="bg"
                            scene={bgScene}
                            sheetName={bgSheetName}
                            sceneIndex={bgSceneIndex}
                            sceneId={bgScene?.sceneId ?? merged.sceneId}
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
                            sceneId={actScene?.sceneId ?? merged.sceneId}
                            onToggle={onToggle}
                            onFieldUpdate={onFieldUpdate}
                            onDelete={() => setDeleteConfirm('act')}
                            onAdd={() => handleAddDept('acting')}
                          />
                        </div>

                        {/* 메타 줄 — 등록/수정 (Supabase scenes.created_at / updated_at) */}
                        <SceneMetaRow bgScene={bgScene} actScene={actScene} />
                      </>
                    )}

                    {tab === 'revisions' && revisionSheetName && revisionSceneId && (
                      <RevisionPanel
                        sheetName={revisionSheetName}
                        sceneId={revisionSceneId}
                        siblingSceneIds={revisionSiblingSceneIds}
                        onCountChange={setRevisionCount}
                      />
                    )}

                    {tab === 'files' && revisionSceneKey && (
                      <SceneFilesTab
                        bgScene={bgScene}
                        primaryCommentKey={primaryCommentKey}
                        secondaryCommentKey={secondaryCommentKey || undefined}
                        revisionSceneKey={revisionSceneKey}
                      />
                    )}

                    {tab === 'history' && (
                      <SceneHistoryTab activities={sceneActivities} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* 하단 도트 인디케이터 — merged 단위 (상세 탭에서만) */}
              {tab === 'detail' && showSceneDots && onNavigate && (
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
                            setTimeout(() => handleNavigate(dir), j * 30);
                          }
                        }}
                        className={cn(
                          'rounded-full transition-all duration-300 cursor-pointer',
                          isCurrent ? 'w-5 h-1.5 bg-accent' : 'w-1.5 h-1.5 bg-text-secondary/30 hover:bg-text-secondary/50',
                        )}
                        style={isCurrent ? { boxShadow: '0 0 6px rgb(var(--color-accent))' } : undefined}
                        title={`씬 ${i + 1}`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

          {/* ── 댓글 패널 (상시 표시) — 본체와 같은 높이 */}
          {primaryCommentKey && (
            <motion.div
              key="comment-panel"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              className="w-80 bg-bg-card shadow-2xl border border-bg-border h-[min(720px,90vh)] flex flex-col shrink-0 overflow-hidden"
              style={{ borderRadius: 18 }}
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
                inlineEvents={inlineEvents}
              />
            </motion.div>
          )}
        </motion.div>
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

/* ── 탭 버튼 ── */

function TabButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative px-3 py-2.5 text-[12.5px] font-bold cursor-pointer flex items-center gap-1.5 transition-colors',
        active ? 'text-accent-sub' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      <span>{children}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-accent/20 text-accent-sub">
          {badge}
        </span>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute left-3 right-3 -bottom-px h-0.5 rounded-sm bg-accent"
          style={{ boxShadow: '0 0 8px rgb(var(--color-accent))' }}
        />
      )}
    </button>
  );
}

/* ── 씬 메타 줄 (등록/수정) ── */

function SceneMetaRow({ bgScene, actScene }: { bgScene: Scene | null; actScene: Scene | null }) {
  // 둘 중 가장 빠른 createdAt = 씬 등록 시각
  const created = pickEarliest([bgScene?.createdAt, actScene?.createdAt]);
  // 둘 중 가장 늦은 updatedAt = 마지막 수정 시각
  const updated = pickLatest([bgScene?.updatedAt, actScene?.updatedAt]);
  // 모두 없으면 메타 줄 자체를 숨김
  if (!created && !updated) return null;
  return (
    <div className="mx-5 mb-4 px-4 py-2.5 rounded-lg border border-bg-border/40 bg-white/[0.02] flex items-center gap-5 text-[11.5px]">
      {created && <MetaItem label="등록" value={formatStamp(created, { withYearAlways: true })} />}
      {updated && updated !== created && (
        <MetaItem label="수정" value={formatStamp(updated, { withYearAlways: true })} />
      )}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-text-secondary/60 text-[10px] mb-0.5">{label}</span>
      <span className="text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

function pickEarliest(items: Array<string | undefined>): string | undefined {
  const valid = items.filter((s): s is string => !!s);
  if (valid.length === 0) return undefined;
  return valid.reduce((a, b) => (new Date(a).getTime() <= new Date(b).getTime() ? a : b));
}
function pickLatest(items: Array<string | undefined>): string | undefined {
  const valid = items.filter((s): s is string => !!s);
  if (valid.length === 0) return undefined;
  return valid.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b));
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
  const visualColor = deptVisualColor(dept);

  // 빈 상태 — 부서 추가 버튼은 기존 그대로
  if (!scene || !sheetName) {
    return (
      <div
        className="relative flex flex-col items-center justify-center py-14 px-6 text-center gap-3 min-h-[280px] rounded-xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.025)',
          border: `1px solid ${visualColor}25`,
        }}
      >
        <DeptTopLine color={visualColor} />
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: visualColor }}>
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: visualColor, boxShadow: `0 0 8px ${visualColor}` }}
          />
          {cfg.shortLabel}
        </div>
        <span className="text-xs text-text-secondary/50">아직 등록되지 않았습니다</span>
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
    <div
      className="relative p-4 flex flex-col gap-4 rounded-xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${visualColor}25`,
      }}
    >
      <DeptTopLine color={visualColor} />

      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: visualColor, boxShadow: `0 0 8px ${visualColor}` }}
        />
        <span className="text-sm font-semibold" style={{ color: visualColor }}>
          {cfg.shortLabel}
        </span>
        <span className="text-xs text-text-secondary/70">{cfg.label}</span>
        <span className="ml-auto text-xs text-text-secondary tabular-nums font-semibold">{pct}%</span>
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
        {/* 진행 단계 칩 — 기존 그대로 (한솔 결정: 버튼 디자인 유지) */}
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

/** §3-2 부서 패널 상단 그라디언트 라이트 라인 + 글로우 */
function DeptTopLine({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: `linear-gradient(90deg, ${color}, transparent)`,
        boxShadow: `0 0 8px ${color}80`,
        pointerEvents: 'none',
      }}
    />
  );
}

/* ── 인라인 담당자 ── */

function InlineAssigneeRow({ label, value, onSave }: {
  label: string; value: string; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  // 칩 단위 변경마다 즉시 저장 (한솔: 매번 commit 안전)
  return (
    <div>
      <span className="block text-xs text-text-secondary mb-1.5">{label}</span>
      {editing ? (
        <AssigneeMultiSelect
          value={value}
          onChange={onSave}
          onClose={() => setEditing(false)}
          className="w-full"
          autoFocus
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full text-left px-3 py-2 rounded-md border border-transparent hover:border-accent/30 hover:bg-accent/5 text-sm cursor-pointer transition-colors"
        >
          <AssigneeChipList value={value} />
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
        <div
          onClick={() => setEditing(true)}
          className="w-full text-left px-3 py-2 rounded-lg border border-transparent text-sm text-text-primary min-h-[40px] cursor-pointer transition-colors whitespace-pre-wrap hover:border-accent/30 hover:bg-accent/5"
          style={{ background: value ? 'rgba(255,255,255,0.025)' : undefined }}
        >
          {value
            ? <PathLinkifiedText text={value} />
            : <span className="text-text-secondary/50">메모 없음</span>}
          {value && (
            <Pencil size={12} className="inline-block ml-2 opacity-0 hover:opacity-60 transition-opacity" />
          )}
        </div>
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
