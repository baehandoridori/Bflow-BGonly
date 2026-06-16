import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { toast as sonnerToast } from 'sonner';
import { useDataStore, legacyStagesFor } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import type { SortKey, StatusFilter, ViewMode } from '@/stores/useAppStore';
import { STAGES, DEPARTMENTS, DEPARTMENT_CONFIGS, SCENE_PHASE_LABELS, SCENE_PHASES, SCENE_PHASE_LABELS_SHORT, SCENE_PHASE_COLORS } from '@/types';
import type { Scene, Stage, Department, ScenesDeptFilter, MergedScene, ScenePhaseState, SceneAssigneeProgressMap } from '@/types';
import { FeedbackRequestModal } from '@/components/scenes/FeedbackRequestModal';
import { updateScenePhaseInSupabase, dispatchActingFeedbackNotification } from '@/services/supabaseService';
import { sceneProgress, isFullyDone, isNotStarted, progressGradient } from '@/utils/calcStats';
import { normalizeSceneIdKey } from '@/utils/sceneIdKey';
import { findPartById, getCanonicalPartIds, partIdMatches } from '@/utils/partId';
import {
  buildUnifiedSceneId,
  getMergedCommentBadgeCounts,
  matchesMergedSceneIdentity,
} from '@/utils/mergedSceneHelpers';
import { getAllViewCompletionState, getSingleViewCompletionState } from '@/utils/visibleCompletion';
import {
  buildSequentialStagePatch,
  getChangedSequentialStages,
  isSequentialStageComplete,
} from '@/utils/sceneStageProgression';
import { buildSingleSceneSelectionId } from '@/utils/sceneSelectionId';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, LayoutGrid, Grid3x3, Layers, List, ChevronUp, ChevronDown, ClipboardPaste, ImagePlus, ArrowLeft, CheckSquare, Trash2, X, MessageCircle, Pencil, MoreVertical, StickyNote, Archive, Film, RotateCcw, Clock, PlayCircle, CheckCircle2, Circle, MessageSquareWarning, Plus, UserRound } from 'lucide-react';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';
import { HighlightText } from '@/components/common/HighlightText';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { EpisodeTreeNav } from '@/components/scenes/EpisodeTreeNav';
import { SceneSheetView } from '@/components/scenes/SceneSheetView';
import { UnifiedSceneCard } from '@/components/scenes/UnifiedSceneCard';
import { UnifiedSceneSheetView } from '@/components/scenes/UnifiedSceneSheetView';
import { ScenePhaseToggle } from '@/components/scenes/ScenePhaseToggle';
import { LengthIcon } from '@/components/scenes/LengthIcon';
import { UnifiedSceneDetailModal } from '@/components/scenes/UnifiedSceneDetailModal';
import { StageSegmentToggle, stageIcon } from '@/components/scenes/StageSegmentToggle';
import { RevisionCornerFlag } from '@/components/scenes/RevisionCornerFlag';
import { AssigneeProgressStack } from '@/components/scenes/AssigneeProgressStack';
import { BulkOperationStatus } from '@/components/scenes/BulkOperationStatus';
import { useAuthStore } from '@/stores/useAuthStore';
import { setCommentsSheetsMode, getCommentStoreForPart, invalidatePartCache } from '@/services/commentService';
import {
  COMMENT_READ_STATE_EVENT,
  getCommentReadStateForUser,
  getLatestCommentCreatedAt,
  getLatestOtherUserCommentCreatedAt,
  isCommentKeyUnread,
} from '@/services/commentReadStateService';
import { setRevisionsSheetsMode, buildSceneKey } from '@/services/revisionService';
import { buildSceneThreadKeyFromCommentKey } from '@/utils/commentThreadKey';
import { useRevisionStore } from '@/stores/useRevisionStore';
import type { PartContextMenuTarget } from '@/utils/partMemoHelpers';
import { usePartMemos } from '@/hooks/usePartMemos';
import { useUnifiedScenes } from '@/hooks/useUnifiedScenes';
import { loadPreferences, savePreferences, type UserPreferences } from '@/services/settingsService';
import {
  persistLengthChangeAtomic,
  persistLengthChangeIndependent,
  saveLengthChangeField,
  type LengthChangeTarget,
} from '@/utils/lengthChangePersistence';
import { compareSceneIdsByNumberThenSuffix, compareScenesByNumberThenSuffix } from '@/utils/sceneSort';
import {
  SCENE_ASSIGNEE_PROGRESS_META_TYPE,
  aggregateScenePatchFromAssignees,
  serializeAssigneeProgress,
  updateAllAssigneeProgressEntries,
  updateAssigneeProgressEntry,
  hasMultiAssigneeProgress,
  normalizeAssigneeProgressMap,
  sceneStateFromScene,
} from '@/utils/assigneeProgress';

function phaseIcon(phase: ScenePhaseState, size = 12) {
  if (phase === 'wait') return <Clock size={size} strokeWidth={2.4} />;
  if (phase === 'work') return <PlayCircle size={size} strokeWidth={2.4} />;
  if (phase === 'feedback') return <MessageSquareWarning size={size} strokeWidth={2.4} />;
  return <CheckCircle2 size={size} strokeWidth={2.4} />;
}

function phaseFromStage(stage: Stage): ScenePhaseState {
  if (stage === 'lo') return 'wait';
  if (stage === 'done') return 'work';
  if (stage === 'review') return 'feedback';
  return 'done';
}

