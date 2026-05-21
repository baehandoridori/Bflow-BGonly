/**
 * Timeline 좌측 LayerPanel — 씬 행 라벨 + 솔로/뮤트 토글.
 *
 * - 각 행 = 씬 (sceneId 표기)
 * - "S" 버튼 = 솔로 토글 (그 씬만 강조)
 * - "👁" 버튼 = 뮤트 토글 (그 씬 숨김)
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (7.6)
 */

import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import type { TimelineScene } from './TimelinePanel';

interface LayerPanelProps {
  scenes: TimelineScene[];
  rowHeight: number;
}

export function LayerPanel({ scenes, rowHeight }: LayerPanelProps) {
  const soloScene = useCompositingDashboardStore((s) => s.soloScene);
  const toggleSolo = useCompositingDashboardStore((s) => s.toggleSolo);
  const mutedScenes = useCompositingDashboardStore((s) => s.mutedScenes);
  const toggleMute = useCompositingDashboardStore((s) => s.toggleMute);

  return (
    <div className="flex flex-col">
      {scenes.map((sc) => {
        const solo = soloScene === sc.sceneId;
        const muted = mutedScenes.has(sc.sceneId);
        return (
          <div
            key={sc.sceneId}
            className={cn(
              'flex items-center gap-1 px-2 border-b border-bg-border/25 text-[10px] transition-colors',
              muted ? 'opacity-50' : '',
            )}
            style={{ height: rowHeight }}
          >
            <button
              type="button"
              onClick={() => toggleSolo(sc.sceneId)}
              title={solo ? '솔로 해제' : '이 씬만 강조'}
              className={cn(
                'w-5 h-5 rounded text-[9px] font-bold border transition-colors flex items-center justify-center',
                solo
                  ? 'bg-accent text-white border-accent'
                  : 'bg-transparent text-text-secondary border-bg-border/50 hover:border-bg-border',
              )}
            >
              S
            </button>
            <button
              type="button"
              onClick={() => toggleMute(sc.sceneId)}
              title={muted ? '뮤트 해제 (다시 표시)' : '이 씬 뮤트 (숨김)'}
              className={cn(
                'w-5 h-5 rounded transition-colors flex items-center justify-center',
                muted
                  ? 'text-text-secondary hover:text-text-primary'
                  : 'text-text-primary/80 hover:text-text-primary',
              )}
            >
              {muted ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <span className="font-mono text-text-secondary truncate ml-0.5">{sc.sceneId}</span>
          </div>
        );
      })}
    </div>
  );
}
