import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Trash2 } from 'lucide-react';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Stage, Scene } from '@/types';
import type { SceneGroupMode } from '@/stores/useAppStore';
import { sceneProgress, progressGradient } from '@/utils/calcStats';
import { cn } from '@/utils/cn';
import { HighlightText } from '@/components/common/HighlightText';

// ─── Props ───────────────────────────────────────────────────

interface UnifiedSceneSheetViewProps {
  mergedScenes: MergedScene[];
  bgSheetName: string | null;
  actSheetName: string | null;
  commentCounts: Record<string, number>;
  searchQuery?: string;
  selectedSceneIds: Set<string>;
  sceneGroupMode: SceneGroupMode;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
  onOpenDetail: (sheetName: string, sceneIndex: number) => void;
  onCtrlClick?: (sceneId: string) => void;
}

// ─── 진행률 셀 ───────────────────────────────────────────────

function SheetProgressCell({ pct }: { pct: number }) {
  return (
    <td className="px-1 py-1.5 text-center">
      <div className="flex flex-col items-center gap-0.5">
        <span className={cn(
          'text-[10px] font-mono font-bold leading-none',
          pct >= 100 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-text-secondary',
        )}>
          {Math.round(pct)}%
        </span>
        <div className="w-full h-1 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: progressGradient(pct) }}
          />
        </div>
      </div>
    </td>
  );
}

// ─── 썸네일 셀 ───────────────────────────────────────────────

