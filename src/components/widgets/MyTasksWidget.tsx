import { useState, useMemo, useCallback, useEffect, useContext, useRef, forwardRef } from 'react';
import { CheckSquare, Plus, X, Search, Check, ListFilter, Pencil, ChevronDown, ChevronRight, PartyPopper, GripVertical, Calendar } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Widget, IsPopupContext, WidgetIdContext } from './Widget';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEPARTMENT_CONFIGS, STAGES } from '@/types';
import type { Stage, Scene, Episode, Department } from '@/types';
import { cn } from '@/utils/cn';

/* ─── 타입 ──────────────────────────────────── */

type SceneKey = string;
const makeKey = (sheetName: string, sceneId: string): SceneKey => `${sheetName}:${sceneId}`;

interface PersonalTodo {
  id: string;
  title: string;
  memo: string;
  completed: boolean;
  createdAt: string;
  startDate?: string;
  endDate?: string;
  addToCalendar?: boolean;
}

interface TaskView {
  id: string;
  name: string;
  type: 'assigned' | 'custom';
  sceneKeys: SceneKey[];
  personalTodos: PersonalTodo[];
}

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
const DEFAULT_VIEW: TaskView = { id: '__assigned', name: '내 할일', type: 'assigned', sceneKeys: [], personalTodos: [] };

/* ─── 유틸 ─────────────────────────────────── */
function scenePct(s: Scene): number {
  return ([s.lo, s.done, s.review, s.png].filter(Boolean).length / 4) * 100;
}

/* ─── 커스텀 뷰 퍼시스턴스 ──────────────────── */
const VIEWS_KEY = 'bflow_my_task_views';
const ASSIGNED_TODOS_KEY = 'bflow_assigned_personal_todos';
const ASSIGNED_SCENES_KEY = 'bflow_assigned_scene_keys';

