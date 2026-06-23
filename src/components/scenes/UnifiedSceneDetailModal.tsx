import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast as sonnerToast } from 'sonner';
import { motion, AnimatePresence, useAnimationControls } from 'framer-motion';
import { formatStamp, formatTime } from '@/utils/formatTime';
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
  Pin,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Scene, Stage, Department, ScenePhaseState } from '@/types';
import { ScenePhaseToggle } from './ScenePhaseToggle';
import { StageSegmentToggle } from './StageSegmentToggle';
import { sceneProgress } from '@/utils/calcStats';
import { AssigneeMultiSelect, AssigneeChipList } from '@/components/common/AssigneeMultiSelect';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { EntityText } from '@/components/common/EntityText';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import type { HashTarget } from '@/utils/hashEntity';
import { resizeBlob } from '@/utils/imageUtils';
import { ImageModal } from './ImageModal';
import type { CommentInlineEvent } from './CommentPanel';
import { CommentPanelResizable } from './CommentPanelResizable';
import { RevisionPanel } from './RevisionPanel';
import { EntityHashContextMenu } from './EntityHashContextMenu';
import { SceneFilesTab } from './SceneFilesTab';
import { SceneHistoryTab } from './SceneHistoryTab';
import { useSceneActivities } from '@/hooks/useSceneActivities';
import { describeActivity, deptPrefix } from './activityLabels';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { buildSceneKey } from '@/services/revisionService';
import { buildSceneThreadKeyFromRevisionKey } from '@/utils/commentThreadKey';
import { buildMergedRevisionSceneId } from '@/utils/mergedSceneHelpers';
import { findLatestMemoActivity, type MemoAuthorMeta } from './memoAuthorMeta';
import { SceneContinuityTransition } from './SceneContinuityTransition';
import { useOptimisticSceneImageUrl } from '@/hooks/useOptimisticSceneImageUrl';
import { AssigneeProgressStack } from './AssigneeProgressStack';
import { hasMultiAssigneeProgress } from '@/utils/assigneeProgress';

