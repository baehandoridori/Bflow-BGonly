import { useState } from 'react';
import { motion } from 'framer-motion';
import { CommentPanel, type CommentPanelQuickRevisionContext } from './CommentPanel';
import { CommentPanelErrorBoundary } from '@/components/common/CommentPanelErrorBoundary';
import { useCommentPanelWidth, useCommentPanelResizer } from '@/hooks/useCommentPanelWidth';
import { ResizeEdgeGlow } from '@/components/common/ResizeEdgeGlow';
import { ResizeHandleParticles } from '@/components/common/ResizeHandleParticles';

/**
 * v1.27.0: 상세 모달 옆 댓글 패널 — 3중 반응형.
 *
 * 너비 우선순위:
 *   1. 사용자가 드래그로 저장한 값 (preferences.json.commentPanelWidthPx).
 *   2. 댓글 갯수 boost (6~15건 → +40, 16건+ → +80).
 *   3. viewport 기반 clamp(320, viewport*0.26, 480).
 *
 * 좌측 4px 경계가 드래그 핸들. 드래그 중에는 화면 즉시 갱신, mouseup 시 1회만
 * disk 저장 (mousemove 마다 savePreferences 호출하면 I/O 폭주). 더블클릭 시
 * 사용자 저장값 제거 → 자동 모드 복귀.
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
  /** 댓글 입력창 /re 빠른 리비전 등록 문맥. */
  quickRevision?: CommentPanelQuickRevisionContext;
  /** 패널 헤더 제목 (기본: "댓글 및 활동"). */
  headerTitle?: string;
  /** 헤더 우측 슬롯 (예: 토글, 카운터 등 — 통합 모달에서 사용). */
  headerRight?: React.ReactNode;
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
  } = props;

  const { width, setWidth, isUserOverride } = useCommentPanelWidth(commentCount);

  // 드래그 중에는 disk 저장 없이 화면만 즉시 갱신할 임시 너비.
  // mousemove → setLiveWidth(px) 만 호출, mouseup → commitWidth(px) 가 setWidth 호출 (disk 저장).
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [handleHover, setHandleHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const { onMouseDown } = useCommentPanelResizer({
    liveSetWidth: (px) => setLiveWidth(px),
    commitWidth: (px) => {
      setLiveWidth(null);
      setDragging(false);
      void setWidth(px);
    },
  });

  const effectiveWidth = liveWidth ?? width;
  const secondaryKey =
    explicitSecondaryKey
      ?? (counterpartSheetName && counterpartSceneNo != null
        ? `${counterpartSheetName}:${counterpartSceneNo}`
        : undefined);

  return (
    <motion.div
      key="comment-panel"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: 0.1 }}
      className={`bg-bg-card rounded-2xl shadow-2xl border border-bg-border ${heightClass} flex flex-col shrink-0 relative ${className}`}
      style={{ width: effectiveWidth }}
    >
      {/* 좌측 드래그 핸들 — 8px hit zone (얇아 보이지만 잡기 쉽게).
          hover/drag 시 ResizeEdgeGlow 가 accent gradient + glow 표시 (대시보드 위젯 톤 통일).
          더블클릭 = 자동 모드 복귀. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="댓글 패널 너비 조절"
        title="드래그로 너비 조절 · 더블클릭으로 자동 모드 복귀"
        data-no-lasso
        onMouseEnter={() => setHandleHover(true)}
        onMouseLeave={() => setHandleHover(false)}
        onMouseDown={(e) => {
          setDragging(true);
          onMouseDown(e, effectiveWidth);
        }}
        onDoubleClick={() => {
          setLiveWidth(null);
          void setWidth(null);
        }}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10"
      />
      {/* 핸들 idle/hover/drag 3 단계 발광. 평상시도 살짝 보여 핸들 위치 암시 (한솔 v1.27.0 보고). */}
      <ResizeEdgeGlow
        edge="w"
        intensity={dragging ? 'drag' : handleHover ? 'hover' : 'idle'}
        radius={16}
      />
      {/* 드래그 중에만 좌측 변에서 파티클 사르르 (한솔 v1.27.0 보고). */}
      <ResizeHandleParticles edge="w" active={dragging} />

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
        />
      </CommentPanelErrorBoundary>
    </motion.div>
  );
}
