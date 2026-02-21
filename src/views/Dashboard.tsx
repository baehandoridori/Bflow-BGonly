import { useMemo, useCallback } from 'react';
import { Responsive, WidthProvider, type Layouts, type Layout } from 'react-grid-layout';
import { useAppStore } from '@/stores/useAppStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { DepartmentComparisonWidget } from '@/components/widgets/DepartmentComparisonWidget';
import { saveLayout } from '@/services/settingsService';
import { DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';
import { cn } from '@/utils/cn';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

/* ── 부서별 레이아웃: 기존 4위젯 ── */
const DEPT_LAYOUT: Layout[] = [
  { i: 'overall-progress', x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'stage-bars', x: 1, y: 0, w: 2, h: 3, minW: 2, minH: 2 },
  { i: 'assignee-cards', x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'episode-summary', x: 0, y: 3, w: 4, h: 4, minW: 2, minH: 3 },
];

/* ── 통합 레이아웃: 부서 비교 + 통합 위젯 ── */
const ALL_LAYOUT: Layout[] = [
  { i: 'overall-progress', x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'dept-comparison', x: 1, y: 0, w: 2, h: 3, minW: 2, minH: 2 },
  { i: 'assignee-cards', x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'episode-summary', x: 0, y: 3, w: 4, h: 4, minW: 2, minH: 3 },
];

/* ── 위젯 컴포넌트 매핑 ── */
const WIDGET_MAP: Record<string, React.ReactNode> = {
  'overall-progress': <OverallProgressWidget />,
  'stage-bars': <StageBarsWidget />,
  'assignee-cards': <AssigneeCardsWidget />,
  'episode-summary': <EpisodeSummaryWidget />,
  'dept-comparison': <DepartmentComparisonWidget />,
};

export function Dashboard() {
  const { widgetLayout, isEditMode, setWidgetLayout, setSelectedDepartment } = useAppStore();
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const setDashboardFilter = useAppStore((s) => s.setDashboardDeptFilter);

  const handleDeptSelect = useCallback((filter: typeof dashboardFilter) => {
    setDashboardFilter(filter);
    if (filter !== 'all') {
      setSelectedDepartment(filter);
    }
  }, [setDashboardFilter, setSelectedDepartment]);

  const defaultLayout = dashboardFilter === 'all' ? ALL_LAYOUT : DEPT_LAYOUT;

  const layouts: Layouts = useMemo(() => {
    const lg = dashboardFilter === 'all' ? ALL_LAYOUT : (widgetLayout ?? DEPT_LAYOUT);
    return { lg };
  }, [widgetLayout, dashboardFilter]);

  const handleLayoutChange = useCallback(
    (_current: Layout[], allLayouts: Layouts) => {
      if (!isEditMode) return;
      if (dashboardFilter === 'all') return;
      const newLayout = allLayouts.lg ?? _current;
      setWidgetLayout(newLayout);
      saveLayout(newLayout);
    },
    [isEditMode, setWidgetLayout, dashboardFilter]
  );

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* 부서 탭 (통합 포함) */}
      <div className="flex items-center gap-3">
        <div className="flex bg-bg-card rounded-lg p-0.5 border border-bg-border">
          {/* 통합 탭 */}
          <button
            onClick={() => handleDeptSelect('all')}
            className={cn(
              'px-4 py-1.5 text-sm rounded-md transition-all duration-200 font-medium',
              dashboardFilter === 'all'
                ? 'bg-accent text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            통합
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
                  'px-4 py-1.5 text-sm rounded-md transition-all duration-200 font-medium',
                  isActive
                    ? 'text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
                style={isActive ? { backgroundColor: cfg.color } : undefined}
              >
                {cfg.label} ({cfg.shortLabel})
              </button>
            );
          })}
        </div>
      </div>

      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 4, md: 4, sm: 2, xs: 2, xxs: 1 }}
        rowHeight={80}
        margin={[12, 12]}
        isDraggable={isEditMode}
        isResizable={isEditMode}
        draggableHandle=".widget-drag-handle"
        onLayoutChange={handleLayoutChange}
        useCSSTransforms
      >
        {(layouts.lg ?? defaultLayout).map((item) => (
          <div key={item.i}>
            {WIDGET_MAP[item.i] ?? (
              <div className="bg-bg-card rounded-xl p-4 text-text-secondary text-sm">
                위젯: {item.i}
              </div>
            )}
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
