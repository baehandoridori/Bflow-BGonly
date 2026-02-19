import { useMemo, useCallback } from 'react';
import { Responsive, WidthProvider, type Layouts, type Layout } from 'react-grid-layout';
import { useAppStore } from '@/stores/useAppStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { saveLayout } from '@/services/settingsService';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

const DEFAULT_LAYOUT: Layout[] = [
  { i: 'overall-progress', x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'stage-bars', x: 1, y: 0, w: 2, h: 3, minW: 2, minH: 2 },
  { i: 'assignee-cards', x: 3, y: 0, w: 1, h: 3, minW: 1, minH: 2 },
  { i: 'episode-summary', x: 0, y: 3, w: 4, h: 4, minW: 2, minH: 3 },
];

const WIDGET_MAP: Record<string, React.ReactNode> = {
  'overall-progress': <OverallProgressWidget />,
  'stage-bars': <StageBarsWidget />,
  'assignee-cards': <AssigneeCardsWidget />,
  'episode-summary': <EpisodeSummaryWidget />,
};

export function Dashboard() {
  const { widgetLayout, isEditMode, setWidgetLayout } = useAppStore();

  const layouts: Layouts = useMemo(() => {
    const lg = widgetLayout ?? DEFAULT_LAYOUT;
    return { lg };
  }, [widgetLayout]);

  const handleLayoutChange = useCallback(
    (_current: Layout[], allLayouts: Layouts) => {
      if (!isEditMode) return;
      const newLayout = allLayouts.lg ?? _current;
      setWidgetLayout(newLayout);
      // AppData에 저장 (비동기, 에러 무시)
      saveLayout(newLayout);
    },
    [isEditMode, setWidgetLayout]
  );

  return (
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
      {(layouts.lg ?? DEFAULT_LAYOUT).map((item) => (
        <div key={item.i}>
          {WIDGET_MAP[item.i] ?? (
            <div className="bg-bg-card rounded-xl p-4 text-text-secondary text-sm">
              위젯: {item.i}
            </div>
          )}
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
