import { cn } from '@/utils/cn';
import { sceneProgress } from '@/utils/calcStats';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Stage } from '@/types';
import { HighlightText } from '@/components/common/HighlightText';
import { MessageCircle } from 'lucide-react';

interface UnifiedSceneTableProps {
  mergedScenes: MergedScene[];
  bgSheetName: string | null;
  actSheetName: string | null;
  searchQuery?: string;
  bgCommentCounts: Record<string, number>;
  actCommentCounts: Record<string, number>;
  selectedSceneIds: Set<string>;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
  onOpenDetail: (sheetName: string, sceneIndex: number) => void;
  onSelect: (sceneId: string) => void;
}

export function UnifiedSceneTable({
  mergedScenes,
  bgSheetName,
  actSheetName,
  searchQuery,
  bgCommentCounts,
  actCommentCounts,
  selectedSceneIds,
  onToggle,
  onDelete,
  onOpenDetail,
  onSelect,
}: UnifiedSceneTableProps) {
  const bgCfg = DEPARTMENT_CONFIGS.bg;
  const actCfg = DEPARTMENT_CONFIGS.acting;

  return (
    <div className="overflow-auto rounded-lg border border-bg-border">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="bg-bg-card border-b border-bg-border text-text-secondary text-xs">
            <th className="w-12 px-2 py-2 text-left font-medium">No</th>
            <th className="w-20 px-2 py-2 text-left font-medium">씬번호</th>
            <th className="w-16 px-2 py-2 text-left font-medium">BG담당</th>
            <th className="w-16 px-2 py-2 text-left font-medium">ACT담당</th>
            {/* BG 단계 */}
            {STAGES.map((s) => (
              <th key={`bg-${s}`} className="w-12 px-1 py-2 text-center font-medium">
                <span style={{ color: bgCfg.stageColors[s] }}>{bgCfg.stageLabels[s]}</span>
              </th>
            ))}
            {/* ACT 단계 */}
            {STAGES.map((s) => (
              <th key={`act-${s}`} className="w-12 px-1 py-2 text-center font-medium">
                <span style={{ color: actCfg.stageColors[s] }}>{actCfg.stageLabels[s]}</span>
              </th>
            ))}
            <th className="w-10 px-1 py-2 text-center font-medium">BG%</th>
            <th className="w-10 px-1 py-2 text-center font-medium">ACT%</th>
            <th className="w-10 px-1 py-2 text-center font-medium">합계</th>
            <th className="w-8 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {mergedScenes.map((m) => {
            const { sceneId, bgScene, actScene, bgSceneIndex, actSceneIndex } = m;
            const primaryScene = bgScene ?? actScene;
            if (!primaryScene) return null;

            const bgPct = bgScene ? Math.round(sceneProgress(bgScene)) : 0;
            const actPct = actScene ? Math.round(sceneProgress(actScene)) : 0;
            const presentCount = (bgScene ? 1 : 0) + (actScene ? 1 : 0);
            const combinedPct = presentCount > 0 ? Math.round((bgPct + actPct) / presentCount) : 0;

            return (
              <tr
                key={sceneId}
                className={cn(
                  'border-b border-bg-border/50 hover:bg-bg-card/50 group cursor-pointer transition-colors',
                  selectedSceneIds.has(sceneId) && 'bg-accent/10',
                )}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    onSelect(sceneId);
                  } else {
                    // 상세 모달: BG 우선
                    if (bgScene && bgSheetName) onOpenDetail(bgSheetName, bgSceneIndex);
                    else if (actScene && actSheetName) onOpenDetail(actSheetName, actSceneIndex);
                  }
                }}
              >
                {/* No */}
                <td className="px-2 py-2 font-mono text-accent text-xs">
                  <span className="flex items-center gap-1">
                    #{primaryScene.no}
                    {bgSheetName && (bgCommentCounts[`${bgSheetName}:${primaryScene.no}`] ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-0.5 bg-accent/20 text-accent px-1 py-px rounded-full">
                        <MessageCircle size={9} fill="currentColor" />
                        <span className="text-[10px] font-bold">{bgCommentCounts[`${bgSheetName}:${primaryScene.no}`]}</span>
                      </span>
                    )}
                  </span>
                </td>
                {/* 씬번호 */}
                <td className="px-2 py-2 text-text-primary text-xs truncate">
                  <HighlightText text={primaryScene.sceneId || '-'} query={searchQuery} />
                </td>
                {/* BG담당 */}
                <td className="px-2 py-2 text-xs truncate">
                  {bgScene ? (
                    <span className="text-text-secondary"><HighlightText text={bgScene.assignee || '-'} query={searchQuery} /></span>
                  ) : (
                    <span className="text-text-secondary/30">—</span>
                  )}
                </td>
                {/* ACT담당 */}
                <td className="px-2 py-2 text-xs truncate">
                  {actScene ? (
                    <span className="text-text-secondary"><HighlightText text={actScene.assignee || '-'} query={searchQuery} /></span>
                  ) : (
                    <span className="text-text-secondary/30">—</span>
                  )}
                </td>
                {/* BG 단계 체크박스 */}
                {STAGES.map((stage) => (
                  <td key={`bg-${stage}`} className="px-1 py-2 text-center">
                    {bgScene && bgSheetName ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggle(bgSheetName, sceneId, stage); }}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto"
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
                {/* ACT 단계 체크박스 */}
                {STAGES.map((stage) => (
                  <td key={`act-${stage}`} className="px-1 py-2 text-center">
                    {actScene && actSheetName ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggle(actSheetName, sceneId, stage); }}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto"
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
                <td className="px-1 py-2 text-center">
                  {bgScene ? (
                    <span className={cn('text-xs font-mono', bgPct >= 100 ? 'text-green-400' : bgPct >= 50 ? 'text-yellow-400' : 'text-text-secondary')}>
                      {bgPct}%
                    </span>
                  ) : <span className="text-text-secondary/20 text-xs">—</span>}
                </td>
                {/* ACT% */}
                <td className="px-1 py-2 text-center">
                  {actScene ? (
                    <span className={cn('text-xs font-mono', actPct >= 100 ? 'text-green-400' : actPct >= 50 ? 'text-yellow-400' : 'text-text-secondary')}>
                      {actPct}%
                    </span>
                  ) : <span className="text-text-secondary/20 text-xs">—</span>}
                </td>
                {/* 합계% */}
                <td className="px-1 py-2 text-center">
                  <span className={cn('text-xs font-mono font-bold', combinedPct >= 100 ? 'text-green-400' : combinedPct >= 50 ? 'text-yellow-400' : 'text-text-secondary')}>
                    {combinedPct}%
                  </span>
                </td>
                {/* 삭제 */}
                <td className="px-1 py-2">
                  <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {bgScene && bgSheetName && (
                      <button onClick={(e) => { e.stopPropagation(); onDelete(bgSheetName, bgSceneIndex); }} className="text-[10px] text-status-none hover:text-red-400" title="BG 삭제">×B</button>
                    )}
                    {actScene && actSheetName && (
                      <button onClick={(e) => { e.stopPropagation(); onDelete(actSheetName, actSceneIndex); }} className="text-[10px] text-status-none hover:text-red-400" title="ACT 삭제">×A</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
