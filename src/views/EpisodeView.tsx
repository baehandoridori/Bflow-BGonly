import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, ChevronRight } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { sceneProgress, isFullyDone, isNotStarted } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS, DEPARTMENTS, STAGES } from '@/types';
import type { Episode, Department } from '@/types';
import { cn } from '@/utils/cn';

/* ────────────────────────────────────────────────
   그라데이션 프로그레스 바
   ──────────────────────────────────────────────── */
function progressGradient(pct: number): string {
  if (pct >= 100) return 'linear-gradient(90deg, rgba(0,184,148,1) 0%, rgba(46,213,174,1) 40%, rgba(85,239,196,1) 100%)';
  if (pct >= 75) return 'linear-gradient(90deg, rgba(253,203,110,1) 0%, rgba(129,194,129,1) 50%, rgba(0,184,148,1) 100%)';
  if (pct >= 50) return 'linear-gradient(90deg, rgba(225,112,85,1) 0%, rgba(239,158,98,1) 50%, rgba(253,203,110,1) 100%)';
  if (pct >= 25) return 'linear-gradient(90deg, rgba(255,107,107,1) 0%, rgba(240,110,96,1) 35%, rgba(225,112,85,1) 65%, rgba(253,203,110,1) 100%)';
  return 'linear-gradient(90deg, rgba(255,107,107,1) 0%, rgba(240,110,96,1) 50%, rgba(225,112,85,1) 100%)';
}

/* ────────────────────────────────────────────────
   에피소드 통계 계산
   ──────────────────────────────────────────────── */
interface EpStats {
  totalScenes: number;
  fullyDone: number;
  notStarted: number;
  overallPct: number;
  partStats: {
    partId: string;
    department: Department;
    scenes: number;
    pct: number;
    stageBreakdown: { stage: string; label: string; color: string; count: number }[];
  }[];
  deptBreakdown: { dept: Department; scenes: number; pct: number }[];
}

function calcEpStats(ep: Episode): EpStats {
  const allScenes = ep.parts.flatMap((p) => p.scenes);
  const totalScenes = allScenes.length;
  const fullyDone = allScenes.filter(isFullyDone).length;
  const notStarted = allScenes.filter(isNotStarted).length;
  const overallPct = totalScenes > 0
    ? allScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / totalScenes
    : 0;

  const partStats = ep.parts.map((part) => {
    const pScenes = part.scenes;
    const pct = pScenes.length > 0
      ? pScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / pScenes.length
      : 0;
    const cfg = DEPARTMENT_CONFIGS[part.department];
    const stageBreakdown = STAGES.map((stage) => ({
      stage,
      label: cfg.stageLabels[stage],
      color: cfg.stageColors[stage],
      count: pScenes.filter((s) => s[stage]).length,
    }));
    return { partId: part.partId, department: part.department, scenes: pScenes.length, pct, stageBreakdown };
  });

  const deptMap = new Map<Department, { scenes: number; progressSum: number }>();
  for (const part of ep.parts) {
    const entry = deptMap.get(part.department) || { scenes: 0, progressSum: 0 };
    entry.scenes += part.scenes.length;
    entry.progressSum += part.scenes.reduce((sum, s) => sum + sceneProgress(s), 0);
    deptMap.set(part.department, entry);
  }
  const deptBreakdown = Array.from(deptMap.entries()).map(([dept, data]) => ({
    dept,
    scenes: data.scenes,
    pct: data.scenes > 0 ? data.progressSum / data.scenes : 0,
  }));

  return { totalScenes, fullyDone, notStarted, overallPct, partStats, deptBreakdown };
}

/* ────────────────────────────────────────────────
   에피소드 카드 컴포넌트
   ──────────────────────────────────────────────── */
