import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ChevronRight, Plus, FolderOpen, Folder, MoreVertical, Archive, RotateCcw, PanelLeftClose } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { Episode, Department, ScenesDeptFilter } from '@/types';
import { DEPARTMENT_CONFIGS } from '@/types';

export interface ArchivedEpisodeInfo {
  episodeNumber: number;
  title: string;
  partCount: number;
  archivedBy?: string;
  archivedAt?: string;
  memo?: string;
}

interface EpisodeTreeNavProps {
  episodes: Episode[];
  selectedDepartment: ScenesDeptFilter;
  selectedEpisode: number | null;
  selectedPart: string | null;
  partMemos: Record<string, string>;
  episodeTitles: Record<number, string>;   // episodeNumber → custom title
  episodeMemos: Record<number, string>;    // episodeNumber → memo
  archivedEpisodes: ArchivedEpisodeInfo[];
  onSelectEpisodePart: (epNum: number, partId: string | null) => void;
  onAddEpisode: () => void;
  onAddPart: () => void;
  onPartContextMenu: (e: React.MouseEvent, sheetName: string) => void;
  onEpisodeEdit: (epNum: number) => void;
  onArchiveEpisode: (epNum: number) => void;
  onUnarchiveEpisode: (epNum: number) => void;
  onEpisodeContextMenu: (e: React.MouseEvent, epNum: number) => void;
  onCollapse?: () => void;
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

/** 에피소드 표시 이름: 커스텀 제목 우선, 없으면 EP.xx 숨기고 번호만 */
function getEpisodeDisplayName(ep: Episode, customTitle?: string): string {
  if (customTitle) return customTitle;
  return ep.title; // fallback
}

/** 애니메이션 가능한 접기/펼치기 래퍼 */
function CollapsibleSection({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>(isOpen ? 'auto' : 0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (isOpen) {
      // 열기: 0 → scrollHeight → auto
      const scrollH = el.scrollHeight;
      setHeight(0);
      setIsAnimating(true);
      requestAnimationFrame(() => {
        setHeight(scrollH);
        const timer = setTimeout(() => {
          setHeight('auto');
          setIsAnimating(false);
        }, 250);
        return () => clearTimeout(timer);
      });
    } else {
      // 닫기: auto → scrollHeight → 0
      const scrollH = el.scrollHeight;
      setHeight(scrollH);
      setIsAnimating(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHeight(0);
          const timer = setTimeout(() => setIsAnimating(false), 250);
          return () => clearTimeout(timer);
        });
      });
    }
  }, [isOpen]);

  return (
    <div
      ref={contentRef}
      style={{
        height: typeof height === 'number' ? `${height}px` : 'auto',
        overflow: isAnimating || !isOpen ? 'hidden' : 'visible',
        transition: isAnimating ? 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
        opacity: !isOpen && !isAnimating ? 0 : 1,
      }}
    >
      {children}
    </div>
  );
}

