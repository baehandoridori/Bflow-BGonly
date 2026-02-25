import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import type { SortKey, StatusFilter, ViewMode } from '@/stores/useAppStore';
import { STAGES, DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import type { Scene, Stage, Department } from '@/types';
import { sceneProgress, isFullyDone, isNotStarted } from '@/utils/calcStats';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, LayoutGrid, Table2, Layers, List, ChevronUp, ChevronDown, ClipboardPaste, ImagePlus, Sparkles, ArrowLeft, CheckSquare, Trash2, X, MessageCircle, Pencil, MoreVertical, StickyNote, Archive } from 'lucide-react';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';
import { useAuthStore } from '@/stores/useAuthStore';
import { setCommentsSheetsMode, loadPartComments, invalidatePartCache } from '@/services/commentService';

/* ── 라쏘 드래그 선택 훅 ── */
interface LassoRect { x: number; y: number; w: number; h: number }

function useLassoSelection(
  containerRef: React.RefObject<HTMLElement | null>,
  cardSelector: string,
  getSceneId: (el: Element) => string | null,
  onSelectionChange: (ids: Set<string>) => void,
  enabled: boolean,
) {
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      // 버튼/인풋/select/체크박스 위에서는 라쏘 시작 안 함
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
      // 좌클릭만
      if (e.button !== 0) return;

      startRef.current = { x: e.clientX, y: e.clientY };
      isDragging.current = false;

      const onMouseMove = (me: MouseEvent) => {
        if (!startRef.current) return;
        const dx = me.clientX - startRef.current.x;
        const dy = me.clientY - startRef.current.y;
        // 5px 이상 이동해야 라쏘 시작 (클릭과 구분)
        if (!isDragging.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        isDragging.current = true;

        const x = Math.min(startRef.current.x, me.clientX);
        const y = Math.min(startRef.current.y, me.clientY);
        const w = Math.abs(dx);
        const h = Math.abs(dy);
        setLassoRect({ x, y, w, h });

        // 실시간으로 겹치는 카드 계산
        const cards = container.querySelectorAll(cardSelector);
        const selected = new Set<string>();
        cards.forEach((card) => {
          const rect = card.getBoundingClientRect();
          // 교차 판정
          if (
            rect.left < x + w &&
            rect.right > x &&
            rect.top < y + h &&
            rect.bottom > y
          ) {
            const id = getSceneId(card);
            if (id) selected.add(id);
          }
        });
        // 변경 시에만 콜백
        if (selected.size !== prevIds.current.size || ![...selected].every((id) => prevIds.current.has(id))) {
          prevIds.current = selected;
          onSelectionChange(selected);
        }
      };

      const onMouseUp = (me: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!isDragging.current) {
          // 단순 클릭이면 선택 해제 (Ctrl 없으면)
          if (!me.ctrlKey && !me.metaKey) {
            onSelectionChange(new Set());
            prevIds.current = new Set();
          }
        }
        startRef.current = null;
        isDragging.current = false;
        setLassoRect(null);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    container.addEventListener('mousedown', onMouseDown);
    return () => container.removeEventListener('mousedown', onMouseDown);
  }, [enabled, containerRef, cardSelector, getSceneId, onSelectionChange]);

  return { lassoRect, isSelecting: isDragging.current };
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
function progressGradient(pct: number): string {
  if (pct >= 100) return 'linear-gradient(90deg, rgba(0,184,148,1) 0%, rgba(46,213,174,1) 40%, rgba(85,239,196,1) 100%)';
  if (pct >= 75) return 'linear-gradient(90deg, rgba(253,203,110,1) 0%, rgba(129,194,129,1) 50%, rgba(0,184,148,1) 100%)';
  if (pct >= 50) return 'linear-gradient(90deg, rgba(225,112,85,1) 0%, rgba(239,158,98,1) 50%, rgba(253,203,110,1) 100%)';
  if (pct >= 25) return 'linear-gradient(90deg, rgba(255,107,107,1) 0%, rgba(240,110,96,1) 35%, rgba(225,112,85,1) 65%, rgba(253,203,110,1) 100%)';
  return 'linear-gradient(90deg, rgba(255,107,107,1) 0%, rgba(240,110,96,1) 50%, rgba(225,112,85,1) 100%)';
}

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

