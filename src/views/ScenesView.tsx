import { useState } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import type { SortKey, StatusFilter } from '@/stores/useAppStore';
import { STAGE_LABELS, STAGE_COLORS, STAGES } from '@/types';
import type { Scene, Stage } from '@/types';
import { sceneProgress, isFullyDone, isNotStarted } from '@/utils/calcStats';
import { ArrowUpDown, LayoutGrid, Table2, Layers, List } from 'lucide-react';
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

  const borderColor = pct >= 100 ? '#00B894' : pct >= 50 ? '#FDCB6E' : pct > 0 ? '#E17055' : '#2D3041';

  return (
    <div
      className="bg-bg-card border border-bg-border rounded-lg p-4 flex flex-col gap-2 group"
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
    >
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

      {/* 레이아웃 ID */}
      <div className="flex items-center gap-1">
        <Layers size={10} className="text-text-secondary/50" />
        {editing === 'layoutId' ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            placeholder="레이아웃 번호"
            className="text-xs bg-bg-primary border border-accent rounded px-1 py-0.5 text-text-primary flex-1"
          />
        ) : (
          <span
            className="text-[10px] text-text-secondary/60 cursor-pointer hover:text-accent font-mono"
            onClick={() => startEdit('layoutId', scene.layoutId || '')}
          >
            {scene.layoutId ? `L#${scene.layoutId}` : '(레이아웃)'}
          </span>
        )}
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

// ─── 테이블 뷰 ──────────────────────────────────────────────────

interface SceneTableProps {
  scenes: Scene[];
  allScenes: Scene[];
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onFieldUpdate: (sceneIndex: number, field: string, value: string) => void;
}

