import { useState } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { STAGE_LABELS, STAGE_COLORS, STAGES } from '@/types';
import type { Scene, Stage } from '@/types';
import { sceneProgress } from '@/utils/calcStats';
import {
  toggleTestSceneStage,
  addTestEpisode,
  addTestPart,
  addTestScene,
  deleteTestScene,
  updateTestSceneField,
} from '@/services/testSheetService';
import {
  updateSheetCell,
  addEpisodeToSheets,
  addPartToSheets,
  addSceneToSheets,
  deleteSceneFromSheets,
  updateSceneFieldInSheets,
} from '@/services/sheetsService';
import { cn } from '@/utils/cn';

// ─── 씬 카드 ──────────────────────────────────────────────────

interface SceneCardProps {
  scene: Scene;
  sceneIndex: number;
  sheetName: string;
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onFieldUpdate: (sceneIndex: number, field: string, value: string) => void;
}

function SceneCard({ scene, sceneIndex, sheetName, onToggle, onDelete, onFieldUpdate }: SceneCardProps) {
  const pct = sceneProgress(scene);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (field: string, currentValue: string) => {
    setEditing(field);
    setEditValue(currentValue);
  };

  const commitEdit = () => {
    if (editing && editValue !== undefined) {
      const original = scene[editing as keyof Scene];
      if (String(original) !== editValue) {
        onFieldUpdate(sceneIndex, editing, editValue);
      }
    }
    setEditing(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(null);
  };

  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4 flex flex-col gap-2 group">
      {/* 상단: 씬 정보 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-accent">
            #{scene.no}
          </span>
          {editing === 'sceneId' ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              className="text-sm bg-bg-primary border border-accent rounded px-1 py-0.5 text-text-primary w-24"
            />
          ) : (
            <span
              className="text-sm text-text-primary cursor-pointer hover:text-accent"
              onClick={() => startEdit('sceneId', scene.sceneId)}
            >
              {scene.sceneId || '(씬번호 없음)'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing === 'assignee' ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              className="text-xs bg-bg-primary border border-accent rounded px-1 py-0.5 text-text-primary w-16"
            />
          ) : (
            <span
              className="text-xs text-text-secondary cursor-pointer hover:text-accent"
              onClick={() => startEdit('assignee', scene.assignee)}
            >
              {scene.assignee || '(담당자)'}
            </span>
          )}
          <button
            onClick={() => onDelete(sceneIndex)}
            className="opacity-0 group-hover:opacity-100 text-xs text-status-none hover:text-red-400 transition-opacity"
            title="씬 삭제"
          >
            ×
          </button>
        </div>
      </div>

      {/* 메모 */}
      {editing === 'memo' ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="text-xs bg-bg-primary border border-accent rounded px-2 py-1 text-text-primary"
        />
      ) : (
        <p
          className="text-xs text-text-secondary min-h-[1rem] cursor-pointer hover:text-accent"
          onClick={() => startEdit('memo', scene.memo)}
        >
          {scene.memo || '(메모 클릭하여 편집)'}
        </p>
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

// ─── 씬 추가 폼 ──────────────────────────────────────────────

interface AddSceneFormProps {
  onSubmit: (sceneId: string, assignee: string, memo: string) => void;
  onCancel: () => void;
}

function AddSceneForm({ onSubmit, onCancel }: AddSceneFormProps) {
  const [sceneId, setSceneId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [memo, setMemo] = useState('');

  const handleSubmit = () => {
    onSubmit(sceneId, assignee, memo);
    setSceneId('');
    setAssignee('');
    setMemo('');
  };

  return (
    <div className="bg-bg-card border-2 border-accent/50 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          autoFocus
          value={sceneId}
          onChange={(e) => setSceneId(e.target.value)}
          placeholder="씬번호"
          className="flex-1 bg-bg-primary border border-bg-border rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-secondary/40"
        />
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="담당자"
          className="w-20 bg-bg-primary border border-bg-border rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-secondary/40"
        />
      </div>
      <input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="메모 (선택)"
        className="bg-bg-primary border border-bg-border rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-secondary/40"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          취소
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent/80 transition-colors"
        >
          추가
        </button>
      </div>
    </div>
  );
}

// ─── 메인 뷰 ──────────────────────────────────────────────────

export function ScenesView() {
  const episodes = useDataStore((s) => s.episodes);
  const toggleSceneStage = useDataStore((s) => s.toggleSceneStage);
  const addEpisodeOptimistic = useDataStore((s) => s.addEpisodeOptimistic);
  const addPartOptimistic = useDataStore((s) => s.addPartOptimistic);
  const addSceneOptimistic = useDataStore((s) => s.addSceneOptimistic);
  const deleteSceneOptimistic = useDataStore((s) => s.deleteSceneOptimistic);
  const updateSceneFieldOptimistic = useDataStore((s) => s.updateSceneFieldOptimistic);
  const setEpisodes = useDataStore((s) => s.setEpisodes);
  const { sheetsConnected } = useAppStore();
  const { selectedEpisode, selectedPart, selectedAssignee, searchQuery } = useAppStore();
  const { setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSearchQuery } = useAppStore();

  const [showAddScene, setShowAddScene] = useState(false);

  // 백그라운드 동기화: 낙관적 업데이트 후 서버/파일과 싱크
  const syncInBackground = async () => {
    try {
      if (sheetsConnected) {
        const { readAllFromSheets } = await import('@/services/sheetsService');
        const eps = await readAllFromSheets();
        setEpisodes(eps);
      }
      // 테스트 모드: 파일 쓰기는 이미 test 함수에서 처리됨
    } catch (err) {
      console.error('[백그라운드 동기화 실패]', err);
    }
  };

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

  // 다음 에피소드 번호 계산
  const nextEpisodeNumber = episodes.length > 0
    ? Math.max(...episodes.map((ep) => ep.episodeNumber)) + 1
    : 1;

  // 다음 파트 ID 계산
  const nextPartId = currentEp
    ? String.fromCharCode(
        Math.max(...currentEp.parts.map((p) => p.partId.charCodeAt(0))) + 1
      )
    : 'A';

  // ─── 핸들러들 ─────────────────────────────────

  const handleToggle = async (sceneId: string, stage: Stage) => {
    if (!currentEp || !currentPart) return;

    const scene = currentPart.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) return;

    const newValue = !scene[stage];
    const sceneIndex = currentPart.scenes.findIndex((s) => s.sceneId === sceneId);

    toggleSceneStage(currentEp.episodeNumber, currentPart.partId, sceneId, stage);

    try {
      if (sheetsConnected) {
        await updateSheetCell(currentPart.sheetName, sceneIndex, stage, newValue);
      } else {
        await toggleTestSceneStage(
          episodes, currentEp.episodeNumber, currentPart.partId, sceneId, stage
        );
      }
    } catch (err) {
      console.error('[토글 실패]', err);
      toggleSceneStage(currentEp.episodeNumber, currentPart.partId, sceneId, stage);
    }
  };

  const handleAddEpisode = async () => {
    // 낙관적 업데이트: UI 즉시 반영
    addEpisodeOptimistic(nextEpisodeNumber);
    setSelectedEpisode(nextEpisodeNumber);

    // 백그라운드에서 서버/파일에 저장
    try {
      if (sheetsConnected) {
        await addEpisodeToSheets(nextEpisodeNumber);
        syncInBackground();
      } else {
        await addTestEpisode(episodes, nextEpisodeNumber);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        alert(`에피소드 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        alert(`에피소드 추가 실패: ${err}`);
      }
      syncInBackground();
    }
  };

  const handleAddPart = async () => {
    if (!currentEp) return;
    if (nextPartId > 'Z') {
      alert('파트는 Z까지만 가능합니다');
      return;
    }

    // 낙관적 업데이트
    addPartOptimistic(currentEp.episodeNumber, nextPartId);
    setSelectedPart(nextPartId);

    try {
      if (sheetsConnected) {
        await addPartToSheets(currentEp.episodeNumber, nextPartId);
        syncInBackground();
      } else {
        await addTestPart(episodes, currentEp.episodeNumber, nextPartId);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        alert(`파트 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        alert(`파트 추가 실패: ${err}`);
      }
      syncInBackground();
    }
  };

  const handleAddScene = async (sceneId: string, assignee: string, memo: string) => {
    if (!currentPart) return;

    // 낙관적 업데이트
    addSceneOptimistic(currentPart.sheetName, sceneId, assignee, memo);
    setShowAddScene(false);

    try {
      if (sheetsConnected) {
        await addSceneToSheets(currentPart.sheetName, sceneId, assignee, memo);
        syncInBackground();
      } else {
        await addTestScene(episodes, currentPart.sheetName, sceneId, assignee, memo);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Unknown action')) {
        alert(`씬 추가 실패: Apps Script 웹 앱을 최신 Code.gs로 재배포해주세요.\n(배포 → 새 배포 → 배포)`);
      } else {
        alert(`씬 추가 실패: ${err}`);
      }
      syncInBackground();
    }
  };

  const handleDeleteScene = async (sceneIndex: number) => {
    if (!currentPart) return;
    if (!confirm('이 씬을 삭제하시겠습니까?')) return;

    // 낙관적 업데이트
    deleteSceneOptimistic(currentPart.sheetName, sceneIndex);

    try {
      if (sheetsConnected) {
        await deleteSceneFromSheets(currentPart.sheetName, sceneIndex);
        syncInBackground();
      } else {
        await deleteTestScene(episodes, currentPart.sheetName, sceneIndex);
      }
    } catch (err) {
      alert(`씬 삭제 실패: ${err}`);
      syncInBackground();
    }
  };

  const handleFieldUpdate = async (sceneIndex: number, field: string, value: string) => {
    if (!currentPart) return;

    // 낙관적 업데이트
    updateSceneFieldOptimistic(currentPart.sheetName, sceneIndex, field, value);

    try {
      if (sheetsConnected) {
        await updateSceneFieldInSheets(currentPart.sheetName, sceneIndex, field, value);
        syncInBackground();
      } else {
        await updateTestSceneField(episodes, currentPart.sheetName, sceneIndex, field, value);
      }
    } catch (err) {
      alert(`수정 실패: ${err}`);
      syncInBackground();
    }
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

        {/* 에피소드 추가 */}
        <button
          onClick={handleAddEpisode}

          className="px-2.5 py-1.5 bg-accent/20 text-accent text-xs rounded-lg hover:bg-accent/30 transition-colors"
          title={`EP.${String(nextEpisodeNumber).padStart(2, '0')} 추가`}
        >
          + EP
        </button>

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
          {/* 파트 추가 */}
          {currentEp && (
            <button
              onClick={handleAddPart}
    
              className="px-2.5 py-1.5 bg-bg-primary text-text-secondary text-sm rounded-lg hover:text-accent hover:border-accent border border-bg-border transition-colors"
              title={`${nextPartId}파트 추가`}
            >
              +
            </button>
          )}
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
        {/* 씬 추가 버튼 */}
        {currentPart && (
          <button
            onClick={() => setShowAddScene(true)}
  
            className="px-3 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent/80 transition-colors"
          >
            + 씬 추가
          </button>
        )}
      </div>

      {/* 씬 카드 목록 */}
      <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
        {/* 씬 추가 폼 */}
        {showAddScene && (
          <AddSceneForm
            onSubmit={handleAddScene}
            onCancel={() => setShowAddScene(false)}
          />
        )}

        {scenes.map((scene, idx) => (
          <SceneCard
            key={`${scene.sceneId}-${idx}`}
            scene={scene}
            sceneIndex={currentPart?.scenes.indexOf(scene) ?? idx}
            sheetName={currentPart?.sheetName ?? ''}
            onToggle={handleToggle}
            onDelete={handleDeleteScene}
            onFieldUpdate={handleFieldUpdate}
          />
        ))}
        {scenes.length === 0 && !showAddScene && (
          <div className="col-span-full text-center text-text-secondary py-12">
            표시할 씬이 없습니다. &quot;씬 추가&quot; 버튼으로 새 씬을 추가하세요.
          </div>
        )}
      </div>
    </div>
  );
}