export function EpisodeTreeNav({
  episodes,
  selectedDepartment,
  selectedEpisode,
  selectedPart,
  partMemos,
  episodeTitles,
  episodeMemos,
  archivedEpisodes,
  onSelectEpisodePart,
  onAddEpisode,
  onAddPart,
  onPartContextMenu,
  onEpisodeEdit,
  onArchiveEpisode,
  onUnarchiveEpisode,
  onEpisodeContextMenu,
  onCollapse,
}: EpisodeTreeNavProps) {
  // 에피소드별 열림/닫힘 상태
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

  const handleSelectEpisode = useCallback((epNum: number) => {
    setExpandedEps((prev) => {
      const next = new Set(prev);
      next.add(epNum);
      return next;
    });
    onSelectEpisodePart(epNum, null);
  }, [onSelectEpisodePart]);

  const deptColor = selectedDepartment === 'all' ? '#6C5CE7' : DEPARTMENT_CONFIGS[selectedDepartment].color;

  // 'all' 모드에서 partId별 그룹핑된 항목 타입
  type GroupedPartItem = {
    partId: string;
    scenes: { lo: boolean; done: boolean; review: boolean; png: boolean }[];
    sceneCount: number;
  };

  const epPartsMap = useMemo(() => {
    const map = new Map<number, Episode['parts']>();
    for (const ep of episodes) {
      map.set(
        ep.episodeNumber,
        selectedDepartment === 'all' ? ep.parts : ep.parts.filter((p) => p.department === selectedDepartment),
      );
    }
    return map;
  }, [episodes, selectedDepartment]);

  // 'all' 모드: partId 기준 그룹핑 맵 (에피소드별)
  const epGroupedPartsMap = useMemo(() => {
    if (selectedDepartment !== 'all') return null;
    const map = new Map<number, GroupedPartItem[]>();
    for (const ep of episodes) {
      const grouped = new Map<string, GroupedPartItem>();
      for (const part of ep.parts) {
        const existing = grouped.get(part.partId);
        if (existing) {
          existing.scenes.push(...part.scenes);
          existing.sceneCount += part.scenes.length;
        } else {
          grouped.set(part.partId, {
            partId: part.partId,
            scenes: [...part.scenes],
            sceneCount: part.scenes.length,
          });
        }
      }
      map.set(ep.episodeNumber, Array.from(grouped.values()));
    }
    return map;
  }, [episodes, selectedDepartment]);

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bg-border shrink-0">
        <div className="flex items-center gap-1.5">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1 text-text-secondary/50 hover:text-accent rounded transition-colors"
              title="사이드바 접기"
            >
              <PanelLeftClose size={14} />
            </button>
          )}
          <span className="text-sm font-bold text-text-secondary uppercase tracking-wider">에피소드</span>
        </div>
        <button
          onClick={onAddEpisode}
          className="p-1 text-text-secondary/50 hover:text-accent rounded transition-colors"
          title="에피소드 추가"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 트리 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5">
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
            const displayName = getEpisodeDisplayName(ep, episodeTitles[ep.episodeNumber]);
            const epMemo = episodeMemos[ep.episodeNumber];

            return (
              <div key={ep.episodeNumber} className="mb-0.5">
                {/* 에피소드 노드 */}
                <div
                  className={cn(
                    'group flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-lg cursor-pointer transition-colors',
                    isEpSelected
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-secondary hover:bg-bg-primary hover:text-text-primary',
                  )}
                  onClick={() => handleSelectEpisode(ep.episodeNumber)}
                  onContextMenu={(e) => onEpisodeContextMenu(e, ep.episodeNumber)}
                >
                  {/* 확장 아이콘 — 크고 눈에 띄게 + 회전 애니메이션 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(ep.episodeNumber); }}
                    className={cn(
                      'p-0.5 shrink-0 rounded transition-colors',
                      isEpSelected
                        ? 'text-accent hover:bg-accent/20'
                        : 'text-text-secondary/70 hover:text-text-primary hover:bg-bg-border/50',
                    )}
                  >
                    <ChevronRight
                      size={14}
                      strokeWidth={2.5}
                      className="transition-transform duration-200 ease-in-out"
                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    />
                  </button>

                  {/* 폴더 아이콘 */}
                  {isExpanded
                    ? <FolderOpen size={14} className="shrink-0" style={{ color: deptColor }} />
                    : <Folder size={14} className="shrink-0" style={{ color: deptColor }} />
                  }

                  {/* 에피소드 이름 + 메모 */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-semibold truncate leading-tight" title={displayName}>{displayName}</span>
                    {epMemo && (
                      <span className="text-xs text-amber-400/60 italic truncate leading-tight" title={epMemo}>{epMemo}</span>
                    )}
                  </div>

                  {/* 씬 수 */}
                  <span className="text-xs text-text-secondary/40 tabular-nums shrink-0">
                    {totalScenes}
                  </span>

                  {/* 미니 진행률 바 */}
                  {totalScenes > 0 && (
                    <div className="w-8 h-1.5 bg-bg-primary rounded-full overflow-hidden shrink-0">
                      <div
                        className="h-full rounded-full transition-all duration-500"
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
                    <MoreVertical size={12} />
                  </button>
                </div>

                {/* 파트 목록 (애니메이션 접기/펼치기) */}
                <CollapsibleSection isOpen={isExpanded}>
                  <div className="ml-4 pl-2 border-l border-bg-border/40">
                    {deptParts.length === 0 ? (
                      <div className="text-xs text-text-secondary/30 py-1.5 px-3">
                        파트 없음
                      </div>
                    ) : selectedDepartment === 'all' && epGroupedPartsMap ? (
                      /* 'all' 모드: partId 기준 그룹핑 (BG+ACT 합산) */
                      (epGroupedPartsMap.get(ep.episodeNumber) ?? []).map((group) => {
                        const defaultPartId = (epGroupedPartsMap.get(ep.episodeNumber) ?? [])[0]?.partId;
                        const isPartActive = isEpSelected && (selectedPart ?? defaultPartId) === group.partId;
                        const partProgress = calcPartProgress(group.scenes);

                        return (
                          <div
                            key={group.partId}
                            className={cn(
                              'group/part flex items-center gap-1.5 px-2 py-1 mx-1 rounded-md cursor-pointer transition-colors',
                              isPartActive
                                ? 'bg-accent/15 text-accent'
                                : 'text-text-secondary hover:bg-bg-primary/70 hover:text-text-primary',
                            )}
                            onClick={() => onSelectEpisodePart(ep.episodeNumber, group.partId)}
                          >
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="text-sm font-medium truncate leading-tight">
                                {group.partId}파트
                              </span>
                            </div>

                            <span className="text-xs text-text-secondary/40 tabular-nums shrink-0">
                              {group.sceneCount}
                            </span>

                            {group.sceneCount > 0 && (
                              <div className="w-6 h-1 bg-bg-primary rounded-full overflow-hidden shrink-0">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
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
                    ) : (
                      /* BG/ACT 개별 모드: 기존 방식 */
                      deptParts.map((part) => {
                        const defaultKey = deptParts[0]?.partId;
                        const isPartActive = isEpSelected && (selectedPart ?? defaultKey) === part.partId;
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
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="text-sm font-medium truncate leading-tight">
                                {part.partId}파트
                              </span>
                              {memo && (
                                <span className="text-xs text-amber-400/60 italic truncate leading-tight" title={memo}>
                                  {memo}
                                </span>
                              )}
                            </div>

                            <span className="text-xs text-text-secondary/40 tabular-nums shrink-0">
                              {part.scenes.length}
                            </span>

                            {part.scenes.length > 0 && (
                              <div className="w-6 h-1 bg-bg-primary rounded-full overflow-hidden shrink-0">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
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
                        className="flex items-center gap-1.5 px-2.5 py-1.5 mx-1 mt-1 text-xs text-accent/60 hover:text-accent hover:bg-accent/10 rounded-md border border-dashed border-accent/20 hover:border-accent/40 transition-colors"
                        title="파트 추가"
                      >
                        <Plus size={12} />
                        <span>파트 추가</span>
                      </button>
                    )}

                  </div>
                </CollapsibleSection>
              </div>
            );
          })
        )}

        {/* ── 아카이빙 섹션 (맨 하단 고정) ── */}
        {archivedEpisodes.length > 0 && (
          <div className="mt-3 pt-2 border-t border-bg-border/30">
            <ArchivedSection
              archivedEpisodes={archivedEpisodes}
              episodeTitles={episodeTitles}
              onUnarchive={onUnarchiveEpisode}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 아카이빙된 에피소드 섹션 ── */
function ArchivedSection({
  archivedEpisodes,
  episodeTitles,
  onUnarchive,
}: {
  archivedEpisodes: ArchivedEpisodeInfo[];
  episodeTitles: Record<number, string>;
  onUnarchive: (epNum: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 mx-1 w-[calc(100%-8px)] rounded-lg text-text-secondary/50 hover:text-text-secondary hover:bg-bg-primary/50 transition-colors"
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className="transition-transform duration-200 ease-in-out shrink-0"
          style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
        <Archive size={12} className="shrink-0 text-amber-500/50" />
        <span className="text-[11px] font-medium">아카이빙</span>
        <span className="text-[11px] tabular-nums ml-auto">{archivedEpisodes.length}</span>
      </button>

      <CollapsibleSection isOpen={isOpen}>
        <div className="ml-4 pl-2 border-l border-amber-500/20">
          {archivedEpisodes.map((archived) => {
            const displayName = episodeTitles[archived.episodeNumber] || archived.title;
            return (
              <div
                key={archived.episodeNumber}
                className="group/arc flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-md text-text-secondary/40"
              >
                <Folder size={12} className="shrink-0 text-amber-500/30" />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[11px] font-medium truncate leading-tight">{displayName}</span>
                  <span className="text-[9px] text-text-secondary/30 leading-tight">
                    {archived.partCount}개 파트
                    {archived.archivedBy && ` · ${archived.archivedBy}`}
                    {archived.archivedAt && ` · ${archived.archivedAt}`}
                  </span>
                  {archived.memo && (
                    <span className="text-[9px] text-amber-500/40 italic truncate leading-tight">{archived.memo}</span>
                  )}
                </div>
                <button
                  onClick={() => onUnarchive(archived.episodeNumber)}
                  className="p-0.5 opacity-0 group-hover/arc:opacity-100 text-text-secondary/30 hover:text-accent transition-opacity shrink-0"
                  title="아카이빙 해제 (복원)"
                >
                  <RotateCcw size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>
    </div>
  );
}
