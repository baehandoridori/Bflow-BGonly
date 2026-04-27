import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { toast as sonnerToast } from 'sonner';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import type { SortKey, StatusFilter, ViewMode } from '@/stores/useAppStore';
import { STAGES, DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import type { Scene, Stage, Department, ScenesDeptFilter, MergedScene } from '@/types';
import { sceneProgress, isFullyDone, isNotStarted, progressGradient } from '@/utils/calcStats';
import { normalizeSceneIdKey } from '@/utils/sceneIdKey';
import {
  buildUnifiedSceneId,
  getMergedCommentBadgeCounts,
  matchesMergedSceneIdentity,
} from '@/utils/mergedSceneHelpers';
import { getAllViewCompletionState, getSingleViewCompletionState } from '@/utils/visibleCompletion';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, LayoutGrid, Grid3x3, Layers, List, ChevronUp, ChevronDown, ClipboardPaste, ImagePlus, ArrowLeft, CheckSquare, Trash2, X, MessageCircle, Pencil, MoreVertical, StickyNote, Archive, Film } from 'lucide-react';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';
import { HighlightText } from '@/components/common/HighlightText';
import { EpisodeTreeNav } from '@/components/scenes/EpisodeTreeNav';
import { SceneSheetView } from '@/components/scenes/SceneSheetView';
import { UnifiedSceneCard } from '@/components/scenes/UnifiedSceneCard';
import { UnifiedSceneSheetView } from '@/components/scenes/UnifiedSceneSheetView';
import { UnifiedSceneDetailModal } from '@/components/scenes/UnifiedSceneDetailModal';
import { BulkOperationStatus } from '@/components/scenes/BulkOperationStatus';
import { useAuthStore } from '@/stores/useAuthStore';
import { setCommentsSheetsMode, loadPartComments, invalidatePartCache } from '@/services/commentService';
import { setRevisionsSheetsMode, buildSceneKey } from '@/services/revisionService';
import { useRevisionStore } from '@/stores/useRevisionStore';
import type { PartContextMenuTarget } from '@/utils/partMemoHelpers';
import { usePartMemos } from '@/hooks/usePartMemos';
import { useUnifiedScenes } from '@/hooks/useUnifiedScenes';
import { loadPreferences, savePreferences, type UserPreferences } from '@/services/settingsService';

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
function PartCompleteOverlay({ completedMeta }: {
  completedMeta?: ReturnType<typeof formatCompletedMeta>;
}) {
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';
  const flowRibbons = [
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
  ];
  const flowTraces = [
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
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-20 pointer-events-none overflow-hidden rounded-[28px]"
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

      <div className="absolute inset-0 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="relative max-w-[560px] overflow-hidden rounded-[30px] border px-7 py-6 text-center"
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
          </div>
        </motion.div>
      </div>

      {completedMeta && (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-4 left-4 right-4"
        >
          <div
            className="relative overflow-hidden rounded-[24px] border px-4 py-3 backdrop-blur-xl sm:px-5"
            style={{
              background: isLight
                ? 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(247,255,252,0.78) 100%)'
                : 'linear-gradient(180deg, rgba(20,26,35,0.84) 0%, rgba(14,19,27,0.78) 100%)',
              borderColor: isLight ? 'rgba(191, 219, 254, 0.62)' : 'rgba(148, 163, 184, 0.18)',
              boxShadow: isLight
                ? '0 16px 44px rgba(15, 23, 42, 0.10), 0 4px 18px rgba(56, 189, 248, 0.12)'
                : '0 18px 46px rgba(0, 0, 0, 0.24), 0 4px 20px rgba(108, 92, 231, 0.12)',
            }}
          >
            <motion.div
              className="absolute inset-y-0 -left-1/4 w-1/4"
              style={{
                background: isLight
                  ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(191,219,254,0.44) 50%, rgba(255,255,255,0) 100%)'
                  : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(125,211,252,0.16) 50%, rgba(255,255,255,0) 100%)',
                filter: 'blur(10px)',
              }}
              animate={{ x: ['0%', '520%'] }}
              transition={{ duration: 6.2, repeat: Infinity, ease: 'linear' }}
            />
            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-medium tracking-[0.18em] text-text-secondary/70">마지막 완료</span>
                <span className="truncate text-lg font-semibold text-text-primary">{completedMeta.completedBy}님</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1 sm:items-end">
                <span className="text-[11px] font-medium tracking-[0.18em] text-text-secondary/70">완료 시각</span>
                <span
                  className="text-sm font-medium text-text-primary/90 sm:text-base"
                  title={`${completedMeta.completedBy}님 · ${completedMeta.full}`}
                >
                  {completedMeta.full}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
import {
  updateCell,
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
import type { BulkStageUpdate, BulkFieldUpdate } from '@/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useBulkOperationsStore } from '@/stores/useBulkOperationsStore';
import {
  runBulkOp,
  resolveSelectedUuids,
  resolveSelectedScenes,
} from '@/utils/bulkOperations';
import { ContextMenu, useContextMenu } from '@/components/ui/ContextMenu';
import { cn } from '@/utils/cn';
import { Confetti } from '@/components/ui/Confetti';
import { SceneDetailModal } from '@/components/scenes/SceneDetailModal';
import { GlassDropdown } from '@/components/common/GlassDropdown';
import { PanelLeftOpen } from 'lucide-react';
import {
  loadPersistedSceneViewMode, savePersistedSceneViewMode,
  loadPersistedLastEpisode, savePersistedLastEpisode,
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
  revisionCount?: number;
  selectionId?: string;  // 'all' 모드에서 부서 접두사 포함된 고유 ID (라쏘/선택용)
  fallbackStoryboardUrl?: string | null;
  fallbackGuideUrl?: string | null;
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: () => void;
  onCelebrationEnd: () => void;
  onCtrlClick?: () => void;
  onShiftClick?: () => void;
}

function SceneCard({ scene, sceneIndex, celebrating, department, isHighlighted, isSelected, searchQuery, commentCount = 0, revisionCount = 0, selectionId, fallbackStoryboardUrl, fallbackGuideUrl, onToggle, onDelete, onOpenDetail, onCelebrationEnd, onCtrlClick, onShiftClick }: SceneCardProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];
  const pct = sceneProgress(scene);
  const storyboardUrl = scene.storyboardUrl || fallbackStoryboardUrl || '';
  const guideUrl = scene.guideUrl || fallbackGuideUrl || '';
  const hasImages = !!(storyboardUrl || guideUrl);

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

      {/* 선택 체크마크 */}
      {isSelected && (
        <div className="absolute top-1.5 right-1.5 z-20 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-sm shadow-accent/30">
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
            <span className="text-[12px] italic font-medium text-accent-sub shrink-0">
              L#{scene.layoutId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {commentCount > 0 && (
            <span className="flex items-center gap-0.5 bg-accent/15 text-accent px-1.5 py-0.5 rounded-full" title={`의견 ${commentCount}개`}>
              <MessageCircle size={10} fill="currentColor" />
              <span className="text-[10px] font-bold leading-none">{commentCount}</span>
            </span>
          )}
          {revisionCount > 0 && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(108, 92, 231, 0.15)', color: '#A599F5' }} title={`리비전 ${revisionCount}건`}>
              <Film size={10} />
              <span className="text-[10px] font-bold leading-none">{revisionCount}</span>
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
        <div className="flex rounded-lg bg-bg-primary/70 border border-bg-border/40 p-1 gap-0.5">
          {STAGES.map((stage, i) => {
            const isDone = scene[stage];
            const isCurrent = isDone && (i === STAGES.length - 1 || !scene[STAGES[i + 1]]);

            return (
              <button
                key={stage}
                onClick={(e) => { e.stopPropagation(); onToggle(scene.sceneId, stage); }}
                className={cn(
                  'flex-1 text-center py-2 text-[11px] font-medium rounded-md transition-all cursor-pointer',
                  !isDone && 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-border/25',
                )}
                style={
                  isDone
                    ? isCurrent
                      ? { backgroundColor: deptConfig.color, color: '#fff', fontWeight: 700, boxShadow: `0 2px 8px ${deptConfig.color}40` }
                      : { backgroundColor: `${deptConfig.color}20`, color: deptConfig.color }
                    : undefined
                }
              >
                {deptConfig.stageLabels[stage]}
              </button>
            );
          })}
        </div>
        <Confetti active={celebrating} onComplete={onCelebrationEnd} />
      </div>
    </motion.div>
  );
}

// ─── 씬 추가 폼 ────────────────────────────────────────────────

const ALPHABET_PREFIXES = 'abcdefghijklmnopqrstuvwx'.split('');

type PrefixMode = 'alphabet' | 'sc' | 'custom';

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
  const [prefixMode, setPrefixMode] = useState<PrefixMode>('alphabet');
  const [alphaPrefix, setAlphaPrefix] = useState('a');
  const [customPrefix, setCustomPrefix] = useState('');
  const [number, setNumber] = useState(() => suggestNextNumber('a', existingSceneIds));
  const [assignee, setAssignee] = useState('');
  const [memo, setMemo] = useState('');
  const [layoutId, setLayoutId] = useState('');
  const [sbImage, setSbImage] = useState('');
  const [guideImage, setGuideImage] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkEnd, setBulkEnd] = useState('');

  const prefix = prefixMode === 'alphabet' ? alphaPrefix : prefixMode === 'sc' ? 'sc' : customPrefix;
  const sceneId = `${prefix}${number}`;
  const isDuplicate = existingSceneIds.includes(sceneId);

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
    if (isDuplicate || !prefix) return;

    if (bulkMode) {
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
    }

    setAssignee('');
    setMemo('');
    setLayoutId('');
    setSbImage('');
    setGuideImage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isDuplicate) handleSubmit();
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
        {/* 1) 접두사 & 씬 번호 */}
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] text-text-secondary font-medium">접두사 & 씬 번호</span>
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
              onClick={() => setBulkMode(!bulkMode)}
              className={cn(
                'px-3 py-2 text-xs rounded-lg font-medium transition-colors cursor-pointer',
                bulkMode ? 'bg-accent/20 text-accent border border-accent/30' : 'text-text-secondary/50 hover:text-text-primary border border-bg-border',
              )}
            >
              일괄
            </button>
            {bulkMode && (
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

          {/* ID 미리보기 뱃지 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-lg">
              <span className="text-[11px] text-accent/60">ID</span>
              <span className="text-sm text-accent font-mono font-bold">{sceneId}</span>
            </div>
            {isDuplicate && (
              <span className="text-[11px] text-red-400 bg-red-500/10 px-2 py-1 rounded-md font-medium">중복된 ID</span>
            )}
          </div>
        </div>

        {/* 2) 이미지 슬롯 */}
        {!bulkMode && (
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
            disabled={isDuplicate || !prefix || (bulkMode && !bulkEnd)}
            className={cn(
              'px-5 py-2 text-white text-xs font-medium rounded-lg transition-all cursor-pointer',
              isDuplicate || !prefix || (bulkMode && !bulkEnd)
                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                : 'bg-accent hover:bg-accent/90 shadow-sm shadow-accent/25 hover:shadow-md hover:shadow-accent/30',
            )}
          >
            {bulkMode ? '일괄 추가' : '+ 추가'}
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
  const toggleSceneStage = useDataStore((s) => s.toggleSceneStage);
  const addEpisodeOptimistic = useDataStore((s) => s.addEpisodeOptimistic);
  const addPartOptimistic = useDataStore((s) => s.addPartOptimistic);
  const addSceneOptimistic = useDataStore((s) => s.addSceneOptimistic);
  const deleteSceneOptimistic = useDataStore((s) => s.deleteSceneOptimistic);
  const updateSceneFieldOptimistic = useDataStore((s) => s.updateSceneFieldOptimistic);
  const setEpisodes = useDataStore((s) => s.setEpisodes);
  const { selectedEpisode, selectedPart, selectedAssignee, searchQuery, selectedDepartment } = useAppStore();
  const colorMode = useAppStore((s) => s.colorMode);
  const revisionCountByScene = useRevisionStore((s) => s.revisionCountByScene);
  const { sortKey, sortDir, statusFilter, sceneViewMode, sceneGroupMode } = useAppStore();
  const { setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSearchQuery, setSelectedDepartment } = useAppStore();
  const { setSortKey, setSortDir, setStatusFilter, setSceneViewMode, setSceneGroupMode } = useAppStore();
  const { previousView, setView, highlightSceneId, setHighlightSceneId } = useAppStore();
  const { selectedSceneIds, toggleSelectedScene, setSelectedScenes, clearSelectedScenes } = useAppStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isBulkInFlight = useBulkOperationsStore((s) => s.activeOp?.status === 'in-flight');
  const isLight = colorMode === 'light';

  // 글로우 CSS 주입 + 하이라이트 자동 해제 (3.6초 후)
  useEffect(() => {
    if (highlightSceneId) {
      ensureGlowCss();
      const timer = setTimeout(() => setHighlightSceneId(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [highlightSceneId, setHighlightSceneId]);

  const deletePartOptimistic = useDataStore((s) => s.deletePartOptimistic);
  const deleteEpisodeOptimistic = useDataStore((s) => s.deleteEpisodeOptimistic);

  const [showAddScene, setShowAddScene] = useState(false);
  const [bulkAddLoading, setBulkAddLoading] = useState(false);
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchAssigneeValue, setBatchAssigneeValue] = useState('');
  // treeOpen 초기값 — 영속화된 값이 있으면 그걸로, 없으면 true (디폴트 펼침)
  const [treeOpen, setTreeOpen] = useState(() => loadPersistedTreeOpen() ?? true);

  // 마운트 시 / episodes 가 처음 채워지는 시점에 영속화된 상태(viewMode + lastEpisode) 1회 복원.
  // ref guard 로 한솔이 직접 변경한 값이 첫 마운트 때 saved 로 되돌아가지 않게 보장.
  const persistRestoredRef = useRef(false);
  useEffect(() => {
    if (persistRestoredRef.current) return;
    if (episodes.length === 0) return; // episodes 가 늦게 로드될 때까지 대기

    const savedMode = loadPersistedSceneViewMode();
    if (savedMode) setSceneViewMode(savedMode);

    const savedEp = loadPersistedLastEpisode();
    if (savedEp !== null && episodes.some((ep) => ep.episodeNumber === savedEp)) {
      setSelectedEpisode(savedEp);
    }

    persistRestoredRef.current = true;
  }, [episodes, setSceneViewMode, setSelectedEpisode]);

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

  const clearCelebration = useCallback(() => setCelebratingId(null), []);
  const [detailSceneIndex, setDetailSceneIndex] = useState<number | null>(null);
  const [sceneControlsCollapsedByContext, setSceneControlsCollapsedByContext] = useState<Record<string, boolean>>({});
  const scenePrefsRef = useRef<UserPreferences | null>(null);

  // 리비전 초기 로드
  const loadRevisions = useRevisionStore((s) => s.loadRevisions);

  // 댓글 + 리비전 모드 설정 (항상 시트 모드)
  useEffect(() => {
    setCommentsSheetsMode(true);
    setRevisionsSheetsMode(true);
    loadRevisions();
    return () => { invalidatePartCache(); };
  }, []);

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
    return [...new Set(parts.map((p) => p.partId))];
  }, [parts]);

  // 'all' 모드에서 현재 partId 도출
  const currentPartId = selectedDepartment === 'all'
    ? (uniquePartIds.includes(selectedPart ?? '') ? selectedPart : (uniquePartIds[0] ?? null))
    : null;

  // 'all' 모드: bgPart + actPart 분리
  const bgPart = selectedDepartment === 'all'
    ? allParts.find((p) => p.partId === currentPartId && p.department === 'bg') ?? null
    : null;
  const actPart = selectedDepartment === 'all'
    ? allParts.find((p) => p.partId === currentPartId && p.department === 'acting') ?? null
    : null;

  // 개별 모드: 기존 currentPart
  const currentPart = selectedDepartment !== 'all' && parts.length > 0
    ? (parts.find((p) => p.partId === selectedPart) ?? parts[0])
    : (bgPart ?? actPart ?? undefined);  // 'all' 모드 fallback (기존 로직 호환)
  const mergedScenePartId = currentPartId ?? bgPart?.partId ?? actPart?.partId ?? '';
  const {
    partMemos,
    getPartMemoText,
    buildPartContextMenuTarget,
    savePartMemo,
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

  // 딥링크 처리: bflow://scene/sheetName/sceneId → 해당 씬 모달 자동 오픈
  // sceneId는 씬번호(예: a003) 또는 씬 인덱스(예: 12) 모두 지원
  const pendingDeepLink = useAppStore((s) => s.pendingDeepLink);
  const setPendingDeepLink = useAppStore((s) => s.setPendingDeepLink);
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
            setSelectedEpisode(ep.episodeNumber);
            setDetailContext({ sheetName, sceneIndex });
            setPendingDeepLink(null);
            return;
          }
        }
      }
    }
    console.warn('[DeepLink] 씬을 찾을 수 없음:', pendingDeepLink);
    console.warn('[DeepLink] 전체 시트:', episodes.flatMap(ep => ep.parts.map(p => p.sheetName)));
    setPendingDeepLink(null);
  }, [pendingDeepLink, episodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // 댓글 카운트 로드 (currentPart 또는 bgPart/actPart 정의 후).
  // 주의: 이 함수 내부에서 invalidatePartCache 를 호출하면 'bflow:comments-invalidated' 이벤트가
  // 발화되어 아래 리스너가 다시 이 함수를 호출하는 무한 루프가 발생한다. 캐시 무효화는
  // 소스(댓글 add/edit/delete, 씬 삭제 핸들러, App.tsx Realtime 처리) 쪽에서만 책임진다.
  const reloadCommentCounts = useCallback(() => {
    const sheetsToLoad = selectedDepartment === 'all'
      ? [bgPart?.sheetName, actPart?.sheetName].filter(Boolean) as string[]
      : currentPart ? [currentPart.sheetName] : [];

    sheetsToLoad.forEach((sheetName) => {
      loadPartComments(sheetName).then((store) => {
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
      }).catch(() => {});
    });
  }, [selectedDepartment, bgPart?.sheetName, actPart?.sheetName, currentPart?.sheetName]);

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
    scenes = scenes.filter((s) => s.assignee === selectedAssignee);
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
        // sceneId에서 숫자 추출하여 정렬 (a001→1, sc010→10)
        const aNum = parseInt(a.sceneId?.match(/\d+$/)?.[0] || '0', 10) || a.no;
        const bNum = parseInt(b.sceneId?.match(/\d+$/)?.[0] || '0', 10) || b.no;
        cmp = aNum - bNum;
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
  const filterAndSortScenes = useCallback((rawScenes: Scene[]): Scene[] => {
    let result = rawScenes;
    if (selectedAssignee) result = result.filter((s) => s.assignee === selectedAssignee);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) =>
        (s.sceneId || '').toLowerCase().includes(q) ||
        (s.memo || '').toLowerCase().includes(q) ||
        (s.assignee || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'done') result = result.filter(isFullyDone);
    else if (statusFilter === 'not-started') result = result.filter(isNotStarted);
    else if (statusFilter === 'in-progress') result = result.filter((s) => !isFullyDone(s) && !isNotStarted(s));

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'no': {
          const aNum = parseInt(a.sceneId?.match(/\d+$/)?.[0] || '0', 10) || a.no;
          const bNum = parseInt(b.sceneId?.match(/\d+$/)?.[0] || '0', 10) || b.no;
          cmp = aNum - bNum;
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
  const bgScenes = useMemo(() => bgPart ? filterAndSortScenes(bgPart.scenes) : [], [bgPart, filterAndSortScenes]);
  const actScenes = useMemo(() => actPart ? filterAndSortScenes(actPart.scenes) : [], [actPart, filterAndSortScenes]);

  // 'all' 모드: 합산 진행률
  const allModeScenes = useMemo(() => [...bgScenes, ...actScenes], [bgScenes, actScenes]);

  // 'all' 모드: BG+ACT 씬 머지
  const { allMergedScenes, mergedScenes, detailMerged, setDetailMerged } = useUnifiedScenes({
    selectedDepartment,
    bgPart,
    actPart,
    bgScenes,
    actScenes,
    mergedScenePartId,
    sortKey,
    sortDir,
  });

  // ACT 단독 뷰에서는 대응하는 BG 이미지를 폴백으로 사용한다.
  const actToBgImageMap = useMemo(() => {
    if (selectedDepartment !== 'acting') return null;
    const bgSibling = allParts.find(
      (p) => p.partId === (currentPart?.partId ?? '') && p.department === 'bg',
    );
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
      ).map((s) => s.assignee).filter(Boolean)
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
  const visibleCompletionState = useMemo(
    () => (selectedDepartment === 'all'
      ? getAllViewCompletionState(mergedScenes)
      : getSingleViewCompletionState(scenes)),
    [mergedScenes, scenes, selectedDepartment],
  );
  const isVisibleComplete = visibleCompletionState.isComplete;
  const visibleCompletedMeta = useMemo(
    () => formatCompletedMeta(
      visibleCompletionState.completedMeta?.completedAt,
      visibleCompletionState.completedMeta?.completedBy,
    ),
    [visibleCompletionState.completedMeta],
  );
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
  const handleToggleForSheet = (sheetName: string, sceneId: string, stage: Stage) => {
    if (!currentEp) return;

    // 현재 스토어에서 최신 씬 상태 직접 조회 (stale closure 방지)
    const latestPart = useDataStore.getState().episodes
      .flatMap((ep) => ep.parts)
      .find((p) => p.sheetName === sheetName);
    if (!latestPart) return;

    const scene = latestPart.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) return;

    const newValue = !scene[stage];
    const sceneIndex = latestPart.scenes.findIndex((s) => s.sceneId === sceneId);
    if (sceneIndex < 0) return;
    const completionMeta = (() => {
      const prevCompletedBy = scene.completedBy ?? '';
      const prevCompletedAt = scene.completedAt ?? '';
      if (newValue) {
        const afterToggle = { ...scene, [stage]: true };
        if (!afterToggle.lo || !afterToggle.done || !afterToggle.review || !afterToggle.png) return null;
        return {
          nextCompletedBy: currentUser?.name ?? '알 수 없음',
          nextCompletedAt: new Date().toISOString(),
          prevCompletedBy,
          prevCompletedAt,
        };
      }
      if (!prevCompletedBy && !prevCompletedAt) return null;
      return {
        nextCompletedBy: '',
        nextCompletedAt: '',
        prevCompletedBy,
        prevCompletedAt,
      };
    })();

    // 낙관적 업데이트 — 즉시 UI 반영
    toggleSceneStage(sheetName, sceneId, stage);

    // 완료 축하 애니메이션 + 완료 기록: 방금 토글로 4단계 모두 완료 시
    if (completionMeta) {
      if (completionMeta.nextCompletedBy && completionMeta.nextCompletedAt) {
        setCelebratingId(sceneId);
      }
      updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', completionMeta.nextCompletedBy);
      updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', completionMeta.nextCompletedAt);
    }

    // API 호출을 큐에 넣어 순차 실행 (race condition 방지)
    toggleQueueRef.current = toggleQueueRef.current.then(async () => {
      try {
        await updateCell(sheetName, sceneIndex, stage, newValue, currentUser?.id);
        window.electronAPI?.dataNotifyChange?.({
          type: 'toggle',
          sheetName,
          sceneId,
          field: stage,
          value: newValue,
        });
      } catch (err) {
        console.error('[토글 실패]', err);
        toggleSceneStage(sheetName, sceneId, stage);
        if (completionMeta) {
          updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', completionMeta.prevCompletedBy);
          updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', completionMeta.prevCompletedAt);
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
  const handleToggle = (sceneId: string, stage: Stage) => {
    if (!currentPart) return;
    handleToggleForSheet(currentPart.sheetName, sceneId, stage);
  };

  // 일괄 stage 토글: 선택된 씬들을 RPC 한 번에 처리 (Tasks 13-17)
  const handleBulkStageToggle = async (stage: Stage, onlyDept?: 'bg' | 'acting') => {
    const targetScenes = resolveSelectedScenes(selectedSceneIds, allMergedScenes, onlyDept, currentPart);
    if (targetScenes.length === 0) return;

    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name ?? '알 수 없음';

    const updates: BulkStageUpdate[] = targetScenes.map((s) => {
      const currentValue = Boolean(s[stage]);
      const newValue = !currentValue;
      const wasAllDone = Boolean(s.lo && s.done && s.review && s.png);
      const afterToggle = { lo: s.lo, done: s.done, review: s.review, png: s.png, [stage]: newValue };
      const willBeAllDone = Boolean(
        afterToggle.lo && afterToggle.done && afterToggle.review && afterToggle.png,
      );

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

      return {
        sceneUuid: s.id!, // resolveSelectedScenes가 id 있는 것만 반환
        stage,
        value: newValue,
        completedBy,
        completedAt,
      };
    });

    // 로컬 store 반영용 맵 — null(해제)은 빈 문자열로, string(설정)은 값 그대로
    const completedMetaByUuid = new Map<string, { completedBy: string; completedAt: string }>();
    const stageValueByUuid = new Map<string, boolean>();
    for (const u of updates) {
      stageValueByUuid.set(u.sceneUuid, u.value);
      if (u.completedBy === null && u.completedAt === null) {
        completedMetaByUuid.set(u.sceneUuid, { completedBy: '', completedAt: '' });
      } else if (u.completedBy && u.completedAt) {
        completedMetaByUuid.set(u.sceneUuid, { completedBy: u.completedBy, completedAt: u.completedAt });
      }
    }

    await runBulkOp(
      'stage-toggle',
      updates.map((u) => u.sceneUuid),
      // retry 시 전달받은 uuids 부분집합만 재전송 (이미 성공한 씬의 값 덮어쓰기 방지)
      (uuidsToSend) => {
        const set = new Set(uuidsToSend);
        const subset = updates.filter((u) => set.has(u.sceneUuid));
        return bulkUpdateSceneStages(subset, currentUser?.id ?? '');
      },
      { targetStage: stage, completedMetaByUuid, stageValueByUuid },
    );
  };

  // 일괄 삭제: ConfirmDialog → RPC 경유, runBulkOp가 낙관적 제거 처리 (Tasks 13-17)
  const handleBulkDelete = async () => {
    const uuids = resolveSelectedUuids(selectedSceneIds, allMergedScenes, currentPart);
    if (uuids.length === 0) return;

    const ok = await ConfirmDialog.show({
      message: `${uuids.length}개의 씬을 삭제하시겠습니까?`,
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

  // 일괄 편집: 선택된 씬들의 assignee/memo/layoutId를 RPC로 일괄 갱신 (Tasks 13-17)
  const handleBulkEditSubmit = async (
    payload: { assignee?: string; memo?: string; layoutId?: string },
    selectionSnapshot?: Set<string>,
  ) => {
    const fields: BulkFieldUpdate['fields'] = {};
    if (payload.assignee) fields.assignee = payload.assignee;
    if (payload.memo) fields.memo = payload.memo;
    if (payload.layoutId) fields.layoutId = payload.layoutId;
    if (!fields.assignee && !fields.memo && !fields.layoutId) return;

    const selection = selectionSnapshot ?? selectedSceneIds;
    const uuids = resolveSelectedUuids(selection, allMergedScenes, currentPart);
    if (uuids.length === 0) return;

    const updates: BulkFieldUpdate[] = uuids.map((uuid) => ({
      sceneUuid: uuid,
      fields,
    }));

    const fieldsByUuid = new Map<string, Partial<Scene>>();
    for (const uuid of uuids) {
      fieldsByUuid.set(uuid, fields);
    }

    await runBulkOp(
      'field-edit',
      uuids,
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
        (async () => {
          try {
            const { saveImage } = await import('@/utils/imageUtils');
            for (const sheet of sheets) {
              const latestPart2 = useDataStore.getState().episodes
                .flatMap((ep) => ep.parts)
                .find((p) => p.sheetName === sheet);
              const latestIndex = latestPart2?.scenes.findIndex((s) => s.sceneId === sceneId) ?? -1;
              if (latestIndex < 0) continue;
              if (images.storyboard) {
                const url = await saveImage(images.storyboard, sheet, sceneId, 'storyboard');
                handleFieldUpdateForSheet(sheet, latestIndex, 'storyboardUrl', url);
              }
              if (images.guide) {
                const url = await saveImage(images.guide, sheet, sceneId, 'guide');
                handleFieldUpdateForSheet(sheet, latestIndex, 'guideUrl', url);
              }
            }
          } catch (err) {
            console.error('[씬 추가 이미지 업로드 실패]', err);
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
      (async () => {
        try {
          const { saveImage } = await import('@/utils/imageUtils');
          const latestPart2 = useDataStore.getState().episodes
            .flatMap((ep) => ep.parts)
            .find((p) => p.sheetName === targetSheet);
          const latestIndex = latestPart2?.scenes.findIndex((s) => s.sceneId === sceneId) ?? -1;
          if (latestIndex < 0) return;

          if (images.storyboard) {
            const url = await saveImage(images.storyboard, targetSheet, sceneId, 'storyboard');
            handleFieldUpdateForSheet(targetSheet, latestIndex, 'storyboardUrl', url);
          }
          if (images.guide) {
            const url = await saveImage(images.guide, targetSheet, sceneId, 'guide');
            handleFieldUpdateForSheet(targetSheet, latestIndex, 'guideUrl', url);
          }
        } catch (err) {
          console.error('[씬 추가 이미지 업로드 실패]', err);
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

    try {
      await deleteSceneFromSupabase(sceneUuid);
      // CASCADE 로 DB 쪽 댓글/리비전은 이 시점에 확실히 사라졌으므로 캐시 무효화 + 이벤트 전파.
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
    if (!confirm(`${partLabel}파트를 삭제하시겠습니까?\n파트에 속한 모든 씬·댓글·리비전도 함께 정리됩니다.`)) return;

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
                  onClick={() => { setSelectedDepartment('all'); }}
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
                  onClick={() => { setSelectedDepartment(dept); }}
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
                      return uniquePartIds.map((pid) => ({
                        value: pid,
                        label: `${pid}파트${(() => {
                          const target = buildPartContextMenuTarget(pid);
                          const memo = target ? getPartMemoText(target.sheetNames) : '';
                          return memo ? ` (${memo})` : '';
                        })()}`,
                        sublabel: (() => {
                          const target = buildPartContextMenuTarget(pid);
                          return target ? (getPartMemoText(target.sheetNames) || undefined) : undefined;
                        })(),
                      }));
                    }
                    return parts.map((p) => ({
                      value: p.partId,
                      label: `${p.partId}파트${getPartMemoText([p.sheetName]) ? ` (${getPartMemoText([p.sheetName])})` : ''}`,
                      sublabel: getPartMemoText([p.sheetName]) || undefined,
                    }));
                  })()}
                  value={selectedPart ?? (uniquePartIds[0] ?? (parts[0]?.partId ?? null))}
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
                  minWidth={130}
                />

                <div className="w-px h-7 bg-bg-border" />

                {(['all', 'not-started', 'in-progress', 'done'] as StatusFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                      statusFilter === f
                        ? f === 'done' ? 'bg-green-500/20 text-green-400'
                          : f === 'not-started' ? 'bg-red-500/20 text-red-400'
                          : f === 'in-progress' ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-accent/20 text-accent'
                        : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {STATUS_FILTER_LABELS[f]}
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
            <div className="flex-1 h-2.5 bg-bg-primary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${overallPct}%`, background: progressGradient(overallPct) }}
              />
            </div>
            <span className="text-base font-bold text-accent">{overallPct}%</span>
          </div>
          {/* 씬 추가 버튼 (개별 모드) */}
          {selectedDepartment !== 'all' && currentPart && (
            <button
              onClick={() => { setAddTargetSheet(currentPart.sheetName); setShowAddScene(true); }}
              className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 shadow-sm shadow-accent/20 transition-colors"
            >
              + 씬 추가
            </button>
          )}
          {/* 씬 추가 버튼 (전체 모드: BG+ACT 동시 추가) */}
          {selectedDepartment === 'all' && (bgPart || actPart) && (
            <button
              onClick={() => { setAddTargetSheet('__both__'); setShowAddScene(true); }}
              className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 shadow-sm shadow-accent/20 transition-colors cursor-pointer"
            >
              + 씬 추가
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
            {isVisibleComplete && <PartCompleteOverlay completedMeta={visibleCompletedMeta} />}
          </AnimatePresence>
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
                searchQuery={searchQuery}
                selectedSceneIds={selectedSceneIds}
                sceneGroupMode={sceneGroupMode}
                onToggle={(sheet, id, stage) => handleToggleForSheet(sheet, id, stage)}
                onDelete={(sheet, idx) => handleDeleteSceneForSheet(sheet, idx)}
                onOpenDetail={(sheet, idx) => { setDetailContext({ sheetName: sheet, sceneIndex: idx }); setDetailSceneIndex(idx); }}
                onOpenMerged={(m) => setDetailMerged(m)}
                onFieldUpdate={(sheet, idx, field, value) => handleFieldUpdateForSheet(sheet, idx, field, value)}
                onCtrlClick={(id) => {
                  if (bgPart) toggleSelectedScene(`bg:${id}`);
                  if (actPart) toggleSelectedScene(`act:${id}`);
                }}
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
                            celebrating={matchesMergedSceneIdentity(m, celebratingId)}
                            isHighlighted={matchesMergedSceneIdentity(m, highlightSceneId)}
                            isSelected={selectedSceneIds.has(`bg:${m.mergedKey}`) || selectedSceneIds.has(`act:${m.mergedKey}`)}
                            searchQuery={searchQuery}
                            bgCommentCount={commentBadgeCounts.bg}
                            actCommentCount={commentBadgeCounts.act}
                            totalCommentCount={commentBadgeCounts.total}
                            onToggle={(sheet, id, stage) => handleToggleForSheet(sheet, id, stage)}
                            onDelete={(sheet, idx) => handleDeleteSceneForSheet(sheet, idx)}
                            onOpenDetail={(sheet, idx) => { setDetailContext({ sheetName: sheet, sceneIndex: idx }); setDetailSceneIndex(idx); }}
                            onOpenMerged={(merged) => setDetailMerged(merged)}
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
                      celebrating={matchesMergedSceneIdentity(m, celebratingId)}
                      isHighlighted={matchesMergedSceneIdentity(m, highlightSceneId)}
                      isSelected={selectedSceneIds.has(`bg:${m.mergedKey}`) || selectedSceneIds.has(`act:${m.mergedKey}`)}
                      searchQuery={searchQuery}
                      bgCommentCount={commentBadgeCounts.bg}
                      actCommentCount={commentBadgeCounts.act}
                      totalCommentCount={commentBadgeCounts.total}
                      onToggle={(sheet, id, stage) => handleToggleForSheet(sheet, id, stage)}
                      onDelete={(sheet, idx) => handleDeleteSceneForSheet(sheet, idx)}
                      onOpenDetail={(sheet, idx) => { setDetailContext({ sheetName: sheet, sceneIndex: idx }); setDetailSceneIndex(idx); }}
                      onOpenMerged={(merged) => setDetailMerged(merged)}
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
          {isVisibleComplete && <PartCompleteOverlay completedMeta={visibleCompletedMeta} />}
        </AnimatePresence>
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
                  sheetName={currentPart?.sheetName ?? ''}
                  searchQuery={searchQuery}
                  selectedSceneIds={selectedSceneIds}
                  sceneGroupMode="layout"
                  onToggle={handleToggle}
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
                          return (
                            <SceneCard
                              key={`${scene.sceneId}-${idx}`}
                              scene={scene}
                              sceneIndex={sIdx}
                              celebrating={celebratingId === scene.sceneId}
                              department={effectiveDept}
                              isHighlighted={highlightSceneId === scene.sceneId}
                              isSelected={selectedSceneIds.has(scene.sceneId)}
                              searchQuery={searchQuery}
                              commentCount={commentCounts[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? 0}
                              revisionCount={revisionCountByScene[buildSceneKey(currentPart?.sheetName ?? '', scene.sceneId)] ?? 0}
                              fallbackStoryboardUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.storyboard ?? null}
                              fallbackGuideUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.guide ?? null}
                              onToggle={handleToggle}
                              onDelete={handleDeleteScene}
                              onOpenDetail={() => setDetailSceneIndex(sIdx)}
                              onCelebrationEnd={clearCelebration}
                              onCtrlClick={() => {
                                toggleSelectedScene(scene.sceneId);
                                lastClickedIndexRef.current = idx;
                              }}
                              onShiftClick={() => {
                                const lastIdx = lastClickedIndexRef.current;
                                if (lastIdx !== null && lastIdx !== idx) {
                                  const from = Math.min(lastIdx, idx);
                                  const to = Math.max(lastIdx, idx);
                                  const rangeIds = new Set(selectedSceneIds);
                                  for (let i = from; i <= to; i++) {
                                    if (groupScenes[i]) rangeIds.add(groupScenes[i].sceneId);
                                  }
                                  setSelectedScenes(rangeIds);
                                } else {
                                  toggleSelectedScene(scene.sceneId);
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
                sheetName={currentPart?.sheetName ?? ''}
                searchQuery={searchQuery}
                selectedSceneIds={selectedSceneIds}
                sceneGroupMode="flat"
                onToggle={handleToggle}
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
                return (
                  <SceneCard
                    key={`${scene.sceneId}-${idx}`}
                    scene={scene}
                    sceneIndex={sIdx}
                    celebrating={celebratingId === scene.sceneId}
                    department={effectiveDept}
                    isHighlighted={highlightSceneId === scene.sceneId}
                    isSelected={selectedSceneIds.has(scene.sceneId)}
                    searchQuery={searchQuery}
                    commentCount={commentCounts[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? 0}
                    revisionCount={revisionCountByScene[buildSceneKey(currentPart?.sheetName ?? '', scene.sceneId)] ?? 0}
                    fallbackStoryboardUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.storyboard ?? null}
                    fallbackGuideUrl={actToBgImageMap?.get(normalizeSceneIdKey(scene.sceneId, currentPart?.partId))?.guide ?? null}
                    onToggle={handleToggle}
                    onDelete={handleDeleteScene}
                    onOpenDetail={() => setDetailSceneIndex(sIdx)}
                    onCelebrationEnd={clearCelebration}
                    onCtrlClick={() => {
                      toggleSelectedScene(scene.sceneId);
                      lastClickedIndexRef.current = idx;
                    }}
                    onShiftClick={() => {
                      const lastIdx = lastClickedIndexRef.current;
                      if (lastIdx !== null && lastIdx !== idx) {
                        const from = Math.min(lastIdx, idx);
                        const to = Math.max(lastIdx, idx);
                        const rangeIds = new Set(selectedSceneIds);
                        for (let i = from; i <= to; i++) {
                          if (scenes[i]) rangeIds.add(scenes[i].sceneId);
                        }
                        setSelectedScenes(rangeIds);
                      } else {
                        toggleSelectedScene(scene.sceneId);
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
        {selectedSceneIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-xl shadow-2xl shadow-black/40"
            style={{
              background: 'rgb(var(--color-bg-card) / 0.95)',
              border: '1px solid rgb(var(--color-accent) / 0.3)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center gap-2 pr-3 border-r border-bg-border shrink-0">
              <CheckSquare size={14} className="text-accent" />
              <span className="text-xs font-medium text-text-primary whitespace-nowrap leading-none">
                {selectedSceneIds.size}개 선택
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
                      className="h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer leading-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: `${DEPARTMENT_CONFIGS.bg.stageColors[stage]}20`,
                        color: DEPARTMENT_CONFIGS.bg.stageColors[stage],
                        border: `1px solid ${DEPARTMENT_CONFIGS.bg.stageColors[stage]}40`,
                      }}
                    >
                      {DEPARTMENT_CONFIGS.bg.stageLabels[stage]}
                    </button>
                  ))}
                </div>
                {/* ACT 스테이지 */}
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: DEPARTMENT_CONFIGS.acting.color }} />
                  <span className="text-[11px] text-text-secondary leading-none whitespace-nowrap">{DEPARTMENT_CONFIGS.acting.shortLabel}</span>
                  {STAGES.map((stage) => (
                    <button
                      key={`act-${stage}`}
                      onClick={() => handleBulkStageToggle(stage, 'acting')}
                      disabled={isBulkInFlight}
                      className="h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer leading-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: `${DEPARTMENT_CONFIGS.acting.stageColors[stage]}20`,
                        color: DEPARTMENT_CONFIGS.acting.stageColors[stage],
                        border: `1px solid ${DEPARTMENT_CONFIGS.acting.stageColors[stage]}40`,
                      }}
                    >
                      {DEPARTMENT_CONFIGS.acting.stageLabels[stage]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              STAGES.map((stage) => (
                <button
                  key={stage}
                  onClick={() => handleBulkStageToggle(stage)}
                  disabled={isBulkInFlight}
                  className="h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer leading-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: `${deptConfig.stageColors[stage]}20`,
                    color: deptConfig.stageColors[stage],
                    border: `1px solid ${deptConfig.stageColors[stage]}40`,
                  }}
                >
                  {deptConfig.stageLabels[stage]}
                </button>
              ))
            )}

            <div className="w-px h-5 bg-bg-border shrink-0" />

            {/* 일괄 편집 */}
            <button
              onClick={() => setBatchEditOpen(true)}
              disabled={isBulkInFlight}
              className="h-7 px-3 text-[11px] font-medium rounded-md bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors cursor-pointer leading-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Pencil size={12} className="inline mr-1 align-middle" />
              편집
            </button>

            {/* 일괄 삭제 */}
            <button
              onClick={handleBulkDelete}
              disabled={isBulkInFlight}
              className="h-7 px-3 text-[11px] font-medium rounded-md bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer leading-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} className="inline mr-1 align-middle" />
              삭제
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
        )}
      </AnimatePresence>

      {/* 일괄 편집 모달 */}
      <AnimatePresence>
        {batchEditOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-sm"
            onClick={() => { setBatchEditOpen(false); setBatchAssigneeValue(''); }}
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
                <h3 className="text-sm font-bold text-text-primary">일괄 편집 ({selectedSceneIds.size}개 씬)</h3>
                <button onClick={() => { setBatchEditOpen(false); setBatchAssigneeValue(''); }} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer">
                  <X size={16} />
                </button>
              </div>
              <form
                className="p-5 flex flex-col gap-4"
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
                      memo: memo || undefined,
                      layoutId: layoutId || undefined,
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
          const otherPart = allParts.find(
            (p) => p.partId === currentDetailPart.partId && p.department === otherDept,
          );
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
            onClose={() => { setDetailSceneIndex(null); setDetailContext(null); }}
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
            onClose={() => setDetailMerged(null)}
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
    </div>
  );
}
