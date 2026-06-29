import { useState, useEffect, useContext, useRef, forwardRef } from 'react';
import { CheckSquare, Plus, X, Search, Check, ListFilter, ExternalLink, ChevronDown, PartyPopper, GripVertical, Calendar } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Widget, IsPopupContext, WidgetIdContext } from './Widget';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { EntityText } from '@/components/common/EntityText';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import { navigateNotificationToScene } from '@/utils/notificationSceneAction';
import { stripEntityTokens } from '@/utils/entityTokens';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEPARTMENT_CONFIGS, STAGES } from '@/types';
import type { Stage, Episode } from '@/types';
import { cn } from '@/utils/cn';
import { createUuid } from '@/utils/createUuid';
import type { SceneKey, PersonalTodo, FlatScene } from './my-tasks/types';
import { makeKey } from './my-tasks/types';
import { useMyTasksData, scenePct } from './my-tasks/hooks/useMyTasksData';
import { ModalPortal } from './my-tasks/components/ModalPortal';
import { TodoDetailModal } from './my-tasks/components/TodoDetailModal';
import { SceneDetailModal } from './my-tasks/components/SceneDetailModal';

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
    onAddPersonalTodo({
      id: createUuid(),
      title: todoTitle.trim(),
      memo: todoMemo.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
      startDate: todoStartDate || undefined,
      endDate: todoEndDate || undefined,
      addToCalendar: todoAddToCalendar || undefined,
    });
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

/* ─── 씬 행 (확정 C) ──────────────────────────────
 * 인라인 메모 편집 제거 → 메모는 읽기 전용 표시. 본문 클릭 시 씬 상세 모달을 연다.
 * 단계 토글·제거·본체 이동 버튼은 독립(stopPropagation)으로 모달을 열지 않는다. */
interface EditableSceneRowProps {
  flat: FlatScene;
  deptCfg: typeof DEPARTMENT_CONFIGS['bg'];
  epLabel: string;
  sceneNum: string;
  pct: number;
  isRemovable: boolean;
  onToggle: (flat: FlatScene, stage: Stage) => void;
  onRemove: (key: SceneKey) => void;
  onOpenDetail: (flat: FlatScene) => void;
  onNavigateToMain: (flat: FlatScene) => void;
}

