import { useMemo } from 'react';
import { useActivityStore } from '@/stores/useActivityStore';
import { GROUP_LABEL, GROUP_DOT_COLOR, ACTION_TYPE_TO_GROUP } from './constants';
import type { ActionGroup } from '@/types';

const ALL_GROUPS: ActionGroup[] = ['progress', 'memo', 'scene', 'etc'];

export function ActivityFilterChips() {
  const { activities, filters, setFilter, setAllFilters } = useActivityStore();

  const counts = useMemo(() => {
    const map: Record<ActionGroup, number> = { progress: 0, memo: 0, scene: 0, etc: 0 };
    for (const a of activities) {
      const g = ACTION_TYPE_TO_GROUP[a.actionType];
      if (g) map[g] = (map[g] ?? 0) + 1;
    }
    return map;
  }, [activities]);

  const totalShown = useMemo(
    () => activities.filter((a) => filters.groups.has(ACTION_TYPE_TO_GROUP[a.actionType])).length,
    [activities, filters],
  );

  const allOn = filters.groups.size === ALL_GROUPS.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-1 border-t border-bg-border/30">
      <button
        onClick={() => setAllFilters(!allOn)}
        className={`px-2.5 py-1 rounded-full text-[11.5px] cursor-pointer transition-all border ${
          allOn
            ? 'bg-accent/30 border-accent text-accent font-semibold'
            : 'bg-transparent border-bg-border text-text-secondary hover:border-accent/50'
        }`}
      >
        전체 {totalShown}
      </button>
      {ALL_GROUPS.map((g) => {
        const active = filters.groups.has(g);
        return (
          <button
            key={g}
            onClick={() => setFilter(g, !active)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] cursor-pointer transition-all border ${
              active
                ? 'bg-accent/15 border-accent/50 text-text-primary'
                : 'bg-transparent border-bg-border text-text-secondary hover:border-accent/40'
            }`}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: GROUP_DOT_COLOR[g] }}
            />
            {GROUP_LABEL[g]} {counts[g] ?? 0}
          </button>
        );
      })}
    </div>
  );
}