function loadViews(): TaskView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TaskView[];
      return parsed.map((v) => ({ ...v, personalTodos: v.personalTodos ?? [] }));
    }
  } catch {}
  return [];
}
function saveViews(views: TaskView[]) {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}
function loadAssignedTodos(): PersonalTodo[] {
  try {
    const raw = localStorage.getItem(ASSIGNED_TODOS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function saveAssignedTodos(todos: PersonalTodo[]) {
  localStorage.setItem(ASSIGNED_TODOS_KEY, JSON.stringify(todos));
}
function loadAssignedSceneKeys(): SceneKey[] {
  try {
    const raw = localStorage.getItem(ASSIGNED_SCENES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function saveAssignedSceneKeys(keys: SceneKey[]) {
  localStorage.setItem(ASSIGNED_SCENES_KEY, JSON.stringify(keys));
}

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
  const [mode, setMode] = useState<'scene' | 'personal'>(defaultMode);

  // 씬 선택 상태
  const [selectedEp, setSelectedEp] = useState<number | null>(episodes[0]?.episodeNumber ?? null);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pickedKeys, setPickedKeys] = useState<Set<SceneKey>>(new Set());

  // 개인 할일 상태
  const [todoTitle, setTodoTitle] = useState('');
  const [todoMemo, setTodoMemo] = useState('');
  const [todoStartDate, setTodoStartDate] = useState('');
  const [todoEndDate, setTodoEndDate] = useState('');
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
      id: `ptodo_${Date.now()}`,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-bg-card border border-bg-border/50 rounded-2xl shadow-2xl w-[520px] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/30">
          <span className="text-sm font-semibold text-text-primary">할 일 추가</span>
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
                        {s.memo && <span className="text-[10px] text-text-secondary/40 truncate">{s.memo}</span>}
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
                <textarea
                  value={todoMemo}
                  onChange={(e) => setTodoMemo(e.target.value)}
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
                      style={{ colorScheme: 'dark' }}
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
                      style={{ colorScheme: 'dark' }}
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
      </motion.div>
    </div>
  );
}

/* ─── 인라인 편집 행 ──────────────────────────── */
interface EditableSceneRowProps {
  flat: FlatScene;
  deptCfg: typeof DEPARTMENT_CONFIGS['bg'];
  epLabel: string;
  sceneNum: string;
  pct: number;
  isRemovable: boolean;
  onToggle: (flat: FlatScene, stage: Stage) => void;
  onRemove: (key: SceneKey) => void;
  onEditField: (flat: FlatScene, field: string, value: string) => void;
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
  onEditField,
}, ref) {
  const s = flat.scene;
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    if (editingField && editValue !== undefined) {
      const original = editingField === 'assignee' ? s.assignee : editingField === 'memo' ? s.memo : '';
      if (editValue !== original) {
        onEditField(flat, editingField, editValue);
      }
    }
    setEditingField(null);
  };

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
      {/* 씬 정보 */}
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-1">
          <span className="text-[12px] font-mono font-bold text-accent shrink-0">#{sceneNum}</span>
          {editingField === 'memo' ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingField(null); }}
              className="text-[13px] text-text-primary bg-bg-primary border border-accent/30 rounded px-1 py-0 outline-none flex-1 min-w-0"
            />
          ) : (
            <span
              className="text-[13px] text-text-primary truncate cursor-pointer hover:text-accent transition-colors"
              onDoubleClick={() => startEdit('memo', s.memo)}
              title="더블클릭하여 메모 편집"
            >
              {s.memo || s.sceneId}
            </span>
          )}
          <span className="text-[9px] text-text-secondary/30 shrink-0">{epLabel} · {flat.partId}</span>
        </div>
        {/* 담당자 */}
        <div className="flex items-center gap-1">
          {editingField === 'assignee' ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingField(null); }}
              className="text-[10px] text-text-secondary bg-bg-primary border border-accent/30 rounded px-1 py-0 outline-none w-16"
            />
          ) : (
            <span
              className="text-[10px] text-text-secondary/40 cursor-pointer hover:text-text-secondary transition-colors"
              onDoubleClick={() => startEdit('assignee', s.assignee)}
              title="더블클릭하여 담당자 편집"
            >
              {s.assignee || '미배정'}
            </span>
          )}
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
              onClick={() => onToggle(flat, stage)}
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

      {/* 커스텀 뷰 제거 / 편집 버튼 */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!editingField && (
          <button
            onClick={() => startEdit('memo', s.memo)}
            className="p-0.5 text-text-secondary/20 hover:text-accent cursor-pointer"
            title="편집"
          >
            <Pencil size={9} />
          </button>
        )}
        {isRemovable && (
          <button
            onClick={() => onRemove(flat.key)}
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
function PersonalTodoContent({
  todo,
  onToggle,
  onRemove,
  showDragHandle,
}: {
  todo: PersonalTodo;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  showDragHandle?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors group',
        todo.completed ? 'bg-green-500/5 opacity-60' : 'hover:bg-bg-border/8',
      )}
    >
      {/* 드래그 핸들 */}
      {showDragHandle && (
        <div className="text-text-secondary/15 hover:text-text-secondary/40 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical size={12} />
        </div>
      )}

      {/* 개인 라벨 (씬 번호 자리) */}
      <span className="text-[12px] font-bold text-accent shrink-0">개인</span>

      {/* 제목/메모 */}
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <span className={cn(
          'text-[13px] text-text-primary truncate',
          todo.completed && 'line-through text-text-secondary/50',
        )}>
          {todo.title}
        </span>
        {todo.memo && (
          <span className="text-[11px] text-text-secondary/50 truncate">{todo.memo}</span>
        )}
        {(todo.startDate || todo.endDate) && (
          <div className="flex items-center gap-1 text-[9px] text-text-secondary/40">
            <Calendar size={8} />
            <span>
              {todo.startDate && new Date(todo.startDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
              {todo.startDate && todo.endDate && ' ~ '}
              {todo.endDate && new Date(todo.endDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}
      </div>

      {/* 체크박스 (오른쪽) */}
      <button
        onClick={() => onToggle(todo.id)}
        className={cn(
          'w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all shrink-0',
          todo.completed
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-bg-border/50 hover:border-accent/50',
        )}
      >
        {todo.completed && <Check size={10} />}
      </button>

      {/* 삭제 */}
      <button
        onClick={() => onRemove(todo.id)}
        className="p-1 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ─── Windows 11 스타일 탭 바 ────────────────── */
function TabBar({
  views,
  activeViewId,
  onSelect,
  onClose,
  onCreate,
  onRename,
}: {
  views: TaskView[];
  activeViewId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex items-end gap-0 min-h-[28px] -mb-px overflow-x-auto scrollbar-hide">
      {views.map((v) => {
        const isActive = v.id === activeViewId;
        const isEditing = editingId === v.id;

        return (
          <div
            key={v.id}
            className={cn(
              'flex items-center gap-1 pl-2.5 pr-1 py-1 text-[11px] font-medium cursor-pointer transition-all relative group shrink-0',
              'rounded-t-lg border border-b-0',
              isActive
                ? 'bg-bg-card border-bg-border/40 text-text-primary z-10'
                : 'bg-transparent border-transparent text-text-secondary/40 hover:text-text-secondary/70 hover:bg-bg-border/10',
            )}
            onClick={() => onSelect(v.id)}
            onDoubleClick={() => v.type === 'custom' && startRename(v.id, v.name)}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] bg-transparent outline-none border-b border-accent/50 w-16 text-text-primary"
              />
            ) : (
              <span className="truncate max-w-[80px]">{v.name}</span>
            )}
            {v.type === 'custom' && !isEditing && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(v.id); }}
                className={cn(
                  'p-0.5 rounded-sm transition-all shrink-0',
                  isActive
                    ? 'text-text-secondary/30 hover:text-text-secondary hover:bg-bg-border/20'
                    : 'text-transparent group-hover:text-text-secondary/20 hover:!text-text-secondary hover:bg-bg-border/20',
                )}
              >
                <X size={8} />
              </button>
            )}
            {/* 활성 탭 하단 선 */}
            {isActive && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full"
              />
            )}
          </div>
        );
      })}

      {/* + 새 탭 버튼 */}
      <button
        onClick={onCreate}
        className="flex items-center justify-center w-6 h-6 text-text-secondary/30 hover:text-accent hover:bg-bg-border/10 rounded-lg cursor-pointer transition-colors shrink-0 ml-0.5"
        title="새 커스텀 뷰"
      >
        <Plus size={11} />
      </button>
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
  const isPopup = useContext(IsPopupContext);
  const widgetId = useContext(WidgetIdContext);

  // 시트 변경 알림: 팝업에서는 쿨다운 래퍼, 대시보드에서는 직접 호출
  const notifyChange = useCallback(async () => {
    if (isPopup) {
      const { notifySheetChangeWithCooldown } = await import('@/views/WidgetPopup');
      return notifySheetChangeWithCooldown();
    }
    return window.electronAPI?.sheetsNotifyChange?.();
  }, [isPopup]);

  // 뷰 관리
  const [customViews, setCustomViews] = useState<TaskView[]>(() => loadViews());
  const [activeViewId, setActiveViewId] = useState(DEFAULT_VIEW.id);
  const [showPicker, setShowPicker] = useState(false);
  const [filterDone, setFilterDone] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // assigned 뷰 전용 개인 할일 (DEFAULT_VIEW는 상수이므로 별도 관리)
  const [assignedTodos, setAssignedTodos] = useState<PersonalTodo[]>(() => loadAssignedTodos());
  // assigned 뷰에서 수동으로 추가한 씬 키
  const [assignedSceneKeys, setAssignedSceneKeys] = useState<SceneKey[]>(() => loadAssignedSceneKeys());

  const allViews = [DEFAULT_VIEW, ...customViews];
  const activeView = allViews.find((v) => v.id === activeViewId) ?? DEFAULT_VIEW;

  useEffect(() => { saveViews(customViews); }, [customViews]);
  useEffect(() => { saveAssignedTodos(assignedTodos); }, [assignedTodos]);
  useEffect(() => { saveAssignedSceneKeys(assignedSceneKeys); }, [assignedSceneKeys]);

  // 전체 평탄화
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

  // 뷰에 해당하는 씬 (정렬만)
  const allViewScenes = useMemo(() => {
    let result: FlatScene[];
    if (activeView.type === 'assigned') {
      const name = currentUser?.name ?? '';
      const manualKeys = new Set(assignedSceneKeys);
      result = allFlat.filter((f) => (name && f.scene.assignee === name) || manualKeys.has(f.key));
    } else {
      const keys = new Set(activeView.sceneKeys);
      result = allFlat.filter((f) => keys.has(f.key));
    }
    return result.sort((a, b) => {
      if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
      if (a.partId !== b.partId) return a.partId.localeCompare(b.partId);
      const aNum = parseInt(a.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
      const bNum = parseInt(b.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
      return aNum - bNum;
    });
  }, [activeView, allFlat, currentUser, assignedSceneKeys]);

  // 진행 중 / 완료 분리
  const pendingScenes = useMemo(() => allViewScenes.filter((f) => scenePct(f.scene) < 100), [allViewScenes]);
  const doneScenes = useMemo(() => allViewScenes.filter((f) => scenePct(f.scene) >= 100), [allViewScenes]);

  // 활성 뷰의 개인 할일
  const activePersonalTodos = useMemo(() => {
    if (activeView.id === DEFAULT_VIEW.id) return assignedTodos;
    return activeView.personalTodos;
  }, [activeView, assignedTodos]);

  const pendingPersonalTodos = useMemo(() => activePersonalTodos.filter((t) => !t.completed), [activePersonalTodos]);
  const donePersonalTodos = useMemo(() => activePersonalTodos.filter((t) => t.completed), [activePersonalTodos]);

  const stats = useMemo(() => {
    const sceneTotal = allViewScenes.length;
    const personalTotal = activePersonalTodos.length;
    const total = sceneTotal + personalTotal;
    const sceneStages = sceneTotal * 4;
    const sceneChecked = allViewScenes.reduce((s, f) => s + [f.scene.lo, f.scene.done, f.scene.review, f.scene.png].filter(Boolean).length, 0);
    const personalDone = donePersonalTodos.length;
    const fullyDone = doneScenes.length + personalDone;
    // 씬: 4단계 가중, 개인 할일: 1단계 가중
    const totalWeight = sceneStages + personalTotal;
    const checkedWeight = sceneChecked + personalDone;
    const pct = totalWeight > 0 ? (checkedWeight / totalWeight) * 100 : 0;
    return { total, fullyDone, pct };
  }, [allViewScenes, doneScenes, activePersonalTodos, donePersonalTodos]);

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

  // 토글 핸들러
  const handleToggle = useCallback(async (flat: FlatScene, stage: Stage) => {
    const { sheetName, scene, sceneIndex } = flat;
    const newValue = !scene[stage];

    toggleSceneStage(sheetName, scene.sceneId, stage);

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

    try {
      const { updateSheetCell, updateSceneFieldInSheets } = await import('@/services/sheetsService');
      await updateSheetCell(sheetName, sceneIndex, stage, newValue);
      if (completedBy) {
        await updateSceneFieldInSheets(sheetName, sceneIndex, 'completedBy', completedBy).catch(() => {});
        await updateSceneFieldInSheets(sheetName, sceneIndex, 'completedAt', completedAt!).catch(() => {});
      }
      notifyChange();
    } catch (err) {
      console.error('[MyTasks 토글 실패]', err);
      toggleSceneStage(sheetName, scene.sceneId, stage);
    }
  }, [toggleSceneStage, updateSceneFieldOptimistic, currentUser, notifyChange]);

  // 인라인 필드 편집
  const handleEditField = useCallback(async (flat: FlatScene, field: string, value: string) => {
    const { sheetName, sceneIndex } = flat;
    updateSceneFieldOptimistic(sheetName, sceneIndex, field, value);

    try {
      const { updateSceneFieldInSheets } = await import('@/services/sheetsService');
      await updateSceneFieldInSheets(sheetName, sceneIndex, field, value);
      notifyChange();
    } catch (err) {
      console.error('[MyTasks 편집 실패]', err);
    }
  }, [updateSceneFieldOptimistic, notifyChange]);

  // 뷰 조작
  const createCustomView = () => {
    const id = `view_${Date.now()}`;
    setCustomViews((prev) => [...prev, { id, name: '새 할일 목록', type: 'custom' as const, sceneKeys: [], personalTodos: [] }]);
    setActiveViewId(id);
  };
  const renameView = (id: string, name: string) => {
    setCustomViews((prev) => prev.map((v) => v.id === id ? { ...v, name } : v));
  };
  const deleteView = (viewId: string) => {
    setCustomViews((prev) => prev.filter((v) => v.id !== viewId));
    if (activeViewId === viewId) setActiveViewId(DEFAULT_VIEW.id);
  };
  const addToView = (keys: SceneKey[]) => {
    if (activeView.id === DEFAULT_VIEW.id) {
      setAssignedSceneKeys((prev) => [...new Set([...prev, ...keys])]);
    } else {
      setCustomViews((prev) => prev.map((v) =>
        v.id === activeViewId ? { ...v, sceneKeys: [...new Set([...v.sceneKeys, ...keys])] } : v,
      ));
    }
  };
  const removeFromView = (key: SceneKey) => {
    if (activeView.id === DEFAULT_VIEW.id) {
      setAssignedSceneKeys((prev) => prev.filter((k) => k !== key));
    } else {
      setCustomViews((prev) => prev.map((v) =>
        v.id === activeViewId ? { ...v, sceneKeys: v.sceneKeys.filter((k) => k !== key) } : v,
      ));
    }
  };
  const existingKeys = useMemo(() => {
    if (activeView.id === DEFAULT_VIEW.id) {
      const keys = new Set(assignedSceneKeys);
      allViewScenes.forEach((f) => keys.add(f.key));
      return keys;
    }
    return new Set(activeView.sceneKeys);
  }, [activeView, assignedSceneKeys, allViewScenes]);

  // ─── 개인 할일 조작 ─────────────────────
  const addPersonalTodo = async (todo: PersonalTodo) => {
    if (activeView.id === DEFAULT_VIEW.id) {
      setAssignedTodos((prev) => [...prev, todo]);
    } else {
      setCustomViews((prev) => prev.map((v) =>
        v.id === activeViewId ? { ...v, personalTodos: [...v.personalTodos, todo] } : v,
      ));
    }
    // 캘린더 연동: addToCalendar가 true이고 날짜가 있으면 캘린더 이벤트 생성
    if (todo.addToCalendar && (todo.startDate || todo.endDate)) {
      try {
        const { addEvent } = await import('@/services/calendarService');
        const startDate = todo.startDate || todo.endDate!;
        const endDate = todo.endDate || todo.startDate!;
        await addEvent({
          id: `cal_${todo.id}`,
          title: todo.title,
          memo: todo.memo,
          color: '#6C5CE7',
          type: 'custom',
          startDate,
          endDate,
          createdBy: currentUser?.name ?? '알 수 없음',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[MyTasks] 캘린더 이벤트 추가 실패:', err);
      }
    }
  };
  const togglePersonalTodo = (todoId: string) => {
    const updater = (todos: PersonalTodo[]) => todos.map((t) => t.id === todoId ? { ...t, completed: !t.completed } : t);
    if (activeView.id === DEFAULT_VIEW.id) {
      setAssignedTodos(updater);
    } else {
      setCustomViews((prev) => prev.map((v) =>
        v.id === activeViewId ? { ...v, personalTodos: updater(v.personalTodos) } : v,
      ));
    }
  };
  const removePersonalTodo = (todoId: string) => {
    if (activeView.id === DEFAULT_VIEW.id) {
      setAssignedTodos((prev) => prev.filter((t) => t.id !== todoId));
    } else {
      setCustomViews((prev) => prev.map((v) =>
        v.id === activeViewId ? { ...v, personalTodos: v.personalTodos.filter((t) => t.id !== todoId) } : v,
      ));
    }
  };
  const reorderPendingTodos = (reordered: PersonalTodo[]) => {
    const completed = activePersonalTodos.filter((t) => t.completed);
    const newList = [...reordered, ...completed];
    if (activeView.id === DEFAULT_VIEW.id) {
      setAssignedTodos(newList);
    } else {
      setCustomViews((prev) => prev.map((v) =>
        v.id === activeViewId ? { ...v, personalTodos: newList } : v,
      ));
    }
  };

  // assigned 뷰에서 수동 추가된 씬 키 Set
  const assignedSceneKeySet = useMemo(() => new Set(assignedSceneKeys), [assignedSceneKeys]);

  // 행 렌더 헬퍼
  const renderRow = (flat: FlatScene) => {
    const s = flat.scene;
    const pct = scenePct(s);
    const deptCfg = DEPARTMENT_CONFIGS[flat.department];
    const epLabel = episodeTitles[flat.episodeNumber] || `EP.${String(flat.episodeNumber).padStart(2, '0')}`;
    const sceneNum = s.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || String(s.no);
    const isRemovable = activeView.type === 'custom' || (activeView.id === DEFAULT_VIEW.id && assignedSceneKeySet.has(flat.key));
    return (
      <EditableSceneRow
        key={flat.key}
        flat={flat}
        deptCfg={deptCfg}
        epLabel={epLabel}
        sceneNum={sceneNum}
        pct={pct}
        isRemovable={isRemovable}
        onToggle={handleToggle}
        onRemove={removeFromView}
        onEditField={handleEditField}
      />
    );
  };

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
        {/* Windows 11 스타일 탭 바 */}
        <TabBar
          views={allViews}
          activeViewId={activeViewId}
          onSelect={setActiveViewId}
          onClose={deleteView}
          onCreate={createCustomView}
          onRename={renameView}
        />
        <div className="h-px bg-bg-border/30" />

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
              <span className="text-[11px]">
                {activeView.type === 'assigned' ? '할당된 씬이 없습니다' : '할 일을 추가해 보세요'}
              </span>
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
                      <PersonalTodoContent todo={todo} onToggle={togglePersonalTodo} onRemove={removePersonalTodo} showDragHandle />
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
                    <span className="text-[9px] tabular-nums bg-green-500/10 text-green-400/70 px-1.5 py-0 rounded-full">
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
                            <PersonalTodoContent key={todo.id} todo={todo} onToggle={togglePersonalTodo} onRemove={removePersonalTodo} />
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
          className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] text-accent border border-accent/20 rounded-lg hover:bg-accent/5 cursor-pointer transition-colors mt-1"
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
            defaultMode={activeView.type === 'custom' ? 'scene' : 'personal'}
            onAddScenes={addToView}
            onAddPersonalTodo={addPersonalTodo}
            onClose={() => setShowPicker(false)}
          />
        )}
      </AnimatePresence>
    </Widget>
  );
}
