import { useMemo, useState } from 'react';
import { LayoutList, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Widget } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { PartDetailStatsEntry } from '@/types';

function PartAccordionItem({ part }: { part: PartDetailStatsEntry }) {
  const [open, setOpen] = useState(false);
  const dashboardFilter = useAppStore((s) => s.dashboardDeptFilter);
  const isAll = dashboardFilter === 'all';

  const pct = isAll ? part.combinedPct : dashboardFilter === 'bg' ? part.bgPct : part.actPct;
  const barColor = pct >= 80 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct >= 25 ? '#E17055' : '#FF6B6B';

  return (
    <div className="bg-bg-primary rounded-lg border border-transparent hover:border-bg-border/50 transition-all duration-200 ease-out">
      {/* 파트 헤더 */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer"
      >
        <span className="text-sm font-medium w-8">{part.partId}파트</span>
        <div className="flex-1 h-3 bg-bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        <span className="text-xs font-bold text-text-primary w-12 text-right">
          {pct.toFixed(1)}%
        </span>
        {open ? (
          <ChevronDown size={14} className="text-text-secondary" />
        ) : (
          <ChevronRight size={14} className="text-text-secondary" />
        )}
      </button>

      {/* 아코디언 상세 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">
              {/* BG 섹션 */}
              {(isAll || dashboardFilter === 'bg') && part.bgScenes > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold" style={{ color: DEPARTMENT_CONFIGS.bg.color }}>
                      BG ({part.bgScenes}씬)
                    </span>
                    <div className="flex-1 h-1.5 bg-bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${part.bgPct}%`, backgroundColor: DEPARTMENT_CONFIGS.bg.color }}
                      />
                    </div>
                    <span className="text-[11px] font-bold" style={{ color: DEPARTMENT_CONFIGS.bg.color }}>
                      {part.bgPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex gap-2 pl-2">
                    {part.bgStages.map((s) => (
                      <span key={s.stage} className="text-[10px] text-text-secondary">
                        <span style={{ color: s.color }}>{s.label}</span>:{s.pct.toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ACT 섹션 */}
              {(isAll || dashboardFilter === 'acting') && part.actScenes > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold" style={{ color: DEPARTMENT_CONFIGS.acting.color }}>
                      ACT ({part.actScenes}씬)
                    </span>
                    <div className="flex-1 h-1.5 bg-bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${part.actPct}%`, backgroundColor: DEPARTMENT_CONFIGS.acting.color }}
                      />
                    </div>
                    <span className="text-[11px] font-bold" style={{ color: DEPARTMENT_CONFIGS.acting.color }}>
                      {part.actPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex gap-2 pl-2">
                    {part.actStages.map((s) => (
                      <span key={s.stage} className="text-[10px] text-text-secondary">
                        <span style={{ color: s.color }}>{s.label}</span>:{s.pct.toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function EpPartProgressWidget() {
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || epNum === null) return null;

  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;

  return (
    <Widget title={`${displayName} 파트별 진행률`} icon={<LayoutList size={16} />}>
      <div className="flex flex-col gap-2">
        {stats.perPart.map((part) => (
          <PartAccordionItem key={part.partId} part={part} />
        ))}
      </div>
    </Widget>
  );
}