function SheetThumbnailCell({ url, label }: { url?: string; label: string }) {
  if (!url) {
    return <td className="px-1 py-1.5 text-center text-text-secondary/20 text-xs">—</td>;
  }
  return (
    <td className="px-1 py-1.5 text-center group/thumb relative">
      <img
        src={url}
        alt={label}
        className="w-10 h-7 object-contain mx-auto rounded cursor-pointer"
        draggable={false}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    </td>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────

export function UnifiedSceneSheetView({
  mergedScenes,
  bgSheetName,
  actSheetName,
  commentCounts,
  searchQuery,
  selectedSceneIds,
  sceneGroupMode,
  onToggle,
  onDelete,
  onOpenDetail,
  onCtrlClick,
}: UnifiedSceneSheetViewProps) {
  const bgCfg = DEPARTMENT_CONFIGS.bg;
  const actCfg = DEPARTMENT_CONFIGS.acting;

  // 레이아웃 그루핑
  const layoutGroups = useMemo(() => {
    if (sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, MergedScene[]>();
    for (const m of mergedScenes) {
      const primary = m.bgScene ?? m.actScene;
      const lid = (primary?.layoutId || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(m);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  }, [mergedScenes, sceneGroupMode]);

  const displayScenes = useMemo(() => {
    if (!layoutGroups) return mergedScenes;
    return layoutGroups.flatMap(([, scenes]) => scenes);
  }, [layoutGroups, mergedScenes]);

  const layoutMeta = useMemo(() => {
    if (!layoutGroups) return new Map<MergedScene, { isFirst: boolean; groupSize: number; layoutKey: string }>();
    const meta = new Map<MergedScene, { isFirst: boolean; groupSize: number; layoutKey: string }>();
    for (const [layoutKey, groupScenes] of layoutGroups) {
      groupScenes.forEach((m, i) => {
        meta.set(m, { isFirst: i === 0, groupSize: groupScenes.length, layoutKey });
      });
    }
    return meta;
  }, [layoutGroups]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <div className="overflow-auto rounded-lg border border-bg-border">
        <table className="w-full text-sm border-collapse">
          {/* ── 헤더 ── */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-card border-b border-bg-border">
              {sceneGroupMode === 'layout' && (
                <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary border-r border-bg-border/50">
                  레이아웃
                </th>
              )}
              <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary">씬번호</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-text-secondary">메모</th>
              <th className="w-14 px-1 py-2 text-center text-xs font-medium text-text-secondary">SB</th>
              <th className="w-14 px-1 py-2 text-center text-xs font-medium text-text-secondary">가이드</th>
              <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary">BG담당</th>
              <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary">ACT담당</th>
              {/* BG 스테이지 */}
              {STAGES.map((s) => (
                <th
                  key={`bg-${s}`}
                  className="w-10 px-1 py-2 text-center text-[11px] font-medium"
                  style={{ color: bgCfg.stageColors[s] }}
                >
                  {bgCfg.stageLabels[s]}
                </th>
              ))}
              {/* ACT 스테이지 */}
              {STAGES.map((s) => (
                <th
                  key={`act-${s}`}
                  className="w-10 px-1 py-2 text-center text-[11px] font-medium"
                  style={{ color: actCfg.stageColors[s] }}
                >
                  {actCfg.stageLabels[s]}
                </th>
              ))}
              <th className="w-12 px-1 py-2 text-center text-xs font-medium text-text-secondary">BG%</th>
              <th className="w-12 px-1 py-2 text-center text-xs font-medium text-text-secondary">ACT%</th>
              <th className="w-12 px-1 py-2 text-center text-xs font-medium text-text-secondary">합계</th>
              <th className="w-8 px-1 py-2" />
            </tr>
            {/* 부서 구분 서브헤더 */}
            <tr className="bg-bg-card/50 border-b border-bg-border/50">
              {sceneGroupMode === 'layout' && <th />}
              <th colSpan={5} />
              <th colSpan={2} />
              <th colSpan={4} className="py-1 text-center">
                <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary/60">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: bgCfg.color }} />
                  {bgCfg.shortLabel}
                </span>
              </th>
              <th colSpan={4} className="py-1 text-center">
                <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary/60">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: actCfg.color }} />
                  {actCfg.shortLabel}
                </span>
              </th>
              <th colSpan={3} />
              <th />
            </tr>
          </thead>

          {/* ── 본문 ── */}
          <tbody>
            {displayScenes.map((m, rowIndex) => {
              const { sceneId, bgScene, actScene, bgSceneIndex, actSceneIndex } = m;
              const primary = bgScene ?? actScene;
              if (!primary) return null;

              const bgPct = bgScene ? sceneProgress(bgScene) : 0;
              const actPct = actScene ? sceneProgress(actScene) : 0;
              const presentCount = (bgScene ? 1 : 0) + (actScene ? 1 : 0);
              const combinedPct = presentCount > 0 ? Math.round((bgPct + actPct) / presentCount) : 0;

              const meta = layoutMeta.get(m);
              const isRowSelected = selectedSceneIds.has(`bg:${sceneId}`) || selectedSceneIds.has(`act:${sceneId}`);
              const isFirstInGroup = meta?.isFirst ?? false;
              const groupSize = meta?.groupSize ?? 1;
              const layoutKey = meta?.layoutKey ?? '';

              const bgCommentCount = bgSheetName ? (commentCounts[`${bgSheetName}:${primary.no}`] ?? 0) : 0;

              return (
                <motion.tr
                  key={sceneId}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(rowIndex * 0.01, 0.2) }}
                  className={cn(
                    'border-b border-bg-border/30 transition-colors group cursor-pointer',
                    rowIndex % 2 === 0 ? 'bg-bg-card/20' : 'bg-bg-primary/10',
                    'hover:bg-accent/5',
                    isRowSelected && 'bg-accent/10 hover:bg-accent/15',
                    searchQuery && 'bg-accent/5 border-l-2 border-l-accent/60',
                    sceneGroupMode === 'layout' && isFirstInGroup && rowIndex > 0 && 'border-t-2 border-t-bg-border',
                  )}
                  onClick={(e) => {
                    if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
                      onCtrlClick(sceneId);
                    }
                  }}
                  onDoubleClick={() => {
                    if (bgScene && bgSheetName) onOpenDetail(bgSheetName, bgSceneIndex);
                    else if (actScene && actSheetName) onOpenDetail(actSheetName, actSceneIndex);
                  }}
                >
                  {/* 레이아웃 병합 셀 */}
                  {sceneGroupMode === 'layout' && isFirstInGroup && (
                    <td
                      rowSpan={groupSize}
                      className="px-2 py-2 text-center font-mono text-xs font-bold border-r border-bg-border/50 align-middle text-accent"
                    >
                      {layoutKey !== '미분류' ? `#${layoutKey}` : (
                        <span className="text-text-secondary/40 font-normal">-</span>
                      )}
                    </td>
                  )}

                  {/* 씬번호 + 댓글 뱃지 */}
                  <td className="px-2 py-1.5 font-mono text-xs text-accent">
                    <span className="flex items-center gap-1">
                      <HighlightText text={primary.sceneId || '-'} query={searchQuery} />
                      {bgCommentCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 bg-accent/20 text-accent px-1 py-px rounded-full">
                          <MessageCircle size={9} fill="currentColor" />
                          <span className="text-[10px] font-bold">{bgCommentCount}</span>
                        </span>
                      )}
                    </span>
                  </td>

                  {/* 메모 */}
                  <td className="px-2 py-1.5 text-xs text-text-secondary max-w-0 truncate">
                    {primary.memo ? (
                      <HighlightText text={primary.memo} query={searchQuery} />
                    ) : (
                      <span className="text-text-secondary/20">—</span>
                    )}
                  </td>

                  {/* 스토리보드 */}
                  <SheetThumbnailCell url={primary.storyboardUrl} label="스토리보드" />

                  {/* 가이드 */}
                  <SheetThumbnailCell url={primary.guideUrl} label="가이드" />

                  {/* BG 담당자 */}
                  <td className="px-2 py-1.5 text-xs truncate">
                    {bgScene ? (
                      <span className="text-text-secondary"><HighlightText text={bgScene.assignee || '-'} query={searchQuery} /></span>
                    ) : (
                      <span className="text-text-secondary/20">—</span>
                    )}
                  </td>

                  {/* ACT 담당자 */}
                  <td className="px-2 py-1.5 text-xs truncate">
                    {actScene ? (
                      <span className="text-text-secondary"><HighlightText text={actScene.assignee || '-'} query={searchQuery} /></span>
                    ) : (
                      <span className="text-text-secondary/20">—</span>
                    )}
                  </td>

                  {/* BG 스테이지 체크박스 */}
                  {STAGES.map((stage) => (
                    <td key={`bg-${stage}`} className="px-1 py-1.5 text-center">
                      {bgScene && bgSheetName ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggle(bgSheetName, sceneId, stage); }}
                          className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto cursor-pointer"
                          style={
                            bgScene[stage]
                              ? { backgroundColor: bgCfg.stageColors[stage], color: 'rgb(var(--color-bg-primary))' }
                              : { border: '1px solid #2D3041' }
                          }
                        >
                          {bgScene[stage] ? '✓' : ''}
                        </button>
                      ) : (
                        <span className="text-text-secondary/20 text-xs">—</span>
                      )}
                    </td>
                  ))}

                  {/* ACT 스테이지 체크박스 */}
                  {STAGES.map((stage) => (
                    <td key={`act-${stage}`} className="px-1 py-1.5 text-center">
                      {actScene && actSheetName ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggle(actSheetName, sceneId, stage); }}
                          className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto cursor-pointer"
                          style={
                            actScene[stage]
                              ? { backgroundColor: actCfg.stageColors[stage], color: 'rgb(var(--color-bg-primary))' }
                              : { border: '1px solid #2D3041' }
                          }
                        >
                          {actScene[stage] ? '✓' : ''}
                        </button>
                      ) : (
                        <span className="text-text-secondary/20 text-xs">—</span>
                      )}
                    </td>
                  ))}

                  {/* BG% */}
                  <SheetProgressCell pct={bgScene ? bgPct : 0} />

                  {/* ACT% */}
                  <SheetProgressCell pct={actScene ? actPct : 0} />

                  {/* 합계% */}
                  <SheetProgressCell pct={combinedPct} />

                  {/* 삭제 */}
                  <td className="px-1 py-1.5">
                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {bgScene && bgSheetName && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(bgSheetName, bgSceneIndex); }}
                          className="text-[10px] text-text-secondary/50 hover:text-red-400 transition-colors cursor-pointer"
                          title="BG 삭제"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                      {actScene && actSheetName && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(actSheetName, actSceneIndex); }}
                          className="text-[10px] text-text-secondary/50 hover:text-red-400 transition-colors cursor-pointer"
                          title="ACT 삭제"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