const EditableSceneRow = forwardRef<HTMLDivElement, EditableSceneRowProps>(function EditableSceneRow({
  flat,
  deptCfg,
  epLabel,
  sceneNum,
  pct,
  isRemovable,
  onToggle,
  onRemove,
  onOpenDetail,
  onNavigateToMain,
}, ref) {
  const s = flat.scene;
  const users = useAuthStore((s) => s.users);

  return (
    <motion.div
      ref={ref}
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
      {/* 씬 정보 — 2줄 구조 (클릭 시 상세 모달) */}
      <button
        type="button"
        onClick={() => onOpenDetail(flat)}
        className="flex flex-col min-w-0 flex-1 gap-0.5 text-left cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-bg-border/10 transition-colors"
        title="클릭하여 상세 보기/편집"
      >
        {/* 1줄: 컨텍스트 (에피소드 > 파트) */}
        <span className="text-[11px] text-text-secondary/40">{epLabel} &gt; {flat.partId}</span>
        {/* 2줄: #번호 sceneId / 메모 (읽기 전용) */}
        <div className="flex items-center gap-1">
          <span className="text-[12px] font-mono text-accent shrink-0">#{sceneNum}</span>
          <span className="text-[14px] font-semibold text-text-primary truncate">
            {s.memo ? <EntityText text={s.memo} userNames={users.map((u) => u.name)} onHashClick={navigateToHashTarget} /> : s.sceneId}
          </span>
        </div>
      </button>

      {/* 미니 프로세스 트랙 */}
      <div className="flex bg-bg-primary rounded-md p-0.5 border border-bg-border gap-0.5 shrink-0">
        {STAGES.map((stage, i) => {
          const checked = s[stage];
          const color = deptCfg.stageColors[stage];
          const isCurrent = checked && (i === STAGES.length - 1 || !s[STAGES[i + 1]]);
          const label = deptCfg.stageLabels[stage][0];
          return (
            <button
              key={stage}
              onClick={(e) => { e.stopPropagation(); onToggle(flat, stage); }}
              title={deptCfg.stageLabels[stage]}
              className={cn(
                'w-6 h-6 rounded text-[11px] font-medium flex items-center justify-center cursor-pointer transition-all',
                !checked && 'text-text-secondary/40 hover:text-text-secondary/70',
              )}
              style={
                isCurrent
                  ? { backgroundColor: color, color: '#000', fontWeight: 700 }
                  : checked
                  ? { backgroundColor: `${color}25`, color }
                  : undefined
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* 본체 이동 / 제거 버튼 */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onNavigateToMain(flat); }}
          className="p-1 text-text-secondary/20 hover:text-accent cursor-pointer rounded transition-all"
          title="본체 앱의 씬 상세로 이동"
        >
          <ExternalLink size={12} />
        </button>
        {isRemovable && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(flat.key); }}
            className="p-1 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded cursor-pointer transition-all"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </motion.div>
  );
});

/* ─── 개인 할일 행 콘텐츠 ──────────────────────── */
/* 확정 B: 날짜·캘린더·제목 편집은 행에서 제거하고 TodoDetailModal 에서만 제공한다.
   행은 읽기 전용 표시 + 본문 클릭 시 상세 모달을 연다(체크박스/삭제/드래그는 독립). */
function PersonalTodoContent({
  todo,
  onToggle,
  onRemove,
  onOpenDetail,
  showDragHandle,
  isHighlighted,
}: {
  todo: PersonalTodo;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  isHighlighted?: boolean;
  onOpenDetail: (todo: PersonalTodo) => void;
  showDragHandle?: boolean;
}) {
  const users = useAuthStore((s) => s.users);

  return (
    <div
      ref={isHighlighted ? (el: HTMLDivElement | null) => { el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } : undefined}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors group',
        todo.completed ? 'bg-green-500/5 opacity-60' : 'hover:bg-bg-border/8',
        isHighlighted && 'ring-1 ring-accent/60 bg-accent/10 animate-pulse',
      )}
    >
      {/* 드래그 핸들 */}
      {showDragHandle && (
        <div className="text-text-secondary/15 hover:text-text-secondary/40 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical size={12} />
        </div>
      )}

      {/* 개인 라벨 */}
      <span className="text-[11px] font-bold text-accent shrink-0">::ᅠ개인</span>

      {/* 제목/메모 — 클릭 시 상세 모달 (확정 B: 날짜·캘린더 UI 미노출) */}
      <button
        type="button"
        onClick={() => onOpenDetail(todo)}
        className="flex flex-col min-w-0 flex-1 gap-0.5 text-left cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-bg-border/10 transition-colors"
        title="클릭하여 상세 보기/편집"
      >
        <span
          className={cn(
            'text-[13px] text-text-primary truncate',
            todo.completed && 'line-through text-text-secondary/50',
          )}
        >
          {todo.title}
        </span>
        {todo.memo && (
          <span className="text-[11px] text-text-secondary/50 truncate"><EntityText text={todo.memo} userNames={users.map((u) => u.name)} onHashClick={navigateToHashTarget} /></span>
        )}
      </button>

      {/* 체크박스 (오른쪽) */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(todo.id); }}
        className={cn(
          'w-5 h-5 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all shrink-0',
          todo.completed
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-bg-border/50 hover:border-accent',
        )}
      >
        {todo.completed && <Check size={10} />}
      </button>

      {/* 삭제 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(todo.id); }}
        className="p-1 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ─── 메인 위젯 ─────────────────────────────── */
export function MyTasksWidget() {
  const isPopup = useContext(IsPopupContext);
  const widgetId = useContext(WidgetIdContext);

  const {
    episodes,
    episodeTitles,
    currentUser,
    loadTimedOut,
    pendingScenes,
    doneScenes,
    pendingPersonalTodos,
    donePersonalTodos,
    stats,
    existingKeys,
    assignedSceneKeySet,
    highlightTodoId,
    handleSceneToggle,
    handleEditField,
    addScenes,
    removeScene,
    addPersonalTodo,
    togglePersonalTodo,
    removePersonalTodo,
    reorderPendingTodos,
    updatePersonalTodo,
  } = useMyTasksData(isPopup);

  const [showPicker, setShowPicker] = useState(false);
  const [filterDone, setFilterDone] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // 상세 모달: id 만 보관하고 실제 todo 는 스토어 목록에서 매 렌더 재추출 → 편집 후 stale 값 방지
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const selectedTodo =
    selectedTodoId == null
      ? null
      : pendingPersonalTodos.find((t) => t.id === selectedTodoId) ??
        donePersonalTodos.find((t) => t.id === selectedTodoId) ??
        null;
  const openTodoDetail = (todo: PersonalTodo) => setSelectedTodoId(todo.id);

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

  // 팝업에서 완료 섹션 접기/펼치기 시 창 크기 조절
  const baseSizeRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!isPopup || !widgetId) return;
    (async () => {
      if (!baseSizeRef.current) {
        const size = await window.electronAPI?.widgetGetSize?.(widgetId);
        if (size) baseSizeRef.current = size;
      }
      if (!baseSizeRef.current) return;
      const base = baseSizeRef.current;
      if (showDone && doneScenes.length > 0) {
        // 완료 항목 수에 따라 높이 증가 (최대 300px 추가)
        const extra = Math.min(doneScenes.length * 36 + 32, 300);
        window.electronAPI?.widgetResize?.(widgetId, base.width, base.height + extra);
      } else {
        window.electronAPI?.widgetResize?.(widgetId, base.width, base.height);
      }
    })();
  }, [showDone, doneScenes.length, isPopup, widgetId]);

  // 행 렌더 헬퍼
  const renderRow = (flat: FlatScene) => {
    const s = flat.scene;
    const pct = scenePct(s);
    const deptCfg = DEPARTMENT_CONFIGS[flat.department];
    const epLabel = episodeTitles[flat.episodeNumber] || `EP.${String(flat.episodeNumber).padStart(2, '0')}`;
    const sceneNum = s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(s.no);
    const isRemovable = assignedSceneKeySet.has(flat.key);
    return (
      <EditableSceneRow
        key={flat.key}
        flat={flat}
        deptCfg={deptCfg}
        epLabel={epLabel}
        sceneNum={sceneNum}
        pct={pct}
        isRemovable={isRemovable}
        onToggle={handleSceneToggle}
        onRemove={removeScene}
        onOpenDetail={openSceneDetail}
        onNavigateToMain={navigateToMainScene}
      />
    );
  };

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

  return (
    <Widget
      title="내 할일"
      icon={<CheckSquare size={14} />}
      headerRight={
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
      }
    >
      <div className="flex flex-col h-full gap-0">
        {/* 요약 바 */}
        <div className="flex items-center gap-2 px-1 pt-2 pb-1">
          <div className="flex-1 h-1.5 rounded-full bg-bg-border/20 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: stats.pct >= 100 ? '#00B894' : stats.pct >= 50 ? '#FDCB6E' : '#6C5CE7' }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(stats.pct, 100)}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-text-secondary/50 shrink-0">
            {stats.fullyDone}/{stats.total} ({Math.round(stats.pct)}%)
          </span>
        </div>

        {/* 메인 리스트 */}
        <div className="flex-1 overflow-auto -mx-1 px-1">
          {/* 진행 중 항목 */}
          {pendingScenes.length === 0 && pendingPersonalTodos.length === 0 && doneScenes.length === 0 && donePersonalTodos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-secondary/40 gap-1">
              <CheckSquare size={24} className="opacity-30" />
              <span className="text-[11px]">할당된 씬이 없습니다</span>
            </div>
          ) : (
            <>
              {pendingScenes.length === 0 && pendingPersonalTodos.length === 0 && (doneScenes.length > 0 || donePersonalTodos.length > 0) && (
                <div className="flex flex-col items-center justify-center py-4 text-text-secondary/40 gap-1">
                  <PartyPopper size={20} className="opacity-40 text-green-400" />
                  <span className="text-[11px] text-green-400/60">모든 할일 완료!</span>
                </div>
              )}
              <AnimatePresence mode="popLayout">
                {pendingScenes.map(renderRow)}
              </AnimatePresence>
              {pendingPersonalTodos.length > 0 && (
                <Reorder.Group axis="y" values={pendingPersonalTodos} onReorder={reorderPendingTodos} className="list-none p-0 m-0">
                  {pendingPersonalTodos.map((todo) => (
                    <Reorder.Item key={todo.id} value={todo} className="list-none">
                      <PersonalTodoContent todo={todo} onToggle={togglePersonalTodo} onRemove={removePersonalTodo} onOpenDetail={openTodoDetail} showDragHandle isHighlighted={highlightTodoId === todo.id} />
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}

              {/* ─── 완료된 항목 섹션 ─── */}
              {(doneScenes.length > 0 || donePersonalTodos.length > 0) && !filterDone && (
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
                      {doneScenes.length + donePersonalTodos.length}
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
                          <AnimatePresence mode="popLayout">
                            {doneScenes.map(renderRow)}
                          </AnimatePresence>
                          {donePersonalTodos.map((todo) => (
                            <PersonalTodoContent key={todo.id} todo={todo} onToggle={togglePersonalTodo} onRemove={removePersonalTodo} onOpenDetail={openTodoDetail} isHighlighted={highlightTodoId === todo.id} />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </div>

        {/* 할일 추가 버튼 */}
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] text-text-secondary/50 border border-dashed border-bg-border rounded-lg hover:border-accent hover:text-accent hover:bg-accent/5 cursor-pointer transition-colors mt-1"
        >
          <Plus size={11} />
          내 할일 추가
        </button>
      </div>

      <AnimatePresence>
        {showPicker && (
          <AddTaskModal
            episodes={episodes}
            episodeTitles={episodeTitles}
            existingKeys={existingKeys}
            defaultMode="personal"
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
            onUpdate={updatePersonalTodo}
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