/**
 * 전체 뷰(BG+ACT 통합) 전용 상세 모달.
 *
 * SCENE-MODAL-A 디자인 적용 (mockup 핸드오프 §3 그라디언트 풀세트):
 *  - 모달 chrome: 라운드 18, 그림자 강화, 배경 글로우 두 개 (보라+코랄)
 *  - 부서 패널: 상단 2px 라이트 라인 + 보더 알파
 *  - 본체 내 탭 구조 (상세 / 리테이크·N) — 우측 토글 패널 제거
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
  onToggle: (sheetName: string, sceneId: string, stage: Stage, options?: { sceneUuid?: string | null; sceneIndex?: number }) => void;
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
  /** v1.18.0: 'revisions' 탭에서 강조할 리테이크 id — scrollIntoView + pulse 애니메이션. */
  focusRevisionId?: string;
  /** v1.24.0: 댓글 패널에서 강조할 댓글 id — 자동 스크롤 + comment-target-pulse. */
  focusCommentId?: string;
  /** 리테이크 카드 내부 댓글 스레드에서 강조할 댓글 id. */
  focusRevisionCommentId?: string;
  /** v1.25.0~: 액팅 단계 토글 핸들러 (전달되면 ACT DeptSection 에서 ScenePhaseToggle 사용) */
  onActPhaseStateClick?: (sheetName: string, sceneId: string, newState: ScenePhaseState, sceneUuid?: string | null, sceneIndex?: number) => void;
  onActFeedbackRequest?: (sheetName: string, sceneId: string) => void;
  onActRoundBump?: (sheetName: string, sceneId: string, kind: 'work' | 'feedback', delta: 1 | -1) => void;
  onAssigneeStageToggle?: (sheetName: string, sceneId: string, assigneeName: string, stage: Stage, sceneUuid?: string | null, sceneIndex?: number, dept?: Department) => void;
  onAssigneeActPhaseStateClick?: (sheetName: string, sceneId: string, assigneeName: string, newState: ScenePhaseState, sceneUuid?: string | null, sceneIndex?: number) => void;
  onAssigneeActFeedbackRequest?: (sheetName: string, sceneId: string, assigneeName: string, sceneUuid?: string | null, sceneIndex?: number) => void;
  onAssigneeActRoundBump?: (sheetName: string, sceneId: string, assigneeName: string, kind: 'work' | 'feedback', delta: 1 | -1, sceneUuid?: string | null, sceneIndex?: number) => void;
  /** 카드 뷰에서 열릴 때 카드 내부 요소를 실제 모달 위치로 연결하는 시작 DOM. */
  continuitySourceElement?: HTMLElement | null;
  /** continuity transition 종료 후 source DOM 참조를 비울 때 사용. */
  onContinuityEnd?: () => void;
  /**
   * v1.30.0+: 컴포지팅 대시보드에서 모달을 열 때 부서 패널 위에 끼울 컴포지팅 단계 섹션.
   * 일반 ScenesView 호출은 이 prop 을 생략하면 normal 모드 (영향 0).
   * 컴포지팅 컨텍스트가 모달 챕터를 모두 정의하므로, host(CompositingSceneModal) 가 직접 ReactNode 를 만들어 전달.
   */
  compositingSection?: React.ReactNode;
  /** 'modal'(기본): 풀스크린 backdrop+센터. 'left'/'right': backdrop 없이 본체만(부모가 위치). 참조 도킹용. */
  dockMode?: 'modal' | 'left' | 'right';
  /** 4c PR2: 모달 안 #씬 칩 클릭 → 그 씬을 좌/우 도킹 참조 패널로 연다(부모가 처리). */
  onSceneReference?: (target: HashTarget, side: 'left' | 'right') => void;
  /** 4c PR2: 참조 도킹 패널 노드(자체가 dockMode 모달). flex 래퍼 안에 side 위치로 렌더된다. */
  referencePanel?: React.ReactNode;
  /** 4c PR2: 참조 패널을 본체 좌/우 어느 쪽에 둘지. referencePanel 이 있을 때만 의미. */
  referenceSide?: 'left' | 'right';
  /** 4c PR2: dock 헤더 [좌]/[우] 토글 — 참조 패널을 본체 어느 쪽에 둘지 변경(부모가 처리). */
  onDockToggleSide?: (side: 'left' | 'right') => void;
  /** 4c PR2: dock 헤더 [메인으로] — 이 참조 패널을 메인 모달로 승격(부모가 처리). */
  onDockPromote?: () => void;
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
  focusCommentId,
  focusRevisionCommentId,
  onActPhaseStateClick,
  onActFeedbackRequest,
  onActRoundBump,
  onAssigneeStageToggle,
  onAssigneeActPhaseStateClick,
  onAssigneeActFeedbackRequest,
  onAssigneeActRoundBump,
  continuitySourceElement,
  onContinuityEnd,
  compositingSection,
  dockMode = 'modal',
  onSceneReference,
  referencePanel,
  referenceSide = 'right',
  onDockToggleSide,
  onDockPromote,
}: UnifiedSceneDetailModalProps) {
  const { bgScene, actScene, bgSceneIndex, actSceneIndex } = merged;
  const headScene = bgScene ?? actScene;
  // v1.23.3 (#2 한솔 보고): 토글 클릭 시 전역 부서 모드 변경 + 같은 컷 모달 자동 재오픈 ("판딩").
  //   v1.23.2 의 "닫고 다시 클릭하라" 보다 직관적. setPendingSceneModalRequest 로 ScenesView 가 자동 처리.
  const selectedDepartment = useAppStore((s) => s.selectedDepartment);
  const setSelectedDepartment = useAppStore((s) => s.setSelectedDepartment);
  const setDashboardDeptFilter = useAppStore((s) => s.setDashboardDeptFilter);
  const setPendingSceneModalRequest = useAppStore((s) => s.setPendingSceneModalRequest);
  const handleDeptToggle = useCallback((next: 'all' | 'bg' | 'acting') => {
    if (next === selectedDepartment) return;
    // codex 1차 P1: target dept 에 씬이 있는지 검사 — 없으면 pending request 보내지 않음 (stale 방지).
    //   next='bg' → bgScene 필요, 'acting' → actScene, 'all' → 둘 중 하나라도.
    const targetScene =
      next === 'bg' ? bgScene
      : next === 'acting' ? actScene
      : (bgScene ?? actScene);
    const targetUuid = targetScene?.id;
    // codex 3차 P2: sceneId 가 빈 문자열일 수도 있어 || fallback (?? 는 빈 문자열 그대로 반환).
    const targetSceneName = targetScene?.sceneId || merged.sceneId;
    const hasTarget = !!targetUuid;

    setSelectedDepartment(next);
    setDashboardDeptFilter(next);
    onClose();

    const label = next === 'all' ? '통합' : next === 'bg' ? 'BG' : '액팅';
    if (hasTarget) {
      // ScenesView 가 새 selectedDepartment 로 reload 후 pending 처리 — 약간 지연.
      setTimeout(() => {
        setPendingSceneModalRequest({
          sceneUuid: targetUuid,
          sceneName: targetSceneName ?? undefined,
        });
      }, 120);
      sonnerToast.success(`${label} 모드로 전환 — 같은 컷 모달 다시 엽니다`, { duration: 1800 });
    } else {
      sonnerToast.info(`${label} 모드로 전환했어요`, {
        description: '이 컷은 ' + label + ' 데이터가 없어 모달이 다시 열리지 않습니다.',
        duration: 2400,
      });
    }
  }, [selectedDepartment, setSelectedDepartment, setDashboardDeptFilter, setPendingSceneModalRequest, onClose, bgScene, actScene, merged.sceneId]);
  // 모달 backdrop 드래그 닫힘 방지 — mousedown 시작 위치를 추적해 backdrop 자체에서 시작한 경우만 onClose 트리거
  const backdropMouseDownRef = useRef(false);
  const modalMainRef = useRef<HTMLDivElement>(null);

  // 참조 패널이 붙어도 댓글 패널은 유지한다. 좁은 화면은 모달 래퍼의 가로 스크롤로 처리한다.

  // 댓글 키: BG와 ACT 양쪽 조회 가능하게.
  // primary 는 "실제로 이 merged 에 존재하는 부서" 와 일치해야 한다 —
  // ACT-only 병합 항목에서 BG sheetName 을 쓰면 ACT 씬 번호가 BG 시트 경로로 라우팅되어
  // 댓글/리테이크가 엉뚱한 키에 저장되는 문제가 생김.
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

  // 리테이크 키 — buildSceneKey 가 부서 구분 없이 EP:Part:sceneId 로 해싱되므로 BG/ACT 공용
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
  const sceneThreadKey = revisionSceneKey ? buildSceneThreadKeyFromRevisionKey(revisionSceneKey) : '';
  const openRevCount = useRevisionStore((s) => revisionSceneKey ? s.getOpenCount(revisionSceneKey) : 0);

  // UI state — v1.18.0: initialTab 으로 외부에서 시작 탭 지정 가능 (알림 클릭 시 'revisions' 등)
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'detail');
  const [commentCount, setCommentCount] = useState(0);
  const [revisionCount, setRevisionCount] = useState(0);
  // 4c PR3: #칩 우클릭 메뉴 상태.
  const [hashMenu, setHashMenu] = useState<{ target: HashTarget; x: number; y: number } | null>(null);

  // v1.18.0: initialTab 변경 → 활성 탭 동기화 (모달이 마운트된 상태에서 다른 알림 클릭 시).
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // v1.18.0: 댓글 패널의 [re#] 칩 클릭 → 리테이크 탭 + 카드 강조 + 스레드 펼침.
  // CommentPanel(같은 모달 내부) 이 'bflow:jump-to-revision' 을 dispatch 한다.
  useEffect(() => {
    if (dockMode !== 'modal') return; // dock(참조) 인스턴스는 전역 jump-to-revision 을 가로채지 않는다 — 메인 모달 전용(코덱스 P2).
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
  }, [dockMode]);

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
        window.dispatchEvent(new CustomEvent('bflow:expand-revision', {
          detail: { revisionId: focusRevisionId, commentId: focusRevisionCommentId },
        }));
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
  }, [focusRevisionId, focusRevisionCommentId, tab]);
  const [showImageModal, setShowImageModal] = useState<null | 'storyboard' | 'guide'>(null);
  const [imageLoading, setImageLoading] = useState<null | 'storyboard' | 'guide'>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<null | 'storyboard' | 'guide' | 'bg' | 'act' | 'both'>(null);
  const [previewUrls, setPreviewUrls] = useState<{ storyboard?: string; guide?: string }>({});
  const [latestImageUrls, setLatestImageUrls] = useState<{ storyboard?: string; guide?: string }>({});
  const { persistLatestImageUrl } = useOptimisticSceneImageUrl('UnifiedSceneDetailModal');
  const addingRef = useRef<{ bg: boolean; acting: boolean }>({ bg: false, acting: false });

  useEffect(() => {
    setLatestImageUrls({});
  }, [bgScene?.id, bgScene?.sceneId, bgSheetName]);

  useEffect(() => {
    setLatestImageUrls({});
  }, [bgScene?.storyboardUrl, bgScene?.guideUrl]);

  const applyLatestImageUrl = useCallback(
    (imageType: 'storyboard' | 'guide', url: string) => {
      const sceneUuid = bgScene?.id;
      const previousUrl = imageType === 'storyboard' ? bgScene?.storyboardUrl : bgScene?.guideUrl;

      setLatestImageUrls((prev) => ({ ...prev, [imageType]: url }));
      setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));

      persistLatestImageUrl({
        sceneUuid,
        imageType,
        url,
        previousUrl,
        onRollback: (rollbackUrl) => {
          setLatestImageUrls((prev) => ({ ...prev, [imageType]: rollbackUrl }));
        },
      });
    },
    [bgScene?.id, bgScene?.storyboardUrl, bgScene?.guideUrl, persistLatestImageUrl],
  );

  // 좌우 이동 슬라이드 방향 (1=다음, -1=이전). 키보드/버튼/도트 모두 handleNavigate 경유.
  const [navDirection, setNavDirection] = useState<1 | -1>(1);
  const handleNavigate = useCallback((dir: 'prev' | 'next') => {
    setNavDirection(dir === 'next' ? 1 : -1);
    onNavigate?.(dir);
  }, [onNavigate]);

  // 4c PR2: 모달 안에서 #씬 칩 클릭 → 점프 대신 좌/우 도킹 참조 패널로 연다.
  //   #파트/#화 및 onSceneReference 미연결 시에는 기존 점프(navigateToHashTarget) 유지.
  const handleHash = (t: HashTarget) =>
    (t.kind === 'scene' && onSceneReference) ? onSceneReference(t, referenceSide ?? 'right') : navigateToHashTarget(t);

  // 4c PR3: #칩 우클릭 → 컨텍스트 메뉴 열기.
  const handleHashContext = useCallback((t: HashTarget, e: React.MouseEvent) => {
    setHashMenu({ target: t, x: e.clientX, y: e.clientY });
  }, []);

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

  // 리테이크 탭 라벨용 — open 우선, 없으면 전체
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
      'image_annotate_storyboard', 'image_annotate_guide',
      'scene_add',
      'revision_add', 'revision_in_progress', 'revision_resolve', 'revision_delete',
      'revision_assignee_done', 'revision_final_resolve', 'revision_reassign',
    ]);
    const events: CommentInlineEvent[] = sceneActivities
      .filter((a) => BIG_EVENT_TYPES.has(a.actionType))
      .map<CommentInlineEvent>((a) => {
        const v = describeActivity(a);
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
          text: `${a.userName} ${deptPrefix(a.department)}${v.text}`,
          tone: revisionTone,
          label: revisionLabel,
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
  const bgMemoAuthorMeta = useMemo(
    () => findLatestMemoActivity(sceneActivities, bgScene?.id),
    [sceneActivities, bgScene?.id],
  );
  const actMemoAuthorMeta = useMemo(
    () => findLatestMemoActivity(sceneActivities, actScene?.id),
    [sceneActivities, actScene?.id],
  );

  // ESC 닫기 + 좌우 화살표 (도킹 모드에선 전역 단축키 비활성 — 부모가 닫기 제어)
  useEffect(() => {
    if (dockMode !== 'modal') return;
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
  }, [dockMode, onClose, handleNavigate, hasPrev, hasNext, showImageModal, deleteConfirm]);

  // v1.30.1 (한솔 보고 2026-05-23): 클립보드 붙여넣기 UI/UX 강화.
  //   - 호버 중인 슬롯이 있으면 그 슬롯을 target. 없으면 빈 슬롯 자동 우선 (기존 동작).
  //   - 성공 시 토스트로 어느 칸에 들어갔는지 명시.
  // v1.30.2 (한솔 보고 2026-05-24): hover 만으론 race/stale 로 paste 가 못 들어가는 경우가 있어
  //   "빈 슬롯 1번 클릭 = 핀(paste target 고정) / 한 번 더 클릭 = 파일 탐색기" UX 추가.
  //   paste target 우선순위: pinned > hovered > 자동(빈 슬롯 우선).
  const [hoveredImageSlot, setHoveredImageSlot] = useState<'storyboard' | 'guide' | null>(null);
  const [pinnedImageSlot, setPinnedImageSlot] = useState<'storyboard' | 'guide' | null>(null);
  // 코덱스 4차 P2 (2026-05-24): imageLoading 으로 슬롯이 spinner div 로 교체되면서
  //   onMouseLeave 가 fire 안 할 수 있음. 그 시점에 hoveredImageSlot 가 stale 로 남아
  //   다음 paste 가 잘못된 슬롯으로 가는 race 차단. loading 진입 시 즉시 클리어.
  useEffect(() => {
    if (imageLoading) {
      setHoveredImageSlot(null);
      setPinnedImageSlot(null);
    }
  }, [imageLoading]);
  // ESC 로 핀 해제 — 모달 닫기 단축키 (Esc) 와 별도. 핀 있으면 핀만 해제, 없으면 모달 닫기로 흘러감.
  useEffect(() => {
    if (!pinnedImageSlot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPinnedImageSlot(null);
      }
    };
    document.addEventListener('keydown', onKey, true); // capture phase 로 먼저 받음
    return () => document.removeEventListener('keydown', onKey, true);
  }, [pinnedImageSlot]);
  // Ctrl+V 이미지 붙여넣기 (BG 만, 도킹 모드 제외)
  useEffect(() => {
    if (dockMode !== 'modal') return;
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
          // target 우선순위:
          //   1) 핀된 슬롯 (사용자가 명시적으로 클릭으로 고정 — 가장 안정)
          //   2) 호버 중인 슬롯
          //   3) 빈 슬롯 (storyboard 비어있으면 storyboard, 아니면 guide)
          const imageType: 'storyboard' | 'guide' =
            pinnedImageSlot ?? hoveredImageSlot ?? (!bgScene.storyboardUrl ? 'storyboard' : 'guide');
          // 코덱스 2차 P2 (2026-05-24): paste 시작 시 hoveredImageSlot 클리어 (stale 방지).
          // v1.30.2: pinnedImageSlot 도 paste 후 자동 해제 (한 번 paste 후 다음은 명시적 재핀).
          setHoveredImageSlot(null);
          setPinnedImageSlot(null);
          // 코덱스 2차 P2: uploadImage 가 boolean 반환 — 성공 시에만 success 토스트.
          //   실패 시 uploadImage 자체가 error 토스트 띄움. 이중 토스트 방지.
          const ok = await uploadImage(blob, imageType);
          if (ok) {
            const slotLabel = imageType === 'storyboard' ? '스토리보드' : '가이드';
            sonnerToast.success(`${slotLabel} 칸에 붙여넣어졌어요`);
          }
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockMode, bgScene?.storyboardUrl, bgScene?.guideUrl, bgSheetName, showImageModal, hoveredImageSlot, pinnedImageSlot]);

  // 코덱스 P2 (2026-05-24): 호출자가 성공/실패 분기로 토스트 띄울 수 있도록 boolean 반환.
  //   기존엔 catch 가 swallow 해서 paste 가 실패해도 onPaste 가 success 토스트를 띄움.
  const uploadImage = useCallback(async (blob: Blob, imageType: 'storyboard' | 'guide'): Promise<boolean> => {
    if (!bgScene || !bgSheetName) {
      sonnerToast.error('BG 씬이 없어 이미지를 저장할 수 없습니다.');
      return false;
    }
    try {
      setImageLoading(imageType);
      // v1.30.2 (코덱스 P1, 한솔 보고 2026-05-24): 주석 결과(PNG, 투명 배경) 가 JPEG 으로 재인코딩되며
      //   투명 픽셀이 검정 matte 되던 버그 fix — 입력 mime 이 PNG 면 PNG 로 유지.
      const isPng = blob.type === 'image/png';
      const base64 = await resizeBlob(blob, 800, isPng ? 0.92 : 0.8, isPng ? 'image/png' : 'image/jpeg');
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
      return true;
    } catch (err) {
      console.error('[UnifiedSceneDetailModal] 이미지 업로드 실패', err);
      setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
      sonnerToast.error(`이미지 저장 실패: ${err instanceof Error ? err.message : err}`);
      return false;
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
    setLatestImageUrls((prev) => ({ ...prev, [imageType]: '' }));
    setPreviewUrls((prev) => ({ ...prev, [imageType]: undefined }));
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

  // dockMode 별 슬라이드 방향 — 도킹 시 subtle slide-in/out
  const dockInitialX = dockMode === 'left' ? -24 : dockMode === 'right' ? 24 : 0;

  // 4c PR2: 참조 패널이 붙으면 본체를 좁혀 본체+참조(+댓글) 가 가로로 들어오게 한다.
  //   참조가 없으면 기존 폭 그대로(영향 0). 참조 인스턴스 자신(dock 모드)은 referencePanel 이 없어 영향 없음.
  const bodyWidthClass = dockMode !== 'modal'
    // dock(참조) 인스턴스는 자신의 referencePanel 이 없어 720px 가 되어 부모 슬롯(560px/40vw)을 넘쳤다(코덱스 P2).
    // 슬롯에 맞춰 채운다.
    ? 'w-full'
    : referencePanel
      ? 'w-[min(560px,calc(100vw-44rem))] min-w-[420px] shrink'
      : 'w-[min(720px,calc(100vw-26rem))]';
  const bodyHeightClass = dockMode !== 'modal'
    ? 'h-full max-h-full'
    : 'h-[min(900px,92vh)]';

  // ── 본체 motion.div — modal/dock 모드 공통 ──
  const bodyEl = (
    <motion.div
      key="unified-modal-body"
      ref={modalMainRef}
      initial={
        dockMode !== 'modal'
          ? { opacity: 0, x: dockInitialX }
          : continuitySourceElement ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.96, y: 12 }
      }
      animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
      exit={
        dockMode !== 'modal'
          ? { opacity: 0, x: dockInitialX }
          : { opacity: 0, scale: 0.96, y: 6 }
      }
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative flex flex-col bg-bg-card border border-bg-border overflow-hidden',
        bodyWidthClass,
        bodyHeightClass,
      )}
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
                    data-continuity-target="title"
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

                {/* v1.23.2 (#1 재설계): 토글 = 전역 selectedDepartment(+dashboardDeptFilter) 변경 + 모달 닫음 → 같은 컷 다시 클릭 시 새 부서 모달.
                    dock(참조) 모드에선 숨긴다 — 전역 부서 전환이 Scenes 뷰 전체를 바꿔 dock 을 닫고 메인 파트 기준으로 재오픈해 참조 컨텍스트를 깨므로(코덱스 P2). */}
                {dockMode === 'modal' && (
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
                )}

                {/* 4c PR2: dock 모드 헤더 컨트롤 — 좌/우 토글 + 메인으로 승격 (모달 모드에선 숨김) */}
                {dockMode !== 'modal' && (
                  <>
                    <div className="flex gap-[2px] bg-bg-border/40 p-[2px] rounded-md shrink-0">
                      {(['left', 'right'] as const).map((side) => (
                        <button
                          key={side}
                          onClick={() => onDockToggleSide?.(side)}
                          className={cn(
                            'px-2 py-1 rounded-[4px] text-[10.5px] cursor-pointer transition-all whitespace-nowrap',
                            dockMode === side ? 'bg-accent/22 text-accent-sub' : 'text-text-secondary hover:text-text-primary',
                          )}
                          style={dockMode === side ? { boxShadow: 'inset 0 0 0 1px rgba(108, 92, 231, 0.32)' } : {}}
                          title={side === 'left' ? '참조 패널을 왼쪽에 두기' : '참조 패널을 오른쪽에 두기'}
                        >
                          {side === 'left' ? '좌' : '우'}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => onDockPromote?.()}
                      className="px-2.5 py-1 rounded-md bg-accent/15 border border-accent/30 text-accent-sub text-[11px] font-medium hover:bg-accent/25 cursor-pointer transition-colors shrink-0 whitespace-nowrap"
                      title="이 참조 씬을 메인 모달로 열기"
                    >
                      메인으로
                    </button>
                  </>
                )}

                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer transition-colors shrink-0"
                  title="닫기"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 탭 (상세 / 리테이크·N / 파일 / 히스토리) */}
              <div className="flex gap-1 px-5 border-b border-bg-border/40 shrink-0">
                <TabButton active={tab === 'detail'} onClick={() => setTab('detail')}>
                  상세
                </TabButton>
                <TabButton
                  active={tab === 'revisions'}
                  onClick={() => setTab('revisions')}
                  badge={revisionTabBadge > 0 ? revisionTabBadge : undefined}
                >
                  리테이크
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
                            <div data-continuity-target="storyboard">
                              <UnifiedImageSlot
                                label="스토리보드"
                                continuityTarget="storyboard"
                                url={previewUrls.storyboard ?? latestImageUrls.storyboard ?? bgScene?.storyboardUrl ?? ''}
                                loading={imageLoading === 'storyboard'}
                                canEdit={!!bgScene && !!bgSheetName}
                                onPick={() => pickFile('storyboard')}
                                onRemove={() => setDeleteConfirm('storyboard')}
                                onView={() => setShowImageModal('storyboard')}
                                onDropBlob={(b) => uploadImage(b, 'storyboard')}
                                onHoverChange={(h) => setHoveredImageSlot(h ? 'storyboard' : (s) => s === 'storyboard' ? null : s)}
                                pinned={pinnedImageSlot === 'storyboard'}
                                onPinToggle={() => setPinnedImageSlot((p) => p === 'storyboard' ? null : 'storyboard')}
                              />
                            </div>
                            <div data-continuity-target="guide">
                              <UnifiedImageSlot
                                label="가이드"
                                continuityTarget="guide"
                                url={previewUrls.guide ?? latestImageUrls.guide ?? bgScene?.guideUrl ?? ''}
                                loading={imageLoading === 'guide'}
                                canEdit={!!bgScene && !!bgSheetName}
                                onPick={() => pickFile('guide')}
                                onRemove={() => setDeleteConfirm('guide')}
                                onView={() => setShowImageModal('guide')}
                                onDropBlob={(b) => uploadImage(b, 'guide')}
                                onHoverChange={(h) => setHoveredImageSlot(h ? 'guide' : (s) => s === 'guide' ? null : s)}
                                pinned={pinnedImageSlot === 'guide'}
                                onPinToggle={() => setPinnedImageSlot((p) => p === 'guide' ? null : 'guide')}
                              />
                            </div>
                          </div>
                        )}

                        {/* v1.30.0+: 컴포지팅 대시보드에서 모달 호출 시 부서 패널 위에 컴포지팅 단계 섹션 노출. */}
                        {compositingSection && (
                          <div className="px-5 pt-2 pb-1">{compositingSection}</div>
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
                            memoAuthorMeta={bgMemoAuthorMeta}
                            onAssigneeStageToggle={onAssigneeStageToggle}
                            onAssigneeActPhaseStateClick={onAssigneeActPhaseStateClick}
                            onAssigneeActFeedbackRequest={onAssigneeActFeedbackRequest}
                            onAssigneeActRoundBump={onAssigneeActRoundBump}
                            onHashClick={handleHash}
                            onHashContextMenu={handleHashContext}
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
                            memoAuthorMeta={actMemoAuthorMeta}
                            onActPhaseStateClick={onActPhaseStateClick}
                            onActFeedbackRequest={onActFeedbackRequest}
                            onActRoundBump={onActRoundBump}
                            onAssigneeStageToggle={onAssigneeStageToggle}
                            onAssigneeActPhaseStateClick={onAssigneeActPhaseStateClick}
                            onAssigneeActFeedbackRequest={onAssigneeActFeedbackRequest}
                            onAssigneeActRoundBump={onAssigneeActRoundBump}
                            onHashClick={handleHash}
                            onHashContextMenu={handleHashContext}
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
                        onHashClick={handleHash}
                        onHashContextMenu={handleHashContext}
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
  );

  return (
    <AnimatePresence>
      {dockMode === 'modal' ? (
        /* ── 모달 모드: 풀스크린 backdrop + 댓글 사이드 패널 ── */
        <motion.div
          key="unified-modal-backdrop"
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
          {/* flex 래퍼 — 본체 + 댓글 (+ 참조 도킹 패널) (좌우 이동 시 같이 흔들기 위해 motion.div 로 감쌈) */}
          <motion.div
            animate={wrapperControls}
            className="flex gap-3 items-stretch max-w-full max-h-full overflow-x-auto overflow-y-hidden pb-1"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 참조 패널 좌측 도킹 — 본체보다 먼저 */}
            {referencePanel && referenceSide === 'left' && (
              <div className="w-[min(560px,40vw)] h-[min(900px,92vh)] max-h-full min-h-0 shrink-0 overflow-hidden">{referencePanel}</div>
            )}

            {bodyEl}

            {/* ── 댓글 패널 — 본체와 같은 높이. 참조 패널이 붙어도 유지하고, 좁은 화면은 wrapper 가로 스크롤로 처리. */}
            {primaryCommentKey && (
              <CommentPanelResizable
                commentCount={commentCount}
                sceneKey={primaryCommentKey}
                sceneThreadKey={sceneThreadKey}
                secondarySceneKey={secondaryCommentKey || undefined}
                onCountChange={setCommentCount}
                inlineEvents={inlineEvents}
                focusCommentId={focusCommentId}
                sceneLabel={[episodeLabel, partLabel, unifiedSceneId ? `#${unifiedSceneId}` : null]
                  .filter(Boolean)
                  .join(' / ')}
                quickRevision={{
                  sceneKey: revisionSceneKey,
                  context: selectedDepartment === 'bg' || selectedDepartment === 'acting' ? selectedDepartment : 'all',
                  department: selectedDepartment === 'bg' || selectedDepartment === 'acting' ? selectedDepartment : undefined,
                  bgAssignee: bgScene?.assignee ?? null,
                  actingAssignee: actScene?.assignee ?? null,
                }}
                heightClass="h-[min(900px,92vh)]"
                headerRight={commentCount > 0 ? (
                  <span className="text-xs text-text-secondary/60 tabular-nums">({commentCount})</span>
                ) : null}
                onHashClick={handleHash}
                onHashContextMenu={handleHashContext}
              />
            )}

            {/* 참조 패널 우측 도킹 — 댓글 패널 뒤 */}
            {referencePanel && referenceSide === 'right' && (
              <div className="w-[min(560px,40vw)] h-[min(900px,92vh)] max-h-full min-h-0 shrink-0 overflow-hidden">{referencePanel}</div>
            )}
          </motion.div>
        </motion.div>
      ) : (
        /* ── 도킹 모드: 본체만 (backdrop/댓글 패널 없음, 부모가 위치 제어) ── */
        bodyEl
      )}

      {continuitySourceElement && (
        <SceneContinuityTransition
          sourceElement={continuitySourceElement}
          targetRootRef={modalMainRef}
          onComplete={onContinuityEnd}
        />
      )}

      {/* 이미지 확대 */}
      {showImageModal && bgScene && (
        <ImageModal
          key="unified-image-modal"
          storyboardUrl={latestImageUrls.storyboard ?? bgScene.storyboardUrl ?? ''}
          guideUrl={latestImageUrls.guide ?? bgScene.guideUrl ?? ''}
          sceneId={bgScene.sceneId || String(bgScene.no)}
          onClose={() => setShowImageModal(null)}
          // v1.26.0: 버전 관리 + 우클릭 메뉴 메타
          sheetName={bgSheetName ?? undefined}
          sceneUuid={bgScene.id ?? null}
          onUploadImage={async (file, imageType) => {
            if (!bgSheetName) throw new Error('BG 시트 정보 없음');
            const { resizeBlob: rb, saveImage: si } = await import('@/utils/imageUtils');
            const base64 = await rb(file);
            return si(base64, bgSheetName, bgScene.sceneId || String(bgScene.no), imageType);
          }}
          onLatestImageUrlChange={applyLatestImageUrl}
        />
      )}

      {/* 4c PR3: #칩 우클릭 컨텍스트 메뉴 */}
      {hashMenu && (
        <EntityHashContextMenu
          target={hashMenu.target}
          x={hashMenu.x}
          y={hashMenu.y}
          onClose={() => setHashMenu(null)}
          onNavigate={navigateToHashTarget}
          onReference={(t) => onSceneReference?.(t, referenceSide ?? 'right')}
        />
      )}

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <ConfirmDialog
          key="unified-confirm-dialog"
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
  memoAuthorMeta,
  onActPhaseStateClick,
  onActFeedbackRequest,
  onActRoundBump,
  onAssigneeStageToggle,
  onAssigneeActPhaseStateClick,
  onAssigneeActFeedbackRequest,
  onAssigneeActRoundBump,
  onHashClick,
  onHashContextMenu,
}: {
  dept: Department;
  scene: Scene | null;
  sheetName: string | null;
  sceneIndex: number;
  sceneId: string;
  onToggle: (sheetName: string, sceneId: string, stage: Stage, options?: { sceneUuid?: string | null; sceneIndex?: number }) => void;
  onFieldUpdate: (sheetName: string, sceneIndex: number, field: string, value: string) => void;
  onDelete: () => void;
  onAdd: () => void;
  memoAuthorMeta?: MemoAuthorMeta | null;
  onActPhaseStateClick?: (sheetName: string, sceneId: string, newState: ScenePhaseState, sceneUuid?: string | null, sceneIndex?: number) => void;
  onActFeedbackRequest?: (sheetName: string, sceneId: string) => void;
  onActRoundBump?: (sheetName: string, sceneId: string, kind: 'work' | 'feedback', delta: 1 | -1) => void;
  onAssigneeStageToggle?: (sheetName: string, sceneId: string, assigneeName: string, stage: Stage, sceneUuid?: string | null, sceneIndex?: number, dept?: Department) => void;
  onAssigneeActPhaseStateClick?: (sheetName: string, sceneId: string, assigneeName: string, newState: ScenePhaseState, sceneUuid?: string | null, sceneIndex?: number) => void;
  onAssigneeActFeedbackRequest?: (sheetName: string, sceneId: string, assigneeName: string, sceneUuid?: string | null, sceneIndex?: number) => void;
  onAssigneeActRoundBump?: (sheetName: string, sceneId: string, assigneeName: string, kind: 'work' | 'feedback', delta: 1 | -1, sceneUuid?: string | null, sceneIndex?: number) => void;
  onHashClick?: (t: HashTarget) => void;
  /** 4c PR3: #씬·#파트·#화 칩 우클릭 메뉴. */
  onHashContextMenu?: (t: HashTarget, e: React.MouseEvent) => void;
}) {
  const cfg = DEPARTMENT_CONFIGS[dept];
  const visualColor = deptVisualColor(dept);
  const canUseAssigneeProgressStack = hasMultiAssigneeProgress(scene) && (
    dept === 'acting'
      ? Boolean(onAssigneeActPhaseStateClick && onAssigneeActFeedbackRequest && onAssigneeActRoundBump)
      : Boolean(onAssigneeStageToggle)
  );

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
        {/* v1.25.0~: 액팅 + 핸들러 모두 전달 시 새 ScenePhaseToggle, 아니면 기존 4-stage 토글 */}
        {canUseAssigneeProgressStack ? (
          <div data-continuity-target={dept === 'bg' ? 'bg-stage' : 'act-stage'}>
            <AssigneeProgressStack
              scene={scene}
              department={dept}
              onAssigneeStageToggle={(name, stage) => onAssigneeStageToggle?.(sheetName, sceneId, name, stage, scene.id ?? null, sceneIndex, dept)}
              onAssigneePhaseStateClick={(name, state) => onAssigneeActPhaseStateClick?.(sheetName, sceneId, name, state, scene.id ?? null, sceneIndex)}
              onAssigneeFeedbackRequest={(name) => onAssigneeActFeedbackRequest?.(sheetName, sceneId, name, scene.id ?? null, sceneIndex)}
              onAssigneeRoundBump={(name, kind, delta) => onAssigneeActRoundBump?.(sheetName, sceneId, name, kind, delta, scene.id ?? null, sceneIndex)}
            />
          </div>
        ) : dept === 'acting' && onActPhaseStateClick && onActFeedbackRequest && onActRoundBump ? (
          <div data-continuity-target="act-stage">
            <ScenePhaseToggle
              scene={scene}
              iconDisplay="always"
              onStateClick={(next) => onActPhaseStateClick(sheetName, sceneId, next, scene.id ?? null, sceneIndex)}
              onRequestFeedback={() => onActFeedbackRequest(sheetName, sceneId)}
              onRoundBump={(kind, delta) => onActRoundBump(sheetName, sceneId, kind, delta)}
            />
          </div>
        ) : (
          <StageSegmentToggle
            scene={scene}
            department={dept}
            iconDisplay="always"
            className="bg-black/[0.06] dark:bg-white/[0.04] border-transparent"
            segmentClassName="py-2 text-xs"
            dataContinuityTarget={dept === 'bg' ? 'bg-stage' : 'act-stage'}
            onToggle={(stage) => onToggle(sheetName, sceneId, stage, { sceneUuid: scene.id ?? null, sceneIndex })}
          />
        )}
      </div>

      <InlineTextareaRow
        label="메모"
        value={scene.memo || ''}
        onSave={(v) => onFieldUpdate(sheetName, sceneIndex, 'memo', v)}
        memoAuthorMeta={memoAuthorMeta}
        continuityTarget={dept === 'bg' ? 'bg-memo' : 'act-memo'}
        onHashClick={onHashClick}
        onHashContextMenu={onHashContextMenu}
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

function InlineTextareaRow({ label, value, onSave, memoAuthorMeta, continuityTarget, onHashClick, onHashContextMenu }: {
  label: string; value: string; onSave: (v: string) => void; memoAuthorMeta?: MemoAuthorMeta | null; continuityTarget?: string; onHashClick?: (t: HashTarget) => void; onHashContextMenu?: (t: HashTarget, e: React.MouseEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { users } = useAuthStore();
  const userNames = useMemo(() => users.map((u) => u.name), [users]);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  return (
    <div data-continuity-target={continuityTarget}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-text-secondary">{label}</span>
        {value && memoAuthorMeta && !editing && (
          <span
            className="inline-flex items-center gap-1.5 max-w-[13rem] text-[10.5px] font-medium text-emerald-300/85 truncate"
            title={`마지막 수정: ${memoAuthorMeta.userName} · ${formatStamp(memoAuthorMeta.createdAt, { withYearAlways: true })}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300/80 shrink-0" />
            <span className="truncate">{memoAuthorMeta.userName} · {formatTime(memoAuthorMeta.createdAt)}</span>
          </span>
        )}
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
        <EntityAwareInput
          multiline
          autoGrow
          value={draft}
          onChange={setDraft}
          users={users}
          enableHashtag
          onBlur={commit}
          onCancel={() => { setDraft(value); setEditing(false); }}
          autoFocus
          className="w-full min-h-[64px] bg-bg-primary border border-accent/50 rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent resize-none"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="w-full text-left px-3 py-2 rounded-lg border border-transparent text-sm text-text-primary min-h-[40px] cursor-pointer transition-colors whitespace-pre-wrap hover:border-accent/30 hover:bg-accent/5"
          style={{ background: value ? 'rgba(255,255,255,0.025)' : undefined }}
        >
          {value
            ? <EntityText text={value} userNames={userNames} onHashClick={onHashClick ?? navigateToHashTarget} onHashContextMenu={onHashContextMenu} />
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
  continuityTarget,
  url,
  loading,
  canEdit,
  onPick,
  onRemove,
  onView,
  onDropBlob,
  onHoverChange,
  pinned = false,
  onPinToggle,
}: {
  label: string;
  continuityTarget?: 'storyboard' | 'guide';
  url: string;
  loading: boolean;
  canEdit: boolean;
  onPick: () => void;
  onRemove: () => void;
  onView: () => void;
  onDropBlob: (blob: Blob) => void;
  /** v1.30.1: 호버 시 paste target 명확화. true = enter, false = leave. */
  onHoverChange?: (hover: boolean) => void;
  /** v1.30.2 (한솔 보고): 빈 슬롯 핀 상태 (paste target 고정). */
  pinned?: boolean;
  /** 빈 슬롯에서 1차 클릭 시 호출 (핀 토글). 핀 상태에서 다시 클릭하면 파일 탐색기 (onPick). */
  onPinToggle?: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [hover, setHover] = useState(false);
  // 호버 상태 변경을 부모에 전달 (paste handler 가 어느 슬롯에 넣을지 결정에 사용)
  const handleEnter = () => {
    if (!canEdit) return;
    setHover(true);
    onHoverChange?.(true);
  };
  const handleLeave = () => {
    setHover(false);
    onHoverChange?.(false);
  };
  // v1.30.2 빈 슬롯 클릭 동작:
  //   - !pinned: 핀 (paste target 고정). 다음 Ctrl+V 가 이 슬롯으로 들어감.
  //   - pinned: 파일 탐색기 (onPick). 핀 상태에서 한 번 더 누르면 기존 동작.
  const handleEmptyClick = () => {
    if (pinned) {
      onPick();
    } else {
      onPinToggle?.();
    }
  };

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
        <div
          data-continuity-target-box={continuityTarget}
          className="flex items-center justify-center h-32 bg-bg-primary rounded-lg border border-bg-border"
        >
          <div className="flex items-center gap-2 text-xs text-text-secondary/60">
            <div className="w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
            저장 중...
          </div>
        </div>
      ) : url ? (
        <div className="relative group">
          <div
            data-continuity-target-box={continuityTarget}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            onDragOver={canEdit ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
            onDragLeave={canEdit ? (e) => {
              const rt = e.relatedTarget as Node | null;
              if (rt && e.currentTarget.contains(rt)) return;
              setDragOver(false);
            } : undefined}
            onDrop={canEdit ? handleDrop : undefined}
            className={cn(
              'relative h-40 rounded-lg overflow-hidden border-2 bg-bg-primary transition-all',
              dragOver ? 'border-accent ring-4 ring-accent/25'
                : hover && canEdit ? 'border-accent/40 shadow-[0_0_18px_rgba(108,92,231,0.22)]'
                : 'border-transparent',
            )}
          >
            <img
              src={url}
              alt={label}
              className={cn('w-full h-full object-contain rounded-lg transition-all', dragOver && 'brightness-50')}
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
          data-continuity-target-box={continuityTarget}
          onClick={handleEmptyClick}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => {
            const rt = e.relatedTarget as Node | null;
            if (rt && e.currentTarget.contains(rt)) return;
            setDragOver(false);
          }}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 h-32 rounded-lg border-2 transition-all cursor-pointer',
            // v1.30.2 (한솔 보고 2026-05-24): 핀 상태 시각 강조. 핀이 가장 진한 outline + 안내 변경.
            pinned
              ? 'border-accent bg-accent/12 shadow-[0_0_24px_rgba(108,92,231,0.35)]'
              : 'border-dashed',
            !pinned && (
              dragOver
                ? 'border-accent bg-accent/15 ring-4 ring-accent/25'
                : hover
                  ? 'border-accent/55 bg-accent/8 shadow-[0_0_18px_rgba(108,92,231,0.22)]'
                  : 'border-bg-border hover:border-accent/40 hover:bg-accent/5'
            ),
          )}
        >
          {pinned ? (
            <>
              <Pin size={20} className="mb-0.5 text-accent fill-accent" />
              <span className="text-xs text-accent font-semibold">Ctrl+V 로 붙여넣기</span>
              <span className="text-[10px] text-accent/75">한 번 더 클릭 → 파일 탐색기 · Esc → 핀 해제</span>
            </>
          ) : (
            <>
              <ImagePlus size={22} className={cn('mb-0.5', dragOver ? 'text-accent animate-bounce' : hover ? 'text-accent' : 'text-text-secondary/45')} />
              {/* v1.30.1 (한솔 보고 2026-05-23): 빈 슬롯 호버 시 paste 가능 안내 텍스트 명시.
                  v1.30.2 (한솔 보고 2026-05-24): 호버만으론 paste race — 클릭 핀 UX 추가. */}
              <span className={cn('text-xs', dragOver ? 'text-accent font-semibold' : hover ? 'text-accent font-semibold' : 'text-text-secondary/60')}>
                {dragOver ? '여기에 놓기' : hover ? '클릭 → 붙여넣기 핀' : '클릭 → 핀 / 드래그 앤 드롭'}
              </span>
              <span className={cn('text-[10px] tracking-wide', hover || dragOver ? 'text-accent/85' : 'text-text-secondary/45')}>
                핀 후 Ctrl+V · 한 번 더 클릭 → 파일 탐색기
              </span>
            </>
          )}
        </button>
      ) : (
        <div
          data-continuity-target-box={continuityTarget}
          className="flex items-center justify-center h-32 rounded-lg border-2 border-dashed border-bg-border/50 bg-bg-primary/20 text-text-secondary/40 text-xs"
        >
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
