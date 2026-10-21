import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, X } from 'lucide-react';
import { DEPARTMENT_CONFIGS, STAGES, type Department, type Episode, type Scene } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import { stripEntityTokens } from '@/utils/entityTokens';
import { cn } from '@/utils/cn';

/**
 * 보관한 에피소드를 보기 전용으로 연다(2026-10-21 보관 다듬기).
 *
 * 평소 전부 받기에는 보관한 에피소드가 빠진다. 보관함에서 한 편을 고를 때만 그 한 편을 서버에서 받아 와
 * 여기서 보여 준다. 고칠 수는 없다 — 고치려면 보관을 해제한다(다 끝난 데이터가 실수로 바뀌지 않게).
 */

export interface ArchivedEpisodeViewerProps {
  episodeNumber: number;
  displayName: string;
  load: (episodeNumber: number) => Promise<Episode | null>;
  onClose: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; episode: Episode }
  | { kind: 'missing' }
  | { kind: 'error' };

interface PartGroup {
  partId: string;
  departments: { department: Department; scenes: Scene[] }[];
}

const DEPARTMENT_ORDER: Department[] = ['bg', 'acting'];

export function groupArchivedEpisodeParts(episode: Episode): PartGroup[] {
  // BG 는 'A', ACT 는 'a' 처럼 부서마다 파트 표기의 대소문자가 다를 수 있다 — 같은 파트로 묶고 BG 표기를 보여 준다.
  const byPart = new Map<string, PartGroup>();
  for (const part of episode.parts) {
    const key = part.partId.trim().toLowerCase();
    const group = byPart.get(key) ?? { partId: part.partId, departments: [] };
    if (part.department === 'bg') group.partId = part.partId;
    group.departments.push({ department: part.department, scenes: [...part.scenes].sort((a, b) => a.no - b.no) });
    byPart.set(key, group);
  }
  return [...byPart.values()]
    .sort((a, b) => a.partId.localeCompare(b.partId, 'ko', { numeric: true, sensitivity: 'base' }))
    .map((group) => ({
      ...group,
      departments: group.departments.sort(
        (a, b) => DEPARTMENT_ORDER.indexOf(a.department) - DEPARTMENT_ORDER.indexOf(b.department),
      ),
    }));
}

function averageProgress(scenes: Scene[]): number {
  if (scenes.length === 0) return 0;
  return Math.round(scenes.reduce((sum, scene) => sum + sceneProgress(scene), 0) / scenes.length);
}

export function ArchivedEpisodeViewer({ episodeNumber, displayName, load, onClose }: ArchivedEpisodeViewerProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    load(episodeNumber)
      .then((episode) => {
        if (cancelled) return;
        setState(episode ? { kind: 'ready', episode } : { kind: 'missing' });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[보관함] 보관한 에피소드를 불러오지 못했습니다:', error);
        setState({ kind: 'error' });
      });
    return () => { cancelled = true; };
  }, [attempt, episodeNumber, load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const groups = useMemo(() => (state.kind === 'ready' ? groupArchivedEpisodeParts(state.episode) : []), [state]);
  const totalScenes = useMemo(
    () => groups.reduce((sum, group) => sum + group.departments.reduce((n, d) => n + d.scenes.length, 0), 0),
    [groups],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-overlay/50 bf-scrim-in"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`보관한 에피소드 ${displayName}`}
        className="bg-bg-card border border-bg-border rounded-xl shadow-xl bf-modal-in w-[min(920px,94vw)] max-h-[84vh] flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-bg-border/60">
          <Archive size={16} className="mt-0.5 shrink-0 text-amber-500/70" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-text-primary truncate">{displayName}</h2>
            <p className="text-[11px] text-text-secondary mt-0.5">
              보관한 에피소드라 보기만 할 수 있어요. 고치려면 왼쪽 보관함에서 보관을 해제해 주세요.
              {state.kind === 'ready' && ` · 씬 ${totalScenes}개`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-border/60"
            aria-label="닫기"
            autoFocus
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {state.kind === 'loading' && (
            <p className="text-xs text-text-secondary py-10 text-center">이 에피소드만 서버에서 불러오는 중이에요…</p>
          )}
          {state.kind === 'missing' && (
            <p className="text-xs text-text-secondary py-10 text-center">
              이 에피소드를 보관함에서 찾지 못했어요. 그사이 보관이 해제됐다면 씬 목록에서 볼 수 있어요.
            </p>
          )}
          {state.kind === 'error' && (
            <div className="py-10 flex flex-col items-center gap-3">
              <p className="text-xs text-text-secondary">불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
              <button
                type="button"
                onClick={retry}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-on-accent hover:brightness-110"
              >
                다시 시도
              </button>
            </div>
          )}
          {state.kind === 'ready' && groups.length === 0 && (
            <p className="text-xs text-text-secondary py-10 text-center">이 에피소드에는 씬이 없어요.</p>
          )}
          {state.kind === 'ready' && groups.map((group) => (
            <section key={group.partId} className="mb-5 last:mb-0">
              <h3 className="text-xs font-semibold text-text-primary mb-2">{group.partId}파트</h3>
              <div className="flex flex-col gap-3">
                {group.departments.map(({ department, scenes }) => (
                  <ArchivedDepartmentTable key={department} department={department} scenes={scenes} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ArchivedDepartmentTable({ department, scenes }: { department: Department; scenes: Scene[] }) {
  const config = DEPARTMENT_CONFIGS[department];
  return (
    <div className="rounded-lg border border-bg-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-primary/60 text-[11px]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: config.color }} />
        <span className="font-semibold text-text-primary">{config.shortLabel}</span>
        <span className="text-text-secondary tabular-nums">씬 {scenes.length}개 · 평균 {averageProgress(scenes)}%</span>
      </div>
      {scenes.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-text-secondary">씬이 없어요.</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-secondary text-left">
              <th className="font-medium px-3 py-1 w-[88px]">씬</th>
              <th className="font-medium px-2 py-1 w-[120px]">담당자</th>
              <th className="font-medium px-2 py-1 w-[220px]">단계</th>
              <th className="font-medium px-2 py-1">메모</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene) => (
              <tr key={scene.id ?? scene.sceneId} className="border-t border-bg-border/40 align-top">
                <td className="px-3 py-1.5 font-medium text-text-primary tabular-nums">{scene.sceneId}</td>
                <td className="px-2 py-1.5 text-text-secondary truncate max-w-[120px]">{scene.assignee || '—'}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {STAGES.map((stage) => {
                      const on = scene[stage];
                      return (
                        <span
                          key={stage}
                          className={cn(
                            'px-1.5 py-px rounded-full border text-[10px] leading-tight',
                            on ? 'text-white border-transparent' : 'text-text-secondary/60 border-bg-border',
                          )}
                          style={on ? { backgroundColor: config.stageColors[stage] } : undefined}
                        >
                          {config.stageLabels[stage]}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-text-secondary whitespace-pre-line break-words">
                  {scene.memo ? stripEntityTokens(scene.memo) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
