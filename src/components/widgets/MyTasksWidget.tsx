import { useState, useEffect, useContext, useRef } from 'react';
import { CheckSquare, Plus, X, Search, Check, ListFilter, ChevronDown, PartyPopper, Calendar, List, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Widget, IsPopupContext, WidgetIdContext } from './Widget';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { navigateNotificationToScene } from '@/utils/notificationSceneAction';
import { stripEntityTokens } from '@/utils/entityTokens';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { Episode, Stage } from '@/types';
import { cn } from '@/utils/cn';
import { createUuid } from '@/utils/createUuid';
import type { CharacterTaskItem, SceneKey, PersonalTodo, FlatScene } from './my-tasks/types';
import { makeKey } from './my-tasks/types';
import { createPersonalTodo } from './my-tasks/personalTodoDomain';
import { useMyTasksData, scenePct } from './my-tasks/hooks/useMyTasksData';
import { ModalPortal } from './my-tasks/components/ModalPortal';
import { TodoDetailModal } from './my-tasks/components/TodoDetailModal';
import { SceneDetailModal } from './my-tasks/components/SceneDetailModal';
import { DonutHero } from './my-tasks/components/DonutHero';
import { QuickAdd } from './my-tasks/components/QuickAdd';
import { SceneRow } from './my-tasks/components/SceneRow';
import { SceneCard } from './my-tasks/components/SceneCard';
import { TodoCard } from './my-tasks/components/TodoCard';
import { PinnedTodoSection } from './my-tasks/components/PinnedTodoSection';
import { SortableTodoRow, TodoRow } from './my-tasks/components/TodoRow';
import type { PersonalTodoSyncState } from './my-tasks/components/TodoMetadata';
import { CharacterTaskCard, CharacterTaskRow } from './my-tasks/components/CharacterTaskRow';
import { Confetti } from './my-tasks/components/Confetti';
import { useMotionPref } from './my-tasks/useMotion';
import { clampStaggerDelay } from './my-tasks/motionUtils';