function SceneTable({ scenes, allScenes, onToggle, onDelete, onFieldUpdate }: SceneTableProps) {
  return (
    <div className="overflow-auto rounded-lg border border-bg-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg-card border-b border-bg-border text-text-secondary text-xs">
            <th className="px-3 py-2 text-left font-medium">No</th>
            <th className="px-3 py-2 text-left font-medium">씬번호</th>
            <th className="px-3 py-2 text-left font-medium">담당자</th>
            <th className="px-3 py-2 text-left font-medium">레이아웃</th>
            <th className="px-3 py-2 text-left font-medium">메모</th>
            {STAGES.map((s) => (
              <th key={s} className="px-2 py-2 text-center font-medium">{STAGE_LABELS[s]}</th>
            ))}
            <th className="px-3 py-2 text-center font-medium">진행</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {scenes.map((scene) => {
            const pct = sceneProgress(scene);
            const idx = allScenes.indexOf(scene);
            return (
              <tr key={`${scene.sceneId}-${idx}`} className="border-b border-bg-border/50 hover:bg-bg-card/50 group">
                <td className="px-3 py-2 font-mono text-accent text-xs">#{scene.no}</td>
                <td className="px-3 py-2 text-text-primary">{scene.sceneId || '-'}</td>
                <td className="px-3 py-2 text-text-secondary">{scene.assignee || '-'}</td>
                <td className="px-3 py-2 text-text-secondary font-mono text-xs">{scene.layoutId ? `#${scene.layoutId}` : '-'}</td>
                <td className="px-3 py-2 text-text-secondary max-w-[150px] truncate">{scene.memo || '-'}</td>
                {STAGES.map((stage) => (
                  <td key={stage} className="px-2 py-2 text-center">
                    <button
                      onClick={() => onToggle(scene.sceneId, stage)}
                      className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all"
                      style={
                        scene[stage]
                          ? { backgroundColor: STAGE_COLORS[stage], color: '#0F1117' }
                          : { border: '1px solid #2D3041' }
                      }
                    >
                      {scene[stage] ? '✓' : ''}
                    </button>
                  </td>
                ))}
                <td className="px-3 py-2 text-center">
                  <span className={cn(
                    'text-xs font-mono',
                    pct >= 100 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-text-secondary'
                  )}>
                    {Math.round(pct)}%
                  </span>
                </td>
                <td className="px-2 py-2">
                  <button
                    onClick={() => onDelete(idx)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-status-none hover:text-red-400"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 씬 추가 폼 (P1-3: 접두사 드롭다운 + 자동 번호) ────────────

const SCENE_PREFIXES = ['a', 'b', 'c', 'd', 'sc'];

function suggestNextNumber(prefix: string, existingIds: string[]): string {
  // prefix에 해당하는 기존 번호 추출
  const nums = existingIds
    .filter((id) => id.startsWith(prefix))
    .map((id) => parseInt(id.slice(prefix.length), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  if (nums.length === 0) return '001';

  // 빈 번호 찾기 (1부터 시작)
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      return String(i + 1).padStart(3, '0');
    }
  }
  // 빈 번호 없으면 다음 번호
  return String(nums[nums.length - 1] + 1).padStart(3, '0');
}

interface AddSceneFormProps {
  existingSceneIds: string[];
  onSubmit: (sceneId: string, assignee: string, memo: string) => void;
  onCancel: () => void;
}

function AddSceneForm({ existingSceneIds, onSubmit, onCancel }: AddSceneFormProps) {
  const [prefix, setPrefix] = useState(SCENE_PREFIXES[0]);
  const [number, setNumber] = useState(() => suggestNextNumber(SCENE_PREFIXES[0], existingSceneIds));
  const [assignee, setAssignee] = useState('');
  const [memo, setMemo] = useState('');

  const sceneId = `${prefix}${number}`;
  const isDuplicate = existingSceneIds.includes(sceneId);

  const handlePrefixChange = (newPrefix: string) => {
    setPrefix(newPrefix);
    setNumber(suggestNextNumber(newPrefix, existingSceneIds));
  };

  const handleSubmit = () => {
    if (isDuplicate) return;
    onSubmit(sceneId, assignee, memo);
    // 다음 번호로 자동 전진
    const updatedIds = [...existingSceneIds, sceneId];
    setNumber(suggestNextNumber(prefix, updatedIds));
    setAssignee('');
    setMemo('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isDuplicate) handleSubmit();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="bg-bg-card border-2 border-accent/50 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex gap-2">
        {/* 접두사 드롭다운 */}
        <select
          value={prefix}
          onChange={(e) => handlePrefixChange(e.target.value)}
          className="bg-bg-primary border border-bg-border rounded px-2 py-1 text-sm text-text-primary w-16"
        >
          {SCENE_PREFIXES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {/* 번호 입력 */}
        <div className="relative flex-1">
          <input
            autoFocus
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="001"
            className={cn(
              'w-full bg-bg-primary border rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-secondary/40',
              isDuplicate ? 'border-red-500' : 'border-bg-border'
            )}
          />
          {isDuplicate && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-red-400">
              중복
            </span>
          )}
        </div>
        {/* 미리보기 */}
        <span className="flex items-center text-xs text-text-secondary font-mono min-w-[60px]">
          → {sceneId}
        </span>
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="담당자"
          className="w-20 bg-bg-primary border border-bg-border rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-secondary/40"
        />
      </div>
      <input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="메모 (선택)"
        className="bg-bg-primary border border-bg-border rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-secondary/40"
      />
      <div className="flex gap-2 justify-end items-center">
        <span className="text-[10px] text-text-secondary/50 mr-auto">
          Enter로 추가 · Esc로 취소
        </span>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          취소
        </button>
        <button
          onClick={handleSubmit}
          disabled={isDuplicate}
          className={cn(
            'px-3 py-1 text-white text-xs rounded-md transition-colors',
            isDuplicate ? 'bg-gray-500 cursor-not-allowed' : 'bg-accent hover:bg-accent/80'
          )}
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
  const { sortKey, sortDir, statusFilter, sceneViewMode, sceneGroupMode } = useAppStore();
  const { setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSearchQuery } = useAppStore();
  const { setSortKey, setSortDir, setStatusFilter, setSceneViewMode, setSceneGroupMode } = useAppStore();

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
  // 상태 필터
  if (statusFilter === 'done') {
    scenes = scenes.filter(isFullyDone);
  } else if (statusFilter === 'not-started') {
    scenes = scenes.filter(isNotStarted);
  } else if (statusFilter === 'in-progress') {
    scenes = scenes.filter((s) => !isFullyDone(s) && !isNotStarted(s));
  }
  // 정렬
  scenes = [...scenes].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'no': cmp = a.no - b.no; break;
      case 'assignee': cmp = (a.assignee || '').localeCompare(b.assignee || ''); break;
      case 'progress': cmp = sceneProgress(a) - sceneProgress(b); break;
      case 'incomplete': {
        const aLeft = 4 - [a.lo, a.done, a.review, a.png].filter(Boolean).length;
        const bLeft = 4 - [b.lo, b.done, b.review, b.png].filter(Boolean).length;
        cmp = bLeft - aLeft; // 미완료 많은 것 먼저
        break;
      }
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // 레이아웃별 그룹핑 (P1-4)
  const layoutGroups = (() => {
    if (sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, Scene[]>();
    for (const scene of scenes) {
      const lid = (scene.layoutId || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(scene);
      groups.set(key, arr);
    }
    // 정렬: 미분류를 맨 뒤로, 나머지는 번호순
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  })();

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

    // 낙관적 업데이트 (폼은 닫지 않음 — 연속 입력 지원)
    addSceneOptimistic(currentPart.sheetName, sceneId, assignee, memo);

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

        {/* 구분선 */}
        <div className="w-px h-6 bg-bg-border" />

        {/* 상태 필터 */}
        {(['all', 'not-started', 'in-progress', 'done'] as StatusFilter[]).map((f) => {
          const labels: Record<StatusFilter, string> = {
            all: '전체', 'not-started': '미착수', 'in-progress': '진행중', done: '완료',
          };
          return (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                'px-2 py-1 rounded-md text-xs transition-colors',
                statusFilter === f
                  ? f === 'done' ? 'bg-green-500/20 text-green-400'
                    : f === 'not-started' ? 'bg-red-500/20 text-red-400'
                    : f === 'in-progress' ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {labels[f]}
            </button>
          );
        })}

        {/* 오른쪽 그룹: 정렬 + 뷰모드 + 검색 */}
        <div className="flex items-center gap-2 ml-auto">
          {/* 정렬 */}
          <div className="flex items-center gap-1">
            <ArrowUpDown size={14} className="text-text-secondary" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-bg-primary border border-bg-border rounded px-2 py-1 text-xs text-text-primary"
            >
              <option value="no">번호순</option>
              <option value="assignee">담당자순</option>
              <option value="progress">진행률순</option>
              <option value="incomplete">미완료 우선</option>
            </select>
            <button
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              className="px-1.5 py-1 text-xs text-text-secondary hover:text-text-primary rounded hover:bg-bg-border/50"
              title={sortDir === 'asc' ? '오름차순' : '내림차순'}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {/* 그룹 모드 토글 */}
          <div className="flex border border-bg-border rounded-lg overflow-hidden">
            <button
              onClick={() => setSceneGroupMode('flat')}
              className={cn(
                'p-1.5 transition-colors',
                sceneGroupMode === 'flat' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="씬번호별"
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setSceneGroupMode('layout')}
              className={cn(
                'p-1.5 transition-colors',
                sceneGroupMode === 'layout' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="레이아웃별"
            >
              <Layers size={14} />
            </button>
          </div>

          {/* 뷰 모드 토글 */}
          <div className="flex border border-bg-border rounded-lg overflow-hidden">
            <button
              onClick={() => setSceneViewMode('card')}
              className={cn(
                'p-1.5 transition-colors',
                sceneViewMode === 'card' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="카드 뷰"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setSceneViewMode('table')}
              className={cn(
                'p-1.5 transition-colors',
                sceneViewMode === 'table' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
              )}
              title="테이블 뷰"
            >
              <Table2 size={14} />
            </button>
          </div>

          {/* 검색 */}
          <input
            type="text"
            placeholder="검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 w-36"
          />
        </div>
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

      {/* 씬 추가 폼 */}
      {showAddScene && (
        <AddSceneForm
          existingSceneIds={(currentPart?.scenes ?? []).map((s) => s.sceneId)}
          onSubmit={handleAddScene}
          onCancel={() => setShowAddScene(false)}
        />
      )}

      {/* 씬 목록 */}
      {scenes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary">
          표시할 씬이 없습니다.
        </div>
      ) : sceneGroupMode === 'layout' && layoutGroups ? (
        /* ── 레이아웃별 그룹 뷰 (P1-4) ── */
        <div className="flex-1 overflow-auto flex flex-col gap-4">
          {layoutGroups.map(([layoutKey, groupScenes]) => {
            const groupTotal = groupScenes.length * 4;
            const groupDone = groupScenes.reduce(
              (sum, s) => sum + [s.lo, s.done, s.review, s.png].filter(Boolean).length, 0
            );
            const groupPct = groupTotal > 0 ? Math.round((groupDone / groupTotal) * 100) : 0;
            const sceneIds = groupScenes.map((s) => s.sceneId).join(', ');

            return (
              <div key={layoutKey} className="flex flex-col gap-2">
                {/* 레이아웃 그룹 헤더 */}
                <div className="flex items-center gap-3 bg-bg-card/50 border border-bg-border rounded-lg px-4 py-2">
                  <Layers size={14} className="text-accent" />
                  <span className="text-sm font-bold text-text-primary">
                    레이아웃 #{layoutKey}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {sceneIds}
                  </span>
                  <div className="flex-1 h-1.5 bg-bg-primary rounded-full overflow-hidden ml-2">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${groupPct}%`,
                        backgroundColor: groupPct >= 100 ? '#00B894' : groupPct >= 50 ? '#FDCB6E' : '#E17055',
                      }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-secondary">{groupPct}%</span>
                </div>

                {/* 그룹 내 씬들 */}
                {sceneViewMode === 'table' ? (
                  <SceneTable
                    scenes={groupScenes}
                    allScenes={currentPart?.scenes ?? []}
                    onToggle={handleToggle}
                    onDelete={handleDeleteScene}
                    onFieldUpdate={handleFieldUpdate}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {groupScenes.map((scene, idx) => (
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : sceneViewMode === 'table' ? (
        /* ── 테이블 뷰 (플랫) ── */
        <div className="flex-1 overflow-auto">
          <SceneTable
            scenes={scenes}
            allScenes={currentPart?.scenes ?? []}
            onToggle={handleToggle}
            onDelete={handleDeleteScene}
            onFieldUpdate={handleFieldUpdate}
          />
        </div>
      ) : (
        /* ── 카드 뷰 (플랫) ── */
        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
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
        </div>
      )}
    </div>
  );
}
