import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { STAGE_LABELS, STAGE_COLORS, STAGES } from '@/types';
import type { Scene, Stage } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import { toggleTestSceneStage } from '@/services/testSheetService';
import { cn } from '@/utils/cn';

interface SceneCardProps {
  scene: Scene;
  episodeNumber: number;
  partId: string;
  onToggle: (sceneId: string, stage: Stage) => void;
}

function SceneCard({ scene, episodeNumber, partId, onToggle }: SceneCardProps) {
  const pct = sceneProgress(scene);

  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4 flex flex-col gap-2">
      {/* 상단: 씬 정보 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-accent">
            #{scene.no}
          </span>
          <span className="text-sm text-text-primary">{scene.sceneId}</span>
        </div>
        <span className="text-xs text-text-secondary">{scene.assignee}</span>
      </div>

      {/* 메모 */}
      {scene.memo && (
        <p className="text-xs text-text-secondary">{scene.memo}</p>
      )}

      {/* 체크박스 칩들 */}
      <div className="flex gap-2">
        {STAGES.map((stage) => (
          <button
            key={stage}
            onClick={() => onToggle(scene.sceneId, stage)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              scene[stage]
                ? 'text-bg-primary'
                : 'bg-bg-primary text-text-secondary border border-bg-border hover:border-text-secondary'
            )}
            style={
              scene[stage]
                ? { backgroundColor: STAGE_COLORS[stage] }
                : undefined
            }
          >
            {scene[stage] ? '✓ ' : ''}{STAGE_LABELS[stage]}
          </button>
        ))}
      </div>

      {/* 진행 바 */}
      <div className="h-1 bg-bg-primary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor:
              pct >= 100 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct >= 25 ? '#E17055' : '#FF6B6B',
          }}
        />
      </div>
    </div>
  );
}

export function ScenesView() {
  const episodes = useDataStore((s) => s.episodes);
  const toggleSceneStage = useDataStore((s) => s.toggleSceneStage);
  const { selectedEpisode, selectedPart, selectedAssignee, searchQuery } = useAppStore();
  const { setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSearchQuery } = useAppStore();

  // 에피소드 목록
  const episodeOptions = episodes.map((ep) => ({
    value: ep.episodeNumber,
    label: ep.title,
  }));

  // 선택된 에피소드
  const currentEp = episodes.find((ep) => ep.episodeNumber === selectedEpisode) ?? episodes[0];
  const parts = currentEp?.parts ?? [];
  const currentPart = parts.find((p) => p.partId === selectedPart) ?? parts[0];

  // 필터링
  let scenes = currentPart?.scenes ?? [];
  if (selectedAssignee) {
    scenes = scenes.filter((s) => s.assignee === selectedAssignee);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    scenes = scenes.filter(
      (s) =>
        s.sceneId.toLowerCase().includes(q) ||
        s.memo.toLowerCase().includes(q)
    );
  }

  // 담당자 목록 (현재 파트 기준)
  const assignees = Array.from(
    new Set((currentPart?.scenes ?? []).map((s) => s.assignee).filter(Boolean))
  );

  // 전체 진행도 (필터 기준)
  const totalChecks = scenes.length * 4;
  const doneChecks = scenes.reduce(
    (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length,
    0
  );
  const overallPct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;

  const handleToggle = async (sceneId: string, stage: Stage) => {
    if (!currentEp || !currentPart) return;
    // 1. 낙관적 업데이트 (UI 즉시 반영)
    toggleSceneStage(currentEp.episodeNumber, currentPart.partId, sceneId, stage);
    // 2. 파일에 저장 → fs.watch가 다른 사용자에게 알림
    await toggleTestSceneStage(
      episodes, currentEp.episodeNumber, currentPart.partId, sceneId, stage
    );
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 bg-bg-card border border-bg-border rounded-xl p-3">
        {/* 에피소드 선택 */}
        <select
          value={selectedEpisode ?? currentEp?.episodeNumber ?? ''}
          onChange={(e) => setSelectedEpisode(Number(e.target.value))}
          className="bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
        >
          {episodeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* 파트 탭 */}
        <div className="flex gap-1">
          {parts.map((part) => (
            <button
              key={part.partId}
              onClick={() => setSelectedPart(part.partId)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm transition-colors',
                (selectedPart ?? parts[0]?.partId) === part.partId
                  ? 'bg-accent text-white'
                  : 'bg-bg-primary text-text-secondary hover:text-text-primary'
              )}
            >
              {part.partId}파트
            </button>
          ))}
        </div>

        {/* 담당자 필터 */}
        <div className="flex gap-1">
          <button
            onClick={() => setSelectedAssignee(null)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs transition-colors',
              !selectedAssignee
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            전체
          </button>
          {assignees.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedAssignee(name)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors',
                selectedAssignee === name
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {/* 검색 */}
        <input
          type="text"
          placeholder="씬번호, 메모 검색..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 ml-auto w-48"
        />
      </div>

      {/* 상단 고정 진행도 */}
      <div className="flex items-center gap-3 bg-bg-card border border-bg-border rounded-xl px-4 py-2">
        <span className="text-sm text-text-secondary">
          {scenes.length}씬 표시 중
        </span>
        <div className="flex-1 h-2 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <span className="text-sm font-bold text-accent">{overallPct}%</span>
      </div>

      {/* 씬 카드 목록 */}
      <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
        {scenes.map((scene) => (
          <SceneCard
            key={scene.sceneId}
            scene={scene}
            episodeNumber={currentEp?.episodeNumber ?? 1}
            partId={currentPart?.partId ?? 'A'}
            onToggle={handleToggle}
          />
        ))}
        {scenes.length === 0 && (
          <div className="col-span-full text-center text-text-secondary py-12">
            표시할 씬이 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
