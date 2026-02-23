import { useState, useMemo, useCallback, useEffect, useContext } from 'react';
import { CheckSquare, Plus, ChevronDown, X, Search, Edit3, Check, ListFilter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Widget, IsPopupContext } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEPARTMENT_CONFIGS, STAGES } from '@/types';
import type { Stage, Scene, Episode, Part, Department } from '@/types';
import { cn } from '@/utils/cn';

/* ─── 타입 ──────────────────────────────────── */

/** 씬 참조 키 (sheetName:sceneId) */
type SceneKey = string;
const makeKey = (sheetName: string, sceneId: string): SceneKey => `${sheetName}:${sceneId}`;
const parseKey = (key: SceneKey) => {
  const idx = key.indexOf(':');
  return { sheetName: key.slice(0, idx), sceneId: key.slice(idx + 1) };
};

/** 커스텀 뷰 */
interface TaskView {
  id: string;
  name: string;
  type: 'assigned' | 'custom';
  sceneKeys: SceneKey[]; // custom일 때만 사용
}

/** 평탄화된 씬 + 메타 */
interface FlatScene {
  scene: Scene;
  sheetName: string;
  sceneIndex: number;
  episodeNumber: number;
  partId: string;
  department: Department;
  key: SceneKey;
}

/* ─── 기본 뷰 ──────────────────────────────── */
const DEFAULT_VIEW: TaskView = { id: '__assigned', name: '내 할일', type: 'assigned', sceneKeys: [] };

/* ─── 유틸 ─────────────────────────────────── */
function scenePct(s: Scene): number {
  return ([s.lo, s.done, s.review, s.png].filter(Boolean).length / 4) * 100;
}

function getDept(sheetName: string): Department {
  return sheetName.includes('_ACT') ? 'acting' : 'bg';
}