function EpisodeCard({
  episode,
  stats,
  onNavigate,
}: {
  episode: Episode;
  stats: EpStats;
  onNavigate: (ep: Episode) => void;
}) {
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const displayName = episodeTitles[episode.episodeNumber] || episode.title;
  const pct = Math.round(stats.overallPct);
  const isComplete = pct >= 100;

  return (
    <motion.button
      onClick={() => onNavigate(episode)}
      className={cn(
        'relative w-full text-left rounded-xl p-5 cursor-pointer',
        'border border-bg-border/60 bg-bg-card',
        'transition-shadow transition-border duration-200 ease-out',
        'hover:shadow-md hover:shadow-black/20 hover:border-bg-border',
        isComplete && 'border-status-high/30',
      )}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      {/* 상단: 에피소드 제목 + 진행률 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold',
              isComplete ? 'bg-status-high/15 text-status-high' : 'bg-accent/15 text-accent',
            )}
          >
            {episode.episodeNumber}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{displayName}</h3>
            <p className="text-xs text-text-secondary/60">
              {stats.totalScenes}개 씬 · {stats.fullyDone} 완료
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-lg font-bold tabular-nums',
            isComplete ? 'text-status-high' : pct >= 50 ? 'text-text-primary' : 'text-text-secondary',
          )}>
            {pct}%
          </span>
          <ChevronRight size={16} className="text-text-secondary/45" />
        </div>
      </div>

      {/* 전체 프로그레스 바 */}
      <div className="h-2 rounded-full bg-bg-border/40 overflow-hidden mb-4">
        <motion.div
          className="h-full rounded-full"
          style={{ background: progressGradient(pct) }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(pct, 100)}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>

      {/* 부서별 진행률 */}
      {stats.deptBreakdown.length > 0 && (
        <div className="flex gap-3 mb-3">
          {stats.deptBreakdown.map(({ dept, scenes, pct: dPct }) => {
            const cfg = DEPARTMENT_CONFIGS[dept];
            return (
              <div key={dept} className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium" style={{ color: cfg.color }}>
                    {cfg.shortLabel}
                  </span>
                  <span className="text-[11px] text-text-secondary/50 tabular-nums">
                    {Math.round(dPct)}%
                  </span>
                </div>
                <div className="h-1 rounded-full bg-bg-border/30 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.min(dPct, 100)}%`, backgroundColor: cfg.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 파트별 미니 매트릭스 */}
      <div className="flex flex-wrap gap-1.5">
        {stats.partStats.map((ps) => {
          const partPct = Math.round(ps.pct);
          const deptCfg = DEPARTMENT_CONFIGS[ps.department];
          return (
            <div
              key={`${ps.partId}-${ps.department}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-primary/50 text-[11px]"
            >
              <span className="font-medium text-text-primary/70">
                {ps.partId}
              </span>
              <span className="text-[10px] font-medium" style={{ color: deptCfg.color }}>
                {deptCfg.shortLabel}
              </span>
              <span className="text-text-secondary/40 tabular-nums">{partPct}%</span>
            </div>
          );
        })}
      </div>
    </motion.button>
  );
}

/* ────────────────────────────────────────────────
   파트별 매트릭스 뷰
   ──────────────────────────────────────────────── */
function PartMatrix({ episodes }: { episodes: { ep: Episode; stats: EpStats }[] }) {
  const episodeTitlesMap = useDataStore((s) => s.episodeTitles);
  // 모든 파트 ID 수집
  const allParts = useMemo(() => {
    const set = new Set<string>();
    for (const { ep } of episodes) {
      for (const part of ep.parts) {
        set.add(`${part.partId}_${part.department}`);
      }
    }
    return Array.from(set).sort();
  }, [episodes]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-bg-border/30">
            <th className="text-left py-2 px-3 text-xs font-medium text-text-secondary/50">에피소드</th>
            {allParts.map((key) => {
              const [partId, dept] = key.split('_');
              const cfg = DEPARTMENT_CONFIGS[dept as Department];
              return (
                <th key={key} className="py-2 px-2 text-center">
                  <span className="text-xs font-medium text-text-secondary/60">{partId}</span>
                  <span className="text-[10px] ml-0.5" style={{ color: cfg?.color }}>{cfg?.shortLabel}</span>
                </th>
              );
            })}
            <th className="text-right py-2 px-3 text-xs font-medium text-text-secondary/50">전체</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map(({ ep, stats }) => (
            <tr key={ep.episodeNumber} className="border-b border-bg-border/15 hover:bg-bg-border/10 transition-colors duration-100">
              <td className="py-2.5 px-3 font-medium text-text-primary/80">{episodeTitlesMap[ep.episodeNumber] || ep.title}</td>
              {allParts.map((key) => {
                const [partId, dept] = key.split('_');
                const ps = stats.partStats.find((p) => p.partId === partId && p.department === (dept as Department));
                const pct = ps ? Math.round(ps.pct) : -1;
                return (
                  <td key={key} className="py-2.5 px-2 text-center">
                    {pct >= 0 ? (
                      <span className={cn(
                        'inline-block w-10 py-0.5 rounded text-[11px] font-medium tabular-nums',
                        pct >= 100 ? 'bg-status-high/15 text-status-high'
                          : pct >= 50 ? 'bg-amber-500/10 text-amber-400'
                          : pct > 0 ? 'bg-red-500/10 text-red-400'
                          : 'bg-bg-border/20 text-text-secondary/45',
                      )}>
                        {pct}%
                      </span>
                    ) : (
                      <span className="text-text-secondary/15">—</span>
                    )}
                  </td>
                );
              })}
              <td className="py-2.5 px-3 text-right">
                <span className={cn(
                  'font-semibold tabular-nums text-sm',
                  stats.overallPct >= 100 ? 'text-status-high'
                    : stats.overallPct >= 50 ? 'text-text-primary'
                    : 'text-text-secondary',
                )}>
                  {Math.round(stats.overallPct)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────────────────────────
   에피소드 뷰 메인
   ──────────────────────────────────────────────── */
type EpViewMode = 'card' | 'matrix';

export function EpisodeView() {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitlesMap = useDataStore((s) => s.episodeTitles);
  const { setView, setSelectedEpisode, setSelectedPart, setSelectedDepartment } = useAppStore();
  const [viewMode, setViewMode] = useState<EpViewMode>('card');

  const epData = useMemo(() => {
    return episodes
      .map((ep) => ({ ep, stats: calcEpStats(ep) }))
      .sort((a, b) => a.ep.episodeNumber - b.ep.episodeNumber);
  }, [episodes]);

  // 전체 요약 통계
  const summary = useMemo(() => {
    const totalScenes = epData.reduce((sum, d) => sum + d.stats.totalScenes, 0);
    const totalDone = epData.reduce((sum, d) => sum + d.stats.fullyDone, 0);
    const progressSum = epData.reduce((sum, d) => sum + d.stats.overallPct * d.stats.totalScenes, 0);
    const avgPct = totalScenes > 0 ? progressSum / totalScenes : 0;
    return { totalScenes, totalDone, avgPct, epCount: epData.length };
  }, [epData]);

  const handleNavigate = useCallback((ep: Episode) => {
    setSelectedEpisode(ep.episodeNumber);
    setView('scenes');
  }, [setSelectedEpisode, setView]);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-text-primary">에피소드 현황</h1>
          <div className="flex items-center gap-2 text-xs text-text-secondary/50">
            <span>{summary.epCount}개 에피소드</span>
            <span className="text-bg-border/50">·</span>
            <span>{summary.totalScenes}개 씬</span>
            <span className="text-bg-border/50">·</span>
            <span className="font-medium tabular-nums" style={{ color: summary.avgPct >= 100 ? '#00B894' : undefined }}>
              평균 {Math.round(summary.avgPct)}%
            </span>
          </div>
        </div>

        {/* 뷰 모드 토글 */}
        <div className="flex bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
          <button
            onClick={() => setViewMode('card')}
            className={cn(
              'px-3 py-1 text-xs rounded-md font-medium cursor-pointer',
              'transition-colors duration-150',
              viewMode === 'card'
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            카드
          </button>
          <button
            onClick={() => setViewMode('matrix')}
            className={cn(
              'px-3 py-1 text-xs rounded-md font-medium cursor-pointer',
              'transition-colors duration-150',
              viewMode === 'matrix'
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            매트릭스
          </button>
        </div>
      </div>

      {/* 콘텐츠 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={viewMode}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex-1 overflow-auto"
        >
          {epData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-text-secondary/40">
              <Film size={40} className="mb-3 opacity-30" />
              <p className="text-sm">에피소드가 없습니다</p>
              <p className="text-xs mt-1">씬 목록 뷰에서 에피소드를 추가하세요</p>
            </div>
          ) : viewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {epData.map(({ ep, stats }, i) => (
                <motion.div
                  key={ep.episodeNumber}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                >
                  <EpisodeCard episode={ep} stats={stats} onNavigate={handleNavigate} />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="bg-bg-card rounded-xl border border-bg-border/50 p-4">
              <PartMatrix episodes={epData} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
