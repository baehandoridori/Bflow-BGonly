import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CommentPanel, type CommentPanelQuickRevisionContext } from './CommentPanel';
import { CommentPanelErrorBoundary } from '@/components/common/CommentPanelErrorBoundary';
import { useCommentPanelWidth, useCommentPanelResizer } from '@/hooks/useCommentPanelWidth';
import { ResizeEdgeGlow } from '@/components/common/ResizeEdgeGlow';
import { ResizeHandleParticles } from '@/components/common/ResizeHandleParticles';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import {
  COMMENT_THREAD_PANEL_DEFAULT_WIDTH,
  COMMENT_THREAD_PANEL_GAP_WIDTH,
  clampCommentThreadPanelWidth,
  computeCommentThreadPanelResizeWidth,
  getCommentThreadPanelMaxWidthForMainWidth,
} from '@/utils/commentPanelResize';

/**
 * v1.27.0: 상세 모달 옆 댓글 패널 — 3중 반응형.
 *
 * 너비 우선순위:
 *   1. 사용자가 드래그로 저장한 값 (preferences.json.commentPanelWidthPx).
 *   2. 댓글 갯수 boost (6~15건 → +40, 16건+ → +80).
 *   3. viewport 기반 clamp(320, viewport*0.26, 480).
 *
 * 스레드 칸 너비는 사용자가 드래그로 조절하면 preferences.json.commentThreadPanelWidthPx 에 저장한다.
 *
 * 안쪽 경계와 바깥쪽 아웃라인이 드래그 핸들. 드래그 중에는 화면 즉시 갱신,
 * mouseup 시 1회만 disk 저장 (mousemove 마다 savePreferences 호출하면 I/O 폭주).
 * 더블클릭 시 사용자 저장값 제거 → 자동 모드 복귀.
 */
interface CommentPanelResizableProps {
  commentCount: number;
  sceneKey: string;
  sceneThreadKey?: string;
  counterpartSheetName?: string | null;
  counterpartSceneNo?: number | null;
  onCountChange?: (count: number) => void;
  focusCommentId?: string;
  sceneLabel?: string;
  /** UnifiedSceneDetailModal 등 일부 컨테이너는 h-[min(900px,92vh)] 같은 고정 높이 사용. */
  heightClass?: string;
  /** 모달 컨테이너 스타일에 맞춘 corner radius 등 추가 className. */
  className?: string;
  /** secondarySceneKey 대체 — UnifiedSceneDetailModal 의 양쪽 sheet 통합 키 패턴. */
  secondarySceneKey?: string;
  /** UnifiedSceneDetailModal 에서 inlineEvents 도 전달. */
  inlineEvents?: React.ComponentProps<typeof CommentPanel>['inlineEvents'];
  /** 댓글 입력창 /re 빠른 리테이크 등록 문맥. */
  quickRevision?: CommentPanelQuickRevisionContext;
  /** 패널 헤더 제목 (기본: "댓글 및 활동"). */
  headerTitle?: string;
  /** 헤더 우측 슬롯 (예: 토글, 카운터 등 — 통합 모달에서 사용). */
  headerRight?: React.ReactNode;
  /** 4c PR2: #씬 칩 클릭 처리 분기(도킹 참조). 없으면 기존 점프. */
  onHashClick?: React.ComponentProps<typeof CommentPanel>['onHashClick'];
  /** 4c PR3: #씬·#파트·#화 칩 우클릭 메뉴. */
  onHashContextMenu?: React.ComponentProps<typeof CommentPanel>['onHashContextMenu'];
}

