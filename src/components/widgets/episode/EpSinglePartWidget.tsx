import { useMemo, useContext } from 'react';
import { BarChart3 } from 'lucide-react';
import { Widget, WidgetIdContext } from '../Widget';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { calcEpisodeDetailStats } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { PartDetailStatsEntry, Stage } from '@/types';

/** 위젯 ID에서 dept, partId를 파싱: ep-part-{dept}-{partId}[-{ts}] */
export function parsePartWidgetId(widgetId: string): { dept: 'bg' | 'acting' | 'all'; partId: string } | null {
  const m = widgetId.match(/^ep-part-(bg|acting|all)-([A-Z])(?:-\d+)?$/);
  if (!m) return null;
  return { dept: m[1] as 'bg' | 'acting' | 'all', partId: m[2] };
}

function StageRow({ stages, color }: { stages: { stage: Stage; label: string; color: string; done: number; total: number; pct: number }[]; color: string }) {
  return (
    <div className="space-y-1.5">
      {stages.map((s) => (
        <div key={s.stage} className="flex items-center gap-2">
          <span className="text-xs w-12 text-right" style={{ color: s.color }}>{s.label}</span>
          <div className="flex-1 h-2 bg-bg-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${s.pct}%`, backgroundColor: s.color }}
            />
          </div>
          <span className="text-xs font-bold w-10 text-right" style={{ color }}>
            {s.done}/{s.total}
          </span>
        </div>
      ))}
    </div>
  );
}

function PartContent({ part, dept }: { part: PartDetailStatsEntry; dept: 'bg' | 'acting' | 'all' }) {
  const showBg = dept === 'all' || dept === 'bg';
  const showAct = dept === 'all' || dept === 'acting';
  const pct = dept === 'bg' ? part.bgPct : dept === 'acting' ? part.actPct : part.combinedPct;
  const barColor = pct >= 80 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct >= 25 ? '#E17055' : '#FF6B6B';

  return (
    <div className="flex flex-col gap-3">
      {/* 전체 진행바 */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-3 bg-bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        <span className="text-sm font-bold text-text-primary">{pct.toFixed(1)}%</span>
      </div>

      {/* BG 단계별 */}
      {showBg && part.bgScenes > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] font-semibold" style={{ color: DEPARTMENT_CONFIGS.bg.color }}>
            BG ({part.bgScenes}씬)
          </span>
          <StageRow stages={part.bgStages} color={DEPARTMENT_CONFIGS.bg.color} />
        </div>
      )}

      {/* ACT 단계별 */}
      {showAct && part.actScenes > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] font-semibold" style={{ color: DEPARTMENT_CONFIGS.acting.color }}>
            ACT ({part.actScenes}씬)
          </span>
          <StageRow stages={part.actStages} color={DEPARTMENT_CONFIGS.acting.color} />
        </div>
      )}
    </div>
  );
}

export function EpSinglePartWidget() {
  const widgetId = useContext(WidgetIdContext);
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const parsed = widgetId ? parsePartWidgetId(widgetId) : null;

  const stats = useMemo(
    () => (epNum !== null ? calcEpisodeDetailStats(episodes, epNum) : null),
    [episodes, epNum],
  );

  if (!stats || !parsed || epNum === null) return null;

  const part = stats.perPart.find((p) => p.partId === parsed.partId);
  if (!part) return null;

  const displayName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;
  const deptLabel = parsed.dept === 'bg' ? 'BG' : parsed.dept === 'acting' ? 'ACT' : '전체';

  return (
    <Widget title={`${displayName} ${parsed.partId}파트 ${deptLabel}`} icon={<BarChart3 size={16} />}>
      <PartContent part={part} dept={parsed.dept} />
    </Widget>
  );
}
