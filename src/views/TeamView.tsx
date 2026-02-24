import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CircleUser, ChevronDown, ChevronUp, Crown, Briefcase } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { sceneProgress, isFullyDone, isNotStarted } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS, STAGES } from '@/types';
import type { Scene, Department, Stage, AppUser } from '@/types';
import { cn } from '@/utils/cn';
import { getUserColor } from '@/components/common/AssigneeSelect';

/* ────────────────────────────────────────────────
   팀원별 작업 통계
   ──────────────────────────────────────────────── */

interface SceneRef {
  scene: Scene;
  episodeNumber: number;
  episodeTitle: string;
  partId: string;
  department: Department;
  sheetName: string;
}

interface TeamMemberData {
  user: AppUser;
  scenes: SceneRef[];
  totalScenes: number;
  fullyDone: number;
  notStarted: number;
  avgPct: number;
  stageStats: { stage: Stage; label: string; color: string; count: number; total: number }[];
  deptBreakdown: { dept: Department; count: number }[];
}

function buildTeamData(
  users: AppUser[],
  episodes: ReturnType<typeof useDataStore.getState>['episodes'],
  episodeTitles: Record<number, string>,
): TeamMemberData[] {
  // 씬 → 담당자 맵핑
  const sceneMap = new Map<string, SceneRef[]>();
  for (const ep of episodes) {
    for (const part of ep.parts) {
      for (const scene of part.scenes) {
        const name = scene.assignee || '';
        if (!name) continue;
        const refs = sceneMap.get(name) || [];
        refs.push({
          scene,
          episodeNumber: ep.episodeNumber,
          episodeTitle: episodeTitles[ep.episodeNumber] || ep.title,
          partId: part.partId,
          department: part.department,
          sheetName: part.sheetName,
        });
        sceneMap.set(name, refs);
      }
    }
  }

  return users.map((user) => {
    const scenes = sceneMap.get(user.name) || [];
    const totalScenes = scenes.length;
    const fullyDone = scenes.filter((r) => isFullyDone(r.scene)).length;
    const notStarted = scenes.filter((r) => isNotStarted(r.scene)).length;
    const avgPct = totalScenes > 0
      ? scenes.reduce((sum, r) => sum + sceneProgress(r.scene), 0) / totalScenes
      : 0;

    const stageStats = STAGES.map((stage) => ({
      stage,
      label: DEPARTMENT_CONFIGS.bg.stageLabels[stage],
      color: DEPARTMENT_CONFIGS.bg.stageColors[stage],
      count: scenes.filter((r) => r.scene[stage]).length,
      total: totalScenes,
    }));

    const deptMap = new Map<Department, number>();
    for (const r of scenes) {
      deptMap.set(r.department, (deptMap.get(r.department) || 0) + 1);
    }
    const deptBreakdown = Array.from(deptMap.entries()).map(([dept, count]) => ({ dept, count }));

    return { user, scenes, totalScenes, fullyDone, notStarted, avgPct, stageStats, deptBreakdown };
  });
}

/* ────────────────────────────────────────────────
   프로그레스 링 (원형)
   ──────────────────────────────────────────────── */

