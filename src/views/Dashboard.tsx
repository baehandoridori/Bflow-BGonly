import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Responsive, WidthProvider, type Layouts, type Layout } from 'react-grid-layout';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Check, Plus, X } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { DepartmentComparisonWidget } from '@/components/widgets/DepartmentComparisonWidget';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import { saveLayout } from '@/services/settingsService';
import { DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import { cn } from '@/utils/cn';
import { getPreset } from '@/themes';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

/* ── 경량 플렉서스 배경 (대시보드용) ── */
interface DashPt { x: number; y: number; vx: number; vy: number; size: number; color: [number, number, number]; alpha: number }
const DASH_PT_COUNT = 60;

function DashboardPlexus() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef<DashPt[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
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
      const w = canvas.parentElement!.clientWidth;
      const h = canvas.parentElement!.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
      if (ptsRef.current.length === 0) {
        const cols = getColors();
        ptsRef.current = Array.from({ length: DASH_PT_COUNT }, () => {
          const c = cols[Math.floor(Math.random() * cols.length)];
          return {
            x: Math.random() * w, y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
            size: 1 + Math.random() * 2.5, color: c, alpha: 0.15 + Math.random() * 0.25,
          };
        });
      }
    };
    resize();
    window.addEventListener('resize', resize);
    const onMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    canvas.parentElement!.addEventListener('mousemove', onMouse, { passive: true });

    let running = true;
    const animate = () => {
      if (!running) return;
      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      for (const p of ptsRef.current) {
        const dx = p.x - mx; const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200 && dist > 1) {
          const force = (1 - dist / 200) * 0.02;
          p.vx += (dx / dist) * force; p.vy += (dy / dist) * force;
        }
        p.vx *= 0.99; p.vy *= 0.99;
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;
        const nearMouse = dist < 200;
        const glowAlpha = nearMouse ? p.alpha + (1 - dist / 200) * 0.2 : p.alpha;
        const [r, g, b] = p.color;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
        grad.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
        grad.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.3})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(p.x - p.size * 4, p.y - p.size * 4, p.size * 8, p.size * 8);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${glowAlpha * 0.8})`;
        ctx.fill();
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    return () => { running = false; window.removeEventListener('resize', resize); canvas.parentElement?.removeEventListener('mousemove', onMouse); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" style={{ filter: 'blur(1px)', opacity: 0.6 }} />;
}

/* ── wiggle CSS injection ── */
const WIGGLE_CSS = `
@keyframes widget-wiggle {
  0%, 100% { transform: rotate(-0.7deg); }
  50% { transform: rotate(0.7deg); }
}
`;
let wiggleCssInjected = false;
function ensureWiggleCss() {
  if (wiggleCssInjected) return;
  const el = document.createElement('style');
  el.textContent = WIGGLE_CSS;
  document.head.appendChild(el);
  wiggleCssInjected = true;
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
];

const WIDGET_MAP = Object.fromEntries(ALL_WIDGETS.map((w) => [w.id, w.component]));

/** 위젯 ID에서 실제 컴포넌트를 찾기 (calendar-{timestamp} 형태 지원) */
function getWidgetComponent(id: string): React.ReactNode | undefined {
  if (id.startsWith('calendar-') || id === 'calendar') {
    return <CalendarWidget />;
  }
  return WIDGET_MAP[id];
}

/* ── 부서별 레이아웃 ── */
const DEPT_LAYOUT: Layout[] = [
  { i: 'overall-progress', x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'stage-bars', x: 1, y: 0, w: 2, h: 3, minW: 2, minH: 2 },
  { i: 'assignee-cards', x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'episode-summary', x: 0, y: 3, w: 3, h: 4, minW: 2, minH: 3 },
  { i: 'calendar', x: 3, y: 3, w: 1, h: 4, minW: 1, minH: 3 },
];

/* ── 통합 레이아웃 ── */
const ALL_LAYOUT: Layout[] = [
  { i: 'overall-progress', x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'dept-comparison', x: 1, y: 0, w: 2, h: 3, minW: 2, minH: 2 },
  { i: 'assignee-cards', x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'episode-summary', x: 0, y: 3, w: 3, h: 4, minW: 2, minH: 3 },
  { i: 'calendar', x: 3, y: 3, w: 1, h: 4, minW: 1, minH: 3 },
];

/* ── 위젯 추가 팝오버 ── */
function WidgetPicker({
  hiddenWidgets,
  onAdd,
  onClose,
}: {
  hiddenWidgets: WidgetMeta[];
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  if (hiddenWidgets.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full left-0 mt-2 z-50 min-w-[200px]"
    >
      <div
        className="rounded-xl overflow-hidden py-1.5"
        style={{
          backgroundColor: 'rgba(26,29,39,0.92)',
          border: '1px solid rgba(45,48,65,0.6)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset',
        }}
      >
        <div className="px-3 py-1.5 text-[10px] font-medium text-text-secondary/50 uppercase tracking-wider">
          위젯 추가
        </div>
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
      </div>
    </motion.div>
  );
}

/* ── 대시보드 메인 ── */
export function Dashboard() {
  const { widgetLayout, allWidgetLayout, isEditMode, setWidgetLayout, setAllWidgetLayout, setEditMode, setSelectedDepartment } = useAppStore();
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const setDashboardFilter = useAppStore((s) => s.setDashboardDeptFilter);
  const [showPicker, setShowPicker] = useState(false);

  // 편집 모드에서 wiggle CSS 주입
  useEffect(() => {
    if (isEditMode) ensureWiggleCss();
  }, [isEditMode]);

  const handleDeptSelect = useCallback((filter: typeof dashboardFilter) => {
    setDashboardFilter(filter);
    if (filter !== 'all') {
      setSelectedDepartment(filter);
    }
  }, [setDashboardFilter, setSelectedDepartment]);

  const defaultLayout = dashboardFilter === 'all' ? ALL_LAYOUT : DEPT_LAYOUT;

  const layouts: Layouts = useMemo(() => {
    const lg = dashboardFilter === 'all'
      ? (allWidgetLayout ?? ALL_LAYOUT)
      : (widgetLayout ?? DEPT_LAYOUT);
    return { lg };
  }, [widgetLayout, allWidgetLayout, dashboardFilter]);

  const currentLayout = layouts.lg ?? defaultLayout;

  // 현재 숨겨진 위젯 목록 (캘린더 위젯은 항상 추가 가능)
  const hiddenWidgets = useMemo(() => {
    const visibleIds = new Set(currentLayout.map((l) => l.i));
    return ALL_WIDGETS.filter((w) => {
      // 캘린더 위젯은 중복 배치 허용 → 항상 추가 가능
      if (w.id === 'calendar') return true;
      if (visibleIds.has(w.id)) return false;
      if (dashboardFilter === 'all' && w.deptOnly) return false;
      if (dashboardFilter !== 'all' && w.allOnly) return false;
      return true;
    });
  }, [currentLayout, dashboardFilter]);

  const handleLayoutChange = useCallback(
    (_current: Layout[], allLayouts: Layouts) => {
      if (!isEditMode) return;
      const newLayout = allLayouts.lg ?? _current;
      if (dashboardFilter === 'all') {
        setAllWidgetLayout(newLayout);
        saveLayout(newLayout, 'all');
      } else {
        setWidgetLayout(newLayout);
        saveLayout(newLayout);
      }
    },
    [isEditMode, setWidgetLayout, setAllWidgetLayout, dashboardFilter],
  );

  const handleRemoveWidget = useCallback((widgetId: string) => {
    if (dashboardFilter === 'all') {
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
  }, [widgetLayout, allWidgetLayout, setWidgetLayout, setAllWidgetLayout, dashboardFilter]);

  const handleAddWidget = useCallback((widgetId: string) => {
    const isAll = dashboardFilter === 'all';
    const current = isAll ? (allWidgetLayout ?? ALL_LAYOUT) : (widgetLayout ?? DEPT_LAYOUT);
    // 캘린더 위젯은 고유 ID로 중복 배치 허용
    const actualId = widgetId === 'calendar' ? `calendar-${Date.now()}` : widgetId;
    // 맨 아래에 추가
    const maxY = current.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    const newItem: Layout = { i: actualId, x: 0, y: maxY, w: 2, h: 3, minW: 1, minH: 2 };
    const newLayout = [...current, newItem];
    if (isAll) {
      setAllWidgetLayout(newLayout);
      saveLayout(newLayout, 'all');
    } else {
      setWidgetLayout(newLayout);
      saveLayout(newLayout);
    }
    setShowPicker(false);
  }, [widgetLayout, allWidgetLayout, setWidgetLayout, setAllWidgetLayout, dashboardFilter]);

  const handleToggleEdit = useCallback(() => {
    if (isEditMode) {
      setShowPicker(false);
    }
    setEditMode(!isEditMode);
  }, [isEditMode, setEditMode]);

  return (
    <div className="relative flex flex-col gap-4 h-full overflow-hidden">
      {/* 경량 플렉서스 배경 */}
      <DashboardPlexus />

      {/* 부서 탭 + 편집 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
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
              const isActive = dashboardFilter === dept;
              return (
                <button
                  key={dept}
                  onClick={() => handleDeptSelect(dept)}
                  className={cn(
                    'relative z-10 px-5 py-1.5 text-sm rounded-md font-medium cursor-pointer',
                    'transition-colors duration-200 ease-out',
                    isActive
                      ? 'text-white'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {isActive && (
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
          </div>
        </div>

        {/* 편집 모드 토글 */}
        <div className="relative flex items-center gap-2">
          {/* 위젯 추가 (편집 모드에서만) */}
          {isEditMode && hiddenWidgets.length > 0 && (
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
                  />
                )}
              </AnimatePresence>
            </div>
          )}

          <button
            onClick={handleToggleEdit}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer',
              'transition-colors duration-150',
              isEditMode
                ? 'bg-status-high/15 text-status-high hover:bg-status-high/25 border border-status-high/30'
                : 'bg-bg-card text-text-secondary hover:text-text-primary border border-bg-border hover:border-bg-border/80',
            )}
          >
            {isEditMode ? (
              <>
                <Check size={14} />
                완료
              </>
            ) : (
              <>
                <Pencil size={14} />
                레이아웃 편집
              </>
            )}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={dashboardFilter}
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
            cols={{ lg: 4, md: 4, sm: 2, xs: 2, xxs: 1 }}
            rowHeight={80}
            margin={[14, 14]}
            compactType="vertical"
            isDraggable={isEditMode}
            isResizable={isEditMode}
            draggableHandle=".widget-drag-handle"
            onLayoutChange={handleLayoutChange}
            useCSSTransforms
          >
            {currentLayout.map((item, idx) => (
              <div
                key={item.i}
                className="relative"
              >
                {/* 위글 래퍼 — 위글 transform을 자식에 적용하여 RGL의 translate와 충돌 방지 */}
                <div
                  className="h-full"
                  style={isEditMode ? {
                    animation: 'widget-wiggle 0.3s ease-in-out infinite',
                    animationDelay: `${(idx % 5) * 0.06}s`,
                  } : undefined}
                >
                  {/* 편집 모드: 삭제 버튼 */}
                  {isEditMode && (
                    <button
                      onClick={() => handleRemoveWidget(item.i)}
                      className={cn(
                        'absolute -top-1.5 -left-1.5 z-20 w-5 h-5 rounded-full',
                        'bg-red-500 hover:bg-red-400',
                        'flex items-center justify-center',
                        'shadow-md shadow-black/30',
                        'transition-colors duration-100 cursor-pointer',
                      )}
                      title="위젯 제거"
                    >
                      <X size={11} className="text-white" strokeWidth={3} />
                    </button>
                  )}
                  {getWidgetComponent(item.i) ?? (
                    <div className="bg-bg-card rounded-xl p-4 text-text-secondary text-sm h-full">
                      위젯: {item.i}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </ResponsiveGridLayout>
        </motion.div>
      </AnimatePresence>

      {/* 편집 모드 하단 안내 */}
      <AnimatePresence>
        {isEditMode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-center py-2 text-xs text-text-secondary/50"
          >
            위젯을 드래그하여 재배치하세요. 모서리를 드래그하여 크기를 조절하세요.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
