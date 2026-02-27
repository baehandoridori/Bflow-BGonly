import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Responsive, WidthProvider, type Layouts, type Layout } from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ChevronDown, ChevronRight, ArrowLeft, Check } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { DepartmentComparisonWidget } from '@/components/widgets/DepartmentComparisonWidget';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import { MyTasksWidget } from '@/components/widgets/MyTasksWidget';
import { MemoWidget } from '@/components/widgets/MemoWidget';
import { WidgetIdContext } from '@/components/widgets/Widget';
import { EdgeGlow, type ResizeZone } from '@/components/widgets/EdgeGlow';
import { EpOverallProgressWidget } from '@/components/widgets/episode/EpOverallProgressWidget';
import { EpStageBarsWidget } from '@/components/widgets/episode/EpStageBarsWidget';
import { EpAssigneeCardsWidget } from '@/components/widgets/episode/EpAssigneeCardsWidget';
import { EpPartProgressWidget } from '@/components/widgets/episode/EpPartProgressWidget';
import { EpDeptComparisonWidget } from '@/components/widgets/episode/EpDeptComparisonWidget';
import { EpSinglePartWidget, parsePartWidgetId } from '@/components/widgets/episode/EpSinglePartWidget';
import { ChartTypeContextMenu, getWidgetSupportedCharts, useChartContextMenu } from '@/components/widgets/ChartTypeContextMenu';
import { saveLayout } from '@/services/settingsService';
import { DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import { cn } from '@/utils/cn';
import { getPreset } from '@/themes';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '@/styles/widget-animations.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

/* ── 대시보드 플렉서스 배경 (연결선 + 그라데이션 조명 + 마우스 반응) ── */
interface DashPt { x: number; y: number; vx: number; vy: number; size: number; color: [number, number, number]; alpha: number }
const DEFAULT_DASH_PT_COUNT = 120;
const DASH_CONNECT_DIST = 140;

function DashboardPlexus() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef<DashPt[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const sizeRef = useRef({ w: 0, h: 0 });

  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const dashEnabled = plexusSettings.dashboardEnabled;
  const ptCount = plexusSettings.dashboardParticleCount || DEFAULT_DASH_PT_COUNT;

  // 커스텀 설정 ref (애니메이션 루프 재시작 없이 즉시 반영, 대시보드 기본값 대비 비례 스케일)
  const cfgRef = useRef({
    speed: plexusSettings.speed ?? 1.0,
    mouseRadius: 220 * ((plexusSettings.mouseRadius ?? 250) / 250),
    mouseForce: 0.015 * ((plexusSettings.mouseForce ?? 0.06) / 0.06),
    glowIntensity: plexusSettings.glowIntensity ?? 1.0,
    connectionDist: DASH_CONNECT_DIST * ((plexusSettings.connectionDist ?? 160) / 160),
  });
  cfgRef.current = {
    speed: plexusSettings.speed ?? 1.0,
    mouseRadius: 220 * ((plexusSettings.mouseRadius ?? 250) / 250),
    mouseForce: 0.015 * ((plexusSettings.mouseForce ?? 0.06) / 0.06),
    glowIntensity: plexusSettings.glowIntensity ?? 1.0,
    connectionDist: DASH_CONNECT_DIST * ((plexusSettings.connectionDist ?? 160) / 160),
  };

  useEffect(() => {
    if (!dashEnabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const getColors = (): [number, number, number][] => {
      const themeId = useAppStore.getState().themeId;
      const custom = useAppStore.getState().customThemeColors;
      const colors = custom ?? getPreset(themeId)?.colors;
      if (!colors) return [[108, 92, 231], [162, 155, 254]];
      const parse = (s: string): [number, number, number] => { const [r, g, b] = s.split(' ').map(Number); return [r, g, b]; };
      return [parse(colors.accent), parse(colors.accentSub)];
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      // fixed 포지션이므로 window 크기 사용
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
      if (ptsRef.current.length === 0 || ptsRef.current.length !== ptCount) {
        const cols = getColors();
        ptsRef.current = Array.from({ length: ptCount }, () => {
          const c = cols[Math.floor(Math.random() * cols.length)];
          return {
            x: Math.random() * w, y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
            size: 1.2 + Math.random() * 2.5, color: c, alpha: 0.25 + Math.random() * 0.35,
          };
        });
      }
    };
    resize();
    window.addEventListener('resize', resize);
    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouse, { passive: true });

    let running = true;
    const animate = () => {
      if (!running) return;
      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);

      // ── 배경 그라데이션 조명 (위젯 글래스모피즘을 위한 충분한 밝기) ──
      const cols = getColors();
      const [ar, ag, ab] = cols[0];
      const [sr, sg, sb] = cols[1] ?? cols[0];
      // 좌상단 글로우 (강)
      const grd1 = ctx.createRadialGradient(w * 0.12, h * 0.15, 0, w * 0.12, h * 0.15, w * 0.55);
      grd1.addColorStop(0, `rgba(${ar},${ag},${ab},0.18)`);
      grd1.addColorStop(0.5, `rgba(${ar},${ag},${ab},0.06)`);
      grd1.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
      ctx.fillStyle = grd1;
      ctx.fillRect(0, 0, w, h);
      // 우하단 글로우 (강)
      const grd2 = ctx.createRadialGradient(w * 0.88, h * 0.85, 0, w * 0.88, h * 0.85, w * 0.55);
      grd2.addColorStop(0, `rgba(${sr},${sg},${sb},0.15)`);
      grd2.addColorStop(0.5, `rgba(${sr},${sg},${sb},0.05)`);
      grd2.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
      ctx.fillStyle = grd2;
      ctx.fillRect(0, 0, w, h);
      // 중앙 소프트 글로우 (위젯 뒤로 비치는 조명)
      const grd3 = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.4);
      grd3.addColorStop(0, `rgba(${(ar + sr) >> 1},${(ag + sg) >> 1},${(ab + sb) >> 1},0.08)`);
      grd3.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd3;
      ctx.fillRect(0, 0, w, h);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const pts = ptsRef.current;
      const dc = cfgRef.current;

      // 업데이트 위치
      for (const p of pts) {
        const dx = p.x - mx; const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < dc.mouseRadius && dist > 1) {
          const force = (1 - dist / dc.mouseRadius) * dc.mouseForce;
          p.vx += (dx / dist) * force; p.vy += (dy / dist) * force;
        }
        p.vx *= 0.992; p.vy *= 0.992;
        p.x += p.vx * dc.speed; p.y += p.vy * dc.speed;
        if (p.x < -30) p.x = w + 30; if (p.x > w + 30) p.x = -30;
        if (p.y < -30) p.y = h + 30; if (p.y > h + 30) p.y = -30;
      }

      // ── 연결선 ──
      const cDist = dc.connectionDist;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < cDist) {
            const alpha = (1 - dist / cDist) * 0.28;
            const [r, g, b] = pts[i].color;
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = (1 - dist / cDist) * 1.2;
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.stroke();
          }
        }
      }

      // ── 파티클 ──
      const dcGlow = dc.glowIntensity;
      for (const p of pts) {
        const dx = p.x - mx; const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nearMouse = dist < dc.mouseRadius;
        const glowAlpha = nearMouse ? p.alpha + (1 - dist / dc.mouseRadius) * 0.25 : p.alpha;
        const [r, g, b] = p.color;
        // 소프트 글로우
        if (dcGlow > 0.2) {
          const glR = p.size * 5 * dcGlow;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glR);
          grad.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha * 0.5 * dcGlow})`);
          grad.addColorStop(0.3, `rgba(${r},${g},${b},${glowAlpha * 0.15 * dcGlow})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(p.x - glR, p.y - glR, glR * 2, glR * 2);
        }
        // 코어 도트
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${glowAlpha * 0.9})`;
        ctx.fill();
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    return () => { running = false; window.removeEventListener('resize', resize); window.removeEventListener('mousemove', onMouse); };
  }, [dashEnabled, ptCount]);

  if (!dashEnabled) return null;
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" style={{ opacity: 0.85 }} />;
}

/* ── 위젯 메타데이터 ── */
interface WidgetMeta {
  id: string;
  label: string;
  component: React.ReactNode;
  deptOnly?: boolean; // 부서별 탭에서만 표시
  allOnly?: boolean;  // 통합 탭에서만 표시
}

const ALL_WIDGETS: WidgetMeta[] = [
  { id: 'overall-progress', label: '전체 진행률', component: <OverallProgressWidget /> },
  { id: 'stage-bars', label: '단계별 진행률', component: <StageBarsWidget />, deptOnly: true },
  { id: 'assignee-cards', label: '담당자별 현황', component: <AssigneeCardsWidget /> },
  { id: 'episode-summary', label: '에피소드 요약', component: <EpisodeSummaryWidget /> },
  { id: 'dept-comparison', label: '부서별 비교', component: <DepartmentComparisonWidget />, allOnly: true },
  { id: 'calendar', label: '캘린더', component: <CalendarWidget /> },
  { id: 'my-tasks', label: '내 할일', component: <MyTasksWidget /> },
  { id: 'memo', label: '메모', component: <MemoWidget /> },
];

const WIDGET_MAP = Object.fromEntries(ALL_WIDGETS.map((w) => [w.id, w.component]));

/* ── 에피소드 대시보드 전용 위젯 ── */
const EP_WIDGETS: WidgetMeta[] = [
  { id: 'ep-overall-progress', label: 'EP 통합 진행률', component: <EpOverallProgressWidget /> },
  { id: 'ep-stage-bars', label: 'EP 단계별 진행률', component: <EpStageBarsWidget /> },
  { id: 'ep-assignee-cards', label: 'EP 담당자별 현황', component: <EpAssigneeCardsWidget /> },
  { id: 'ep-part-progress', label: 'EP 파트별 진행률', component: <EpPartProgressWidget /> },
  { id: 'ep-dept-comparison', label: 'EP 부서별 비교', component: <EpDeptComparisonWidget />, allOnly: true },
  { id: 'calendar', label: '캘린더', component: <CalendarWidget /> },
  { id: 'my-tasks', label: '내 할일', component: <MyTasksWidget /> },
  { id: 'memo', label: '메모', component: <MemoWidget /> },
];

const EP_WIDGET_MAP = Object.fromEntries(EP_WIDGETS.map((w) => [w.id, w.component]));

/** 위젯 ID에서 실제 컴포넌트를 찾기 (calendar-{timestamp} 형태 지원) */
function getWidgetComponent(id: string, isEpMode: boolean): React.ReactNode | undefined {
  if (id.startsWith('calendar-') || id === 'calendar') {
    return <CalendarWidget />;
  }
  if (id.startsWith('my-tasks')) {
    return <MyTasksWidget />;
  }
  if (id.startsWith('memo-') || id === 'memo') {
    return <MemoWidget />;
  }
  // 파트 단일 위젯: ep-part-{bg|acting|all}-{A~Z}[-{ts}]
  if (parsePartWidgetId(id)) {
    return <EpSinglePartWidget />;
  }
  if (isEpMode) {
    return EP_WIDGET_MAP[id] ?? WIDGET_MAP[id];
  }
  return WIDGET_MAP[id];
}

/* ── 부서별 레이아웃 (24칸 그리드, rowHeight=16px) ── */
const DEPT_LAYOUT: Layout[] = [
  { i: 'overall-progress', x: 0, y: 0, w: 6, h: 20, minW: 2, minH: 2 },
  { i: 'stage-bars', x: 6, y: 0, w: 12, h: 20, minW: 2, minH: 2 },
  { i: 'assignee-cards', x: 18, y: 0, w: 6, h: 20, minW: 2, minH: 2 },
  { i: 'episode-summary', x: 0, y: 20, w: 12, h: 25, minW: 2, minH: 2 },
  { i: 'my-tasks', x: 12, y: 20, w: 6, h: 25, minW: 2, minH: 2 },
  { i: 'calendar', x: 18, y: 20, w: 6, h: 25, minW: 2, minH: 2 },
];

/* ── 통합 레이아웃 (24칸 그리드, rowHeight=16px) ── */
const ALL_LAYOUT: Layout[] = [
  { i: 'overall-progress', x: 0, y: 0, w: 6, h: 20, minW: 2, minH: 2 },
  { i: 'dept-comparison', x: 6, y: 0, w: 12, h: 20, minW: 2, minH: 2 },
  { i: 'assignee-cards', x: 18, y: 0, w: 6, h: 20, minW: 2, minH: 2 },
  { i: 'episode-summary', x: 0, y: 20, w: 12, h: 25, minW: 2, minH: 2 },
  { i: 'my-tasks', x: 12, y: 20, w: 6, h: 25, minW: 2, minH: 2 },
  { i: 'calendar', x: 18, y: 20, w: 6, h: 25, minW: 2, minH: 2 },
];

/* ── 에피소드 대시보드 기본 레이아웃 (24칸 그리드) ── */
const EP_LAYOUT: Layout[] = [
  { i: 'ep-overall-progress', x: 0, y: 0, w: 6, h: 20, minW: 2, minH: 2 },
  { i: 'ep-dept-comparison', x: 6, y: 0, w: 12, h: 20, minW: 2, minH: 2 },
  { i: 'ep-assignee-cards', x: 18, y: 0, w: 6, h: 20, minW: 2, minH: 2 },
  { i: 'ep-part-progress', x: 0, y: 20, w: 12, h: 25, minW: 2, minH: 2 },
  { i: 'ep-stage-bars', x: 12, y: 20, w: 6, h: 25, minW: 2, minH: 2 },
  { i: 'my-tasks', x: 18, y: 20, w: 6, h: 25, minW: 2, minH: 2 },
];

/* ── 파트 전용 위젯 타입 (2단계 선택) ── */
interface PartWidgetType {
  deptKey: 'bg' | 'acting' | 'all';
  label: string;
}

const PART_WIDGET_TYPES: PartWidgetType[] = [
  { deptKey: 'bg', label: '파트 BG 진행률' },
  { deptKey: 'acting', label: '파트 ACT 진행률' },
  { deptKey: 'all', label: '파트 전체 진행률' },
];

/* ── 위젯 추가 팝오버 ── */
function WidgetPicker({
  hiddenWidgets,
  onAdd,
  onClose,
  isEpMode,
  partIds,
}: {
  hiddenWidgets: WidgetMeta[];
  onAdd: (id: string) => void;
  onClose: () => void;
  isEpMode: boolean;
  partIds: string[];
}) {
  const [expandedPartType, setExpandedPartType] = useState<string | null>(null);
  const hasContent = hiddenWidgets.length > 0 || (isEpMode && partIds.length > 0);
  if (!hasContent) return null;

  const menuStyle = {
    backgroundColor: 'rgb(var(--color-bg-card) / 0.92)',
    border: '1px solid rgb(var(--color-bg-border) / 0.6)',
    boxShadow: '0 12px 32px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full left-0 mt-2 z-50 min-w-[200px]"
    >
      <div className="rounded-xl overflow-hidden py-1.5" style={menuStyle}>
        <div className="px-3 py-1.5 text-[11px] font-medium text-text-secondary/50 uppercase tracking-wider">
          위젯 추가
        </div>
        {/* 일반 위젯 목록 */}
        {hiddenWidgets.map((w) => (
          <button
            key={w.id}
            onClick={() => onAdd(w.id)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
              'text-text-primary/80 hover:bg-accent/12 hover:text-text-primary',
              'transition-colors duration-75',
            )}
          >
            <Plus size={14} className="text-accent/60 shrink-0" />
            <span>{w.label}</span>
          </button>
        ))}

        {/* 파트 전용 위젯 (EP 모드 + 파트 존재 시) */}
        {isEpMode && partIds.length > 0 && (
          <>
            <div className="mx-2 my-1 border-t border-bg-border/40" />
            {PART_WIDGET_TYPES.map((pt) => {
              const isExpanded = expandedPartType === pt.deptKey;
              return (
                <div key={pt.deptKey}>
                  <button
                    onClick={() => setExpandedPartType(isExpanded ? null : pt.deptKey)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                      'text-text-primary/80 hover:bg-accent/12 hover:text-text-primary',
                      'transition-colors duration-75',
                    )}
                  >
                    <ChevronRight size={14} className={cn('text-accent/60 shrink-0 transition-transform duration-150', isExpanded && 'rotate-90')} />
                    <span>{pt.label}</span>
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="pl-4">
                          {partIds.map((partId) => (
                            <button
                              key={partId}
                              onClick={() => onAdd(`ep-part-${pt.deptKey}-${partId}-${Date.now()}`)}
                              className={cn(
                                'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer',
                                'text-text-primary/70 hover:bg-accent/12 hover:text-text-primary',
                                'transition-colors duration-75',
                              )}
                            >
                              <Plus size={12} className="text-accent/50 shrink-0" />
                              <span>{partId}파트</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </>
        )}
      </div>
    </motion.div>
  );
}

/* ── 커서 위치 기반 edge zone 감지 (onMouseMove용) ── */
function detectEdgeZone(e: React.MouseEvent, el: HTMLElement): ResizeZone {
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const w = rect.width;
  const h = rect.height;
  const EDGE = 22;

  const top = y < EDGE;
  const bottom = y > h - EDGE;
  const left = x < EDGE;
  const right = x > w - EDGE;

  if (top && left) return 'nw';
  if (top && right) return 'ne';
  if (bottom && left) return 'sw';
  if (bottom && right) return 'se';
  if (top) return 'n';
  if (bottom) return 's';
  if (left) return 'w';
  if (right) return 'e';
  return null;
}

/* ── 에피소드 드롭다운 ── */
function EpisodeDropdown({
  onSelect,
  onClose,
  selectedEp,
}: {
  onSelect: (epNum: number) => void;
  onClose: () => void;
  selectedEp: number | null;
}) {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const sorted = useMemo(
    () => [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes],
  );
  const [focusIdx, setFocusIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((p) => Math.min(p + 1, sorted.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((p) => Math.max(p - 1, 0));
      } else if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < sorted.length) {
        e.preventDefault();
        onSelect(sorted[focusIdx].episodeNumber);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusIdx, sorted, onSelect, onClose]);

  if (sorted.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full left-0 mt-2 z-50 min-w-[200px]"
    >
      <div
        ref={listRef}
        className="rounded-xl overflow-hidden py-1.5 max-h-[320px] overflow-y-auto"
        style={{
          backgroundColor: 'rgb(var(--color-bg-card) / 0.92)',
          border: '1px solid rgb(var(--color-bg-border) / 0.6)',
          boxShadow: '0 12px 32px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset',
        }}
      >
        <div className="px-3 py-1.5 text-[11px] font-medium text-text-secondary/50 uppercase tracking-wider">
          에피소드 선택
        </div>
        {sorted.map((ep, idx) => {
          const displayName = episodeTitles[ep.episodeNumber] || ep.title;
          const isSelected = selectedEp === ep.episodeNumber;
          const isFocused = focusIdx === idx;
          return (
            <button
              key={ep.episodeNumber}
              onClick={() => onSelect(ep.episodeNumber)}
              onMouseEnter={() => setFocusIdx(idx)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                'transition-colors duration-75',
                isFocused ? 'bg-accent/12 text-text-primary' : 'text-text-primary/80 hover:bg-accent/8',
              )}
            >
              <span className="flex-1 truncate">{displayName}</span>
              {isSelected && <Check size={14} className="text-accent shrink-0" />}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── 대시보드 메인 ── */
export function Dashboard() {
  const { widgetLayout, allWidgetLayout, episodeWidgetLayout, setWidgetLayout, setAllWidgetLayout, setEpisodeWidgetLayout, setSelectedDepartment } = useAppStore();
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const setDashboardFilter = useAppStore((s) => s.setDashboardDeptFilter);
  const episodeDashboardEp = useAppStore((s) => s.episodeDashboardEp);
  const setEpisodeDashboardEp = useAppStore((s) => s.setEpisodeDashboardEp);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const episodeMemos = useDataStore((s) => s.episodeMemos);
  const [showPicker, setShowPicker] = useState(false);
  const [showEpDropdown, setShowEpDropdown] = useState(false);
  const [showEpSwitcher, setShowEpSwitcher] = useState(false);
  const isEpMode = episodeDashboardEp !== null;
  const episodes = useDataStore((s) => s.episodes);

  // 현재 에피소드의 파트 ID 목록 (위젯 피커 2단계용)
  const epPartIds = useMemo(() => {
    if (!isEpMode) return [];
    const ep = episodes.find((e) => e.episodeNumber === episodeDashboardEp);
    if (!ep) return [];
    return [...new Set(ep.parts.map((p) => p.partId))].sort();
  }, [episodes, episodeDashboardEp, isEpMode]);

  // 차트 타입 우클릭 메뉴
  const { menu: chartMenu, handleContextMenu: handleChartContextMenu, closeMenu: closeChartMenu } = useChartContextMenu();

  // Edge glow 상태: 위젯별 현재 호버 중인 리사이즈 존
  const [edgeZones, setEdgeZones] = useState<Record<string, ResizeZone>>({});
  // 호버 상태: 위젯 위에 마우스가 올라와 있는지
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 드래그/리사이즈 상태
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isActive = draggingId !== null || resizingId !== null;

  // 드래그 콜백
  const handleDragStart = useCallback((_layout: Layout[], oldItem: Layout) => {
    setDraggingId(oldItem.i);
    setHoveredId(null);
  }, []);

  const handleDragStop = useCallback((_layout: Layout[], oldItem: Layout) => {
    setDraggingId(null);
    setSettlingId(oldItem.i);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => setSettlingId(null), 450);
  }, []);

  // 리사이즈 콜백
  const handleResizeStart = useCallback((_layout: Layout[], oldItem: Layout) => {
    setResizingId(oldItem.i);
    setHoveredId(null);
  }, []);

  const handleResizeStop = useCallback((_layout: Layout[], oldItem: Layout) => {
    setResizingId(null);
    setSettlingId(oldItem.i);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => setSettlingId(null), 450);
  }, []);

  // cleanup
  useEffect(() => () => { if (settleTimerRef.current) clearTimeout(settleTimerRef.current); }, []);

  const handleDeptSelect = useCallback((filter: typeof dashboardFilter) => {
    setDashboardFilter(filter);
    if (filter !== 'all') {
      setSelectedDepartment(filter);
    }
  }, [setDashboardFilter, setSelectedDepartment]);

  // 에피소드 드롭다운에서 EP 선택
  const handleEpSelect = useCallback((epNum: number) => {
    setEpisodeDashboardEp(epNum);
    setDashboardFilter('all');
    setShowEpDropdown(false);
    setShowEpSwitcher(false);
  }, [setEpisodeDashboardEp, setDashboardFilter]);

  // 에피소드 대시보드 → 전체 대시보드 복귀
  const handleBackToMain = useCallback(() => {
    setEpisodeDashboardEp(null);
    setDashboardFilter('all');
  }, [setEpisodeDashboardEp, setDashboardFilter]);

  // 에피소드 대시보드 제목
  const epDisplayName = isEpMode
    ? (episodeTitles[episodeDashboardEp] || `EP.${String(episodeDashboardEp).padStart(2, '0')}`)
    : null;

  const defaultLayout = isEpMode ? EP_LAYOUT
    : dashboardFilter === 'all' ? ALL_LAYOUT : DEPT_LAYOUT;

  const layouts: Layouts = useMemo(() => {
    const raw = isEpMode
      ? (episodeWidgetLayout ?? EP_LAYOUT)
      : dashboardFilter === 'all'
        ? (allWidgetLayout ?? ALL_LAYOUT)
        : (widgetLayout ?? DEPT_LAYOUT);
    // 저장된 레이아웃의 minW를 1로 클램프 — 좁은 breakpoint(xxs cols=1)에서 경고 방지
    const lg = raw.map(item => item.minW && item.minW > 1 ? { ...item, minW: 1 } : item);
    return { lg };
  }, [widgetLayout, allWidgetLayout, episodeWidgetLayout, dashboardFilter, isEpMode]);

  const currentLayout = layouts.lg ?? defaultLayout;

  // 현재 숨겨진 위젯 목록 (캘린더 위젯은 항상 추가 가능)
  const widgetPool = isEpMode ? EP_WIDGETS : ALL_WIDGETS;
  const hiddenWidgets = useMemo(() => {
    const visibleIds = new Set(currentLayout.map((l) => l.i));
    return widgetPool.filter((w) => {
      // 캘린더/메모 위젯은 중복 배치 허용 → 항상 추가 가능
      if (w.id === 'calendar' || w.id === 'memo') return true;
      if (visibleIds.has(w.id)) return false;
      if (dashboardFilter === 'all' && w.deptOnly) return false;
      if (dashboardFilter !== 'all' && w.allOnly) return false;
      return true;
    });
  }, [currentLayout, dashboardFilter, widgetPool]);

  const handleLayoutChange = useCallback(
    (_current: Layout[], allLayouts: Layouts) => {
      const newLayout = allLayouts.lg ?? _current;
      if (isEpMode) {
        setEpisodeWidgetLayout(newLayout);
        saveLayout(newLayout, 'episode');
      } else if (dashboardFilter === 'all') {
        setAllWidgetLayout(newLayout);
        saveLayout(newLayout, 'all');
      } else {
        setWidgetLayout(newLayout);
        saveLayout(newLayout);
      }
    },
    [setWidgetLayout, setAllWidgetLayout, setEpisodeWidgetLayout, dashboardFilter, isEpMode],
  );

  const handleRemoveWidget = useCallback((widgetId: string) => {
    if (isEpMode) {
      const current = episodeWidgetLayout ?? EP_LAYOUT;
      const newLayout = current.filter((l) => l.i !== widgetId);
      setEpisodeWidgetLayout(newLayout);
      saveLayout(newLayout, 'episode');
    } else if (dashboardFilter === 'all') {
      const current = allWidgetLayout ?? ALL_LAYOUT;
      const newLayout = current.filter((l) => l.i !== widgetId);
      setAllWidgetLayout(newLayout);
      saveLayout(newLayout, 'all');
    } else {
      const current = widgetLayout ?? DEPT_LAYOUT;
      const newLayout = current.filter((l) => l.i !== widgetId);
      setWidgetLayout(newLayout);
      saveLayout(newLayout);
    }
  }, [widgetLayout, allWidgetLayout, episodeWidgetLayout, setWidgetLayout, setAllWidgetLayout, setEpisodeWidgetLayout, dashboardFilter, isEpMode]);

  const handleAddWidget = useCallback((widgetId: string) => {
    const current = isEpMode
      ? (episodeWidgetLayout ?? EP_LAYOUT)
      : dashboardFilter === 'all'
        ? (allWidgetLayout ?? ALL_LAYOUT)
        : (widgetLayout ?? DEPT_LAYOUT);
    // 캘린더/메모 위젯은 고유 ID로 중복 배치 허용
    const actualId = widgetId === 'calendar' ? `calendar-${Date.now()}`
      : widgetId === 'memo' ? `memo-${Date.now()}`
      : widgetId;
    // 맨 아래에 추가
    const maxY = current.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    const newItem: Layout = { i: actualId, x: 0, y: maxY, w: 8, h: 15, minW: 2, minH: 2 };
    const newLayout = [...current, newItem];
    if (isEpMode) {
      setEpisodeWidgetLayout(newLayout);
      saveLayout(newLayout, 'episode');
    } else if (dashboardFilter === 'all') {
      setAllWidgetLayout(newLayout);
      saveLayout(newLayout, 'all');
    } else {
      setWidgetLayout(newLayout);
      saveLayout(newLayout);
    }
    setShowPicker(false);
  }, [widgetLayout, allWidgetLayout, episodeWidgetLayout, setWidgetLayout, setAllWidgetLayout, setEpisodeWidgetLayout, dashboardFilter, isEpMode]);

  return (
    <div className="relative flex flex-col gap-4 h-full overflow-y-auto overflow-x-hidden z-0">
      {/* 경량 플렉서스 배경 (fixed로 뷰포트 전체 커버) */}
      <DashboardPlexus />

      {/* 부서 탭 + 편집 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isEpMode ? (
            /* ── 에피소드 대시보드 탭 바 ── */
            <div className="flex items-center gap-2">
              {/* 전체보기 버튼 */}
              <button
                onClick={handleBackToMain}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium cursor-pointer',
                  'bg-bg-card border border-bg-border',
                  'text-text-secondary hover:text-text-primary hover:bg-bg-border/50',
                  'transition-colors duration-150',
                )}
              >
                <ArrowLeft size={14} />
                <span className="text-xs">전체보기</span>
              </button>

              {/* 에피소드 제목 + 전환 드롭다운 */}
              <div className="relative">
                <button
                  onClick={() => setShowEpSwitcher(!showEpSwitcher)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer',
                    'hover:bg-bg-border/30 transition-colors duration-150',
                  )}
                >
                  <span className="text-sm font-semibold text-accent">{epDisplayName}</span>
                  <ChevronDown size={14} className={cn('text-accent/60 transition-transform duration-200', showEpSwitcher && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {showEpSwitcher && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowEpSwitcher(false)} />
                      <EpisodeDropdown
                        selectedEp={episodeDashboardEp}
                        onSelect={handleEpSelect}
                        onClose={() => setShowEpSwitcher(false)}
                      />
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* 에피소드 메모 */}
              {episodeDashboardEp !== null && episodeMemos[episodeDashboardEp] && (
                <span className="text-xs text-text-secondary/70 max-w-[300px] truncate" title={episodeMemos[episodeDashboardEp]}>
                  {episodeMemos[episodeDashboardEp]}
                </span>
              )}

              {/* 통합/배경/액팅 탭 */}
              <div className="relative flex bg-bg-card rounded-lg p-1 border border-bg-border gap-0.5">
                <button
                  onClick={() => handleDeptSelect('all')}
                  className={cn(
                    'relative z-10 px-5 py-1.5 text-sm rounded-md font-medium cursor-pointer',
                    'transition-colors duration-200 ease-out',
                    dashboardFilter === 'all'
                      ? 'text-white'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {dashboardFilter === 'all' && (
                    <motion.div
                      layoutId="ep-tab-indicator"
                      className="absolute inset-0 rounded-md bg-accent shadow-sm shadow-accent/25"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">통합</span>
                </button>
                {DEPARTMENTS.map((dept) => {
                  const cfg = DEPARTMENT_CONFIGS[dept];
                  const active = dashboardFilter === dept;
                  return (
                    <button
                      key={dept}
                      onClick={() => handleDeptSelect(dept)}
                      className={cn(
                        'relative z-10 px-5 py-1.5 text-sm rounded-md font-medium cursor-pointer',
                        'transition-colors duration-200 ease-out',
                        active
                          ? 'text-white'
                          : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {active && (
                        <motion.div
                          layoutId="ep-tab-indicator"
                          className="absolute inset-0 rounded-md shadow-sm"
                          style={{ backgroundColor: cfg.color, boxShadow: `0 2px 8px ${cfg.color}40` }}
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10">{cfg.label} ({cfg.shortLabel})</span>
                    </button>
                  );
                })}

                {/* EP 모드 내 에피소드 드롭다운 */}
                <div className="relative border-l border-bg-border/50 ml-0.5 pl-0.5">
                  <button
                    onClick={() => setShowEpDropdown(!showEpDropdown)}
                    className={cn(
                      'relative z-10 px-4 py-1.5 text-sm rounded-md font-medium cursor-pointer',
                      'transition-colors duration-200 ease-out',
                      'text-text-secondary hover:text-text-primary',
                      'flex items-center gap-1',
                    )}
                  >
                    <span>에피소드</span>
                    <ChevronDown size={14} className={cn('transition-transform duration-200', showEpDropdown && 'rotate-180')} />
                  </button>
                  <AnimatePresence>
                    {showEpDropdown && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowEpDropdown(false)} />
                        <EpisodeDropdown
                          selectedEp={episodeDashboardEp}
                          onSelect={handleEpSelect}
                          onClose={() => setShowEpDropdown(false)}
                        />
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          ) : (
            /* ── 전체 대시보드 탭 바 ── */
            <div className="relative flex bg-bg-card rounded-lg p-1 border border-bg-border gap-0.5">
              {/* 통합 탭 */}
              <button
                onClick={() => handleDeptSelect('all')}
                className={cn(
                  'relative z-10 px-5 py-1.5 text-sm rounded-md font-medium cursor-pointer',
                  'transition-colors duration-200 ease-out',
                  dashboardFilter === 'all'
                    ? 'text-white'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {dashboardFilter === 'all' && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute inset-0 rounded-md bg-accent shadow-sm shadow-accent/25"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">통합</span>
              </button>
              {/* 부서별 탭 */}
              {DEPARTMENTS.map((dept) => {
                const cfg = DEPARTMENT_CONFIGS[dept];
                const active = dashboardFilter === dept;
                return (
                  <button
                    key={dept}
                    onClick={() => handleDeptSelect(dept)}
                    className={cn(
                      'relative z-10 px-5 py-1.5 text-sm rounded-md font-medium cursor-pointer',
                      'transition-colors duration-200 ease-out',
                      active
                        ? 'text-white'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {active && (
                      <motion.div
                        layoutId="tab-indicator"
                        className="absolute inset-0 rounded-md shadow-sm"
                        style={{ backgroundColor: cfg.color, boxShadow: `0 2px 8px ${cfg.color}40` }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10">{cfg.label} ({cfg.shortLabel})</span>
                  </button>
                );
              })}
              {/* 에피소드 드롭다운 탭 */}
              <div className="relative">
                <button
                  onClick={() => setShowEpDropdown(!showEpDropdown)}
                  className={cn(
                    'relative z-10 px-4 py-1.5 text-sm rounded-md font-medium cursor-pointer',
                    'transition-colors duration-200 ease-out',
                    'text-text-secondary hover:text-text-primary',
                    'flex items-center gap-1',
                  )}
                >
                  <span>에피소드</span>
                  <ChevronDown size={14} className={cn('transition-transform duration-200', showEpDropdown && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {showEpDropdown && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowEpDropdown(false)} />
                      <EpisodeDropdown
                        selectedEp={episodeDashboardEp}
                        onSelect={handleEpSelect}
                        onClose={() => setShowEpDropdown(false)}
                      />
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* 위젯 추가 */}
        <div className="relative flex items-center gap-2">
          {hiddenWidgets.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowPicker(!showPicker)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer',
                  'bg-accent/10 text-accent hover:bg-accent/20',
                  'transition-colors duration-150',
                  'border border-accent/20',
                )}
              >
                <Plus size={14} />
                위젯 추가
              </button>
              <AnimatePresence>
                {showPicker && (
                  <WidgetPicker
                    hiddenWidgets={hiddenWidgets}
                    onAdd={handleAddWidget}
                    onClose={() => setShowPicker(false)}
                    isEpMode={isEpMode}
                    partIds={epPartIds}
                  />
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${isEpMode ? `ep-${episodeDashboardEp}` : 'main'}-${dashboardFilter}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="flex-1"
        >
          <ResponsiveGridLayout
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 24, md: 24, sm: 12, xs: 12, xxs: 6 }}
            rowHeight={16}
            margin={[6, 6]}
            containerPadding={[10, 8]}
            compactType="vertical"
            preventCollision={false}
            isDraggable
            isResizable
            resizeHandles={['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']}
            draggableHandle=".widget-drag-handle"
            onLayoutChange={handleLayoutChange}
            onDragStart={handleDragStart}
            onDragStop={handleDragStop}
            onResizeStart={handleResizeStart}
            onResizeStop={handleResizeStop}
            useCSSTransforms
          >
            {currentLayout.map((item) => {
              const zone = edgeZones[item.i] ?? null;
              const isDrag = draggingId === item.i;
              const isResize = resizingId === item.i;
              const isSettle = settlingId === item.i;
              const isDimmed = isActive && !isDrag && !isResize;
              return (
                <div
                  key={item.i}
                  className={cn(
                    'relative h-full',
                    isSettle && 'widget-settling',
                  )}
                  style={{ overflow: 'visible' }}
                  onMouseMove={(e) => {
                    if (isDrag || isActive) return;
                    const zone = detectEdgeZone(e, e.currentTarget);
                    setEdgeZones((p) => {
                      if (p[item.i] === zone) return p;
                      return { ...p, [item.i]: zone };
                    });
                    // 드래그 핸들(헤더) 위일 때만 전체 글로우
                    const onDragHandle = !!(e.target as HTMLElement).closest?.('.widget-drag-handle');
                    setHoveredId(onDragHandle ? item.i : null);
                  }}
                  onMouseLeave={() => {
                    setEdgeZones((p) => ({ ...p, [item.i]: null }));
                    setHoveredId(null);
                  }}
                  onContextMenu={(e) => handleChartContextMenu(e, item.i)}
                >
                  <WidgetIdContext.Provider value={item.i.startsWith('calendar-') ? 'calendar' : item.i}>
                    {getWidgetComponent(item.i, isEpMode) ?? (
                      <div className="bg-bg-card rounded-xl p-4 text-text-secondary text-sm h-full">
                        위젯: {item.i}
                      </div>
                    )}
                  </WidgetIdContext.Provider>

                  {/* Edge Glow 시각 효과 */}
                  {!isDrag && !isActive && <EdgeGlow zone={zone} hovered={hoveredId === item.i} />}

                  {/* 드래그 시 pulse glow 보더 */}
                  {isDrag && (
                    <div
                      style={{
                        position: 'absolute', inset: -1, borderRadius: 13,
                        pointerEvents: 'none',
                        border: '1.5px solid rgb(var(--color-accent) / 0.5)',
                        boxShadow: '0 0 20px rgb(var(--color-accent) / 0.2), inset 0 0 20px rgb(var(--color-accent) / 0.06)',
                        animation: 'glowPulse 1.5s ease-in-out infinite',
                      }}
                    />
                  )}

                  {/* 리사이즈 시 보더 강조 */}
                  {isResize && (
                    <div
                      style={{
                        position: 'absolute', inset: -1, borderRadius: 13,
                        pointerEvents: 'none',
                        border: '1.5px solid rgb(var(--color-accent) / 0.45)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgb(var(--color-accent) / 0.3)',
                      }}
                    />
                  )}

                  {/* 안착 flash */}
                  {isSettle && (
                    <div
                      style={{
                        position: 'absolute', inset: -1, borderRadius: 13,
                        pointerEvents: 'none',
                        border: '1.5px solid rgb(var(--color-accent) / 0.45)',
                        animation: 'settleFlash 0.45s ease-out forwards',
                      }}
                    />
                  )}

                  {/* 다른 위젯 dim 오버레이 */}
                  <AnimatePresence>
                    {isDimmed && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                        style={{
                          position: 'absolute', inset: 0, borderRadius: 12,
                          background: 'rgb(var(--color-bg-primary) / 0.5)',
                          backdropFilter: 'blur(2px)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </AnimatePresence>

                </div>
              );
            })}
          </ResponsiveGridLayout>
        </motion.div>
      </AnimatePresence>

      {/* 차트 타입 우클릭 메뉴 */}
      <AnimatePresence>
        {chartMenu && (
          <ChartTypeContextMenu
            widgetId={chartMenu.widgetId}
            supportedTypes={getWidgetSupportedCharts(chartMenu.widgetId)}
            x={chartMenu.x}
            y={chartMenu.y}
            onClose={closeChartMenu}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