/* ── 파트 완료 오버레이 ── */
function PartCompleteOverlay() {
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-xl"
    >
      {/* 레이어 0: 오로라 메시 (부드러운 radial, 밴딩 없음) */}
      <AuroraMesh isLight={isLight} />

      {/* 레이어 1: 대형 소프트 보케 — 깊이감 */}
      <BokehOrbs count={5} minR={50} maxR={100} baseAlpha={isLight ? 0.22 : 0.12} drift={50} speed={10} />

      {/* 레이어 2: 중형 보케 */}
      <BokehOrbs count={8} minR={15} maxR={40} baseAlpha={isLight ? 0.35 : 0.2} drift={40} speed={7} />

      {/* 레이어 3: 소형 샤프 보케 — 전경 */}
      <BokehOrbs count={12} minR={4} maxR={12} baseAlpha={isLight ? 0.6 : 0.45} drift={25} speed={5} />

      {/* 완료 뱃지 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.6, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 160, damping: 12 }}
          className="relative"
        >
          {/* 뱃지 글로우 링 */}
          <motion.div
            className="absolute -inset-4 rounded-2xl"
            style={{
              background: isLight
                ? 'radial-gradient(ellipse, rgba(0,184,148,0.25) 0%, rgba(0,184,148,0.1) 40%, transparent 70%)'
                : 'radial-gradient(ellipse, rgba(0,184,148,0.15) 0%, rgba(0,184,148,0.05) 40%, transparent 70%)',
              filter: 'blur(10px)',
            }}
            animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.97, 1.03, 0.97] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* 뱃지 본체 */}
          <div
            className="relative flex items-center gap-3 px-7 py-3.5 rounded-xl backdrop-blur-md"
            style={{
              background: isLight ? 'rgba(255,255,255,0.88)' : 'rgba(26,29,39,0.92)',
              border: isLight ? '1px solid rgba(0,184,148,0.4)' : '1px solid rgba(0,184,148,0.35)',
              boxShadow: isLight
                ? '0 8px 32px rgba(0,184,148,0.18), 0 0 1px rgba(0,184,148,0.5), 0 2px 8px rgba(0,0,0,0.06)'
                : '0 8px 32px rgba(0,184,148,0.12), 0 0 1px rgba(0,184,148,0.4)',
            }}
          >
            <motion.div
              animate={{ rotate: [0, 12, -12, 0], scale: [1, 1.1, 1, 1.1, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Sparkles size={18} style={{ color: '#22C55E', filter: 'drop-shadow(0 0 4px rgba(34,197,94,0.5))' }} />
            </motion.div>
            <span
              className="text-sm font-bold"
              style={{
                background: 'linear-gradient(135deg, rgba(34,197,94,1) 0%, rgba(0,184,148,1) 50%, rgba(202,138,4,1) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              이 파트는 완료되었습니다!
            </span>
            <motion.div
              animate={{ rotate: [0, -12, 12, 0], scale: [1, 1.1, 1, 1.1, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
            >
              <Sparkles size={18} style={{ color: '#CA8A04', filter: 'drop-shadow(0 0 4px rgba(202,138,4,0.5))' }} />
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
import {
  updateSheetCell,
  addEpisodeToSheets,
  addPartToSheets,
  addSceneToSheets,
  deleteSceneFromSheets,
  updateSceneFieldInSheets,
  writeMetadataToSheets,
  readMetadataFromSheets,
  softDeletePartInSheets,
  softDeleteEpisodeInSheets,
  batchToSheets,
  batchActions,
  bulkUpdateCells,
} from '@/services/sheetsService';
import type { BatchAction } from '@/services/sheetsService';
import { ContextMenu, useContextMenu } from '@/components/ui/ContextMenu';
import { cn } from '@/utils/cn';
import { Confetti } from '@/components/ui/Confetti';
import { SceneDetailModal } from '@/components/scenes/SceneDetailModal';
import { EpisodeTreeNav } from '@/components/scenes/EpisodeTreeNav';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

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
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: () => void;
  onCelebrationEnd: () => void;
  onCtrlClick?: () => void;
  onShiftClick?: () => void;
}

function SceneCard({ scene, sceneIndex, celebrating, department, isHighlighted, isSelected, searchQuery, commentCount = 0, onToggle, onDelete, onOpenDetail, onCelebrationEnd, onCtrlClick, onShiftClick }: SceneCardProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];
  const pct = sceneProgress(scene);
  const hasImages = !!(scene.storyboardUrl || scene.guideUrl);

  const borderColor = pct >= 100 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct > 0 ? '#E17055' : 'rgb(var(--color-bg-border))';

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
      data-scene-id={scene.sceneId}
      className={cn(
        'bg-bg-card border border-bg-border rounded-lg flex flex-col group relative cursor-pointer hover:border-text-secondary/30 transition-colors',
        isHighlighted && 'scene-highlight',
        isSelected && 'scene-card-selected',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor, overflow: 'visible' }}
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

      {/* ── 상단: 씬 정보 ── */}
      <div className="px-2.5 pt-2 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-mono font-bold text-accent shrink-0">
            #{scene.sceneId ? (scene.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || scene.no) : scene.no}
          </span>
          <span className="text-xs text-text-primary truncate">
            <HighlightText text={scene.sceneId || '(씬번호 없음)'} query={searchQuery} />
          </span>
          {scene.layoutId && (
            <span className="text-[11px] italic text-text-secondary/70 shrink-0">
              - L#{scene.layoutId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-medium text-text-primary truncate max-w-[80px]">
            <HighlightText text={scene.assignee || ''} query={searchQuery} />
          </span>
          {commentCount > 0 && (
            <span
              className="flex items-center gap-0.5 bg-accent/20 text-accent px-1.5 py-0.5 rounded-full"
              title={`의견 ${commentCount}개`}
            >
              <MessageCircle size={11} fill="currentColor" />
              <span className="text-[11px] font-bold leading-none">{commentCount}</span>
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(sceneIndex); }}
            className="opacity-0 group-hover:opacity-100 text-xs text-status-none hover:text-red-400 transition-opacity"
            title="씬 삭제"
          >
            ×
          </button>
        </div>
      </div>

      {/* ── 가운데: 이미지 썸네일 ── */}
      {hasImages ? (
        <div className="flex gap-px bg-bg-border overflow-hidden">
          {scene.storyboardUrl && (
            <img
              src={scene.storyboardUrl}
              alt="SB"
              className="flex-1 h-28 object-contain bg-bg-primary min-w-0"
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          {scene.guideUrl && (
            <img
              src={scene.guideUrl}
              alt="Guide"
              className="flex-1 h-28 object-contain bg-bg-primary min-w-0"
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
        <div className="px-2.5 py-1 border-t border-bg-border/30">
          <p className="text-[11px] text-amber-400/70 leading-relaxed line-clamp-2">
            <HighlightText text={scene.memo} query={searchQuery} />
          </p>
        </div>
      )}

      {/* ── 하단: 체크박스 + 진행 바 ── */}
      <div className="px-2.5 pt-1.5 pb-2 flex flex-col gap-1.5 mt-auto">
        <div className="flex gap-1">
          {STAGES.map((stage) => (
            <button
              key={stage}
              onClick={(e) => { e.stopPropagation(); onToggle(scene.sceneId, stage); }}
              className={cn(
                'flex-1 py-0.5 rounded text-[11px] font-medium transition-all text-center',
                scene[stage]
                  ? 'text-bg-primary'
                  : 'bg-bg-primary text-text-secondary border border-bg-border hover:border-text-secondary'
              )}
              style={
                scene[stage]
                  ? { backgroundColor: deptConfig.stageColors[stage] }
                  : undefined
              }
            >
              {scene[stage] ? '✓' : ''}{deptConfig.stageLabels[stage]}
            </button>
          ))}
        </div>

        <div className="relative h-1 bg-bg-primary rounded-full overflow-visible">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${pct}%`,
              background: progressGradient(pct),
            }}
          />
          <Confetti active={celebrating} onComplete={onCelebrationEnd} />
        </div>
      </div>
    </motion.div>
  );
}

// ─── 테이블 뷰 ──────────────────────────────────────────────────

interface SceneTableProps {
  scenes: Scene[];
  allScenes: Scene[];
  department: Department;
  commentCounts: Record<string, number>;
  sheetName: string;
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: (sceneIndex: number) => void;
  searchQuery?: string;
  selectedSceneIds?: Set<string>;
  onCtrlClick?: (sceneId: string) => void;
}

/** 검색 하이라이트 CSS — 글로우 애니메이션 */
const SEARCH_HIGHLIGHT_CSS = `
@keyframes search-glow-pulse {
  0%   { box-shadow: 0 0 3px 1px rgba(var(--color-accent), 0.5), 0 0 8px 2px rgba(var(--color-accent), 0.3); }
  50%  { box-shadow: 0 0 6px 2px rgba(var(--color-accent), 0.7), 0 0 14px 4px rgba(var(--color-accent), 0.4); }
  100% { box-shadow: 0 0 3px 1px rgba(var(--color-accent), 0.5), 0 0 8px 2px rgba(var(--color-accent), 0.3); }
}
.search-highlight-text {
  background-color: rgba(var(--color-accent), 0.25);
  color: rgba(var(--color-accent), 1);
  font-weight: 600;
  padding: 1px 3px;
  border-radius: 3px;
  animation: search-glow-pulse 1.5s ease-in-out infinite;
  text-decoration: underline;
  text-decoration-color: rgba(var(--color-accent), 0.5);
  text-underline-offset: 2px;
}
`;
let searchHighlightCssInjected = false;
function ensureSearchHighlightCss() {
  if (searchHighlightCssInjected) return;
  const el = document.createElement('style');
  el.textContent = SEARCH_HIGHLIGHT_CSS;
  document.head.appendChild(el);
  searchHighlightCssInjected = true;
}

/** 검색어 하이라이트 — CSS 클래스 기반 글로우 */
function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query || !text) return <>{text}</>;
  const q = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;
  ensureSearchHighlightCss();
  return (
    <>
      {text.slice(0, idx)}
      <span className="search-highlight-text">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function SceneTable({ scenes, allScenes, department, commentCounts, sheetName, onToggle, onDelete, onOpenDetail, searchQuery, selectedSceneIds, onCtrlClick }: SceneTableProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];
  return (
    <div className="overflow-auto rounded-lg border border-bg-border">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="bg-bg-card border-b border-bg-border text-text-secondary text-xs">
            <th className="w-14 px-2 py-2 text-left font-medium">No</th>
            <th className="w-24 px-2 py-2 text-left font-medium">씬번호</th>
            <th className="w-20 px-2 py-2 text-left font-medium">담당자</th>
            <th className="w-20 px-2 py-2 text-left font-medium">레이아웃</th>
            <th className="px-2 py-2 text-left font-medium">메모</th>
            {STAGES.map((s) => (
              <th key={s} className="w-14 px-1 py-2 text-center font-medium">{deptConfig.stageLabels[s]}</th>
            ))}
            <th className="w-14 px-2 py-2 text-center font-medium">진행</th>
            <th className="w-8 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {scenes.map((scene) => {
            const pct = sceneProgress(scene);
            const idx = allScenes.indexOf(scene);
            return (
              <tr
                key={`${scene.sceneId}-${idx}`}
                className={cn(
                  'border-b border-bg-border/50 hover:bg-bg-card/50 group cursor-pointer transition-colors',
                  searchQuery && 'bg-accent/10 border-l-2 border-l-accent/60',
                  selectedSceneIds?.has(scene.sceneId) && 'bg-accent/10',
                )}
                onClick={(e) => {
                  if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
                    onCtrlClick(scene.sceneId);
                  } else {
                    onOpenDetail(idx);
                  }
                }}
              >
                <td className="px-2 py-2 font-mono text-accent text-xs">
                  <span className="flex items-center gap-1">
                    #{scene.no}
                    {(() => { const cc = commentCounts[`${sheetName}:${scene.no}`]; return cc > 0 ? <span className="inline-flex items-center gap-0.5 bg-accent/20 text-accent px-1 py-px rounded-full"><MessageCircle size={10} fill="currentColor" /><span className="text-[11px] font-bold">{cc}</span></span> : null; })()}
                  </span>
                </td>
                <td className="px-2 py-2 text-text-primary text-xs truncate"><HighlightText text={scene.sceneId || '-'} query={searchQuery} /></td>
                <td className="px-2 py-2 text-text-secondary text-xs truncate"><HighlightText text={scene.assignee || '-'} query={searchQuery} /></td>
                <td className="px-2 py-2 text-text-secondary font-mono text-xs truncate">{scene.layoutId ? `#${scene.layoutId}` : '-'}</td>
                <td className="px-2 py-2 text-text-secondary text-xs truncate"><HighlightText text={scene.memo || '-'} query={searchQuery} /></td>
                {STAGES.map((stage) => (
                  <td key={stage} className="px-1 py-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggle(scene.sceneId, stage); }}
                      className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto"
                      style={
                        scene[stage]
                          ? { backgroundColor: deptConfig.stageColors[stage], color: 'rgb(var(--color-bg-primary))' }
                          : { border: '1px solid #2D3041' }
                      }
                    >
                      {scene[stage] ? '✓' : ''}
                    </button>
                  </td>
                ))}
                <td className="px-2 py-2 text-center">
                  <span className={cn(
                    'text-xs font-mono',
                    pct >= 100 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-text-secondary'
                  )}>
                    {Math.round(pct)}%
                  </span>
                </td>
                <td className="px-1 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(idx); }}
                    className="opacity-0 group-hover:opacity-100 text-xs text-status-none hover:text-red-400"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
      alert('클립보드에 이미지가 없습니다.');
    } catch {
      alert('클립보드 읽기 실패');
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
          <img src={base64} alt={label} className="h-20 rounded border border-bg-border object-cover" draggable={false} />
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
          'flex flex-col items-center justify-center gap-1 h-20 w-28 rounded-lg border-2 border-dashed cursor-pointer outline-none transition-all text-center',
          phase === 'paste-hint'
            ? 'border-accent bg-accent/10'
            : 'border-bg-border hover:border-text-secondary/30',
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
    <div className="bg-bg-card border border-bg-border rounded-xl p-4 flex flex-col gap-4 shadow-lg shadow-accent/5">
      {/* ── 접두사 세그먼트 컨트롤 ── */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-widest text-text-secondary/60 font-medium w-14 shrink-0">접두사</span>
        <div className="flex items-center gap-2">
          {/* 세그먼트 라디오 (pill 스타일) */}
          <div className="flex bg-bg-primary rounded-lg p-0.5 border border-bg-border">
            {(['alphabet', 'sc', 'custom'] as PrefixMode[]).map((mode) => {
              const labels: Record<PrefixMode, string> = { alphabet: 'A-X', sc: 'SC', custom: '커스텀' };
              const isActive = prefixMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => updatePrefix(mode)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md transition-all duration-200 font-medium',
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

          {/* 접두사 값 선택/입력 */}
          {prefixMode === 'alphabet' && (
            <div className="relative">
              <select
                value={alphaPrefix}
                onChange={(e) => { setAlphaPrefix(e.target.value); setNumber(suggestNextNumber(e.target.value, existingSceneIds)); }}
                className="appearance-none bg-bg-primary border border-bg-border rounded-lg pl-3 pr-7 py-1 text-sm text-text-primary font-mono cursor-pointer hover:border-accent/50 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all w-14"
              >
                {ALPHABET_PREFIXES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
            </div>
          )}
          {prefixMode === 'sc' && (
            <span className="px-3 py-1 text-sm text-accent font-mono font-bold bg-accent/10 rounded-lg border border-accent/20">sc</span>
          )}
          {prefixMode === 'custom' && (
            <input
              autoFocus
              value={customPrefix}
              onChange={(e) => { setCustomPrefix(e.target.value); setNumber(suggestNextNumber(e.target.value, existingSceneIds)); }}
              onKeyDown={handleKeyDown}
              placeholder="접두사 입력"
              className="w-24 bg-bg-primary border border-bg-border rounded-lg px-3 py-1 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            />
          )}

          {/* 미리보기 뱃지 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 border border-accent/20 rounded-lg">
            <span className="text-[11px] text-accent/60">ID</span>
            <span className="text-xs text-accent font-mono font-bold">{sceneId}</span>
            {isDuplicate && (
              <span className="text-[11px] text-red-400 bg-red-500/10 px-1.5 rounded">중복</span>
            )}
          </div>
        </div>
      </div>

      {/* ── 2열 레이아웃: 왼쪽 이미지 / 오른쪽 정보 ── */}
      <div className="grid grid-cols-[auto_1fr] gap-4">
        {/* 왼쪽: 이미지 슬롯 */}
        {!bulkMode && (
          <div className="flex gap-2">
            <AddFormImageSlot label="스토리보드" base64={sbImage} onSetBase64={setSbImage} />
            <AddFormImageSlot label="가이드" base64={guideImage} onSetBase64={setGuideImage} />
          </div>
        )}
        {bulkMode && <div />}

        {/* 오른쪽: 번호 + 담당자 + 메모 + 레이아웃 */}
        <div className="flex flex-col gap-3">
          {/* 번호 행 */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest text-text-secondary/60 font-medium w-14 shrink-0">번호</span>
            <div className="relative flex items-center">
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="001"
                className={cn(
                  'w-20 bg-bg-primary border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 pr-8 focus:ring-1 focus:ring-accent/20 outline-none transition-all',
                  isDuplicate ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'border-bg-border focus:border-accent'
                )}
              />
              <div className="absolute right-1 top-1 bottom-1 flex flex-col gap-px">
                <button onClick={() => stepNumber(1)} className="flex-1 px-0.5 rounded-sm text-text-secondary/50 hover:text-accent hover:bg-accent/10 transition-all" tabIndex={-1}>
                  <ChevronUp size={10} />
                </button>
                <button onClick={() => stepNumber(-1)} className="flex-1 px-0.5 rounded-sm text-text-secondary/50 hover:text-accent hover:bg-accent/10 transition-all" tabIndex={-1}>
                  <ChevronDown size={10} />
                </button>
              </div>
            </div>

            {/* 일괄 생성 토글 */}
            <button
              onClick={() => setBulkMode(!bulkMode)}
              className={cn(
                'px-2 py-1 text-[11px] rounded-md font-medium transition-colors cursor-pointer',
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
                  className="w-20 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
                />
              </>
            )}

            <div className="w-px h-6 bg-bg-border" />

            <AssigneeSelect
              value={assignee}
              onChange={setAssignee}
              placeholder="담당자"
              className="w-24"
            />
          </div>

          {/* 메모 + 레이아웃 행 */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest text-text-secondary/60 font-medium w-14 shrink-0">정보</span>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메모 (선택)"
              className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            />
            <input
              value={layoutId}
              onChange={(e) => setLayoutId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="레이아웃 ID (선택)"
              className="w-36 bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-secondary/45 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            />
          </div>

          {/* 하단 버튼 */}
          <div className="flex gap-2 items-center justify-end">
            <span className="text-[11px] text-text-secondary/50">
              Enter 추가 · Esc 취소
            </span>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border hover:border-text-secondary/30 rounded-lg transition-all"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={isDuplicate || !prefix || (bulkMode && !bulkEnd)}
              className={cn(
                'px-5 py-1.5 text-white text-xs font-medium rounded-lg transition-all',
                isDuplicate || !prefix || (bulkMode && !bulkEnd)
                  ? 'bg-gray-600 cursor-not-allowed opacity-50'
                  : 'bg-accent hover:bg-accent/90 shadow-sm shadow-accent/25 hover:shadow-md hover:shadow-accent/30',
              )}
            >
              {bulkMode ? `일괄 추가` : '+ 추가'}
            </button>
          </div>
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
  const { sortKey, sortDir, statusFilter, sceneViewMode, sceneGroupMode } = useAppStore();
  const { setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSearchQuery, setSelectedDepartment } = useAppStore();
  const { setSortKey, setSortDir, setStatusFilter, setSceneViewMode, setSceneGroupMode } = useAppStore();
  const { previousView, setView, highlightSceneId, setHighlightSceneId } = useAppStore();
  const { selectedSceneIds, toggleSelectedScene, setSelectedScenes, clearSelectedScenes } = useAppStore();
  const currentUser = useAuthStore((s) => s.currentUser);

  const deptConfig = DEPARTMENT_CONFIGS[selectedDepartment];

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
  const [treeOpen, setTreeOpen] = useState(true);

  // 파트 컨텍스트 메뉴
  const { menuPosition: partMenuPos, openMenu: openPartMenu, closeMenu: closePartMenu } = useContextMenu();
  const [partMenuTarget, setPartMenuTarget] = useState<string | null>(null);
  const [partMemos, setPartMemos] = useState<Record<string, string>>({});
  const [editingPartMemo, setEditingPartMemo] = useState<string | null>(null);
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

  // 댓글 모드 설정 (항상 시트 모드)
  useEffect(() => {
    setCommentsSheetsMode(true);
    return () => { invalidatePartCache(); };
  }, []);

  // 전체 댓글 카운트 로드
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  // 댓글 카운트 로딩은 currentPart 정의 후 아래에서 수행 (useEffect)

  // Shift+Click 범위 선택을 위한 마지막 클릭 인덱스
  const lastClickedIndexRef = useRef<number | null>(null);

  // 라쏘 드래그 선택
  const gridRef = useRef<HTMLDivElement>(null);
  const getSceneIdFromEl = useCallback((el: Element) => el.getAttribute('data-scene-id'), []);
  const handleLassoChange = useCallback((ids: Set<string>) => setSelectedScenes(ids), [setSelectedScenes]);
  const isCardView = sceneViewMode === 'card';
  const { lassoRect } = useLassoSelection(
    gridRef,
    '[data-scene-id]',
    getSceneIdFromEl,
    handleLassoChange,
    isCardView,
  );

  // 파트/에피소드 변경 시 선택 초기화
  useEffect(() => { clearSelectedScenes(); }, [selectedEpisode, selectedPart, selectedDepartment, clearSelectedScenes]);

  // 백그라운드 동기화: 낙관적 업데이트 후 서버와 싱크
  // 동기화 매니저: 버전 카운터로 오래된 응답 폐기 + 아카이브 가드로 낙관적 상태 보호
  const syncInBackground = async () => {
    const myVersion = ++syncVersionRef.current;
    try {
      const { readAllFromSheets, readArchivedFromSheets } = await import('@/services/sheetsService');
      const eps = await readAllFromSheets();

      // 버전 체크: 이 sync 이후에 새 sync가 시작되었으면 결과 폐기
      if (syncVersionRef.current !== myVersion) return;

      setEpisodes(eps);

      // 아카이빙 가드: 아카이빙/해제 작업 진행 중이면 archived 목록 갱신 스킵
      if (!archiveGuardRef.current) {
        try {
          const archivedList = await readArchivedFromSheets();
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

      // 위젯 팝업에 데이터 변경 알림
      window.electronAPI?.sheetsNotifyChange?.();
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
  const parts = allParts.filter((p) => p.department === selectedDepartment);
  const currentPart = parts.length > 0
    ? (parts.find((p) => p.partId === selectedPart) ?? parts[0])
    : undefined;

  // 댓글 카운트 로드 (currentPart 정의 후)
  useEffect(() => {
    if (currentPart) {
      // 현재 파트의 댓글만 지연 로딩
      loadPartComments(currentPart.sheetName).then((store) => {
        setCommentCounts((prev) => {
          const next = { ...prev };
          for (const [key, list] of Object.entries(store)) {
            next[key] = list.length;
          }
          return next;
        });
      }).catch(() => {});
    }
  }, [detailSceneIndex, currentPart?.sheetName]);

  // 파트 메모 로드
  useEffect(() => {
    const loadPartMemos = async () => {
      const memos: Record<string, string> = {};
      for (const part of parts) {
        try {
          const data = await readMetadataFromSheets('part-memo', part.sheetName);
          if (data?.value) memos[part.sheetName] = data.value;
        } catch { /* 무시 */ }
      }
      if (Object.keys(memos).length > 0) setPartMemos(memos);
    };
    loadPartMemos();
  }, [currentEp?.episodeNumber, selectedDepartment]);

  // 에피소드 제목/메모 → App.tsx에서 병렬 로드됨 (글로벌 스토어)

  // 아카이빙된 에피소드 목록 로드 (마운트 시 1회만 — 이후는 syncInBackground가 갱신)
  // episodes.length 의존성 제거: deleteEpisodeOptimistic() 호출 시 재로드가 낙관적 상태를 덮어쓰는 문제 방지
  useEffect(() => {
    const loadArchived = async () => {
      try {
        const { readArchivedFromSheets } = await import('@/services/sheetsService');
        const list = await readArchivedFromSheets();
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
  const detailScene = detailSceneIndex !== null
    ? (currentPart?.scenes[detailSceneIndex] ?? null)
    : null;

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

  // 담당자 목록 (현재 파트 기준)
  const assignees = Array.from(
    new Set((currentPart?.scenes ?? []).map((s) => s.assignee).filter(Boolean))
  );

  // 전체 진행도 (필터 기준)
  const totalChecks = scenes.length * 4;
  const doneChecks = scenes.reduce(
    (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length,
    0
  );
  const overallPct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;

  // 다음 에피소드 번호 계산
  const nextEpisodeNumber = episodes.length > 0
    ? Math.max(...episodes.map((ep) => ep.episodeNumber)) + 1
    : 1;

  // 다음 파트 ID 계산 (현재 부서의 파트 기준, 중복 방지)
  const nextPartId = useMemo(() => {
    if (!currentEp || parts.length === 0) return 'A';
    const existingIds = new Set(parts.map((p) => p.partId));
    let candidate = String.fromCharCode(Math.max(...parts.map((p) => p.partId.charCodeAt(0))) + 1);
    // 이미 존재하면 다음 문자로
    while (existingIds.has(candidate) && candidate <= 'Z') {
      candidate = String.fromCharCode(candidate.charCodeAt(0) + 1);
    }
    return candidate;
  }, [currentEp, parts]);

  // ─── 핸들러들 ─────────────────────────────────

  // 토글 직렬화 큐: 빠른 연속 토글 시 race condition 방지
  const toggleQueueRef = useRef<Promise<void>>(Promise.resolve());

  const handleToggle = (sceneId: string, stage: Stage) => {
    if (!currentEp || !currentPart) return;

    // 현재 스토어에서 최신 씬 상태 직접 조회 (stale closure 방지)
    const latestPart = useDataStore.getState().episodes
      .flatMap((ep) => ep.parts)
      .find((p) => p.sheetName === currentPart.sheetName);
    if (!latestPart) return;

    const scene = latestPart.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) return;

    const newValue = !scene[stage];
    const sceneIndex = latestPart.scenes.findIndex((s) => s.sceneId === sceneId);
    if (sceneIndex < 0) return;

    // 낙관적 업데이트 — 즉시 UI 반영
    toggleSceneStage(currentPart.sheetName, sceneId, stage);

    // 완료 축하 애니메이션 + 완료 기록: 방금 토글로 4단계 모두 완료 시
    if (newValue) {
      const afterToggle = { ...scene, [stage]: true };
      if (afterToggle.lo && afterToggle.done && afterToggle.review && afterToggle.png) {
        setCelebratingId(sceneId);
        const completedBy = currentUser?.name ?? '알 수 없음';
        const completedAt = new Date().toISOString();
        updateSceneFieldOptimistic(currentPart.sheetName, sceneIndex, 'completedBy', completedBy);
        updateSceneFieldOptimistic(currentPart.sheetName, sceneIndex, 'completedAt', completedAt);
      }
    }

    // API 호출을 큐에 넣어 순차 실행 (race condition 방지)
    const sheetName = currentPart.sheetName;
    toggleQueueRef.current = toggleQueueRef.current.then(async () => {
      try {
        await updateSheetCell(sheetName, sceneIndex, stage, newValue);
        window.electronAPI?.sheetsNotifyChange?.();
      } catch (err) {
        console.error('[토글 실패]', err);
        toggleSceneStage(sheetName, sceneId, stage);
      }
    });
  };

  // 일괄 토글: 선택된 씬들의 특정 단계를 단일 API 호출로 처리
  const handleBulkToggle = async (sceneIds: Set<string>, stage: Stage) => {
    if (!currentPart) return;
    const sheetName = currentPart.sheetName;

    // 최신 스토어에서 씬 상태 조회 (stale closure 방지)
    const latestPart = useDataStore.getState().episodes
      .flatMap((ep) => ep.parts)
      .find((p) => p.sheetName === sheetName);
    if (!latestPart) return;

    // 업데이트 목록 구성
    const updates: { sceneId: string; sceneIndex: number; stage: Stage; newValue: boolean }[] = [];
    sceneIds.forEach((id) => {
      const idx = latestPart.scenes.findIndex((s) => s.sceneId === id);
      if (idx < 0) return;
      const scene = latestPart.scenes[idx];
      updates.push({ sceneId: id, sceneIndex: idx, stage, newValue: !scene[stage] });
    });
    if (updates.length === 0) return;

    // 낙관적 업데이트 — 모든 씬을 한번에 UI 반영
    updates.forEach((u) => toggleSceneStage(sheetName, u.sceneId, u.stage));

    // 단일 API 호출로 모든 셀 업데이트
    try {
      await bulkUpdateCells(sheetName, updates.map((u) => ({
        rowIndex: u.sceneIndex, stage: u.stage, value: u.newValue,
      })));
      window.electronAPI?.sheetsNotifyChange?.();
    } catch (err) {
      console.error('[일괄 토글 실패]', err);
      // 롤백 — 모든 토글 되돌리기
      updates.forEach((u) => toggleSceneStage(sheetName, u.sceneId, u.stage));
    }
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

    // 낙관적 업데이트
    addEpisodeOptimistic(nextEpisodeNumber, selectedDepartment);
    setSelectedEpisode(nextEpisodeNumber);

    // 제목 저장 (즉시 UI 반영)
    if (epName) {
      const next = { ...episodeTitles, [nextEpisodeNumber]: epName };
      setEpisodeTitles(next);
    }

    // 백그라운드에서 서버에 저장
    try {
      // Phase 0: 배치로 한 번에 전송
      const actions: BatchAction[] = [
        batchActions.addEpisode(nextEpisodeNumber, selectedDepartment),
      ];
      if (epName) {
        actions.push(batchActions.writeMetadata('episode-title', String(nextEpisodeNumber), epName));
      }
      await batchToSheets(actions);
      syncInBackground();
    } catch (err) {
      // 롤백
      setEpisodes(prevEpisodes);
      setEpisodeTitles(prevTitles);
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        alert(`에피소드 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        alert(`에피소드 추가 실패: ${err}`);
      }
      syncInBackground();
    }
  };

  // 공통 시트 에러 핸들러
  const handleSheetError = (err: unknown, actionName: string) => {
    const msg = String(err);
    if (msg.includes('Unknown action')) {
      alert(`${actionName} 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
    } else {
      alert(`${actionName} 실패: ${err}`);
    }
  };

  const handleAddPart = async () => {
    if (!currentEp) return;
    if (nextPartId > 'Z') {
      alert('파트는 Z까지만 가능합니다');
      return;
    }
    // 중복 방지: 동일 부서에 같은 partId가 이미 존재하면 차단
    const deptSuffix = selectedDepartment === 'bg' ? '_BG' : '_ACT';
    const expectedSheetName = `EP${String(currentEp.episodeNumber).padStart(2, '0')}_${nextPartId}${deptSuffix}`;
    if (allParts.some((p) => p.sheetName === expectedSheetName)) {
      alert(`${nextPartId}파트(${selectedDepartment === 'bg' ? 'BG' : '액팅'})는 이미 존재합니다.`);
      return;
    }

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;
    const prevSelectedPart = selectedPart;

    // 낙관적 업데이트
    addPartOptimistic(currentEp.episodeNumber, nextPartId, selectedDepartment);
    setSelectedPart(nextPartId);

    try {
      await addPartToSheets(currentEp.episodeNumber, nextPartId, selectedDepartment);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      setSelectedPart(prevSelectedPart);
      handleSheetError(err, '파트 추가');
      syncInBackground();
    }
  };

  const handleAddScene = async (sceneId: string, assignee: string, memo: string, layoutId: string, images?: { storyboard?: string; guide?: string }, skipSync?: boolean) => {
    if (!currentPart) return;

    const sceneIndex = currentPart.scenes.length; // 새 씬의 인덱스

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;

    // 낙관적 업데이트 (폼은 닫지 않음 — 연속 입력 지원)
    addSceneOptimistic(currentPart.sheetName, sceneId, assignee, memo);

    try {
      await addSceneToSheets(currentPart.sheetName, sceneId, assignee, memo);
      // 배치 모드에서는 마지막 씬 추가 후에만 sync
      if (!skipSync) syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      handleSheetError(err, '씬 추가');
      if (!skipSync) syncInBackground();
      return; // 롤백 시 이후 layoutId/이미지 처리 스킵
    }

    // layoutId 가 있으면 씬 생성 후 별도로 설정
    if (layoutId) {
      // optimistic add 후 최신 인덱스 조회
      const latestPart = useDataStore.getState().episodes
        .flatMap((ep) => ep.parts)
        .find((p) => p.sheetName === currentPart.sheetName);
      const latestIndex = latestPart?.scenes.findIndex((s) => s.sceneId === sceneId) ?? -1;
      if (latestIndex >= 0) {
        updateSceneFieldOptimistic(currentPart.sheetName, latestIndex, 'layoutId', layoutId);
        updateSceneFieldInSheets(currentPart.sheetName, latestIndex, 'layoutId', layoutId).catch(() => {});
      }
    }

    // 이미지가 있으면 백그라운드에서 업로드
    if (images?.storyboard || images?.guide) {
      const partSheetName = currentPart.sheetName;
      (async () => {
        try {
          const { saveImage } = await import('@/utils/imageUtils');
          const latestPart = useDataStore.getState().episodes
            .flatMap((ep) => ep.parts)
            .find((p) => p.sheetName === partSheetName);
          const latestIndex = latestPart?.scenes.findIndex((s) => s.sceneId === sceneId) ?? -1;
          if (latestIndex < 0) return;

          if (images.storyboard) {
            const url = await saveImage(images.storyboard, partSheetName, sceneId, 'storyboard');
            handleFieldUpdate(latestIndex, 'storyboardUrl', url);
          }
          if (images.guide) {
            const url = await saveImage(images.guide, partSheetName, sceneId, 'guide');
            handleFieldUpdate(latestIndex, 'guideUrl', url);
          }
        } catch (err) {
          console.error('[씬 추가 이미지 업로드 실패]', err);
        }
      })();
    }
  };

  // Phase 0-5: 대량 씬 추가 (5개 이상 — 서버 확인 후 반영)
  const handleBulkAddScenes = async (scenes: { sceneId: string; assignee: string; memo: string }[]) => {
    if (!currentPart || scenes.length === 0) return;

    setBulkAddLoading(true);
    try {
      const { addScenesToSheets } = await import('@/services/sheetsService');
      await addScenesToSheets(currentPart.sheetName, scenes);
      // 서버 성공 후 전체 동기화 완료까지 대기 (데이터 없음 깜빡임 방지)
      await syncInBackground();
    } catch (err) {
      alert(`대량 씬 추가 실패: ${err}`);
    } finally {
      setBulkAddLoading(false);
    }
  };

  const handleDeleteScene = async (sceneIndex: number) => {
    if (!currentPart) return;
    if (!confirm('이 씬을 삭제하시겠습니까?')) return;

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;

    // 낙관적 업데이트
    deleteSceneOptimistic(currentPart.sheetName, sceneIndex);

    try {
      await deleteSceneFromSheets(currentPart.sheetName, sceneIndex);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      handleSheetError(err, '씬 삭제');
      syncInBackground();
    }
  };

  const handleFieldUpdate = async (sceneIndex: number, field: string, value: string) => {
    if (!currentPart) return;

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;

    // 낙관적 업데이트
    updateSceneFieldOptimistic(currentPart.sheetName, sceneIndex, field, value);

    try {
      await updateSceneFieldInSheets(currentPart.sheetName, sceneIndex, field, value);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      handleSheetError(err, '수정');
      syncInBackground();
    }
  };

  // ─── 파트 삭제 ─────────────────────
  const handleDeletePart = async (sheetName: string) => {
    const part = parts.find((p) => p.sheetName === sheetName);
    if (!part) return;
    if (!confirm(`${part.partId}파트를 삭제하시겠습니까?\n(시트에서 숨김 처리됩니다)`)) return;

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;
    const prevSelectedPart = selectedPart;

    deletePartOptimistic(sheetName);
    setSelectedPart(null);

    try {
      await softDeletePartInSheets(sheetName);
      syncInBackground();
    } catch (err) {
      setEpisodes(prevEpisodes);
      setSelectedPart(prevSelectedPart);
      handleSheetError(err, '파트 삭제');
      syncInBackground();
    }
  };

  // ─── 파트 메모 저장 ─────────────────
  const handleSavePartMemo = async (sheetName: string, memo: string) => {
    setPartMemos((prev) => ({ ...prev, [sheetName]: memo }));
    setEditingPartMemo(null);
    try {
      await writeMetadataToSheets('part-memo', sheetName, memo);
    } catch (err) {
      console.warn('[파트 메모] 시트 저장 실패', err);
    }
  };

  // ─── 에피소드 삭제 ────────────────────
  const handleDeleteEpisode = async () => {
    if (!currentEp) return;
    const epDisplayName = episodeTitles[currentEp.episodeNumber] || currentEp.title;
    if (!confirm(`"${epDisplayName}"를 삭제하시겠습니까?\n(시트에서 숨김 처리됩니다)`)) return;

    // 롤백용 스냅샷
    const prevEpisodes = useDataStore.getState().episodes;
    const prevSelectedEpisode = selectedEpisode;

    deleteEpisodeOptimistic(currentEp.episodeNumber);
    setSelectedEpisode(episodes[0]?.episodeNumber ?? 1);
    setEpEditOpen(false);

    try {
      await softDeleteEpisodeInSheets(currentEp.episodeNumber);
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
      const { archiveEpisodeViaRegistryInSheets } = await import('@/services/sheetsService');
      await archiveEpisodeViaRegistryInSheets(epNum, archivedBy, memo);
      // 서버가 완전히 처리할 시간(5초)을 준 후 가드 해제 + 동기화
      setTimeout(() => {
        archiveGuardRef.current = false;
        syncInBackground();
        window.electronAPI?.sheetsNotifyChange?.();
      }, 5000);
    } catch (err) {
      // 롤백: 활성 목록 + 아카이브 목록 모두 원복
      archiveGuardRef.current = false;
      setEpisodes(prevEpisodes);
      setArchivedEpisodes(prevArchivedEpisodes);
      alert(`아카이빙 실패: ${err}`);
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
      const { unarchiveEpisodeViaRegistryInSheets } = await import('@/services/sheetsService');
      await unarchiveEpisodeViaRegistryInSheets(epNum);
      // 서버가 완전히 처리할 시간(5초)을 준 후 가드 해제 + 동기화
      setTimeout(() => {
        archiveGuardRef.current = false;
        syncInBackground();
        window.electronAPI?.sheetsNotifyChange?.();
      }, 5000);
    } catch (err) {
      // 롤백
      archiveGuardRef.current = false;
      setArchivedEpisodes(prevArchivedEpisodes);
      alert(`복원 실패: ${err}`);
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
      await writeMetadataToSheets('episode-title', key, title.trim());
      await writeMetadataToSheets('episode-memo', key, memo);
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
    <div className="flex gap-3 min-h-full">
      {/* ── 트리뷰 사이드바 ── */}
      {treeOpen && (
        <div className="shrink-0 w-52 bg-bg-card border border-bg-border rounded-xl overflow-y-auto flex flex-col sticky top-0 self-start max-h-[calc(100vh-5.5rem)]">
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
            onPartContextMenu={(e, sheetName) => {
              setPartMenuTarget(sheetName);
              openPartMenu(e);
            }}
            onEpisodeEdit={handleTreeEpisodeEdit}
            archivedEpisodes={archivedEpisodes}
            onArchiveEpisode={openArchiveDialog}
            onUnarchiveEpisode={handleUnarchiveEpisode}
            onEpisodeContextMenu={handleEpisodeContextMenu}
          />
        </div>
      )}

      {/* ── 메인 콘텐츠 영역 (gridRef: 라쏘 드래그 범위) ── */}
      <div ref={gridRef} className="flex-1 flex flex-col gap-4 min-w-0">
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

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 bg-bg-card border border-bg-border rounded-xl p-3">
        {/* 트리 사이드바 토글 */}
        <button
          onClick={() => setTreeOpen(!treeOpen)}
          className="p-2 text-text-secondary/50 hover:text-text-primary rounded-lg hover:bg-bg-primary transition-colors"
          title={treeOpen ? '트리 닫기' : '트리 열기'}
        >
          {treeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>

        <div className="w-px h-6 bg-bg-border" />

        {/* 부서 탭 */}
        <div className="flex bg-bg-primary rounded-lg p-0.5 border border-bg-border">
          {DEPARTMENTS.map((dept) => {
            const cfg = DEPARTMENT_CONFIGS[dept];
            const isActive = selectedDepartment === dept;
            return (
              <button
                key={dept}
                onClick={() => { setSelectedDepartment(dept); setSelectedPart(null); }}
                className={cn(
                  'px-4 py-2 text-sm rounded-md transition-all duration-200 font-medium',
                  isActive
                    ? 'text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
                style={isActive ? { backgroundColor: cfg.color } : undefined}
              >
                {cfg.shortLabel}
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
              <select
                value={selectedEpisode ?? currentEp?.episodeNumber ?? ''}
                onChange={(e) => setSelectedEpisode(Number(e.target.value))}
                className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary font-medium"
              >
                {episodeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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

            {/* 파트 탭 */}
            <div className="flex gap-1">
              {parts.map((part) => {
                const isActive = (selectedPart ?? (parts.length > 0 ? parts[0].partId : '')) === part.partId;
                const memo = partMemos[part.sheetName];
                return (
                  <button
                    key={part.partId}
                    onClick={() => setSelectedPart(part.partId)}
                    onContextMenu={(e) => {
                      setPartMenuTarget(part.sheetName);
                      openPartMenu(e);
                    }}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-white shadow-sm shadow-accent/20'
                        : 'bg-bg-primary text-text-secondary hover:text-text-primary border border-bg-border'
                    )}
                    title={memo ? `메모: ${memo}` : undefined}
                  >
                    {part.partId}파트
                    {memo && <span className="ml-1 text-xs italic opacity-70">({memo})</span>}
                  </button>
                );
              })}
              {/* 파트 추가 */}
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
              {currentPart && <span className="text-text-secondary ml-1">/ {currentPart.partId}파트</span>}
            </span>
          </>
        )}

        {/* 담당자 필터 */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setSelectedAssignee(null)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              !selectedAssignee
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            전체
          </button>
          {assignees.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedAssignee(name)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                selectedAssignee === name
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {/* 구분선 */}
        <div className="w-px h-7 bg-bg-border" />

        {/* 상태 필터 */}
        {(['all', 'not-started', 'in-progress', 'done'] as StatusFilter[]).map((f) => {
          const labels: Record<StatusFilter, string> = {
            all: '전체', 'not-started': '미착수', 'in-progress': '진행중', done: '완료',
          };
          return (
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
              {labels[f]}
            </button>
          );
        })}

        {/* 오른쪽 그룹: 정렬 + 뷰모드 + 검색 */}
        <div className="flex items-center gap-2 ml-auto">
          {/* 정렬 */}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown size={16} className="text-text-secondary" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
            >
              <option value="no">번호순</option>
              <option value="assignee">담당자순</option>
              <option value="progress">진행률순</option>
              <option value="incomplete">미완료 우선</option>
            </select>
            <button
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              className="px-2 py-1.5 text-sm text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-border/50 transition-colors"
              title={sortDir === 'asc' ? '오름차순' : '내림차순'}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {/* 그룹 모드 토글 */}
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

          {/* 뷰 모드 토글 */}
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
              onClick={() => setSceneViewMode('table')}
              className={cn(
                'p-2 transition-colors',
                sceneViewMode === 'table' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="테이블 뷰"
            >
              <Table2 size={16} />
            </button>
          </div>

          {/* 검색 */}
          <input
            type="text"
            placeholder="검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 w-40"
          />
        </div>
      </div>

      {/* 진행도 + 씬 목록 영역 */}
      <div className="relative flex-1 flex flex-col gap-4">

      {/* 상단 고정 진행도 */}
      <div className="flex items-center gap-4 bg-bg-card border border-bg-border rounded-xl px-5 py-3">
        <span className="text-sm font-medium text-text-secondary">
          {scenes.length}씬 표시 중
        </span>
        <div className="flex-1 h-2.5 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${overallPct}%`, background: progressGradient(overallPct) }}
          />
        </div>
        <span className="text-base font-bold text-accent">{overallPct}%</span>
        {/* 씬 추가 버튼 */}
        {currentPart && (
          <button
            onClick={() => setShowAddScene(true)}
            className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 shadow-sm shadow-accent/20 transition-colors"
          >
            + 씬 추가
          </button>
        )}
      </div>

      {/* 씬 추가 폼 */}
      {showAddScene && (
        <AddSceneForm
          existingSceneIds={(currentPart?.scenes ?? []).map((s) => s.sceneId)}
          onSubmit={handleAddScene}
          onBulkSubmit={handleBulkAddScenes}
          onCancel={() => setShowAddScene(false)}
        />
      )}

      {/* 대량 씬 추가 로딩 오버레이 (Phase 0-5) */}
      {bulkAddLoading && (
        <div className="flex items-center justify-center py-8 gap-3">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-secondary">씬을 추가하고 있습니다...</span>
        </div>
      )}

      {/* 씬 목록 */}
      <div className="relative flex-1">
        {/* 파트 완료 보케 오버레이 */}
        <AnimatePresence>
          {scenes.length > 0 && overallPct >= 100 && <PartCompleteOverlay />}
        </AnimatePresence>

        {/* 파트 완료 기록 (마지막 완료자 & 시간) */}
        {scenes.length > 0 && overallPct >= 100 && (() => {
          const lastCompleted = scenes
            .filter((s) => s.completedAt)
            .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
          if (!lastCompleted?.completedBy) return null;
          const dt = new Date(lastCompleted.completedAt!);
          const timeStr = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours()}시 ${dt.getMinutes().toString().padStart(2, '0')}분`;
          return (
            <div className="absolute bottom-3 left-0 right-0 z-20 flex justify-center pointer-events-none">
              <span className="text-xs text-text-secondary/70 bg-bg-card/80 backdrop-blur-sm rounded-full px-3 py-1 border border-bg-border/30">
                {lastCompleted.completedBy}님이 {timeStr}에 완료
              </span>
            </div>
          );
        })()}

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
        /* ── 레이아웃별 그룹 뷰 (P1-4) ── */
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
                {/* 레이아웃 그룹 헤더 */}
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

                {/* 그룹 내 씬들 */}
                {sceneViewMode === 'table' ? (
                  <SceneTable
                    scenes={groupScenes}
                    allScenes={currentPart?.scenes ?? []}
                    department={selectedDepartment}
                    commentCounts={commentCounts}
                    sheetName={currentPart?.sheetName ?? ''}
                    onToggle={handleToggle}
                    onDelete={handleDeleteScene}
                    searchQuery={searchQuery}
                    onOpenDetail={(idx) => setDetailSceneIndex(idx)}
                    selectedSceneIds={selectedSceneIds}
                    onCtrlClick={(id) => toggleSelectedScene(id)}
                  />
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                    {groupScenes.map((scene, idx) => {
                      const rawIdx = currentPart?.scenes.indexOf(scene) ?? -1;
                      const sIdx = rawIdx >= 0 ? rawIdx : idx;
                      return (
                        <SceneCard
                          key={`${scene.sceneId}-${idx}`}
                          scene={scene}
                          sceneIndex={sIdx}
                          celebrating={celebratingId === scene.sceneId}
                          department={selectedDepartment}
                          isHighlighted={highlightSceneId === scene.sceneId}
                          isSelected={selectedSceneIds.has(scene.sceneId)}
                          searchQuery={searchQuery}
                          commentCount={commentCounts[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? 0}
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
                )}
              </div>
            );
          })}
        </div>
      ) : sceneViewMode === 'table' ? (
        /* ── 테이블 뷰 (플랫) ── */
        <div className="flex-1 overflow-auto">
          <SceneTable
            scenes={scenes}
            allScenes={currentPart?.scenes ?? []}
            department={selectedDepartment}
            commentCounts={commentCounts}
            sheetName={currentPart?.sheetName ?? ''}
            onToggle={handleToggle}
            onDelete={handleDeleteScene}
            searchQuery={searchQuery}
            onOpenDetail={(idx) => setDetailSceneIndex(idx)}
            selectedSceneIds={selectedSceneIds}
            onCtrlClick={(id) => toggleSelectedScene(id)}
          />
        </div>
      ) : (
        /* ── 카드 뷰 (플랫) ── */
        <div className="flex-1 overflow-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 content-start">
          {scenes.map((scene, idx) => {
            const rawIdx = currentPart?.scenes.indexOf(scene) ?? -1;
                      const sIdx = rawIdx >= 0 ? rawIdx : idx;
            return (
              <SceneCard
                key={`${scene.sceneId}-${idx}`}
                scene={scene}
                sceneIndex={sIdx}
                celebrating={celebratingId === scene.sceneId}
                department={selectedDepartment}
                isHighlighted={highlightSceneId === scene.sceneId}
                isSelected={selectedSceneIds.has(scene.sceneId)}
                searchQuery={searchQuery}
                commentCount={commentCounts[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? 0}
                onToggle={handleToggle}
                onDelete={handleDeleteScene}
                onOpenDetail={() => setDetailSceneIndex(sIdx)}
                onCelebrationEnd={clearCelebration}
                onCtrlClick={() => {
                  toggleSelectedScene(scene.sceneId);
                  lastClickedIndexRef.current = idx;
                }}
                onShiftClick={() => {
                  // Shift+Click: 범위 선택
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
      </div>{/* 진행도 + 씬 목록 영역 끝 */}

      {/* 일괄 액션 바 (선택된 씬이 있을 때) */}
      <AnimatePresence>
        {selectedSceneIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl shadow-black/40"
            style={{
              background: 'rgb(var(--color-bg-card) / 0.95)',
              border: '1px solid rgb(var(--color-accent) / 0.3)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center gap-2 pr-3 border-r border-bg-border">
              <CheckSquare size={16} className="text-accent" />
              <span className="text-sm font-medium text-text-primary">
                {selectedSceneIds.size}개 선택
              </span>
            </div>

            {/* 일괄 스테이지 토글 */}
            {STAGES.map((stage) => (
              <button
                key={stage}
                onClick={() => handleBulkToggle(selectedSceneIds, stage)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{
                  backgroundColor: `${deptConfig.stageColors[stage]}20`,
                  color: deptConfig.stageColors[stage],
                  border: `1px solid ${deptConfig.stageColors[stage]}40`,
                }}
              >
                {deptConfig.stageLabels[stage]}
              </button>
            ))}

            <div className="w-px h-6 bg-bg-border" />

            {/* 일괄 편집 */}
            <button
              onClick={() => setBatchEditOpen(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors cursor-pointer"
            >
              <Pencil size={13} className="inline mr-1" />
              편집
            </button>

            {/* 일괄 삭제 */}
            <button
              onClick={() => {
                if (!confirm(`${selectedSceneIds.size}개 씬을 삭제하시겠습니까?`)) return;
                const allScenes = currentPart?.scenes ?? [];
                // 인덱스가 큰 것부터 삭제 (인덱스 밀림 방지)
                const indices = [...selectedSceneIds]
                  .map((id) => allScenes.findIndex((s) => s.sceneId === id))
                  .filter((i) => i >= 0)
                  .sort((a, b) => b - a);

                // 롤백용 스냅샷
                const prevEpisodes = useDataStore.getState().episodes;

                indices.forEach((idx) => {
                  if (currentPart) {
                    deleteSceneOptimistic(currentPart.sheetName, idx);
                  }
                });
                clearSelectedScenes();
                // 백그라운드 싱크
                (async () => {
                  try {
                    // Phase 0: 배치로 한 번에
                    await batchToSheets(
                      indices.map((idx) => batchActions.deleteScene(currentPart!.sheetName, idx))
                    );
                    syncInBackground();
                  } catch (err) {
                    console.error('[일괄 삭제 실패]', err);
                    // 롤백
                    useDataStore.getState().setEpisodes(prevEpisodes);
                    syncInBackground();
                  }
                })();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 size={13} className="inline mr-1" />
              삭제
            </button>

            {/* 선택 해제 */}
            <button
              onClick={clearSelectedScenes}
              className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-border/50 transition-colors"
              title="선택 해제"
            >
              <X size={16} />
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

                  const allScenes = currentPart?.scenes ?? [];
                  const batchActionList: BatchAction[] = [];

                  // 낙관적 업데이트 + 배치 액션 수집
                  selectedSceneIds.forEach((id) => {
                    const idx = allScenes.findIndex((s) => s.sceneId === id);
                    if (idx < 0 || !currentPart) return;
                    if (assignee) {
                      updateSceneFieldOptimistic(currentPart.sheetName, idx, 'assignee', assignee);
                      batchActionList.push(batchActions.updateSceneField(currentPart.sheetName, idx, 'assignee', assignee));
                    }
                    if (memo) {
                      updateSceneFieldOptimistic(currentPart.sheetName, idx, 'memo', memo);
                      batchActionList.push(batchActions.updateSceneField(currentPart.sheetName, idx, 'memo', memo));
                    }
                    if (layoutId) {
                      updateSceneFieldOptimistic(currentPart.sheetName, idx, 'layoutId', layoutId);
                      batchActionList.push(batchActions.updateSceneField(currentPart.sheetName, idx, 'layoutId', layoutId));
                    }
                  });

                  setBatchEditOpen(false);
                  setBatchAssigneeValue('');
                  clearSelectedScenes();

                  // Phase 0: 배치로 한 번에 전송
                  if (batchActionList.length > 0) {
                    batchToSheets(batchActionList)
                      .then(() => syncInBackground())
                      .catch((err) => {
                        console.error('[일괄 편집 실패]', err);
                        syncInBackground();
                      });
                  }
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
      {detailScene && detailSceneIndex !== null && (() => {
        // 필터링된 씬 목록에서 현재/이전/다음 씬의 원본 인덱스를 계산
        const allScenes = currentPart?.scenes ?? [];
        const filteredIndices = scenes
          .map((s) => allScenes.indexOf(s))
          .filter((i) => i >= 0);
        const posInFiltered = filteredIndices.indexOf(detailSceneIndex);
        const hasPrev = posInFiltered > 0;
        const hasNext = posInFiltered >= 0 && posInFiltered < filteredIndices.length - 1;

        return (
          <SceneDetailModal
            scene={detailScene}
            sceneIndex={detailSceneIndex}
            sheetName={currentPart?.sheetName ?? ''}
            department={selectedDepartment}
            onFieldUpdate={handleFieldUpdate}
            onToggle={handleToggle}
            onClose={() => setDetailSceneIndex(null)}
            hasPrev={hasPrev}
            hasNext={hasNext}
            totalScenes={filteredIndices.length}
            currentSceneIndex={posInFiltered >= 0 ? posInFiltered : 0}
            onNavigate={(dir) => {
              if (posInFiltered < 0) return;
              const nextPos = dir === 'prev' ? posInFiltered - 1 : posInFiltered + 1;
              if (nextPos >= 0 && nextPos < filteredIndices.length) {
                setDetailSceneIndex(filteredIndices[nextPos]);
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
                setPartMemoInput(partMemos[partMenuTarget] ?? '');
                setEditingPartMemo(partMenuTarget);
              },
            },
            {
              label: '파트 삭제',
              icon: <Trash2 size={12} />,
              danger: true,
              onClick: () => handleDeletePart(partMenuTarget),
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
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-text-primary">파트 메모</h3>
            <input
              autoFocus
              value={partMemoInput}
              onChange={(e) => setPartMemoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSavePartMemo(editingPartMemo, partMemoInput);
                if (e.key === 'Escape') setEditingPartMemo(null);
              }}
              placeholder="파트 메모를 입력하세요"
              className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingPartMemo(null)}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => handleSavePartMemo(editingPartMemo, partMemoInput)}
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
            <div className="bg-bg-card rounded-xl border border-bg-border shadow-2xl p-5 w-[360px]" onClick={(e) => e.stopPropagation()}>
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