export function CommentPanelResizable(props: CommentPanelResizableProps) {
  const {
    commentCount,
    sceneKey,
    sceneThreadKey,
    counterpartSheetName,
    counterpartSceneNo,
    onCountChange,
    focusCommentId,
    sceneLabel,
    heightClass = 'max-h-[90vh]',
    className = '',
    secondarySceneKey: explicitSecondaryKey,
    inlineEvents,
    quickRevision,
    headerTitle = '댓글 및 활동',
    headerRight,
    onHashClick,
    onHashContextMenu,
  } = props;

  const { width, setWidth, isUserOverride } = useCommentPanelWidth(commentCount);

  // 드래그 중에는 disk 저장 없이 화면만 즉시 갱신할 임시 너비.
  // mousemove → setLiveWidth(px) 만 호출, mouseup → commitWidth(px) 가 setWidth 호출 (disk 저장).
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [handleHover, setHandleHover] = useState<'inner' | 'outer' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragEdge, setDragEdge] = useState<'inner' | 'outer' | null>(null);
  const [threadPanelOpen, setThreadPanelOpen] = useState(false);
  const [threadWidth, setThreadWidth] = useState(COMMENT_THREAD_PANEL_DEFAULT_WIDTH);
  const [liveThreadWidth, setLiveThreadWidth] = useState<number | null>(null);
  const [threadHandleHover, setThreadHandleHover] = useState(false);
  const [threadDragging, setThreadDragging] = useState(false);
  const threadDragStateRef = useRef<{ startX: number; startW: number } | null>(null);
  const threadMouseMoveRef = useRef<((event: MouseEvent) => void) | null>(null);
  const threadMouseUpRef = useRef<((event: MouseEvent) => void) | null>(null);

  const { onMouseDown } = useCommentPanelResizer({
    liveSetWidth: (px) => setLiveWidth(px),
    commitWidth: (px) => {
      setLiveWidth(null);
      setDragging(false);
      setDragEdge(null);
      void setWidth(px);
    },
  });

  const effectiveWidth = liveWidth ?? width;
  const threadMaxWidth = getCommentThreadPanelMaxWidthForMainWidth(effectiveWidth);
  const effectiveThreadWidth = clampCommentThreadPanelWidth(liveThreadWidth ?? threadWidth, threadMaxWidth);
  const threadFrameWidth = threadPanelOpen ? COMMENT_THREAD_PANEL_DEFAULT_WIDTH + COMMENT_THREAD_PANEL_GAP_WIDTH : 0;
  const renderedWidth = effectiveWidth + threadFrameWidth;
  const secondaryKey =
    explicitSecondaryKey
      ?? (counterpartSheetName && counterpartSceneNo != null
        ? `${counterpartSheetName}:${counterpartSceneNo}`
        : undefined);

  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      const v = prefs?.commentThreadPanelWidthPx;
      if (typeof v === 'number' && Number.isFinite(v)) {
        setThreadWidth(clampCommentThreadPanelWidth(v));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setThreadWidthPersistent = useCallback(async (px: number | null) => {
    if (px == null) {
      setThreadWidth(COMMENT_THREAD_PANEL_DEFAULT_WIDTH);
    } else {
      const clamped = clampCommentThreadPanelWidth(px);
      setThreadWidth(clamped);
    }

    const prefs = (await loadPreferences()) ?? {};
    if (px == null) {
      const { commentThreadPanelWidthPx: _omit, ...rest } = prefs;
      await savePreferences(rest);
    } else {
      const clamped = clampCommentThreadPanelWidth(px);
      await savePreferences({ ...prefs, commentThreadPanelWidthPx: clamped });
    }
  }, []);

  const clearThreadDragListeners = useCallback(() => {
    if (threadMouseMoveRef.current) window.removeEventListener('mousemove', threadMouseMoveRef.current);
    if (threadMouseUpRef.current) window.removeEventListener('mouseup', threadMouseUpRef.current);
    threadMouseMoveRef.current = null;
    threadMouseUpRef.current = null;
    threadDragStateRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleThreadResizeMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = effectiveThreadWidth;
    threadDragStateRef.current = { startX, startW };
    setThreadDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const state = threadDragStateRef.current;
      if (!state) return;
      setLiveThreadWidth(computeCommentThreadPanelResizeWidth(state.startW, state.startX, moveEvent.clientX, threadMaxWidth));
    };
    const onUp = (upEvent: MouseEvent) => {
      const state = threadDragStateRef.current;
      const nextWidth = state
        ? computeCommentThreadPanelResizeWidth(state.startW, state.startX, upEvent.clientX, threadMaxWidth)
        : effectiveThreadWidth;
      clearThreadDragListeners();
      setLiveThreadWidth(null);
      setThreadDragging(false);
      void setThreadWidthPersistent(nextWidth);
    };

    threadMouseMoveRef.current = onMove;
    threadMouseUpRef.current = onUp;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clearThreadDragListeners, effectiveThreadWidth, setThreadWidthPersistent, threadMaxWidth]);

  const resetThreadWidth = useCallback(() => {
    setLiveThreadWidth(null);
    void setThreadWidthPersistent(null);
  }, [setThreadWidthPersistent]);

  useEffect(() => {
    return () => {
      clearThreadDragListeners();
    };
  }, [clearThreadDragListeners]);

  return (
    <motion.div
      key="comment-panel"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: 0.1 }}
      className={`bg-bg-card rounded-2xl shadow-2xl border border-bg-border ${heightClass} flex flex-col shrink-0 relative ${className}`}
      style={{ width: renderedWidth }}
    >
      {/* 안쪽 경계 드래그 핸들 — 본문과 댓글 사이에서 잡는 기존 경로. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="댓글 패널 안쪽 경계로 너비 조절"
        title="드래그로 너비 조절 · 더블클릭으로 자동 모드 복귀"
        data-no-lasso
        data-comment-panel-resize-edge="inner"
        onMouseEnter={() => setHandleHover('inner')}
        onMouseLeave={() => setHandleHover(null)}
        onMouseDown={(e) => {
          setDragging(true);
          setDragEdge('inner');
          onMouseDown(e, effectiveWidth, 'inner');
        }}
        onDoubleClick={() => {
          setLiveWidth(null);
          void setWidth(null);
        }}
        className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize z-10"
      />
      {/* 바깥쪽 아웃라인 드래그 핸들 — 패널 오른쪽 테두리를 잡아도 너비 조절. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="댓글 패널 바깥쪽 경계로 너비 조절"
        title="바깥쪽 아웃라인을 드래그로 너비 조절 · 더블클릭으로 자동 모드 복귀"
        data-no-lasso
        data-comment-panel-resize-edge="outer"
        onMouseEnter={() => setHandleHover('outer')}
        onMouseLeave={() => setHandleHover(null)}
        onMouseDown={(e) => {
          setDragging(true);
          setDragEdge('outer');
          onMouseDown(e, effectiveWidth, 'outer');
        }}
        onDoubleClick={() => {
          setLiveWidth(null);
          void setWidth(null);
        }}
        className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-10"
      />
      {/* 핸들 idle/hover/drag 3 단계 발광. 평상시도 살짝 보여 핸들 위치 암시 (한솔 v1.27.0 보고). */}
      <ResizeEdgeGlow
        edge="w"
        intensity={dragging && dragEdge === 'inner' ? 'drag' : handleHover === 'inner' ? 'hover' : 'idle'}
        radius={16}
      />
      <ResizeEdgeGlow
        edge="e"
        intensity={dragging && dragEdge === 'outer' ? 'drag' : handleHover === 'outer' ? 'hover' : 'idle'}
        radius={16}
      />
      {/* 드래그 중에만 잡고 있는 변에서 파티클 표시. */}
      <ResizeHandleParticles edge="w" active={dragging && dragEdge === 'inner'} />
      <ResizeHandleParticles edge="e" active={dragging && dragEdge === 'outer'} />

      <div className="px-4 py-3 border-b border-bg-border shrink-0 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text-primary">
          {headerTitle}
          {isUserOverride && (
            <span className="ml-2 text-[10px] text-text-secondary/50 font-normal" title="사용자 설정 너비. 더블클릭으로 자동 모드.">
              · 너비 고정
            </span>
          )}
        </h3>
        {headerRight}
      </div>
      <CommentPanelErrorBoundary panelId="single" key={sceneKey}>
        <CommentPanel
          sceneKey={sceneKey}
          sceneThreadKey={sceneThreadKey}
          secondarySceneKey={secondaryKey}
          onCountChange={onCountChange}
          focusCommentId={focusCommentId ?? null}
          sceneLabel={sceneLabel}
          inlineEvents={inlineEvents}
          quickRevision={quickRevision}
          onHashClick={onHashClick}
          onHashContextMenu={onHashContextMenu}
          onThreadPanelOpenChange={setThreadPanelOpen}
          threadWidth={effectiveThreadWidth}
          threadResizeActive={threadDragging}
          threadResizeHover={threadHandleHover}
          onThreadResizeMouseDown={handleThreadResizeMouseDown}
          onThreadResizeDoubleClick={resetThreadWidth}
          onThreadResizeHoverChange={setThreadHandleHover}
        />
      </CommentPanelErrorBoundary>
    </motion.div>
  );
}
