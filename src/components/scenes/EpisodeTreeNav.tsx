import { useState, useMemo, useCallback } from 'react';
import { ChevronRight, ChevronDown, Plus, FolderOpen, Folder, StickyNote, MoreVertical } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { Episode, Department } from '@/types';
import { DEPARTMENT_CONFIGS } from '@/types';
import { sceneProgress } from '@/utils/calcStats';

interface EpisodeTreeNavProps {
  episodes: Episode[];
  selectedDepartment: Department;
  selectedEpisode: number | null;
  selectedPart: string | null;
  partMemos: Record<string, string>;
  onSelectEpisodePart: (epNum: number, partId: string | null) => void;
  onAddEpisode: () => void;
  onAddPart: () => void;
  onPartContextMenu: (e: React.MouseEvent, sheetName: string) => void;
  onEpisodeEdit: (epNum: number) => void;
}

/** 씬 배열 → 전체 진행률(%) */
function calcPartProgress(scenes: { lo: boolean; done: boolean; review: boolean; png: boolean }[]): number {
  if (scenes.length === 0) return 0;
  const total = scenes.length * 4;
  const done = scenes.reduce(
    (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length, 0,
  );
  return Math.round((done / total) * 100);
}

export function EpisodeTreeNav({
  episodes,
  selectedDepartment,
  selectedEpisode,
  selectedPart,
  partMemos,
  onSelectEpisodePart,
  onAddEpisode,
  onAddPart,
  onPartContextMenu,
  onEpisodeEdit,
}: EpisodeTreeNavProps) {
  // 에피소드별 열림/닫힘 상태 (기본: 선택된 에피소드만 열림)
  const [expandedEps, setExpandedEps] = useState<Set<number>>(() => {
    const set = new Set<number>();
    if (selectedEpisode != null) set.add(selectedEpisode);
    return set;
  });

  const toggleExpand = useCallback((epNum: number) => {
    setExpandedEps((prev) => {
      const next = new Set(prev);
      if (next.has(epNum)) next.delete(epNum);
      else next.add(epNum);
      return next;
    });
  }, []);

  // 에피소드 선택 시 자동 확장
  const handleSelectEpisode = useCallback((epNum: number) => {
    setExpandedEps((prev) => {
      const next = new Set(prev);
      next.add(epNum);
      return next;
    });
    onSelectEpisodePart(epNum, null);
  }, [onSelectEpisodePart]);

  const deptColor = DEPARTMENT_CONFIGS[selectedDepartment].color;

  // 에피소드별 부서 필터링된 파트
  const epPartsMap = useMemo(() => {
    const map = new Map<number, Episode['parts']>();
    for (const ep of episodes) {
      map.set(ep.episodeNumber, ep.parts.filter((p) => p.department === selectedDepartment));
    }
    return map;
  }, [episodes, selectedDepartment]);

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bg-border shrink-0">
        <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">에피소드</span>
        <button
          onClick={onAddEpisode}
          className="p-1 text-text-secondary/50 hover:text-accent rounded transition-colors"
          title="에피소드 추가"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 트리 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {episodes.length === 0 ? (
          <div className="text-xs text-text-secondary/50 text-center py-6">
            에피소드가 없습니다
          </div>
        ) : (
          episodes.map((ep) => {
            const isExpanded = expandedEps.has(ep.episodeNumber);
            const isEpSelected = ep.episodeNumber === selectedEpisode;
            const deptParts = epPartsMap.get(ep.episodeNumber) ?? [];
            const totalScenes = deptParts.reduce((s, p) => s + p.scenes.length, 0);
            const epProgress = calcPartProgress(deptParts.flatMap((p) => p.scenes));

            return (
              <div key={ep.episodeNumber}>
                {/* 에피소드 노드 */}
                <div
                  className={cn(
                    'group flex items-center gap-1 px-2 py-1.5 mx-1 rounded-lg cursor-pointer transition-colors',
                    isEpSelected
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-secondary hover:bg-bg-primary hover:text-text-primary',
                  )}
                  onClick={() => handleSelectEpisode(ep.episodeNumber)}
                >
                  {/* 확장 아이콘 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(ep.episodeNumber); }}
                    className="p-0.5 shrink-0"
                  >
                    {isExpanded
                      ? <ChevronDown size={12} className="text-text-secondary/50" />
                      : <ChevronRight size={12} className="text-text-secondary/50" />
                    }
                  </button>

                  {/* 폴더 아이콘 */}
                  {isExpanded
                    ? <FolderOpen size={13} className="shrink-0" style={{ color: deptColor }} />
                    : <Folder size={13} className="shrink-0" style={{ color: deptColor }} />
                  }

                  {/* 에피소드 이름 */}
                  <span className="text-xs font-semibold truncate flex-1">{ep.title}</span>

                  {/* 씬 수 */}
                  <span className="text-[10px] text-text-secondary/40 tabular-nums shrink-0">
                    {totalScenes}
                  </span>

                  {/* 미니 진행률 바 */}
                  {totalScenes > 0 && (
                    <div className="w-8 h-1.5 bg-bg-primary rounded-full overflow-hidden shrink-0">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${epProgress}%`,
                          backgroundColor: epProgress >= 100 ? '#22c55e' : deptColor,
                        }}
                      />
                    </div>
                  )}

                  {/* 에피소드 관리 버튼 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onEpisodeEdit(ep.episodeNumber); }}
                    className="p-0.5 opacity-0 group-hover:opacity-100 text-text-secondary/40 hover:text-text-primary transition-opacity shrink-0"
                    title="에피소드 관리"
                  >
                    <MoreVertical size={11} />
                  </button>
                </div>

                {/* 파트 목록 (확장 시) */}
                {isExpanded && (
                  <div className="ml-3 pl-2 border-l border-bg-border/50">
                    {deptParts.length === 0 ? (
                      <div className="text-[10px] text-text-secondary/30 py-1 px-3">
                        파트 없음
                      </div>
                    ) : (
                      deptParts.map((part) => {
                        const isPartActive = isEpSelected && (selectedPart ?? deptParts[0]?.partId) === part.partId;
                        const partProgress = calcPartProgress(part.scenes);
                        const memo = partMemos[part.sheetName];

                        return (
                          <div
                            key={part.sheetName}
                            className={cn(
                              'group/part flex items-center gap-1.5 px-2 py-1 mx-1 rounded-md cursor-pointer transition-colors',
                              isPartActive
                                ? 'bg-accent/15 text-accent'
                                : 'text-text-secondary hover:bg-bg-primary/70 hover:text-text-primary',
                            )}
                            onClick={() => onSelectEpisodePart(ep.episodeNumber, part.partId)}
                            onContextMenu={(e) => onPartContextMenu(e, part.sheetName)}
                          >
                            {/* 파트 라벨 */}
                            <span className="text-xs font-medium truncate flex-1">
                              {part.partId}파트
                              {memo && (
                                <span className="ml-1 inline-flex items-center" title={`메모: ${memo}`}>
                                  <StickyNote size={9} className="text-yellow-400/70" />
                                </span>
                              )}
                            </span>

                            {/* 씬 수 */}
                            <span className="text-[10px] text-text-secondary/40 tabular-nums shrink-0">
                              {part.scenes.length}
                            </span>

                            {/* 미니 진행률 */}
                            {part.scenes.length > 0 && (
                              <div className="w-6 h-1 bg-bg-primary rounded-full overflow-hidden shrink-0">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${partProgress}%`,
                                    backgroundColor: partProgress >= 100 ? '#22c55e' : deptColor,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}

                    {/* 파트 추가 */}
                    {isEpSelected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAddPart(); }}
                        className="flex items-center gap-1 px-2 py-1 mx-1 text-[10px] text-text-secondary/40 hover:text-accent rounded transition-colors"
                        title="파트 추가"
                      >
                        <Plus size={10} />
                        <span>파트 추가</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