/* ─── 할 일 추가 모달 (작업 + 개인) ──────────── */
function AddTaskModal({
  episodes,
  episodeTitles,
  existingKeys,
  defaultMode,
  onAddScenes,
  onAddPersonalTodo,
  onClose,
}: {
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  existingKeys: Set<SceneKey>;
  defaultMode: 'scene' | 'personal';
  onAddScenes: (keys: SceneKey[]) => void;
  onAddPersonalTodo: (todo: PersonalTodo) => void;
  onClose: () => void;
}) {
  const colorMode = useAppStore((s) => s.colorMode);
  const [mode, setMode] = useState<'scene' | 'personal'>(defaultMode);

  // 씬 선택 상태
  const [selectedEp, setSelectedEp] = useState<number | null>(episodes[0]?.episodeNumber ?? null);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pickedKeys, setPickedKeys] = useState<Set<SceneKey>>(new Set());

  // 개인 할일 상태
  const [todoTitle, setTodoTitle] = useState('');
  const [todoMemo, setTodoMemo] = useState('');
  const users = useAuthStore((s) => s.users);
  const [todoStartDate, setTodoStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [todoEndDate, setTodoEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [todoAddToCalendar, setTodoAddToCalendar] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const ep = episodes.find((e) => e.episodeNumber === selectedEp);
  const parts = ep?.parts ?? [];

  useEffect(() => {
    if (parts.length > 0 && !parts.find((p) => p.sheetName === selectedPart)) {
      setSelectedPart(parts[0].sheetName);
    }
  }, [selectedEp]);

  // 개인 탭 전환 시 제목 필드 포커스
  useEffect(() => {
    if (mode === 'personal') setTimeout(() => titleRef.current?.focus(), 100);
  }, [mode]);

  const currentPart = parts.find((p) => p.sheetName === selectedPart);
  const scenes = currentPart?.scenes ?? [];
  const searchLower = search.toLowerCase();
  const filtered = search
    ? scenes.filter((s) =>
        s.sceneId.toLowerCase().includes(searchLower) ||
        s.assignee.toLowerCase().includes(searchLower) ||
        s.memo.toLowerCase().includes(searchLower))
    : scenes;

  const toggle = (key: SceneKey) => {
    setPickedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleAddPersonalTodo = () => {
    if (!todoTitle.trim()) return;
    onAddPersonalTodo(createPersonalTodo({
      id: createUuid(),
      title: todoTitle.trim(),
      memo: todoMemo.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
      startDate: todoStartDate || undefined,
      endDate: todoEndDate || undefined,
      addToCalendar: todoAddToCalendar || undefined,
    }));
    onClose();
  };

  return (
    <ModalPortal onClose={onClose} labelledBy="add-task-title">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/30">
          <span id="add-task-title" className="text-sm font-semibold text-text-primary">할 일 추가</span>
          <button onClick={onClose} className="p-1 hover:bg-bg-border/20 rounded-md cursor-pointer"><X size={16} /></button>
        </div>

        {/* 탭 - 항상 작업 + 개인 둘 다 표시 */}
        <div className="flex gap-1 px-4 py-2 border-b border-bg-border/20">
          <button
            onClick={() => setMode('scene')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer transition-colors',
              mode === 'scene' ? 'bg-accent/15 text-accent' : 'text-text-secondary/50 hover:text-text-primary',
            )}
          >
            작업
          </button>
          <button
            onClick={() => setMode('personal')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer transition-colors',
              mode === 'personal' ? 'bg-accent/15 text-accent' : 'text-text-secondary/50 hover:text-text-primary',
            )}
          >
            개인
          </button>
        </div>

        {mode === 'scene' ? (
          <>
            {/* 에피소드/파트 선택 */}
            <div className="flex gap-2 px-4 py-2 border-b border-bg-border/20">
              <select
                value={selectedEp ?? ''}
                onChange={(e) => setSelectedEp(Number(e.target.value))}
                className="bg-bg-primary border border-bg-border rounded-lg px-2 py-1 text-xs text-text-primary flex-1"
              >
                {episodes.map((ep) => (
                  <option key={ep.episodeNumber} value={ep.episodeNumber}>
                    {episodeTitles[ep.episodeNumber] || ep.title || `EP.${String(ep.episodeNumber).padStart(2, '0')}`}
                  </option>
                ))}
              </select>
              <select
                value={selectedPart ?? ''}
                onChange={(e) => setSelectedPart(e.target.value)}
                className="bg-bg-primary border border-bg-border rounded-lg px-2 py-1 text-xs text-text-primary"
              >
                {parts.map((p) => (
                  <option key={p.sheetName} value={p.sheetName}>
                    {p.partId}파트 ({DEPARTMENT_CONFIGS[p.department].shortLabel})
                  </option>
                ))}
              </select>
            </div>
            {/* 검색 */}
            <div className="px-4 py-2">
              <div className="flex items-center gap-2 bg-bg-primary border border-bg-border rounded-lg px-2 py-1.5">
                <Search size={12} className="text-text-secondary/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="씬 검색 (씬번호, 담당자, 메모)..."
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
                        'w-4 h-4 rounded border flex items-center justify-center text-[11px] shrink-0',
                        picked ? 'bg-accent border-accent text-white' : 'border-bg-border/50',
                      )}>
                        {picked && <Check size={10} />}
                      </div>
                      <span className="text-xs font-mono font-bold text-accent shrink-0">#{s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || s.no}</span>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs text-text-primary truncate">{s.sceneId}</span>
                        {s.memo && <span className="text-[10px] text-text-secondary/40 truncate">{stripEntityTokens(s.memo)}</span>}
                      </div>
                      {s.assignee && <span className="text-[11px] text-text-secondary/50 shrink-0">{s.assignee}</span>}
                      <span className="ml-auto text-[11px] tabular-nums shrink-0" style={{ color: pct >= 100 ? '#00B894' : pct >= 50 ? '#FDCB6E' : '#8B8DA3' }}>
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
                  onClick={() => { onAddScenes(Array.from(pickedKeys)); onClose(); }}
                  disabled={pickedKeys.size === 0}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer transition-colors',
                    pickedKeys.size > 0 ? 'bg-accent text-on-accent hover:bg-accent/90' : 'bg-bg-border/30 text-text-secondary/40 cursor-not-allowed',
                  )}
                >
                  추가
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 개인 할일 폼 */}
            <div className="flex flex-col gap-3 px-4 py-4 flex-1 overflow-auto">
              <div>
                <label className="text-[11px] text-text-secondary/60 mb-1.5 block">제목</label>
                <input
                  ref={titleRef}
                  value={todoTitle}
                  onChange={(e) => setTodoTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && todoTitle.trim()) handleAddPersonalTodo(); }}
                  placeholder="할 일을 입력하세요"
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent/50 placeholder:text-text-secondary/30"
                />
              </div>
              <div>
                <label className="text-[11px] text-text-secondary/60 mb-1.5 block">메모</label>
                <EntityAwareInput
                  multiline
                  value={todoMemo}
                  onChange={setTodoMemo}
                  users={users}
                  /* #태그 끔: 할일 메모는 캘린더 일정과 동기화돼(addToCalendar) ScheduleView·CalendarView 등
                     평문 경로로 표시되므로 직렬화 토큰('[#a001](...)')이 노출된다(캘린더 메모와 동일 정책). */
                  placeholder="메모 (선택)"
                  rows={2}
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent/50 placeholder:text-text-secondary/30 resize-none"
                />
              </div>
              {/* 일정 */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-text-secondary/60 tracking-wider block mb-1">시작일</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={todoStartDate}
                      onChange={(e) => setTodoStartDate(e.target.value)}
                      className="w-full bg-bg-card border-2 border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 date-picker-hidden"
                      style={{ colorScheme: colorMode }}
                    />
                    <Calendar size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-text-secondary/60 tracking-wider block mb-1">종료일</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={todoEndDate}
                      onChange={(e) => setTodoEndDate(e.target.value)}
                      className="w-full bg-bg-card border-2 border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 date-picker-hidden"
                      style={{ colorScheme: colorMode }}
                    />
                    <Calendar size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
                  </div>
                </div>
              </div>
              {/* 캘린더 연동 */}
              <button
                type="button"
                onClick={() => setTodoAddToCalendar(!todoAddToCalendar)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-2 transition-all cursor-pointer',
                  todoAddToCalendar
                    ? 'border-[#6C5CE7] bg-[#6C5CE7]/15 text-[#6C5CE7]'
                    : 'border-bg-border/60 text-text-secondary/60 hover:text-[#6C5CE7] hover:border-[#6C5CE7]/30 hover:bg-[#6C5CE7]/5',
                )}
              >
                <Calendar size={16} className={todoAddToCalendar ? 'text-[#6C5CE7]' : ''} />
                <span className="text-xs font-semibold">캘린더에 추가</span>
                <div className={cn(
                  'ml-auto w-9 h-[20px] rounded-full transition-colors relative',
                  todoAddToCalendar ? 'bg-[#6C5CE7]' : 'bg-bg-border/40',
                )}>
                  <motion.div
                    className="absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white shadow-sm"
                    animate={{ left: todoAddToCalendar ? 18 : 3 }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
              </button>
            </div>
            {/* 하단 액션 */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-bg-border/30">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-bg-border/50 text-text-secondary hover:text-text-primary cursor-pointer">취소</button>
              <button
                onClick={handleAddPersonalTodo}
                disabled={!todoTitle.trim()}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer transition-colors',
                  todoTitle.trim() ? 'bg-accent text-on-accent hover:bg-accent/90' : 'bg-bg-border/30 text-text-secondary/40 cursor-not-allowed',
                )}
              >
                추가
              </button>
            </div>
          </>
        )}
    </ModalPortal>
  );
}