function ProgressRing({ pct, size = 56, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const color = pct >= 100 ? '#00B894' : pct >= 75 ? '#FDCB6E' : pct >= 50 ? '#E17055' : '#FF6B6B';

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(45,48,65,0.4)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-text-primary text-[11px] font-bold tabular-nums"
        transform={`rotate(90, ${size / 2}, ${size / 2})`}
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

/* ────────────────────────────────────────────────
   팀원 카드
   ──────────────────────────────────────────────── */

function TeamMemberCard({
  data,
  highlighted,
  cardRef,
  onClickScene,
}: {
  data: TeamMemberData;
  highlighted: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
  onClickScene: (ref: SceneRef) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = getUserColor(data.user.name);

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-xl border overflow-hidden transition-all duration-300 ease-out',
        highlighted
          ? 'border-accent shadow-lg shadow-accent/20 ring-2 ring-accent/30'
          : 'border-bg-border/50 bg-bg-card hover:shadow-md hover:shadow-black/15 hover:border-bg-border/80',
      )}
      style={highlighted ? {
        background: 'linear-gradient(135deg, rgb(var(--color-accent) / 0.08), rgb(var(--color-bg-card)))',
        animation: 'teamGlow 2s ease-in-out',
      } : { background: 'rgb(var(--color-bg-card))' }}
    >
      {/* 헤더 */}
      <div className="flex items-center gap-4 p-4">
        {data.totalScenes > 0 ? (
          <ProgressRing pct={data.avgPct} />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${color}20` }}
          >
            <span className="text-lg font-bold" style={{ color }}>
              {data.user.name.charAt(0)}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-text-primary truncate">{data.user.name}</h3>
            {data.user.role === 'admin' && (
              <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                <Crown size={10} /> 관리자
              </span>
            )}
            {data.deptBreakdown.map(({ dept, count }) => (
              <span
                key={dept}
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{
                  color: DEPARTMENT_CONFIGS[dept].color,
                  backgroundColor: `${DEPARTMENT_CONFIGS[dept].color}15`,
                }}
              >
                {DEPARTMENT_CONFIGS[dept].shortLabel} {count}
              </span>
            ))}
          </div>

          {/* 메타 정보 */}
          <div className="flex items-center gap-2 text-[10px] text-text-secondary/40 mb-2">
            {data.totalScenes > 0 ? (
              <>
                <span>{data.totalScenes}개 씬</span>
                <span>·</span>
                <span>{data.fullyDone} 완료</span>
                <span>·</span>
                <span>{data.notStarted} 미착수</span>
              </>
            ) : (
              <span className="flex items-center gap-1">
                <Briefcase size={10} />
                배정된 씬 없음
              </span>
            )}
          </div>

          {/* 단계별 바 (씬이 있는 경우만) */}
          {data.totalScenes > 0 && (
            <div className="flex gap-1">
              {data.stageStats.map((ss) => {
                const sPct = ss.total > 0 ? (ss.count / ss.total) * 100 : 0;
                return (
                  <div key={ss.stage} className="flex-1" title={`${ss.label}: ${ss.count}/${ss.total}`}>
                    <div className="h-1.5 rounded-full bg-bg-border/30 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-700 ease-out"
                        style={{ width: `${sPct}%`, backgroundColor: ss.color }}
                      />
                    </div>
                    <div className="text-[10px] text-text-secondary/50 mt-0.5 text-center">{ss.label}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 씬 목록 토글 (씬이 있는 경우만) */}
      {data.totalScenes > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className={cn(
              'w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-text-secondary/50 cursor-pointer',
              'border-t border-bg-border/20 hover:text-text-secondary/60 hover:bg-bg-border/10',
              'transition-colors duration-100',
            )}
          >
            <span>{expanded ? '씬 목록 닫기' : `씬 목록 (${data.totalScenes})`}</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div
                  className="max-h-48 overflow-y-auto border-t border-bg-border/15"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(139,141,163,0.2) transparent' }}
                >
                  {data.scenes
                    .sort((a, b) => sceneProgress(a.scene) - sceneProgress(b.scene))
                    .map((ref) => {
                      const sp = Math.round(sceneProgress(ref.scene));
                      return (
                        <button
                          key={`${ref.sheetName}-${ref.scene.sceneId}`}
                          onClick={() => onClickScene(ref)}
                          className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-bg-border/10 cursor-pointer transition-colors duration-75"
                        >
                          <span className="text-xs font-mono text-text-primary/70 w-12">{ref.scene.sceneId}</span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                            style={{
                              color: DEPARTMENT_CONFIGS[ref.department].color,
                              backgroundColor: `${DEPARTMENT_CONFIGS[ref.department].color}15`,
                            }}
                          >
                            {DEPARTMENT_CONFIGS[ref.department].shortLabel}
                          </span>
                          <span className="text-[11px] text-text-secondary/50 flex-1 truncate">
                            {ref.episodeTitle} {ref.partId}파트
                          </span>
                          <div className="w-16 h-1 rounded-full bg-bg-border/30 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${sp}%`,
                                backgroundColor: sp >= 100 ? '#00B894' : sp >= 50 ? '#FDCB6E' : '#FF6B6B',
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-text-secondary/50 tabular-nums w-7 text-right">{sp}%</span>
                        </button>
                      );
                    })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   정렬 옵션
   ──────────────────────────────────────────────── */

type SortOption = 'name' | 'scenes' | 'progress';

/* ────────────────────────────────────────────────
   메인 뷰
   ──────────────────────────────────────────────── */

export function TeamView() {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const users = useAuthStore((s) => s.users);
  const {
    setView, setSelectedEpisode, setSelectedPart, setSelectedDepartment, setHighlightSceneId,
    highlightUserName, setHighlightUserName,
  } = useAppStore();

  const [sortBy, setSortBy] = useState<SortOption>('scenes');
  const [sortAsc, setSortAsc] = useState(false);

  // 하이라이트 대상 ref
  const highlightRef = useRef<HTMLDivElement>(null);

  // 하이라이트 자동 해제 + 스크롤
  useEffect(() => {
    if (!highlightUserName) return;
    // 스크롤
    setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    // 3초 후 해제
    const timer = setTimeout(() => setHighlightUserName(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightUserName, setHighlightUserName]);

  const teamData = useMemo(() => {
    const data = buildTeamData(users, episodes, episodeTitles);
    const sorted = [...data].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name': cmp = a.user.name.localeCompare(b.user.name, 'ko'); break;
        case 'scenes': cmp = a.totalScenes - b.totalScenes; break;
        case 'progress': cmp = a.avgPct - b.avgPct; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [users, episodes, episodeTitles, sortBy, sortAsc]);

  const summary = useMemo(() => {
    const totalMembers = users.length;
    const activeMembers = teamData.filter((d) => d.totalScenes > 0).length;
    const totalScenes = teamData.reduce((sum, d) => sum + d.totalScenes, 0);
    const progressSum = teamData.reduce((sum, d) => sum + d.avgPct * d.totalScenes, 0);
    const avgPct = totalScenes > 0 ? progressSum / totalScenes : 0;
    return { totalMembers, activeMembers, totalScenes, avgPct };
  }, [users, teamData]);

  const handleClickScene = useCallback((ref: SceneRef) => {
    setSelectedEpisode(ref.episodeNumber);
    setSelectedPart(ref.partId);
    setSelectedDepartment(ref.department);
    setHighlightSceneId(ref.scene.sceneId);
    setView('scenes');
  }, [setView, setSelectedEpisode, setSelectedPart, setSelectedDepartment, setHighlightSceneId]);

  const handleSort = useCallback((option: SortOption) => {
    if (sortBy === option) {
      setSortAsc((prev) => !prev);
    } else {
      setSortBy(option);
      setSortAsc(false);
    }
  }, [sortBy]);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-text-primary">팀원 현황</h1>
          <div className="flex items-center gap-2 text-xs text-text-secondary/50">
            <span>{summary.totalMembers}명</span>
            <span className="text-bg-border/50">·</span>
            <span>활동 {summary.activeMembers}명</span>
            <span className="text-bg-border/50">·</span>
            <span>{summary.totalScenes}개 씬</span>
            <span className="text-bg-border/50">·</span>
            <span className="tabular-nums">평균 {Math.round(summary.avgPct)}%</span>
          </div>
        </div>

        {/* 정렬 */}
        <div className="flex items-center gap-1">
          {([
            { key: 'name' as SortOption, label: '이름' },
            { key: 'scenes' as SortOption, label: '씬 수' },
            { key: 'progress' as SortOption, label: '진행률' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleSort(key)}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-md font-medium cursor-pointer',
                'transition-colors duration-150',
                sortBy === key
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary/50 hover:text-text-secondary',
              )}
            >
              {label}
              {sortBy === key && (
                <span className="ml-0.5 text-[10px]">{sortAsc ? '↑' : '↓'}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 카드 그리드 */}
      <div className="flex-1 overflow-auto">
        {teamData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-secondary/50">
            <CircleUser size={40} className="mb-3 opacity-30" />
            <p className="text-sm">등록된 팀원이 없습니다</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {teamData.map((data, i) => {
              const isHighlighted = highlightUserName === data.user.name;
              return (
                <motion.div
                  key={data.user.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                  <TeamMemberCard
                    data={data}
                    highlighted={isHighlighted}
                    cardRef={isHighlighted ? highlightRef : undefined}
                    onClickScene={handleClickScene}
                  />
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* 글로우 애니메이션 CSS */}
      <style>{`
        @keyframes teamGlow {
          0% { box-shadow: 0 0 0 0 rgb(var(--color-accent) / 0.4); }
          50% { box-shadow: 0 0 20px 4px rgb(var(--color-accent) / 0.25); }
          100% { box-shadow: 0 0 0 0 rgb(var(--color-accent) / 0); }
        }
      `}</style>
    </div>
  );
}
