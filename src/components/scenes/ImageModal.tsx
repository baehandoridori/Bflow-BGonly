import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Columns2, Layers, ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ImageContextMenu, type ContextAction } from './ImageContextMenu';
import { downloadImage, copyImageToClipboard, copyImageUrl, generateImageFileName } from '@/utils/imageActions';
import { ImageVersionStrip } from './ImageVersionStrip';
import { ImageVersionDropdown } from './ImageVersionDropdown';
import { fetchImageVersions, createImageVersion, removeImageVersion } from '@/services/imageVersionService';
import { pickLatestVersion } from '@/utils/imageVersionUtils';
import type { ImageVersion } from '@/types';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/useAuthStore';
import { AnnotationCanvas, type AnnotationCanvasHandle } from './AnnotationCanvas';
import { composeAnnotation } from '@/utils/imageCompose';
import { Check } from 'lucide-react';

/**
 * 뷰 상태:
 *   single-storyboard  ←(Left)→  side-by-side  ←(Right)→  single-guide
 *   overlay 는 별도 (방향키 무관)
 */
type ViewState = 'single-storyboard' | 'side-by-side' | 'single-guide' | 'overlay';

/** 툴바에서 보여줄 고수준 모드 */
type ToolbarMode = 'single' | 'side-by-side' | 'overlay';

interface ImageModalProps {
  storyboardUrl: string;
  guideUrl: string;
  sceneId: string;
  onClose: () => void;
  // 씬 네비게이션 (선택)
  hasPrevScene?: boolean;
  hasNextScene?: boolean;
  currentSceneIndex?: number;
  totalScenes?: number;
  onSceneNavigate?: (direction: 'prev' | 'next') => void;
  // v1.26.0: 다운로드/복사/주석 진입에 필요한 메타
  sheetName?: string;             // 파일명 생성용 (예: 'EP03_A_BG')
  storyboardVersionNo?: number;   // 파일명에 v 번호 — 없으면 1 사용
  guideVersionNo?: number;
  onAnnotate?: (imageType: 'storyboard' | 'guide') => void; // 드로잉 진입
  // v1.26.0: 이미지 버전 관리 활성화 (sceneUuid 있을 때만)
  sceneUuid?: string | null;      // scenes.id UUID
  currentUserId?: string | null;
  isAdmin?: boolean;
  /** 새 버전을 업로드할 함수 — Storage 업로드 + 반환 URL (기존 saveImage 로직 활용) */
  onUploadImage?: (file: File, imageType: 'storyboard' | 'guide') => Promise<string>;
}

/* ────────────────────────────────────────────────────────────── */