/** 카드 뷰 그리드 컬럼 — 280px 팝업(가용 ~248px)서 1열로 graceful. */
const CARD_GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' } as const;

/* ─── 메인 위젯 ─────────────────────────────── */
export function MyTasksWidget() {
  const isPopup = useContext(IsPopupContext);
  const widgetId = useContext(WidgetIdContext);

  const {
    episodes,
    episodeTitles,
    currentUser,
    loadTimedOut,
    allFlat,
    pendingScenes,
    doneScenes,
    pendingPersonalTodos,
    donePersonalTodos,
    activePersonalTodos,
    personalTodoLabels,
    pendingLabelIds,
    pinnedPersonalTodos,
    normalPersonalTodos,
    personalTodoSyncState,
    pendingCharacterTasks,
    doneCharacterTasks,
    stats,
    existingKeys,
    assignedSceneKeySet,
    highlightTodoId,
    handleSceneToggle,
    handleEditField,
    addScenes,
    removeScene,
    addPersonalTodo,
    removePersonalTodo,
    reorderPendingTodos,
    reorderPinnedTodos,
    updatePersonalTodo,
    setPersonalTodoStatus,
    setPersonalTodoPinned,
    createAndAttachPersonalTodoLabel,
    updatePersonalTodoLabel,
    retryPersonalTodoSync,
  } = useMyTasksData(isPopup);
  const setView = useAppStore((s) => s.setView);
  const setPendingCharacterBoardRequest = useAppStore((s) => s.setPendingCharacterBoardRequest);

  const [showPicker, setShowPicker] = useState(false);
  const [filterDone, setFilterDone] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [donutCollapsed, setDonutCollapsed] = useState(false);
  // 리스트 ⇄ 카드 뷰. localStorage 1키 영속(체감 큼·저비용). 기본 list.
  const [viewMode, setViewMode] = useState<'list' | 'card'>(() => {
    try { return localStorage.getItem('bflow_mytasks_view_mode') === 'card' ? 'card' : 'list'; } catch { return 'list'; }
  });
  const toggleViewMode = () => setViewMode((v) => {
    const next = v === 'list' ? 'card' : 'list';
    try { localStorage.setItem('bflow_mytasks_view_mode', next); } catch { /* 시크릿모드 등 무시 */ }
    return next;
  });

  // ── PR 5 모션 ──
  const { reduce } = useMotionPref();
  // 진입 stagger 는 '리스트가 처음 렌더되는 시점' 1회만 — 이후(토글/완료이동/리오더 재마운트)는 delay 0(재-stagger 방지).
  // ★mount 가 아니라 currentUser 도착 기준으로 무장: 팝업 콜드스타트(로그인 전 로딩뷰가 먼저 commit)서도
  //   리스트 첫 렌더에 stagger 가 살아있게 한다. (currentUser 없으면 early-return 으로 리스트가 안 그려짐)
  const mountedRef = useRef(false);
  useEffect(() => { if (currentUser) mountedRef.current = true; }, [currentUser]);
  const staggerDelay = (index: number) => clampStaggerDelay(index, reduce || mountedRef.current);

  // 모든 할일 완료 축하 콘페티 — '사용자 완료 토글'이 진행(씬+개인) 0 전이를 일으킨 경우만.
  // 값 변경 부수효과(필터/완료섹션 접기/realtime 삭제/되돌리기)로는 발사하지 않는다. reduce면 생략.
  // celebrateKey 증가로 트리거(매번 remount→재생). 리셋은 발사 effect cleanup 이 아니라 celebrateKey
  // 종속 별도 effect 가 담당 → 1초 내 재렌더로 고착되거나 다음 축하가 유실되지 않는다.
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [completionCommitVersion, setCompletionCommitVersion] = useState(0);
  const userCompleteRef = useRef(false);
  const pendingCompletionRef = useRef(false);
  const prevPendingRef = useRef<number | null>(null);
  const pendingCount = pendingScenes.length + pendingPersonalTodos.length + pendingCharacterTasks.length;
  const doneCount = doneScenes.length + donePersonalTodos.length + doneCharacterTasks.length;
  useEffect(() => {
    const prev = prevPendingRef.current;
    prevPendingRef.current = pendingCount;
    if (prev == null || reduce) return;          // 첫 렌더 스킵(초기 0이어도 발사 안 함) / reduce 생략
    const committedPersonalCompletion = pendingCompletionRef.current && pendingCount === 0;
    const completedSceneWork = userCompleteRef.current && prev > 0 && pendingCount === 0;
    if (committedPersonalCompletion || completedSceneWork) {
      setCelebrateKey((k) => k + 1);
      pendingCompletionRef.current = false;
    }
  }, [pendingCount, completionCommitVersion, reduce]);
  useEffect(() => {
    if (celebrateKey === 0) return;
    const t = setTimeout(() => setCelebrateKey(0), 1000);
    return () => clearTimeout(t);
  }, [celebrateKey]);
  // 사용자 완료 의도를 짧게(~120ms)만 무장(낙관적 업데이트는 즉시 반영). realtime/필터가 겹칠 여지를 줄인다.
  const armCompletion = () => {
    userCompleteRef.current = true;
    setTimeout(() => { userCompleteRef.current = false; }, 120);
  };
  const toggleSceneCelebrate = (flat: FlatScene, stage: Stage) => { armCompletion(); handleSceneToggle(flat, stage); };

  // 상세 모달: id 만 보관하고 실제 todo 는 스토어 목록에서 매 렌더 재추출 → 편집 후 stale 값 방지
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const selectedTodo =
    selectedTodoId == null
      ? null
      : activePersonalTodos.find((t) => t.id === selectedTodoId) ??
        null;
  const openTodoDetail = (todo: PersonalTodo) => setSelectedTodoId(todo.id);
  const resolveTodoLabels = (todo: PersonalTodo) => {
    return personalTodoLabels.filter((label) => todo.labelIds.includes(label.id));
  };
  const handleTodoNextStatus = (todoId: string, status: PersonalTodo['status']) => {
    const wasPending = pendingCount > 0;
    void setPersonalTodoStatus(todoId, status).then((committed) => {
      if (status !== 'done') return;
      pendingCompletionRef.current = committed && wasPending;
      setCompletionCommitVersion((version) => version + 1);
    });
  };
  const handleTodoPinned = (todoId: string, pinned: boolean) => {
    void setPersonalTodoPinned(todoId, pinned);
  };

  // 씬 상세 모달: key 만 보관하고 실제 FlatScene 은 매 렌더 재추출 → 편집/토글 후 stale 값 방지.
  // 목록에서 사라지면(완료 이동/제거) selectedScene 이 null 이 되어 모달이 깔끔히 닫힌다.
  const [selectedSceneKey, setSelectedSceneKey] = useState<SceneKey | null>(null);
  const selectedScene =
    selectedSceneKey == null
      ? null
      : pendingScenes.find((f) => f.key === selectedSceneKey) ??
        doneScenes.find((f) => f.key === selectedSceneKey) ??
        null;
  const openSceneDetail = (flat: FlatScene) => setSelectedSceneKey(flat.key);

  // 본체(메인 앱) 씬 상세로 이동 — 대시보드/팝업 분기.
  // 대시보드: 위젯이 본체와 같은 창에 있으므로 알림 점프와 동일한 경로를 직접 호출.
  // 팝업: 별도 창이므로 본체 창에 점프 신호를 보낸다(본체 App 이 동일 경로로 변환).
  const navigateToMainScene = (flat: FlatScene) => {
    const scene = flat.scene;
    if (isPopup) {
      window.electronAPI?.widgetNavigateMain?.({
        sheetName: flat.sheetName,
        sceneId: scene.sceneId,
        sceneUuid: scene.id ?? '',
        episodeNumber: flat.episodeNumber,
        partId: flat.partId,
      });
    } else {
      navigateNotificationToScene('scene_change', {
        sceneId: scene.id,
        sceneName: scene.sceneId,
        sheetName: flat.sheetName,
      });
    }
    setSelectedSceneKey(null);
  };

  // 개인 할일 → 본체 캘린더(일정)의 해당 날짜로 이동 — 대시보드/팝업 분기 (navigateToMainScene 패턴 미러링).
  // 대시보드: 같은 창이므로 뷰 전환 + 이벤트 디스패치를 직접 수행.
  // 팝업: 별도 창이라 setView·ScheduleView 가 없으므로 본체 창에 점프 신호를 보낸다(본체 App 이 동일 경로로 변환).
  const navigateToCalendar = (todo: PersonalTodo) => {
    if (isPopup) {
      if (todo.startDate) {
        window.electronAPI?.widgetNavigateToDate?.({ date: todo.startDate, todoId: todo.id });
      }
      return;
    }
    setView('schedule');
    if (todo.startDate) {
      // ScheduleView 마운트 후 이벤트 디스패치 (300ms 대기)
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('bflow:navigate-to-date', { detail: { date: todo.startDate, todoId: todo.id } }));
      }, 300);
    }
  };

  const navigateToCharacterTask = (task: CharacterTaskItem) => {
    if (isPopup) return;
    setPendingCharacterBoardRequest({ characterId: task.characterId });
    setView('character-board');
  };

  // QuickAdd 일반 텍스트 → 개인 할일(일정 없이). 훅은 PersonalTodo 객체를 받으므로 어댑터로 변환.
  const handleQuickAddPersonal = (title: string) => {
    const t = title.trim();
    if (!t) return;
    addPersonalTodo(createPersonalTodo({
      id: createUuid(),
      title: t,
      memo: '',
      completed: false,
      createdAt: new Date().toISOString(),
    }));
  };

  // 팝업에서 모달이 하나라도 열려 있는지 — 열려 있으면 창을 모달이 들어갈 만큼 키운다.
  // 원시 ID 가 아니라 라이브 선택 객체로 판단한다: 다른 창에서 해당 항목이 삭제되면
  // selectedTodo/selectedScene 가 null → 모달이 닫히므로, 창 크기 복원 경로가 정상 동작한다.
  const anyModalOpen = showPicker || selectedTodo != null || selectedScene != null;

  // 팝업에서 완료 섹션 접기/펼치기 시 창 크기 조절
  // 모달이 열려 있는 동안에는 아래 모달-리사이즈 effect가 창을 키우므로, 이 effect는 건너뛴다
  // (둘이 같은 창을 서로 다른 크기로 잡으려 다투지 않도록 분리).
  // ★카드 모드(viewMode==='card')에서는 행 높이(36px) 추정이 깨지므로 자동 grow 하지 않고
  //   내부 스크롤에 맡긴다(잘림 없음).
  const baseSizeRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!isPopup || !widgetId || anyModalOpen) return;
    (async () => {
      if (!baseSizeRef.current) {
        const size = await window.electronAPI?.widgetGetSize?.(widgetId);
        if (size) baseSizeRef.current = size;
      }
      if (!baseSizeRef.current) return;
      const base = baseSizeRef.current;
      if (showDone && doneCount > 0 && viewMode === 'list') {
        // 완료 항목 수에 따라 높이 증가 (최대 300px 추가) — 리스트 모드 행 높이(36px) 가정
        const extra = Math.min(doneCount * 36 + 32, 300);
        window.electronAPI?.widgetResize?.(widgetId, base.width, base.height + extra);
      } else {
        window.electronAPI?.widgetResize?.(widgetId, base.width, base.height);
      }
    })();
  }, [showDone, doneCount, isPopup, widgetId, anyModalOpen, viewMode]);

  // 팝업에서 모달이 열릴 때 창이 작으면 모달이 들어갈 만큼 키우고, 닫히면 직전 크기로 복원.
  // (대시보드는 모달이 document.body 포털로 떠 화면 전체를 쓰므로 손대지 않는다 — isPopup 일 때만.)
  // 키우기 직전의 실제 창 크기를 별도 ref에 담아 두고 닫힐 때 정확히 그 크기로 되돌린다 →
  // 완료 섹션 펼침으로 이미 커져 있던 경우에도 baseSizeRef를 건드리지 않고 공존한다.
  const MODAL_MIN_W = 520;
  const MODAL_MIN_H = 640;
  // 위치(x/y)까지 함께 캡처한다 → 화면 가장자리 근처에서 모달 크기로 커지며 창이 안쪽으로
  // 밀린 경우에도, 닫을 때 원래 위치+크기로 정확히 복원해 위젯이 점점 밀리지 않게 한다.
  const preModalBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!isPopup || !widgetId) return;
    (async () => {
      if (anyModalOpen) {
        // 모달 연속 전환(하나 닫고 다른 하나 열기) 시 첫 모달의 pre-modal bounds를 유지.
        if (!preModalBoundsRef.current) {
          const bounds = await window.electronAPI?.widgetGetSize?.(widgetId);
          if (!bounds) return;
          preModalBoundsRef.current = bounds;
          // 현재보다 작을 때만 키운다(사용자가 더 크게 키운 창은 줄이지 않는다).
          const w = Math.max(bounds.width, MODAL_MIN_W);
          const h = Math.max(bounds.height, MODAL_MIN_H);
          if (w !== bounds.width || h !== bounds.height) {
            // 그로우는 위치를 넘기지 않아 메인 핸들러의 화면 클램프가 그대로 적용된다.
            window.electronAPI?.widgetResize?.(widgetId, w, h);
          }
        }
      } else if (preModalBoundsRef.current) {
        // 모든 모달이 닫혔다 → 키우기 직전 위치+크기로 정확히 복원.
        // 원래 화면 안에 있던 좌표이므로 메인 핸들러가 다시 클램프하지 않는다.
        const prev = preModalBoundsRef.current;
        preModalBoundsRef.current = null;
        window.electronAPI?.widgetResize?.(widgetId, prev.width, prev.height, prev.x, prev.y);
      }
    })();
  }, [anyModalOpen, isPopup, widgetId]);

  // 씬 렌더 — viewMode 에 따라 SceneRow(리스트) / SceneCard(카드). index = stagger 진입 delay.
  const renderScene = (flat: FlatScene, index: number) => {
    const s = flat.scene;
    const pct = scenePct(s);
    const deptCfg = DEPARTMENT_CONFIGS[flat.department];
    const epLabel = episodeTitles[flat.episodeNumber] || `EP.${String(flat.episodeNumber).padStart(2, '0')}`;
    const sceneNum = s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(s.no);
    const isRemovable = assignedSceneKeySet.has(flat.key);
    const props = {
      flat, deptCfg, epLabel, sceneNum, pct, isRemovable,
      onToggle: toggleSceneCelebrate,
      onRemove: removeScene,
      onOpenDetail: openSceneDetail,
      onNavigateToMain: navigateToMainScene,
      enterDelay: staggerDelay(index),
      reduce,
    };
    return viewMode === 'card'
      ? <SceneCard key={flat.key} {...props} />
      : <SceneRow key={flat.key} {...props} />;
  };

  // 씬 섹션 컨테이너 — 리스트는 AnimatePresence(popLayout) 행, 카드는 그리드.
  const renderSceneSection = (scenes: FlatScene[]) => {
    if (scenes.length === 0) return null; // 빈 grid wrapper 노드 방지(모드 간 대칭)
    return viewMode === 'card'
      ? <div className="grid gap-2" style={CARD_GRID_STYLE}>{scenes.map(renderScene)}</div>
      : <AnimatePresence mode="popLayout">{scenes.map(renderScene)}</AnimatePresence>;
  };

  const renderCharacterTasks = (tasks: CharacterTaskItem[]) => {
    if (tasks.length === 0) return null;
    const onOpen = isPopup ? undefined : navigateToCharacterTask;
    return viewMode === 'card'
      ? <div className="grid gap-2 mt-2" style={CARD_GRID_STYLE}>
          {tasks.map((task, i) => (
            <CharacterTaskCard key={task.key} task={task} onOpen={onOpen} enterDelay={staggerDelay(i)} reduce={reduce} />
          ))}
        </div>
      : <div className="flex flex-col gap-0.5">
          {tasks.map((task, i) => (
            <CharacterTaskRow key={task.key} task={task} onOpen={onOpen} enterDelay={staggerDelay(i)} reduce={reduce} />
          ))}
        </div>;
  };

  const renderTodoCard = (todo: PersonalTodo, index: number) => (
    <TodoCard
      key={todo.id}
      todo={todo}
      resolvedLabels={resolveTodoLabels(todo)}
      syncState={personalTodoSyncState}
      onNextStatus={handleTodoNextStatus}
      onTogglePinned={handleTodoPinned}
      onRetrySync={retryPersonalTodoSync}
      onDelete={removePersonalTodo}
      onOpen={openTodoDetail}
      isHighlighted={highlightTodoId === todo.id}
      enterDelay={staggerDelay(index)}
      reduce={reduce}
    />
  );

  // 개인 할일(일반) — 고정 할일은 PinnedTodoSection에서 별도 순서를 갖는다.
  const renderPendingTodos = () => {
    if (normalPersonalTodos.length === 0) return null;
    if (viewMode === 'card') {
      return <div className="grid gap-2 mt-2" style={CARD_GRID_STYLE}>{normalPersonalTodos.map(renderTodoCard)}</div>;
    }
    return (
      <Reorder.Group axis="y" values={normalPersonalTodos} onReorder={(next) => { if (personalTodoSyncState !== 'sync-needed') reorderPendingTodos(next); }} className={cn('list-none p-0 m-0', personalTodoSyncState === 'sync-needed' && 'opacity-70')}>
        {normalPersonalTodos.map((todo, index) => (
          <SortableTodoRow
            key={todo.id}
            value={todo}
            todo={todo}
            resolvedLabels={resolveTodoLabels(todo)}
            syncState={personalTodoSyncState}
            onNextStatus={handleTodoNextStatus}
            onTogglePinned={handleTodoPinned}
            onRetrySync={retryPersonalTodoSync}
            onDelete={removePersonalTodo}
            onOpen={openTodoDetail}
            showDragHandle={personalTodoSyncState !== 'sync-needed'}
            isHighlighted={highlightTodoId === todo.id}
            enterDelay={staggerDelay(index)}
            reduce={reduce}
          />
        ))}
      </Reorder.Group>
    );
  };

  // 개인 할일(완료) — 드래그 없음(양 모드 공통).
  const renderDoneTodos = () => {
    if (donePersonalTodos.length === 0) return null; // 빈 grid wrapper 노드 방지(모드 간 대칭)
    return viewMode === 'card'
      ? <div className="grid gap-2" style={CARD_GRID_STYLE}>
          {donePersonalTodos.map(renderTodoCard)}
        </div>
      : <>
          {donePersonalTodos.map((todo, i) => (
            <TodoRow key={todo.id} todo={todo} resolvedLabels={resolveTodoLabels(todo)} syncState={personalTodoSyncState} onNextStatus={handleTodoNextStatus} onTogglePinned={handleTodoPinned} onRetrySync={retryPersonalTodoSync} onDelete={removePersonalTodo} onOpen={openTodoDetail} isHighlighted={highlightTodoId === todo.id} enterDelay={staggerDelay(i)} reduce={reduce} />
          ))}
        </>;
  };
  const sceneTodos = pendingScenes;

  // 플로팅 위젯 창에서 메인 앱 로그인 전 → currentUser가 null인 상태로 렌더될 수 있음
  // (assigned 뷰는 currentUser.name과 assignee 매칭 → 빈 결과 방지 위해 로딩 표시)
  // 10초 이상 로딩되면 메인 앱 로그인 확인 안내로 전환
  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-text-secondary/60 px-4 text-center">
        {loadTimedOut ? (
          <>
            <div>사용자 정보를 불러오지 못했습니다.</div>
            <div className="text-[10px] text-text-secondary/40">메인 앱의 로그인 상태를 확인해주세요.</div>
          </>
        ) : (
          '사용자 정보 로딩 중...'
        )}
      </div>
    );
  }

  const allEmpty =
    pendingScenes.length === 0 && pendingPersonalTodos.length === 0 &&
    pendingCharacterTasks.length === 0 &&
    doneScenes.length === 0 && donePersonalTodos.length === 0 &&
    doneCharacterTasks.length === 0;
  const pendingEmpty = pendingScenes.length === 0 && pendingPersonalTodos.length === 0 && pendingCharacterTasks.length === 0;
  const hasDone = doneScenes.length > 0 || donePersonalTodos.length > 0 || doneCharacterTasks.length > 0;

  return (
    <Widget
      title="내 할일"
      icon={<CheckSquare size={14} />}
      headerRight={
        <>
          <button
            onClick={() => setShowQuickAdd((v) => !v)}
            data-quickadd-toggle
            className={cn(
              'p-0.5 cursor-pointer transition-colors',
              showQuickAdd ? 'text-accent' : 'text-text-secondary/40 hover:text-text-secondary',
            )}
            title="할일 추가"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={toggleViewMode}
            className="p-0.5 text-text-secondary/40 hover:text-text-secondary cursor-pointer transition-colors"
            title={viewMode === 'card' ? '리스트로 보기' : '카드로 보기'}
          >
            {viewMode === 'card' ? <List size={12} /> : <LayoutGrid size={12} />}
          </button>
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
        </>
      }
    >
      <div className="relative flex flex-col h-full gap-0">
        {/* 모든 할일 완료 축하 콘페티 (사용자 완료 토글로 진행 0 전이 시 1회, reduce면 생략) */}
        {!reduce && celebrateKey > 0 && <Confetti key={celebrateKey} />}
        {/* 진행 히어로 (도넛) + 빠른 추가 */}
        <DonutHero
          stats={stats}
          collapsed={donutCollapsed}
          onToggleCollapse={() => setDonutCollapsed((v) => !v)}
          reduce={reduce}
        />
        <AnimatePresence>
          {showQuickAdd && (
            <QuickAdd
              open={showQuickAdd}
              onClose={() => setShowQuickAdd(false)}
              candidates={allFlat}
              episodeTitles={episodeTitles}
              existingKeys={existingKeys}
              currentUserName={currentUser.name}
              onAddScene={(key) => addScenes([key])}
              onAddPersonalTodo={handleQuickAddPersonal}
              onOpenFullPicker={() => { setShowQuickAdd(false); setShowPicker(true); }}
            />
          )}
        </AnimatePresence>

        {/* 메인 리스트 */}
        <div className="flex-1 overflow-auto -mx-1 px-1">
          {allEmpty ? (
            /* 강화 빈 상태 — 리스트 영역 전용(도넛은 자체 빈 표시 유지) */
            <div className="flex flex-col items-center justify-center h-full text-center gap-1.5 px-4">
              <CheckSquare size={26} className="opacity-30 text-text-secondary/40" />
              <span className="text-[12px] font-medium text-text-secondary/55">아직 할 일이 없어요</span>
              <span className="text-[11px] text-text-secondary/40">상단 <span className="text-accent font-semibold">＋</span> 버튼으로 씬이나 메모를 추가하세요</span>
            </div>
          ) : (
            <>
              {/* 진행 중 0 + 완료>0 → 완료 축하 */}
              {pendingEmpty && hasDone && (
                <div className="flex flex-col items-center justify-center py-4 text-text-secondary/40 gap-1">
                  <PartyPopper size={20} className="opacity-40 text-green-400" />
                  <span className="text-[11px] text-green-400/60">모든 할일 완료!</span>
                </div>
              )}

              {/* 진행 중 — 씬 섹션, 개인 섹션(분리) */}
              <PinnedTodoSection
                todos={pinnedPersonalTodos}
                labels={personalTodoLabels}
                syncState={personalTodoSyncState}
                viewMode={viewMode}
                reorderDisabled={personalTodoSyncState === 'sync-needed'}
                onReorder={reorderPinnedTodos}
                onNextStatus={handleTodoNextStatus}
                onTogglePinned={handleTodoPinned}
                onDelete={removePersonalTodo}
                onOpen={openTodoDetail}
                onRetrySync={retryPersonalTodoSync}
                highlightedId={highlightTodoId}
                staggerDelay={staggerDelay}
                reduce={reduce}
              />
              {sceneTodos.length > 0 && (viewMode === 'card'
                ? <div className="grid gap-2" style={CARD_GRID_STYLE}>{sceneTodos.map(renderScene)}</div>
                : <AnimatePresence mode="popLayout">{sceneTodos.map(renderScene)}</AnimatePresence>)}
              {renderCharacterTasks(pendingCharacterTasks)}
              {renderPendingTodos()}

              {/* ─── 완료된 항목 섹션 ─── */}
              {hasDone && !filterDone && (
                <div className="mt-2">
                  {/* 접기/펼치기 토글 */}
                  <button
                    onClick={() => setShowDone(!showDone)}
                    className="flex items-center gap-1.5 w-full px-1 py-1 text-[11px] text-text-secondary/40 hover:text-text-secondary/70 cursor-pointer transition-colors rounded-md hover:bg-bg-border/5"
                  >
                    <motion.div
                      animate={{ rotate: showDone ? 0 : -90 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown size={10} />
                    </motion.div>
                    <span className="font-medium">완료된 항목</span>
                    <span className="text-[9px] tabular-nums bg-bg-primary text-text-secondary/50 border border-bg-border px-1.5 py-0 rounded-full">
                      {doneCount}
                    </span>
                    <div className="flex-1 h-px bg-bg-border/15 ml-1" />
                  </button>

                  {/* 완료 항목 리스트 */}
                  <AnimatePresence>
                    {showDone && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-0.5 pt-1">
                          {renderSceneSection(doneScenes)}
                          {renderCharacterTasks(doneCharacterTasks)}
                          {renderDoneTodos()}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </div>

      </div>

      <AnimatePresence>
        {showPicker && (
          <AddTaskModal
            episodes={episodes}
            episodeTitles={episodeTitles}
            existingKeys={existingKeys}
            defaultMode="scene"
            onAddScenes={addScenes}
            onAddPersonalTodo={addPersonalTodo}
            onClose={() => setShowPicker(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedTodo && (
          <TodoDetailModal
            todo={selectedTodo}
            labels={personalTodoLabels}
            pendingLabelIds={pendingLabelIds}
            onUpdate={updatePersonalTodo}
            onSetStatus={setPersonalTodoStatus}
            onSetPinned={setPersonalTodoPinned}
            onCreateLabel={createAndAttachPersonalTodoLabel}
            onUpdateLabel={updatePersonalTodoLabel}
            onNavigateToCalendar={navigateToCalendar}
            onClose={() => setSelectedTodoId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedScene && (
          <SceneDetailModal
            flat={selectedScene}
            onToggle={handleSceneToggle}
            onEditField={handleEditField}
            onNavigateToMain={navigateToMainScene}
            onClose={() => setSelectedSceneKey(null)}
          />
        )}
      </AnimatePresence>
    </Widget>
  );
}