function parseAssigneeNames(assignee: string | null | undefined): string[] {
  return (assignee ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function sceneMatchesAssignee(scene: Scene, assignee: string): boolean {
  return parseAssigneeNames(scene.assignee).includes(assignee);
}

function buildSceneCardKey(sheetName: string | null | undefined, scene: Scene, sceneIndex: number): string {
  return scene.id ?? `${sheetName ?? 'scene'}:${scene.no}:${scene.sceneId}:${sceneIndex}`;
}

function mergedMatchesStatusFilter(merged: MergedScene, statusFilter: StatusFilter): boolean {
  if (statusFilter === 'all') return true;
  const presentScenes = [merged.bgScene, merged.actScene].filter((scene): scene is Scene => Boolean(scene));
  if (presentScenes.length === 0) return false;
  const allDone = presentScenes.every(isFullyDone);
  const allNotStarted = presentScenes.every(isNotStarted);

  if (statusFilter === 'done') return allDone;
  if (statusFilter === 'not-started') return allNotStarted;
  return !allDone && !allNotStarted;
}

/* ── 라쏘 드래그 선택 훅 ── */
interface LassoRect { x: number; y: number; w: number; h: number }

function useLassoSelection(
  containerRef: React.RefObject<HTMLElement | null>,
  cardSelector: string,
  getSceneId: (el: Element) => string | null,
  /**
   * @param ids  lasso 영역에 걸린 원본 sceneId 집합 (prefix 없음).
   * @param shiftKey  mousedown 시점의 Shift 상태. true면 baseline과 union해야 함.
   * @param baseline  mousedown 시점에 snapshot된 기존 selection (shiftKey=false 또는 getBaselineSelection 미제공이면 빈 Set).
   */
  onSelectionChange: (ids: Set<string>, shiftKey: boolean, baseline: Set<string>) => void,
  enabled: boolean,
  /**
   * Shift+라쏘 시 mousedown 시점에 기존 selection을 한 번만 snapshot해 baseline으로 고정.
   * 매 mousemove마다 재읽으면 이전 프레임의 누적 selection이 섞여 "드래그 경로 누적" 버그 발생.
   */
  getBaselineSelection?: () => Set<string>,
) {
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const startScrollRef = useRef<{ top: number; left: number } | null>(null);
  const isDragging = useRef(false);
  const prevIds = useRef<Set<string>>(new Set());
  const startShiftRef = useRef(false);
  const baselineRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, [role="button"], [data-no-lasso], [contenteditable="true"]')) return;
      if (e.button !== 0) return;

      startRef.current = { x: e.clientX, y: e.clientY };
      const scrollEl = findScrollParent(target) ?? container;
      startScrollRef.current = { top: scrollEl.scrollTop, left: scrollEl.scrollLeft };
      isDragging.current = false;
      startShiftRef.current = e.shiftKey;
      // Shift+라쏘: mousedown 시점의 selection을 여기서 한 번만 snapshot.
      // 이후 mousemove 내내 이 baseline을 재사용 (누적 버그 방지).
      baselineRef.current = e.shiftKey && getBaselineSelection
        ? new Set(getBaselineSelection())
        : new Set();

      const onMouseMove = (me: MouseEvent) => {
        if (!startRef.current || !startScrollRef.current) return;
        const scrollDx = scrollEl.scrollLeft - startScrollRef.current.left;
        const scrollDy = scrollEl.scrollTop - startScrollRef.current.top;
        const dx = (me.clientX - startRef.current.x) - scrollDx;
        const dy = (me.clientY - startRef.current.y) - scrollDy;

        if (!isDragging.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        isDragging.current = true;

        const x = Math.min(startRef.current.x, me.clientX);
        const y = Math.min(startRef.current.y, me.clientY);
        const w = Math.abs(me.clientX - startRef.current.x);
        const h = Math.abs(me.clientY - startRef.current.y);
        setLassoRect({ x, y, w, h });

        const cards = container.querySelectorAll(cardSelector);
        const selected = new Set<string>();
        cards.forEach((card) => {
          const rect = card.getBoundingClientRect();
          if (rect.left < x + w && rect.right > x && rect.top < y + h && rect.bottom > y) {
            const id = getSceneId(card);
            if (id) selected.add(id);
          }
        });
        if (selected.size !== prevIds.current.size || ![...selected].every((id) => prevIds.current.has(id))) {
          prevIds.current = selected;
          onSelectionChange(selected, startShiftRef.current, baselineRef.current);
        }
      };

      const onMouseUp = (me: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!isDragging.current) {
          // 단순 클릭: Ctrl/Meta/Shift 눌려있으면 기존 선택 유지, 아니면 초기화.
          if (!me.ctrlKey && !me.metaKey && !me.shiftKey) {
            onSelectionChange(new Set(), false, new Set());
            prevIds.current = new Set();
          }
        }
        startRef.current = null;
        startScrollRef.current = null;
        startShiftRef.current = false;
        baselineRef.current = new Set();
        isDragging.current = false;
        setLassoRect(null);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    container.addEventListener('mousedown', onMouseDown);
    return () => container.removeEventListener('mousedown', onMouseDown);
  }, [enabled, containerRef, cardSelector, getSceneId, onSelectionChange, getBaselineSelection]);

  return { lassoRect, isSelecting: isDragging.current };
}

// 유틸: 가장 가까운 스크롤 가능 부모
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const style = getComputedStyle(cur);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/* ── 글로우 하이라이트 CSS 주입 (스포트라이트/인원별 뷰에서 이동 시) ── */
const GLOW_CSS = `
@keyframes scene-glow-pulse {
  0%   { box-shadow: 0 0 0 2px rgb(var(--color-accent) / 0.8), 0 0 16px 4px rgb(var(--color-accent) / 0.5), 0 0 40px 8px rgb(var(--color-accent) / 0.2), 0 0 60px 12px rgb(var(--color-accent-sub) / 0.08); }
  50%  { box-shadow: 0 0 0 3px rgb(var(--color-accent) / 1), 0 0 24px 6px rgb(var(--color-accent) / 0.6), 0 0 50px 12px rgb(var(--color-accent) / 0.3), 0 0 80px 16px rgb(var(--color-accent-sub) / 0.12); }
  100% { box-shadow: 0 0 0 2px rgb(var(--color-accent) / 0.8), 0 0 16px 4px rgb(var(--color-accent) / 0.5), 0 0 40px 8px rgb(var(--color-accent) / 0.2), 0 0 60px 12px rgb(var(--color-accent-sub) / 0.08); }
}
@keyframes scene-glow-fade {
  0%   { box-shadow: 0 0 0 2px rgb(var(--color-accent) / 0.8), 0 0 16px 4px rgb(var(--color-accent) / 0.5), 0 0 40px 8px rgb(var(--color-accent) / 0.2); }
  100% { box-shadow: 0 0 0 0px rgb(var(--color-accent) / 0), 0 0 0px 0px rgb(var(--color-accent) / 0), 0 0 0px 0px rgb(var(--color-accent) / 0); }
}
.scene-highlight {
  animation: scene-glow-pulse 0.9s ease-in-out 3, scene-glow-fade 0.8s ease-out 2.7s forwards;
  border-color: rgb(var(--color-accent) / 0.8) !important;
  z-index: 10;
}
.scene-highlight-bg {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: rgb(var(--color-accent) / 0.1);
  animation: scene-bg-fade 3.5s ease-out forwards;
  z-index: 0;
}
@keyframes scene-bg-fade {
  0%   { background: rgb(var(--color-accent) / 0.12); }
  60%  { background: rgb(var(--color-accent) / 0.05); }
  100% { background: transparent; }
}
`;
let glowCssInjected = false;
function ensureGlowCss() {
  if (glowCssInjected) return;
  const el = document.createElement('style');
  el.textContent = GLOW_CSS;
  document.head.appendChild(el);
  glowCssInjected = true;
}

/* ── 진행률 기반 그라데이션 (중간값 추가로 밴딩 방지) ── */
// progressGradient → @/utils/calcStats 에서 import

/*
 * 보케 RGB 팔레트 — rgba() 사용으로 밴딩 방지
 * UI/UX Pro Max: Dark OLED + Financial Dashboard 팔레트 기반
 * 성취감 → 초록(#22C55E) + 골드(#CA8A04) + 프로젝트 액센트(#6C5CE7)
 */
const BOKEH_PALETTE = [
  [0, 184, 148],   // emerald
  [34, 197, 94],    // green-500 (CTA)
  [108, 92, 231],   // accent (프로젝트)
  [162, 155, 254],  // lavender
  [202, 138, 4],    // gold (achievement)
  [116, 185, 255],  // sky
  [253, 203, 110],  // amber
] as const;

/* ── 보케 오브 (rgba 기반, 밴딩 없음) ── */
function BokehOrbs({ count, minR, maxR, baseAlpha, drift, speed }: {
  count: number; minR: number; maxR: number; baseAlpha: number; drift: number; speed: number;
}) {
  const orbs = useMemo(() =>
    Array.from({ length: count }, (_, i) => {
      const r = minR + Math.random() * (maxR - minR);
      const [cr, cg, cb] = BOKEH_PALETTE[i % BOKEH_PALETTE.length];
      return {
        id: i, r, cr, cg, cb,
        x: Math.random() * 100,
        y: Math.random() * 100,
        dur: speed * (0.8 + Math.random() * 0.6),
        delay: Math.random() * speed * 0.5,
        path: Array.from({ length: 3 }, () => [(Math.random() - 0.5) * drift, (Math.random() - 0.5) * drift] as const),
      };
    }), [count, minR, maxR, baseAlpha, drift, speed]
  );

  return (
    <>
      {orbs.map((o) => (
        <motion.div
          key={o.id}
          className="absolute rounded-full will-change-transform"
          style={{
            width: o.r, height: o.r,
            left: `${o.x}%`, top: `${o.y}%`,
            /* radial-gradient with rgba → 부드러운 8비트 이상 블렌딩 */
            background: `radial-gradient(circle at 38% 38%,
              rgba(${o.cr},${o.cg},${o.cb},${baseAlpha}) 0%,
              rgba(${o.cr},${o.cg},${o.cb},${baseAlpha * 0.5}) 35%,
              rgba(${o.cr},${o.cg},${o.cb},${baseAlpha * 0.15}) 60%,
              rgba(${o.cr},${o.cg},${o.cb},0) 80%)`,
            filter: o.r > 30 ? `blur(${Math.round(o.r / 10)}px)` : 'none',
          }}
          animate={{
            x: [0, o.path[0][0], o.path[1][0], o.path[2][0], 0],
            y: [0, o.path[0][1], o.path[1][1], o.path[2][1], 0],
            scale: [1, 1.08, 0.96, 1.04, 1],
          }}
          transition={{ duration: o.dur, delay: o.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </>
  );
}

/* ── 오로라 메시 (conic-gradient → radial 다중 레이어로 밴딩 제거) ── */
function AuroraMesh({ isLight }: { isLight?: boolean }) {
  // 라이트 모드에서는 알파값을 높여 흰색 배경 위에서도 오로라가 보이게
  const m = isLight ? 3 : 1;
  return (
    <>
      {/* 부드러운 radial 워시 2개 — conic보다 밴딩 없음 */}
      <motion.div
        className="absolute will-change-transform"
        style={{
          width: '140%', height: '140%', left: '-20%', top: '-20%',
          background: `radial-gradient(ellipse at 30% 40%,
            rgba(0,184,148,${0.06 * m}) 0%, rgb(var(--color-accent) / ${0.04 * m}) 40%, transparent 70%),
            radial-gradient(ellipse at 70% 60%,
            rgba(202,138,4,${0.05 * m}) 0%, rgb(var(--color-accent-sub) / ${0.03 * m}) 40%, transparent 70%)`,
        }}
        animate={{ x: [0, 30, -20, 0], y: [0, -20, 15, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute will-change-transform"
        style={{
          width: '120%', height: '120%', left: '-10%', top: '-10%',
          background: `radial-gradient(ellipse at 60% 30%,
            rgba(34,197,94,${0.05 * m}) 0%, rgba(116,185,255,${0.03 * m}) 40%, transparent 65%),
            radial-gradient(ellipse at 40% 70%,
            rgba(253,203,110,${0.04 * m}) 0%, rgba(0,184,148,${0.03 * m}) 40%, transparent 65%)`,
        }}
        animate={{ x: [0, -25, 20, 0], y: [0, 20, -15, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
    </>
  );
}

function buildSceneControlsCollapseKey(
  episodeNumber: number | null,
  partId: string | null,
  department: ScenesDeptFilter,
): string | null {
  if (episodeNumber == null) return null;
  return `ep:${episodeNumber}:part:${partId ?? '__none__'}:dept:${department}`;
}

function formatCompletedMeta(iso: string | undefined, completedBy: string | undefined) {
  if (!iso || !completedBy) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return {
    completedBy,
    short: `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours()}시 ${dt.getMinutes().toString().padStart(2, '0')}분`,
    full: `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 ${dt.getHours()}시 ${dt.getMinutes().toString().padStart(2, '0')}분`,
  };
}

/* ── 파트 완료 오버레이 ── */
function PartCompleteOverlay({ completedMeta, onDismiss, onUndoLastAction }: {
  completedMeta?: ReturnType<typeof formatCompletedMeta>;
  onDismiss: () => void;
  onUndoLastAction?: () => void;
}) {
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';
  const flowRibbons = useMemo(() => [
    {
      top: '14%',
      left: '-14%',
      width: '58%',
      height: 120,
      rotate: -12,
      background: isLight
        ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(144,234,191,0.16) 26%, rgba(107,154,255,0.14) 60%, rgba(255,255,255,0) 100%)'
        : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(74,222,128,0.12) 26%, rgba(108,92,231,0.16) 60%, rgba(255,255,255,0) 100%)',
      blur: 'blur(30px)',
      duration: 9.5,
      x: [0, 80, -20, 0],
      y: [0, 18, -8, 0],
      rotateFrames: [-12, -6, -14, -12],
    },
    {
      top: '56%',
      left: '28%',
      width: '48%',
      height: 108,
      rotate: 16,
      background: isLight
        ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(125,211,252,0.12) 24%, rgba(196,181,253,0.16) 54%, rgba(255,255,255,0) 100%)'
        : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(56,189,248,0.10) 24%, rgba(167,139,250,0.14) 54%, rgba(255,255,255,0) 100%)',
      blur: 'blur(28px)',
      duration: 11,
      x: [0, -56, 26, 0],
      y: [0, -14, 10, 0],
      rotateFrames: [16, 10, 18, 16],
    },
    {
      top: '72%',
      left: '-6%',
      width: '42%',
      height: 92,
      rotate: -6,
      background: isLight
        ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(253,224,71,0.12) 26%, rgba(34,197,94,0.10) 56%, rgba(255,255,255,0) 100%)'
        : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(250,204,21,0.10) 26%, rgba(34,197,94,0.10) 56%, rgba(255,255,255,0) 100%)',
      blur: 'blur(26px)',
      duration: 10.5,
      x: [0, 62, -18, 0],
      y: [0, -12, 8, 0],
      rotateFrames: [-6, -2, -8, -6],
    },
  ], [isLight]);
  const flowTraces = useMemo(() => [
    {
      top: '26%',
      left: '6%',
      width: '34%',
      rotate: 7,
      background: isLight
        ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.72), rgba(110,231,183,0.58), rgba(255,255,255,0))'
        : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.18), rgba(110,231,183,0.30), rgba(255,255,255,0))',
      shadow: isLight ? '0 0 22px rgba(110,231,183,0.22)' : '0 0 20px rgba(110,231,183,0.14)',
      duration: 5.8,
      delay: 0.1,
    },
    {
      top: '46%',
      right: '4%',
      width: '26%',
      rotate: -11,
      background: isLight
        ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(196,181,253,0.54), rgba(255,255,255,0.68), rgba(255,255,255,0))'
        : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(167,139,250,0.22), rgba(255,255,255,0.16), rgba(255,255,255,0))',
      shadow: isLight ? '0 0 18px rgba(196,181,253,0.18)' : '0 0 16px rgba(167,139,250,0.12)',
      duration: 6.4,
      delay: 0.9,
    },
    {
      bottom: '16%',
      left: '18%',
      width: '30%',
      rotate: 3,
      background: isLight
        ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.68), rgba(125,211,252,0.56), rgba(255,255,255,0))'
        : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.16), rgba(125,211,252,0.24), rgba(255,255,255,0))',
      shadow: isLight ? '0 0 18px rgba(125,211,252,0.18)' : '0 0 16px rgba(125,211,252,0.10)',
      duration: 5.2,
      delay: 1.4,
    },
  ], [isLight]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[60] pointer-events-none overflow-hidden rounded-[28px]"
    >
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          background: isLight
            ? 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.44) 0%, rgba(255,255,255,0.16) 42%, rgba(255,255,255,0) 78%), linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)'
            : 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 42%, rgba(255,255,255,0) 78%), linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
          boxShadow: isLight
            ? 'inset 0 0 0 1px rgba(255,255,255,0.42), inset 0 24px 60px rgba(255,255,255,0.18)'
            : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 20px 60px rgba(255,255,255,0.03)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 32%, rgba(0,0,0,0.92) 68%, transparent 100%)',
          maskImage: 'radial-gradient(circle at center, black 32%, rgba(0,0,0,0.92) 68%, transparent 100%)',
        }}
      />

      <AuroraMesh isLight={isLight} />

      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          background: isLight
            ? 'radial-gradient(circle at 18% 26%, rgba(108,92,231,0.09) 0%, transparent 28%), radial-gradient(circle at 82% 24%, rgba(34,197,94,0.08) 0%, transparent 24%), radial-gradient(circle at 50% 78%, rgba(253,203,110,0.08) 0%, transparent 20%)'
            : 'radial-gradient(circle at 18% 26%, rgba(108,92,231,0.06) 0%, transparent 28%), radial-gradient(circle at 82% 24%, rgba(34,197,94,0.05) 0%, transparent 24%), radial-gradient(circle at 50% 78%, rgba(253,203,110,0.05) 0%, transparent 20%)',
          filter: 'blur(20px)',
        }}
      />

      {flowRibbons.map((ribbon, index) => (
        <motion.div
          key={`flow-ribbon-${index}`}
          className="absolute rounded-full"
          style={{
            top: ribbon.top,
            left: ribbon.left,
            width: ribbon.width,
            height: ribbon.height,
            background: ribbon.background,
            filter: ribbon.blur,
            transform: `rotate(${ribbon.rotate}deg)`,
            opacity: isLight ? 0.92 : 0.76,
          }}
          animate={{
            x: ribbon.x,
            y: ribbon.y,
            rotate: ribbon.rotateFrames,
            opacity: isLight ? [0.36, 0.72, 0.42, 0.36] : [0.24, 0.52, 0.3, 0.24],
          }}
          transition={{
            duration: ribbon.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: index * 0.4,
          }}
        />
      ))}

      {flowTraces.map((trace, index) => (
        <motion.div
          key={`flow-trace-${index}`}
          className="absolute h-px rounded-full"
          style={{
            top: 'top' in trace ? trace.top : undefined,
            right: 'right' in trace ? trace.right : undefined,
            bottom: 'bottom' in trace ? trace.bottom : undefined,
            left: 'left' in trace ? trace.left : undefined,
            width: trace.width,
            background: trace.background,
            boxShadow: trace.shadow,
            transform: `rotate(${trace.rotate}deg)`,
            opacity: isLight ? 0.9 : 0.72,
          }}
          animate={{
            x: [0, 22, -10, 0],
            scaleX: [0.94, 1.04, 0.98, 0.94],
            opacity: isLight ? [0.22, 0.88, 0.34, 0.22] : [0.14, 0.5, 0.22, 0.14],
          }}
          transition={{
            duration: trace.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: trace.delay,
          }}
        />
      ))}

      <BokehOrbs count={4} minR={60} maxR={120} baseAlpha={isLight ? 0.18 : 0.1} drift={44} speed={11} />
      <BokehOrbs count={6} minR={18} maxR={44} baseAlpha={isLight ? 0.26 : 0.14} drift={34} speed={8} />
      <BokehOrbs count={10} minR={4} maxR={12} baseAlpha={isLight ? 0.4 : 0.22} drift={20} speed={6} />

      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          background: isLight
            ? 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.18) 46%, rgba(255,255,255,0.04) 100%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0.05) 46%, rgba(255,255,255,0.01) 100%)',
          opacity: isLight ? 0.9 : 0.7,
        }}
      />

      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto relative w-full max-w-[560px] overflow-hidden rounded-[30px] border px-5 py-5 text-center sm:px-7 sm:py-6"
          style={{
            background: isLight
              ? 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,255,251,0.86) 100%)'
              : 'linear-gradient(180deg, rgba(22,28,38,0.88) 0%, rgba(15,20,29,0.82) 100%)',
            borderColor: isLight ? 'rgba(167, 243, 208, 0.92)' : 'rgba(52, 211, 153, 0.26)',
            boxShadow: isLight
              ? '0 28px 96px rgba(16, 185, 129, 0.20), 0 10px 26px rgba(15, 23, 42, 0.08)'
              : '0 30px 98px rgba(16, 185, 129, 0.18), 0 12px 30px rgba(0, 0, 0, 0.28)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <button
            type="button"
            aria-label="완료 안내 숨기기"
            title="완료 안내 숨기기"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
            className={cn(
              'absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border transition-all',
              isLight
                ? 'border-emerald-200 bg-white/80 text-emerald-800 hover:bg-white'
                : 'border-emerald-300/20 bg-white/8 text-emerald-100 hover:bg-white/12',
            )}
          >
            <X size={15} />
          </button>
          <motion.div
            className="absolute inset-y-0 -left-1/3 w-1/3"
            style={{
              background: isLight
                ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.52) 52%, rgba(255,255,255,0) 100%)'
                : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 52%, rgba(255,255,255,0) 100%)',
              filter: 'blur(10px)',
            }}
            animate={{ x: ['0%', '360%'] }}
            transition={{ duration: 4.8, repeat: Infinity, ease: 'linear' }}
          />
          <div
            className="absolute inset-0 rounded-[inherit]"
            style={{
              background: isLight
                ? 'linear-gradient(135deg, rgba(110,231,183,0.18) 0%, rgba(108,92,231,0.08) 42%, rgba(255,255,255,0) 100%)'
                : 'linear-gradient(135deg, rgba(74,222,128,0.14) 0%, rgba(108,92,231,0.12) 42%, rgba(255,255,255,0) 100%)',
            }}
          />
          <div className="relative flex flex-col items-center gap-4">
            <div
              className="inline-flex items-center rounded-full px-4 py-1.5 text-[11px] font-semibold tracking-[0.24em]"
              style={{
                color: isLight ? '#047857' : '#86EFAC',
                background: isLight ? 'rgba(16, 185, 129, 0.10)' : 'rgba(16, 185, 129, 0.12)',
                border: `1px solid ${isLight ? 'rgba(16, 185, 129, 0.18)' : 'rgba(134, 239, 172, 0.18)'}`,
              }}
            >
              COMPLETE
            </div>
            <div className="space-y-2">
              <p
                className="text-[32px] font-semibold tracking-[-0.03em] sm:text-[36px]"
                style={{ color: isLight ? '#064E3B' : '#ECFDF5' }}
              >
                고생하셨습니다!
              </p>
              <p
                className="text-base font-medium sm:text-lg"
                style={{ color: isLight ? 'rgba(6, 95, 70, 0.88)' : 'rgba(236, 253, 245, 0.90)' }}
              >
                현재 보고계신 파트는 완료되었습니다.
              </p>
              <p
                className="mx-auto max-w-[28rem] text-sm leading-6"
                style={{ color: isLight ? 'rgba(6, 95, 70, 0.74)' : 'rgba(209, 250, 229, 0.72)' }}
              >
                고생 많으셨습니다! 다음 작업 이어서 하시기 전에, 잠깐 쉬셔요~ 띵호와
              </p>
            </div>
            {completedMeta && (
              <div
                className={cn(
                  'flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between',
                  isLight
                    ? 'border-emerald-200/80 bg-white/70'
                    : 'border-emerald-300/15 bg-white/6',
                )}
                title={`${completedMeta.completedBy}님 · ${completedMeta.full}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-secondary/70">마지막 완료</span>
                  <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{completedMeta.completedBy}님</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 sm:justify-end">
                  <span className="shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-secondary/70">완료 시각</span>
                  <span className="min-w-0 truncate text-sm font-medium text-text-primary/90">{completedMeta.full}</span>
                </div>
              </div>
            )}
            {onUndoLastAction && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUndoLastAction();
                }}
                className={cn(
                  'pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all',
                  isLight
                    ? 'border border-emerald-200 bg-white/80 text-emerald-800 hover:bg-white'
                    : 'border border-emerald-300/20 bg-white/8 text-emerald-100 hover:bg-white/12',
                )}
              >
                <RotateCcw size={14} />
                마지막 체크 취소
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function CompletionRestoreButton({ onClick }: { onClick: () => void }) {
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';
  return (
    <button
      type="button"
      aria-label="완료 안내 다시 보기"
      onClick={onClick}
      className={cn(
        'fixed bottom-5 left-1/2 z-[61] -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5',
        isLight
          ? 'border-emerald-200 bg-white/90 text-emerald-800 shadow-emerald-900/10 hover:bg-white'
          : 'border-emerald-300/25 bg-bg-card/85 text-emerald-100 shadow-black/30 hover:bg-bg-card',
      )}
    >
      완료 안내 다시 보기
    </button>
  );
}
import {
  updateCell,
  updateCellByUuid,
  addEpisode,
  addPart,
  addScene,
  deleteSceneFromSupabase,
  updateSceneField,
  updateSceneCompletionMeta,
  writeMetadata,
  softDeletePart,
  softDeleteEpisode,
  batchExecute,
  batchActions,
  bulkDeleteScenes,
  bulkUpdateSceneStages,
  bulkUpdateSceneFields,
} from '@/services/supabaseService';
import type { BatchAction } from '@/services/supabaseService';
import type { BulkStageUpdate, BulkFieldUpdate, BulkUpdateResult } from '@/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useBulkOperationsStore } from '@/stores/useBulkOperationsStore';
import {
  runBulkOp,
  resolveSelectedUuids,
  resolveSelectedScenes,
  countSelectedScenes,
  type ActPhasePatch,
} from '@/utils/bulkOperations';
import { ContextMenu, useContextMenu } from '@/components/ui/ContextMenu';
import { cn } from '@/utils/cn';
import { Confetti } from '@/components/ui/Confetti';
import { SceneDetailModal } from '@/components/scenes/SceneDetailModal';
import { GlassDropdown } from '@/components/common/GlassDropdown';
import { PanelLeftOpen } from 'lucide-react';
import {
  loadPersistedSceneViewMode, savePersistedSceneViewMode,
  savePersistedLastEpisode,
  loadPersistedTreeOpen, savePersistedTreeOpen,
} from '@/utils/scenesViewPersist';

// ─── 씬 카드 (요약 카드 — 클릭으로 상세 모달 열기) ──────────────

interface SceneCardProps {
  scene: Scene;
  sceneIndex: number;
  celebrating: boolean;
  department: Department;
  isHighlighted?: boolean;
  isSelected?: boolean;
  searchQuery?: string;
  commentCount?: number;
  hasUnreadComments?: boolean;
  revisionCount?: number;
  selectionId?: string;  // 'all' 모드에서 부서 접두사 포함된 고유 ID (라쏘/선택용)
  sheetName?: string;
  fallbackStoryboardUrl?: string | null;
  fallbackGuideUrl?: string | null;
  onToggle: (sceneId: string, stage: Stage, sceneUuid?: string | null, sceneIndex?: number) => void;
  onActPhaseStateClick?: (sheetName: string, sceneId: string, newState: ScenePhaseState, sceneUuid?: string | null, sceneIndex?: number) => void;
  onActFeedbackRequest?: (sheetName: string, sceneId: string) => void;
  onActRoundBump?: (sheetName: string, sceneId: string, kind: 'work' | 'feedback', delta: 1 | -1) => void;
  onAssigneeStageToggle?: (sheetName: string, sceneId: string, assigneeName: string, stage: Stage, sceneUuid?: string | null, sceneIndex?: number, dept?: Department) => void;
  onAssigneeActPhaseStateClick?: (sheetName: string, sceneId: string, assigneeName: string, newState: ScenePhaseState, sceneUuid?: string | null, sceneIndex?: number) => void;
  onAssigneeActFeedbackRequest?: (sheetName: string, sceneId: string, assigneeName: string, sceneUuid?: string | null, sceneIndex?: number) => void;
  onAssigneeActRoundBump?: (sheetName: string, sceneId: string, assigneeName: string, kind: 'work' | 'feedback', delta: 1 | -1, sceneUuid?: string | null, sceneIndex?: number) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: () => void;
  onCelebrationEnd: () => void;
  onCtrlClick?: () => void;
  onShiftClick?: () => void;
}

function SceneCard({ scene, sceneIndex, celebrating, department, isHighlighted, isSelected, searchQuery, commentCount = 0, hasUnreadComments = false, revisionCount = 0, selectionId, sheetName, fallbackStoryboardUrl, fallbackGuideUrl, onToggle, onActPhaseStateClick, onActFeedbackRequest, onActRoundBump, onAssigneeStageToggle, onAssigneeActPhaseStateClick, onAssigneeActFeedbackRequest, onAssigneeActRoundBump, onDelete, onOpenDetail, onCelebrationEnd, onCtrlClick, onShiftClick }: SceneCardProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];
  const completionTintEnabled = useAppStore((s) => s.completionTintEnabled);
  const pct = sceneProgress(scene);
  const isComplete = isFullyDone(scene);
  const storyboardUrl = scene.storyboardUrl || fallbackStoryboardUrl || '';
  const guideUrl = scene.guideUrl || fallbackGuideUrl || '';
  const hasImages = !!(storyboardUrl || guideUrl);
  const useActingPhaseControls = department === 'acting' && !!sheetName && !!onActPhaseStateClick && !!onActFeedbackRequest && !!onActRoundBump;

  const borderColor = pct >= 100 ? '#6C5CE7' : pct >= 50 ? '#A599F5' : pct > 0 ? '#E17055' : 'rgb(var(--color-bg-border))';

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onCtrlClick?.();
    } else if (e.shiftKey) {
      e.preventDefault();
      onShiftClick?.();
    } else {
      // 단순 클릭: 씬 선택/선택해제 (토글)
      onCtrlClick?.();
    }
  };

  return (
    <motion.div
      data-scene-id={selectionId ?? scene.sceneId}
      className={cn(
        'bg-bg-card border border-bg-border rounded-xl flex flex-col group relative cursor-pointer',
        'shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.12)]',
        'hover:shadow-[0_3px_8px_rgba(0,0,0,0.12),0_10px_24px_rgba(0,0,0,0.18)]',
        'scene-card-interactive',
        'hover:-translate-y-0.5 hover:border-accent/70',
        completionTintEnabled && isComplete && 'scene-completion-tint-card',
        isHighlighted && 'scene-highlight',
        isSelected && 'scene-card-selected',
      )}
      style={{
        overflow: 'visible',
      }}
      onClick={handleClick}
      onDoubleClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
      ref={isHighlighted ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
      {...(isHighlighted ? {
        initial: { scale: 1.06 },
        animate: { scale: 1 },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
      } : {})}
    >
      {/* 하이라이트 배경 오버레이 */}
      {isHighlighted && <div className="scene-highlight-bg" />}

      <RevisionCornerFlag count={revisionCount} />

      {/* 선택 체크마크 */}
      {isSelected && (
        <div className={cn(
          'absolute right-1.5 z-20 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-sm shadow-accent/30',
          revisionCount > 0 ? 'top-9' : 'top-1.5',
        )}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      )}

      {/* ── 상단: 씬 ID + 진행률 ── */}
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-mono text-text-secondary/50">
            #{scene.sceneId ? (scene.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || scene.no) : scene.no}
          </span>
          <span className="text-[15px] font-mono font-bold text-text-primary truncate">
            <HighlightText text={scene.sceneId || '(씬번호 없음)'} query={searchQuery} />
          </span>
          {scene.layoutId && (
            <span className="text-[12px] italic font-medium text-accent shrink-0">
              L#{scene.layoutId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {commentCount > 0 && (
            <span
              className={cn(
                'compact-label-container flex min-w-0 shrink items-center gap-0.5 rounded-full border px-1.5 py-0.5 transition-colors',
                hasUnreadComments
                  ? 'comment-unread-badge border-accent/25 bg-accent/15 text-accent shadow-[0_0_10px_rgba(108,92,231,0.16)]'
                  : 'border-bg-border/45 bg-text-secondary/10 text-text-secondary/60',
              )}
              title={`${hasUnreadComments ? '새 댓글' : '확인한 댓글'} ${commentCount}`}
            >
              <CompactIconLabel
                icon={<MessageCircle size={10} fill="currentColor" />}
                label={`${commentCount}`}
                textClassName="text-[10px] font-bold leading-none"
              />
            </span>
          )}
          {/* v1.20.x: 분리(BG/ACT 단독) 카드 뷰에도 씬 길이 변경 라벨 표시 — UnifiedSceneCard와 동일 패턴 */}
          {scene.lengthChange && (
            <span
              className={`length-symbol ${scene.lengthChange === 'LD' ? 'up' : 'down'}`}
              title={scene.lengthChange === 'LD' ? 'LD · Long Duration (길이 늘어남)' : 'SD · Short Duration (길이 줄어듦)'}
            >
              <LengthIcon kind={scene.lengthChange} />
            </span>
          )}
          <span className="bg-bg-primary/80 border border-bg-border/45 text-text-primary px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums">
            {pct}%
          </span>
        </div>
      </div>

      {/* ── 부서 + 담당자 ── */}
      <div className="px-4 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: deptConfig.color }} />
          <span className="text-xs font-semibold" style={{ color: deptConfig.color }}>{deptConfig.shortLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-secondary truncate max-w-[100px]">
            <HighlightText text={scene.assignee || '-'} query={searchQuery} />
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(sceneIndex); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-text-secondary/60 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
            title="씬 삭제"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* ── 가운데: 이미지 썸네일 ── */}
      {hasImages ? (
        <div className="mx-4 mt-1 mb-1 flex gap-px rounded-lg overflow-hidden bg-bg-border">
          {storyboardUrl && (
            <img
              src={storyboardUrl}
              alt="SB"
              className="flex-1 h-28 object-contain bg-bg-card/70 min-w-0"
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          {guideUrl && (
            <img
              src={guideUrl}
              alt="Guide"
              className="flex-1 h-28 object-contain bg-bg-card/70 min-w-0"
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* ── 메모 ── */}
      {scene.memo && (
        <div className="mx-4 mt-1">
          <p className="text-[11px] text-amber-400/70 leading-relaxed line-clamp-2">
            <HighlightText text={scene.memo} query={searchQuery} />
          </p>
        </div>
      )}

      {/* ── 하단: 프로세스 트랙 ── */}
      <div className="px-4 pt-1 pb-3.5 mt-auto relative overflow-visible">
        {hasMultiAssigneeProgress(scene) && sheetName ? (
          <div onClick={(e) => e.stopPropagation()}>
            <AssigneeProgressStack
              scene={scene}
              department={department}
              compact
              onAssigneeStageToggle={(name, stage) => onAssigneeStageToggle?.(sheetName, scene.sceneId, name, stage, scene.id ?? null, sceneIndex, department)}
              onAssigneePhaseStateClick={(name, state) => onAssigneeActPhaseStateClick?.(sheetName, scene.sceneId, name, state, scene.id ?? null, sceneIndex)}
              onAssigneeFeedbackRequest={(name) => onAssigneeActFeedbackRequest?.(sheetName, scene.sceneId, name, scene.id ?? null, sceneIndex)}
              onAssigneeRoundBump={(name, kind, delta) => onAssigneeActRoundBump?.(sheetName, scene.sceneId, name, kind, delta, scene.id ?? null, sceneIndex)}
            />
          </div>
        ) : useActingPhaseControls ? (
          <div onClick={(e) => e.stopPropagation()}>
            <ScenePhaseToggle
              scene={scene}
              onStateClick={(next) => onActPhaseStateClick(sheetName, scene.sceneId, next, scene.id ?? null, sceneIndex)}
              onRequestFeedback={() => onActFeedbackRequest(sheetName, scene.sceneId)}
              onRoundBump={(kind, delta) => onActRoundBump(sheetName, scene.sceneId, kind, delta)}
            />
          </div>
        ) : (
          <StageSegmentToggle
            scene={scene}
            department={department}
            onToggle={(stage) => onToggle(scene.sceneId, stage, scene.id ?? null, sceneIndex)}
          />
        )}
        <Confetti active={celebrating} onComplete={onCelebrationEnd} />
      </div>
    </motion.div>
  );
}

// ─── 씬 추가 폼 ────────────────────────────────────────────────

const ALPHABET_PREFIXES = 'abcdefghijklmnopqrstuvwx'.split('');
const ADDITIONAL_SCENE_SUFFIXES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

type PrefixMode = 'alphabet' | 'sc' | 'custom';
type AddSceneMode = 'new' | 'additional';
type SceneSuffixMode = 'none' | 'preset' | 'custom';

function sanitizeSceneSuffix(value: string): string {
  return value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
}

function getFirstAvailableSceneSuffix(baseSceneId: string, existingSceneIds: string[]): string {
  const existing = new Set(existingSceneIds.map((id) => id.trim().toLowerCase()));
  return ADDITIONAL_SCENE_SUFFIXES.find((suffix) => !existing.has(`${baseSceneId}${suffix}`.toLowerCase())) ?? 'A';
}

function getAdditionalSceneSuffixOptions(currentSuffix: string): string[] {
  const defaultOptions = ADDITIONAL_SCENE_SUFFIXES.slice(0, 24);
  const normalized = sanitizeSceneSuffix(currentSuffix);
  return normalized && !defaultOptions.includes(normalized)
    ? [...defaultOptions, normalized]
    : defaultOptions;
}

type CompletionUndoAction =
  | {
      kind: 'stage';
      sheetName: string;
      sceneId: string;
      sceneUuid?: string | null;
      sceneIndex?: number;
      stage: Stage;
    }
  | {
      kind: 'phase';
      sheetName: string;
      sceneId: string;
      sceneUuid?: string | null;
      sceneIndex?: number;
      previousState: ScenePhaseState;
      previousWorkRound: number;
      previousFeedbackRound: number;
      previousCompletedBy: string;
      previousCompletedAt: string;
    };

type CompletionCelebrationTarget = {
  sheetName: string;
  sceneId: string;
  sceneUuid?: string | null;
  sceneIndex?: number;
} | null;

function buildCompletionTarget(
  sheetName: string,
  scene: Pick<Scene, 'id' | 'sceneId'>,
  sceneIndex: number,
): NonNullable<CompletionCelebrationTarget> {
  return {
    sheetName,
    sceneId: scene.sceneId,
    sceneUuid: scene.id ?? null,
    sceneIndex,
  };
}

function findCompletionSceneIndex(
  scenes: Scene[],
  target: Pick<NonNullable<CompletionCelebrationTarget>, 'sceneId' | 'sceneUuid' | 'sceneIndex'>,
): number {
  if (target.sceneUuid) {
    const uuidIndex = scenes.findIndex((scene) => scene.id === target.sceneUuid);
    if (uuidIndex >= 0) return uuidIndex;
  }
  if (typeof target.sceneIndex === 'number') {
    const indexedScene = scenes[target.sceneIndex];
    if (indexedScene?.sceneId === target.sceneId) return target.sceneIndex;
  }
  return scenes.findIndex((scene) => scene.sceneId === target.sceneId);
}

function findSceneLocationByUuid(sceneUuid: string): { sheetName: string; sceneIndex: number } | null {
  const episodes = useDataStore.getState().episodes;
  for (const episode of episodes) {
    for (const part of episode.parts) {
      const sceneIndex = part.scenes.findIndex((scene) => scene.id === sceneUuid);
      if (sceneIndex >= 0) {
        return { sheetName: part.sheetName, sceneIndex };
      }
    }
  }
  return null;
}

function matchesSceneCelebration(
  sheetName: string | null | undefined,
  scene: Scene,
  sceneIndex: number,
  target: CompletionCelebrationTarget,
): boolean {
  if (!target || target.sheetName !== sheetName) return false;
  if (target.sceneUuid) return scene.id === target.sceneUuid;
  if (typeof target.sceneIndex === 'number') {
    return target.sceneIndex === sceneIndex && target.sceneId === scene.sceneId;
  }
  return target.sceneId === scene.sceneId;
}

function matchesMergedSceneCelebration(
  merged: MergedScene,
  target: CompletionCelebrationTarget,
  bgSheetName: string | null | undefined,
  actSheetName: string | null | undefined,
): boolean {
  if (!target) return false;
  const matchesScene = (scene: Scene | null, sceneIndex: number) => {
    if (!scene) return false;
    if (target.sceneUuid) return scene.id === target.sceneUuid;
    if (typeof target.sceneIndex === 'number') {
      return target.sceneIndex === sceneIndex && target.sceneId === scene.sceneId;
    }
    return target.sceneId === scene.sceneId;
  };
  if (target.sheetName === bgSheetName) return matchesScene(merged.bgScene, merged.bgSceneIndex);
  if (target.sheetName === actSheetName) return matchesScene(merged.actScene, merged.actSceneIndex);
  return false;
}

function suggestNextNumber(prefix: string, existingIds: string[]): string {
  const lp = prefix.toLowerCase();
  const nums = existingIds
    .filter((id) => id.toLowerCase().startsWith(lp))
    .map((id) => parseInt(id.slice(lp.length), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  if (nums.length === 0) return '001';

  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) return String(i + 1).padStart(3, '0');
  }
  return String(nums[nums.length - 1] + 1).padStart(3, '0');
}

/** 이미지 붙여넣기/파일선택 슬롯 (씬 추가 폼용) */
function AddFormImageSlot({
  label,
  base64,
  onSetBase64,
}: {
  label: string;
  base64: string;
  onSetBase64: (v: string) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'paste-hint'>('idle');
  const slotRef = useRef<HTMLDivElement>(null);

  // 전역 paste 이벤트 리스너 (paste-hint 활성 시)
  useEffect(() => {
    if (phase !== 'paste-hint') return;
    const handler = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const { resizeBlob: rb } = await import('@/utils/imageUtils');
          const b64 = await rb(blob);
          onSetBase64(b64);
          setPhase('idle');
          return;
        }
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [phase, onSetBase64]);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const { resizeBlob: rb } = await import('@/utils/imageUtils');
        const b64 = await rb(blob);
        onSetBase64(b64);
        setPhase('idle');
        return;
      }
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const { pasteImageFromClipboard: pic } = await import('@/utils/imageUtils');
      // 로컬 붙여넣기 (base64만 가져오기)
      const w = window as unknown as { electronAPI?: { clipboardReadImage?: () => Promise<string | null> } };
      if (w.electronAPI?.clipboardReadImage) {
        const raw = await w.electronAPI.clipboardReadImage();
        if (raw) {
          const { resizeBlob: rb } = await import('@/utils/imageUtils');
          // raw is data URL
          const res = await fetch(raw);
          const blob = await res.blob();
          const b64 = await rb(blob);
          onSetBase64(b64);
          setPhase('idle');
          return;
        }
      }
      sonnerToast.error('클립보드에 이미지가 없습니다.');
    } catch {
      sonnerToast.error('클립보드 읽기 실패');
    }
  };

  const handleClick = () => {
    if (base64) return; // 이미 있으면 무시
    if (phase === 'idle') {
      setPhase('paste-hint');
      slotRef.current?.focus();
    } else {
      // 두번째 클릭 → 파일 선택
      setPhase('idle');
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const { resizeBlob: rb } = await import('@/utils/imageUtils');
        const b64 = await rb(file);
        onSetBase64(b64);
      };
      input.click();
    }
  };

  if (base64) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-text-secondary">{label}</span>
        <div className="relative group">
          <img src={base64} alt={label} className="h-28 w-32 rounded-lg border border-bg-border object-cover" draggable={false} />
          <button
            onClick={() => onSetBase64('')}
            className="absolute top-0.5 right-0.5 w-4 h-4 bg-overlay/60 text-on-accent rounded-full text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <div
        ref={slotRef}
        tabIndex={0}
        onClick={handleClick}
        onPaste={handlePaste}
        onBlur={() => setPhase('idle')}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 h-28 w-32 rounded-lg border-2 border-dashed cursor-pointer outline-none transition-all duration-300 text-center',
          phase === 'paste-hint'
            ? 'border-accent bg-accent/10 shadow-[0_0_12px_rgba(108,92,231,0.3)]'
            : 'border-bg-border hover:border-accent/50 hover:shadow-[0_0_12px_rgba(108,92,231,0.2)]',
        )}
      >
        {phase === 'paste-hint' ? (
          <>
            <ClipboardPaste size={16} className="text-accent" />
            <p className="text-[11px] text-accent leading-tight">Ctrl+V 붙여넣기</p>
            <button
              onClick={(e) => { e.stopPropagation(); handlePasteFromClipboard(); }}
              className="text-[11px] text-accent/70 underline hover:text-accent"
            >
              붙여넣기
            </button>
            <p className="text-[11px] text-text-secondary/50">한번 더 클릭 → 파일선택</p>
          </>
        ) : (
          <>
            <ImagePlus size={14} className="text-text-secondary/45" />
            <p className="text-[11px] text-text-secondary/50">클릭하여 추가</p>
          </>
        )}
      </div>
    </div>
  );
}

interface AddSceneFormProps {
  existingSceneIds: string[];
  onSubmit: (sceneId: string, assignee: string, memo: string, layoutId: string, images?: { storyboard?: string; guide?: string }, skipSync?: boolean) => void;
  onBulkSubmit?: (scenes: { sceneId: string; assignee: string; memo: string }[]) => Promise<void>;
  onCancel: () => void;
}

function AddSceneForm({ existingSceneIds, onSubmit, onBulkSubmit, onCancel }: AddSceneFormProps) {
  const sortedExistingSceneIds = useMemo(
    () => [...existingSceneIds].sort(compareSceneIdsByNumberThenSuffix),
    [existingSceneIds],
  );
  const [sceneAddMode, setSceneAddMode] = useState<AddSceneMode>('new');
  const [prefixMode, setPrefixMode] = useState<PrefixMode>('alphabet');
  const [alphaPrefix, setAlphaPrefix] = useState('a');
  const [customPrefix, setCustomPrefix] = useState('');
  const [number, setNumber] = useState(() => suggestNextNumber('a', existingSceneIds));
  const [baseSceneId, setBaseSceneId] = useState(() => sortedExistingSceneIds[0] ?? '');
  const [suffixMode, setSuffixMode] = useState<SceneSuffixMode>('none');
  const [presetSuffix, setPresetSuffix] = useState(() => getFirstAvailableSceneSuffix(sortedExistingSceneIds[0] ?? '', existingSceneIds));
  const [customSuffix, setCustomSuffix] = useState('');
  const [assignee, setAssignee] = useState('');
  const [memo, setMemo] = useState('');
  const [layoutId, setLayoutId] = useState('');
  const [sbImage, setSbImage] = useState('');
  const [guideImage, setGuideImage] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkEnd, setBulkEnd] = useState('');

  const prefix = prefixMode === 'alphabet' ? alphaPrefix : prefixMode === 'sc' ? 'sc' : customPrefix;
  const effectiveSuffixMode = sceneAddMode === 'additional' && suffixMode === 'none' ? 'preset' : suffixMode;
  const sceneSuffix = effectiveSuffixMode === 'custom'
    ? sanitizeSceneSuffix(customSuffix)
    : effectiveSuffixMode === 'preset'
      ? sanitizeSceneSuffix(presetSuffix)
      : '';
  const newSceneBaseId = `${prefix}${number}`;
  const sceneId = sceneAddMode === 'additional'
    ? `${baseSceneId}${sceneSuffix}`
    : `${newSceneBaseId}${sceneSuffix}`;
  const suffixDisablesBulk = sceneAddMode === 'additional' || Boolean(sceneSuffix);
  const bulkEnabled = bulkMode && !suffixDisablesBulk;
  const isDuplicate = existingSceneIds.includes(sceneId);
  const invalidSceneId = sceneAddMode === 'additional'
    ? !baseSceneId || !sceneSuffix
    : !prefix || !number.trim() || (effectiveSuffixMode === 'custom' && !sceneSuffix);

  useEffect(() => {
    if (baseSceneId || sortedExistingSceneIds.length === 0) return;
    setBaseSceneId(sortedExistingSceneIds[0]);
  }, [baseSceneId, sortedExistingSceneIds]);

  const updatePrefix = (mode: PrefixMode, value?: string) => {
    setPrefixMode(mode);
    let newP = prefix;
    if (mode === 'alphabet') { newP = value ?? alphaPrefix; if (value) setAlphaPrefix(value); }
    else if (mode === 'sc') newP = 'sc';
    else if (mode === 'custom') newP = value ?? customPrefix;
    setNumber(suggestNextNumber(newP, existingSceneIds));
  };

  const stepNumber = (dir: 1 | -1) => {
    const n = parseInt(number, 10);
    if (isNaN(n)) return;
    const next = Math.max(1, n + dir);
    setNumber(String(next).padStart(3, '0'));
  };

  const handleSubmit = () => {
    if (isDuplicate || invalidSceneId) return;

    if (bulkEnabled) {
      // 일괄 생성: number~bulkEnd 범위
      const startN = parseInt(number, 10);
      const endN = parseInt(bulkEnd, 10);
      if (isNaN(startN) || isNaN(endN) || endN < startN) return;
      let updatedIds = [...existingSceneIds];
      const toAdd: string[] = [];
      for (let n = startN; n <= endN; n++) {
        const numStr = String(n).padStart(3, '0');
        const id = `${prefix}${numStr}`;
        if (updatedIds.includes(id)) continue;
        toAdd.push(id);
        updatedIds.push(id);
      }

      const BULK_THRESHOLD = 5;
      if (toAdd.length >= BULK_THRESHOLD && onBulkSubmit) {
        // Phase 0-5: 대량 추가 — 서버 확인 후 반영 (로딩 화면 포함)
        const scenes = toAdd.map((id) => ({ sceneId: id, assignee, memo }));
        onBulkSubmit(scenes);
      } else {
        // 소량: 기존 방식 (낙관적 업데이트)
        (async () => {
          for (let i = 0; i < toAdd.length; i++) {
            const isLast = i === toAdd.length - 1;
            await onSubmit(toAdd[i], assignee, memo, layoutId, undefined, !isLast);
          }
        })();
      }
      setNumber(suggestNextNumber(prefix, updatedIds));
      setBulkEnd('');
    } else {
      const imgs = (sbImage || guideImage)
        ? { storyboard: sbImage || undefined, guide: guideImage || undefined }
        : undefined;
      onSubmit(sceneId, assignee, memo, layoutId, imgs);
      const updatedIds = [...existingSceneIds, sceneId];
      setNumber(suggestNextNumber(prefix, updatedIds));
      if (sceneAddMode === 'additional') {
        setPresetSuffix(getFirstAvailableSceneSuffix(baseSceneId, updatedIds));
        setSuffixMode('preset');
      }
    }

    setAssignee('');
    setMemo('');
    setLayoutId('');
    setSbImage('');
    setGuideImage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isDuplicate && !invalidSceneId) handleSubmit();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── 헤더 ── */}
      <div className="px-5 pt-5 pb-4 border-b border-bg-border/50">
        <h3 className="text-base font-bold text-text-primary">새 씬 추가</h3>
      </div>

      {/* ── 스크롤 가능한 폼 바디 ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
        {/* 0) 추가 방식 */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] text-text-secondary font-medium">추가 방식</span>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-bg-border bg-bg-primary p-1">
            {([
              { value: 'new' as const, label: '새 번호' },
              { value: 'additional' as const, label: '추가씬' },
            ]).map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setSceneAddMode(item.value);
                  if (item.value === 'additional') {
                    const fallbackBase = baseSceneId || sortedExistingSceneIds[0] || '';
                    setBaseSceneId(fallbackBase);
                    setPresetSuffix(getFirstAvailableSceneSuffix(fallbackBase, existingSceneIds));
                    setSuffixMode('preset');
                    setBulkMode(false);
                  }
                }}
                className={cn(
                  'rounded-md px-3 py-2 text-xs font-semibold transition-all',
                  sceneAddMode === item.value
                    ? 'bg-accent text-white shadow-sm shadow-accent/25'
                    : 'text-text-secondary hover:bg-bg-border/30 hover:text-text-primary',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 1) 접두사 & 씬 번호 */}
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] text-text-secondary font-medium">
            {sceneAddMode === 'additional' ? '기준 씬 & 접미' : '접두사 & 씬 번호'}
          </span>
          {sceneAddMode === 'additional' ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="relative">
                <select
                  value={baseSceneId}
                  onChange={(e) => {
                    const nextBase = e.target.value;
                    setBaseSceneId(nextBase);
                    setPresetSuffix(getFirstAvailableSceneSuffix(nextBase, existingSceneIds));
                    setCustomSuffix('');
                  }}
                  className="w-full appearance-none bg-bg-primary border border-bg-border rounded-lg pl-3 pr-8 py-2 text-sm text-text-primary font-mono cursor-pointer hover:border-accent/50 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                >
                  {sortedExistingSceneIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={effectiveSuffixMode === 'custom' ? 'custom' : presetSuffix}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setSuffixMode('custom');
                      setCustomSuffix('');
                    } else {
                      setSuffixMode('preset');
                      setPresetSuffix(e.target.value);
                    }
                  }}
                  className="appearance-none bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary font-mono cursor-pointer hover:border-accent/50 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                >
                  {getAdditionalSceneSuffixOptions(presetSuffix).map((suffix) => (
                    <option key={suffix} value={suffix}>{suffix}</option>
                  ))}
                  <option value="custom">직접</option>
                </select>
                {effectiveSuffixMode === 'custom' && (
                  <input
                    autoFocus
                    value={customSuffix}
                    onChange={(e) => setCustomSuffix(sanitizeSceneSuffix(e.target.value))}
                    onKeyDown={handleKeyDown}
                    placeholder="A"
                    className="w-16 bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                  />
                )}
              </div>
            </div>
          ) : (
            <>
          {/* 세그먼트 라디오 + 접두사 값 */}
          <div className="flex items-center gap-2">
            <div className="flex bg-bg-primary rounded-lg p-0.5 border border-bg-border">
              {(['alphabet', 'sc', 'custom'] as PrefixMode[]).map((mode) => {
                const labels: Record<PrefixMode, string> = { alphabet: 'A-X', sc: 'SC', custom: '커스텀' };
                const isActive = prefixMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => updatePrefix(mode)}
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-md transition-all duration-200 font-medium cursor-pointer',
                      isActive
                        ? 'bg-accent text-white shadow-sm shadow-accent/30'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {labels[mode]}
                  </button>
                );
              })}
            </div>
            {prefixMode === 'alphabet' && (
              <div className="relative">
                <select
                  value={alphaPrefix}
                  onChange={(e) => { setAlphaPrefix(e.target.value); setNumber(suggestNextNumber(e.target.value, existingSceneIds)); }}
                  className="appearance-none bg-bg-primary border border-bg-border rounded-lg pl-3 pr-7 py-1.5 text-sm text-text-primary font-mono cursor-pointer hover:border-accent/50 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all w-16"
                >
                  {ALPHABET_PREFIXES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
              </div>
            )}
            {prefixMode === 'sc' && (
              <span className="px-3 py-1.5 text-sm text-accent font-mono font-bold bg-accent/10 rounded-lg border border-accent/20">sc</span>
            )}
            {prefixMode === 'custom' && (
              <input
                autoFocus
                value={customPrefix}
                onChange={(e) => { setCustomPrefix(e.target.value); setNumber(suggestNextNumber(e.target.value, existingSceneIds)); }}
                onKeyDown={handleKeyDown}
                placeholder="접두사"
                className="w-20 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
              />
            )}
          </div>

          {/* 번호 + 일괄 토글 */}
          <div className="flex items-center gap-2">
            <div className="relative flex items-center">
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="001"
                className={cn(
                  'w-24 bg-bg-primary border rounded-lg px-3 py-2 text-sm text-text-primary font-mono font-bold placeholder:text-text-secondary/45 pr-8 focus:ring-1 focus:ring-accent/20 outline-none transition-all',
                  isDuplicate ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'border-bg-border focus:border-accent'
                )}
              />
              <div className="absolute right-1 top-1 bottom-1 flex flex-col gap-px">
                <button onClick={() => stepNumber(1)} className="flex-1 px-0.5 rounded-sm text-text-secondary/50 hover:text-accent hover:bg-accent/10 transition-all cursor-pointer" tabIndex={-1}>
                  <ChevronUp size={10} />
                </button>
                <button onClick={() => stepNumber(-1)} className="flex-1 px-0.5 rounded-sm text-text-secondary/50 hover:text-accent hover:bg-accent/10 transition-all cursor-pointer" tabIndex={-1}>
                  <ChevronDown size={10} />
                </button>
              </div>
            </div>
            <button
              onClick={() => {
                if (suffixDisablesBulk) return;
                setBulkMode(!bulkMode);
              }}
              disabled={suffixDisablesBulk}
              title={suffixDisablesBulk ? '접미가 있는 씬은 한 개씩 추가합니다' : '일괄 추가'}
              className={cn(
                'px-3 py-2 text-xs rounded-lg font-medium transition-colors cursor-pointer',
                suffixDisablesBulk
                  ? 'text-text-secondary/25 border border-bg-border/60 cursor-not-allowed'
                  : bulkMode
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'text-text-secondary/50 hover:text-text-primary border border-bg-border',
              )}
            >
              일괄
            </button>
            {bulkEnabled && (
              <>
                <span className="text-text-secondary/40 text-xs">~</span>
                <input
                  value={bulkEnd}
                  onChange={(e) => setBulkEnd(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="끝번호"
                  className="w-24 bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const nextMode: SceneSuffixMode = effectiveSuffixMode === 'none' ? 'preset' : 'none';
                setSuffixMode(nextMode);
                if (nextMode === 'none') setCustomSuffix('');
                setBulkMode(false);
              }}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                effectiveSuffixMode !== 'none'
                  ? 'border-accent/30 bg-accent/15 text-accent'
                  : 'border-bg-border text-text-secondary/60 hover:text-text-primary',
              )}
            >
              접미 추가
            </button>
            {effectiveSuffixMode !== 'none' && (
              <>
                <select
                  value={effectiveSuffixMode === 'custom' ? 'custom' : presetSuffix}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setSuffixMode('custom');
                      setCustomSuffix('');
                    } else {
                      setSuffixMode('preset');
                      setPresetSuffix(e.target.value);
                    }
                    setBulkMode(false);
                  }}
                  className="appearance-none bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono cursor-pointer hover:border-accent/50 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                >
                  {getAdditionalSceneSuffixOptions(presetSuffix).map((suffix) => (
                    <option key={suffix} value={suffix}>{suffix}</option>
                  ))}
                  <option value="custom">직접</option>
                </select>
                {effectiveSuffixMode === 'custom' && (
                  <input
                    value={customSuffix}
                    onChange={(e) => setCustomSuffix(sanitizeSceneSuffix(e.target.value))}
                    onKeyDown={handleKeyDown}
                    placeholder="A"
                    className="w-16 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                  />
                )}
              </>
            )}
          </div>
          </>
          )}

          {/* ID 미리보기 뱃지 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-lg">
              <span className="text-[11px] text-accent/60">ID</span>
              <span className="text-sm text-accent font-mono font-bold">{sceneId}</span>
            </div>
            {isDuplicate && (
              <span className="text-[11px] text-red-400 bg-red-500/10 px-2 py-1 rounded-md font-medium">중복된 ID</span>
            )}
            {sceneAddMode === 'additional' && !isDuplicate && (
              <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md font-medium">추가씬</span>
            )}
          </div>
        </div>

        {/* 2) 이미지 슬롯 */}
        {!bulkEnabled && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-text-secondary font-medium">이미지 (선택)</span>
            <div className="flex gap-3">
              <AddFormImageSlot label="스토리보드" base64={sbImage} onSetBase64={setSbImage} />
              <AddFormImageSlot label="가이드" base64={guideImage} onSetBase64={setGuideImage} />
            </div>
          </div>
        )}

        {/* 3) 담당자 + 레이아웃 ID */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-text-secondary font-medium">담당자</span>
            <AssigneeSelect
              value={assignee}
              onChange={setAssignee}
              placeholder="담당자"
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-text-secondary font-medium">레이아웃 ID (선택)</span>
            <input
              value={layoutId}
              onChange={(e) => setLayoutId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="레이아웃"
              className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            />
          </div>
        </div>

        {/* 4) 메모 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-text-secondary font-medium">메모 (선택)</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="이 씬에 대한 메모"
            className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
          />
        </div>
      </div>

      {/* ── 고정 하단 버튼 ── */}
      <div className="px-5 py-4 border-t border-bg-border/50 flex items-center justify-between">
        <span className="text-[11px] text-text-secondary/50">
          Enter: 추가 · Esc: 취소
        </span>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-border/20 transition-all cursor-pointer"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
              disabled={isDuplicate || invalidSceneId || (bulkEnabled && !bulkEnd)}
              className={cn(
                'px-5 py-2 text-white text-xs font-medium rounded-lg transition-all cursor-pointer',
                isDuplicate || invalidSceneId || (bulkEnabled && !bulkEnd)
                  ? 'bg-gray-600 cursor-not-allowed opacity-50'
                  : 'bg-accent hover:bg-accent/90 shadow-sm shadow-accent/25 hover:shadow-md hover:shadow-accent/30',
              )}
            >
              {bulkEnabled ? '일괄 추가' : '+ 추가'}
            </button>
        </div>
      </div>
    </div>
  );
}

// ─── 메인 뷰 ──────────────────────────────────────────────────

const VIEW_LABELS: Partial<Record<ViewMode, string>> = {
  dashboard: '대시보드',
  assignee: '인원별 현황',
  episode: '에피소드 현황',
};

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: '전체',
  'not-started': '미착수',
  'in-progress': '진행중',
  done: '완료',
};

const SORT_KEY_LABELS: Record<SortKey, string> = {
  no: '번호순',
  assignee: '담당자순',
  progress: '진행률순',
  incomplete: '미완료 우선',
};

const SCENE_GROUP_MODE_LABELS = {
  flat: '씬번호별',
  layout: '레이아웃별',
} as const;

const SCENE_VIEW_MODE_LABELS = {
  card: '카드',
  sheet: '시트',
} as const;

function SceneOptionSummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-bg-border/60 bg-bg-card/80 px-3 py-1 text-xs backdrop-blur-sm">
      <span className="text-text-secondary/70">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}

/* ── 에피소드 추가 모달 (애니메이션 플레이스홀더) ── */
const EP_PLACEHOLDER_EXAMPLES = [
  '예: 혁도그 (멤버십)',
  '예: 혁장고 (멤버십)',
  '예: 혁둘기 (일반)',
];

function AddEpisodeModal({
  newEpName,
  setNewEpName,
  onConfirm,
  onClose,
}: {
  newEpName: string;
  setNewEpName: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [phIdx, setPhIdx] = useState(0);
  const [phOpacity, setPhOpacity] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhOpacity(0);
      setTimeout(() => {
        setPhIdx((prev) => (prev + 1) % EP_PLACEHOLDER_EXAMPLES.length);
        setPhOpacity(1);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-card rounded-xl shadow-2xl border border-bg-border w-80 p-4 flex flex-col gap-3"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-text-primary">새 에피소드 추가</h3>
        <div>
          <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider">에피소드 이름</label>
          <div className="relative mt-1">
            <input
              autoFocus
              value={newEpName}
              onChange={(e) => setNewEpName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirm();
                if (e.key === 'Escape') onClose();
              }}
              className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            {!newEpName && (
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary/30 pointer-events-none select-none"
                style={{ opacity: phOpacity, transition: 'opacity 0.4s ease-in-out' }}
              >
                {EP_PLACEHOLDER_EXAMPLES[phIdx]}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-secondary/40 mt-1">비우면 기본 이름으로 생성됩니다</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs text-white bg-accent rounded-lg hover:bg-accent/80 transition-colors"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScenesView() {
  const episodes = useDataStore((s) => s.episodes);
  const setSceneStageValue = useDataStore((s) => s.setSceneStageValue);
  const addEpisodeOptimistic = useDataStore((s) => s.addEpisodeOptimistic);
  const addPartOptimistic = useDataStore((s) => s.addPartOptimistic);
  const addSceneOptimistic = useDataStore((s) => s.addSceneOptimistic);
  const deleteSceneOptimistic = useDataStore((s) => s.deleteSceneOptimistic);
  const updateSceneFieldOptimistic = useDataStore((s) => s.updateSceneFieldOptimistic);
  const setEpisodes = useDataStore((s) => s.setEpisodes);
  // v1.25.0~ 액팅 단계 토글 액션
  const setScenePhaseOptimistic = useDataStore((s) => s.setScenePhaseOptimistic);
  const bumpScenePhaseRoundOptimistic = useDataStore((s) => s.bumpScenePhaseRoundOptimistic);
  // v1.27.0 코덱스 1차 P1: bulk ACT phase set 의 legacy boolean dual-write 용.
  // 코덱스 1차 P1: sheet 안에서만 sceneId 매칭 (글로벌 검색 금지)
  const findSceneInSheet = useDataStore((s) => s.findSceneInSheet);
  const updateSceneByUuid = useDataStore((s) => s.updateSceneByUuid);
  const { selectedEpisode, selectedPart, selectedAssignee, searchQuery, selectedDepartment } = useAppStore();
  const dataConnected = useAppStore((s) => s.dataConnected);
  const colorMode = useAppStore((s) => s.colorMode);
  const revisionCountByScene = useRevisionStore((s) => s.revisionCountByScene);
  const { sortKey, sortDir, statusFilter, sceneViewMode, sceneGroupMode } = useAppStore();
  const { setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSearchQuery, setSelectedDepartment, setDashboardDeptFilter } = useAppStore();
  const { setSortKey, setSortDir, setStatusFilter, setSceneViewMode, setSceneGroupMode } = useAppStore();
  const { previousView, setView, highlightSceneId, setHighlightSceneId } = useAppStore();
  const { selectedSceneIds, toggleSelectedScene, setSelectedScenes, clearSelectedScenes } = useAppStore();
  // 일괄 액션 바를 콘텐츠 영역 정중앙(=사이드바 뺀 자리) 으로 보정. 사이드바 펼침/접힘에 동기.
  const sidebarExpanded = useAppStore((s) => s.sidebarExpanded);
  // viewport 너비 실시간 추적 — 사이드바 너비를 뺀 콘텐츠 영역의 정중앙 픽셀 계산용.
  // framer-motion 의 animate.x:'-50%' 와 함께 left=px 로 줘야 motion 이 transform 을 올바르게 관리.
  // (style.transform 인라인 지정은 motion 이 자기 transform 으로 덮어써 무시됨 → 한솔 보고 v1.27.0)
  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const currentUser = useAuthStore((s) => s.currentUser);
  const isBulkInFlight = useBulkOperationsStore((s) => s.activeOp?.status === 'in-flight');
  const isLight = colorMode === 'light';
  const assigneeProgressWriteQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const assigneeProgressMutationSeqRef = useRef<Map<string, number>>(new Map());

  const enqueueAssigneeProgressWrite = useCallback(
    (sceneUuid: string, task: () => Promise<void>) => {
      const queues = assigneeProgressWriteQueueRef.current;
      const previous = queues.get(sceneUuid) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(task);
      const settled = run.catch(() => undefined);
      queues.set(sceneUuid, settled);
      void settled.finally(() => {
        if (queues.get(sceneUuid) === settled) {
          queues.delete(sceneUuid);
        }
      });
      return run;
    },
    [],
  );

  const writeAssigneeProgressMetadata = useCallback(
    (sceneUuid: string, progress: SceneAssigneeProgressMap) =>
      enqueueAssigneeProgressWrite(sceneUuid, () =>
        writeMetadata(
          SCENE_ASSIGNEE_PROGRESS_META_TYPE,
          sceneUuid,
          serializeAssigneeProgress(progress),
        ),
      ),
    [enqueueAssigneeProgressWrite],
  );

  // v1.25.0~ 피드백 대기 확인 모달 상태
  const [feedbackModal, setFeedbackModal] = useState<{
    open: boolean;
    sheetName: string;
    sceneId: string;
    scene: Scene;
    episodeNumber: number;
    fromState: ScenePhaseState;
    fromWorkRound: number;
    fromFeedbackRound: number;
    assigneeName?: string;
    sceneUuid?: string | null;
    sceneIndex?: number;
  } | null>(null);

  // v1.25.0~ 액팅 토글 핸들러
  // 코덱스 1차 P1 #1 fix: 글로벌 findSceneBySceneId 대신 findSceneInSheet 사용 — 같은 sceneId 가
  //   다른 에피소드/파트에 있어도 정확히 해당 sheet 의 씬만 매칭.
  // 코덱스 1차 P1 #2 fix: 롤백 시 updateSceneByUuid 로 sceneState/workRound/feedbackRound 셋 모두
  //   명시적 복원. setScenePhaseOptimistic 만 부르면 전이 규칙이 다시 적용되어 차수가 잘못 복구됨.
  const handleActPhaseStateClick = useCallback(
    async (
      sheetName: string,
      sceneId: string,
      newState: ScenePhaseState,
      requestedSceneUuid?: string | null,
      requestedSceneIndex?: number,
    ) => {
      const latestPart = useDataStore.getState().episodes
        .flatMap((ep) => ep.parts)
        .find((part) => part.sheetName === sheetName);
      const sceneIndex = latestPart
        ? findCompletionSceneIndex(latestPart.scenes, {
            sceneId,
            sceneUuid: requestedSceneUuid ?? null,
            sceneIndex: requestedSceneIndex,
          })
        : -1;
      const scene = sceneIndex >= 0 ? latestPart?.scenes[sceneIndex] : undefined;
      if (!scene?.id || sceneIndex < 0) return;
      const sceneUuid = scene.id;
      const prevState: ScenePhaseState = scene.sceneState ?? 'wait';
      const prevWork = scene.workRound ?? 0;
      const prevFb = scene.feedbackRound ?? 0;
      // 코덱스 5차 P1 #11 fix: legacy boolean 도 캡처해 롤백 시 복원
      const prevLegacy = { lo: scene.lo, done: scene.done, review: scene.review, png: scene.png };
      const prevCompletedBy = scene.completedBy ?? '';
      const prevCompletedAt = scene.completedAt ?? '';
      const wasFullyDone = Boolean(scene.lo && scene.done && scene.review && scene.png);
      const willBeFullyDone = newState === 'done';
      const prevAssigneeProgress = scene.assigneeProgress;
      let workRound = prevWork;
      let feedbackRound = prevFb;
      if (newState === 'wait' || newState === 'done') {
        workRound = 0;
        feedbackRound = 0;
      } else if (newState === 'work') {
        if (prevState === 'feedback') workRound = Math.min(99, prevFb + 1);
        else if (prevState !== 'work') workRound = Math.max(1, Math.min(99, prevWork || 1));
      } else if (newState === 'feedback') {
        if (prevState === 'work') feedbackRound = Math.min(99, prevWork);
        else if (prevState !== 'feedback') feedbackRound = Math.max(1, Math.min(99, prevFb || 1));
      }
      const completionMeta = (() => {
        if (willBeFullyDone && !wasFullyDone) {
          return {
            nextCompletedBy: currentUser?.name ?? '알 수 없음',
            nextCompletedAt: new Date().toISOString(),
            prevCompletedBy,
            prevCompletedAt,
          };
        }
        if (wasFullyDone && !willBeFullyDone && (prevCompletedBy || prevCompletedAt)) {
          return {
            nextCompletedBy: '',
            nextCompletedAt: '',
            prevCompletedBy,
            prevCompletedAt,
          };
        }
        return null;
      })();

      const nextProgress = hasMultiAssigneeProgress(scene)
        ? updateAllAssigneeProgressEntries(
            scene,
            { kind: 'phase', state: newState, workRound, feedbackRound },
            currentUser?.name,
          )
        : null;
      const phasePatch = {
        sceneState: newState,
        workRound,
        feedbackRound,
        ...legacyStagesFor(newState),
        ...(nextProgress ? { assigneeProgress: nextProgress } : {}),
      };

      updateSceneByUuid(sceneUuid, phasePatch);
      if (completionMeta) {
        if (completionMeta.nextCompletedBy && completionMeta.nextCompletedAt) {
          setCelebratingTarget(buildCompletionTarget(sheetName, scene, sceneIndex));
          setLastCompletionUndoAction({
            kind: 'phase',
            sheetName,
            sceneId,
            sceneUuid,
            sceneIndex,
            previousState: prevState,
            previousWorkRound: prevWork,
            previousFeedbackRound: prevFb,
            previousCompletedBy: prevCompletedBy,
            previousCompletedAt: prevCompletedAt,
          });
        }
        updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', completionMeta.nextCompletedBy);
        updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', completionMeta.nextCompletedAt);
      }

      // 새 round 값을 store와 동일한 규칙으로 다시 계산해 Supabase 동기화
      // 코덱스 2차 P2 fix: 99 상한 클램프 (store 전이 규칙과 일치)
      try {
        await updateScenePhaseInSupabase(sceneUuid, newState, workRound, feedbackRound, currentUser?.id);
      } catch (err) {
        console.error('[ScenesView] 단계 변경 실패:', err);
        sonnerToast.error('단계 변경 저장에 실패했습니다.');
        // 명시적 롤백 — sceneState/round 셋 + legacy 4개 모두 복원
        updateSceneByUuid(sceneUuid, {
          sceneState: prevState,
          workRound: prevWork,
          feedbackRound: prevFb,
          ...prevLegacy,
          completedBy: prevCompletedBy,
          completedAt: prevCompletedAt,
          assigneeProgress: prevAssigneeProgress,
        });
        return;
      }

      if (nextProgress) {
        try {
          await writeAssigneeProgressMetadata(sceneUuid, nextProgress);
        } catch (err) {
          console.error('[ScenesView] 담당자별 진행 저장 실패:', err);
          sonnerToast.error('담당자별 진행 저장에 실패했습니다.');
          updateSceneByUuid(sceneUuid, { assigneeProgress: prevAssigneeProgress });
          syncInBackground();
        }
      }

      if (completionMeta) {
        try {
          await updateSceneCompletionMeta(
            sheetName,
            sceneIndex,
            completionMeta.nextCompletedBy && completionMeta.nextCompletedAt
              ? {
                  completedBy: completionMeta.nextCompletedBy,
                  completedAt: completionMeta.nextCompletedAt,
                }
              : null,
          );
        } catch (metaErr) {
          console.error('[완료 메타 저장 실패]', metaErr);
        }
      }
    },
    [updateSceneByUuid, updateSceneFieldOptimistic, currentUser?.id, currentUser?.name, writeAssigneeProgressMetadata],
  );

  const handleActFeedbackRequest = useCallback(
    (
      sheetName: string,
      sceneId: string,
      assigneeName?: string,
      requestedSceneUuid?: string | null,
      requestedSceneIndex?: number,
    ) => {
      const latestPart = useDataStore.getState().episodes
        .flatMap((ep) => ep.parts)
        .find((part) => part.sheetName === sheetName);
      const sceneIndex = latestPart
        ? findCompletionSceneIndex(latestPart.scenes, {
            sceneId,
            sceneUuid: requestedSceneUuid ?? null,
            sceneIndex: requestedSceneIndex,
          })
        : -1;
      const scene = sceneIndex >= 0 ? latestPart?.scenes[sceneIndex] : undefined;
      if (!scene) return;
      const ep = episodes.find((e) => e.parts.some((p) => p.sheetName === sheetName));
      if (!ep) return;
      const assigneeProgress = assigneeName ? normalizeAssigneeProgressMap(scene)[assigneeName] : null;
      const fromState = assigneeProgress?.sceneState ?? scene.sceneState ?? sceneStateFromScene(scene);
      const fromWorkRound = assigneeProgress?.workRound ?? scene.workRound ?? 0;
      const fromFeedbackRound = assigneeProgress?.feedbackRound ?? scene.feedbackRound ?? 0;
      setFeedbackModal({
        open: true,
        sheetName,
        sceneId,
        scene,
        episodeNumber: ep.episodeNumber,
        fromState,
        fromWorkRound,
        fromFeedbackRound,
        assigneeName,
        sceneUuid: scene.id ?? requestedSceneUuid ?? null,
        sceneIndex,
      });
    },
    [episodes],
  );

  const handleActRoundBump = useCallback(
    async (sheetName: string, sceneId: string, kind: 'work' | 'feedback', delta: 1 | -1) => {
      const scene = findSceneInSheet(sheetName, sceneId);
      if (!scene?.id) return;
      const sceneUuid = scene.id;
      const prevState: ScenePhaseState = scene.sceneState ?? 'wait';
      const prevWork = scene.workRound ?? 0;
      const prevFb = scene.feedbackRound ?? 0;
      bumpScenePhaseRoundOptimistic(sheetName, sceneId, kind, delta);
      const newWork = kind === 'work' ? Math.max(1, Math.min(99, prevWork + delta)) : prevWork;
      const newFb = kind === 'feedback' ? Math.max(1, Math.min(99, prevFb + delta)) : prevFb;
      try {
        await updateScenePhaseInSupabase(sceneUuid, prevState, newWork, newFb, currentUser?.id);
      } catch (err) {
        console.error('[ScenesView] 차수 변경 실패:', err);
        sonnerToast.error('차수 변경 저장에 실패했습니다.');
        // 명시적 롤백 — bump 역방향 호출 대신 explicit 값 set
        updateSceneByUuid(sceneUuid, {
          sceneState: prevState,
          workRound: prevWork,
          feedbackRound: prevFb,
        });
      }
    },
    [findSceneInSheet, bumpScenePhaseRoundOptimistic, updateSceneByUuid, currentUser?.id],
  );

  const persistAssigneeProgress = useCallback(
    async (
      sheetName: string,
      sceneId: string,
      assigneeName: string,
      update:
        | { kind: 'stage'; stage: Stage }
        | { kind: 'phase'; state: ScenePhaseState }
        | { kind: 'round'; roundKind: 'work' | 'feedback'; delta: 1 | -1 },
      department: Department,
      requestedSceneUuid?: string | null,
      requestedSceneIndex?: number,
    ) => {
      const latestPart = useDataStore.getState().episodes
        .flatMap((ep) => ep.parts)
        .find((part) => part.sheetName === sheetName);
      const sceneIndex = latestPart
        ? findCompletionSceneIndex(latestPart.scenes, {
            sceneId,
            sceneUuid: requestedSceneUuid ?? null,
            sceneIndex: requestedSceneIndex,
          })
        : -1;
      const scene = sceneIndex >= 0 ? latestPart?.scenes[sceneIndex] : undefined;
      if (!scene?.id || sceneIndex < 0) return;
      const sceneUuid = scene.id;

      const prevScene = { ...scene };
      const mutationSeq = (assigneeProgressMutationSeqRef.current.get(sceneUuid) ?? 0) + 1;
      assigneeProgressMutationSeqRef.current.set(sceneUuid, mutationSeq);
      const nextProgress = updateAssigneeProgressEntry(scene, assigneeName, update, currentUser?.name);
      const patch = aggregateScenePatchFromAssignees(scene, nextProgress, department);
      const wasFullyDone = isFullyDone(scene);
      const nextScene = { ...scene, ...patch };
      const willBeFullyDone = isFullyDone(nextScene);
      const prevCompletedBy = scene.completedBy ?? '';
      const prevCompletedAt = scene.completedAt ?? '';
      const completionMeta = (() => {
        if (willBeFullyDone && !wasFullyDone) {
          return {
            nextCompletedBy: currentUser?.name ?? '알 수 없음',
            nextCompletedAt: new Date().toISOString(),
          };
        }
        if (wasFullyDone && !willBeFullyDone && (prevCompletedBy || prevCompletedAt)) {
          return {
            nextCompletedBy: '',
            nextCompletedAt: '',
          };
        }
        return null;
      })();
      if (completionMeta) {
        patch.completedBy = completionMeta.nextCompletedBy;
        patch.completedAt = completionMeta.nextCompletedAt;
      }

      updateSceneByUuid(sceneUuid, patch);
      if (!wasFullyDone && willBeFullyDone) {
        setCelebratingTarget(buildCompletionTarget(sheetName, scene, sceneIndex));
      }

      try {
        await enqueueAssigneeProgressWrite(sceneUuid, async () => {
          await writeMetadata(
            SCENE_ASSIGNEE_PROGRESS_META_TYPE,
            sceneUuid,
            serializeAssigneeProgress(nextProgress),
          );
          if (completionMeta) {
            try {
              await updateSceneCompletionMeta(
                sheetName,
                sceneIndex,
                completionMeta.nextCompletedBy && completionMeta.nextCompletedAt
                  ? {
                      completedBy: completionMeta.nextCompletedBy,
                      completedAt: completionMeta.nextCompletedAt,
                    }
                  : null,
              );
            } catch (metaErr) {
              console.error('[담당자별 완료 메타 저장 실패]', metaErr);
            }
          }
        });
      } catch (err) {
        console.error('[ScenesView] 담당자별 진행 저장 실패:', err);
        sonnerToast.error('담당자별 진행 저장에 실패했습니다.');
        if (assigneeProgressMutationSeqRef.current.get(sceneUuid) === mutationSeq) {
          updateSceneByUuid(sceneUuid, prevScene);
        }
        return;
      }
    },
    [currentUser?.name, enqueueAssigneeProgressWrite, updateSceneByUuid, updateSceneCompletionMeta],
  );

  const handleAssigneeStageToggle = useCallback(
    (
      sheetName: string,
      sceneId: string,
      assigneeName: string,
      stage: Stage,
      sceneUuid?: string | null,
      sceneIndex?: number,
      department: Department = 'bg',
    ) => {
      void persistAssigneeProgress(
        sheetName,
        sceneId,
        assigneeName,
        { kind: 'stage', stage },
        department,
        sceneUuid,
        sceneIndex,
      );
    },
    [persistAssigneeProgress],
  );

  const handleAssigneeActPhaseStateClick = useCallback(
    (
      sheetName: string,
      sceneId: string,
      assigneeName: string,
      newState: ScenePhaseState,
      sceneUuid?: string | null,
      sceneIndex?: number,
    ) => {
      if (newState === 'feedback') {
        handleActFeedbackRequest(sheetName, sceneId, assigneeName, sceneUuid, sceneIndex);
        return;
      }
      void persistAssigneeProgress(
        sheetName,
        sceneId,
        assigneeName,
        { kind: 'phase', state: newState },
        'acting',
        sceneUuid,
        sceneIndex,
      );
    },
    [handleActFeedbackRequest, persistAssigneeProgress],
  );

  const handleAssigneeActRoundBump = useCallback(
    (
      sheetName: string,
      sceneId: string,
      assigneeName: string,
      kind: 'work' | 'feedback',
      delta: 1 | -1,
      sceneUuid?: string | null,
      sceneIndex?: number,
    ) => {
      void persistAssigneeProgress(
        sheetName,
        sceneId,
        assigneeName,
        { kind: 'round', roundKind: kind, delta },
        'acting',
        sceneUuid,
        sceneIndex,
      );
    },
    [persistAssigneeProgress],
  );

  // 피드백 모달 — 알림 보내기 (상태 변경 + broadcast)
  const sendFeedbackWithNotification = useCallback(
    async (recipientIds: string[]) => {
      if (!feedbackModal) return;
      const { sheetName, sceneId, scene, episodeNumber, fromState, fromWorkRound, fromFeedbackRound, assigneeName } = feedbackModal;
      if (!scene.id) {
        setFeedbackModal(null);
        return;
      }
      const targetRound = fromState === 'work' ? fromWorkRound : Math.max(1, fromFeedbackRound || 1);

      // 1) 상태 변경 (낙관적 + Supabase)
      const sceneUuid = scene.id;
      if (assigneeName) {
        const nextProgress = updateAssigneeProgressEntry(
          scene,
          assigneeName,
          { kind: 'phase', state: 'feedback' },
          currentUser?.name,
        );
        const patch = aggregateScenePatchFromAssignees(scene, nextProgress, 'acting');
        updateSceneByUuid(sceneUuid, patch);
        try {
          await writeAssigneeProgressMetadata(sceneUuid, nextProgress);
        } catch (err) {
          console.error('[ScenesView] 담당자별 피드백 대기 저장 실패:', err);
          sonnerToast.error('담당자별 피드백 대기 저장에 실패했습니다.');
          updateSceneByUuid(sceneUuid, scene);
          setFeedbackModal(null);
          return;
        }
      } else {
        setScenePhaseOptimistic(sheetName, sceneId, 'feedback');
        try {
          await updateScenePhaseInSupabase(sceneUuid, 'feedback', fromWorkRound, targetRound, currentUser?.id);
        } catch (err) {
          console.error('[ScenesView] 피드백 대기 저장 실패:', err);
          sonnerToast.error('피드백 대기 저장에 실패했습니다.');
          // 코덱스 1차 P1 #2 / 5차 P1 #11 fix: 명시적 복원 (sceneState/round/legacy 모두)
          updateSceneByUuid(sceneUuid, {
            sceneState: fromState,
            workRound: fromWorkRound,
            feedbackRound: feedbackModal.fromFeedbackRound,
            lo: scene.lo, done: scene.done, review: scene.review, png: scene.png,
          });
          setFeedbackModal(null);
          return;
        }
      }

      // 2) 알림 발송 (recipients 가 비어있으면 skip)
      if (recipientIds.length > 0) {
        try {
          await dispatchActingFeedbackNotification({
            sceneUuid,
            sceneId,
            sheetName,
            episodeNumber,
            senderId: currentUser?.id ?? '',
            senderName: currentUser?.name ?? '익명',
            fromState,
            toState: 'feedback',
            workRound: fromWorkRound,
            feedbackRound: targetRound,
            recipients: recipientIds,
          });
          sonnerToast.success(`${recipientIds.length}명에게 피드백 알림을 보냈습니다.`);
        } catch (err) {
          console.error('[ScenesView] 피드백 알림 발송 실패:', err);
          sonnerToast.error('알림 발송에 실패했습니다. 상태는 변경됐어요.');
        }
      }

      setFeedbackModal(null);
    },
    [feedbackModal, currentUser?.id, currentUser?.name, setScenePhaseOptimistic, updateSceneByUuid, writeAssigneeProgressMetadata],
  );

  // 피드백 모달 — 알림 없이 상태만 변경
  const silentChangeToFeedback = useCallback(async () => {
    if (!feedbackModal) return;
    const { sheetName, sceneId, scene, fromState, fromWorkRound, fromFeedbackRound, assigneeName } = feedbackModal;
    if (!scene.id) {
      setFeedbackModal(null);
      return;
    }
    const sceneUuid = scene.id;
    const targetRound = fromState === 'work' ? fromWorkRound : Math.max(1, fromFeedbackRound || 1);
    if (assigneeName) {
      const nextProgress = updateAssigneeProgressEntry(
        scene,
        assigneeName,
        { kind: 'phase', state: 'feedback' },
        currentUser?.name,
      );
      const patch = aggregateScenePatchFromAssignees(scene, nextProgress, 'acting');
      updateSceneByUuid(sceneUuid, patch);
      try {
        await writeAssigneeProgressMetadata(sceneUuid, nextProgress);
        sonnerToast.success('상태만 변경했습니다 (알림 없음).');
      } catch (err) {
        console.error('[ScenesView] 담당자별 피드백 대기(조용히) 저장 실패:', err);
        sonnerToast.error('담당자별 피드백 대기 저장에 실패했습니다.');
        updateSceneByUuid(sceneUuid, scene);
      }
    } else {
      setScenePhaseOptimistic(sheetName, sceneId, 'feedback');
      try {
        await updateScenePhaseInSupabase(sceneUuid, 'feedback', fromWorkRound, targetRound, currentUser?.id);
        sonnerToast.success('상태만 변경했습니다 (알림 없음).');
      } catch (err) {
        console.error('[ScenesView] 피드백 대기(조용히) 저장 실패:', err);
        sonnerToast.error('피드백 대기 저장에 실패했습니다.');
        // 코덱스 1차 P1 #2 / 5차 P1 #11 fix: 명시적 복원 (legacy 포함)
        updateSceneByUuid(sceneUuid, {
          sceneState: fromState,
          workRound: fromWorkRound,
          feedbackRound: fromFeedbackRound,
          lo: scene.lo, done: scene.done, review: scene.review, png: scene.png,
        });
      }
    }
    setFeedbackModal(null);
  }, [feedbackModal, currentUser?.id, currentUser?.name, setScenePhaseOptimistic, updateSceneByUuid, writeAssigneeProgressMetadata]);

  const fromStateLabel = useMemo(() => {
    if (!feedbackModal) return '';
    const { fromState, fromWorkRound } = feedbackModal;
    const label = SCENE_PHASE_LABELS[fromState];
    if (fromState === 'work') return `${label} ${fromWorkRound || 1}차`;
    if (fromState === 'feedback') return `${label} ${feedbackModal.fromFeedbackRound || 1}차`;
    return label;
  }, [feedbackModal]);

  const targetFeedbackRound = useMemo(() => {
    if (!feedbackModal) return 1;
    const { fromState, fromWorkRound, fromFeedbackRound } = feedbackModal;
    if (fromState === 'work') return Math.max(1, fromWorkRound || 1);
    return Math.max(1, fromFeedbackRound || 1);
  }, [feedbackModal]);

  // 글로우 CSS 주입 + 하이라이트 자동 해제 (3.6초 후)
  useEffect(() => {
    if (highlightSceneId) {
      ensureGlowCss();
      const timer = setTimeout(() => setHighlightSceneId(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [highlightSceneId, setHighlightSceneId]);

  // 코덱스 2차 P1 #4 fix: 액팅 피드백 알림 수신·점프 리스너는 App.tsx 로 이동됨.
  // ScenesView 가 unmount 되면 다른 뷰(Dashboard 등) 에선 알림을 못 받기 때문.

  const deletePartOptimistic = useDataStore((s) => s.deletePartOptimistic);
  const deleteEpisodeOptimistic = useDataStore((s) => s.deleteEpisodeOptimistic);

  const [showAddScene, setShowAddScene] = useState(false);
  const [bulkAddLoading, setBulkAddLoading] = useState(false);
  const [celebratingTarget, setCelebratingTarget] = useState<CompletionCelebrationTarget>(null);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchAssigneeValue, setBatchAssigneeValue] = useState('');
  // v1.27.0: 일괄 편집 담당자 처리 모드 — 'replace'=기존 덮어쓰기, 'append'=콤마 구분 이어붙이기 (중복 제거).
  const [batchAssigneeMode, setBatchAssigneeMode] = useState<'replace' | 'append'>('replace');
  // v1.27.0: 일괄 편집 적용 대상 부서 — 'all'=BG+ACT 둘 다, 'bg'=BG만, 'acting'=ACT만.
  // 기본값은 현재 카드뷰의 selectedDepartment 와 동기 (모달 열 때마다 갱신).
  const [batchTargetDept, setBatchTargetDept] = useState<'all' | 'bg' | 'acting'>('all');
  // treeOpen 초기값 — 영속화된 값이 있으면 그걸로, 없으면 true (디폴트 펼침)
  const [treeOpen, setTreeOpen] = useState(() => loadPersistedTreeOpen() ?? true);

  // v1.15.11 (한솔 보고): selectedEpisode 복원은 App.tsx 의 root-level init useEffect 로 이전.
  // 이전엔 ScenesView 마운트 시 saved last episode 를 복원했는데 외부 navigate 와 race 발생 →
  // 다른 에피소드 알림 클릭 시 마지막 본 에피소드로 되돌아가는 버그.
  // 여기선 sceneViewMode (cards/sheet/grouped) 만 1회 복원 — selectedEpisode 와 무관하므로 race 없음.
  const persistRestoredRef = useRef(false);
  useEffect(() => {
    if (persistRestoredRef.current) return;
    if (episodes.length === 0) return;
    if (highlightSceneId) {
      persistRestoredRef.current = true;
      return;
    }
    const savedMode = loadPersistedSceneViewMode();
    if (savedMode) setSceneViewMode(savedMode);
    persistRestoredRef.current = true;
  }, [episodes, highlightSceneId, setSceneViewMode]);

  // 변화 감지 → 즉시 영속화. 디폴트 값일 때 호출되어도 무해.
  useEffect(() => { savePersistedSceneViewMode(sceneViewMode); }, [sceneViewMode]);
  useEffect(() => {
    if (selectedEpisode !== null && selectedEpisode !== undefined) {
      savePersistedLastEpisode(selectedEpisode);
    }
  }, [selectedEpisode]);
  useEffect(() => { savePersistedTreeOpen(treeOpen); }, [treeOpen]);

  // 파트 컨텍스트 메뉴
  const { menuPosition: partMenuPos, openMenu: openPartMenu, closeMenu: closePartMenu } = useContextMenu();
  const [partMenuTarget, setPartMenuTarget] = useState<PartContextMenuTarget | null>(null);
  const [editingPartMemo, setEditingPartMemo] = useState<PartContextMenuTarget | null>(null);
  const [partMemoInput, setPartMemoInput] = useState('');
  const [editingPartReelWorker, setEditingPartReelWorker] = useState<PartContextMenuTarget | null>(null);
  const [partReelWorkerInput, setPartReelWorkerInput] = useState('');

  // 에피소드 편집
  const [epEditOpen, setEpEditOpen] = useState(false);
  const [epMemo, setEpMemo] = useState('');

  // 에피소드 제목/메모 — 글로벌 스토어에서 읽기 (App.tsx에서 병렬 로드)
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const episodeMemos = useDataStore((s) => s.episodeMemos);
  const setEpisodeTitles = useDataStore((s) => s.setEpisodeTitles);
  const setEpisodeMemos = useDataStore((s) => s.setEpisodeMemos);
  const [epTitleInput, setEpTitleInput] = useState('');

  // 에피소드 추가 모달
  const [addEpOpen, setAddEpOpen] = useState(false);
  const [newEpName, setNewEpName] = useState('');

  // 아카이빙된 에피소드 목록
  const [archivedEpisodes, setArchivedEpisodes] = useState<{ episodeNumber: number; title: string; partCount: number; archivedBy?: string; archivedAt?: string; memo?: string }[]>([]);

  // 동기화 매니저: 버전 카운터 + 낙관적 보호 플래그
  const syncVersionRef = useRef(0);
  const archiveGuardRef = useRef(false); // 아카이빙 작업 중 sync 차단

  // 아카이빙 확인 다이얼로그 (메모 입력 포함)
  const [archiveDialogEpNum, setArchiveDialogEpNum] = useState<number | null>(null);
  const [archiveMemoInput, setArchiveMemoInput] = useState('완료로 인한 아카이빙');

  // 에피소드 우클릭 컨텍스트 메뉴
  const [epContextMenu, setEpContextMenu] = useState<{ x: number; y: number; epNum: number } | null>(null);

  const clearCelebration = useCallback(() => setCelebratingTarget(null), []);
  useEffect(() => {
    if (!celebratingTarget) return;
    const timer = window.setTimeout(() => setCelebratingTarget(null), 1600);
    return () => window.clearTimeout(timer);
  }, [celebratingTarget]);
  useEffect(() => {
    setCelebratingTarget(null);
  }, [selectedEpisode, selectedPart, selectedDepartment, sceneViewMode, statusFilter, searchQuery, selectedAssignee]);
  const [detailSceneIndex, setDetailSceneIndex] = useState<number | null>(null);
  const [sceneControlsCollapsedByContext, setSceneControlsCollapsedByContext] = useState<Record<string, boolean>>({});
  const scenePrefsRef = useRef<UserPreferences | null>(null);

  // v1.18.0: 알림 클릭 등 외부에서 모달 자동 오픈 시 전달되는 라우팅 옵션.
  // 'revisions' 탭으로 시작 + 특정 리테이크 카드 강조 등.
  // v1.24.0: focusCommentId 추가 — 알림/활동 점프 시 댓글 자동 스크롤 + 펄스.
  const [modalRouting, setModalRouting] = useState<{
    initialTab?: 'detail' | 'revisions' | 'files' | 'history';
    focusRevisionId?: string;
    focusCommentId?: string;
    focusRevisionCommentId?: string;
  } | null>(null);

  // 리테이크 초기 로드
  const loadRevisions = useRevisionStore((s) => s.loadRevisions);

  // 댓글 + 리테이크 모드 설정. 프리뷰/오프라인은 로컬 더미 저장소, 연결 상태는 Supabase/Sheets 경로를 사용.
  useEffect(() => {
    setCommentsSheetsMode(dataConnected);
    setRevisionsSheetsMode(dataConnected);
    loadRevisions();
    return () => { invalidatePartCache(); };
  }, [dataConnected, loadRevisions]);

  useEffect(() => {
    let cancelled = false;

    void loadPreferences().then((prefs) => {
      if (cancelled) return;
      scenePrefsRef.current = prefs;
      setSceneControlsCollapsedByContext(prefs?.sceneUi?.controlsCollapsedByContext ?? {});
    });

    return () => { cancelled = true; };
  }, []);

  // 전체 댓글 카운트 로드
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  // Codex P2 6차(2026-04-23): ambiguous skip 으로 BG/ACT 댓글 집합이 달라질 수 있어
  // `getMergedCommentBadgeCounts` 가 union 크기를 산출할 수 있도록 id list 도 함께 유지.
  const [commentIdsByKey, setCommentIdsByKey] = useState<Record<string, string[]>>({});
  const [commentLatestAtByKey, setCommentLatestAtByKey] = useState<Record<string, string>>({});
  const [commentThreadKeyByCommentKey, setCommentThreadKeyByCommentKey] = useState<Record<string, string>>({});
  const [commentReadAtByKey, setCommentReadAtByKey] = useState<Record<string, string>>({});
  // 댓글 카운트 로딩은 currentPart 정의 후 아래에서 수행 (useEffect)

  // Shift+Click 범위 선택을 위한 마지막 클릭 인덱스
  const lastClickedIndexRef = useRef<number | null>(null);

  // 라쏘 드래그 선택
  const gridRef = useRef<HTMLDivElement>(null);
  const getSceneIdFromEl = useCallback((el: Element) => el.getAttribute('data-scene-id'), []);
  const handleLassoChange = useCallback((ids: Set<string>, shiftKey: boolean, baseline: Set<string>) => {
    // 1) 라쏘 원본 ids를 selectedDepartment에 맞춰 정규화 (전체 모드면 bg:/act: 접두사 부여)
    const normalize = (raw: Set<string>): Set<string> => {
      if (selectedDepartment !== 'all') return raw;
      const prefixed = new Set<string>();
      raw.forEach((id) => { prefixed.add(`bg:${id}`); prefixed.add(`act:${id}`); });
      return prefixed;
    };
    const normalized = normalize(ids);
    // 2) Shift+라쏘: 훅이 mousedown 시점에 snapshot한 baseline과 union (경로 누적 방지).
    if (shiftKey) {
      setSelectedScenes(new Set<string>([...baseline, ...normalized]));
    } else {
      setSelectedScenes(normalized);
    }
  }, [setSelectedScenes, selectedDepartment]);
  const isCardView = sceneViewMode === 'card';
  const getLassoBaseline = useCallback(
    () => useAppStore.getState().selectedSceneIds,
    [],
  );
  const { lassoRect } = useLassoSelection(
    gridRef,
    '[data-scene-id]',
    getSceneIdFromEl,
    handleLassoChange,
    isCardView,
    getLassoBaseline,
  );

  // 파트/에피소드/뷰모드 변경 시 선택 초기화
  useEffect(() => { clearSelectedScenes(); }, [selectedEpisode, selectedPart, selectedDepartment, sceneViewMode, clearSelectedScenes]);

  // 백그라운드 동기화: 낙관적 업데이트 후 서버와 싱크
  // 동기화 매니저: 버전 카운터로 오래된 응답 폐기 + 아카이브 가드로 낙관적 상태 보호
  const syncInBackground = async () => {
    const myVersion = ++syncVersionRef.current;
    try {
      const { readAll, readArchived } = await import('@/services/supabaseService');
      const eps = await readAll();

      // 버전 체크: 이 sync 이후에 새 sync가 시작되었으면 결과 폐기
      if (syncVersionRef.current !== myVersion) return;

      setEpisodes(eps);

      // 아카이빙 가드: 아카이빙/해제 작업 진행 중이면 archived 목록 갱신 스킵
      if (!archiveGuardRef.current) {
        try {
          const archivedList = await readArchived();
          // 다시 한번 버전+가드 체크 (비동기 응답 사이에 상태가 바뀌었을 수 있음)
          if (syncVersionRef.current === myVersion && !archiveGuardRef.current) {
            setArchivedEpisodes(archivedList.map((item) => ({
              episodeNumber: item.episodeNumber,
              title: item.title,
              partCount: item.partCount,
              archivedBy: item.archivedBy || undefined,
              archivedAt: item.archivedAt || undefined,
              memo: item.archiveMemo || undefined,
            })));
          }
        } catch { /* 아카이빙 목록 갱신 실패는 무시 */ }
      }

      // 다른 창에 스냅샷 릴레이 (full readAll 대신 데이터 직접 전달)
      const { episodeTitles, episodeMemos } = useDataStore.getState();
      window.electronAPI?.sheetsRelaySnapshot?.({ episodes: eps, episodeTitles, episodeMemos });
    } catch (err) {
      console.error('[백그라운드 동기화 실패]', err);
    }
  };

  // 에피소드 목록
  const episodeOptions = episodes.map((ep) => ({
    value: ep.episodeNumber,
    label: episodeTitles[ep.episodeNumber] || ep.title,
  }));

  // 선택된 에피소드 + 부서별 파트 필터링
  const currentEp = episodes.length > 0
    ? (episodes.find((ep) => ep.episodeNumber === selectedEpisode) ?? episodes[0])
    : undefined;
  const allParts = currentEp?.parts ?? [];
  const parts = selectedDepartment === 'all' ? allParts : allParts.filter((p) => p.department === selectedDepartment);

  // 'all' 모드: partId 기준 unique partIds
  const uniquePartIds = useMemo(() => {
    return getCanonicalPartIds(parts);
  }, [parts]);

  // 'all' 모드에서 현재 partId 도출
  const currentPartId = selectedDepartment === 'all'
    ? (uniquePartIds.find((partId) => partIdMatches(partId, selectedPart)) ?? (uniquePartIds[0] ?? null))
    : null;

  // 'all' 모드: bgPart + actPart 분리
  const bgPart = selectedDepartment === 'all'
    ? findPartById(allParts, currentPartId, 'bg') ?? null
    : null;
  const actPart = selectedDepartment === 'all'
    ? findPartById(allParts, currentPartId, 'acting') ?? null
    : null;

  // 개별 모드: 기존 currentPart
  const currentPart = selectedDepartment !== 'all' && parts.length > 0
    ? (findPartById(parts, selectedPart) ?? parts[0])
    : (bgPart ?? actPart ?? undefined);  // 'all' 모드 fallback (기존 로직 호환)
  const commentUnreadByKey = useMemo(() => {
    const unread: Record<string, boolean> = {};
    for (const [key, count] of Object.entries(commentCounts)) {
      if (count <= 0) continue;
      const threadKey = commentThreadKeyByCommentKey[key] ?? key;
      unread[key] = isCommentKeyUnread(commentLatestAtByKey[key], commentReadAtByKey[threadKey]);
    }
    return unread;
  }, [commentCounts, commentLatestAtByKey, commentReadAtByKey, commentThreadKeyByCommentKey]);
  const hasMergedUnreadComments = useCallback((merged: MergedScene) => {
    const bgKey = merged.bgScene && bgPart?.sheetName ? `${bgPart.sheetName}:${merged.bgScene.no}` : null;
    const actKey = merged.actScene && actPart?.sheetName ? `${actPart.sheetName}:${merged.actScene.no}` : null;
    return Boolean(
      (bgKey && commentUnreadByKey[bgKey]) ||
      (actKey && commentUnreadByKey[actKey]),
    );
  }, [actPart?.sheetName, bgPart?.sheetName, commentUnreadByKey]);
  const mergedScenePartId = currentPartId ?? bgPart?.partId ?? actPart?.partId ?? '';
  const {
    partMemos,
    partReelWorkers,
    getPartMemoText,
    getPartReelWorkerText,
    buildPartContextMenuTarget,
    savePartMemo,
    savePartReelWorker,
  } = usePartMemos({
    episodes,
    selectedDepartment,
    currentEpisodeNumber: currentEp?.episodeNumber,
    allParts,
    parts,
  });
  const handleSaveEditingPartMemo = useCallback((target: PartContextMenuTarget, memo: string) => {
    setEditingPartMemo(null);
    void savePartMemo(target, memo);
  }, [savePartMemo]);
  const handleSaveEditingPartReelWorker = useCallback((target: PartContextMenuTarget, worker: string) => {
    setEditingPartReelWorker(null);
    void savePartReelWorker(target, worker);
  }, [savePartReelWorker]);

  // 실제 부서: 개별 모드에서만 의미 있음
  const effectiveDept: Department = selectedDepartment === 'all'
    ? 'bg'
    : selectedDepartment;
  const deptConfig = DEPARTMENT_CONFIGS[effectiveDept];
  const sceneControlsCollapseKey = useMemo(
    () => buildSceneControlsCollapseKey(
      currentEp?.episodeNumber ?? null,
      selectedDepartment === 'all' ? currentPartId : currentPart?.partId ?? null,
      selectedDepartment,
    ),
    [currentEp?.episodeNumber, currentPart?.partId, currentPartId, selectedDepartment],
  );
  const sceneControlsCollapsed = sceneControlsCollapseKey
    ? (sceneControlsCollapsedByContext[sceneControlsCollapseKey] ?? false)
    : false;

  const persistSceneControlsCollapsedMap = useCallback(async (nextMap: Record<string, boolean>) => {
    const nextPrefs: UserPreferences = {
      ...(scenePrefsRef.current ?? {}),
      sceneUi: {
        ...(scenePrefsRef.current?.sceneUi ?? {}),
        controlsCollapsedByContext: nextMap,
      },
    };
    scenePrefsRef.current = nextPrefs;
    await savePreferences(nextPrefs);
    await window.electronAPI?.preferencesBroadcastChange?.({
      sceneUi: nextPrefs.sceneUi,
    });
  }, []);

  const toggleSceneControlsCollapsed = useCallback(() => {
    if (!sceneControlsCollapseKey) return;
    const nextMap = {
      ...sceneControlsCollapsedByContext,
      [sceneControlsCollapseKey]: !sceneControlsCollapsed,
    };
    setSceneControlsCollapsedByContext(nextMap);
    void persistSceneControlsCollapsedMap(nextMap);
  }, [
    persistSceneControlsCollapsedMap,
    sceneControlsCollapseKey,
    sceneControlsCollapsed,
    sceneControlsCollapsedByContext,
  ]);

  // 'all' 모드 씬 추가 타겟 시트
  const [addTargetSheet, setAddTargetSheet] = useState<string | null>(null);

  // 상세 모달 컨텍스트: sheetName + sceneIndex 추적
  const [detailContext, setDetailContext] = useState<{ sheetName: string; sceneIndex: number } | null>(null);
  const [continuitySourceElement, setContinuitySourceElement] = useState<HTMLElement | null>(null);
  const [lastCompletionUndoAction, setLastCompletionUndoAction] = useState<CompletionUndoAction | null>(null);
  const [dismissedCompletionOverlayKey, setDismissedCompletionOverlayKey] = useState<string | null>(null);
  const clearContinuitySource = useCallback(() => {
    setContinuitySourceElement(null);
  }, []);

  // 딥링크 처리: bflow://scene/sheetName/sceneId → 해당 씬 모달 자동 오픈
  // sceneId는 씬번호(예: a003) 또는 씬 인덱스(예: 12) 모두 지원
  const pendingDeepLink = useAppStore((s) => s.pendingDeepLink);
  const setPendingDeepLink = useAppStore((s) => s.setPendingDeepLink);
  const pendingReq = useAppStore((s) => s.pendingSceneModalRequest);
  const setPendingReq = useAppStore((s) => s.setPendingSceneModalRequest);
  useEffect(() => {
    if (!pendingDeepLink) return;
    const { sheetName, sceneId } = pendingDeepLink;
    console.log('[DeepLink] ScenesView 처리:', { sheetName, sceneId, episodeCount: episodes.length });

    for (const ep of episodes) {
      for (const part of ep.parts) {
        if (part.sheetName === sheetName) {
          // 1차: scene.sceneId (씬번호, 예: a003) 매칭
          let sceneIndex = part.scenes.findIndex((s) => s.sceneId === sceneId);
          // 2차: scene.no (인덱스) 매칭 — 댓글 sceneKey가 sheetName:no 형식
          if (sceneIndex < 0) {
            sceneIndex = part.scenes.findIndex((s) => String(s.no) === sceneId);
          }
          console.log('[DeepLink] 매칭 시트:', part.sheetName, '씬 인덱스:', sceneIndex);
          if (sceneIndex >= 0) {
            const matchedScene = part.scenes[sceneIndex];
            setSelectedEpisode(ep.episodeNumber);
            setSelectedPart(part.partId);
            setSelectedDepartment('all');
            setDashboardDeptFilter('all');
            setHighlightSceneId(matchedScene.sceneId);
            setPendingReq({
              sceneUuid: matchedScene.id,
              sceneName: matchedScene.sceneId,
              episodeNumber: ep.episodeNumber,
              partId: part.partId,
              initialTab: 'detail',
              forceDeptFilter: 'all',
            });
            setPendingDeepLink(null);
            return;
          }
        }
      }
    }
    console.warn('[DeepLink] 씬을 찾을 수 없음:', pendingDeepLink);
    console.warn('[DeepLink] 전체 시트:', episodes.flatMap(ep => ep.parts.map(p => p.sheetName)));
    setPendingDeepLink(null);
  }, [pendingDeepLink, episodes, setPendingDeepLink, setPendingReq, setDashboardDeptFilter, setHighlightSceneId, setSelectedDepartment, setSelectedEpisode, setSelectedPart]);

  // 댓글 카운트 로드 (currentPart 또는 bgPart/actPart 정의 후).
  // 주의: 이 함수 내부에서 invalidatePartCache 를 호출하면 'bflow:comments-invalidated' 이벤트가
  // 발화되어 아래 리스너가 다시 이 함수를 호출하는 무한 루프가 발생한다. 캐시 무효화는
  // 소스(댓글 add/edit/delete, 씬 삭제 핸들러, App.tsx Realtime 처리) 쪽에서만 책임진다.
  const reloadCommentCounts = useCallback(() => {
    const sheetsToLoad = selectedDepartment === 'all'
      ? [bgPart?.sheetName, actPart?.sheetName].filter(Boolean) as string[]
      : currentPart ? [currentPart.sheetName] : [];

    sheetsToLoad.forEach((sheetName) => {
      getCommentStoreForPart(sheetName).then((store) => {
        const currentEpisodes = useDataStore.getState().episodes;
        setCommentCounts((prev) => {
          const next = { ...prev };
          const prefix = `${sheetName}:`;
          Object.keys(next).forEach((key) => {
            if (key.startsWith(prefix)) delete next[key];
          });
          for (const [key, list] of Object.entries(store)) {
            next[key] = list.length;
          }
          return next;
        });
        setCommentIdsByKey((prev) => {
          const next = { ...prev };
          const prefix = `${sheetName}:`;
          Object.keys(next).forEach((key) => {
            if (key.startsWith(prefix)) delete next[key];
          });
          for (const [key, list] of Object.entries(store)) {
            next[key] = list.map((c) => c.id);
          }
          return next;
        });
        setCommentThreadKeyByCommentKey((prev) => {
          const next = { ...prev };
          const prefix = `${sheetName}:`;
          Object.keys(next).forEach((key) => {
            if (key.startsWith(prefix)) delete next[key];
          });
          for (const key of Object.keys(store)) {
            next[key] = buildSceneThreadKeyFromCommentKey(currentEpisodes, key);
          }
          return next;
        });
        setCommentLatestAtByKey((prev) => {
          const next = { ...prev };
          const prefix = `${sheetName}:`;
          Object.keys(next).forEach((key) => {
            if (key.startsWith(prefix)) delete next[key];
          });
          for (const [key, list] of Object.entries(store)) {
            const latestAt = currentUser?.id
              ? getLatestOtherUserCommentCreatedAt(list, currentUser.id)
              : getLatestCommentCreatedAt(list);
            if (latestAt) next[key] = latestAt;
          }
          return next;
        });
      }).catch(() => {});
    });
  }, [selectedDepartment, bgPart?.sheetName, actPart?.sheetName, currentPart?.sheetName, currentUser?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadReadState = () => {
      if (!currentUser?.id) {
        setCommentReadAtByKey({});
        return;
      }
      void getCommentReadStateForUser(currentUser.id).then((state) => {
        if (!cancelled) setCommentReadAtByKey(state);
      });
    };

    loadReadState();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== currentUser?.id) return;
      loadReadState();
    };
    window.addEventListener(COMMENT_READ_STATE_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(COMMENT_READ_STATE_EVENT, handler);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    reloadCommentCounts();
    // 이슈 F(2026-04-23): 씬 수 변화(삭제/추가/재생성)도 트리거. 재생성 시 잔존 뱃지 방지.
  }, [reloadCommentCounts, detailSceneIndex, detailContext, bgPart?.scenes.length, actPart?.scenes.length, currentPart?.scenes.length]);

  // 이슈 F-2(2026-04-23): 댓글 추가/수정/삭제로 캐시가 무효화되면 카드 뷰 뱃지도 즉시 갱신.
  // 이 시점에는 소스 쪽에서 이미 캐시를 비운 뒤이므로 재조회만 하면 된다 (invalidate 재호출 금지).
  useEffect(() => {
    const handler = () => reloadCommentCounts();
    window.addEventListener('bflow:comments-invalidated', handler);
    return () => window.removeEventListener('bflow:comments-invalidated', handler);
  }, [reloadCommentCounts]);

  // 에피소드 제목/메모 → App.tsx에서 병렬 로드됨 (글로벌 스토어)

  // 아카이빙된 에피소드 목록 로드 (마운트 시 1회만 — 이후는 syncInBackground가 갱신)
  // episodes.length 의존성 제거: deleteEpisodeOptimistic() 호출 시 재로드가 낙관적 상태를 덮어쓰는 문제 방지
  useEffect(() => {
    const loadArchived = async () => {
      try {
        const { readArchived } = await import('@/services/supabaseService');
        const list = await readArchived();
        // 아카이브 가드 활성화 상태면 낙관적 상태 보호
        if (archiveGuardRef.current) return;
        const enriched = list.map((item) => ({
          episodeNumber: item.episodeNumber,
          title: item.title,
          partCount: item.partCount,
          archivedBy: item.archivedBy || undefined,
          archivedAt: item.archivedAt || undefined,
          memo: item.archiveMemo || undefined,
        }));
        setArchivedEpisodes(enriched);
      } catch (err) {
        console.warn('[아카이빙 목록 로드 실패]', err);
      }
    };
    loadArchived();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 상세 모달에 표시할 씬 (스토어 업데이트 시 자동 갱신)
  // detailContext가 있으면 해당 시트의 씬을, 없으면 기존 방식
  const detailScene = (() => {
    if (detailContext) {
      const part = allParts.find((p) => p.sheetName === detailContext.sheetName);
      return part?.scenes[detailContext.sceneIndex] ?? null;
    }
    if (detailSceneIndex !== null) {
      return currentPart?.scenes[detailSceneIndex] ?? null;
    }
    return null;
  })();

  // 상세 모달의 sheetName / sceneIndex / department
  const detailSheetName = detailContext?.sheetName ?? currentPart?.sheetName ?? '';
  const detailSceneIdx = detailContext?.sceneIndex ?? detailSceneIndex;
  const detailDept: Department = (() => {
    if (detailContext) {
      const part = allParts.find((p) => p.sheetName === detailContext.sheetName);
      return part?.department ?? 'bg';
    }
    return effectiveDept;
  })();

  // 필터링
  let scenes = currentPart?.scenes ?? [];
  if (selectedAssignee) {
    scenes = scenes.filter((s) => sceneMatchesAssignee(s, selectedAssignee));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    scenes = scenes.filter(
      (s) =>
        (s.sceneId || '').toLowerCase().includes(q) ||
        (s.memo || '').toLowerCase().includes(q) ||
        (s.assignee || '').toLowerCase().includes(q)
    );
  }
  // 상태 필터
  if (statusFilter === 'done') {
    scenes = scenes.filter(isFullyDone);
  } else if (statusFilter === 'not-started') {
    scenes = scenes.filter(isNotStarted);
  } else if (statusFilter === 'in-progress') {
    scenes = scenes.filter((s) => !isFullyDone(s) && !isNotStarted(s));
  }
  // 정렬
  scenes = [...scenes].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'no': {
        cmp = compareScenesByNumberThenSuffix(a, b);
        break;
      }
      case 'assignee': cmp = (a.assignee || '').localeCompare(b.assignee || ''); break;
      case 'progress': cmp = sceneProgress(a) - sceneProgress(b); break;
      case 'incomplete': {
        const aLeft = 4 - [a.lo, a.done, a.review, a.png].filter(Boolean).length;
        const bLeft = 4 - [b.lo, b.done, b.review, b.png].filter(Boolean).length;
        cmp = bLeft - aLeft; // 미완료 많은 것 먼저
        break;
      }
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // 레이아웃별 그룹핑 (P1-4)
  const layoutGroups = (() => {
    if (sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, Scene[]>();
    for (const scene of scenes) {
      const lid = (scene.layoutId || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(scene);
      groups.set(key, arr);
    }
    // 정렬: 미분류를 맨 뒤로, 나머지는 번호순
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  })();

  // 씬 필터/정렬 공통 함수
  const filterAndSortScenes = useCallback((rawScenes: Scene[], options?: { applyStatusFilter?: boolean }): Scene[] => {
    const applyStatusFilter = options?.applyStatusFilter ?? true;
    let result = rawScenes;
    if (selectedAssignee) result = result.filter((s) => sceneMatchesAssignee(s, selectedAssignee));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) =>
        (s.sceneId || '').toLowerCase().includes(q) ||
        (s.memo || '').toLowerCase().includes(q) ||
        (s.assignee || '').toLowerCase().includes(q)
      );
    }
    if (applyStatusFilter) {
      if (statusFilter === 'done') result = result.filter(isFullyDone);
      else if (statusFilter === 'not-started') result = result.filter(isNotStarted);
      else if (statusFilter === 'in-progress') result = result.filter((s) => !isFullyDone(s) && !isNotStarted(s));
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'no': {
          cmp = compareScenesByNumberThenSuffix(a, b);
          break;
        }
        case 'assignee': cmp = (a.assignee || '').localeCompare(b.assignee || ''); break;
        case 'progress': cmp = sceneProgress(a) - sceneProgress(b); break;
        case 'incomplete': {
          const aLeft = 4 - [a.lo, a.done, a.review, a.png].filter(Boolean).length;
          const bLeft = 4 - [b.lo, b.done, b.review, b.png].filter(Boolean).length;
          cmp = bLeft - aLeft;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [selectedAssignee, searchQuery, statusFilter, sortKey, sortDir]);

  // 'all' 모드: bgPart/actPart의 필터/정렬된 씬
  const bgScenes = useMemo(
    () => bgPart ? filterAndSortScenes(bgPart.scenes, { applyStatusFilter: selectedDepartment !== 'all' }) : [],
    [bgPart, filterAndSortScenes, selectedDepartment],
  );
  const actScenes = useMemo(
    () => actPart ? filterAndSortScenes(actPart.scenes, { applyStatusFilter: selectedDepartment !== 'all' }) : [],
    [actPart, filterAndSortScenes, selectedDepartment],
  );

  // 'all' 모드: BG+ACT 씬 머지
  const { allMergedScenes, mergedScenes: searchFilteredMergedScenes, detailMerged, setDetailMerged } = useUnifiedScenes({
    selectedDepartment,
    bgPart,
    actPart,
    bgScenes,
    actScenes,
    mergedScenePartId,
    sortKey,
    sortDir,
  });
  const mergedScenes = useMemo(
    () => selectedDepartment === 'all'
      ? searchFilteredMergedScenes.filter((merged) => mergedMatchesStatusFilter(merged, statusFilter))
      : searchFilteredMergedScenes,
    [searchFilteredMergedScenes, selectedDepartment, statusFilter],
  );
  // 'all' 모드: 화면에 실제 표시되는 병합 카드 기준 진행률
  const allModeScenes = useMemo(
    () => mergedScenes.flatMap((merged) => [merged.bgScene, merged.actScene].filter((scene): scene is Scene => Boolean(scene))),
    [mergedScenes],
  );

  // v1.18.0: 알림 패널에서 디스패치한 'bflow:open-scene-modal' → 모달 자동 오픈 + 탭/포커스.
  // sceneUuid/sceneName 기반으로 mergedScenes 또는 currentPart.scenes 에서 매칭.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        sceneUuid?: string;
        sceneName?: string;
        episodeNumber?: number;
        partId?: string;
        initialTab?: 'detail' | 'revisions' | 'files' | 'history';
        focusRevisionId?: string;
        focusCommentId?: string;
        focusRevisionCommentId?: string;
      } | undefined;
      if (!detail) return;

      // 통합 모드 (selectedDepartment === 'all') 면 mergedScenes 에서 매칭
      if (selectedDepartment === 'all') {
        const target = allMergedScenes.find((m) =>
          (m.bgScene?.id && m.bgScene.id === detail.sceneUuid)
          || (m.actScene?.id && m.actScene.id === detail.sceneUuid)
          || (detail.sceneName && m.sceneId === detail.sceneName),
        );
        if (target) {
          setDetailMerged(target);
          setModalRouting({
            initialTab: detail.initialTab,
            focusRevisionId: detail.focusRevisionId,
            focusCommentId: detail.focusCommentId,
            focusRevisionCommentId: detail.focusRevisionCommentId,
          });
        }
        return;
      }

      // 단일 부서 모드 — currentPart.scenes 에서 인덱스 찾기
      if (currentPart) {
        const idx = currentPart.scenes.findIndex((s) =>
          (detail.sceneUuid && s.id === detail.sceneUuid)
          || (detail.sceneName && s.sceneId === detail.sceneName),
        );
        if (idx >= 0) {
          setDetailSceneIndex(idx);
          setModalRouting({
            initialTab: detail.initialTab,
            focusRevisionId: detail.focusRevisionId,
            focusCommentId: detail.focusCommentId,
            focusRevisionCommentId: detail.focusRevisionCommentId,
          });
        }
      }
    };
    window.addEventListener('bflow:open-scene-modal', handler);
    return () => window.removeEventListener('bflow:open-scene-modal', handler);
  }, [selectedDepartment, allMergedScenes, currentPart, setDetailMerged]);

  // 코덱스 P1 fix (2026-05-05): pendingSceneModalRequest store 기반 처리.
  // CustomEvent 패턴은 다른 뷰에서 dispatch 시 ScenesView 미마운트면 listener 없어 손실됨.
  // store 사용 시 ScenesView 마운트 후 첫 tick 에서 useEffect 로 안정적 처리.
  // 코덱스 P2 fix (3차, 2026-05-05): pending 의 episodeNumber/partId 가 현재 선택과 다르면
  // 먼저 selectedEpisode/selectedPart 를 변경 → 다음 render 의 새 currentPart/mergedScenes 로 매칭.
  useEffect(() => {
    if (!pendingReq) return;
    const detail = pendingReq;

    // v1.24.0: forceDeptFilter — 점프 시 부서 토글 강제 (최근 작업 위젯 → 'all').
    if (detail.forceDeptFilter && detail.forceDeptFilter !== selectedDepartment) {
      setSelectedDepartment(detail.forceDeptFilter);
      setDashboardDeptFilter(detail.forceDeptFilter);
      return; // 다음 render 까지 대기
    }

    // 1) episode/part 컨텍스트 먼저 정렬 (다른 EP/Part 점프 시)
    if (detail.episodeNumber !== undefined && selectedEpisode !== detail.episodeNumber) {
      setSelectedEpisode(detail.episodeNumber);
      return; // 다음 render 까지 대기
    }
    if (detail.partId && !partIdMatches(selectedPart, detail.partId)) {
      setSelectedPart(detail.partId);
      return; // 다음 render 까지 대기
    }

    // 2) 컨텍스트 일치 — 매칭 시도
    let matchedPendingSceneRequest = false;
    if (selectedDepartment === 'all') {
      const target = allMergedScenes.find((m) =>
        (m.bgScene?.id && m.bgScene.id === detail.sceneUuid)
        || (m.actScene?.id && m.actScene.id === detail.sceneUuid)
        || (detail.sceneName && m.sceneId === detail.sceneName),
      );
      if (target) {
        matchedPendingSceneRequest = true;
        setDetailMerged(target);
        setModalRouting({
          initialTab: detail.initialTab,
          focusRevisionId: detail.focusRevisionId,
          focusCommentId: detail.focusCommentId,
          focusRevisionCommentId: detail.focusRevisionCommentId,
        });
        setPendingReq(null);
        return;
      }
      if (allMergedScenes.length === 0) {
        return;
      }
      if (!matchedPendingSceneRequest) {
        console.warn('[ScenesView] pending scene modal request target not found:', detail);
        setPendingReq(null);
      }
      return;
    }

    if (currentPart) {
      const idx = currentPart.scenes.findIndex((s) =>
        (detail.sceneUuid && s.id === detail.sceneUuid)
        || (detail.sceneName && s.sceneId === detail.sceneName),
      );
      if (idx >= 0) {
        matchedPendingSceneRequest = true;
        setDetailSceneIndex(idx);
        setModalRouting({
          initialTab: detail.initialTab,
          focusRevisionId: detail.focusRevisionId,
          focusCommentId: detail.focusCommentId,
          focusRevisionCommentId: detail.focusRevisionCommentId,
        });
        setPendingReq(null);
        return;
      }
    }
    if (!currentPart || currentPart.scenes.length === 0) {
      return;
    }
    if (!matchedPendingSceneRequest) {
      console.warn('[ScenesView] pending scene modal request target not found:', detail);
      setPendingReq(null);
    }
  }, [pendingReq, selectedDepartment, selectedEpisode, selectedPart, allMergedScenes, currentPart, setDetailMerged, setPendingReq, setSelectedEpisode, setSelectedPart, setSelectedDepartment, setDashboardDeptFilter]);

  // ACT 단독 뷰에서는 대응하는 BG 이미지를 폴백으로 사용한다.
  const actToBgImageMap = useMemo(() => {
    if (selectedDepartment !== 'acting') return null;
    const bgSibling = findPartById(allParts, currentPart?.partId, 'bg');
    if (!bgSibling) return null;
    const map = new Map<string, { storyboard?: string; guide?: string }>();
    for (const bgScene of bgSibling.scenes) {
      const key = normalizeSceneIdKey(bgScene.sceneId, bgSibling.partId);
      if (!key) continue;
      map.set(key, { storyboard: bgScene.storyboardUrl, guide: bgScene.guideUrl });
    }
    return map;
  }, [selectedDepartment, allParts, currentPart?.partId]);

  // 전체뷰 레이아웃 그룹핑
  const mergedLayoutGroups = useMemo(() => {
    if (selectedDepartment !== 'all' || sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, MergedScene[]>();
    for (const ms of mergedScenes) {
      const lid = ((ms.bgScene?.layoutId || ms.actScene?.layoutId) || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(ms);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  }, [mergedScenes, selectedDepartment, sceneGroupMode]);

  // 담당자 목록 (현재 파트 기준)
  const assignees = Array.from(
    new Set(
      (selectedDepartment === 'all'
        ? [...(bgPart?.scenes ?? []), ...(actPart?.scenes ?? [])]
        : (currentPart?.scenes ?? [])
      ).flatMap((s) => parseAssigneeNames(s.assignee))
    )
  );
  const assigneeOptions = useMemo(() => {
    const currentName = currentUser?.name?.trim();
    const names = assignees.filter((name): name is string => !!name);
    const options: { value: string; label: string; sublabel?: string; separatorAfter?: boolean }[] = [];

    if (currentName) {
      options.push({
        value: currentName,
        label: '내 할일만',
        sublabel: currentName,
        separatorAfter: names.some((name) => name !== currentName),
      });
    }

    names
      .filter((name) => name !== currentName)
      .forEach((name) => {
        options.push({ value: name, label: name });
      });

    return options;
  }, [assignees, currentUser?.name]);

  // 전체 진행도 (필터 기준)
  const activeScenes = selectedDepartment === 'all' ? allModeScenes : scenes;
  const totalChecks = activeScenes.length * 4;
  const doneChecks = activeScenes.reduce(
    (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length,
    0
  );
  const overallPct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;
  const partCompletionState = useMemo(
    () => (selectedDepartment === 'all'
      ? getAllViewCompletionState(allMergedScenes)
      : getSingleViewCompletionState(currentPart?.scenes ?? [])),
    [allMergedScenes, currentPart?.scenes, selectedDepartment],
  );
  const isVisibleComplete = partCompletionState.isComplete;
  const visibleCompletedMeta = useMemo(
    () => formatCompletedMeta(
      partCompletionState.completedMeta?.completedAt,
      partCompletionState.completedMeta?.completedBy,
    ),
    [partCompletionState.completedMeta],
  );
  const completionOverlayKey = useMemo(() => {
    if (!isVisibleComplete) return null;
    return [
      selectedEpisode ?? '__episode__',
      selectedPart ?? '__part__',
      selectedDepartment,
      partCompletionState.completedMeta?.completedBy ?? '__unknown__',
      partCompletionState.completedMeta?.completedAt ?? '__time__',
    ].join(':');
  }, [
    isVisibleComplete,
    partCompletionState.completedMeta?.completedAt,
    partCompletionState.completedMeta?.completedBy,
    selectedDepartment,
    selectedEpisode,
    selectedPart,
  ]);
  useEffect(() => {
    if (!completionOverlayKey) setDismissedCompletionOverlayKey(null);
  }, [completionOverlayKey]);
  const showCompletionOverlay = Boolean(isVisibleComplete && completionOverlayKey !== dismissedCompletionOverlayKey);
  const showCompletionRestoreButton = Boolean(
    isVisibleComplete
    && completionOverlayKey
    && completionOverlayKey === dismissedCompletionOverlayKey,
  );
  const canUndoLastCompletionAction = useMemo(() => {
    if (!lastCompletionUndoAction) return false;
    const undoTarget: CompletionCelebrationTarget = {
      sheetName: lastCompletionUndoAction.sheetName,
      sceneId: lastCompletionUndoAction.sceneId,
      sceneUuid: lastCompletionUndoAction.sceneUuid ?? null,
      sceneIndex: lastCompletionUndoAction.sceneIndex,
    };
    if (selectedDepartment === 'all') {
      return mergedScenes.some((merged) =>
        matchesMergedSceneCelebration(merged, undoTarget, bgPart?.sheetName ?? null, actPart?.sheetName ?? null),
      );
    }
    return scenes.some((scene) => {
      const rawIndex = currentPart?.scenes.indexOf(scene) ?? -1;
      return matchesSceneCelebration(currentPart?.sheetName, scene, rawIndex, undoTarget);
    });
  }, [actPart?.sheetName, bgPart?.sheetName, currentPart?.scenes, currentPart?.sheetName, lastCompletionUndoAction, mergedScenes, scenes, selectedDepartment]);
  const sceneControlsSummary = useMemo(() => {
    const items = [
      { label: '작업자', value: selectedAssignee ?? '전체' },
      { label: '상태', value: STATUS_FILTER_LABELS[statusFilter] },
      { label: '정렬', value: `${SORT_KEY_LABELS[sortKey]} ${sortDir === 'asc' ? '오름차순' : '내림차순'}` },
      { label: '배치', value: SCENE_GROUP_MODE_LABELS[sceneGroupMode] },
      { label: '보기', value: SCENE_VIEW_MODE_LABELS[sceneViewMode] },
    ];
    if (searchQuery.trim()) {
      items.push({ label: '검색', value: searchQuery.trim() });
    }
    return items;
  }, [sceneGroupMode, sceneViewMode, searchQuery, selectedAssignee, sortDir, sortKey, statusFilter]);

  // 다음 에피소드 번호 계산
  const nextEpisodeNumber = episodes.length > 0
    ? Math.max(...episodes.map((ep) => ep.episodeNumber)) + 1
    : 1;

  // 다음 파트 ID 계산 (현재 부서의 파트 기준, 중복 방지)
  // 다음 파트 ID 계산 (unique partId 기준, 중복 방지)
  const nextPartId = useMemo(() => {
    if (!currentEp || uniquePartIds.length === 0) return 'A';
    const existingIds = new Set(uniquePartIds);
    let candidate = String.fromCharCode(Math.max(...uniquePartIds.map((id) => id.charCodeAt(0))) + 1);
    while (existingIds.has(candidate) && candidate <= 'Z') {
      candidate = String.fromCharCode(candidate.charCodeAt(0) + 1);
    }
    return candidate;
  }, [currentEp, uniquePartIds]);

  // ─── 핸들러들 ─────────────────────────────────

  // 토글 직렬화 큐: 빠른 연속 토글 시 race condition 방지
  const toggleQueueRef = useRef<Promise<void>>(Promise.resolve());

  // 공통 토글 로직 (sheetName 파라미터)
  const handleToggleForSheet = (
    sheetName: string,
    sceneId: string,
    stage: Stage,
    options?: { skipCompletionUndoCapture?: boolean; sceneUuid?: string | null; sceneIndex?: number },
  ) => {
    if (!currentEp) return;

    // 현재 스토어에서 최신 씬 상태 직접 조회 (stale closure 방지)
    const latestPart = useDataStore.getState().episodes
      .flatMap((ep) => ep.parts)
      .find((p) => p.sheetName === sheetName);
    if (!latestPart) return;

    const sceneIndex = findCompletionSceneIndex(latestPart.scenes, {
      sceneId,
      sceneUuid: options?.sceneUuid ?? null,
      sceneIndex: options?.sceneIndex,
    });
    if (sceneIndex < 0) return;
    const scene = latestPart.scenes[sceneIndex];

    const stagePatch = buildSequentialStagePatch(scene, stage);
    const changedStages = getChangedSequentialStages(scene, stagePatch);
    if (changedStages.length === 0) return;
    const prevAssigneeProgress = scene.assigneeProgress;

    const completionMeta = (() => {
      const prevCompletedBy = scene.completedBy ?? '';
      const prevCompletedAt = scene.completedAt ?? '';
      const wasAllDone = isSequentialStageComplete(scene);
      const willBeAllDone = isSequentialStageComplete(stagePatch);

      if (!wasAllDone && willBeAllDone) {
        return {
          nextCompletedBy: currentUser?.name ?? '알 수 없음',
          nextCompletedAt: new Date().toISOString(),
          prevCompletedBy,
          prevCompletedAt,
        };
      }
      if (wasAllDone && !willBeAllDone) {
        if (!prevCompletedBy && !prevCompletedAt) return null;
        return {
          nextCompletedBy: '',
          nextCompletedAt: '',
          prevCompletedBy,
          prevCompletedAt,
        };
      }
      return null;
    })();

    // 낙관적 업데이트 — 즉시 UI 반영
    changedStages.forEach((changedStage) => {
      if (scene.id) {
        updateSceneByUuid(scene.id, { [changedStage]: stagePatch[changedStage] });
      } else {
        setSceneStageValue(sheetName, sceneId, changedStage, stagePatch[changedStage]);
      }
    });

    // 완료 축하 애니메이션 + 완료 기록: 방금 토글로 4단계 모두 완료 시
    if (completionMeta) {
      if (completionMeta.nextCompletedBy && completionMeta.nextCompletedAt) {
        setCelebratingTarget(buildCompletionTarget(sheetName, scene, sceneIndex));
        if (!options?.skipCompletionUndoCapture) {
          setLastCompletionUndoAction({
            kind: 'stage',
            sheetName,
            sceneId,
            sceneUuid: scene.id ?? null,
            sceneIndex,
            stage,
          });
        }
      }
      updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', completionMeta.nextCompletedBy);
      updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', completionMeta.nextCompletedAt);
    }

    // v1.25.0~ 액팅 씬이면 sceneState/round 도 reverse mapping 으로 자동 동기화 (시트뷰 호환)
    // legacy boolean 4개의 누적 체크 상태로 새 단계 추정. 차수는 prev state 가 같으면 유지, 다르면 1차.
    const isActingScene = sheetName.endsWith('_ACT');
    let actingPhaseSync: { state: ScenePhaseState; workRound: number; feedbackRound: number } | null = null;
    if (isActingScene && scene.id) {
      const newPhase: ScenePhaseState =
        stagePatch.png ? 'done'
        : stagePatch.review ? 'feedback'
        : stagePatch.done ? 'work'
        : 'wait';
      const prevPhase: ScenePhaseState = scene.sceneState ?? 'wait';
      const work = newPhase === 'work'
        ? (prevPhase === 'work' ? Math.max(1, scene.workRound ?? 1) : 1)
        : 0;
      const feedback = newPhase === 'feedback'
        ? (prevPhase === 'feedback' ? Math.max(1, scene.feedbackRound ?? 1) : 1)
        : 0;
      actingPhaseSync = { state: newPhase, workRound: work, feedbackRound: feedback };
      updateSceneByUuid(scene.id, {
        sceneState: newPhase,
        workRound: work,
        feedbackRound: feedback,
        ...legacyStagesFor(newPhase),
      });
    }

    const nextAssigneeProgress = scene.id && hasMultiAssigneeProgress(scene)
      ? updateAllAssigneeProgressEntries(
          scene,
          isActingScene && actingPhaseSync
            ? {
                kind: 'phase',
                state: actingPhaseSync.state,
                workRound: actingPhaseSync.workRound,
                feedbackRound: actingPhaseSync.feedbackRound,
              }
            : { kind: 'stagePatch', patch: stagePatch },
          currentUser?.name,
        )
      : null;
    if (scene.id && nextAssigneeProgress) {
      updateSceneByUuid(scene.id, { assigneeProgress: nextAssigneeProgress });
    }

    // API 호출을 큐에 넣어 순차 실행 (race condition 방지)
    toggleQueueRef.current = toggleQueueRef.current.then(async () => {
      try {
        for (const changedStage of changedStages) {
          if (scene.id) {
            await updateCellByUuid(scene.id, changedStage, stagePatch[changedStage], currentUser?.id);
          } else {
            await updateCell(sheetName, sceneIndex, changedStage, stagePatch[changedStage], currentUser?.id);
          }
          window.electronAPI?.dataNotifyChange?.({
            type: 'toggle',
            sheetName,
            sceneId,
            field: changedStage,
            value: stagePatch[changedStage],
          });
        }
        // 액팅 phase reverse dual-write — stage 저장 성공 후 새 컬럼도 동기화
        if (actingPhaseSync && scene.id) {
          try {
            await updateScenePhaseInSupabase(
              scene.id,
              actingPhaseSync.state,
              actingPhaseSync.workRound,
              actingPhaseSync.feedbackRound,
              currentUser?.id,
            );
          } catch (phaseErr) {
            console.warn('[액팅 phase 동기화 실패 — legacy stage 는 저장됨]', phaseErr);
          }
        }
        if (scene.id && nextAssigneeProgress) {
          try {
            await writeAssigneeProgressMetadata(scene.id, nextAssigneeProgress);
          } catch (progressErr) {
            console.error('[ScenesView] 담당자별 진행 저장 실패:', progressErr);
            sonnerToast.error('담당자별 진행 저장에 실패했습니다.');
            updateSceneByUuid(scene.id, { assigneeProgress: prevAssigneeProgress });
            syncInBackground();
          }
        }
      } catch (err) {
        console.error('[토글 실패]', err);
        changedStages.forEach((changedStage) => {
          setSceneStageValue(sheetName, sceneId, changedStage, Boolean(scene[changedStage]));
        });
        if (completionMeta) {
          updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', completionMeta.prevCompletedBy);
          updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', completionMeta.prevCompletedAt);
        }
        // 액팅 phase 도 롤백
        if (actingPhaseSync) {
          setScenePhaseOptimistic(sheetName, sceneId, scene.sceneState ?? 'wait');
        }
        if (scene.id && nextAssigneeProgress) {
          updateSceneByUuid(scene.id, { assigneeProgress: prevAssigneeProgress });
        }
        return;
      }

      if (completionMeta) {
        try {
          await updateSceneCompletionMeta(
            sheetName,
            sceneIndex,
            completionMeta.nextCompletedBy && completionMeta.nextCompletedAt
              ? {
                  completedBy: completionMeta.nextCompletedBy,
                  completedAt: completionMeta.nextCompletedAt,
                }
              : null,
          );
        } catch (metaErr) {
          console.error('[완료 메타 저장 실패]', metaErr);
          syncInBackground();
        }
      }
    });
  };

  // 기존 호환: currentPart의 sheetName 사용
  const handleToggle = (sceneId: string, stage: Stage, sceneUuid?: string | null, sceneIndex?: number) => {
    if (!currentPart) return;
    handleToggleForSheet(currentPart.sheetName, sceneId, stage, { sceneUuid, sceneIndex });
  };

  const handleUndoLastCompletionAction = useCallback(() => {
    const action = lastCompletionUndoAction;
    if (!action) return;
    const latestPart = useDataStore.getState().episodes
      .flatMap((ep) => ep.parts)
      .find((part) => part.sheetName === action.sheetName);
    const latestSceneIndex = latestPart
      ? findCompletionSceneIndex(latestPart.scenes, action)
      : -1;
    const latestScene = latestSceneIndex >= 0 ? latestPart?.scenes[latestSceneIndex] : undefined;

    if (action.kind === 'stage') {
      if (!latestScene?.[action.stage]) {
        setLastCompletionUndoAction(null);
        return;
      }
      setLastCompletionUndoAction(null);
      handleToggleForSheet(action.sheetName, action.sceneId, action.stage, {
        skipCompletionUndoCapture: true,
        sceneUuid: action.sceneUuid ?? null,
        sceneIndex: action.sceneIndex,
      });
      return;
    }

    if (!latestScene?.id || latestSceneIndex < 0) {
      setLastCompletionUndoAction(null);
      return;
    }

    setLastCompletionUndoAction(null);
    const legacy = legacyStagesFor(action.previousState);
    updateSceneByUuid(latestScene.id, {
      sceneState: action.previousState,
      workRound: action.previousWorkRound,
      feedbackRound: action.previousFeedbackRound,
      ...legacy,
      completedBy: action.previousCompletedBy,
      completedAt: action.previousCompletedAt,
    });

    void (async () => {
      try {
        await updateScenePhaseInSupabase(
          latestScene.id!,
          action.previousState,
          action.previousWorkRound,
          action.previousFeedbackRound,
          currentUser?.id,
        );
        await updateSceneCompletionMeta(
          action.sheetName,
          latestSceneIndex,
          action.previousCompletedBy && action.previousCompletedAt
            ? {
                completedBy: action.previousCompletedBy,
                completedAt: action.previousCompletedAt,
              }
            : null,
        );
      } catch (err) {
        console.error('[완료 취소 실패]', err);
        sonnerToast.error('마지막 완료 취소 저장에 실패했습니다. 새로고침 후 다시 확인해주세요.');
      }
    })();
  }, [currentUser?.id, lastCompletionUndoAction, updateSceneByUuid]);

  // 일괄 stage 토글: 선택된 씬들을 RPC 한 번에 처리 (Tasks 13-17)
  const handleBulkStageToggle = async (stage: Stage, onlyDept?: 'bg' | 'acting') => {
    const targetScenes = resolveSelectedScenes(selectedSceneIds, allMergedScenes, onlyDept, currentPart);
    if (targetScenes.length === 0) return;

    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name ?? '알 수 없음';

    const updates: BulkStageUpdate[] = [];
    const completedMetaByUuid = new Map<string, { completedBy: string; completedAt: string }>();
    const stagePatchByUuid = new Map<string, Partial<Record<Stage, boolean>>>();
    const bulkAssigneeProgressByUuid = new Map<string, SceneAssigneeProgressMap>();
    const isActingBulkTarget = (onlyDept ?? (selectedDepartment === 'acting' ? 'acting' : 'bg')) === 'acting';

    for (const s of targetScenes) {
      if (!s.id) continue;

      const stagePatch = buildSequentialStagePatch(s, stage);
      const changedStages = getChangedSequentialStages(s, stagePatch);
      if (changedStages.length === 0) continue;

      const wasAllDone = isSequentialStageComplete(s);
      const willBeAllDone = isSequentialStageComplete(stagePatch);

      // 완료 메타 시맨틱 (BulkStageUpdate 주석 참조):
      // - 4단계 전체 미완료 → 완료: actor/now UPSERT
      // - 4단계 전체 완료 → 해제: null 전파하여 metadata 행 DELETE
      // - 그 외(완료 상태가 바뀌지 않는 토글): undefined로 남겨 메타 건드리지 않음
      let completedBy: string | null | undefined;
      let completedAt: string | null | undefined;
      if (!wasAllDone && willBeAllDone) {
        completedBy = actorName;
        completedAt = nowIso;
      } else if (wasAllDone && !willBeAllDone) {
        completedBy = null;
        completedAt = null;
      }

      const sceneStagePatch: Partial<Record<Stage, boolean>> = {};
      changedStages.forEach((changedStage, index) => {
        sceneStagePatch[changedStage] = stagePatch[changedStage];
        const update: BulkStageUpdate = {
          sceneUuid: s.id!, // resolveSelectedScenes가 id 있는 것만 반환
          stage: changedStage,
          value: stagePatch[changedStage],
        };
        if (index === 0) {
          if (completedBy !== undefined) update.completedBy = completedBy;
          if (completedAt !== undefined) update.completedAt = completedAt;
        }
        updates.push(update);
      });
      stagePatchByUuid.set(s.id, sceneStagePatch);

      if (hasMultiAssigneeProgress(s)) {
        const nextProgress = isActingBulkTarget
          ? updateAllAssigneeProgressEntries(
              s,
              { kind: 'phase', state: phaseFromStage(stage) },
              currentUser?.name,
            )
          : updateAllAssigneeProgressEntries(
              s,
              { kind: 'stagePatch', patch: stagePatch },
              currentUser?.name,
            );
        bulkAssigneeProgressByUuid.set(s.id, nextProgress);
      }
    }

    if (updates.length === 0) return;

    // 로컬 store 반영용 맵 — null(해제)은 빈 문자열로, string(설정)은 값 그대로
    for (const u of updates) {
      if (u.completedBy === null && u.completedAt === null) {
        completedMetaByUuid.set(u.sceneUuid, { completedBy: '', completedAt: '' });
      } else if (u.completedBy && u.completedAt) {
        completedMetaByUuid.set(u.sceneUuid, { completedBy: u.completedBy, completedAt: u.completedAt });
      }
    }

    const targetUuids = Array.from(new Set(updates.map((u) => u.sceneUuid)));
    const coalesceBulkStageResults = (
      requestedUuids: string[],
      results: BulkUpdateResult[],
    ): BulkUpdateResult[] => {
      const byUuid = new Map<string, BulkUpdateResult>(
        requestedUuids.map((sceneUuid) => [sceneUuid, { sceneUuid, success: true }]),
      );
      for (const result of results) {
        if (!result.success) {
          byUuid.set(result.sceneUuid, result);
        }
      }
      return requestedUuids.map((sceneUuid) => byUuid.get(sceneUuid) ?? { sceneUuid, success: true });
    };

    await runBulkOp(
      'stage-toggle',
      targetUuids,
      // retry 시 전달받은 uuids 부분집합만 재전송 (이미 성공한 씬의 값 덮어쓰기 방지)
      async (uuidsToSend) => {
        const set = new Set(uuidsToSend);
        const subset = updates.filter((u) => set.has(u.sceneUuid));
        const results = await bulkUpdateSceneStages(subset, currentUser?.id ?? '');
        const coalesced = coalesceBulkStageResults(uuidsToSend, results);
        return Promise.all(
          coalesced.map(async (result) => {
            const nextProgress = bulkAssigneeProgressByUuid.get(result.sceneUuid);
            if (!result.success || !nextProgress) return result;
            try {
              await writeAssigneeProgressMetadata(result.sceneUuid, nextProgress);
              return result;
            } catch (err) {
              const message = err instanceof Error ? err.message : 'assignee progress metadata failed';
              return { sceneUuid: result.sceneUuid, success: false, error: message };
            }
          }),
        );
      },
      { targetStage: stage, completedMetaByUuid, stagePatchByUuid, assigneeProgressByUuid: bulkAssigneeProgressByUuid },
    );
  };

  // v1.27.0: 통합 뷰 일괄 액션 바 — 액팅 씬을 한꺼번에 특정 phase 로 설정.
  // 토글이 아닌 SET — 여러 씬이 다른 phase 일 수 있으므로 토글은 의미가 모호.
  // 동작:
  //   1. 선택된 씬 중 ACT 부서만 추출 (BG 는 무시).
  //   2. 각 씬에 대해 handleActPhaseStateClick 와 동일한 round 계산 규칙 적용.
  //      legacy boolean (lo/done/review/png) 도 함께 dual-write — calcStats 등 split state 방지.
  //      코덱스 1차 P1 #2 fix.
  //   3. 씬별 *이전* 값 (sceneState/workRound/feedbackRound + legacy 4 boolean) 캡처 — 실패 롤백용.
  //      코덱스 1차 P1 #1 fix: executor 안 try/catch 에서 실패 씬은 prev 로 store 재패치.
  //   4. runBulkOp 로 store + 토스트 통합. executor 는 updateScenePhaseInSupabase 를 N 회 호출.
  //   5. 성공 항목마다 useDataStore 의 phasePatch 적용.
  const handleBulkActPhaseSet = async (phase: ScenePhaseState) => {
    const targetScenes = resolveSelectedScenes(selectedSceneIds, allMergedScenes, 'acting', currentPart);
    if (targetScenes.length === 0) return;

    // 씬별 새 phase patch + 이전 값 캡처. ActPhasePatch 는 bulkOperations.ts 정의.
    const phasePatchByUuid = new Map<string, ActPhasePatch>();
    const prevByUuid = new Map<string, ActPhasePatch>();
    const phaseCompletionMetaByUuid = new Map<string, { completedBy: string; completedAt: string }>();
    const phaseCompletionLocationByUuid = new Map<string, { sheetName: string; sceneIndex: number }>();
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name ?? '알 수 없음';
    for (const s of targetScenes) {
      if (!s.id) continue;
      const prevState: ScenePhaseState = s.sceneState ?? 'wait';
      const prevWork = s.workRound ?? 0;
      const prevFb = s.feedbackRound ?? 0;
      const prevCompletedBy = s.completedBy ?? '';
      const prevCompletedAt = s.completedAt ?? '';
      // 롤백용 — 코덱스 1차 P1 #1 fix.
      prevByUuid.set(s.id, {
        sceneState: prevState,
        workRound: prevWork,
        feedbackRound: prevFb,
        lo: s.lo,
        done: s.done,
        review: s.review,
        png: s.png,
        assigneeProgress: s.assigneeProgress,
        completedBy: prevCompletedBy,
        completedAt: prevCompletedAt,
      });

      let workRound = prevWork;
      let feedbackRound = prevFb;
      if (phase === 'wait' || phase === 'done') {
        workRound = 0;
        feedbackRound = 0;
      } else if (phase === 'work') {
        if (prevState === 'feedback') workRound = Math.min(99, prevFb + 1);
        else if (prevState !== 'work') workRound = Math.max(1, Math.min(99, prevWork || 1));
      } else if (phase === 'feedback') {
        if (prevState === 'work') feedbackRound = Math.min(99, prevWork);
        else if (prevState !== 'feedback') feedbackRound = Math.max(1, Math.min(99, prevFb || 1));
      }
      // 코덱스 1차 P1 #2 fix: legacy lo/done/review/png 도 dual-write.
      // setScenePhaseOptimistic 의 legacyStagesFor 매핑과 동일.
      const legacy = legacyStagesFor(phase);
      const phasePatch: ActPhasePatch = {
        sceneState: phase,
        workRound,
        feedbackRound,
        lo: legacy.lo,
        done: legacy.done,
        review: legacy.review,
        png: legacy.png,
      };

      const wasFullyDone = Boolean(s.lo && s.done && s.review && s.png);
      const willBeFullyDone = phase === 'done';
      let nextCompletedBy: string | undefined;
      let nextCompletedAt: string | undefined;
      if (!wasFullyDone && willBeFullyDone) {
        nextCompletedBy = actorName;
        nextCompletedAt = nowIso;
      } else if (wasFullyDone && !willBeFullyDone && (prevCompletedBy || prevCompletedAt)) {
        nextCompletedBy = '';
        nextCompletedAt = '';
      }
      if (nextCompletedBy !== undefined && nextCompletedAt !== undefined) {
        phasePatch.completedBy = nextCompletedBy;
        phasePatch.completedAt = nextCompletedAt;
        phaseCompletionMetaByUuid.set(s.id, { completedBy: nextCompletedBy, completedAt: nextCompletedAt });
        const location = findSceneLocationByUuid(s.id);
        if (location) phaseCompletionLocationByUuid.set(s.id, location);
      }
      if (hasMultiAssigneeProgress(s)) {
        const nextProgress = updateAllAssigneeProgressEntries(
          s,
          { kind: 'phase', state: phase, workRound, feedbackRound },
          currentUser?.name,
        );
        phasePatch.assigneeProgress = nextProgress;
      }

      phasePatchByUuid.set(s.id, phasePatch);
    }

    const uuids = targetScenes.filter((s) => s.id).map((s) => s.id!);

    // 낙관적 업데이트 — 각 씬에 즉시 새 phase + legacy 반영 (Supabase 응답 전).
    for (const [uuid, patch] of phasePatchByUuid) {
      updateSceneByUuid(uuid, patch);
    }

    await runBulkOp(
      'act-phase-set',
      uuids,
      async (uuidsToSend) => {
        // 단일 씬용 IPC 를 병렬 호출 후 BulkUpdateResult[] 로 합성.
        // 실패 씬은 store 에서 즉시 prev 값으로 롤백 (코덱스 1차 P1 #1).
        const results = await Promise.all(
          uuidsToSend.map(async (uuid) => {
            const patch = phasePatchByUuid.get(uuid);
            if (!patch) return { sceneUuid: uuid, success: false, error: 'missing patch' };
            try {
              await updateScenePhaseInSupabase(
                uuid,
                patch.sceneState,
                patch.workRound,
                patch.feedbackRound,
                currentUser?.id,
              );
              const completionMeta = phaseCompletionMetaByUuid.get(uuid);
              if (completionMeta) {
                const location = phaseCompletionLocationByUuid.get(uuid) ?? findSceneLocationByUuid(uuid);
                if (location) {
                  try {
                    await updateSceneCompletionMeta(
                      location.sheetName,
                      location.sceneIndex,
                      completionMeta.completedBy && completionMeta.completedAt
                        ? {
                            completedBy: completionMeta.completedBy,
                            completedAt: completionMeta.completedAt,
                          }
                        : null,
                    );
                  } catch (metaErr) {
                    console.error('[액팅 일괄 완료 메타 저장 실패]', metaErr);
                  }
                } else {
                  console.warn('[액팅 일괄 완료 메타 저장 스킵 — 씬 위치를 찾을 수 없음]', uuid);
                }
              }
              if (patch.assigneeProgress) {
                try {
                  await writeAssigneeProgressMetadata(uuid, patch.assigneeProgress);
                } catch (progressErr) {
                  const prev = prevByUuid.get(uuid);
                  if (prev) updateSceneByUuid(uuid, { assigneeProgress: prev.assigneeProgress });
                  const message = progressErr instanceof Error ? progressErr.message : 'assignee progress metadata failed';
                  return { sceneUuid: uuid, success: false, error: message };
                }
              }
              return { sceneUuid: uuid, success: true };
            } catch (err) {
              const message = err instanceof Error ? err.message : 'unknown error';
              // 실패 시 즉시 prev 값으로 store 롤백 — stale state 영구화 방지.
              const prev = prevByUuid.get(uuid);
              if (prev) updateSceneByUuid(uuid, prev);
              return { sceneUuid: uuid, success: false, error: message };
            }
          }),
        );
        return results;
      },
      { targetPhase: phase, phasePatchByUuid },
    );
  };

  // 일괄 삭제: ConfirmDialog → RPC 경유, runBulkOp가 낙관적 제거 처리 (Tasks 13-17)
  // v1.25.12: 카운트는 사용자 보는 단위(머지드 카드)로 표기 — 내부 row 수 X.
  const handleBulkDelete = async () => {
    const uuids = resolveSelectedUuids(selectedSceneIds, allMergedScenes, currentPart);
    if (uuids.length === 0) return;

    const sceneCount = countSelectedScenes(selectedSceneIds, allMergedScenes, currentPart);
    const isUnified = selectedDepartment === 'all';
    const suffix = isUnified ? ' (BG·액팅 양쪽 적용)' : '';

    const ok = await ConfirmDialog.show({
      message: `씬 ${sceneCount}개를 삭제하시겠습니까?${suffix}`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!ok) return;

    await runBulkOp(
      'delete',
      uuids,
      (list) => bulkDeleteScenes(list, currentUser?.id ?? ''),
    );

    clearSelectedScenes();
  };

  // v1.16.0: 선택된 씬들에 길이 변경 라벨 일괄 토글 (LD/SD/null)
  // v1.16.0 fix #1: isBulkInFlight 가드
  // v1.16.0 fix #2 (Codex 라운드 1): self in-flight ref
  // v1.16.0 fix #3 (Codex 라운드 3): Promise.allSettled
  // v1.16.0 fix #4 (Codex 라운드 7): unified 모드 mergedKey 단위 atomic
  // v1.16.0 fix #5 (Codex 라운드 8): unified vs 단독 뷰 분기 — 단독 뷰는 selectedSceneIds 가 plain sceneId 라
  //                                  prefix 제거만으로 mergedKey 매칭 실패 → bulk 가 동작 안 했음.
  //                                  → 통합: mergedKey atomic, 단독: per-uuid 부분 롤백 (한 부서만 영향).
  const lengthChangeBulkInFlightRef = useRef(false);
  const handleBulkLengthChange = async (value: 'LD' | 'SD' | null) => {
    if (isBulkInFlight || lengthChangeBulkInFlightRef.current) return;

    if (selectedDepartment === 'all') {
      // ─── 통합 뷰: mergedKey 단위 atomic (BG/ACT sync 보존) ───
      type MergedTarget = { bg?: LengthChangeTarget; act?: LengthChangeTarget };
      const mergedTargets = new Map<string, MergedTarget>();
      for (const id of selectedSceneIds) {
        if (!id.startsWith('bg:') && !id.startsWith('act:')) continue;
        const mergedKey = id.replace(/^(bg|act):/, '');
        if (mergedTargets.has(mergedKey)) continue;
        const merged = allMergedScenes.find((m) => m.mergedKey === mergedKey);
        if (!merged) continue;
        const target: MergedTarget = {};
        if (merged.bgScene?.id) target.bg = { uuid: merged.bgScene.id, prev: merged.bgScene.lengthChange ?? null };
        if (merged.actScene?.id) target.act = { uuid: merged.actScene.id, prev: merged.actScene.lengthChange ?? null };
        if (target.bg || target.act) mergedTargets.set(mergedKey, target);
      }
      if (mergedTargets.size === 0) return;

      lengthChangeBulkInFlightRef.current = true;

      try {
        await Promise.all(
          Array.from(mergedTargets.values()).map(async (t) => {
            const targets: LengthChangeTarget[] = [];
            if (t.bg) targets.push(t.bg);
            if (t.act) targets.push(t.act);
            await persistLengthChangeAtomic(targets, value, {
              updateScene: (uuid, lengthChange) => useDataStore.getState().updateSceneByUuid(uuid, { lengthChange }),
              saveSceneField: saveLengthChangeField,
              logPrefix: 'bulk lengthChange',
            });
          }),
        );
      } finally {
        lengthChangeBulkInFlightRef.current = false;
      }
    } else {
      // ─── 단독 뷰 (BG 또는 ACT only): plain sceneId → Scene → uuid, per-uuid 부분 롤백 ───
      // 단독 뷰는 한 부서만 영향이라 mergedKey atomic 무의미.
      const scenes = resolveSelectedScenes(selectedSceneIds, allMergedScenes, selectedDepartment as 'bg' | 'acting', currentPart);
      const targets: LengthChangeTarget[] = scenes
        .filter((s) => !!s.id)
        .map((s) => ({ uuid: s.id!, prev: s.lengthChange ?? null }));
      if (targets.length === 0) return;

      lengthChangeBulkInFlightRef.current = true;

      try {
        await persistLengthChangeIndependent(targets, value, {
          updateScene: (uuid, lengthChange) => useDataStore.getState().updateSceneByUuid(uuid, { lengthChange }),
          saveSceneField: saveLengthChangeField,
          logPrefix: 'bulk lengthChange single',
        });
      } finally {
        lengthChangeBulkInFlightRef.current = false;
      }
    }
  };

  // 일괄 편집: 선택된 씬들의 assignee/memo/layoutId를 RPC로 일괄 갱신 (Tasks 13-17)
  // v1.27.0: assigneeMode 도입 — 'replace' 기존 덮어쓰기 / 'append' 기존에 이어붙이기 (중복 제거).
  // v1.27.0: targetDept 도입 — 'all'/'bg'/'acting'. resolveSelectedScenes 의 onlyDept 로 전달.
  // append 모드는 씬마다 기존 값이 다르므로 fields 가 씬별로 다름 → 씬별 updates 생성.
  const handleBulkEditSubmit = async (
    payload: {
      assignee?: string;
      assigneeMode?: 'replace' | 'append';
      memo?: string;
      layoutId?: string;
      targetDept?: 'all' | 'bg' | 'acting';
    },
    selectionSnapshot?: Set<string>,
  ) => {
    if (!payload.assignee && !payload.memo && !payload.layoutId) return;

    const selection = selectionSnapshot ?? selectedSceneIds;
    // v1.27.0 코덱스 3차 P1 fix: 단일 부서 뷰 (BG/ACT) 에서 selection 은 plain scene id 라
    // resolveSelectedScenes 의 onlyDept 가 무시됨. 뷰 부서와 targetDept 가 불일치하면 의도와
    // 반대 부서를 편집하는 데이터 무결성 사고 방지 — 명시적 early return + 사용자 안내.
    if (
      selectedDepartment !== 'all'
      && payload.targetDept
      && payload.targetDept !== selectedDepartment
    ) {
      const viewLabel = selectedDepartment === 'bg' ? 'BG' : '액팅';
      const targetLabel = payload.targetDept === 'all' ? '둘 다' : payload.targetDept === 'bg' ? 'BG' : '액팅';
      sonnerToast.warning(`현재 ${viewLabel} 뷰에서는 ${targetLabel} 대상으로 편집할 수 없습니다. 통합 뷰에서 시도해주세요.`);
      return;
    }
    const onlyDept = payload.targetDept && payload.targetDept !== 'all' ? payload.targetDept : undefined;
    const targetScenes = resolveSelectedScenes(selection, allMergedScenes, onlyDept, currentPart);
    if (targetScenes.length === 0) return;

    const mode = payload.assigneeMode ?? 'replace';
    const updates: BulkFieldUpdate[] = [];
    const fieldsByUuid = new Map<string, Partial<Scene>>();

    for (const s of targetScenes) {
      if (!s.id) continue;
      const fields: BulkFieldUpdate['fields'] = {};
      if (payload.memo) fields.memo = payload.memo;
      if (payload.layoutId) fields.layoutId = payload.layoutId;
      if (payload.assignee) {
        if (mode === 'replace') {
          fields.assignee = payload.assignee;
        } else {
          // append: 기존 콤마 구분 담당자에 새 이름 이어붙임. 중복 제거.
          const existing = (s.assignee ?? '').split(',').map((n) => n.trim()).filter(Boolean);
          const adding = payload.assignee.split(',').map((n) => n.trim()).filter(Boolean);
          const merged: string[] = [];
          const seen = new Set<string>();
          for (const n of [...existing, ...adding]) {
            if (seen.has(n)) continue;
            seen.add(n);
            merged.push(n);
          }
          fields.assignee = merged.join(', ');
        }
      }
      if (Object.keys(fields).length === 0) continue;
      updates.push({ sceneUuid: s.id, fields });
      fieldsByUuid.set(s.id, fields);
    }
    if (updates.length === 0) return;

    await runBulkOp(
      'field-edit',
      updates.map((u) => u.sceneUuid),
      // retry 시 전달받은 uuids 부분집합만 재전송
      (uuidsToSend) => {
        const set = new Set(uuidsToSend);
        const subset = updates.filter((u) => set.has(u.sceneUuid));
        return bulkUpdateSceneFields(subset, currentUser?.id ?? '');
      },
      { fieldsByUuid },
    );
  };

  const handleAddEpisode = () => {
    setNewEpName('');
    setAddEpOpen(true);
  };

  const handleConfirmAddEpisode = async () => {
    const epName = newEpName.trim();
    setAddEpOpen(false);

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;
    const prevTitles = { ...episodeTitles };

    // 낙관적 업데이트 (항상 BG+ACT 양쪽 생성)
    addEpisodeOptimistic(nextEpisodeNumber);
    setSelectedEpisode(nextEpisodeNumber);

    // 제목 저장 (즉시 UI 반영)
    if (epName) {
      const next = { ...episodeTitles, [nextEpisodeNumber]: epName };
      setEpisodeTitles(next);
    }

    // 백그라운드에서 서버에 저장 (BG + ACT 양쪽)
    try {
      const actions: BatchAction[] = [
        batchActions.addEpisode(nextEpisodeNumber, 'bg'),
        batchActions.addPart(nextEpisodeNumber, 'A', 'acting'),
      ];
      if (epName) {
        actions.push(batchActions.writeMetadata('episode-title', String(nextEpisodeNumber), epName));
      }
      await batchExecute(actions);
      syncInBackground();
    } catch (err) {
      // 롤백
      setEpisodes(prevEpisodes);
      setEpisodeTitles(prevTitles);
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        sonnerToast.error(`에피소드 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        sonnerToast.error(`에피소드 추가 실패: ${err}`);
      }
      syncInBackground();
    }
  };

  // 공통 시트 에러 핸들러
  const handleSheetError = (err: unknown, actionName: string) => {
    const msg = String(err);
    if (msg.includes('Unknown action')) {
      sonnerToast.error(`${actionName} 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
    } else {
      sonnerToast.error(`${actionName} 실패: ${err}`);
    }
  };

  const handleAddPart = async () => {
    if (!currentEp) return;
    if (nextPartId > 'Z') {
      sonnerToast.error('파트는 Z까지만 가능합니다');
      return;
    }

    const pad = String(currentEp.episodeNumber).padStart(2, '0');

    // 'all' 모드: BG+ACT 양쪽 동시 생성
    if (selectedDepartment === 'all') {
      // 중복 체크 (양쪽 모두)
      const bgSheet = `EP${pad}_${nextPartId}_BG`;
      const actSheet = `EP${pad}_${nextPartId}_ACT`;
      if (allParts.some((p) => p.sheetName === bgSheet || p.sheetName === actSheet)) {
        sonnerToast.error(`${nextPartId}파트는 이미 존재합니다.`);
        return;
      }

      const prevEpisodes = useDataStore.getState().episodes;
      const prevSelectedPart = selectedPart;

      addPartOptimistic(currentEp.episodeNumber, nextPartId, 'bg');
      addPartOptimistic(currentEp.episodeNumber, nextPartId, 'acting');
      setSelectedPart(nextPartId);

      try {
        await batchExecute([
          batchActions.addPart(currentEp.episodeNumber, nextPartId, 'bg'),
          batchActions.addPart(currentEp.episodeNumber, nextPartId, 'acting'),
        ]);
        syncInBackground();
      } catch (err) {
        setEpisodes(prevEpisodes);
        setSelectedPart(prevSelectedPart);
        handleSheetError(err, '파트 추가');
        syncInBackground();
      }
      return;
    }

    // 개별 모드: 한쪽 부서만 생성
    const deptSuffix = effectiveDept === 'bg' ? '_BG' : '_ACT';
    const expectedSheetName = `EP${pad}_${nextPartId}${deptSuffix}`;
    if (allParts.some((p) => p.sheetName === expectedSheetName)) {
      sonnerToast.error(`${nextPartId}파트(${effectiveDept === 'bg' ? 'BG' : '액팅'})는 이미 존재합니다.`);
      return;
    }

    const prevEpisodes = useDataStore.getState().episodes;
    const prevSelectedPart = selectedPart;

    addPartOptimistic(currentEp.episodeNumber, nextPartId, effectiveDept);
    setSelectedPart(nextPartId);

    try {
      await addPart(currentEp.episodeNumber, nextPartId, effectiveDept);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      setSelectedPart(prevSelectedPart);
      handleSheetError(err, '파트 추가');
      syncInBackground();
    }
  };

  const handleAddScene = async (sceneId: string, assignee: string, memo: string, layoutId: string, images?: { storyboard?: string; guide?: string }, skipSync?: boolean) => {
    // 전체 모드: BG+ACT 양쪽 동시 추가
    if (addTargetSheet === '__both__') {
      const sheets = [bgPart?.sheetName, actPart?.sheetName].filter(Boolean) as string[];
      if (sheets.length === 0) return;

      const prevEpisodes = useDataStore.getState().episodes;

      for (const sheet of sheets) {
        addSceneOptimistic(sheet, sceneId, assignee, memo);
      }

      try {
        await Promise.all(sheets.map((sheet) => addScene(sheet, sceneId, assignee, memo)));
        sonnerToast.success(`씬 ${sceneId} 추가 완료 (BG+액팅)`);
        syncInBackground();
      } catch (err) {
        setEpisodes(prevEpisodes);
        handleSheetError(err, '씬 추가');
        syncInBackground();
        return;
      }

      // layoutId / images: 양쪽 모두 적용
      if (layoutId) {
        for (const sheet of sheets) {
          const latestPart = useDataStore.getState().episodes
            .flatMap((ep) => ep.parts)
            .find((p) => p.sheetName === sheet);
          const latestIndex = latestPart?.scenes.findIndex((s) => s.sceneId === sceneId) ?? -1;
          if (latestIndex >= 0) {
            updateSceneFieldOptimistic(sheet, latestIndex, 'layoutId', layoutId);
            updateSceneField(sheet, latestIndex, 'layoutId', layoutId).catch(() => {});
          }
        }
      }

      if (images?.storyboard || images?.guide) {
        // v1.25.12: addScene 후 UUID 가 store 에 채워지기 전에 saveImage 가
        // 끝나면서 발생하던 "씬 UUID를 찾을 수 없음" 오류 fix.
        // sceneIndex 기반 resolveSceneUuid 대신 UUID 폴링 + 직접 IPC 사용.
        // v1.26.0: 첫 이미지를 v1 로 자동 기록 (버전 시스템).
        (async () => {
          const { saveImage } = await import('@/utils/imageUtils');
          const { waitForSceneUuid } = await import('@/services/supabaseService');
          const { createImageVersion } = await import('@/services/imageVersionService');
          for (const sheet of sheets) {
            const uuid = await waitForSceneUuid(sheet, sceneId);
            if (!uuid) {
              sonnerToast.error(`이미지 업로드 동기화 실패: ${sceneId}. 새로고침 후 다시 시도해 주세요.`);
              continue;
            }
            try {
              if (images.storyboard) {
                const url = await saveImage(images.storyboard, sheet, sceneId, 'storyboard');
                await window.electronAPI?.supabaseUpdateSceneField?.(uuid, 'storyboardUrl', url);
                useDataStore.getState().updateSceneByUuid(uuid, { storyboardUrl: url });
                if (currentUser?.id) {
                  await createImageVersion({ sceneId: uuid, imageType: 'storyboard', kind: 'replace', url, createdBy: currentUser.id })
                    .catch((e) => console.warn('[버전 v1 기록 실패]', e));
                }
              }
              if (images.guide) {
                const url = await saveImage(images.guide, sheet, sceneId, 'guide');
                await window.electronAPI?.supabaseUpdateSceneField?.(uuid, 'guideUrl', url);
                useDataStore.getState().updateSceneByUuid(uuid, { guideUrl: url });
                if (currentUser?.id) {
                  await createImageVersion({ sceneId: uuid, imageType: 'guide', kind: 'replace', url, createdBy: currentUser.id })
                    .catch((e) => console.warn('[버전 v1 기록 실패]', e));
                }
              }
            } catch (err) {
              console.error('[씬 추가 이미지 업로드 실패]', err);
              sonnerToast.error(`이미지 업로드 실패: ${sceneId}`);
            }
          }
        })();
      }
      return;
    }

    // 개별 모드: 기존 로직
    const targetSheet = addTargetSheet ?? currentPart?.sheetName;
    if (!targetSheet) return;

    const targetPart = allParts.find((p) => p.sheetName === targetSheet);
    if (!targetPart) return;

    const prevEpisodes = useDataStore.getState().episodes;

    addSceneOptimistic(targetSheet, sceneId, assignee, memo);

    try {
      await addScene(targetSheet, sceneId, assignee, memo);
      if (!skipSync) {
        sonnerToast.success(`씬 ${sceneId} 추가 완료`);
        syncInBackground();
      }
    } catch (err) {
      setEpisodes(prevEpisodes);
      handleSheetError(err, '씬 추가');
      if (!skipSync) syncInBackground();
      return;
    }

    if (layoutId) {
      const latestPart = useDataStore.getState().episodes
        .flatMap((ep) => ep.parts)
        .find((p) => p.sheetName === targetSheet);
      const latestIndex = latestPart?.scenes.findIndex((s) => s.sceneId === sceneId) ?? -1;
      if (latestIndex >= 0) {
        updateSceneFieldOptimistic(targetSheet, latestIndex, 'layoutId', layoutId);
        updateSceneField(targetSheet, latestIndex, 'layoutId', layoutId).catch(() => {});
      }
    }

    if (images?.storyboard || images?.guide) {
      // v1.25.12: UUID race fix (위 통합 모드와 동일 패턴).
      // v1.26.0: 첫 이미지를 v1 로 자동 기록 (버전 시스템).
      (async () => {
        const { saveImage } = await import('@/utils/imageUtils');
        const { waitForSceneUuid } = await import('@/services/supabaseService');
        const { createImageVersion } = await import('@/services/imageVersionService');
        const uuid = await waitForSceneUuid(targetSheet, sceneId);
        if (!uuid) {
          sonnerToast.error(`이미지 업로드 동기화 실패: ${sceneId}. 새로고침 후 다시 시도해 주세요.`);
          return;
        }
        try {
          if (images.storyboard) {
            const url = await saveImage(images.storyboard, targetSheet, sceneId, 'storyboard');
            await window.electronAPI?.supabaseUpdateSceneField?.(uuid, 'storyboardUrl', url);
            useDataStore.getState().updateSceneByUuid(uuid, { storyboardUrl: url });
            if (currentUser?.id) {
              await createImageVersion({ sceneId: uuid, imageType: 'storyboard', kind: 'replace', url, createdBy: currentUser.id })
                .catch((e) => console.warn('[버전 v1 기록 실패]', e));
            }
          }
          if (images.guide) {
            const url = await saveImage(images.guide, targetSheet, sceneId, 'guide');
            await window.electronAPI?.supabaseUpdateSceneField?.(uuid, 'guideUrl', url);
            useDataStore.getState().updateSceneByUuid(uuid, { guideUrl: url });
            if (currentUser?.id) {
              await createImageVersion({ sceneId: uuid, imageType: 'guide', kind: 'replace', url, createdBy: currentUser.id })
                .catch((e) => console.warn('[버전 v1 기록 실패]', e));
            }
          }
        } catch (err) {
          console.error('[씬 추가 이미지 업로드 실패]', err);
          sonnerToast.error(`이미지 업로드 실패: ${sceneId}`);
        }
      })();
    }
  };

  // Phase 0-5: 대량 씬 추가 (5개 이상 — 서버 확인 후 반영)
  const handleBulkAddScenes = async (scenesToAdd: { sceneId: string; assignee: string; memo: string }[]) => {
    if (scenesToAdd.length === 0) return;

    // 전체 모드: BG+ACT 양쪽 동시 대량 추가
    if (addTargetSheet === '__both__') {
      const sheets = [bgPart?.sheetName, actPart?.sheetName].filter(Boolean) as string[];
      if (sheets.length === 0) return;

      setBulkAddLoading(true);
      try {
        const { addScenes } = await import('@/services/supabaseService');
        await Promise.all(sheets.map((sheet) => addScenes(sheet, scenesToAdd)));
        await syncInBackground();
        sonnerToast.success(`${scenesToAdd.length}개 씬 추가 완료 (BG+액팅 양쪽 / 총 ${scenesToAdd.length * sheets.length}개)`);
      } catch (err) {
        sonnerToast.error(`대량 씬 추가 실패: ${err}`);
      } finally {
        setBulkAddLoading(false);
      }
      return;
    }

    const targetSheet = addTargetSheet ?? currentPart?.sheetName;
    if (!targetSheet) return;

    setBulkAddLoading(true);
    try {
      const { addScenes } = await import('@/services/supabaseService');
      await addScenes(targetSheet, scenesToAdd);
      await syncInBackground();
      sonnerToast.success(`${scenesToAdd.length}개 씬 추가 완료`);
    } catch (err) {
      sonnerToast.error(`대량 씬 추가 실패: ${err}`);
    } finally {
      setBulkAddLoading(false);
    }
  };

  // 공통 씬 삭제 (sheetName 파라미터)
  const handleDeleteSceneForSheet = async (sheetName: string, sceneIndex: number) => {
    const ok = await ConfirmDialog.show({
      message: '이 씬을 삭제하시겠습니까?',
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!ok) return;

    const currentEpisodes = useDataStore.getState().episodes;
    const targetPart = currentEpisodes.flatMap((ep) => ep.parts).find((p) => p.sheetName === sheetName);
    const targetScene = targetPart?.scenes[sceneIndex];
    if (!targetScene?.id) {
      sonnerToast.error('씬 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.');
      return;
    }
    const sceneUuid = targetScene.id;
    const sceneNo = targetScene.no;
    const badgeKey = `${sheetName}:${sceneNo}`;

    const prevEpisodes = currentEpisodes;
    // Codex P2 8차(2026-04-23): 실패 롤백 시 뱃지 state 도 복원할 수 있도록 이전 값 보관.
    const prevCommentCount = commentCounts[badgeKey];
    const prevCommentIds = commentIdsByKey[badgeKey];
    const prevCommentLatestAt = commentLatestAtByKey[badgeKey];
    const prevCommentThreadKey = commentThreadKeyByCommentKey[badgeKey];

    deleteSceneOptimistic(sheetName, sceneIndex);

    // 이슈 F(2026-04-23): 낙관적으로 로컬 state 에서 뱃지 숫자를 즉시 비움.
    // Codex P2 7차(2026-04-23): 여기서 invalidatePartCache 를 부르면 `bflow:comments-invalidated`
    // 이벤트가 즉시 발화되어 리스너가 DB 재조회 → 씬이 아직 남아 있어 뱃지가 다시 채워지는 race.
    // 캐시 무효화는 DB 삭제 성공 후에만 수행한다.
    setCommentCounts((prev) => {
      const next = { ...prev };
      delete next[badgeKey];
      return next;
    });
    setCommentIdsByKey((prev) => {
      const next = { ...prev };
      delete next[badgeKey];
      return next;
    });
    setCommentLatestAtByKey((prev) => {
      const next = { ...prev };
      delete next[badgeKey];
      return next;
    });
    setCommentThreadKeyByCommentKey((prev) => {
      const next = { ...prev };
      delete next[badgeKey];
      return next;
    });

    try {
      await deleteSceneFromSupabase(sceneUuid);
      // CASCADE 로 DB 쪽 댓글/리테이크는 이 시점에 확실히 사라졌으므로 캐시 무효화 + 이벤트 전파.
      invalidatePartCache(sheetName);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      // Codex P2 8차(2026-04-23): 씬이 롤백되었는데 뱃지가 0 으로 남으면 사용자 혼란 → 함께 복원.
      if (prevCommentCount !== undefined) {
        setCommentCounts((prev) => ({ ...prev, [badgeKey]: prevCommentCount }));
      }
      if (prevCommentIds !== undefined) {
        setCommentIdsByKey((prev) => ({ ...prev, [badgeKey]: prevCommentIds }));
      }
      if (prevCommentLatestAt !== undefined) {
        setCommentLatestAtByKey((prev) => ({ ...prev, [badgeKey]: prevCommentLatestAt }));
      }
      if (prevCommentThreadKey !== undefined) {
        setCommentThreadKeyByCommentKey((prev) => ({ ...prev, [badgeKey]: prevCommentThreadKey }));
      }
      handleSheetError(err, '씬 삭제');
      syncInBackground();
    }
  };

  const handleDeleteScene = async (sceneIndex: number) => {
    if (!currentPart) return;
    await handleDeleteSceneForSheet(currentPart.sheetName, sceneIndex);
  };

  // 공통 필드 업데이트 (sheetName 파라미터)
  const handleFieldUpdateForSheet = async (sheetName: string, sceneIndex: number, field: string, value: string) => {
    const prevEpisodes = useDataStore.getState().episodes;
    updateSceneFieldOptimistic(sheetName, sceneIndex, field, value);

    // 씬 ID 조회 (delta 전송용)
    const part = useDataStore.getState().episodes.flatMap((ep) => ep.parts).find((p) => p.sheetName === sheetName);
    const sceneId = part?.scenes[sceneIndex]?.sceneId ?? '';

    try {
      await updateSceneField(sheetName, sceneIndex, field, value);
      window.electronAPI?.dataNotifyChange?.({
        type: 'field-update',
        sheetName,
        sceneId,
        sceneIndex,
        field,
        value,
      });
    } catch (err) {
      setEpisodes(prevEpisodes);
      handleSheetError(err, '수정');
      syncInBackground();
    }
  };

  const handleFieldUpdate = async (sceneIndex: number, field: string, value: string) => {
    if (!currentPart) return;
    await handleFieldUpdateForSheet(currentPart.sheetName, sceneIndex, field, value);
  };

  // ─── 파트 삭제 ─────────────────────
  // BG·ACT 동시 선택(전체 뷰)에서도 한 번의 확인으로 양쪽 파트를 함께 삭제 처리.
  const handleDeletePartsForSheets = async (sheetNames: string[]) => {
    if (sheetNames.length === 0) return;
    const allParts = useDataStore.getState().episodes.flatMap((ep) => ep.parts);
    const targetParts = sheetNames
      .map((sn) => allParts.find((p) => p.sheetName === sn))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (targetParts.length === 0) return;

    const partLabel = [...new Set(targetParts.map((p) => p.partId))].join('·');
    if (!confirm(`${partLabel}파트를 삭제하시겠습니까?\n파트에 속한 모든 씬·댓글·리테이크도 함께 정리됩니다.`)) return;

    const prevEpisodes = useDataStore.getState().episodes;
    const prevSelectedPart = selectedPart;

    // Codex P2 8차(2026-04-23): 씬 삭제와 동일 race — DB 호출 전 invalidatePartCache 를 부르면
    // 이벤트 리스너가 즉시 reload → 파트가 아직 살아있어 스테일 댓글이 뱃지에 다시 채워짐.
    // 낙관적 단계에서는 UI state 만 업데이트(deletePartOptimistic 은 에피소드 상태만 건드림),
    // 캐시 무효화는 DB 성공 후 수행.
    for (const sn of sheetNames) {
      deletePartOptimistic(sn);
    }
    setSelectedPart(null);

    try {
      await Promise.all(sheetNames.map((sn) => softDeletePart(sn)));
      // DB 삭제 성공 후에만 캐시 무효화 + 이벤트 전파 → reload 가 최신 상태 반환.
      for (const sn of sheetNames) invalidatePartCache(sn);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      setSelectedPart(prevSelectedPart);
      handleSheetError(err, '파트 삭제');
      syncInBackground();
    }
  };

  const handleDeletePart = (sheetName: string) => handleDeletePartsForSheets([sheetName]);

  // ─── 에피소드 삭제 ────────────────────
  const handleDeleteEpisode = async () => {
    if (!currentEp) return;
    const epDisplayName = episodeTitles[currentEp.episodeNumber] || currentEp.title;
    if (!confirm(`"${epDisplayName}"를 삭제하시겠습니까?\n에피소드의 모든 파트·씬·댓글도 함께 정리됩니다. 아카이빙을 원하면 우클릭 메뉴에서 '아카이빙하기'를 이용해주세요.`)) return;

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;
    const prevSelectedEpisode = selectedEpisode;

    deleteEpisodeOptimistic(currentEp.episodeNumber);
    setSelectedEpisode(episodes[0]?.episodeNumber ?? 1);
    setEpEditOpen(false);

    try {
      await softDeleteEpisode(currentEp.episodeNumber);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      setSelectedEpisode(prevSelectedEpisode);
      handleSheetError(err, '에피소드 삭제');
      syncInBackground();
    }
  };

  // ─── 에피소드 아카이빙 ────────────────────
  // 우클릭 메뉴에서 "아카이빙하기" 선택 시 → 다이얼로그 표시
  const openArchiveDialog = useCallback((epNum: number) => {
    setArchiveMemoInput('완료로 인한 아카이빙');
    setArchiveDialogEpNum(epNum);
  }, []);

  const handleArchiveConfirm = async () => {
    const epNum = archiveDialogEpNum;
    if (epNum == null) return;
    const ep = episodes.find((e) => e.episodeNumber === epNum);
    if (!ep) return;

    const memo = archiveMemoInput.trim() || '완료로 인한 아카이빙';
    const archivedBy = currentUser?.name ?? '알 수 없음';
    const archivedAt = new Date().toLocaleDateString('ko-KR');
    const epTitle = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;

    setArchiveDialogEpNum(null);

    // 아카이브 가드 ON — sync가 낙관적 상태를 덮어쓰지 못하게 보호
    archiveGuardRef.current = true;
    // 진행 중인 sync 응답 무효화
    syncVersionRef.current++;

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;
    const prevArchivedEpisodes = [...archivedEpisodes];

    // ① 낙관적 업데이트
    deleteEpisodeOptimistic(epNum);
    setArchivedEpisodes((prev) => [
      ...prev,
      { episodeNumber: epNum, title: epTitle, partCount: ep.parts.length, archivedBy, archivedAt, memo },
    ]);
    if (selectedEpisode === epNum) {
      setSelectedEpisode(episodes.find((e) => e.episodeNumber !== epNum)?.episodeNumber ?? 1);
    }

    try {
      // Phase 0-2: _REGISTRY 기반 아카이빙 (탭 이름 변경 없이 status만 변경)
      const { archiveEpisode } = await import('@/services/supabaseService');
      await archiveEpisode(epNum, archivedBy, memo);
      // 서버가 완전히 처리할 시간(5초)을 준 후 가드 해제 + 동기화 (snapshot relay가 다른 창에 전달)
      setTimeout(() => {
        archiveGuardRef.current = false;
        syncInBackground();
      }, 5000);
    } catch (err) {
      // 롤백: 활성 목록 + 아카이브 목록 모두 원복
      archiveGuardRef.current = false;
      setEpisodes(prevEpisodes);
      setArchivedEpisodes(prevArchivedEpisodes);
      sonnerToast.error(`아카이빙 실패: ${err}`);
    }
  };

  // 에피소드 우클릭 컨텍스트 메뉴 핸들러
  const handleEpisodeContextMenu = useCallback((e: React.MouseEvent, epNum: number) => {
    e.preventDefault();
    e.stopPropagation();
    setEpContextMenu({ x: e.clientX, y: e.clientY, epNum });
  }, []);

  const handleUnarchiveEpisode = async (epNum: number) => {
    const archived = archivedEpisodes.find((a) => a.episodeNumber === epNum);
    const epDisplayName = episodeTitles[epNum] || archived?.title || `EP.${String(epNum).padStart(2, '0')}`;
    if (!confirm(`"${epDisplayName}"를 아카이빙에서 복원하시겠습니까?`)) return;

    // 아카이브 가드 ON — sync가 낙관적 상태를 덮어쓰지 못하게 보호
    archiveGuardRef.current = true;
    syncVersionRef.current++;

    // 롤백용 스냅샷
    const prevArchivedEpisodes = [...archivedEpisodes];

    // 낙관적 업데이트
    setArchivedEpisodes((prev) => prev.filter((a) => a.episodeNumber !== epNum));

    try {
      // Phase 0-2: _REGISTRY 기반 복원 (탭 이름 변경 없이 status만 변경)
      const { unarchiveEpisode } = await import('@/services/supabaseService');
      await unarchiveEpisode(epNum);
      // 서버가 완전히 처리할 시간(5초)을 준 후 가드 해제 + 동기화 (snapshot relay가 다른 창에 전달)
      setTimeout(() => {
        archiveGuardRef.current = false;
        syncInBackground();
      }, 5000);
    } catch (err) {
      // 롤백
      archiveGuardRef.current = false;
      setArchivedEpisodes(prevArchivedEpisodes);
      sonnerToast.error(`복원 실패: ${err}`);
    }
  };

  // ─── 에피소드 제목/메모 저장 (시트 + 로컬 fallback) ──────────────
  const handleSaveEpEdit = async (title: string, memo: string) => {
    if (!currentEp) return;
    setEpEditOpen(false);
    const key = String(currentEp.episodeNumber);

    // 즉시 UI 반영 — setState 콜백 안에서 글로벌 스토어 업데이트하면
    // "Cannot update a component while rendering" 경고 발생하므로 분리
    if (title.trim()) {
      const next = { ...episodeTitles, [currentEp.episodeNumber]: title.trim() };
      setEpisodeTitles(next);
      // setEpisodeTitles는 이미 글로벌 스토어 setter
    } else {
      const next = { ...episodeTitles };
      delete next[currentEp.episodeNumber];
      setEpisodeTitles(next);
      // setEpisodeTitles는 이미 글로벌 스토어 setter
    }
    setEpisodeMemos({ ...episodeMemos, [currentEp.episodeNumber]: memo });

    // 저장
    try {
      await writeMetadata('episode-title', key, title.trim());
      await writeMetadata('episode-memo', key, memo);
    } catch (err) {
      console.warn('[에피소드 메타] 시트 저장 실패', err);
    }
  };

  const backLabel = previousView && previousView !== 'scenes' ? VIEW_LABELS[previousView] : null;

  // 트리뷰에서 에피소드+파트 동시 선택
  const handleTreeSelect = useCallback((epNum: number, partId: string | null) => {
    setSelectedEpisode(epNum);
    setSelectedPart(partId);
  }, [setSelectedEpisode, setSelectedPart]);

  // 트리뷰에서 에피소드 편집 열기
  const handleTreeEpisodeEdit = useCallback((epNum: number) => {
    setSelectedEpisode(epNum);
    setEpTitleInput(episodeTitles[epNum] ?? '');
    setEpMemo(episodeMemos[epNum] ?? '');
    setEpEditOpen(true);
  }, [setSelectedEpisode, episodeTitles, episodeMemos]);

  const selectedSceneCount = countSelectedScenes(selectedSceneIds, allMergedScenes, currentPart);

  return (
    <div ref={gridRef} className="relative flex gap-3 min-h-full">
      {isLight && (
        <>
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.52) 0%, rgba(248,250,255,0.82) 100%)',
              border: '1px solid rgba(255,255,255,0.64)',
              boxShadow: '0 20px 60px rgba(148, 163, 184, 0.12) inset, 0 18px 36px rgba(148, 163, 184, 0.08)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{
              background: `
                radial-gradient(circle at 14% 10%, rgb(var(--color-accent) / 0.06) 0%, transparent 34%),
                radial-gradient(circle at 84% 14%, rgb(var(--color-accent-sub) / 0.05) 0%, transparent 30%)
              `,
            }}
          />
        </>
      )}
      {/* ── 트리뷰 사이드바 (애니메이션) ── */}
      <motion.div
        data-no-lasso
        className="relative z-10 shrink-0 bg-bg-card border border-bg-border rounded-xl overflow-hidden flex flex-col sticky top-0 self-start max-h-[calc(100vh-5.5rem)]"
        animate={{ width: treeOpen ? 208 : 40 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* 펼친 상태: EpisodeTreeNav */}
        <motion.div
          className="w-52 overflow-y-auto flex-1"
          animate={{
            opacity: treeOpen ? 1 : 0,
            scale: treeOpen ? 1 : 0.85,
            filter: treeOpen ? 'blur(0px)' : 'blur(4px)',
          }}
          transition={{ duration: 0.2 }}
          style={{ pointerEvents: treeOpen ? 'auto' : 'none', position: treeOpen ? 'relative' : 'absolute' }}
        >
          <EpisodeTreeNav
            episodes={episodes}
            selectedDepartment={selectedDepartment}
            selectedEpisode={selectedEpisode ?? currentEp?.episodeNumber ?? null}
            selectedPart={selectedPart}
            partMemos={partMemos}
            partReelWorkers={partReelWorkers}
            episodeTitles={episodeTitles}
            episodeMemos={episodeMemos}
            onSelectEpisodePart={handleTreeSelect}
            onAddEpisode={handleAddEpisode}
            onAddPart={handleAddPart}
            onPartContextMenu={(e, target) => {
              setPartMenuTarget(target);
              openPartMenu(e);
            }}
            onEpisodeEdit={handleTreeEpisodeEdit}
            archivedEpisodes={archivedEpisodes}
            onArchiveEpisode={openArchiveDialog}
            onUnarchiveEpisode={handleUnarchiveEpisode}
            onEpisodeContextMenu={handleEpisodeContextMenu}
            onCollapse={() => setTreeOpen(false)}
          />
        </motion.div>

        {/* 접힌 상태: 아이콘 바 */}
        {!treeOpen && (
          <motion.div
            className="flex flex-col items-center py-2 w-10"
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: 0.1 }}
          >
            <button
              onClick={() => setTreeOpen(true)}
              className="p-2 text-text-secondary/60 hover:text-accent rounded-lg hover:bg-accent/10 transition-colors"
              title="트리 열기"
            >
              <PanelLeftOpen size={16} />
            </button>
          </motion.div>
        )}
      </motion.div>

      {/* ── 메인 콘텐츠 영역 ── */}
      <div className="relative z-10 flex-1 flex flex-col gap-4 min-w-0">
      {/* 뒤로가기 (인원별/에피소드 뷰에서 이동해온 경우) */}
      {backLabel && (
        <motion.button
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onClick={() => setView(previousView!)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg w-fit cursor-pointer',
            'bg-accent/10 text-accent border border-accent/20',
            'hover:bg-accent/20 hover:border-accent/30',
            'transition-colors duration-150',
          )}
        >
          <ArrowLeft size={14} />
          <span>← {backLabel}로 돌아가기</span>
        </motion.button>
      )}

      {/* 필터 바 — 2줄 구조 */}
      <div className="relative z-20 flex flex-col gap-2 bg-bg-card border border-bg-border rounded-xl p-3">
        {/* 1줄: 필수 네비게이션 (부서 + 에피소드 + 파트) */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 부서 탭 */}
          <div className="flex bg-bg-primary rounded-lg p-0.5 border border-bg-border">
            {/* 전체 탭 */}
            {(() => {
              const isActive = selectedDepartment === 'all';
              const accentColor = '#6C5CE7';
              return (
                <button
                  key="all"
                  onClick={() => { setSelectedDepartment('all'); setDashboardDeptFilter('all'); }}
                  className={cn(
                    'relative z-10 px-4 py-2 text-sm rounded-md font-medium cursor-pointer',
                    'transition-colors duration-200 ease-out',
                    isActive
                      ? 'text-white'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="scenes-dept-tab-indicator"
                      className="absolute inset-0 rounded-md shadow-sm"
                      style={{
                        backgroundColor: accentColor,
                        boxShadow: `0 2px 8px ${accentColor}40`,
                      }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">전체</span>
                </button>
              );
            })()}
            {DEPARTMENTS.map((dept) => {
              const cfg = DEPARTMENT_CONFIGS[dept];
              const isActive = selectedDepartment === dept;
              return (
                <button
                  key={dept}
                  onClick={() => { setSelectedDepartment(dept); setDashboardDeptFilter(dept); }}
                  className={cn(
                    'relative z-10 px-4 py-2 text-sm rounded-md font-medium cursor-pointer',
                    'transition-colors duration-200 ease-out',
                    isActive
                      ? 'text-white'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="scenes-dept-tab-indicator"
                      className="absolute inset-0 rounded-md shadow-sm"
                      style={{
                        backgroundColor: cfg.color,
                        boxShadow: `0 2px 8px ${cfg.color}40`,
                      }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">{cfg.shortLabel}</span>
                </button>
              );
            })}
          </div>

          {/* 트리 닫힘 시에만 에피소드/파트 선택 UI 표시 */}
          {!treeOpen && (
            <>
              <div className="w-px h-6 bg-bg-border" />

              {/* 에피소드 선택 + 편집 */}
              <div className="flex items-center gap-1">
                <GlassDropdown<number>
                  options={episodeOptions}
                  value={selectedEpisode ?? currentEp?.episodeNumber ?? null}
                  onChange={(v) => setSelectedEpisode(v)}
                  label="에피소드 선택"
                  minWidth={200}
                />
                {currentEp && (
                  <button
                    onClick={() => {
                      if (currentEp) {
                        setEpTitleInput(episodeTitles[currentEp.episodeNumber] ?? '');
                        setEpMemo(episodeMemos[currentEp.episodeNumber] ?? '');
                      }
                      setEpEditOpen(!epEditOpen);
                    }}
                    className="p-1.5 text-text-secondary/40 hover:text-text-primary rounded transition-colors"
                    title="에피소드 관리"
                  >
                    <MoreVertical size={16} />
                  </button>
                )}
              </div>

              {/* 에피소드 추가 */}
              <button
                onClick={handleAddEpisode}
                className="px-3 py-2 bg-accent/20 text-accent text-sm font-medium rounded-lg hover:bg-accent/30 transition-colors"
                title="에피소드 추가"
              >
                + 에피소드
              </button>

              {/* 파트 드롭다운 */}
              <div className="flex items-center gap-1">
                <GlassDropdown
                  options={(() => {
                    if (selectedDepartment === 'all') {
                      return uniquePartIds.map((pid) => {
                        const target = buildPartContextMenuTarget(pid);
                        const memo = target ? getPartMemoText(target.sheetNames) : '';
                        const reelWorker = target ? getPartReelWorkerText(target.sheetNames) : '';
                        const meta = [
                          reelWorker ? `릴 담당 ${reelWorker}` : '',
                          memo,
                        ].filter(Boolean).join(' · ');
                        return {
                          value: pid,
                          label: `${pid}파트${meta ? ` (${meta})` : ''}`,
                          sublabel: meta || undefined,
                        };
                      });
                    }
                    return parts.map((p) => {
                      const memo = getPartMemoText([p.sheetName]);
                      const reelWorker = getPartReelWorkerText([p.sheetName]);
                      const meta = [
                        reelWorker ? `릴 담당 ${reelWorker}` : '',
                        memo,
                      ].filter(Boolean).join(' · ');
                      return {
                        value: p.partId,
                        label: `${p.partId}파트${meta ? ` (${meta})` : ''}`,
                        sublabel: meta || undefined,
                      };
                    });
                  })()}
                  value={selectedDepartment === 'all'
                    ? (currentPartId ?? uniquePartIds[0] ?? null)
                    : (currentPart?.partId ?? parts[0]?.partId ?? null)}
                  onChange={(v) => setSelectedPart(v)}
                  label="파트 선택"
                  onItemContextMenu={(v, e) => {
                    const target = buildPartContextMenuTarget(String(v));
                    if (target) {
                      setPartMenuTarget(target);
                      openPartMenu(e);
                    }
                  }}
                  minWidth={140}
                />
                {currentEp && (
                  <button
                    onClick={handleAddPart}
                    className="px-2.5 py-1.5 bg-bg-primary text-text-secondary text-sm rounded-lg hover:text-accent hover:border-accent border border-bg-border transition-colors"
                    title={`${nextPartId}파트 추가`}
                  >
                    +
                  </button>
                )}
              </div>
            </>
          )}

          {/* 트리 열림 시: 현재 위치 표시 */}
          {treeOpen && currentEp && (
            <>
              <div className="w-px h-6 bg-bg-border" />
              <span className="text-sm font-medium text-text-primary">
                {episodeTitles[currentEp.episodeNumber] || currentEp.title}
                {selectedDepartment === 'all' && currentPartId && (
                  <span className="text-text-secondary ml-1">/ {currentPartId}파트</span>
                )}
                {selectedDepartment !== 'all' && currentPart && (
                  <span className="text-text-secondary ml-1">/ {currentPart.partId}파트</span>
                )}
              </span>
            </>
          )}

          <div className="ml-auto flex items-center">
            <button
              onClick={toggleSceneControlsCollapsed}
              className="inline-flex items-center gap-2 rounded-lg border border-bg-border bg-bg-primary/40 px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent/30 hover:bg-accent/10 transition-colors"
              title={sceneControlsCollapsed ? '옵션 펼치기' : '옵션 접기'}
              aria-expanded={!sceneControlsCollapsed}
            >
              {sceneControlsCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              <span>{sceneControlsCollapsed ? '옵션 펼치기' : '옵션 접기'}</span>
            </button>
          </div>
        </div>

        {/* 2줄: 보기 설정 (담당자 + 상태 필터 + 정렬 + 뷰모드 + 검색)
            한솔 결정: 옵션 접기 = 완전 숨김 (요약 칩 라인 제거). 펼치기 시 다시 표시. */}
        <AnimatePresence initial={false} mode="wait">
          {sceneControlsCollapsed ? null : (
            <motion.div
              key="scene-controls-expanded"
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative overflow-visible"
            >
              <div className="flex flex-wrap items-center gap-3 bg-bg-primary/30 rounded-lg px-3 py-2">
                <GlassDropdown
                  options={assigneeOptions}
                  value={selectedAssignee ?? '__all__'}
                  onChange={(v) => setSelectedAssignee(v === '__all__' ? null : v)}
                  allOption={{ value: '__all__', label: '전체' }}
                  label="작업자 선택"
                  triggerLabel={selectedAssignee ?? '작업자: 전체'}
                  icon={<UserRound size={14} className="text-text-secondary" />}
                  minWidth={130}
                />

                <div className="w-px h-7 bg-bg-border" />

                {(['all', 'not-started', 'in-progress', 'done'] as StatusFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={cn(
                      'compact-label-container inline-flex min-w-0 shrink items-center justify-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                      statusFilter === f
                        ? f === 'done' ? 'bg-green-500/20 text-green-400'
                          : f === 'not-started' ? 'bg-red-500/20 text-red-400'
                          : f === 'in-progress' ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-accent/20 text-accent'
                      : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    <CompactIconLabel
                      icon={
                        f === 'done'
                          ? <CheckCircle2 size={13} strokeWidth={2.4} />
                          : f === 'not-started'
                            ? <Clock size={13} strokeWidth={2.4} />
                            : f === 'in-progress'
                              ? <PlayCircle size={13} strokeWidth={2.4} />
                              : <Circle size={13} strokeWidth={2.4} />
                      }
                      label={STATUS_FILTER_LABELS[f]}
                    />
                  </button>
                ))}

                <div className="flex items-center gap-2 ml-auto">
                  <div className="flex items-center gap-1.5">
                    <GlassDropdown
                      options={[
                        { value: 'no', label: '번호순' },
                        { value: 'assignee', label: '담당자순' },
                        { value: 'progress', label: '진행률순' },
                        { value: 'incomplete', label: '미완료 우선' },
                      ]}
                      value={sortKey}
                      onChange={(v) => setSortKey(v as SortKey)}
                      icon={<ArrowUpDown size={14} className="text-text-secondary" />}
                      minWidth={140}
                    />
                    <button
                      onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                      className="px-2 py-1.5 text-sm text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-border/50 transition-colors"
                      title={sortDir === 'asc' ? '오름차순' : '내림차순'}
                    >
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>

                  <div className="flex border border-bg-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setSceneGroupMode('flat')}
                      className={cn(
                        'p-2 transition-colors',
                        sceneGroupMode === 'flat' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
                      )}
                      title="씬번호별"
                    >
                      <List size={16} />
                    </button>
                    <button
                      onClick={() => setSceneGroupMode('layout')}
                      className={cn(
                        'p-2 transition-colors',
                        sceneGroupMode === 'layout' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
                      )}
                      title="레이아웃별"
                    >
                      <Layers size={16} />
                    </button>
                  </div>

                  <div className="flex border border-bg-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setSceneViewMode('card')}
                      className={cn(
                        'p-2 transition-colors',
                        sceneViewMode === 'card' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
                      )}
                      title="카드 뷰"
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      onClick={() => setSceneViewMode('sheet')}
                      className={cn(
                        'p-2 transition-colors',
                        sceneViewMode === 'sheet' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
                      )}
                      title="시트 뷰"
                    >
                      <Grid3x3 size={16} />
                    </button>
                  </div>

                  <input
                    type="text"
                    placeholder="검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 w-40"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 진행도 + 씬 목록 영역 */}
      <div className="relative flex-1 flex flex-col gap-4">

      {/* 에피소드/파트 없을 때 빈 상태 */}
      {!currentEp ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-text-secondary">
          <Film size={40} className="text-text-secondary/30" />
          <span className="text-base font-medium">등록된 에피소드가 없습니다</span>
          <span className="text-sm text-text-secondary/60">좌측 트리에서 + 버튼으로 에피소드를 추가해 주세요</span>
        </div>
      ) : selectedDepartment !== 'all' && parts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-text-secondary">
          <Layers size={40} className="text-text-secondary/30" />
          <span className="text-base font-medium">{DEPARTMENT_CONFIGS[selectedDepartment].label} 파트가 없습니다</span>
          <span className="text-sm text-text-secondary/60">파트를 추가하거나 다른 부서 탭을 선택해 주세요</span>
        </div>
      ) : (
      <>
      {/* 상단 고정 진행도 */}
      <div className="flex flex-col gap-3 bg-bg-card border border-bg-border rounded-xl px-5 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-text-secondary">
            {activeScenes.length}씬 표시 중
          </span>
          <div className="flex min-w-[220px] flex-1 items-center gap-4">
            <div className="scene-top-progress-track flex-1">
              <div
                className="scene-top-progress-fill transition-all duration-700 ease-out"
                style={{ width: `${overallPct}%`, background: progressGradient(overallPct) }}
              />
            </div>
            <span className="text-base font-bold text-accent">{overallPct}%</span>
          </div>
          {/* 씬 추가 버튼 (개별 모드) */}
          {selectedDepartment !== 'all' && currentPart && (
            <button
              onClick={() => { setAddTargetSheet(currentPart.sheetName); setShowAddScene(true); }}
              className="compact-label-container inline-flex min-w-0 shrink items-center justify-center px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 shadow-sm shadow-accent/20 transition-colors"
            >
              <CompactIconLabel icon={<Plus size={14} strokeWidth={2.5} />} label="씬 추가" />
            </button>
          )}
          {/* 씬 추가 버튼 (전체 모드: BG+ACT 동시 추가) */}
          {selectedDepartment === 'all' && (bgPart || actPart) && (
            <button
              onClick={() => { setAddTargetSheet('__both__'); setShowAddScene(true); }}
              className="compact-label-container inline-flex min-w-0 shrink items-center justify-center px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 shadow-sm shadow-accent/20 transition-colors cursor-pointer"
            >
              <CompactIconLabel icon={<Plus size={14} strokeWidth={2.5} />} label="씬 추가" />
            </button>
          )}
        </div>

        {isVisibleComplete && visibleCompletedMeta && (
          <div className="flex justify-end">
            <div
              className={cn(
                'inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                isLight
                  ? 'border-emerald-200/90 bg-white/90 text-emerald-700'
                  : 'border-emerald-400/20 bg-white/5 text-emerald-100',
              )}
              title={`${visibleCompletedMeta.completedBy}님 · ${visibleCompletedMeta.full}`}
            >
              <span className="text-text-secondary/70">마지막 완료</span>
              <span className="text-text-primary">{visibleCompletedMeta.completedBy}님</span>
              <span className="text-text-secondary/70">{visibleCompletedMeta.short}</span>
            </div>
          </div>
        )}
      </div>

      {/* 씬 추가 드로어 */}
      <AnimatePresence>
        {showAddScene && (
          <>
            {/* 백드롭 */}
            <motion.div
              key="add-scene-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-30 bg-overlay/40 backdrop-blur-sm"
              onClick={() => { setShowAddScene(false); setAddTargetSheet(null); }}
            />
            {/* 드로어 패널 */}
            <motion.div
              key="add-scene-drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 right-0 z-40 w-[420px] bg-bg-card border-l border-bg-border shadow-2xl flex flex-col"
            >
              <AddSceneForm
                existingSceneIds={(() => {
                  if (addTargetSheet === '__both__') {
                    const bgIds = (bgPart?.scenes ?? []).map((s) => s.sceneId);
                    const actIds = (actPart?.scenes ?? []).map((s) => s.sceneId);
                    return [...new Set([...bgIds, ...actIds])];
                  }
                  const targetPart = allParts.find((p) => p.sheetName === addTargetSheet);
                  return (targetPart?.scenes ?? currentPart?.scenes ?? []).map((s) => s.sceneId);
                })()}
                onSubmit={handleAddScene}
                onBulkSubmit={handleBulkAddScenes}
                onCancel={() => { setShowAddScene(false); setAddTargetSheet(null); }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 대량 씬 추가 로딩 오버레이 (Phase 0-5) */}
      {bulkAddLoading && (
        <div className="flex items-center justify-center py-8 gap-3">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-secondary">씬을 추가하고 있습니다...</span>
        </div>
      )}

      {/* ─── 'all' 모드: 통합 뷰 (카드/테이블/시트) ─── */}
      {selectedDepartment === 'all' ? (
        <div
          className={cn(
            'relative flex-1 min-h-0 overflow-auto',
            isVisibleComplete && 'rounded-[28px] border border-bg-border/40 bg-bg-card/20',
          )}
        >
          <AnimatePresence>
            {showCompletionOverlay && (
              <PartCompleteOverlay
                completedMeta={visibleCompletedMeta}
                onDismiss={() => {
                  if (!completionOverlayKey) return;
                  setDismissedCompletionOverlayKey(completionOverlayKey);
                }}
                onUndoLastAction={canUndoLastCompletionAction ? handleUndoLastCompletionAction : undefined}
              />
            )}
          </AnimatePresence>
          {showCompletionRestoreButton && (
            <CompletionRestoreButton onClick={() => setDismissedCompletionOverlayKey(null)} />
          )}
          <div className="relative z-10 flex h-full min-h-0 flex-col">
            {mergedScenes.length === 0 ? (
              <div className="text-sm text-text-secondary/50 text-center py-8">표시할 씬이 없습니다</div>
            ) : sceneViewMode === 'sheet' ? (
              <UnifiedSceneSheetView
                mergedScenes={mergedScenes}
                bgSheetName={bgPart?.sheetName ?? null}
                actSheetName={actPart?.sheetName ?? null}
                commentCounts={commentCounts}
                commentIdsByKey={commentIdsByKey}
                commentUnreadByKey={commentUnreadByKey}
                searchQuery={searchQuery}
                selectedSceneIds={selectedSceneIds}
                sceneGroupMode={sceneGroupMode}
                highlightSceneId={highlightSceneId}
                onToggle={(sheet, id, stage, sceneUuid, sceneIndex) =>
                  handleToggleForSheet(sheet, id, stage, { sceneUuid, sceneIndex })
                }
                onDelete={(sheet, idx) => handleDeleteSceneForSheet(sheet, idx)}
                onOpenDetail={(sheet, idx) => { setDetailContext({ sheetName: sheet, sceneIndex: idx }); setDetailSceneIndex(idx); }}
                onOpenMerged={(m) => setDetailMerged(m)}
                onFieldUpdate={(sheet, idx, field, value) => handleFieldUpdateForSheet(sheet, idx, field, value)}
                onCtrlClick={(id) => {
                  if (bgPart) toggleSelectedScene(`bg:${id}`);
                  if (actPart) toggleSelectedScene(`act:${id}`);
                }}
                onActPhaseStateClick={handleActPhaseStateClick}
                onActFeedbackRequest={handleActFeedbackRequest}
                onActRoundBump={handleActRoundBump}
                onAssigneeStageToggle={handleAssigneeStageToggle}
                onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
                onAssigneeActFeedbackRequest={handleActFeedbackRequest}
                onAssigneeActRoundBump={handleAssigneeActRoundBump}
              />
            ) : mergedLayoutGroups ? (
              <div className="flex flex-col gap-6">
                {mergedLayoutGroups.map(([layoutKey, group]) => (
                  <div key={layoutKey}>
                    <div className="flex items-center gap-2 mb-3">
                      <Layers size={14} className="text-text-secondary/50" />
                      <span className="text-sm font-semibold text-text-primary">
                        {layoutKey === '미분류' ? '미분류' : `L#${layoutKey}`}
                      </span>
                      <span className="text-[11px] text-text-secondary/40">{group.length}개</span>
                      <div className="flex-1 h-px bg-bg-border/30" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 px-2 py-3">
                      {group.map((m) => {
                        const primary = m.bgScene ?? m.actScene;
                        const commentBadgeCounts = getMergedCommentBadgeCounts(
                          m,
                          bgPart?.sheetName ?? null,
                          actPart?.sheetName ?? null,
                          commentCounts,
                          commentIdsByKey,
                        );
                        if (!primary) return null;
                        return (
                          <UnifiedSceneCard
                            key={m.mergedKey}
                            merged={m}
                            bgSheetName={bgPart?.sheetName ?? null}
                            actSheetName={actPart?.sheetName ?? null}
                            celebrating={matchesMergedSceneCelebration(m, celebratingTarget, bgPart?.sheetName ?? null, actPart?.sheetName ?? null)}
                            isHighlighted={matchesMergedSceneIdentity(m, highlightSceneId)}
                            isSelected={selectedSceneIds.has(`bg:${m.mergedKey}`) || selectedSceneIds.has(`act:${m.mergedKey}`)}
                            searchQuery={searchQuery}
                            bgCommentCount={commentBadgeCounts.bg}
                            actCommentCount={commentBadgeCounts.act}
                            totalCommentCount={commentBadgeCounts.total}
                            hasUnreadComments={hasMergedUnreadComments(m)}
                            onToggle={(sheet, id, stage, sceneUuid, sceneIndex) =>
                              handleToggleForSheet(sheet, id, stage, { sceneUuid, sceneIndex })
                            }
                            onDelete={(sheet, idx) => handleDeleteSceneForSheet(sheet, idx)}
                            onOpenDetail={(sheet, idx) => { setDetailContext({ sheetName: sheet, sceneIndex: idx }); setDetailSceneIndex(idx); }}
                            onOpenMerged={(merged, sourceElement) => {
                              setContinuitySourceElement(sourceElement ?? null);
                              setDetailMerged(merged);
                            }}
                            onCelebrationEnd={clearCelebration}
                            onSelect={() => {
                              const ids = new Set<string>();
                              if (bgPart) ids.add(`bg:${m.mergedKey}`);
                              if (actPart) ids.add(`act:${m.mergedKey}`);
                              setSelectedScenes(ids);
                            }}
                            onCtrlSelect={() => {
                              if (bgPart) toggleSelectedScene(`bg:${m.mergedKey}`);
                              if (actPart) toggleSelectedScene(`act:${m.mergedKey}`);
                            }}
                            onActPhaseStateClick={handleActPhaseStateClick}
                            onActFeedbackRequest={handleActFeedbackRequest}
                            onActRoundBump={handleActRoundBump}
                            onAssigneeStageToggle={handleAssigneeStageToggle}
                            onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
                            onAssigneeActFeedbackRequest={handleActFeedbackRequest}
                            onAssigneeActRoundBump={handleAssigneeActRoundBump}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 px-2 py-3 content-start">
                {mergedScenes.map((m) => {
                  const primary = m.bgScene ?? m.actScene;
                  const commentBadgeCounts = getMergedCommentBadgeCounts(
                    m,
                    bgPart?.sheetName ?? null,
                    actPart?.sheetName ?? null,
                    commentCounts,
                    commentIdsByKey,
                  );
                  if (!primary) return null;
                  return (
                    <UnifiedSceneCard
                      key={m.mergedKey}
                      merged={m}
                      bgSheetName={bgPart?.sheetName ?? null}
                      actSheetName={actPart?.sheetName ?? null}
                      celebrating={matchesMergedSceneCelebration(m, celebratingTarget, bgPart?.sheetName ?? null, actPart?.sheetName ?? null)}
                      isHighlighted={matchesMergedSceneIdentity(m, highlightSceneId)}
                      isSelected={selectedSceneIds.has(`bg:${m.mergedKey}`) || selectedSceneIds.has(`act:${m.mergedKey}`)}
                      searchQuery={searchQuery}
                      bgCommentCount={commentBadgeCounts.bg}
                      actCommentCount={commentBadgeCounts.act}
                      totalCommentCount={commentBadgeCounts.total}
                      hasUnreadComments={hasMergedUnreadComments(m)}
                      onToggle={(sheet, id, stage, sceneUuid, sceneIndex) =>
                        handleToggleForSheet(sheet, id, stage, { sceneUuid, sceneIndex })
                      }
                      onDelete={(sheet, idx) => handleDeleteSceneForSheet(sheet, idx)}
                      onOpenDetail={(sheet, idx) => { setDetailContext({ sheetName: sheet, sceneIndex: idx }); setDetailSceneIndex(idx); }}
                      onOpenMerged={(merged, sourceElement) => {
                        setContinuitySourceElement(sourceElement ?? null);
                        setDetailMerged(merged);
                      }}
                      onCelebrationEnd={clearCelebration}
                      onSelect={() => {
                        const ids = new Set<string>();
                        if (bgPart) ids.add(`bg:${m.mergedKey}`);
                        if (actPart) ids.add(`act:${m.mergedKey}`);
                        setSelectedScenes(ids);
                      }}
                      onCtrlSelect={() => {
                        if (bgPart) toggleSelectedScene(`bg:${m.mergedKey}`);
                        if (actPart) toggleSelectedScene(`act:${m.mergedKey}`);
                      }}
                      onActPhaseStateClick={handleActPhaseStateClick}
                      onActFeedbackRequest={handleActFeedbackRequest}
                      onActRoundBump={handleActRoundBump}
                      onAssigneeStageToggle={handleAssigneeStageToggle}
                      onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
                      onAssigneeActFeedbackRequest={handleActFeedbackRequest}
                      onAssigneeActRoundBump={handleAssigneeActRoundBump}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
      /* ─── 개별 모드: 기존 렌더링 ─── */
      <>
      {/* 씬 목록 */}
      <div
        className={cn(
          'relative flex-1 min-h-0 overflow-auto',
          isVisibleComplete && 'rounded-[28px] border border-bg-border/40 bg-bg-card/20'
        )}
      >
        {/* 파트 완료 보케 오버레이 */}
        <AnimatePresence>
          {showCompletionOverlay && (
            <PartCompleteOverlay
              completedMeta={visibleCompletedMeta}
              onDismiss={() => {
                if (!completionOverlayKey) return;
                setDismissedCompletionOverlayKey(completionOverlayKey);
              }}
              onUndoLastAction={canUndoLastCompletionAction ? handleUndoLastCompletionAction : undefined}
            />
          )}
        </AnimatePresence>
        {showCompletionRestoreButton && (
          <CompletionRestoreButton onClick={() => setDismissedCompletionOverlayKey(null)} />
        )}
        <div className="relative z-10 flex h-full min-h-0 flex-col">
          {scenes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-secondary h-full gap-2">
              {bulkAddLoading || useDataStore.getState().isSyncing ? (
                <>
                  <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-xs animate-pulse">데이터를 불러오는 중...</span>
                </>
              ) : (
                <span>표시할 씬이 없습니다.</span>
              )}
            </div>
          ) : sceneGroupMode === 'layout' && layoutGroups ? (
            sceneViewMode === 'sheet' ? (
              <div className="flex-1 overflow-auto">
                <SceneSheetView
                  scenes={scenes}
                  allScenes={currentPart?.scenes ?? []}
                  department={effectiveDept}
                  commentCounts={commentCounts}
                  commentUnreadByKey={commentUnreadByKey}
                  sheetName={currentPart?.sheetName ?? ''}
                  searchQuery={searchQuery}
                  selectedSceneIds={selectedSceneIds}
                  sceneGroupMode="layout"
                  highlightSceneId={highlightSceneId}
                  onToggle={handleToggle}
                  onActPhaseStateClick={handleActPhaseStateClick}
                  onActFeedbackRequest={handleActFeedbackRequest}
                  onActRoundBump={handleActRoundBump}
                  onAssigneeStageToggle={handleAssigneeStageToggle}
                  onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
                  onAssigneeActFeedbackRequest={handleActFeedbackRequest}
                  onAssigneeActRoundBump={handleAssigneeActRoundBump}
                  onDelete={handleDeleteScene}
                  onOpenDetail={(idx) => setDetailSceneIndex(idx)}
                  onFieldUpdate={handleFieldUpdate}
                  onCtrlClick={(id) => toggleSelectedScene(id)}
                />
              </div>
            ) : (
              <div className="flex-1 overflow-auto flex flex-col gap-4">
                {layoutGroups.map(([layoutKey, groupScenes]) => {
                  const groupTotal = groupScenes.length * 4;
                  const groupDone = groupScenes.reduce(
                    (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length, 0
                  );
                  const groupPct = groupTotal > 0 ? Math.round((groupDone / groupTotal) * 100) : 0;
                  const sceneIds = groupScenes.map((s) => s.sceneId).join(', ');

                  return (
                    <div key={layoutKey} className="flex flex-col gap-2">
                      <div className="flex items-center gap-3 bg-bg-card/50 border border-bg-border rounded-lg px-4 py-2">
                        <Layers size={14} className="text-accent" />
                        <span className="text-sm font-bold text-text-primary">
                          레이아웃 #{layoutKey}
                        </span>
                        <span className="text-xs text-text-secondary">
                          {sceneIds}
                        </span>
                        <div className="flex-1 h-1.5 bg-bg-primary rounded-full overflow-hidden ml-2">
                          <div
                            className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{
                              width: `${groupPct}%`,
                              background: progressGradient(groupPct),
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono text-text-secondary">{groupPct}%</span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 px-2 py-3">
                        {groupScenes.map((scene, idx) => {
                          const rawIdx = currentPart?.scenes.indexOf(scene) ?? -1;
                          const sIdx = rawIdx >= 0 ? rawIdx : idx;
                          const selectionId = buildSingleSceneSelectionId(currentPart?.sheetName ?? '', scene, sIdx);
                          return (
                            <SceneCard
                              key={buildSceneCardKey(currentPart?.sheetName, scene, sIdx)}
                              scene={scene}
                              sceneIndex={sIdx}
                              selectionId={selectionId}
                              celebrating={matchesSceneCelebration(currentPart?.sheetName, scene, sIdx, celebratingTarget)}
                              department={effectiveDept}
                              isHighlighted={highlightSceneId === scene.sceneId}
                              isSelected={selectedSceneIds.has(selectionId)}
                              searchQuery={searchQuery}
                              commentCount={commentCounts[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? 0}
                              hasUnreadComments={commentUnreadByKey[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? false}
                              revisionCount={revisionCountByScene[buildSceneKey(currentPart?.sheetName ?? '', scene.sceneId)] ?? 0}
                              sheetName={currentPart?.sheetName ?? ''}
                              fallbackStoryboardUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.storyboard ?? null}
                              fallbackGuideUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.guide ?? null}
                              onToggle={handleToggle}
                              onActPhaseStateClick={handleActPhaseStateClick}
                              onActFeedbackRequest={handleActFeedbackRequest}
                              onActRoundBump={handleActRoundBump}
                              onAssigneeStageToggle={handleAssigneeStageToggle}
                              onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
                              onAssigneeActFeedbackRequest={handleActFeedbackRequest}
                              onAssigneeActRoundBump={handleAssigneeActRoundBump}
                              onDelete={handleDeleteScene}
                              onOpenDetail={() => setDetailSceneIndex(sIdx)}
                              onCelebrationEnd={clearCelebration}
                              onCtrlClick={() => {
                                toggleSelectedScene(selectionId);
                                lastClickedIndexRef.current = idx;
                              }}
                              onShiftClick={() => {
                                const lastIdx = lastClickedIndexRef.current;
                                if (lastIdx !== null && lastIdx !== idx) {
                                  const from = Math.min(lastIdx, idx);
                                  const to = Math.max(lastIdx, idx);
                                  const rangeIds = new Set(selectedSceneIds);
                                  for (let i = from; i <= to; i++) {
                                    const rangeScene = groupScenes[i];
                                    if (rangeScene) {
                                      const rangeRawIdx = currentPart?.scenes.indexOf(rangeScene) ?? -1;
                                      const rangeIdx = rangeRawIdx >= 0 ? rangeRawIdx : i;
                                      rangeIds.add(buildSingleSceneSelectionId(currentPart?.sheetName ?? '', rangeScene, rangeIdx));
                                    }
                                  }
                                  setSelectedScenes(rangeIds);
                                } else {
                                  toggleSelectedScene(selectionId);
                                }
                                lastClickedIndexRef.current = idx;
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : sceneViewMode === 'sheet' ? (
            <div className="flex-1 overflow-auto">
              <SceneSheetView
                scenes={scenes}
                allScenes={currentPart?.scenes ?? []}
                department={effectiveDept}
                commentCounts={commentCounts}
                commentUnreadByKey={commentUnreadByKey}
                sheetName={currentPart?.sheetName ?? ''}
                searchQuery={searchQuery}
                selectedSceneIds={selectedSceneIds}
                sceneGroupMode="flat"
                highlightSceneId={highlightSceneId}
                onToggle={handleToggle}
                onActPhaseStateClick={handleActPhaseStateClick}
                onActFeedbackRequest={handleActFeedbackRequest}
                onActRoundBump={handleActRoundBump}
                onAssigneeStageToggle={handleAssigneeStageToggle}
                onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
                onAssigneeActFeedbackRequest={handleActFeedbackRequest}
                onAssigneeActRoundBump={handleAssigneeActRoundBump}
                onDelete={handleDeleteScene}
                onOpenDetail={(idx) => setDetailSceneIndex(idx)}
                onFieldUpdate={handleFieldUpdate}
                onCtrlClick={(id) => toggleSelectedScene(id)}
              />
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 px-2 py-3 content-start">
              {scenes.map((scene, idx) => {
                const rawIdx = currentPart?.scenes.indexOf(scene) ?? -1;
                const sIdx = rawIdx >= 0 ? rawIdx : idx;
                const selectionId = buildSingleSceneSelectionId(currentPart?.sheetName ?? '', scene, sIdx);
                return (
                  <SceneCard
                    key={buildSceneCardKey(currentPart?.sheetName, scene, sIdx)}
                    scene={scene}
                    sceneIndex={sIdx}
                    selectionId={selectionId}
                    celebrating={matchesSceneCelebration(currentPart?.sheetName, scene, sIdx, celebratingTarget)}
                    department={effectiveDept}
                    isHighlighted={highlightSceneId === scene.sceneId}
                    isSelected={selectedSceneIds.has(selectionId)}
                    searchQuery={searchQuery}
                    commentCount={commentCounts[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? 0}
                    hasUnreadComments={commentUnreadByKey[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? false}
                    revisionCount={revisionCountByScene[buildSceneKey(currentPart?.sheetName ?? '', scene.sceneId)] ?? 0}
                    sheetName={currentPart?.sheetName ?? ''}
                    fallbackStoryboardUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.storyboard ?? null}
                    fallbackGuideUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.guide ?? null}
                    onToggle={handleToggle}
                    onActPhaseStateClick={handleActPhaseStateClick}
                    onActFeedbackRequest={handleActFeedbackRequest}
                    onActRoundBump={handleActRoundBump}
                    onAssigneeStageToggle={handleAssigneeStageToggle}
                    onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
                    onAssigneeActFeedbackRequest={handleActFeedbackRequest}
                    onAssigneeActRoundBump={handleAssigneeActRoundBump}
                    onDelete={handleDeleteScene}
                    onOpenDetail={() => setDetailSceneIndex(sIdx)}
                    onCelebrationEnd={clearCelebration}
                    onCtrlClick={() => {
                      toggleSelectedScene(selectionId);
                      lastClickedIndexRef.current = idx;
                    }}
                    onShiftClick={() => {
                      const lastIdx = lastClickedIndexRef.current;
                      if (lastIdx !== null && lastIdx !== idx) {
                        const from = Math.min(lastIdx, idx);
                        const to = Math.max(lastIdx, idx);
                        const rangeIds = new Set(selectedSceneIds);
                        for (let i = from; i <= to; i++) {
                          const rangeScene = scenes[i];
                          if (rangeScene) {
                            const rangeRawIdx = currentPart?.scenes.indexOf(rangeScene) ?? -1;
                            const rangeIdx = rangeRawIdx >= 0 ? rangeRawIdx : i;
                            rangeIds.add(buildSingleSceneSelectionId(currentPart?.sheetName ?? '', rangeScene, rangeIdx));
                          }
                        }
                        setSelectedScenes(rangeIds);
                      } else {
                        toggleSelectedScene(selectionId);
                      }
                      lastClickedIndexRef.current = idx;
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
      </>
      )}

      </>
      )}

      {/* 라쏘 드래그 선택 박스 */}
      {lassoRect && (
        <div
          className="lasso-box"
          style={{
            left: lassoRect.x,
            top: lassoRect.y,
            width: lassoRect.w,
            height: lassoRect.h,
          }}
        />
      )}

      {/* 일괄 작업 상태 floating 카드 */}
      <BulkOperationStatus />
      </div>{/* 진행도 + 씬 목록 영역 끝 */}

      {/* 일괄 액션 바 (선택된 씬이 있을 때) */}
      <AnimatePresence>
        {selectedSceneIds.size > 0 && (() => {
          // 사이드바 너비를 뺀 콘텐츠 영역의 정중앙 픽셀 좌표.
          // viewport 1996, 사이드바 64 → bulkBarLeftPx = 64 + (1996-64)/2 = 1030.
          // framer-motion 의 x:'-50%' 가 transform: translateX(-50%) 로 변환되며 정중앙 정렬.
          const sidebarW = sidebarExpanded ? 132 : 64;
          const bulkBarLeftPx = sidebarW + (viewportW - sidebarW) / 2;
          return (
          <motion.div
            // motion.div 에서는 style.transform 을 인라인으로 주면 motion 이 자기 transform 으로
            // 덮어써 무시되므로 (한솔 v1.27.0 보고), translateX 는 반드시 animate.x:'-50%' 로 위임.
            // 한솔 v1.27.0 보고: 존재감 부족 → 살짝 큰 스프링 entrance + bflow-bulk-bar-pulse glow.
            initial={{ opacity: 0, y: 30, scale: 0.92, left: bulkBarLeftPx, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, left: bulkBarLeftPx, x: '-50%' }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.45, ease: [0.22, 1.4, 0.36, 1] }}
            className="bflow-bulk-bar-pulse fixed bottom-6 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-3 overflow-x-auto px-5 py-2.5 rounded-xl"
            style={{
              background: 'rgb(var(--color-bg-card) / 0.95)',
              border: '1.5px solid rgb(var(--color-accent) / 0.55)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center gap-2 pr-3 border-r border-bg-border shrink-0">
              <CheckSquare size={14} className="text-accent" />
              <span className="text-xs font-medium text-text-primary whitespace-nowrap leading-none">
                {selectedSceneCount}개 선택
              </span>
            </div>

            {/* 일괄 스테이지 토글 */}
            {selectedDepartment === 'all' ? (
              <div className="flex flex-col gap-1">
                {/* BG 스테이지 */}
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: DEPARTMENT_CONFIGS.bg.color }} />
                  <span className="text-[11px] text-text-secondary leading-none whitespace-nowrap">{DEPARTMENT_CONFIGS.bg.shortLabel}</span>
                  {STAGES.map((stage) => (
                    <button
                      key={`bg-${stage}`}
                      onClick={() => handleBulkStageToggle(stage, 'bg')}
                      disabled={isBulkInFlight}
                      className="compact-label-container inline-flex h-7 min-w-0 shrink items-center justify-center px-2.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: `${DEPARTMENT_CONFIGS.bg.stageColors[stage]}20`,
                        color: DEPARTMENT_CONFIGS.bg.stageColors[stage],
                        border: `1px solid ${DEPARTMENT_CONFIGS.bg.stageColors[stage]}40`,
                      }}
                    >
                      <CompactIconLabel
                        icon={stageIcon(stage, 12)}
                        label={DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
                        className="w-full"
                        iconClassName="hidden 2xl:inline-flex"
                        iconPosition="after"
                      />
                    </button>
                  ))}
                </div>
                {/* ACT 단계 (v1.27.0) — SCENE_PHASES set 동작. 토글 아닌 직접 설정.
                    BG 행과 달리 SCENE_PHASE_COLORS 사용 (phase ≠ stage 라 의도적 비대칭). */}
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: DEPARTMENT_CONFIGS.acting.color }} />
                  <span className="text-[11px] text-text-secondary leading-none whitespace-nowrap">{DEPARTMENT_CONFIGS.acting.shortLabel}</span>
                  {SCENE_PHASES.map((phase) => (
                    <button
                      key={`act-${phase}`}
                      onClick={() => handleBulkActPhaseSet(phase)}
                      disabled={isBulkInFlight}
                      title={`선택된 액팅 씬을 모두 "${SCENE_PHASE_LABELS[phase]}" 로 설정`}
                      className="compact-label-container inline-flex h-7 min-w-0 shrink items-center justify-center px-2.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: `${SCENE_PHASE_COLORS[phase]}20`,
                        color: SCENE_PHASE_COLORS[phase],
                        border: `1px solid ${SCENE_PHASE_COLORS[phase]}40`,
                      }}
                    >
                      <CompactIconLabel
                        icon={phaseIcon(phase, 12)}
                        label={SCENE_PHASE_LABELS_SHORT[phase]}
                        className="w-full"
                        iconClassName="hidden 2xl:inline-flex"
                        iconPosition="after"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              STAGES.map((stage) => (
                <button
                  key={stage}
                  onClick={() => selectedDepartment === 'acting'
                    ? handleBulkActPhaseSet(phaseFromStage(stage))
                    : handleBulkStageToggle(stage)}
                  disabled={isBulkInFlight}
                  title={selectedDepartment === 'acting'
                    ? `선택된 액팅 씬을 모두 "${SCENE_PHASE_LABELS[phaseFromStage(stage)]}" 로 설정`
                    : undefined}
                  className="compact-label-container inline-flex h-7 min-w-0 shrink items-center justify-center px-2.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: `${deptConfig.stageColors[stage]}20`,
                    color: deptConfig.stageColors[stage],
                    border: `1px solid ${deptConfig.stageColors[stage]}40`,
                  }}
                >
                  <CompactIconLabel
                    icon={stageIcon(stage, 12)}
                    label={deptConfig.stageLabels[stage]}
                    className="w-full"
                    iconClassName="hidden 2xl:inline-flex"
                    iconPosition="after"
                  />
                </button>
              ))
            )}

            <div className="w-px h-5 bg-bg-border shrink-0" />

            {/* v1.16.0: 길이 변경 일괄 토글 */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-text-secondary leading-none whitespace-nowrap mr-0.5">길이</span>
              <button
                onClick={() => handleBulkLengthChange('LD')}
                disabled={isBulkInFlight}
                title="LD · Long Duration (길이 늘어남)"
                className="compact-label-container flex h-7 min-w-0 shrink items-center gap-1 rounded-md border border-length-up/30 bg-length-up/10 px-2 text-[11px] font-medium leading-none text-length-up transition-colors hover:bg-length-up/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CompactIconLabel icon={<LengthIcon kind="LD" size="sm" />} label="LD" />
              </button>
              <button
                onClick={() => handleBulkLengthChange('SD')}
                disabled={isBulkInFlight}
                title="SD · Short Duration (길이 줄어듦)"
                className="compact-label-container flex h-7 min-w-0 shrink items-center gap-1 rounded-md border border-length-down/30 bg-length-down/10 px-2 text-[11px] font-medium leading-none text-length-down transition-colors hover:bg-length-down/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CompactIconLabel icon={<LengthIcon kind="SD" size="sm" />} label="SD" />
              </button>
              <button
                onClick={() => handleBulkLengthChange(null)}
                disabled={isBulkInFlight}
                title="길이 변경 표시 해제"
                className="compact-label-container inline-flex h-7 min-w-0 shrink items-center justify-center rounded-md border border-bg-border bg-bg-border/30 px-2 text-[11px] font-medium leading-none text-text-secondary transition-colors hover:bg-bg-border/50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CompactIconLabel icon={<X size={12} strokeWidth={2.4} />} label="해제" />
              </button>
            </div>

            <div className="w-px h-5 bg-bg-border shrink-0" />

            {/* 일괄 편집 */}
            <button
              onClick={() => {
                // v1.27.0: 모달 열 때마다 현재 카드뷰의 부서 필터를 기본값으로 동기화.
                // 'all' 카드뷰 → 'all', 액팅 카드뷰 → 'acting', BG 카드뷰 → 'bg'.
                setBatchTargetDept(selectedDepartment as 'all' | 'bg' | 'acting');
                setBatchEditOpen(true);
              }}
              disabled={isBulkInFlight}
              className="compact-label-container inline-flex h-7 min-w-0 shrink items-center justify-center rounded-md border border-accent/20 bg-accent/10 px-3 text-[11px] font-medium leading-none text-accent transition-colors hover:bg-accent/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CompactIconLabel icon={<Pencil size={12} strokeWidth={2.4} />} label="편집" />
            </button>

            {/* 일괄 삭제 */}
            <button
              onClick={handleBulkDelete}
              disabled={isBulkInFlight}
              className="compact-label-container inline-flex h-7 min-w-0 shrink items-center justify-center rounded-md border border-red-500/20 bg-red-500/10 px-3 text-[11px] font-medium leading-none text-red-400 transition-colors hover:bg-red-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CompactIconLabel icon={<Trash2 size={12} strokeWidth={2.4} />} label="삭제" />
            </button>

            {/* 선택 해제 */}
            <button
              onClick={clearSelectedScenes}
              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-border/50 transition-colors cursor-pointer"
              title="선택 해제"
            >
              <X size={14} />
            </button>
          </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* 일괄 편집 모달 */}
      <AnimatePresence>
        {batchEditOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-sm"
            onClick={() => { setBatchEditOpen(false); setBatchAssigneeValue(''); setBatchAssigneeMode('replace'); }}
          >
              <motion.div
                initial={{ opacity: 0, scale: 0.93, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.93, y: 12 }}
                className="bg-bg-card rounded-2xl shadow-2xl border border-bg-border w-96"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
              <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
                <h3 className="text-sm font-bold text-text-primary">일괄 편집 ({selectedSceneCount}개 씬)</h3>
                <button onClick={() => { setBatchEditOpen(false); setBatchAssigneeValue(''); setBatchAssigneeMode('replace'); }} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer">
                  <X size={16} />
                </button>
              </div>

              {/* v1.27.0: 적용 대상 부서 토글 — 통합 뷰에서 BG/ACT 동시 선택돼 있어도 한쪽만 편집 가능.
                  코덱스 3차 P1 fix: 단일 부서 뷰 (BG/ACT) 에서는 반대 부서 토글을 disable —
                  selection 이 plain id 라 어차피 효과 없고 오해만 부름. */}
              <div className="px-5 pt-4">
                <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider block mb-1.5">적용 대상</label>
                <div className="flex gap-1.5">
                  {(['all', 'bg', 'acting'] as const).map((dept) => {
                    const isUnifiedView = selectedDepartment === 'all';
                    // 단일 부서 뷰에서는 현재 보이는 부서만 정확히 편집한다. '둘 다'는 통합 뷰 전용.
                    const disabled = !isUnifiedView && dept !== selectedDepartment;
                    return (
                      <button
                        key={dept}
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && setBatchTargetDept(dept)}
                        className={cn(
                          'flex-1 py-1.5 text-[11px] font-medium rounded-md border transition-colors',
                          batchTargetDept === dept
                            ? 'bg-accent/20 border-accent/40 text-accent-sub'
                            : 'bg-bg-primary border-bg-border text-text-secondary hover:text-text-primary hover:border-bg-border/80',
                          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                        )}
                        title={
                          disabled
                            ? `현재 ${selectedDepartment === 'bg' ? 'BG' : '액팅'} 뷰에서는 사용할 수 없는 옵션입니다`
                            : dept === 'all'
                              ? '선택된 씬의 BG·ACT 양쪽 모두 편집'
                              : dept === 'bg'
                                ? '선택된 씬의 BG 만 편집 (ACT 는 무시)'
                                : '선택된 씬의 ACT 만 편집 (BG 는 무시)'
                        }
                      >
                        {dept === 'all' ? '둘 다' : dept === 'bg' ? 'BG만' : 'ACT만'}
                      </button>
                    );
                  })}
                </div>
              </div>

              <form
                className="p-5 pt-3 flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const assignee = batchAssigneeValue.trim();
                  const memo = (form.elements.namedItem('batchMemo') as HTMLInputElement).value.trim();
                  const layoutId = (form.elements.namedItem('batchLayout') as HTMLInputElement).value.trim();

                  if (!assignee && !memo && !layoutId) {
                    setBatchEditOpen(false);
                    return;
                  }

                  // 모달 닫기 전에 선택 스냅샷 확보 (clearSelectedScenes 이후엔 비어있음)
                  const selectionSnapshot = new Set(selectedSceneIds);
                  setBatchEditOpen(false);
                  setBatchAssigneeValue('');
                  clearSelectedScenes();

                  void handleBulkEditSubmit(
                    {
                      assignee: assignee || undefined,
                      assigneeMode: batchAssigneeMode,
                      memo: memo || undefined,
                      layoutId: layoutId || undefined,
                      targetDept: batchTargetDept,
                    },
                    selectionSnapshot,
                  );
                }}
              >
                <div>
                  <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider">담당자 (비어있으면 건너뜀)</label>
                  <AssigneeSelect
                    value={batchAssigneeValue}
                    onChange={setBatchAssigneeValue}
                    placeholder="담당자"
                    className="mt-1"
                  />
                  {/* v1.27.0: 교체 vs 추가 토글. assignee 입력했을 때만 의미 있으므로 입력 시 표시. */}
                  {batchAssigneeValue.trim() && (
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setBatchAssigneeMode('replace')}
                        className={cn(
                          'flex-1 py-1.5 text-[11px] font-medium rounded-md border transition-colors cursor-pointer',
                          batchAssigneeMode === 'replace'
                            ? 'bg-accent/20 border-accent/40 text-accent-sub'
                            : 'bg-bg-primary border-bg-border text-text-secondary hover:text-text-primary hover:border-bg-border/80',
                        )}
                        title="기존 담당자를 무시하고 새 담당자로 덮어쓰기"
                      >
                        교체
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchAssigneeMode('append')}
                        className={cn(
                          'flex-1 py-1.5 text-[11px] font-medium rounded-md border transition-colors cursor-pointer',
                          batchAssigneeMode === 'append'
                            ? 'bg-accent/20 border-accent/40 text-accent-sub'
                            : 'bg-bg-primary border-bg-border text-text-secondary hover:text-text-primary hover:border-bg-border/80',
                        )}
                        title="기존 담당자 뒤에 새 담당자를 콤마로 이어붙이기 (중복은 자동 제거)"
                      >
                        추가
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider">메모 (비어있으면 건너뜀)</label>
                  <input name="batchMemo" className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" placeholder="메모" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider">레이아웃 (비어있으면 건너뜀)</label>
                  <input name="batchLayout" className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" placeholder="레이아웃 ID" />
                </div>
                <button type="submit" className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/80 text-white transition-colors cursor-pointer">
                  일괄 적용
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 씬 상세 모달 */}
      {detailScene && detailSceneIdx !== null && (() => {
        // 필터링된 씬 목록에서 현재/이전/다음 씬의 원본 인덱스를 계산
        const detailPartScenes = (() => {
          if (detailContext) {
            const part = allParts.find((p) => p.sheetName === detailContext.sheetName);
            return part?.scenes ?? [];
          }
          return currentPart?.scenes ?? [];
        })();
        const detailFilteredScenes = filterAndSortScenes(detailPartScenes);
        const filteredIndices = detailFilteredScenes
          .map((s) => detailPartScenes.indexOf(s))
          .filter((i) => i >= 0);
        const posInFiltered = filteredIndices.indexOf(detailSceneIdx);
        const hasPrev = posInFiltered > 0;
        const hasNext = posInFiltered >= 0 && posInFiltered < filteredIndices.length - 1;
        const counterpart = (() => {
          const currentDetailPart = allParts.find((p) => p.sheetName === detailSheetName);
          if (!currentDetailPart) return null;
          const otherDept: Department = currentDetailPart.department === 'bg' ? 'acting' : 'bg';
          const otherPart = findPartById(allParts, currentDetailPart.partId, otherDept);
          if (!otherPart) return null;
          // 정규화된 sceneId 키로 매칭 (예: ac001 ↔ a001)
          const targetKey = normalizeSceneIdKey(detailScene.sceneId, currentDetailPart.partId);
          const match = otherPart.scenes.find((s) => normalizeSceneIdKey(s.sceneId, otherPart.partId) === targetKey);
          return match ? { sheetName: otherPart.sheetName, sceneNo: match.no, scene: match } : null;
        })();
        const bgImageForAct = detailDept === 'acting' && counterpart?.scene
          ? { storyboard: counterpart.scene.storyboardUrl, guide: counterpart.scene.guideUrl }
          : null;

        return (
          <SceneDetailModal
            scene={detailScene}
            sceneIndex={detailSceneIdx}
            sheetName={detailSheetName}
            department={detailDept}
            counterpartSheetName={counterpart?.sheetName ?? null}
            counterpartSceneNo={counterpart?.sceneNo ?? null}
            readOnlyStoryboardUrl={bgImageForAct?.storyboard ?? null}
            readOnlyGuideUrl={bgImageForAct?.guide ?? null}
            onFieldUpdate={(idx, field, value) => handleFieldUpdateForSheet(detailSheetName, idx, field, value)}
            onToggle={(id, stage) => handleToggleForSheet(detailSheetName, id, stage)}
            onActPhaseStateClick={handleActPhaseStateClick}
            onActFeedbackRequest={handleActFeedbackRequest}
            onActRoundBump={handleActRoundBump}
            onAssigneeStageToggle={handleAssigneeStageToggle}
            onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
            onAssigneeActFeedbackRequest={handleActFeedbackRequest}
            onAssigneeActRoundBump={handleAssigneeActRoundBump}
            onClose={() => { setDetailSceneIndex(null); setDetailContext(null); setModalRouting(null); }}
            initialTab={modalRouting?.initialTab}
            focusRevisionId={modalRouting?.focusRevisionId}
            focusCommentId={modalRouting?.focusCommentId}
            focusRevisionCommentId={modalRouting?.focusRevisionCommentId}
            hasPrev={hasPrev}
            hasNext={hasNext}
            totalScenes={filteredIndices.length}
            currentSceneIndex={posInFiltered >= 0 ? posInFiltered : 0}
            onNavigate={(dir) => {
              if (posInFiltered < 0) return;
              const nextPos = dir === 'prev' ? posInFiltered - 1 : posInFiltered + 1;
              if (nextPos >= 0 && nextPos < filteredIndices.length) {
                const newIdx = filteredIndices[nextPos];
                setDetailSceneIndex(newIdx);
                if (detailContext) setDetailContext({ ...detailContext, sceneIndex: newIdx });
              }
            }}
          />
        );
      })()}

      {detailMerged && selectedDepartment === 'all' && (() => {
        const curIdx = mergedScenes.findIndex((m) => m.mergedKey === detailMerged.mergedKey);
        const hasPrev = curIdx > 0;
        const hasNext = curIdx >= 0 && curIdx < mergedScenes.length - 1;
        return (
          <UnifiedSceneDetailModal
            merged={detailMerged}
            bgSheetName={bgPart?.sheetName ?? null}
            actSheetName={actPart?.sheetName ?? null}
            partLabel={currentPartId ? `${currentPartId}파트` : undefined}
            episodeLabel={selectedEpisode != null ? `EP ${selectedEpisode}` : undefined}
            hasPrev={hasPrev}
            hasNext={hasNext}
            currentMergedIndex={curIdx >= 0 ? curIdx : 0}
            totalMerged={mergedScenes.length}
            initialTab={modalRouting?.initialTab}
            focusRevisionId={modalRouting?.focusRevisionId}
            focusCommentId={modalRouting?.focusCommentId}
            focusRevisionCommentId={modalRouting?.focusRevisionCommentId}
            onClose={() => { setDetailMerged(null); setModalRouting(null); clearContinuitySource(); }}
            onToggle={(sheet, id, stage) => handleToggleForSheet(sheet, id, stage)}
            onFieldUpdate={(sheet, idx, field, value) => handleFieldUpdateForSheet(sheet, idx, field, value)}
            onDeleteDept={(sheet, idx) => handleDeleteSceneForSheet(sheet, idx)}
            onDeleteBoth={async () => {
              const targets: { sheet: string; idx: number; uuid: string }[] = [];
              if (detailMerged.bgScene?.id && bgPart?.sheetName) {
                targets.push({ sheet: bgPart.sheetName, idx: detailMerged.bgSceneIndex, uuid: detailMerged.bgScene.id });
              }
              if (detailMerged.actScene?.id && actPart?.sheetName) {
                targets.push({ sheet: actPart.sheetName, idx: detailMerged.actSceneIndex, uuid: detailMerged.actScene.id });
              }
              if (targets.length === 0) return;
              const prevEpisodes = useDataStore.getState().episodes;
              targets.sort((a, b) => b.idx - a.idx);
              targets.forEach((target) => deleteSceneOptimistic(target.sheet, target.idx));
              try {
                await Promise.all(targets.map((target) => deleteSceneFromSupabase(target.uuid)));
                syncInBackground();
              } catch (err) {
                setEpisodes(prevEpisodes);
                handleSheetError(err, '씬 삭제');
                syncInBackground();
              }
            }}
            onAddDept={async (dept) => {
              const targetPart = dept === 'bg' ? bgPart : actPart;
              if (!targetPart?.sheetName) {
                sonnerToast.error(`${dept === 'bg' ? 'BG' : 'ACT'} 파트가 존재하지 않습니다. 먼저 파트를 만들어 주세요.`);
                return;
              }
              const targetSceneId = buildUnifiedSceneId(mergedScenePartId, detailMerged.sceneId);
              // 중복 방지: 공통 씬번호 기준으로 이미 있으면 스킵
              const existing = targetPart.scenes.find((scene) =>
                buildUnifiedSceneId(mergedScenePartId, scene.sceneId) === targetSceneId,
              );
              if (existing) {
                sonnerToast.error(`이미 ${dept === 'bg' ? 'BG' : 'ACT'} 쪽에 "${targetSceneId}" 씬이 있습니다.`);
                return;
              }
              try {
                await addScene(targetPart.sheetName, targetSceneId, '', '');
                await syncInBackground();
              } catch (err) {
                handleSheetError(err, '씬 추가');
              }
            }}
            onNavigate={(dir) => {
              if (curIdx < 0) return;
              const nextIdx = dir === 'prev' ? curIdx - 1 : curIdx + 1;
              if (nextIdx >= 0 && nextIdx < mergedScenes.length) {
                setDetailMerged(mergedScenes[nextIdx]);
              }
            }}
            onActPhaseStateClick={handleActPhaseStateClick}
            onActFeedbackRequest={handleActFeedbackRequest}
            onActRoundBump={handleActRoundBump}
            onAssigneeStageToggle={handleAssigneeStageToggle}
            onAssigneeActPhaseStateClick={handleAssigneeActPhaseStateClick}
            onAssigneeActFeedbackRequest={handleActFeedbackRequest}
            onAssigneeActRoundBump={handleAssigneeActRoundBump}
            continuitySourceElement={continuitySourceElement}
            onContinuityEnd={clearContinuitySource}
          />
        );
      })()}

      {/* 파트 컨텍스트 메뉴 */}
      {partMenuPos && partMenuTarget && (
        <ContextMenu
          position={partMenuPos}
          onClose={() => { closePartMenu(); setPartMenuTarget(null); }}
          items={[
            {
              label: '릴 담당 편집',
              icon: <UserRound size={12} />,
              onClick: () => {
                setPartReelWorkerInput(getPartReelWorkerText(partMenuTarget.sheetNames));
                setEditingPartReelWorker(partMenuTarget);
              },
            },
            {
              label: '메모 편집',
              icon: <StickyNote size={12} />,
              onClick: () => {
                setPartMemoInput(getPartMemoText(partMenuTarget.sheetNames));
                setEditingPartMemo(partMenuTarget);
              },
            },
            {
              label: '파트 삭제',
              icon: <Trash2 size={12} />,
              danger: true,
              disabled: partMenuTarget.sheetNames.length === 0,
              onClick: () => {
                if (partMenuTarget.sheetNames.length > 0) {
                  handleDeletePartsForSheets(partMenuTarget.sheetNames);
                }
              },
            },
          ]}
        />
      )}

      {/* 파트 릴 담당 인라인 편집 */}
      {editingPartReelWorker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 backdrop-blur-sm"
          onClick={() => setEditingPartReelWorker(null)}
        >
          <div
            className="bg-bg-card rounded-xl shadow-2xl border border-bg-border w-80 p-4 flex flex-col gap-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-text-primary">{editingPartReelWorker.partId}파트 릴 담당</h3>
            <input
              autoFocus
              value={partReelWorkerInput}
              onChange={(e) => setPartReelWorkerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEditingPartReelWorker(editingPartReelWorker, partReelWorkerInput);
                if (e.key === 'Escape') setEditingPartReelWorker(null);
              }}
              placeholder="릴 담당을 입력하세요"
              className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            {editingPartReelWorker.sheetNames.length > 1 && (
              <p className="text-[11px] text-text-secondary/70 leading-relaxed">
                전체 모드에서는 연결된 BG/ACT 파트에 같은 릴 담당이 함께 저장됩니다.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingPartReelWorker(null)}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => handleSaveEditingPartReelWorker(editingPartReelWorker, partReelWorkerInput)}
                className="px-3 py-1.5 text-xs text-white bg-accent rounded-lg hover:bg-accent/80 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 파트 메모 인라인 편집 */}
      {editingPartMemo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 backdrop-blur-sm"
          onClick={() => setEditingPartMemo(null)}
        >
          <div
            className="bg-bg-card rounded-xl shadow-2xl border border-bg-border w-80 p-4 flex flex-col gap-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-text-primary">{editingPartMemo.partId}파트 메모</h3>
            <input
              autoFocus
              value={partMemoInput}
              onChange={(e) => setPartMemoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEditingPartMemo(editingPartMemo, partMemoInput);
                if (e.key === 'Escape') setEditingPartMemo(null);
              }}
              placeholder="파트 메모를 입력하세요"
              className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            {editingPartMemo.sheetNames.length > 1 && (
              <p className="text-[11px] text-text-secondary/70 leading-relaxed">
                전체 모드에서는 연결된 BG/ACT 파트에 같은 메모가 함께 저장됩니다.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingPartMemo(null)}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => handleSaveEditingPartMemo(editingPartMemo, partMemoInput)}
                className="px-3 py-1.5 text-xs text-white bg-accent rounded-lg hover:bg-accent/80 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 에피소드 편집 팝업 */}
      {epEditOpen && currentEp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 backdrop-blur-sm"
          onClick={() => setEpEditOpen(false)}
        >
          <div
            className="bg-bg-card rounded-xl shadow-2xl border border-bg-border w-80 p-4 flex flex-col gap-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-text-primary">
              {episodeTitles[currentEp.episodeNumber] || currentEp.title} 관리
            </h3>
            <div>
              <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider">에피소드 제목</label>
              <input
                autoFocus
                value={epTitleInput}
                onChange={(e) => setEpTitleInput(e.target.value)}
                placeholder="에피소드 이름 (비우면 기본값)"
                className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider">메모</label>
              <input
                value={epMemo}
                onChange={(e) => setEpMemo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEpEdit(epTitleInput, epMemo);
                  if (e.key === 'Escape') setEpEditOpen(false);
                }}
                placeholder="에피소드 메모"
                className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div className="flex gap-2 justify-between">
              <div className="flex gap-1">
                <button
                  onClick={handleDeleteEpisode}
                  className="px-2.5 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/20 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="에피소드 삭제 (숨김 처리)"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEpEditOpen(false)}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => handleSaveEpEdit(epTitleInput, epMemo)}
                  className="px-3 py-1.5 text-xs text-white bg-accent rounded-lg hover:bg-accent/80 transition-colors"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 에피소드 추가 모달 */}
      {addEpOpen && (
        <AddEpisodeModal
          newEpName={newEpName}
          setNewEpName={setNewEpName}
          onConfirm={handleConfirmAddEpisode}
          onClose={() => setAddEpOpen(false)}
        />
      )}
      </div>{/* 메인 콘텐츠 영역 끝 */}

      {/* ── 에피소드 우클릭 컨텍스트 메뉴 ── */}
      {epContextMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setEpContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setEpContextMenu(null); }} />
          <div
            className="fixed z-[9999] bg-bg-card border border-bg-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: epContextMenu.x, top: epContextMenu.y }}
          >
            <button
              onClick={() => {
                const epNum = epContextMenu.epNum;
                setEpContextMenu(null);
                openArchiveDialog(epNum);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors cursor-pointer"
            >
              <Archive size={13} className="text-amber-400" />
              아카이빙하기
            </button>
            <button
              onClick={() => {
                const epNum = epContextMenu.epNum;
                setEpContextMenu(null);
                handleTreeEpisodeEdit(epNum);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-bg-primary hover:text-text-primary transition-colors cursor-pointer"
            >
              <Pencil size={13} />
              에피소드 편집
            </button>
          </div>
        </>
      )}

      {/* ── 아카이빙 확인 다이얼로그 (메모 입력) ── */}
      {archiveDialogEpNum != null && (() => {
        const ep = episodes.find((e) => e.episodeNumber === archiveDialogEpNum);
        const epDisplayName = episodeTitles[archiveDialogEpNum] || ep?.title || `EP.${String(archiveDialogEpNum).padStart(2, '0')}`;
        return (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-overlay/50" onClick={() => setArchiveDialogEpNum(null)}>
            <div className="bg-bg-card rounded-xl border border-bg-border shadow-2xl p-5 w-[360px]" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Archive size={16} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">에피소드 아카이빙</h3>
                  <p className="text-xs text-text-secondary/60">{epDisplayName}</p>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-[11px] font-semibold text-text-secondary/60 uppercase tracking-wider">아카이빙 메모</label>
                <input
                  value={archiveMemoInput}
                  onChange={(e) => setArchiveMemoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleArchiveConfirm();
                    if (e.key === 'Escape') setArchiveDialogEpNum(null);
                  }}
                  placeholder="완료로 인한 아카이빙"
                  className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-amber-400"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setArchiveDialogEpNum(null)}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleArchiveConfirm}
                  className="px-3 py-1.5 text-xs text-white bg-amber-500 rounded-lg hover:bg-amber-500/80 transition-colors"
                >
                  아카이빙
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* v1.25.0~ 액팅 피드백 대기 확인 모달 */}
      {feedbackModal && (
        <FeedbackRequestModal
          open={feedbackModal.open}
          scene={feedbackModal.assigneeName ? { ...feedbackModal.scene, assignee: feedbackModal.assigneeName } : feedbackModal.scene}
          episodeLabel={`EP${String(feedbackModal.episodeNumber).padStart(2, '0')}`}
          targetRound={targetFeedbackRound}
          fromLabel={fromStateLabel}
          onCancel={() => setFeedbackModal(null)}
          onSendWithNotification={sendFeedbackWithNotification}
          onSilentChange={silentChangeToFeedback}
        />
      )}
    </div>
  );
}