/* ─── 커스텀 뷰 퍼시스턴스 ──────────────────── */
const VIEWS_KEY = 'bflow_my_task_views';
function loadViews(): TaskView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function saveViews(views: TaskView[]) {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

/* ─── 씬 선택 모달 ──────────────────────────── */
function ScenePickerModal({
  episodes,
  episodeTitles,
  existingKeys,
  onAdd,
  onClose,
}: {
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  existingKeys: Set<SceneKey>;
  onAdd: (keys: SceneKey[]) => void;
  onClose: () => void;
}) {
  const [selectedEp, setSelectedEp] = useState<number | null>(episodes[0]?.episodeNumber ?? null);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pickedKeys, setPickedKeys] = useState<Set<SceneKey>>(new Set());

  const ep = episodes.find((e) => e.episodeNumber === selectedEp);
  const parts = ep?.parts ?? [];

  useEffect(() => {
    if (parts.length > 0 && !parts.find((p) => p.sheetName === selectedPart)) {
      setSelectedPart(parts[0].sheetName);
    }
  }, [selectedEp]);

  const currentPart = parts.find((p) => p.sheetName === selectedPart);
  const scenes = currentPart?.scenes ?? [];
  const filtered = search
    ? scenes.filter((s) => s.sceneId.toLowerCase().includes(search.toLowerCase()) || s.assignee.toLowerCase().includes(search.toLowerCase()))
    : scenes;

  const toggle = (key: SceneKey) => {
    setPickedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-bg-card border border-bg-border/50 rounded-2xl shadow-2xl w-[520px] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/30">
          <span className="text-sm font-semibold text-text-primary">씬 추가</span>
          <button onClick={onClose} className="p-1 hover:bg-bg-border/20 rounded-md cursor-pointer"><X size={16} /></button>
        </div>

        {/* 에피소드 / 파트 선택 */}
        <div className="flex gap-2 px-4 py-2 border-b border-bg-border/20">
          <select
            value={selectedEp ?? ''}
            onChange={(e) => setSelectedEp(Number(e.target.value))}
            className="bg-bg-primary border border-bg-border rounded-lg px-2 py-1 text-xs text-text-primary flex-1"
          >
            {episodes.map((ep) => (
              <option key={ep.episodeNumber} value={ep.episodeNumber}>
                {episodeTitles[ep.episodeNumber] || `EP.${String(ep.episodeNumber).padStart(2, '0')}`}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {parts.map((p) => (
              <button
                key={p.sheetName}
                onClick={() => setSelectedPart(p.sheetName)}
                className={cn(
                  'px-2 py-1 text-[10px] rounded-md font-medium cursor-pointer transition-colors',
                  selectedPart === p.sheetName ? 'bg-accent/20 text-accent' : 'text-text-secondary/50 hover:text-text-primary border border-bg-border/50',
                )}
              >
                {p.partId}파트 ({DEPARTMENT_CONFIGS[p.department].shortLabel})
              </button>
            ))}
          </div>
        </div>

        {/* 검색 */}
        <div className="px-4 py-2">
          <div className="flex items-center gap-2 bg-bg-primary border border-bg-border rounded-lg px-2 py-1.5">
            <Search size={12} className="text-text-secondary/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="씬 검색..."
              className="bg-transparent text-xs text-text-primary flex-1 outline-none placeholder:text-text-secondary/30"
            />
          </div>
        </div>

        {/* 씬 목록 */}
        <div className="flex-1 overflow-auto px-4 pb-2">
          <div className="grid grid-cols-1 gap-1">
            {filtered.map((s) => {
              const key = makeKey(currentPart!.sheetName, s.sceneId);
              const alreadyExists = existingKeys.has(key);
              const picked = pickedKeys.has(key);
              const pct = scenePct(s);
              return (
                <div
                  key={s.sceneId}
                  onClick={() => !alreadyExists && toggle(key)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
                    alreadyExists ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-bg-border/10',
                    picked && 'bg-accent/10 ring-1 ring-accent/30',
                  )}
                >
                  <div className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0',
                    picked ? 'bg-accent border-accent text-white' : 'border-bg-border/50',
                  )}>
                    {picked && <Check size={10} />}
                  </div>
                  <span className="text-xs font-mono font-bold text-accent shrink-0">#{s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || s.no}</span>
                  <span className="text-xs text-text-primary truncate">{s.sceneId}</span>
                  {s.assignee && <span className="text-[10px] text-text-secondary/50 shrink-0">{s.assignee}</span>}
                  <span className="ml-auto text-[10px] tabular-nums shrink-0" style={{ color: pct >= 100 ? '#00B894' : pct >= 50 ? '#FDCB6E' : '#8B8DA3' }}>
                    {Math.round(pct)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 하단 액션 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-bg-border/30">
          <span className="text-[11px] text-text-secondary/50">{pickedKeys.size}개 선택됨</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-bg-border/50 text-text-secondary hover:text-text-primary cursor-pointer">취소</button>
            <button
              onClick={() => { onAdd(Array.from(pickedKeys)); onClose(); }}
              disabled={pickedKeys.size === 0}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer transition-colors',
                pickedKeys.size > 0 ? 'bg-accent text-white hover:bg-accent/90' : 'bg-bg-border/30 text-text-secondary/40 cursor-not-allowed',
              )}
            >
              추가
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── 메인 위젯 ─────────────────────────────── */
export function MyTasksWidget() {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const toggleSceneStage = useDataStore((s) => s.toggleSceneStage);
  const updateSceneFieldOptimistic = useDataStore((s) => s.updateSceneFieldOptimistic);
  const currentUser = useAuthStore((s) => s.currentUser);
  const sheetsConnected = useAppStore((s) => s.sheetsConnected);
  const isPopup = useContext(IsPopupContext);

  // 뷰 관리
  const [customViews, setCustomViews] = useState<TaskView[]>(() => loadViews());
  const [activeViewId, setActiveViewId] = useState(DEFAULT_VIEW.id);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [editingViewName, setEditingViewName] = useState<string | null>(null);
  const [newViewName, setNewViewName] = useState('');
  const [filterDone, setFilterDone] = useState(false);

  const allViews = [DEFAULT_VIEW, ...customViews];
  const activeView = allViews.find((v) => v.id === activeViewId) ?? DEFAULT_VIEW;

  // 커스텀 뷰 저장
  useEffect(() => { saveViews(customViews); }, [customViews]);

  // 전체 평탄화된 씬
  const allFlat: FlatScene[] = useMemo(() => {
    const result: FlatScene[] = [];
    for (const ep of episodes) {
      for (const part of ep.parts) {
        part.scenes.forEach((scene, idx) => {
          result.push({
            scene,
            sheetName: part.sheetName,
            sceneIndex: idx,
            episodeNumber: ep.episodeNumber,
            partId: part.partId,
            department: part.department,
            key: makeKey(part.sheetName, scene.sceneId),
          });
        });
      }
    }
    return result;
  }, [episodes]);

  // 현재 뷰의 씬 목록
  const visibleScenes = useMemo(() => {
    let result: FlatScene[];
    if (activeView.type === 'assigned') {
      const name = currentUser?.name ?? '';
      result = name ? allFlat.filter((f) => f.scene.assignee === name) : [];
    } else {
      const keys = new Set(activeView.sceneKeys);
      result = allFlat.filter((f) => keys.has(f.key));
    }
    if (filterDone) {
      result = result.filter((f) => scenePct(f.scene) < 100);
    }
    // 정렬: 에피소드 → 파트 → 씬번호
    return result.sort((a, b) => {
      if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
      if (a.partId !== b.partId) return a.partId.localeCompare(b.partId);
      const aNum = parseInt(a.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
      const bNum = parseInt(b.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
      return aNum - bNum;
    });
  }, [activeView, allFlat, currentUser, filterDone]);

  // 통계
  const stats = useMemo(() => {
    const total = visibleScenes.length;
    const stages = total * 4;
    const checked = visibleScenes.reduce((s, f) => s + [f.scene.lo, f.scene.done, f.scene.review, f.scene.png].filter(Boolean).length, 0);
    const fullyDone = visibleScenes.filter((f) => scenePct(f.scene) >= 100).length;
    return { total, fullyDone, pct: stages > 0 ? (checked / stages) * 100 : 0 };
  }, [visibleScenes]);

  // 단계 토글 핸들러 (실제 데이터에 반영)
  const handleToggle = useCallback(async (flat: FlatScene, stage: Stage) => {
    const { sheetName, scene, sceneIndex } = flat;
    const newValue = !scene[stage];

    // 낙관적 업데이트
    toggleSceneStage(sheetName, scene.sceneId, stage);

    // 완료 기록
    let completedBy: string | undefined;
    let completedAt: string | undefined;
    if (newValue) {
      const afterToggle = { ...scene, [stage]: true };
      if (afterToggle.lo && afterToggle.done && afterToggle.review && afterToggle.png) {
        completedBy = currentUser?.name ?? '알 수 없음';
        completedAt = new Date().toISOString();
        updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', completedBy);
        updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', completedAt);
      }
    }

    // 시트 동기화
    try {
      if (sheetsConnected) {
        const { updateSheetCell, updateSceneFieldInSheets } = await import('@/services/sheetsService');
        await updateSheetCell(sheetName, sceneIndex, stage, newValue);
        // 완료 기록도 시트에 반영
        if (completedBy) {
          await updateSceneFieldInSheets(sheetName, sceneIndex, 'completedBy', completedBy).catch(() => {});
          await updateSceneFieldInSheets(sheetName, sceneIndex, 'completedAt', completedAt!).catch(() => {});
        }
        window.electronAPI?.sheetsNotifyChange?.();
      }
    } catch (err) {
      console.error('[MyTasks 토글 실패]', err);
      toggleSceneStage(sheetName, scene.sceneId, stage); // 롤백
    }
  }, [toggleSceneStage, updateSceneFieldOptimistic, currentUser, sheetsConnected]);

  // 커스텀 뷰 생성
  const createCustomView = () => {
    const id = `view_${Date.now()}`;
    const view: TaskView = { id, name: '새 할일 목록', type: 'custom', sceneKeys: [] };
    setCustomViews((prev) => [...prev, view]);
    setActiveViewId(id);
    setEditingViewName(id);
    setNewViewName('새 할일 목록');
    setShowViewMenu(false);
  };

  // 커스텀 뷰 이름 저장
  const saveViewName = () => {
    if (editingViewName && newViewName.trim()) {
      setCustomViews((prev) => prev.map((v) => v.id === editingViewName ? { ...v, name: newViewName.trim() } : v));
    }
    setEditingViewName(null);
  };

  // 커스텀 뷰에 씬 추가
  const addToView = (keys: SceneKey[]) => {
    setCustomViews((prev) => prev.map((v) =>
      v.id === activeViewId ? { ...v, sceneKeys: [...new Set([...v.sceneKeys, ...keys])] } : v,
    ));
  };

  // 커스텀 뷰에서 씬 제거
  const removeFromView = (key: SceneKey) => {
    setCustomViews((prev) => prev.map((v) =>
      v.id === activeViewId ? { ...v, sceneKeys: v.sceneKeys.filter((k) => k !== key) } : v,
    ));
  };

  // 커스텀 뷰 삭제
  const deleteView = (viewId: string) => {
    setCustomViews((prev) => prev.filter((v) => v.id !== viewId));
    if (activeViewId === viewId) setActiveViewId(DEFAULT_VIEW.id);
    setShowViewMenu(false);
  };

  const existingKeys = useMemo(() => new Set(activeView.sceneKeys), [activeView]);

  return (
    <Widget
      title={activeView.name}
      icon={<CheckSquare size={14} />}
      headerRight={
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterDone(!filterDone)}
            className={cn(
              'p-0.5 cursor-pointer transition-colors',
              filterDone ? 'text-accent' : 'text-text-secondary/40 hover:text-text-secondary',
            )}
            title={filterDone ? '전체 표시' : '미완료만'}
          >
            <ListFilter size={11} />
          </button>

          {/* 뷰 전환 드롭다운 */}
          <div className="relative">
            <button
              onClick={() => setShowViewMenu(!showViewMenu)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium text-text-secondary/50 hover:text-text-primary cursor-pointer rounded transition-colors hover:bg-bg-border/10"
            >
              뷰 <ChevronDown size={9} />
            </button>
            <AnimatePresence>
              {showViewMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 w-48 bg-bg-card border border-bg-border/50 rounded-xl shadow-xl z-50 overflow-hidden"
                >
                  {allViews.map((v) => (
                    <div key={v.id} className="flex items-center group">
                      <button
                        onClick={() => { setActiveViewId(v.id); setShowViewMenu(false); }}
                        className={cn(
                          'flex-1 text-left px-3 py-2 text-xs transition-colors cursor-pointer',
                          activeViewId === v.id ? 'bg-accent/10 text-accent font-medium' : 'text-text-primary hover:bg-bg-border/10',
                        )}
                      >
                        {v.name}
                      </button>
                      {v.type === 'custom' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteView(v.id); }}
                          className="px-2 py-2 text-text-secondary/30 hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-bg-border/30">
                    <button
                      onClick={createCustomView}
                      className="w-full px-3 py-2 text-xs text-accent hover:bg-accent/5 cursor-pointer flex items-center gap-1.5"
                    >
                      <Plus size={10} />
                      새 커스텀 뷰
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      }
    >
      <div className="flex flex-col h-full gap-2">
        {/* 뷰 이름 편집 */}
        {editingViewName && (
          <div className="flex items-center gap-1.5 px-1">
            <Edit3 size={10} className="text-accent shrink-0" />
            <input
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveViewName()}
              onBlur={saveViewName}
              autoFocus
              className="bg-bg-primary border border-accent/30 rounded px-2 py-0.5 text-xs text-text-primary flex-1 outline-none"
              placeholder="뷰 이름"
            />
          </div>
        )}

        {/* 요약 바 */}
        <div className="flex items-center gap-2 px-1">
          <div className="flex-1 h-1.5 rounded-full bg-bg-border/20 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: stats.pct >= 100 ? '#00B894' : stats.pct >= 50 ? '#FDCB6E' : '#6C5CE7' }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(stats.pct, 100)}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-text-secondary/50 shrink-0">
            {stats.fullyDone}/{stats.total} ({Math.round(stats.pct)}%)
          </span>
        </div>

        {/* 씬 리스트 */}
        <div className="flex-1 overflow-auto -mx-1 px-1">
          {visibleScenes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-secondary/40 gap-1">
              <CheckSquare size={24} className="opacity-30" />
              <span className="text-[10px]">
                {activeView.type === 'assigned' ? '할당된 씬이 없습니다' : '씬을 추가해 보세요'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {visibleScenes.map((flat) => {
                const s = flat.scene;
                const pct = scenePct(s);
                const dept = flat.department;
                const deptCfg = DEPARTMENT_CONFIGS[dept];
                const epLabel = episodeTitles[flat.episodeNumber] || `EP.${String(flat.episodeNumber).padStart(2, '0')}`;
                const sceneNum = s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(s.no);

                return (
                  <motion.div
                    key={flat.key}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors group',
                      pct >= 100 ? 'bg-green-500/5 opacity-60' : 'hover:bg-bg-border/8',
                    )}
                  >
                    {/* 씬 정보 */}
                    <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-mono font-bold text-accent shrink-0">#{sceneNum}</span>
                        <span className="text-[10px] text-text-primary truncate">{s.sceneId}</span>
                        <span className="text-[8px] text-text-secondary/30 shrink-0">{epLabel} · {flat.partId}</span>
                      </div>
                    </div>

                    {/* 단계 체크박스 */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {STAGES.map((stage) => {
                        const checked = s[stage];
                        const color = deptCfg.stageColors[stage];
                        return (
                          <button
                            key={stage}
                            onClick={() => handleToggle(flat, stage)}
                            title={deptCfg.stageLabels[stage]}
                            className={cn(
                              'w-5 h-5 rounded text-[7px] font-bold flex items-center justify-center cursor-pointer transition-all',
                              checked
                                ? 'text-white shadow-sm'
                                : 'border text-text-secondary/30 hover:text-text-secondary/60',
                            )}
                            style={checked
                              ? { backgroundColor: color, borderColor: color }
                              : { borderColor: `${color}40` }
                            }
                          >
                            {checked ? <Check size={10} /> : deptCfg.stageLabels[stage][0]}
                          </button>
                        );
                      })}
                    </div>

                    {/* 커스텀 뷰에서 제거 */}
                    {activeView.type === 'custom' && (
                      <button
                        onClick={() => removeFromView(flat.key)}
                        className="p-0.5 text-text-secondary/20 hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* 하단: 할일 추가 버튼 (커스텀 뷰에서만 또는 always) */}
        {activeView.type === 'custom' && (
          <button
            onClick={() => setShowPicker(true)}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[10px] text-accent border border-accent/20 rounded-lg hover:bg-accent/5 cursor-pointer transition-colors"
          >
            <Plus size={11} />
            내 할일 추가
          </button>
        )}
      </div>

      {/* 씬 선택 모달 */}
      <AnimatePresence>
        {showPicker && (
          <ScenePickerModal
            episodes={episodes}
            episodeTitles={episodeTitles}
            existingKeys={existingKeys}
            onAdd={addToView}
            onClose={() => setShowPicker(false)}
          />
        )}
      </AnimatePresence>
    </Widget>
  );
}