export function ImageModal({
  storyboardUrl,
  guideUrl,
  sceneId,
  onClose,
  hasPrevScene = false,
  hasNextScene = false,
  currentSceneIndex = 0,
  totalScenes = 0,
  onSceneNavigate,
  sheetName,
  storyboardVersionNo = 1,
  guideVersionNo = 1,
  onAnnotate,
  sceneUuid,
  currentUserId: currentUserIdProp,
  isAdmin: isAdminProp,
  onUploadImage,
}: ImageModalProps) {
  // v1.26.0: props 미전달 시 store 에서 자동 (호출자 단순화)
  const storeUser = useAuthStore((s) => s.currentUser);
  const storeAdminMode = useAuthStore((s) => s.isAdminMode);
  const currentUserId = currentUserIdProp ?? storeUser?.id ?? null;
  const isAdmin = isAdminProp ?? (storeUser?.role === 'admin' || storeAdminMode);
  const hasBoth = !!storyboardUrl && !!guideUrl;

  const [view, setView] = useState<ViewState>(
    hasBoth ? 'side-by-side' : storyboardUrl ? 'single-storyboard' : 'single-guide',
  );
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [direction, setDirection] = useState(0); // -1 left · 0 fade · 1 right
  const imageAreaRef = useRef<HTMLDivElement>(null);

  // v1.26.0: 우클릭 메뉴 위치
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; imageType: 'storyboard' | 'guide' } | null>(null);

  // v1.26.0: 버전 관리 state — sceneUuid 가 있을 때만 활성화
  const [storyboardVersions, setStoryboardVersions] = useState<ImageVersion[]>([]);
  const [guideVersions, setGuideVersions] = useState<ImageVersion[]>([]);
  const [currentStoryboardId, setCurrentStoryboardId] = useState<string | null>(null);
  const [currentGuideId, setCurrentGuideId] = useState<string | null>(null);

  // 버전 로드
  useEffect(() => {
    if (!sceneUuid) return;
    let cancelled = false;
    Promise.all([
      fetchImageVersions(sceneUuid, 'storyboard'),
      fetchImageVersions(sceneUuid, 'guide'),
    ]).then(([sList, gList]) => {
      if (cancelled) return;
      setStoryboardVersions(sList);
      setGuideVersions(gList);
      // 초기 표시 = 최신
      setCurrentStoryboardId(pickLatestVersion(sList)?.id ?? null);
      setCurrentGuideId(pickLatestVersion(gList)?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [sceneUuid]);

  // 현재 표시 URL — 버전 선택이 있으면 그 URL, 아니면 props 의 storyboardUrl/guideUrl
  const displayStoryboardUrl =
    storyboardVersions.find((v) => v.id === currentStoryboardId)?.url ?? storyboardUrl;
  const displayGuideUrl =
    guideVersions.find((v) => v.id === currentGuideId)?.url ?? guideUrl;

  // v1.26.2: 현재 표시 중인 버전의 description (있을 때 라이트박스에 floating 노출)
  const currentStoryboardDescription =
    storyboardVersions.find((v) => v.id === currentStoryboardId)?.description ?? null;
  const currentGuideDescription =
    guideVersions.find((v) => v.id === currentGuideId)?.description ?? null;

  // 버전 추가 / 삭제 핸들러
  const handleVersionAdd = useCallback(async (imageType: 'storyboard' | 'guide') => {
    if (!sceneUuid || !currentUserId || !onUploadImage) {
      toast.error('버전 추가가 가능하지 않습니다');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const uploadedUrl = await onUploadImage(file, imageType);
        const newVer = await createImageVersion({
          sceneId: sceneUuid,
          imageType,
          kind: 'replace',
          url: uploadedUrl,
          createdBy: currentUserId,
        });
        const refreshed = await fetchImageVersions(sceneUuid, imageType);
        if (imageType === 'guide') {
          setGuideVersions(refreshed);
          setCurrentGuideId(newVer.id);
        } else {
          setStoryboardVersions(refreshed);
          setCurrentStoryboardId(newVer.id);
        }
        toast.success(`v${newVer.versionNo} 추가됨`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`업로드 실패: ${msg}`);
      }
    };
    input.click();
  }, [sceneUuid, currentUserId, onUploadImage]);

  // v1.26.0: 주석 모드 state
  const [annotateMode, setAnnotateMode] = useState<{ imageType: 'storyboard' | 'guide' } | null>(null);
  const annotationRef = useRef<AnnotationCanvasHandle>(null);
  // v1.26.2: 주석 텍스트 메모 (캔버스 그림 + 텍스트 함께 저장)
  const [annotationDescription, setAnnotationDescription] = useState('');

  const enterAnnotate = useCallback((imageType: 'storyboard' | 'guide') => {
    if (!sceneUuid) {
      toast.error('주석 모드를 사용할 수 없습니다 (씬 정보 없음)');
      return;
    }
    setAnnotateMode({ imageType });
  }, [sceneUuid]);

  const exitAnnotate = useCallback(() => {
    const isEmpty = annotationRef.current?.isEmpty() ?? true;
    if (!isEmpty || annotationDescription.trim()) {
      if (!confirm('주석을 모두 버리고 닫으시겠습니까?')) return;
    }
    annotationRef.current?.clear();
    setAnnotateMode(null);
    setAnnotationDescription('');
  }, [annotationDescription]);

  const saveAnnotation = useCallback(async () => {
    if (!annotateMode || !sceneUuid || !currentUserId) return;
    const canvas = annotationRef.current?.getCanvas();
    if (!canvas) {
      toast.error('주석 캔버스를 찾을 수 없습니다');
      return;
    }
    if (annotationRef.current?.isEmpty()) {
      toast.error('아직 그린 내용이 없어요');
      return;
    }
    const type = annotateMode.imageType;
    const versions = type === 'guide' ? guideVersions : storyboardVersions;
    const currentVerId = type === 'guide' ? currentGuideId : currentStoryboardId;
    // v1.30.1 (한솔 보고 2026-05-23): versions 가 비어있는 경우 (legacy 이미지가 image_versions
    //   row 없이 url 만 있는 경우) "현재 버전 정보를 찾을 수 없습니다" 에러로 막혔던 문제.
    //   props 의 storyboardUrl/guideUrl 폴백으로 자동 v1 시드 후 그것을 base 로 사용.
    let baseVer = versions.find((v) => v.id === currentVerId) ?? null;
    if (!baseVer) {
      const fallbackUrl = type === 'guide' ? guideUrl : storyboardUrl;
      if (!fallbackUrl) {
        toast.error('주석할 이미지가 없습니다');
        return;
      }
      try {
        baseVer = await createImageVersion({
          sceneId: sceneUuid,
          imageType: type,
          kind: 'replace',
          url: fallbackUrl,
          createdBy: currentUserId,
          description: '기존 이미지를 첫 버전으로 자동 등록',
        });
        const refreshed = await fetchImageVersions(sceneUuid, type);
        if (type === 'guide') {
          setGuideVersions(refreshed);
          setCurrentGuideId(baseVer.id);
        } else {
          setStoryboardVersions(refreshed);
          setCurrentStoryboardId(baseVer.id);
        }
      } catch (err) {
        console.error('[ImageModal] legacy 이미지 v1 seed 실패:', err);
        toast.error('기존 이미지를 버전으로 등록하는 데 실패했습니다');
        return;
      }
    }
    try {
      const imageRect = annotationRef.current?.getImageRect() ?? null;
      const blob = await composeAnnotation(baseVer.url, canvas, imageRect);
      // v1.30.2 (한솔 보고 2026-05-24): composeAnnotation 결과가 PNG (투명 배경 유지) 로 바뀌어 file 확장자/MIME 도 png 로.
      const file = new File([blob], `annotation_${Date.now()}.png`, { type: 'image/png' });
      if (!onUploadImage) {
        toast.error('이미지 업로드 함수가 연결되지 않았습니다');
        return;
      }
      const uploadedUrl = await onUploadImage(file, type);
      const newVer = await createImageVersion({
        sceneId: sceneUuid,
        imageType: type,
        kind: 'annotate',
        url: uploadedUrl,
        baseVersionNo: baseVer.versionNo,
        createdBy: currentUserId,
        description: annotationDescription.trim() || null,
      });
      const refreshed = await fetchImageVersions(sceneUuid, type);
      if (type === 'guide') {
        setGuideVersions(refreshed);
        setCurrentGuideId(newVer.id);
      } else {
        setStoryboardVersions(refreshed);
        setCurrentStoryboardId(newVer.id);
      }
      toast.success(`주석 v${newVer.versionNo} 저장됨`);
      annotationRef.current?.clear();
      setAnnotateMode(null);
      setAnnotationDescription('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`주석 저장 실패: ${msg}`);
    }
    // 코덱스 3차 P2 (2026-05-24): legacy 폴백이 guideUrl/storyboardUrl props 를 읽으므로
    //   deps 에도 포함. 모달 열려있는 동안 씬 데이터가 라이브 업데이트되면 자동 v1 시드가
    //   stale URL 로 생성될 위험 차단.
  }, [annotateMode, sceneUuid, currentUserId, guideVersions, storyboardVersions, currentGuideId, currentStoryboardId, guideUrl, storyboardUrl, onUploadImage, annotationDescription]);

  const handleVersionDelete = useCallback(async (imageType: 'storyboard' | 'guide', versionId: string) => {
    if (!sceneUuid) return;
    try {
      await removeImageVersion(versionId);
      const refreshed = await fetchImageVersions(sceneUuid, imageType);
      if (imageType === 'guide') {
        setGuideVersions(refreshed);
        const latest = pickLatestVersion(refreshed);
        setCurrentGuideId(latest?.id ?? null);
      } else {
        setStoryboardVersions(refreshed);
        const latest = pickLatestVersion(refreshed);
        setCurrentStoryboardId(latest?.id ?? null);
      }
      toast.success('버전 삭제됨');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  }, [sceneUuid]);

  /** 현재 마우스 위치 기준 이미지 종류 추정 (side-by-side / overlay 분기). */
  const inferImageType = useCallback((clientX: number): 'storyboard' | 'guide' => {
    // 오버레이/단일 뷰는 현재 view 기준
    if (view === 'single-guide') return 'guide';
    if (view === 'single-storyboard') return 'storyboard';
    if (view === 'overlay') return overlayOpacity > 0.5 ? 'guide' : 'storyboard';
    // side-by-side: 가로 중점 기준 좌=스토리보드, 우=가이드
    const rect = imageAreaRef.current?.getBoundingClientRect();
    if (!rect) return 'storyboard';
    return clientX < rect.left + rect.width / 2 ? 'storyboard' : 'guide';
  }, [view, overlayOpacity]);

  const handleImageContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = imageAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCtxMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      imageType: inferImageType(e.clientX),
    });
  }, [inferImageType]);

  // v1.26.1 → v1.26.2: framer-motion / Electron contextmenu 비활성 등 다양한 환경 대응.
  //          ① imageAreaRef 의 native ref level capture listener + pointerdown(button===2) 백업
  //          ② document 레벨도 함께 (안전망)
  useEffect(() => {
    const area = imageAreaRef.current;
    if (!area) return;
    const trigger = (clientX: number, clientY: number, target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (el && el.closest('button, input, [role="menu"], [data-allow-context-menu]')) return false;
      const rect = area.getBoundingClientRect();
      // 영역 밖 이벤트면 무시
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
      setCtxMenu({
        x: clientX - rect.left,
        y: clientY - rect.top,
        imageType: inferImageType(clientX),
      });
      return true;
    };
    const onContext = (e: MouseEvent) => {
      if (trigger(e.clientX, e.clientY, e.target)) e.preventDefault();
    };
    const onPointerDown = (e: PointerEvent) => {
      // button 2 = 마우스 오른쪽. contextmenu 가 막혀도 pointerdown 은 도달함.
      if (e.button !== 2) return;
      if (trigger(e.clientX, e.clientY, e.target)) e.preventDefault();
    };
    // ① ref level (capture)
    area.addEventListener('contextmenu', onContext, true);
    area.addEventListener('pointerdown', onPointerDown, true);
    // ② document level (안전망)
    document.addEventListener('contextmenu', onContext, true);
    return () => {
      area.removeEventListener('contextmenu', onContext, true);
      area.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onContext, true);
    };
  }, [inferImageType]);

  const openMenuFromMoreBtn = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const stageRect = imageAreaRef.current?.getBoundingClientRect();
    if (!stageRect) return;
    setCtxMenu({
      x: btnRect.right - stageRect.left - 220,
      y: btnRect.bottom - stageRect.top + 6,
      imageType: view === 'single-guide' ? 'guide' : 'storyboard',
    });
  }, [view]);

  const handleContextAction = useCallback((action: ContextAction) => {
    if (!ctxMenu) return;
    const type = ctxMenu.imageType;
    // 현재 라이트박스에서 표시 중인 URL/버전 기준 (버전 시스템 활성화 시 그 값, 아니면 props)
    const isGuide = type === 'guide';
    const versions = isGuide ? guideVersions : storyboardVersions;
    const currentVerId = isGuide ? currentGuideId : currentStoryboardId;
    const currentVer = versions.find((v) => v.id === currentVerId);
    const url = currentVer?.url ?? (isGuide ? guideUrl : storyboardUrl);
    const versionNo = currentVer?.versionNo ?? (isGuide ? guideVersionNo : storyboardVersionNo);
    if (!url) return;
    const sheet = sheetName ?? 'unknown';
    const fileName = generateImageFileName(sheet, sceneId, type, versionNo);
    if (action === 'download') void downloadImage(url, fileName);
    else if (action === 'copy') void copyImageToClipboard(url);
    else if (action === 'copy-url') void copyImageUrl(url);
    else if (action === 'annotate') {
      // v1.26.0: 내부 주석 모드 진입. 외부 onAnnotate 가 주어지면 위임.
      if (onAnnotate) onAnnotate(type);
      else enterAnnotate(type);
    }
  }, [
    ctxMenu, guideUrl, storyboardUrl, guideVersions, storyboardVersions,
    currentGuideId, currentStoryboardId, guideVersionNo, storyboardVersionNo,
    sheetName, sceneId, onAnnotate,
  ]);

  /* ── 뷰 순서 (오버레이 제외) ── */
  const viewOrder: ViewState[] = ['single-storyboard', 'side-by-side', 'single-guide'];

  /* ── 부드러운 줌 (0.05 단위) ── */
  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => Math.round(Math.min(4, Math.max(0.1, z + delta)) * 100) / 100);
  }, []);

  /* ── 방향키 / 화살표 네비게이션 ── */
  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (view === 'overlay' || !hasBoth) return;
      const idx = viewOrder.indexOf(view);
      const next = idx + dir;
      if (next >= 0 && next < viewOrder.length) {
        setDirection(dir);
        setView(viewOrder[next]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, hasBoth],
  );

  /* ── 키보드 핸들러 (ESC는 SceneDetailModal에서 처리) ── */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navigate(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate]);

  /* ── 마우스 휠 줌 ── */
  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      zoomBy(delta);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [zoomBy]);

  /* ── 배경 클릭 → 닫기 ── */
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  /* ── 나란히 이미지 클릭 → 단일 ── */
  const handleImageClick = (which: 'storyboard' | 'guide') => {
    if (view !== 'side-by-side') return;
    setDirection(which === 'storyboard' ? -1 : 1);
    setView(which === 'storyboard' ? 'single-storyboard' : 'single-guide');
  };

  /* ── 툴바 활성 모드 ── */
  const toolbarMode: ToolbarMode =
    view === 'overlay' ? 'overlay' : view === 'side-by-side' ? 'side-by-side' : 'single';

  /* ── 네비게이션 가능 여부 ── */
  const canGoLeft  = hasBoth && view !== 'overlay' && viewOrder.indexOf(view) > 0;
  const canGoRight = hasBoth && view !== 'overlay' && viewOrder.indexOf(view) < viewOrder.length - 1;

  /* ── 씬 네비게이션 / 사진 네비게이션 표시 여부 ── */
  const showSceneDots = totalScenes > 1;
  const showPhotoDots = hasBoth && view !== 'overlay';

  /* ── 스와이프 애니메이션 variants (빠른 tween) ── */
  const slideVariants = {
    enter: (d: number) => ({
      x: d > 0 ? 300 : d < 0 ? -300 : 0,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (d: number) => ({
      x: d > 0 ? -300 : d < 0 ? 300 : 0,
      opacity: 0,
    }),
  };

  /* ────────────────────── 렌더 ────────────────────── */
  // v1.26.1: createPortal 로 document.body 에 렌더 — 부모의 stacking context (사이드바 등) 회피
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="image-modal-backdrop"
        data-no-lasso
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/80 backdrop-blur-sm"
        onClick={handleBackdrop}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          // v1.26.1: framer-motion 내부 motion.div 가 contextmenu 를 가로채는 경우 대비
          //          backdrop 단계에서 받아 imageAreaRef 좌표로 변환해 직접 처리.
          const target = e.target as HTMLElement;
          // 툴바/메뉴 등 정상 컨텍스트가 필요한 영역은 통과
          if (target.closest('button, input, [role="menu"]')) return;
          e.preventDefault();
          const rect = imageAreaRef.current?.getBoundingClientRect();
          if (!rect) return;
          // imageAreaRef 영역 안에서 발생한 우클릭만 처리
          if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
          setCtxMenu({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            imageType: inferImageType(e.clientX),
          });
        }}
      >
        {/* ─── 상단 툴바 ─── */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-bg-card/90 border border-bg-border rounded-xl px-4 py-2 z-10">
          <span className="text-sm text-text-primary font-mono mr-2">{sceneId}</span>

          {hasBoth && (
            <>
              <div className="w-px h-5 bg-bg-border" />
              {(['single', 'side-by-side', 'overlay'] as ToolbarMode[]).map((m) => {
                const labels: Record<ToolbarMode, string> = {
                  single: '단일',
                  'side-by-side': '나란히',
                  overlay: '오버레이',
                };
                const icons: Record<ToolbarMode, React.ReactNode> = {
                  single: null,
                  'side-by-side': <Columns2 size={14} />,
                  overlay: <Layers size={14} />,
                };
                return (
                  <button
                    key={m}
                    onClick={() => {
                      if (m === 'single') {
                        setDirection(-1);
                        setView('single-storyboard');
                      } else if (m === 'side-by-side') {
                        setDirection(0);
                        setView('side-by-side');
                      } else {
                        setView('overlay');
                      }
                    }}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
                      toolbarMode === m
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {icons[m]}
                    {labels[m]}
                  </button>
                );
              })}
            </>
          )}

          <div className="w-px h-5 bg-bg-border" />

          {/* 줌 컨트롤 */}
          <button
            onClick={() => zoomBy(-0.25)}
            className="p-1 text-text-secondary hover:text-text-primary"
            title="축소"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className={cn(
              'text-xs w-12 text-center rounded px-1 py-0.5 transition-colors',
              zoom === 1
                ? 'text-accent bg-accent/10'
                : 'text-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer',
            )}
            title="원본 크기 (100%)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => zoomBy(0.25)}
            className="p-1 text-text-secondary hover:text-text-primary"
            title="확대"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1 text-text-secondary hover:text-text-primary"
            title="원본 크기로"
          >
            <Maximize size={14} />
          </button>

          <div className="w-px h-5 bg-bg-border" />
          <button
            onClick={openMenuFromMoreBtn}
            className="p-1 text-text-secondary hover:text-text-primary"
            title="더보기 (우클릭 메뉴)"
          >
            <MoreHorizontal size={16} />
          </button>
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-red-400">
            <X size={16} />
          </button>
        </div>

        {/* ─── 오버레이 슬라이더 ─── */}
        {view === 'overlay' && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-bg-card/90 border border-bg-border rounded-xl px-4 py-2 z-10">
            <span className="text-[11px] text-text-secondary">스토리보드</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              className="w-48 accent-accent"
            />
            <span className="text-[11px] text-text-secondary">가이드</span>
          </div>
        )}

        {/* ─── 좌 화살표 버튼 ─── */}
        {canGoLeft && (
          <button
            onClick={() => navigate(-1)}
            className="absolute left-6 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full
                       bg-white/5 text-white/40 hover:text-white hover:bg-white/15
                       backdrop-blur transition-all duration-200"
          >
            <ChevronLeft size={28} />
          </button>
        )}

        {/* ─── 우 화살표 버튼 ─── */}
        {canGoRight && (
          <button
            onClick={() => navigate(1)}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full
                       bg-white/5 text-white/40 hover:text-white hover:bg-white/15
                       backdrop-blur transition-all duration-200"
          >
            <ChevronRight size={28} />
          </button>
        )}

        {/* ─── 하단 네비게이션: 사진 도트 + 씬 도트 ─── */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-10">
          {/* 사진(이미지 뷰) 네비게이션 도트 */}
          <AnimatePresence>
            {showPhotoDots && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="flex items-center gap-2"
              >
                {viewOrder.map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      const dir = viewOrder.indexOf(v) - viewOrder.indexOf(view);
                      setDirection(dir > 0 ? 1 : dir < 0 ? -1 : 0);
                      setView(v);
                    }}
                    className={cn(
                      'rounded-full transition-all duration-300 cursor-pointer',
                      v === view
                        ? 'w-6 h-2 bg-accent'
                        : 'w-2 h-2 bg-white/30 hover:bg-white/50',
                    )}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 씬 네비게이션 도트 */}
          <AnimatePresence>
            {showSceneDots && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1], delay: showPhotoDots ? 0.05 : 0 }}
                className="flex items-center gap-3 bg-bg-card/70 border border-bg-border/50 rounded-full px-4 py-2 backdrop-blur-sm"
              >
                <button
                  onClick={() => onSceneNavigate?.('prev')}
                  disabled={!hasPrevScene}
                  className={cn(
                    'transition-colors',
                    hasPrevScene ? 'text-white/60 hover:text-white cursor-pointer' : 'text-white/15 cursor-not-allowed',
                  )}
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: totalScenes }, (_, i) => {
                    const isCurrent = i === currentSceneIndex;
                    const showDot = totalScenes <= 9 ||
                      i === 0 || i === totalScenes - 1 ||
                      Math.abs(i - currentSceneIndex) <= 1;
                    const showEllipsis = !showDot && (
                      (i === 1 && currentSceneIndex > 2) ||
                      (i === totalScenes - 2 && currentSceneIndex < totalScenes - 3)
                    );
                    if (showEllipsis) {
                      return <span key={i} className="text-[7px] text-white/25 px-0.5">...</span>;
                    }
                    if (!showDot) return null;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (i < currentSceneIndex && onSceneNavigate) {
                            for (let j = 0; j < currentSceneIndex - i; j++) {
                              setTimeout(() => onSceneNavigate('prev'), j * 30);
                            }
                          } else if (i > currentSceneIndex && onSceneNavigate) {
                            for (let j = 0; j < i - currentSceneIndex; j++) {
                              setTimeout(() => onSceneNavigate('next'), j * 30);
                            }
                          }
                        }}
                        className={cn(
                          'rounded-full transition-all duration-300 cursor-pointer',
                          isCurrent
                            ? 'w-4 h-1.5 bg-white/80'
                            : 'w-1.5 h-1.5 bg-white/25 hover:bg-white/40',
                        )}
                        title={`씬 ${i + 1}`}
                      />
                    );
                  })}
                </div>
                <button
                  onClick={() => onSceneNavigate?.('next')}
                  disabled={!hasNextScene}
                  className={cn(
                    'transition-colors',
                    hasNextScene ? 'text-white/60 hover:text-white cursor-pointer' : 'text-white/15 cursor-not-allowed',
                  )}
                >
                  <ChevronRight size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── 이미지 영역 ─── */}
        <div
          ref={imageAreaRef}
          className="relative w-full h-full flex items-center justify-center pt-20 pb-16 overflow-hidden"
          onContextMenu={handleImageContextMenu}
        >
          {view === 'overlay' ? (
            /* 오버레이 모드 — 스와이프 없음 */
            <div className="relative">
              {storyboardUrl && (
                <img
                  src={displayStoryboardUrl}
                  alt="스토리보드"
                  className="rounded-lg shadow-2xl object-contain transition-transform duration-150 ease-out"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center',
                    maxHeight: '75vh',
                    opacity: 1 - overlayOpacity,
                  }}
                  draggable={false}
                />
              )}
              {guideUrl && (
                <img
                  src={displayGuideUrl}
                  alt="가이드"
                  className="absolute inset-0 rounded-lg object-contain transition-transform duration-150 ease-out"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center',
                    maxHeight: '75vh',
                    opacity: overlayOpacity,
                  }}
                  draggable={false}
                />
              )}
            </div>
          ) : (
            /* 단일 / 나란히 — 스와이프 애니메이션 */
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={view}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
                className="flex items-center justify-center gap-6"
              >
                {/* ── 단일: 스토리보드 ── */}
                {view === 'single-storyboard' && (
                  <div
                    className="flex flex-col items-center gap-3 transition-transform duration-150 ease-out"
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                  >
                    <span className="text-xs text-accent font-medium tracking-wide">스토리보드</span>
                    <img
                      src={displayStoryboardUrl}
                      alt="스토리보드"
                      className="rounded-lg shadow-2xl object-contain"
                      style={{ maxHeight: '75vh' }}
                      draggable={false}
                    />
                    {currentStoryboardDescription && (
                      <AnnotationDescriptionCard text={currentStoryboardDescription} />
                    )}
                  </div>
                )}

                {/* ── 단일: 가이드 ── */}
                {view === 'single-guide' && (
                  <div
                    className="flex flex-col items-center gap-3 transition-transform duration-150 ease-out"
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                  >
                    <span className="text-xs text-accent font-medium tracking-wide">가이드</span>
                    <img
                      src={displayGuideUrl}
                      alt="가이드"
                      className="rounded-lg shadow-2xl object-contain"
                      style={{ maxHeight: '75vh' }}
                      draggable={false}
                    />
                    {currentGuideDescription && (
                      <AnnotationDescriptionCard text={currentGuideDescription} />
                    )}
                  </div>
                )}

                {/* ── 나란히 (3D 호버 + 클릭) ── */}
                {view === 'side-by-side' && (
                  <>
                    {/* 스토리보드 (왼쪽) */}
                    <div
                      className="flex flex-col items-center gap-2 cursor-pointer transition-transform duration-150 ease-out"
                      style={{ perspective: 800, transform: `scale(${zoom})`, transformOrigin: 'center' }}
                      onClick={() => handleImageClick('storyboard')}
                    >
                      <span className="text-xs text-text-secondary">스토리보드</span>
                      {storyboardUrl ? (
                        <HoverCard3D direction="left">
                          <img
                            src={displayStoryboardUrl}
                            alt="스토리보드"
                            className="rounded-lg shadow-2xl object-contain"
                            style={{
                              maxHeight: '70vh',
                              maxWidth: '42vw',
                            }}
                            draggable={false}
                          />
                        </HoverCard3D>
                      ) : (
                        <EmptySlot />
                      )}
                      {currentStoryboardDescription && (
                        <AnnotationDescriptionCard text={currentStoryboardDescription} />
                      )}
                    </div>

                    {/* 가이드 (오른쪽) */}
                    <div
                      className="flex flex-col items-center gap-2 cursor-pointer transition-transform duration-150 ease-out"
                      style={{ perspective: 800, transform: `scale(${zoom})`, transformOrigin: 'center' }}
                      onClick={() => handleImageClick('guide')}
                    >
                      <span className="text-xs text-text-secondary">가이드</span>
                      {guideUrl ? (
                        <HoverCard3D direction="right">
                          <img
                            src={displayGuideUrl}
                            alt="가이드"
                            className="rounded-lg shadow-2xl object-contain"
                            style={{
                              maxHeight: '70vh',
                              maxWidth: '42vw',
                            }}
                            draggable={false}
                          />
                        </HoverCard3D>
                      ) : (
                        <EmptySlot />
                      )}
                      {currentGuideDescription && (
                        <AnnotationDescriptionCard text={currentGuideDescription} />
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {/* v1.26.0/v1.26.3: 버전 드롭다운 — sceneUuid 활성화 시
              · 단일 스토리보드: 좌상단 스토리보드
              · 단일 가이드: 좌상단 가이드
              · 나란히: 좌상단 스토리보드 + 우상단 가이드 */}
          {sceneUuid && (view === 'single-storyboard' || view === 'side-by-side') && storyboardVersions.length > 0 && (
            <div className="absolute top-3 left-3 z-20">
              <ImageVersionDropdown
                versions={storyboardVersions}
                currentVersionId={currentStoryboardId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onSelect={setCurrentStoryboardId}
                onDelete={(vid) => handleVersionDelete('storyboard', vid)}
              />
            </div>
          )}
          {sceneUuid && view === 'single-guide' && guideVersions.length > 0 && (
            <div className="absolute top-3 left-3 z-20">
              <ImageVersionDropdown
                versions={guideVersions}
                currentVersionId={currentGuideId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onSelect={setCurrentGuideId}
                onDelete={(vid) => handleVersionDelete('guide', vid)}
              />
            </div>
          )}
          {sceneUuid && view === 'side-by-side' && guideVersions.length > 0 && (
            <div className="absolute top-3 right-3 z-20">
              <ImageVersionDropdown
                versions={guideVersions}
                currentVersionId={currentGuideId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onSelect={setCurrentGuideId}
                onDelete={(vid) => handleVersionDelete('guide', vid)}
              />
            </div>
          )}

          {/* v1.26.0: 우클릭 컨텍스트 메뉴 */}
          {ctxMenu && (
            <ImageContextMenu
              open={true}
              x={ctxMenu.x}
              y={ctxMenu.y}
              containerWidth={imageAreaRef.current?.clientWidth ?? 0}
              containerHeight={imageAreaRef.current?.clientHeight ?? 0}
              onAction={handleContextAction}
              onClose={() => setCtxMenu(null)}
            />
          )}
        </div>

        {/* v1.26.0: 하단 썸네일 스트립 — sceneUuid 활성화 시. 현재 view 의 imageType 기준 */}
        {sceneUuid && !annotateMode && (() => {
          const activeType: 'storyboard' | 'guide' = view === 'single-guide' ? 'guide' : 'storyboard';
          const versions = activeType === 'guide' ? guideVersions : storyboardVersions;
          const currentId = activeType === 'guide' ? currentGuideId : currentStoryboardId;
          if (versions.length === 0) return null;
          return (
            <div className="absolute bottom-0 left-0 right-0 z-10">
              <ImageVersionStrip
                versions={versions}
                currentVersionId={currentId}
                onSelect={(vid) => {
                  if (activeType === 'guide') setCurrentGuideId(vid);
                  else setCurrentStoryboardId(vid);
                }}
                onAdd={() => handleVersionAdd(activeType)}
              />
            </div>
          );
        })()}

        {/* v1.26.0: 주석 모드 오버레이 */}
        {annotateMode && (() => {
          const type = annotateMode.imageType;
          const versions = type === 'guide' ? guideVersions : storyboardVersions;
          const currentId = type === 'guide' ? currentGuideId : currentStoryboardId;
          const currentVer = versions.find((v) => v.id === currentId);
          const targetUrl = currentVer?.url ?? (type === 'guide' ? guideUrl : storyboardUrl);
          const baseVer = currentVer?.versionNo ?? 1;
          if (!targetUrl) return null;
          return (
            <div className="absolute inset-0 z-40 bg-bg-primary">
              <AnnotationCanvas
                ref={annotationRef}
                imageUrl={targetUrl}
                baseVersionNo={baseVer}
                description={annotationDescription}
                onDescriptionChange={setAnnotationDescription}
              />
              <div className="absolute top-3 right-3 flex gap-2 z-50">
                <button
                  type="button"
                  onClick={exitAnnotate}
                  className="px-3 py-1.5 text-xs text-text-secondary border border-bg-border rounded-md hover:bg-bg-border/50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={saveAnnotation}
                  className="px-3 py-1.5 text-xs text-white bg-accent rounded-md hover:bg-accent/80 inline-flex items-center gap-1.5 font-semibold"
                >
                  <Check size={14} /> 주석 새 버전으로 저장
                </button>
              </div>
            </div>
          );
        })()}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

/* ══════════════════════════════════════════════════════════════
   서브 컴포넌트
   ══════════════════════════════════════════════════════════════ */

/** 3D 호버 카드 래퍼 — direction 에 따라 회전 방향이 다름 */
function HoverCard3D({
  direction,
  children,
}: {
  direction: 'left' | 'right';
  children: React.ReactNode;
}) {
  const rotateY = direction === 'left' ? 6 : -6;

  return (
    <motion.div
      className="rounded-lg"
      whileHover={{
        rotateY,
        scale: 1.04,
        boxShadow: '0 25px 60px -12px rgba(99, 102, 241, 0.25)',
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {children}
    </motion.div>
  );
}

/** 이미지 없음 슬롯 */
function EmptySlot() {
  return (
    <div className="w-64 h-48 rounded-lg bg-bg-card border border-bg-border flex items-center justify-center text-text-secondary text-sm">
      이미지 없음
    </div>
  );
}

/**
 * v1.26.2 — 주석 버전의 description 을 이미지 아래에 부드럽게 떠 있는 카드로.
 * backdrop-blur + subtle border + 부드러운 그림자. 너무 강조하지 않게.
 */
function AnnotationDescriptionCard({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-[480px] mt-1 px-3 py-2 rounded-lg bg-bg-card/55 backdrop-blur-md border border-bg-border/40 text-[12px] leading-relaxed text-text-primary/90 shadow-[0_8px_24px_rgba(0,0,0,0.25)] whitespace-pre-line"
    >
      {text}
    </motion.div>
  );
}
